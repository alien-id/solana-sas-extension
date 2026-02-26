export function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

export function i64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

export function encodeSizedString(str: string): Buffer {
  const bytes = Buffer.from(str, "utf-8");
  return Buffer.concat([u32LE(bytes.length), bytes]);
}

export function encodeSizedBytes(data: Buffer): Buffer {
  return Buffer.concat([u32LE(data.length), data]);
}
