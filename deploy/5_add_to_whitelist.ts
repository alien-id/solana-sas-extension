import "dotenv/config";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TransferHookSdk } from "../sdk";
import { loadKeypairFromEnv } from "./helpers/common";

async function main() {
  const provider = AnchorProvider.env();
  const payer = loadKeypairFromEnv();
  const sdk = new TransferHookSdk(provider);

  const walienMintStr = process.env.WALIEN_MINT;
  if (!walienMintStr) throw new Error("Set WALIEN_MINT");

  const walletStr = process.argv[2];
  if (!walletStr) throw new Error("Usage: deploy:5:add-to-whitelist <wallet_address>");

  const walienMint = new PublicKey(walienMintStr);
  const wallet = new PublicKey(walletStr);

  const ix = await sdk.addToWhitelistIx(payer.publicKey, walienMint, wallet);

  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed" }
  );

  console.log("Added to whitelist:", wallet.toBase58());
  const [whitelistEntryPda] = sdk.whitelistEntryPda(walienMint, wallet);
  console.log("Whitelist entry PDA:", whitelistEntryPda.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
