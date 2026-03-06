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
import { Program } from "@coral-xyz/anchor";
import { SAS_PROGRAM_ID } from "./constants";
import { encodeSizedString, encodeSizedBytes, u32LE, i64LE } from "./encoding";
import { findHookConfigPda, findExtraAccountMetaListPda } from "./pda";

export async function buildCreateMintWithTransferHookIxs(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  decimals: number,
  hookProgramId: PublicKey
): Promise<TransactionInstruction[]> {
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
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
      hookProgramId,
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

export async function buildInitializeConfigIx(
  program: Program,
  authority: PublicKey,
  mint: PublicKey,
  credential: PublicKey,
  schema: PublicKey,
  sasProgram: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  return (program.methods as any)
    .initializeConfig(credential, schema, sasProgram)
    .accounts({
      authority,
      config: hookConfigPda,
      mint,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildInitializeExtraAccountMetaListIx(
  program: Program,
  payer: PublicKey,
  mint: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  const [extraAccountMetaListPda] = findExtraAccountMetaListPda(
    mint,
    program.programId
  );
  return (program.methods as any)
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

export async function buildAddToWhitelistIx(
  program: Program,
  authority: PublicKey,
  mint: PublicKey,
  wallet: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  return (program.methods as any)
    .addToWhitelist(wallet)
    .accounts({
      authority,
      config: hookConfigPda,
      mint,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildRemoveFromWhitelistIx(
  program: Program,
  authority: PublicKey,
  mint: PublicKey,
  wallet: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  return (program.methods as any)
    .removeFromWhitelist(wallet)
    .accounts({
      authority,
      config: hookConfigPda,
      mint,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildTransferHookAuthorityIx(
  program: Program,
  authority: PublicKey,
  newAuthority: PublicKey,
  mint: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  return (program.methods as any)
    .transferAuthority()
    .accounts({
      authority,
      newAuthority,
      config: hookConfigPda,
      mint,
    })
    .instruction();
}

export async function buildUpdateConfigIx(
  program: Program,
  authority: PublicKey,
  mint: PublicKey,
  credential: PublicKey,
  schema: PublicKey,
  sasProgram: PublicKey
): Promise<TransactionInstruction> {
  const [hookConfigPda] = findHookConfigPda(mint, program.programId);
  const [extraAccountMetaListPda] = findExtraAccountMetaListPda(
    mint,
    program.programId
  );
  return (program.methods as any)
    .updateConfig(credential, schema, sasProgram)
    .accounts({
      authority,
      config: hookConfigPda,
      mint,
      extraAccountMetaList: extraAccountMetaListPda,
    })
    .instruction();
}
