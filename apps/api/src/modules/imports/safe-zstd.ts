import { Decompress } from "fzstd";

export class ZstdFormatError extends Error {
  constructor(message = "The compressed data is not a valid Zstandard frame.") {
    super(message);
    this.name = "ZstdFormatError";
  }
}

export class ZstdLimitError extends Error {
  constructor(message = "The compressed data exceeds safe decompression limits.") {
    super(message);
    this.name = "ZstdLimitError";
  }
}

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MAGIC_START = 0x184d2a50;
const SKIPPABLE_MAGIC_END = 0x184d2a5f;
const MAX_BLOCK_SIZE = 128 * 1024;

function needBytes(input: Uint8Array, offset: number, count: number): void {
  if (count < 0 || offset < 0 || offset + count > input.byteLength) throw new ZstdFormatError("The compressed data is truncated.");
}

/**
 * Validate frame declarations before passing data to fzstd. fzstd allocates a
 * history window from the frame header, so output limits alone are too late.
 */
function validateFrames(input: Uint8Array, maxOutputBytes: number, maxWindowBytes: number): void {
  let offset = 0;
  let declaredOutputBytes = 0;
  let frames = 0;

  while (offset < input.byteLength) {
    needBytes(input, offset, 4);
    const magic = Buffer.from(input.buffer, input.byteOffset + offset, 4).readUInt32LE(0);
    if (magic >= SKIPPABLE_MAGIC_START && magic <= SKIPPABLE_MAGIC_END) {
      needBytes(input, offset, 8);
      const skipLength = Buffer.from(input.buffer, input.byteOffset + offset + 4, 4).readUInt32LE(0);
      needBytes(input, offset + 8, skipLength);
      offset += 8 + skipLength;
      continue;
    }
    if (magic !== ZSTD_MAGIC) throw new ZstdFormatError();
    frames += 1;
    offset += 4;
    needBytes(input, offset, 1);
    const descriptor = input[offset++]!;
    if (descriptor & 0x18) throw new ZstdFormatError("The Zstandard frame uses reserved header bits.");

    const singleSegment = (descriptor & 0x20) !== 0;
    const contentSizeFlag = descriptor >>> 6;
    const dictionaryFlag = descriptor & 0x03;
    let windowBytes: number | undefined;
    if (!singleSegment) {
      needBytes(input, offset, 1);
      const windowDescriptor = input[offset++]!;
      const exponent = windowDescriptor >>> 3;
      const mantissa = windowDescriptor & 0x07;
      const base = 2 ** (10 + exponent);
      windowBytes = base + (base / 8) * mantissa;
      if (!Number.isSafeInteger(windowBytes) || windowBytes > maxWindowBytes) throw new ZstdLimitError("The Zstandard frame requests an oversized decoding window.");
    }

    const dictionaryBytes = [0, 1, 2, 4][dictionaryFlag]!;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : contentSizeFlag === 1 ? 2 : contentSizeFlag === 2 ? 4 : 8;
    needBytes(input, offset, dictionaryBytes + contentSizeBytes);
    offset += dictionaryBytes;

    let contentSize: number | undefined;
    if (contentSizeBytes) {
      const view = Buffer.from(input.buffer, input.byteOffset + offset, contentSizeBytes);
      const rawSize = contentSizeBytes === 8 ? view.readBigUInt64LE(0) : BigInt(contentSizeBytes === 4 ? view.readUInt32LE(0) : contentSizeBytes === 2 ? view.readUInt16LE(0) : view.readUInt8(0));
      const decodedSize = rawSize + (contentSizeFlag === 1 ? 256n : 0n);
      if (decodedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZstdLimitError("The Zstandard frame declares an unsafe output size.");
      contentSize = Number(decodedSize);
      declaredOutputBytes += contentSize;
      if (declaredOutputBytes > maxOutputBytes) throw new ZstdLimitError();
      if (singleSegment) windowBytes = contentSize;
    }
    if (windowBytes !== undefined && windowBytes > maxWindowBytes) throw new ZstdLimitError("The Zstandard frame requests an oversized decoding window.");
    offset += contentSizeBytes;

    let lastBlock = false;
    while (!lastBlock) {
      needBytes(input, offset, 3);
      const blockHeader = input[offset]! | (input[offset + 1]! << 8) | (input[offset + 2]! << 16);
      offset += 3;
      lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3 || blockSize > MAX_BLOCK_SIZE) throw new ZstdFormatError("The Zstandard frame contains an invalid block.");
      needBytes(input, offset, blockType === 1 ? 1 : blockSize);
      offset += blockType === 1 ? 1 : blockSize;
    }
    if (descriptor & 0x04) {
      needBytes(input, offset, 4);
      offset += 4;
    }
  }
  if (!frames) throw new ZstdFormatError("The compressed data contains no Zstandard frame.");
}

export function decompressZstdLimited(input: Uint8Array, maxOutputBytes: number, maxWindowBytes = maxOutputBytes): Buffer {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || !Number.isSafeInteger(maxWindowBytes) || maxWindowBytes < 0) {
    throw new RangeError("Zstandard size limits must be non-negative safe integers.");
  }
  validateFrames(input, maxOutputBytes, maxWindowBytes);

  let totalBytes = 0;
  const chunks: Uint8Array[] = [];
  const decoder = new Decompress((chunk) => {
    totalBytes += chunk.byteLength;
    if (totalBytes > maxOutputBytes) throw new ZstdLimitError();
    chunks.push(chunk);
  });
  decoder.push(input, true);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}
