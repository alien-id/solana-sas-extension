import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import * as toml from "toml";

export { WALIEN_DECIMALS } from "../../sdk/constants";

export function loadKeypairFromEnv(): Keypair {
  const keypairPath =
    process.env.WALIEN_KEYPAIR_PATH ||
    process.env.KEYPAIR_PATH ||
    process.env.ANCHOR_WALLET;
  if (!keypairPath) {
    throw new Error("Set WALIEN_KEYPAIR_PATH or KEYPAIR_PATH or ANCHOR_WALLET");
  }
  const resolved = path.resolve(keypairPath);
  const secret = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function loadCredentialSignerProgramId(): PublicKey {
  const anchorTomlPath = path.resolve(__dirname, "../../Anchor.toml");
  const anchorToml = toml.parse(fs.readFileSync(anchorTomlPath, "utf-8"));

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "";
  let cluster: string;
  if (rpcUrl.includes("mainnet")) {
    cluster = "mainnet";
  } else if (rpcUrl.includes("devnet")) {
    cluster = "devnet";
  } else {
    cluster = "localnet";
  }

  const programs = anchorToml.programs[cluster];
  if (!programs?.credential_signer) {
    throw new Error(
      `credential_signer program ID not found in Anchor.toml for cluster: ${cluster}`
    );
  }

  return new PublicKey(programs.credential_signer as string);
}
