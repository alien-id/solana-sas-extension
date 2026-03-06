import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
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
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { SAS_PROGRAM_ID, MINT_DECIMALS, TransferHookSdk } from "../sdk";
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
import * as fs from "fs";
import * as toml from "toml";

// ---------------------------------------------------------------------------
// solana-attestation-signer constants (read from Anchor.toml)
// ---------------------------------------------------------------------------

const anchorToml = toml.parse(
  fs.readFileSync(`${__dirname}/../Anchor.toml`, "utf-8")
);
const cluster = anchorToml.provider.cluster as string;
const programs = anchorToml.programs[cluster];

const CREDENTIAL_SIGNER_PROGRAM_ID = new PublicKey(
  programs.credential_signer as string
);
const SESSION_REGISTRY_PROGRAM_ID = new PublicKey(
  programs.session_registry as string
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
  address: "000000010100000000000550ddb1afe5",
  publicKey: "09ac4562cd3c12359d396bbd8e07f296befbcaa50a01eb3d09bef7e3f963be7e",
  privateKey:
    "30887543650595e4bbdb728e6e5ea013b6e164023d1678a7be42ec5b74077269",
};

const TEST_SESSION_2 = {
  address: "0000000101000000000005567ca6f18c",
  publicKey: "bd4c0e1e0f7cf5938664baa07b74b662ac1e35603e79efd96a6dceb59e4d72e5",
  privateKey:
    "3b7777047f9a4bb1318530c1a5b4e695766232139b4565fe9b31d3e5b76c2c77",
};

const TEST_SESSION_3 = {
  address: "00000001010000000000056c3f4f5078",
  publicKey: "adec95b00444c04bdab0ea3385d06d533e2aadc70f9fc8a877158ae51cc4195e",
  privateKey:
    "3143d13c996bd71e88927934f3105329ea22ff2635fcdf71654f0c94a631ec62",
};

const CERTIFICANT_SECRET_KEY = new Uint8Array([
  174, 47, 154, 16, 202, 193, 206, 113, 199, 190, 53, 133, 169, 175, 31, 56,
  222, 53, 138, 189, 224, 216, 117, 173, 10, 149, 53, 45, 73, 251, 237, 246, 15,
  185, 186, 82, 177, 240, 148, 69, 241, 227, 167, 80, 141, 89, 240, 121, 121,
  35, 172, 247, 68, 251, 226, 218, 48, 63, 176, 109, 168, 89, 238, 135,
]);

const CERTIFICANT_SECRET_KEY_2 = new Uint8Array([
  125, 8, 97, 157, 178, 213, 172, 185, 173, 89, 168, 215, 42, 89, 224, 120, 7,
  18, 160, 135, 186, 180, 74, 140, 69, 9, 111, 65, 83, 138, 81, 241, 217, 163,
  81, 18, 185, 154, 80, 236, 6, 157, 155, 37, 125, 212, 251, 109, 146, 110, 119,
  235, 203, 121, 185, 170, 27, 115, 148, 120, 209, 58, 37, 227,
]);

const CERTIFICANT_SECRET_KEY_3 = new Uint8Array([
  234, 129, 236, 14, 145, 241, 246, 163, 152, 4, 28, 141, 173, 150, 186, 13,
  57, 31, 118, 191, 253, 175, 226, 48, 72, 12, 52, 212, 130, 137, 218, 11, 211,
  239, 10, 176, 151, 0, 182, 97, 140, 225, 190, 45, 117, 69, 206, 108, 179, 46,
  124, 132, 253, 34, 76, 214, 220, 5, 121, 34, 27, 72, 8, 227,
]);

describe("alien-id-transfer-hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const sdk = new TransferHookSdk(provider);
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

  async function send(tx: Transaction, ...signers: Keypair[]): Promise<string> {
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

    const response = await axios
      .get(
        `${ORACLE_API_URL}/sign?session_address=${
          session.address
        }&solana_address=${solanaAddress}&session_signature=${Buffer.from(
          sessionSignature
        ).toString("hex")}&timestamp=${timestamp}`
      )
      .catch((err) => {
        const detail = err.response?.data ?? err.message;
        throw new Error(
          `Oracle /sign failed (${err.response?.status}): ${JSON.stringify(
            detail
          )}`
        );
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

    const {
      signature: oracleSignature,
      message: oracleSignatureMessage,
      timestamp,
    } = await getOracleSignature(session, payerAddressBase58);

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

    const createAttestationInstruction = await credentialSignerProgram.methods
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

    await sendAndConfirmTransaction(connection, tx, [admin, payerKeypair], {
      commitment: "confirmed",
      skipPreflight: false,
      maxRetries: 5,
    });

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
      const programState =
        await credentialSignerProgram.account.programState.fetch(
          programStatePda
        );
      credentialPda = programState.credentialPda;
      schemaPda = programState.schemaPda;
      oraclePublicKey = programState.oraclePubkey;
      credentialPdaAddress = credentialPda.toString() as any;
      schemaPdaAddress = schemaPda.toString() as any;
      eventAuthorityPda = await deriveEventAuthorityAddress();
    } else {
      const privateKeyBytes = admin.secretKey.slice(0, 32);
      credentialAuthority = await createKeyPairSignerFromPrivateKeyBytes(
        privateKeyBytes
      );

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
      oraclePublicKey = new PublicKey(
        Buffer.from(signerResponse.data.public_key, "hex")
      );
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

  (isDevnet ? describe.skip : describe)(
    "solana-attestation-signer setup",
    () => {
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
              {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
              },
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
              {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
              },
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

          const changeSignerInstruction =
            new anchor.web3.TransactionInstruction({
              keys: [
                { pubkey: admin.publicKey, isSigner: true, isWritable: true },
                { pubkey: admin.publicKey, isSigner: true, isWritable: false },
                { pubkey: credentialPda, isSigner: false, isWritable: true },
                {
                  pubkey: SystemProgram.programId,
                  isSigner: false,
                  isWritable: false,
                },
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
    }
  );

  // ---------------------------------------------------------------------------
  // Hook program setup
  // ---------------------------------------------------------------------------

  describe("Hook program setup", () => {
    it("creates a token-2022 mint with the transfer hook", async () => {
      const ixs = await sdk.createMintIxs(
        admin.publicKey,
        mintKeypair.publicKey,
        admin.publicKey,
        null,
        MINT_DECIMALS
      );

      await send(new Transaction().add(...ixs), mintKeypair);

      const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
      assert.isNotNull(mintInfo, "mint account should exist");
    });

    it("initializes the hook config with credential/schema from credential_signer", async () => {
      [hookConfigPda] = sdk.hookConfigPda(mintKeypair.publicKey);

      const existing = await connection.getAccountInfo(hookConfigPda);
      if (!existing) {
        const ix = await sdk.initializeConfigIx(
          admin.publicKey,
          mintKeypair.publicKey,
          credentialPda,
          schemaPda,
          SAS_PROGRAM_ID
        );
        await send(new Transaction().add(ix));
      }

      const config = await (sdk.program.account as any).hookConfig.fetch(
        hookConfigPda
      );
      assert.equal(config.authority.toBase58(), admin.publicKey.toBase58());
      assert.equal(config.credential.toBase58(), credentialPda.toBase58());
      assert.equal(config.schema.toBase58(), schemaPda.toBase58());
      assert.equal(config.sasProgram.toBase58(), SAS_PROGRAM_ID.toBase58());
    });

    it("initializes the ExtraAccountMetaList", async () => {
      [extraAccountMetaListPda] = sdk.extraAccountMetaListPda(
        mintKeypair.publicKey
      );

      const existing = await connection.getAccountInfo(extraAccountMetaListPda);
      if (!existing) {
        const ix = await sdk.initializeExtraAccountMetaListIx(
          admin.publicKey,
          mintKeypair.publicKey
        );
        await send(new Transaction().add(ix));
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

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
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

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
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
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
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

    it("creates attestation for TEST_SESSION_3 with new certificant and transfers to first certificant", async () => {
      const newCertificantKeypair = Keypair.fromSecretKey(
        CERTIFICANT_SECRET_KEY_3
      );
      const newCertificantAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        newCertificantKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      await fundWallet(newCertificantKeypair.publicKey, 0.5);

      await send(
        new Transaction()
          .add(
            createAssociatedTokenAccountIdempotentInstruction(
              admin.publicKey,
              newCertificantAta,
              newCertificantKeypair.publicKey,
              mintKeypair.publicKey,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          )
          .add(
            createMintToInstruction(
              mintKeypair.publicKey,
              newCertificantAta,
              admin.publicKey,
              500_000_000,
              [],
              TOKEN_2022_PROGRAM_ID
            )
          )
      );

      const attestationPda = await createAttestationViaCredentialSigner(
        newCertificantKeypair,
        TEST_SESSION_3
      );

      const account = await connection.getAccountInfo(attestationPda);
      assert.isNotNull(account, "attestation account should exist");

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        newCertificantAta,
        mintKeypair.publicKey,
        userAta,
        newCertificantKeypair.publicKey,
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

      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [admin, newCertificantKeypair],
        { commitment: "confirmed" }
      );
      assert.isString(sig, "transfer to first certificant should succeed");
    });
  });

  // ---------------------------------------------------------------------------
  // Whitelist bypass
  // ---------------------------------------------------------------------------

  describe("Whitelist bypass", () => {
    it("admin adds whitelisted wallet to the whitelist", async () => {
      const ix = await sdk.addToWhitelistIx(
        admin.publicKey,
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey
      );
      await send(new Transaction().add(ix));

      const [whitelistEntryPda] = sdk.whitelistEntryPda(
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey
      );

      const entry = await (sdk.program.account as any).whitelistEntry.fetch(
        whitelistEntryPda
      );
      assert.equal(
        entry.wallet.toBase58(),
        whitelistedKeypair.publicKey.toBase58()
      );
    });

    it("whitelisted wallet transfers tokens without attestation", async () => {
      const amount = BigInt(50_000_000); // 0.05 tokens (9 decimals)

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
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
      const ix = await sdk.removeFromWhitelistIx(
        admin.publicKey,
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey
      );
      await send(new Transaction().add(ix));

      const [whitelistEntryPda] = sdk.whitelistEntryPda(
        mintKeypair.publicKey,
        whitelistedKeypair.publicKey
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

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
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
  // Authority transfer
  // ---------------------------------------------------------------------------

  describe("Authority transfer", () => {
    it("admin transfers authority to a new admin, then new admin updates config", async () => {
      const newAdmin = Keypair.generate();
      await fundWallet(newAdmin.publicKey, 0.1);

      const ix1 = await sdk.transferAuthorityIx(
        admin.publicKey,
        newAdmin.publicKey,
        mintKeypair.publicKey
      );
      await send(new Transaction().add(ix1));

      const configAfter = await (sdk.program.account as any).hookConfig.fetch(
        hookConfigPda
      );
      assert.equal(
        configAfter.authority.toBase58(),
        newAdmin.publicKey.toBase58()
      );

      const ix2 = await sdk.transferAuthorityIx(
        newAdmin.publicKey,
        admin.publicKey,
        mintKeypair.publicKey
      );
      await send(new Transaction().add(ix2), newAdmin);

      const configRestored = await (
        sdk.program.account as any
      ).hookConfig.fetch(hookConfigPda);
      assert.equal(
        configRestored.authority.toBase58(),
        admin.publicKey.toBase58()
      );
    });

    it("non-admin cannot transfer authority", async () => {
      const attacker = Keypair.generate();
      await fundWallet(attacker.publicKey, 0.1);

      let failed = false;
      try {
        const ix = await sdk.transferAuthorityIx(
          attacker.publicKey,
          attacker.publicKey,
          mintKeypair.publicKey
        );
        await send(new Transaction().add(ix), attacker);
      } catch {
        failed = true;
      }
      assert.isTrue(
        failed,
        "non-admin should not be able to transfer authority"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Config management
  // ---------------------------------------------------------------------------

  describe("Config management", () => {
    it("admin can update the hook config and ExtraAccountMetaList is refreshed atomically", async () => {
      const dummyCredential = Keypair.generate().publicKey;
      const dummySchema = Keypair.generate().publicKey;
      const dummySas = Keypair.generate().publicKey;

      const ix1 = await sdk.updateConfigIx(
        admin.publicKey,
        mintKeypair.publicKey,
        dummyCredential,
        dummySchema,
        dummySas
      );
      await send(new Transaction().add(ix1));

      const config = await (sdk.program.account as any).hookConfig.fetch(
        hookConfigPda
      );
      assert.equal(config.credential.toBase58(), dummyCredential.toBase58());
      assert.equal(config.schema.toBase58(), dummySchema.toBase58());
      assert.equal(config.sasProgram.toBase58(), dummySas.toBase58());

      const ix2 = await sdk.updateConfigIx(
        admin.publicKey,
        mintKeypair.publicKey,
        credentialPda,
        schemaPda,
        SAS_PROGRAM_ID
      );
      await send(new Transaction().add(ix2));
    });
  });

  // ---------------------------------------------------------------------------
  // Security: Non-admin calling initialize_extra_account_meta_list (F-02)
  // ---------------------------------------------------------------------------

  describe("Security: initialize_extra_account_meta_list authority check", () => {
    it("rejects non-admin calling initialize_extra_account_meta_list", async () => {
      const attacker = Keypair.generate();
      await fundWallet(attacker.publicKey, 0.1);

      let failed = false;
      try {
        const ix = await sdk.initializeExtraAccountMetaListIx(
          attacker.publicKey,
          mintKeypair.publicKey
        );
        await send(new Transaction().add(ix), attacker);
      } catch {
        failed = true;
      }
      assert.isTrue(
        failed,
        "non-admin should not be able to initialize extra account meta list"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Security: Transfer with wrong credential/schema/sas_program (error path)
  // ---------------------------------------------------------------------------

  describe("Security: transfer with wrong credential/schema/sas_program", () => {
    it("rejects transfer after config is updated to wrong values", async () => {
      const wrongCredential = Keypair.generate().publicKey;
      const wrongSchema = Keypair.generate().publicKey;
      const wrongSas = Keypair.generate().publicKey;

      const updateIx = await sdk.updateConfigIx(
        admin.publicKey,
        mintKeypair.publicKey,
        wrongCredential,
        wrongSchema,
        wrongSas
      );
      await send(new Transaction().add(updateIx));

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        userAta,
        mintKeypair.publicKey,
        recipientAta,
        userKeypair.publicKey,
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
        await sendAndConfirmTransaction(connection, tx, [admin, userKeypair], {
          commitment: "confirmed",
        });
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "transfer with wrong config values should fail");

      const restoreIx = await sdk.updateConfigIx(
        admin.publicKey,
        mintKeypair.publicKey,
        credentialPda,
        schemaPda,
        SAS_PROGRAM_ID
      );
      await send(new Transaction().add(restoreIx));
    });
  });
});
