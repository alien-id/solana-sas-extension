import "dotenv/config";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createUpdateTransferHookInstruction,
} from "@solana/spl-token";
import {
  SAS_PROGRAM_ID,
  TransferHookSdk,
  fetchCredentialSignerPdas,
} from "../sdk";
import {
  loadKeypairFromEnv,
  loadCredentialSignerProgramId,
} from "./helpers/common";

async function main() {
  const provider = AnchorProvider.env();
  const payer = loadKeypairFromEnv();
  const sdk = new TransferHookSdk(provider);

  const walienMintStr = process.env.WALIEN_MINT;
  if (!walienMintStr) throw new Error("Set WALIEN_MINT");

  const walienMint = new PublicKey(walienMintStr);

  console.log("New transfer hook program:", sdk.programId.toBase58());

  const updateHookIx = createUpdateTransferHookInstruction(
    walienMint,
    payer.publicKey,
    sdk.programId,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(updateHookIx),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("Updated transfer hook on mint:", walienMint.toBase58());

  const credentialSignerProgramId = loadCredentialSignerProgramId();
  const { credentialPda, schemaPda } = await fetchCredentialSignerPdas(
    provider,
    credentialSignerProgramId
  );

  const [hookConfigPda] = sdk.hookConfigPda(walienMint);
  const [extraAccountMetaListPda] = sdk.extraAccountMetaListPda(walienMint);

  const existingConfig = await provider.connection.getAccountInfo(hookConfigPda);
  if (!existingConfig) {
    const ix = await sdk.initializeConfigIx(
      payer.publicKey,
      walienMint,
      credentialPda,
      schemaPda,
      SAS_PROGRAM_ID
    );
    await sendAndConfirmTransaction(
      provider.connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log("Initialized hook config:", hookConfigPda.toBase58());
  } else {
    console.log("Hook config already exists:", hookConfigPda.toBase58());
  }

  const existingMetaList = await provider.connection.getAccountInfo(extraAccountMetaListPda);
  if (!existingMetaList) {
    const ix = await sdk.initializeExtraAccountMetaListIx(
      payer.publicKey,
      walienMint
    );
    await sendAndConfirmTransaction(
      provider.connection,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" }
    );
    console.log(
      "Initialized extra account meta list:",
      extraAccountMetaListPda.toBase58()
    );
  } else {
    console.log(
      "Extra account meta list already exists:",
      extraAccountMetaListPda.toBase58()
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
