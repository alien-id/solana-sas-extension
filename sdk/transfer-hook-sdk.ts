import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
} from "@solana/spl-token";

export async function fetchCredentialSignerPdas(
  provider: AnchorProvider,
  credentialSignerProgramId: PublicKey
): Promise<{ credentialPda: PublicKey; schemaPda: PublicKey }> {
  const [programStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("program_state")],
    credentialSignerProgramId
  );
  const idl = require("../external/solana-attestation-signer/target/idl/credential_signer.json");
  const program = new Program(idl, provider);
  const programState = await (program.account as any).programState.fetch(
    programStatePda
  );
  return {
    credentialPda: programState.credentialPda as PublicKey,
    schemaPda: programState.schemaPda as PublicKey,
  };
}

export class TransferHookSdk {
  readonly provider: AnchorProvider;
  readonly program: Program;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    const idl = require("../target/idl/alien_id_transfer_hook.json");
    this.program = new Program(idl, provider);
  }

  get connection(): Connection {
    return this.provider.connection;
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  // ---------------------------------------------------------------------------
  // PDAs
  // ---------------------------------------------------------------------------

  hookConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("config"), mint.toBuffer()],
      this.programId
    );
  }

  extraAccountMetaListPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mint.toBuffer()],
      this.programId
    );
  }

  whitelistEntryPda(mint: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), mint.toBuffer(), wallet.toBuffer()],
      this.programId
    );
  }

  // ---------------------------------------------------------------------------
  // Instructions
  // ---------------------------------------------------------------------------

  async createMintIxs(
    payer: PublicKey,
    mint: PublicKey,
    mintAuthority: PublicKey,
    freezeAuthority: PublicKey | null,
    decimals: number
  ): Promise<TransactionInstruction[]> {
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(
      mintLen
    );
    return [
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint,
        mintAuthority,
        this.programId,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint,
        decimals,
        mintAuthority,
        freezeAuthority,
        TOKEN_2022_PROGRAM_ID
      ),
    ];
  }

  async initializeConfigIx(
    authority: PublicKey,
    mint: PublicKey,
    credential: PublicKey,
    schema: PublicKey,
    sasProgram: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    return (this.program.methods as any)
      .initializeConfig(credential, schema, sasProgram)
      .accounts({
        authority,
        config: hookConfigPda,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async initializeExtraAccountMetaListIx(
    payer: PublicKey,
    mint: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    const [extraAccountMetaListPda] = this.extraAccountMetaListPda(mint);
    return (this.program.methods as any)
      .initializeExtraAccountMetaList()
      .accounts({
        payer,
        extraAccountMetaList: extraAccountMetaListPda,
        mint,
        config: hookConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async addToWhitelistIx(
    authority: PublicKey,
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    return (this.program.methods as any)
      .addToWhitelist(wallet)
      .accounts({
        authority,
        config: hookConfigPda,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async removeFromWhitelistIx(
    authority: PublicKey,
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    return (this.program.methods as any)
      .removeFromWhitelist(wallet)
      .accounts({
        authority,
        config: hookConfigPda,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async transferAuthorityIx(
    authority: PublicKey,
    newAuthority: PublicKey,
    mint: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    return (this.program.methods as any)
      .transferAuthority()
      .accounts({
        authority,
        newAuthority,
        config: hookConfigPda,
        mint,
      })
      .instruction();
  }

  async updateConfigIx(
    authority: PublicKey,
    mint: PublicKey,
    credential: PublicKey,
    schema: PublicKey,
    sasProgram: PublicKey
  ): Promise<TransactionInstruction> {
    const [hookConfigPda] = this.hookConfigPda(mint);
    const [extraAccountMetaListPda] = this.extraAccountMetaListPda(mint);
    return (this.program.methods as any)
      .updateConfig(credential, schema, sasProgram)
      .accounts({
        authority,
        config: hookConfigPda,
        mint,
        extraAccountMetaList: extraAccountMetaListPda,
      })
      .instruction();
  }
}
