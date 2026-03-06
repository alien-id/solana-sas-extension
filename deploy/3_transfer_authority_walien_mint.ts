import "dotenv/config";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  AuthorityType,
  setAuthority,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { loadKeypairFromEnv } from "./helpers/common";

async function main() {
  const provider = AnchorProvider.env();
  const connection = provider.connection;
  const payer = loadKeypairFromEnv();

  const walienMintStr = process.env.WALIEN_MINT;
  if (!walienMintStr) throw new Error("Set WALIEN_MINT");

  const newMintAuthorityStr = process.env.NEW_MINT_AUTHORITY;
  if (!newMintAuthorityStr) throw new Error("Set NEW_MINT_AUTHORITY");

  const walienMint = new PublicKey(walienMintStr);
  const newMintAuthority = new PublicKey(newMintAuthorityStr);

  await setAuthority(
    connection,
    payer,
    walienMint,
    payer,
    AuthorityType.MintTokens,
    newMintAuthority,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `Transferred mint authority of ${walienMint.toBase58()} to ${newMintAuthority.toBase58()}`
  );

  await setAuthority(
    connection,
    payer,
    walienMint,
    payer,
    AuthorityType.FreezeAccount,
    newMintAuthority,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `Transferred freeze authority of ${walienMint.toBase58()} to ${newMintAuthority.toBase58()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
