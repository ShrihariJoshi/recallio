import assert from "node:assert/strict";
import test from "node:test";
import { indexFirstCardByNote } from "../dist/modules/imports/apkg-parser.js";

test("indexes large card lists by note and preserves the first card's deck mapping", () => {
  const cards = Array.from({ length: 50_000 }, (_, index) => ({ nid: Math.floor(index / 2), did: index % 2 ? "later-deck" : "first-deck" }));
  const indexed = indexFirstCardByNote(cards);

  assert.equal(indexed.size, 25_000);
  assert.equal(indexed.get("0")?.did, "first-deck");
  assert.equal(indexed.get("24999")?.did, "first-deck");
  assert.equal(indexed.has("missing"), false);
});
