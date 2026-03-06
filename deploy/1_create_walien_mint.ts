import "dotenv/config";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TransferHookSdk } from "../sdk";
import { loadKeypairFromEnv, WALIEN_DECIMALS } from "./helpers/common";

async function main() {
  const provider = AnchorProvider.env();
  const payer = loadKeypairFromEnv();
  const sdk = new TransferHookSdk(provider);

  const mintKeypair = Keypair.generate();

  const ixs = await sdk.createMintIxs(
    payer.publicKey,
    mintKeypair.publicKey,
    payer.publicKey,
    payer.publicKey,
    WALIEN_DECIMALS
  );

  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(...ixs),
    [payer, mintKeypair]
  );

  console.log("Created Walien mint:", mintKeypair.publicKey.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
