import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  SAS_PROGRAM_ID,
  findCredentialPda,
  findSchemaPda,
  findAttestationPda,
  findHookConfigPda,
  findExtraAccountMetaListPda,
  findWhitelistEntryPda,
  buildCreateCredentialIx,
  buildCreateSchemaIx,
  buildCreateAttestationIx,
  MINT_DECIMALS,
  CREDENTIAL_NAME,
  SCHEMA_NAME,
  SCHEMA_LAYOUT,
  SCHEMA_FIELD_NAMES,
  encodeAlienIdAttestationData,
} from "../sdk";

describe("alien-id-transfer-hook (devnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AlienIdTransferHook as Program<AlienIdTransferHook>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const mintKeypair = Keypair.generate();
  const userKeypair = Keypair.generate();
  const recipientKeypair = Keypair.generate();
  const whitelistedKeypair = Keypair.generate();

  let credentialPda: PublicKey;
  let schemaPda: PublicKey;
  let hookConfigPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;
  let userAta: PublicKey;
  let recipientAta: PublicKey;
  let whitelistedAta: PublicKey;

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

  // ---------------------------------------------------------------------------
  // Global setup
  // ---------------------------------------------------------------------------

  before("fund test wallets", async () => {
    await fundWallet(userKeypair.publicKey, 0.01);
    await fundWallet(recipientKeypair.publicKey, 0.01);
    await fundWallet(whitelistedKeypair.publicKey, 0.01);
  });

  describe("SAS setup", () => {
    it("creates a SAS credential (idempotent)", async () => {
      [credentialPda] = findCredentialPda(admin.publicKey, CREDENTIAL_NAME);

      const existing = await connection.getAccountInfo(credentialPda);
      if (!existing) {
        const ix = buildCreateCredentialIx(
          admin.publicKey,
          admin.publicKey,
          credentialPda,
          CREDENTIAL_NAME,
          [admin.publicKey]
        );
        await send(new Transaction().add(ix));
      }

      const account = await connection.getAccountInfo(credentialPda);
      assert.isNotNull(account, "credential account should exist");
      assert.equal(
        account!.owner.toBase58(),
        SAS_PROGRAM_ID.toBase58(),
        "owned by SAS program"
      );
    });

    it("creates a SAS schema (idempotent)", async () => {
      [credentialPda] = findCredentialPda(admin.publicKey, CREDENTIAL_NAME);
      [schemaPda] = findSchemaPda(credentialPda, SCHEMA_NAME);

      const existing = await connection.getAccountInfo(schemaPda);
      if (!existing) {
        const ix = buildCreateSchemaIx(
          admin.publicKey,
          admin.publicKey,
          credentialPda,
          schemaPda,
          SCHEMA_NAME,
          "Identity verification schema for Alien ID",
          SCHEMA_LAYOUT,
          SCHEMA_FIELD_NAMES
        );
        await send(new Transaction().add(ix));
      }

      const account = await connection.getAccountInfo(schemaPda);
      assert.isNotNull(account, "schema account should exist");
      assert.equal(account!.owner.toBase58(), SAS_PROGRAM_ID.toBase58());
    });
  });

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

    it("initializes the hook config", async () => {
      [credentialPda] = findCredentialPda(admin.publicKey, CREDENTIAL_NAME);
      [schemaPda] = findSchemaPda(credentialPda, SCHEMA_NAME);
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

  describe("Transfer with valid attestation", () => {
    it("creates an attestation for the user (nonce = user pubkey)", async () => {
      [credentialPda] = findCredentialPda(admin.publicKey, CREDENTIAL_NAME);
      [schemaPda] = findSchemaPda(credentialPda, SCHEMA_NAME);

      const [attestationPda] = findAttestationPda(
        credentialPda,
        schemaPda,
        userKeypair.publicKey
      );

      const attestationData = encodeAlienIdAttestationData({
        alienAccountAddress: userKeypair.publicKey.toBuffer(),
        alienIDVersion: 1,
        alienChainId: "1",
        solanaAddress: userKeypair.publicKey.toBuffer().toString("hex"),
        linkageProof: Buffer.alloc(64, 0xab), // mock 64-byte signature
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      });

      const ix = buildCreateAttestationIx(
        admin.publicKey,
        admin.publicKey,
        credentialPda,
        schemaPda,
        attestationPda,
        userKeypair.publicKey,
        attestationData,
        0n
      );

      await send(new Transaction().add(ix));

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

  describe("Transfer with expired attestation", () => {
    const expiredUserKeypair = Keypair.generate();
    let expiredUserAta: PublicKey;

    before("fund expired user and create ATA", async () => {
      await fundWallet(expiredUserKeypair.publicKey, 0.01);

      expiredUserAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        expiredUserKeypair.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      await send(
        new Transaction()
          .add(
            createAssociatedTokenAccountInstruction(
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

    it("creates an attestation with a short expiry and waits for it to expire", async () => {
      [credentialPda] = findCredentialPda(admin.publicKey, CREDENTIAL_NAME);
      [schemaPda] = findSchemaPda(credentialPda, SCHEMA_NAME);

      const [attestationPda] = findAttestationPda(
        credentialPda,
        schemaPda,
        expiredUserKeypair.publicKey
      );

      const attestationData = encodeAlienIdAttestationData({
        alienAccountAddress: expiredUserKeypair.publicKey.toBuffer(),
        alienIDVersion: 1,
        alienChainId: "solana:devnet",
        solanaAddress: expiredUserKeypair.publicKey.toBuffer().toString("hex"),
        linkageProof: Buffer.alloc(64, 0xab),
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      });

      // Set expiry 5 seconds from now — just enough for the SAS program to accept it
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 5);

      const ix = buildCreateAttestationIx(
        admin.publicKey,
        admin.publicKey,
        credentialPda,
        schemaPda,
        attestationPda,
        expiredUserKeypair.publicKey,
        attestationData,
        expiry
      );

      await send(new Transaction().add(ix));

      const account = await connection.getAccountInfo(attestationPda);
      assert.isNotNull(account, "attestation account should exist");

      // Wait for the attestation to expire (devnet clock can lag, use a safe buffer)
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
