import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { AlienIdTransferHook } from "../target/types/alien_id_transfer_hook";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  SAS_PROGRAM_ID,
  findHookConfigPda,
  findExtraAccountMetaListPda,
  findWhitelistEntryPda,
  MINT_DECIMALS,
} from "../sdk";
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
  deriveEventAuthorityAddress,
  getChangeAuthorizedSignersInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
} from "sas-lib";
import { address } from "@solana/kit";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/signers";
import axios from "axios";

// ---------------------------------------------------------------------------
// solana-attestation-signer constants
// ---------------------------------------------------------------------------

const CREDENTIAL_SIGNER_PROGRAM_ID = new PublicKey(
  "9cstDz8WWRAFaq1vVpTjfHz6tjgh6SJaqYFeZWi1pFHG"
);
const SESSION_REGISTRY_PROGRAM_ID = new PublicKey(
  "DeHa6pyZ2CFSbQQiNMm7FgoCXqmkX6tXG77C4Qycpta6"
);

const SAS_CREDENTIAL_NAME = "alien_credential";
const SAS_SCHEMA_NAME = "alien_schema";
const SAS_SCHEMA_LAYOUT = new Uint8Array([12]); // String = session_address
const SAS_SCHEMA_FIELD_NAMES = ["session_address"];

const ORACLE_API_URL =
  process.env.ORACLE_API_URL ?? "https://cred-signer.develop.alien-api.com";

// ---------------------------------------------------------------------------
// Session fixture (same as used in solana-attestation-signer tests)
// ---------------------------------------------------------------------------

const TEST_SESSION = {
  address: '000000010100000000000550ddb1afe5',
  publicKey: '09ac4562cd3c12359d396bbd8e07f296befbcaa50a01eb3d09bef7e3f963be7e',
  privateKey: '30887543650595e4bbdb728e6e5ea013b6e164023d1678a7be42ec5b74077269'
};

const TEST_SESSION_2 = {
  address: '0000000101000000000005567ca6f18c',
  publicKey: 'bd4c0e1e0f7cf5938664baa07b74b662ac1e35603e79efd96a6dceb59e4d72e5',
  privateKey: '3b7777047f9a4bb1318530c1a5b4e695766232139b4565fe9b31d3e5b76c2c77'
};

const CERTIFICANT_SECRET_KEY = new Uint8Array([
  174, 47, 154, 16, 202, 193, 206, 113, 199, 190, 53, 133, 169, 175, 31, 56,
  222, 53, 138, 189, 224, 216, 117, 173, 10, 149, 53, 45, 73, 251, 237, 246,
  15, 185, 186, 82, 177, 240, 148, 69, 241, 227, 167, 80, 141, 89, 240, 121,
  121, 35, 172, 247, 68, 251, 226, 218, 48, 63, 176, 109, 168, 89, 238, 135,
]);

const CERTIFICANT_SECRET_KEY_2 = new Uint8Array([
  125, 8, 97, 157, 178, 213, 172, 185, 173, 89, 168, 215, 42, 89, 224, 120,
  7, 18, 160, 135, 186, 180, 74, 140, 69, 9, 111, 65, 83, 138, 81, 241,
  217, 163, 81, 18, 185, 154, 80, 236, 6, 157, 155, 37, 125, 212, 251, 109,
  146, 110, 119, 235, 203, 121, 185, 170, 27, 115, 148, 120, 209, 58, 37, 227,
]);

describe("alien-id-transfer-hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AlienIdTransferHook as Program<AlienIdTransferHook>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const isDevnet = connection.rpcEndpoint.includes("devnet");

  const mintKeypair = Keypair.generate();
  const userKeypair = Keypair.fromSecretKey(CERTIFICANT_SECRET_KEY);
  const recipientKeypair = Keypair.generate();
  const whitelistedKeypair = Keypair.generate();

  // PDAs derived from solana-attestation-signer
  let credentialPda: PublicKey;
  let schemaPda: PublicKey;
  let credentialPdaAddress: any;
  let schemaPdaAddress: any;
  let eventAuthorityPda: any;

  let programStatePda: PublicKey;
  let credentialSignerPda: PublicKey;
  let sessionRegistryPda: PublicKey;

  let hookConfigPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;
  let userAta: PublicKey;
  let recipientAta: PublicKey;
  let whitelistedAta: PublicKey;

  // Oracle data (populated in before hook)
  let credentialAuthority: any;
  let oraclePublicKey: PublicKey;
  let ed25519: any;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function fundWallet(pubkey: PublicKey, sol = 0.5) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: pubkey,
        lamports: sol * LAMPORTS_PER_SOL,
      })
    );
    await send(tx);
  }

  async function send(
    tx: Transaction,
    ...signers: Keypair[]
  ): Promise<string> {
    tx.feePayer = admin.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    return sendAndConfirmTransaction(connection, tx, [admin, ...signers], {
      commitment: "confirmed",
      skipPreflight: false,
      maxRetries: 5,
    });
  }

  async function getOracleSignature(
    session: { address: string; privateKey: string },
    solanaAddress: string
  ): Promise<{ signature: Buffer; message: Uint8Array; timestamp: number }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const timestampBuffer = Buffer.allocUnsafe(8);
    timestampBuffer.writeBigInt64LE(BigInt(timestamp), 0);
    const message = Buffer.concat([
      Buffer.from(session.address),
      Buffer.from(solanaAddress),
      timestampBuffer,
    ]);

    const sessionSignature = await ed25519.signAsync(
      Buffer.from(solanaAddress),
      ed25519.etc.hexToBytes(session.privateKey)
    );

    const response = await axios.get(
      `${ORACLE_API_URL}/sign?session_address=${session.address}&solana_address=${solanaAddress}&session_signature=${Buffer.from(sessionSignature).toString("hex")}&timestamp=${timestamp}`
    ).catch((err) => {
      const detail = err.response?.data ?? err.message;
      throw new Error(`Oracle /sign failed (${err.response?.status}): ${JSON.stringify(detail)}`);
    });

    return {
      signature: Buffer.from(response.data.signature, "hex"),
      message,
      timestamp,
    };
  }

  async function createAttestationViaCredentialSigner(
    payerKeypair: Keypair,
    session: { address: string; privateKey: string },
    expirySeconds: number = 365 * 24 * 60 * 60
  ): Promise<PublicKey> {
    const payerAddressBase58 = payerKeypair.publicKey.toBase58();

    const [attestationPdaAddress] = await deriveAttestationPda({
      credential: credentialPdaAddress,
      schema: schemaPdaAddress,
      nonce: address(payerAddressBase58),
    });
    const attestationPda = new PublicKey(attestationPdaAddress);

    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), Buffer.from(session.address)],
      SESSION_REGISTRY_PROGRAM_ID
    );
    const [solanaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("solana"), payerKeypair.publicKey.toBuffer()],
      SESSION_REGISTRY_PROGRAM_ID
    );

    const { signature: oracleSignature, message: oracleSignatureMessage, timestamp } =
      await getOracleSignature(session, payerAddressBase58);

    const expiry = new BN(Math.floor(Date.now() / 1000) + expirySeconds);

    const oracleEd25519Instruction =
      anchor.web3.Ed25519Program.createInstructionWithPublicKey({
        publicKey: oraclePublicKey.toBuffer(),
        message: oracleSignatureMessage,
        signature: oracleSignature,
      });

    // Manually construct credential_signer createAttestation instruction
    // since the IDL types are generated by anchor build in the submodule
    const credentialSignerProgram = new anchor.Program(
      require("../external/solana-attestation-signer/target/idl/credential_signer.json"),
      provider
    );

    const createAttestationInstruction =
      await credentialSignerProgram.methods
        .createAttestation(
          session.address,
          Array.from(oracleSignature),
          expiry,
          new BN(timestamp)
        )
        .accountsStrict({
          programState: programStatePda,
          credentialSigner: credentialSignerPda,
          payer: payerKeypair.publicKey,
          credential: credentialPda,
          schema: schemaPda,
          attestation: attestationPda,
          systemProgram: SystemProgram.programId,
          attestationProgram: SAS_PROGRAM_ID,
          instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
          sessionRegistryProgram: SESSION_REGISTRY_PROGRAM_ID,
          sessionRegistry: sessionRegistryPda,
          sessionEntry: sessionPda,
          solanaEntry: solanaPda,
        })
        .instruction();

    const tx = new Transaction().add(
      oracleEd25519Instruction,
      createAttestationInstruction
    );
    tx.feePayer = admin.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    await sendAndConfirmTransaction(
      connection,
      tx,
      [admin, payerKeypair],
      { commitment: "confirmed", skipPreflight: false, maxRetries: 5 }
    );

    return attestationPda;
  }

  // ---------------------------------------------------------------------------
  // Global setup
  // ---------------------------------------------------------------------------

  before("load ed25519 and derive PDAs", async () => {
    ed25519 = await import("@noble/ed25519");

    [programStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("program_state")],
      CREDENTIAL_SIGNER_PROGRAM_ID
    );
    [credentialSignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_signer")],
      CREDENTIAL_SIGNER_PROGRAM_ID
    );
    [sessionRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session_registry")],
      SESSION_REGISTRY_PROGRAM_ID
    );

    if (isDevnet) {
      const credentialSignerProgram = new anchor.Program(
        require("../external/solana-attestation-signer/target/idl/credential_signer.json"),
        provider
      );
      const programState = await credentialSignerProgram.account.programState.fetch(programStatePda);
      credentialPda = programState.credentialPda;
      schemaPda = programState.schemaPda;
      oraclePublicKey = programState.oraclePubkey;
      credentialPdaAddress = credentialPda.toString() as any;
      schemaPdaAddress = schemaPda.toString() as any;
      eventAuthorityPda = await deriveEventAuthorityAddress();
    } else {
      const privateKeyBytes = admin.secretKey.slice(0, 32);
      credentialAuthority = await createKeyPairSignerFromPrivateKeyBytes(privateKeyBytes);

      [credentialPdaAddress] = await deriveCredentialPda({
        authority: credentialAuthority.address,
        name: SAS_CREDENTIAL_NAME,
      });
      [schemaPdaAddress] = await deriveSchemaPda({
        credential: credentialPdaAddress,
        name: SAS_SCHEMA_NAME,
        version: 1,
      });
      eventAuthorityPda = await deriveEventAuthorityAddress();

      credentialPda = new PublicKey(credentialPdaAddress);
      schemaPda = new PublicKey(schemaPdaAddress);

      const signerResponse = await axios.get(`${ORACLE_API_URL}/system/signer`);
      oraclePublicKey = new PublicKey(Buffer.from(signerResponse.data.public_key, "hex"));
    }
  });

  before("fund test wallets", async () => {
    await fundWallet(userKeypair.publicKey, 0.5);
    await fundWallet(recipientKeypair.publicKey, 0.01);
    await fundWallet(whitelistedKeypair.publicKey, 0.01);
  });

  // ---------------------------------------------------------------------------
  // solana-attestation-signer setup
  // ---------------------------------------------------------------------------

  (isDevnet ? describe.skip : describe)("solana-attestation-signer setup", () => {
    it("fetches oracle public key", async () => {
      const response = await axios.get(`${ORACLE_API_URL}/system/signer`);
      oraclePublicKey = new PublicKey(
        Buffer.from(response.data.public_key, "hex")
      );
      assert.isNotNull(oraclePublicKey, "oracle public key should be set");
    });

    it("initializes the session_registry program (idempotent)", async () => {
      const existing = await connection.getAccountInfo(sessionRegistryPda);
      if (!existing) {
        const sessionRegistryProgram = new anchor.Program(
          require("../external/solana-attestation-signer/target/idl/session_registry.json"),
          provider
        );
        await sessionRegistryProgram.methods
          .initialize()
          .accountsStrict({
            registry: sessionRegistryPda,
            authority: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
      }
      const account = await connection.getAccountInfo(sessionRegistryPda);
      assert.isNotNull(account, "session registry account should exist");
    });

    it("creates SAS credential (idempotent)", async () => {
      const existing = await connection.getAccountInfo(credentialPda);
      if (!existing) {
        const createCredentialIx = getCreateCredentialInstruction({
          payer: credentialAuthority,
          authority: credentialAuthority,
          signers: [credentialAuthority.address],
          credential: credentialPdaAddress,
          name: SAS_CREDENTIAL_NAME,
        });

        const ix = new anchor.web3.TransactionInstruction({
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: credentialPda, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: new PublicKey(createCredentialIx.programAddress),
          data: Buffer.from(createCredentialIx.data),
        });

        await send(new Transaction().add(ix));
      }

      const account = await connection.getAccountInfo(credentialPda);
      assert.isNotNull(account, "credential account should exist");
      assert.equal(account!.owner.toBase58(), SAS_PROGRAM_ID.toBase58());
    });

    it("creates SAS schema (idempotent)", async () => {
      const existing = await connection.getAccountInfo(schemaPda);
      if (!existing) {
        const createSchemaIx = getCreateSchemaInstruction({
          payer: credentialAuthority,
          authority: credentialAuthority,
          credential: credentialPdaAddress,
          schema: schemaPdaAddress,
          name: SAS_SCHEMA_NAME,
          description: "Schema for verifying user identity information",
          layout: SAS_SCHEMA_LAYOUT,
          fieldNames: SAS_SCHEMA_FIELD_NAMES,
        });

        const ix = new anchor.web3.TransactionInstruction({
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: credentialPda, isSigner: false, isWritable: false },
            { pubkey: schemaPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: new PublicKey(createSchemaIx.programAddress),
          data: Buffer.from(createSchemaIx.data),
        });

        await send(new Transaction().add(ix));
      }

      const account = await connection.getAccountInfo(schemaPda);
      assert.isNotNull(account, "schema account should exist");
      assert.equal(account!.owner.toBase58(), SAS_PROGRAM_ID.toBase58());
    });

    it("initializes the credential_signer program (idempotent)", async () => {
      const existing = await connection.getAccountInfo(programStatePda);
      if (!existing) {
        const credentialSignerProgram = new anchor.Program(
          require("../external/solana-attestation-signer/target/idl/credential_signer.json"),
          provider
        );
        await credentialSignerProgram.methods
          .initialize(
            oraclePublicKey,
            credentialPda,
            schemaPda,
            new PublicKey(eventAuthorityPda),
            SESSION_REGISTRY_PROGRAM_ID
          )
          .accountsStrict({
            programState: programStatePda,
            credentialSigner: credentialSignerPda,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });

        // Update SAS credential signers to credentialSignerPda
        const changeSignerIx = getChangeAuthorizedSignersInstruction({
          payer: credentialAuthority,
          authority: credentialAuthority,
          credential: credentialPdaAddress,
          signers: [address(credentialSignerPda.toString())],
        });

        const changeSignerInstruction = new anchor.web3.TransactionInstruction({
          keys: [
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: false },
            { pubkey: credentialPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: new PublicKey(changeSignerIx.programAddress),
          data: Buffer.from(changeSignerIx.data),
        });

        await send(new Transaction().add(changeSignerInstruction));

        // Add credentialSignerPda as signer in session_registry
        const sessionRegistryProgram = new anchor.Program(
          require("../external/solana-attestation-signer/target/idl/session_registry.json"),
          provider
        );
        await sessionRegistryProgram.methods
          .addSigner(credentialSignerPda)
          .accountsStrict({
            registry: sessionRegistryPda,
            authority: admin.publicKey,
          })
          .rpc({ commitment: "confirmed" });
      }

      const account = await connection.getAccountInfo(programStatePda);
      assert.isNotNull(account, "program state account should exist");
    });
  });

  // ---------------------------------------------------------------------------
  // Hook program setup
  // ---------------------------------------------------------------------------

  describe("Hook program setup", () => {
    it("creates a token-2022 mint with the transfer hook", async () => {
      const extensions = [ExtensionType.TransferHook];
      const mintLen = getMintLen(extensions);
      const lamports =
        await connection.getMinimumBalanceForRentExemption(mintLen);

      const createMintAccountIx = SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      const initTransferHookIx = createInitializeTransferHookInstruction(
        mintKeypair.publicKey,
        admin.publicKey,
        program.programId,
        TOKEN_2022_PROGRAM_ID
      );

      const initMintIx = createInitializeMintInstruction(
        mintKeypair.publicKey,
        MINT_DECIMALS,
        admin.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      );

      await send(
        new Transaction()
          .add(createMintAccountIx)
          .add(initTransferHookIx)
          .add(initMintIx),
        mintKeypair
      );

      const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
      assert.isNotNull(mintInfo, "mint account should exist");
    });

    it("initializes the hook config with credential/schema from credential_signer", async () => {
      [hookConfigPda] = findHookConfigPda(mintKeypair.publicKey, program.programId);

      const existing = await connection.getAccountInfo(hookConfigPda);
      if (!existing) {
        await program.methods
          .initializeConfig(credentialPda, schemaPda, SAS_PROGRAM_ID)
          .accounts({
            authority: admin.publicKey,
            config: hookConfigPda,
            mint: mintKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed", skipPreflight: true });
      }

      const config = await program.account.hookConfig.fetch(hookConfigPda);
      assert.equal(config.authority.toBase58(), admin.publicKey.toBase58());
      assert.equal(config.credential.toBase58(), credentialPda.toBase58());
      assert.equal(config.schema.toBase58(), schemaPda.toBase58());
      assert.equal(config.sasProgram.toBase58(), SAS_PROGRAM_ID.toBase58());
    });

    it("initializes the ExtraAccountMetaList", async () => {
      [extraAccountMetaListPda] = findExtraAccountMetaListPda(
        mintKeypair.publicKey,
        program.programId
      );

      const existing = await connection.getAccountInfo(extraAccountMetaListPda);
      if (!existing) {
        await program.methods
          .initializeExtraAccountMetaList()
          .accounts({
            payer: admin.publicKey,
            extraAccountMetaList: extraAccountMetaListPda,
            mint: mintKeypair.publicKey,
            config: hookConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed", skipPreflight: true });
      }

      const metaListInfo = await connection.getAccountInfo(
        extraAccountMetaListPda
      );
      assert.isNotNull(metaListInfo, "extra account meta list should exist");
    });

    it("creates token accounts and mints tokens to user and whitelisted wallet", async () => {
      userAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        userKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      recipientAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        recipientKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      whitelistedAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const createAtasAndMintTx = new Transaction()
        .add(
          createAssociatedTokenAccountInstruction(
            admin.publicKey,
            userAta,
            userKeypair.publicKey,
            mintKeypair.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
        .add(
          createAssociatedTokenAccountInstruction(
            admin.publicKey,
            recipientAta,
            recipientKeypair.publicKey,
            mintKeypair.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
        .add(
          createAssociatedTokenAccountInstruction(
            admin.publicKey,
            whitelistedAta,
            whitelistedKeypair.publicKey,
            mintKeypair.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
        .add(
          createMintToInstruction(
            mintKeypair.publicKey,
            userAta,
            admin.publicKey,
            1_000_000_000, // 1 token (9 decimals)
            [],
            TOKEN_2022_PROGRAM_ID
          )
        )
        .add(
          createMintToInstruction(
            mintKeypair.publicKey,
            whitelistedAta,
            admin.publicKey,
            1_000_000_000, // 1 token (9 decimals)
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );

      await send(createAtasAndMintTx);

      const userBalance = await connection.getTokenAccountBalance(userAta);
      assert.equal(userBalance.value.uiAmount, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Transfer with valid attestation (created via credential_signer)
  // ---------------------------------------------------------------------------

  describe("Transfer with valid attestation", () => {
    it("creates an attestation for the user via credential_signer (oracle-backed)", async () => {
      const attestationPda = await createAttestationViaCredentialSigner(
        userKeypair,
        TEST_SESSION
      );

      const account = await connection.getAccountInfo(attestationPda);
      assert.isNotNull(account, "attestation account should exist");
      assert.equal(account!.owner.toBase58(), SAS_PROGRAM_ID.toBase58());
    });

    it("successfully transfers tokens from attested user", async () => {
      const amount = BigInt(100_000_000); // 0.1 tokens (9 decimals)

      const transferIx =
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          userAta,
          mintKeypair.publicKey,
          recipientAta,
          userKeypair.publicKey,
          amount,
          MINT_DECIMALS,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = admin.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [admin, userKeypair],
        { commitment: "confirmed" }
      );
      assert.isString(sig, "transfer should succeed");

      const balance = await connection.getTokenAccountBalance(recipientAta);
      assert.equal(balance.value.amount, "100000000");
    });
  });

  // ---------------------------------------------------------------------------
  // Transfer without attestation
  // ---------------------------------------------------------------------------

  describe("Transfer without attestation", () => {
    it("rejects a transfer from a non-attested, non-whitelisted wallet", async () => {
      const mintTx = new Transaction().add(
        createMintToInstruction(
          mintKeypair.publicKey,
          recipientAta,
          admin.publicKey,
          500_000_000,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      await send(mintTx);

      const transferIx =
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          recipientAta,
          mintKeypair.publicKey,
          userAta,
          recipientKeypair.publicKey,
          BigInt(10_000_000),
          MINT_DECIMALS,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = admin.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      let failed = false;
      try {
        await sendAndConfirmTransaction(
          connection,
          tx,
          [admin, recipientKeypair],
          { commitment: "confirmed" }
        );
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "transfer from non-attested wallet should fail");
    });
  });

  // ---------------------------------------------------------------------------
  // Transfer with expired attestation (created via credential_signer, short expiry)
  // ---------------------------------------------------------------------------

  describe("Transfer with expired attestation", () => {
    const expiredUserKeypair = Keypair.fromSecretKey(CERTIFICANT_SECRET_KEY_2);
    let expiredUserAta: PublicKey;

    before("fund expired user and create ATA", async () => {
      await fundWallet(expiredUserKeypair.publicKey, 0.5);

      expiredUserAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        expiredUserKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      await send(
        new Transaction()
          .add(
            createAssociatedTokenAccountIdempotentInstruction(
              admin.publicKey,
              expiredUserAta,
              expiredUserKeypair.publicKey,
              mintKeypair.publicKey,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
          .add(
            createMintToInstruction(
              mintKeypair.publicKey,
              expiredUserAta,
              admin.publicKey,
              500_000_000,
              [],
              TOKEN_2022_PROGRAM_ID
            )
          )
      );
    });

    it("creates an attestation with a short expiry via credential_signer and waits for it to expire", async () => {
      const attestationPda = await createAttestationViaCredentialSigner(
        expiredUserKeypair,
        TEST_SESSION_2,
        5 // 5 seconds expiry
      );

      const account = await connection.getAccountInfo(attestationPda);
      assert.isNotNull(account, "attestation account should exist");

      // Wait for the attestation to expire
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    });

    it("rejects transfer with expired attestation", async () => {
      const transferIx =
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          expiredUserAta,
          mintKeypair.publicKey,
          recipientAta,
          expiredUserKeypair.publicKey,
          BigInt(10_000_000),
          MINT_DECIMALS,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = admin.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      let failed = false;
      try {
        await sendAndConfirmTransaction(
          connection,
          tx,
          [admin, expiredUserKeypair],
          { commitment: "confirmed" }
        );
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "transfer with expired attestation should fail");
    });
  });

  // ---------------------------------------------------------------------------
  // Whitelist bypass
  // ---------------------------------------------------------------------------

  describe("Whitelist bypass", () => {
    it("admin adds whitelisted wallet to the whitelist", async () => {
      await program.methods
        .addToWhitelist(whitelistedKeypair.publicKey)
        .accounts({
          authority: admin.publicKey,
          config: hookConfigPda,
          mint: mintKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed", skipPreflight: true });

      const [whitelistEntryPda] = findWhitelistEntryPda(
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey,
        program.programId
      );

      const entry = await program.account.whitelistEntry.fetch(
        whitelistEntryPda
      );
      assert.equal(
        entry.wallet.toBase58(),
        whitelistedKeypair.publicKey.toBase58()
      );
    });

    it("whitelisted wallet transfers tokens without attestation", async () => {
      const amount = BigInt(50_000_000); // 0.05 tokens (9 decimals)

      const transferIx =
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          whitelistedAta,
          mintKeypair.publicKey,
          recipientAta,
          whitelistedKeypair.publicKey,
          amount,
          MINT_DECIMALS,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = admin.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [admin, whitelistedKeypair],
        { commitment: "confirmed" }
      );
      assert.isString(sig, "whitelisted wallet transfer should succeed");
    });

    it("admin removes wallet from whitelist, transfer fails afterwards", async () => {
      await program.methods
        .removeFromWhitelist(whitelistedKeypair.publicKey)
        .accounts({
          authority: admin.publicKey,
          config: hookConfigPda,
          mint: mintKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed", skipPreflight: true });

      const [whitelistEntryPda] = findWhitelistEntryPda(
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey,
        program.programId
      );

      const entry = await connection.getAccountInfo(whitelistEntryPda);
      assert.isNull(entry, "whitelist entry should be closed");

      await send(
        new Transaction().add(
          createMintToInstruction(
            mintKeypair.publicKey,
            whitelistedAta,
            admin.publicKey,
            200_000_000,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        )
      );

      const transferIx =
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          whitelistedAta,
          mintKeypair.publicKey,
          recipientAta,
          whitelistedKeypair.publicKey,
          BigInt(10_000_000),
          MINT_DECIMALS,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = admin.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      let failed = false;
      try {
        await sendAndConfirmTransaction(
          connection,
          tx,
          [admin, whitelistedKeypair],
          { commitment: "confirmed" }
        );
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "de-whitelisted wallet transfer should fail");
    });
  });

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  describe("Config management", () => {
    it("admin can update the hook config", async () => {
      const dummyCredential = Keypair.generate().publicKey;
      const dummySchema = Keypair.generate().publicKey;
      const dummySas = Keypair.generate().publicKey;

      await program.methods
        .updateConfig(dummyCredential, dummySchema, dummySas)
        .accounts({
          authority: admin.publicKey,
          config: hookConfigPda,
          mint: mintKeypair.publicKey,
        })
        .rpc({ commitment: "confirmed", skipPreflight: true });

      const config = await program.account.hookConfig.fetch(hookConfigPda);
      assert.equal(config.credential.toBase58(), dummyCredential.toBase58());
      assert.equal(config.schema.toBase58(), dummySchema.toBase58());
      assert.equal(config.sasProgram.toBase58(), dummySas.toBase58());
    });
  });
});
