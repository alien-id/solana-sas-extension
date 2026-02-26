import { PublicKey } from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "./constants";

// ---------------------------------------------------------------------------
// SAS PDA derivations
// ---------------------------------------------------------------------------

export function findCredentialPda(
  authority: PublicKey,
  name: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credential"), authority.toBuffer(), Buffer.from(name)],
    SAS_PROGRAM_ID
  );
}

// NOTE: The SAS program hardcodes version=[1] in its PDA seed derivation.
// The `version` parameter here is kept for API clarity but must always be 1.
export function findSchemaPda(
  credential: PublicKey,
  name: string,
  _version: number = 1
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("schema"),
      credential.toBuffer(),
      Buffer.from(name),
      Buffer.from([1]), // SAS hardcodes version=1 on-chain
    ],
    SAS_PROGRAM_ID
  );
}

export function findAttestationPda(
  credential: PublicKey,
  schema: PublicKey,
  nonce: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("attestation"),
      credential.toBuffer(),
      schema.toBuffer(),
      nonce.toBuffer(),
    ],
    SAS_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Hook program PDA derivations
// ---------------------------------------------------------------------------

export function findHookConfigPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.toBuffer()],
    programId
  );
}

export function findExtraAccountMetaListPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    programId
  );
}

export function findWhitelistEntryPda(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}
