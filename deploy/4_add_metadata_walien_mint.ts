import "dotenv/config";
import {
  createV1,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createGenericFile,
  keypairIdentity,
  percentAmount,
  publicKey,
  Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { AnchorProvider } from "@coral-xyz/anchor";
import path from "path";
import fs from "fs/promises";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { arweaveUploader } from "@metaplex-foundation/umi-uploader-arweave-via-turbo";

const TOKEN_NAME = "WALIEN";
const TOKEN_SYMBOL = "WALIEN";
const DESCRIPTION = "WALIEN";

const tokenMetadata = {
  name: TOKEN_NAME,
  symbol: TOKEN_SYMBOL,
  uri: null,
};

async function addMetadata(mint, umi: Umi) {
  const _ = await findMetadataPda(umi, {
    mint: mint,
  });
  const tx = await createV1(umi, {
    mint,
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    name: tokenMetadata.name,
    symbol: tokenMetadata.symbol,
    uri: tokenMetadata.uri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  let txSig = base58.deserialize(tx.signature);
  console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
}

const tokenImagePath = path.resolve(__dirname, "../assets/token_symbol.png");

async function main() {
  const envProvider = AnchorProvider.env();
  const umi = createUmi(envProvider.connection)
    .use(mplTokenMetadata())
    .use(mplToolbox())
    .use(arweaveUploader());
  const secretKey = envProvider.wallet.payer.secretKey;
  if (!secretKey) throw new Error("Wallet secret key not found");
  let keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const walienMintStr = process.env.WALIEN_MINT;
  if (!walienMintStr) throw new Error("Set WALIEN_MINT");

  let mint = publicKey(walienMintStr);
  umi.use(keypairIdentity(keypair));

  const buffer = await fs.readFile(tokenImagePath);
  let file = createGenericFile(buffer, tokenImagePath, {
    contentType: "image/png",
  });
  const [image] = await umi.uploader.upload([file]);
  console.log("image uri:", image);

  const uri = await umi.uploader.uploadJson({
    name: tokenMetadata.name,
    symbol: tokenMetadata.symbol,
    description: DESCRIPTION,
    image,
  });
  console.log("Offchain metadata URI:", uri);
  tokenMetadata.uri = uri;
  if (tokenMetadata.uri) {
    await addMetadata(mint, umi);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
