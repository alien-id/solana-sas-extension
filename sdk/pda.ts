import { PublicKey } from "@solana/web3.js";
import { SAS_PROGRAM_ID } from "./constants";

export const ILM_BASE = new PublicKey(
    "MFGQxwAmB91SwuYX36okv2Qmdc9aMuHTwWGUrp4AtB1"
);

// use with `derivePoolTransferAuthorityMeteora` function
export const METEORA_DLLM_PROGRAM_ID = new PublicKey("LbVRzDTvBDEcrthxfZ4RL6yiq3uZw8bS6MwtdY6UhFQ");

export function derivePoolTransferAuthorityMeteora(
    tokenX: PublicKey,
    tokenY: PublicKey,
    dlmmProgramId: PublicKey
): PublicKey {
    const [minKey, maxKey] =
        tokenX.toBuffer().compare(tokenY.toBuffer()) === 1
            ? [tokenY, tokenX]
            : [tokenX, tokenY];

    const [pda] = PublicKey.findProgramAddressSync(
        [ILM_BASE.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
        dlmmProgramId
    );

    return pda;
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
