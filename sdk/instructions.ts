import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "./constants";
import { encodeSizedString, encodeSizedBytes, u32LE, i64LE } from "./encoding";

/** CreateCredential – discriminator 0 */
export function buildCreateCredentialIx(
  payer: PublicKey,
  authority: PublicKey,
  credential: PublicKey,
  name: string,
  signers: PublicKey[]
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([0]),
    encodeSizedString(name),
    u32LE(signers.length),
    ...signers.map((s) => s.toBuffer()),
  ]);
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: credential, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** CreateSchema – discriminator 1 */
export function buildCreateSchemaIx(
  payer: PublicKey,
  authority: PublicKey,
  credential: PublicKey,
  schema: PublicKey,
  name: string,
  description: string,
  layout: Buffer,
  fieldNames: string[]
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([1]),
    encodeSizedString(name),
    encodeSizedString(description),
    encodeSizedBytes(layout),
    u32LE(fieldNames.length),
    ...fieldNames.map((fn) => encodeSizedString(fn)),
  ]);
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: credential, isSigner: false, isWritable: false },
      { pubkey: schema, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** CreateAttestation – discriminator 6 */
export function buildCreateAttestationIx(
  payer: PublicKey,
  authority: PublicKey,
  credential: PublicKey,
  schema: PublicKey,
  attestation: PublicKey,
  nonce: PublicKey,
  attData: Buffer,
  expiry: bigint
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([6]),
    nonce.toBuffer(),
    encodeSizedBytes(attData),
    i64LE(expiry),
  ]);
  return new TransactionInstruction({
    programId: SAS_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: credential, isSigner: false, isWritable: false },
      { pubkey: schema, isSigner: false, isWritable: false },
      { pubkey: attestation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}
