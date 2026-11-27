import assert from "node:assert/strict";
import test from "node:test";
import { claimArchiveEntryName } from "../dist/modules/imports/apkg-parser.js";

test("normalizes archive path separators before accepting a name", () => {
  assert.equal(claimArchiveEntryName("media\\image.png", new Set()), "media/image.png");
});

test("rejects absolute paths, traversal, drive paths, and NUL bytes", () => {
  for (const name of ["/etc/passwd", "../outside", "media/../../outside", "C:\\temp\\file", "media/\0image.png"]) {
    assert.throws(() => claimArchiveEntryName(name, new Set()), { code: "UNSUPPORTED_PACKAGE" });
  }
});

test("rejects duplicate entries after separator normalization", () => {
  const seen = new Set();
  assert.equal(claimArchiveEntryName("media\\image.png", seen), "media/image.png");
  assert.throws(() => claimArchiveEntryName("media/image.png", seen), { code: "DUPLICATE_ARCHIVE_ENTRY" });
});
