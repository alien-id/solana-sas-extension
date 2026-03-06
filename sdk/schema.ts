import { u32LE, i64LE } from "./encoding";

export const MINT_DECIMALS = 9;

export const CREDENTIAL_NAME = "AlienIdCredential";
export const SCHEMA_NAME = "AlienIdSolanaLinkage";

// SAS SchemaDataTypes enum (on-chain):
//   0=U8, 3=U64, 12=String, 13=VecU8
export const SCHEMA_LAYOUT = Buffer.from([
  13, // VecU8   — alienAccountAddress (32 bytes)
  0, // U8      — alienIDVersion (0=V0_9, 1=V1, 2=V2)
  12, // String  — alienChainId
  12, // String  — solanaAddress (hex string)
  13, // VecU8   — linkageProof (signature from Alien key over solana address)
  3, // U64     — timestamp
]);

export const SCHEMA_FIELD_NAMES = [
  "alienAccountAddress",
  "alienIDVersion",
  "alienChainId",
  "solanaAddress",
  "linkageProof",
  "timestamp",
];

export interface AlienIdAttestationData {
  alienAccountAddress: Uint8Array; // 32 bytes — alien account pubkey/address bytes
  alienIDVersion: number; // 0=V0_9, 1=V1, 2=V2
  alienChainId: string; // e.g. "ethereum:1"
  solanaAddress: string; // solana pubkey as hex string
  linkageProof: Uint8Array; // signature bytes (e.g. 64 bytes)
  timestamp: bigint; // unix timestamp seconds
}

/**
 * Encodes attestation data conforming to the AlienIdSolanaLinkage schema layout.
 * Field byte layout matches the SAS validate_data rules:
 *   VecU8  → u32LE(len) + bytes
 *   U8     → 1 byte
 *   String → u32LE(byte_len) + UTF-8 bytes
 *   U64    → 8 bytes LE
 */
export function encodeAlienIdAttestationData(
  params: AlienIdAttestationData
): Buffer {
  const alienAccountAddressBytes = Buffer.from(params.alienAccountAddress);
  const alienChainIdBytes = Buffer.from(params.alienChainId, "utf-8");
  const solanaAddressBytes = Buffer.from(params.solanaAddress, "utf-8");
  const linkageProofBytes = Buffer.from(params.linkageProof);

  return Buffer.concat([
    // VecU8: alienAccountAddress
    u32LE(alienAccountAddressBytes.length),
    alienAccountAddressBytes,
    // U8: alienIDVersion
    Buffer.from([params.alienIDVersion]),
    // String: alienChainId
    u32LE(alienChainIdBytes.length),
    alienChainIdBytes,
    // String: solanaAddress
    u32LE(solanaAddressBytes.length),
    solanaAddressBytes,
    // VecU8: linkageProof
    u32LE(linkageProofBytes.length),
    linkageProofBytes,
    // U64: timestamp
    i64LE(params.timestamp),
  ]);
}
