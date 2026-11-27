import assert from "node:assert/strict";
import test from "node:test";
import { decompressZstdLimited, ZstdFormatError, ZstdLimitError } from "../dist/modules/imports/safe-zstd.js";

const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function rawFrame(payload, { declaredSize = payload.length, windowDescriptor } = {}) {
  const singleSegment = windowDescriptor === undefined;
  const sizeFlag = declaredSize <= 255 ? 0 : 1;
  const descriptor = (sizeFlag << 6) | (singleSegment ? 0x20 : 0);
  const sizeBytes = sizeFlag === 0 ? Buffer.from([declaredSize]) : Buffer.from([declaredSize - 256 & 0xff, (declaredSize - 256) >>> 8]);
  const window = singleSegment ? Buffer.alloc(0) : Buffer.from([windowDescriptor]);
  const blockHeader = Buffer.alloc(3);
  blockHeader.writeUIntLE((payload.length << 3) | 1, 0, 3);
  return Buffer.concat([magic, Buffer.from([descriptor]), window, sizeBytes, blockHeader, payload]);
}

test("decompresses a valid frame within the declared output cap", () => {
  const expected = Buffer.from("Recallio safe import");
  assert.deepEqual(decompressZstdLimited(rawFrame(expected), 100), expected);
});

test("rejects a frame declaring more output than allowed before decoding", () => {
  const frame = rawFrame(Buffer.alloc(0), { declaredSize: 60_000 });
  assert.throws(() => decompressZstdLimited(frame, 1024), ZstdLimitError);
});

test("rejects an oversized Zstandard history window from its header", () => {
  const frame = rawFrame(Buffer.from([1]), { windowDescriptor: 0xf8 });
  assert.throws(() => decompressZstdLimited(frame, 1024 * 1024), ZstdLimitError);
});

test("enforces the output cap across concatenated frames without declared sizes", () => {
  const frameA = rawFrame(Buffer.alloc(10, 65), { declaredSize: 10, windowDescriptor: 0 });
  const frameB = rawFrame(Buffer.alloc(10, 66), { declaredSize: 10, windowDescriptor: 0 });
  assert.throws(() => decompressZstdLimited(Buffer.concat([frameA, frameB]), 15), ZstdLimitError);
});

test("rejects truncated and non-Zstandard input", () => {
  assert.throws(() => decompressZstdLimited(magic.subarray(0, 3), 1024), ZstdFormatError);
  assert.throws(() => decompressZstdLimited(Buffer.from("not zstd"), 1024), ZstdFormatError);
});
