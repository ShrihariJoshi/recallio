import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database as SqlDatabase } from "sql.js";
import { decompress as zstdDecompress } from "fzstd";
import sanitizeHtml from "sanitize-html";
import yauzl from "yauzl";

const MAX_ENTRIES = 10_000;
const MAX_UNCOMPRESSED = 150 * 1024 * 1024;
const MAX_DATABASE = 90 * 1024 * 1024;
const MAX_MEDIA_TOTAL = 80 * 1024 * 1024;
const MAX_NOTES = 20_000;
const MAX_CARDS = 50_000;
const require = createRequire(import.meta.url);

export class ImportFormatError extends Error {
  constructor(message: string, public code = "UNSUPPORTED_PACKAGE") { super(message); }
}

export interface ParsedApkg {
  packageHash: string;
  format: string;
  decks: Array<{ ankiId: string; name: string; parentName: string | null }>;
  notes: Array<{ ankiId: string; guid: string; deckId: string; noteType: "basic" | "basic_reversed" | "cloze"; fields: { front: string; back: string; extra: string }; tags: string[] }>;
  cards: Array<{ ankiId: string; noteAnkiId: string; deckAnkiId: string; ordinal: number; cardType: string }>;
  media: Array<{ name: string; mimeType: string; buffer: Buffer }>;
  report: { unsupportedNoteTypes: string[]; mediaFiles: number; mediaBytes: number; schedulingRecords: number; missingMedia: string[]; warnings: string[] };
}

function readZip(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, decodeStrings: true }, (error, zip) => {
      if (error || !zip) return reject(new ImportFormatError("This file is not a valid APKG archive."));
      const entries = new Map<string, Buffer>();
      let entryCount = 0;
      let expandedBytes = 0;
      const fail = (reason: Error) => { zip.close(); reject(reason); };
      zip.on("error", () => fail(new ImportFormatError("The archive is damaged or invalid.")));
      zip.on("entry", (entry) => {
        entryCount += 1;
        expandedBytes += entry.uncompressedSize;
        if (entryCount > MAX_ENTRIES || expandedBytes > MAX_UNCOMPRESSED) return fail(new ImportFormatError("The package exceeds safe extraction limits.", "PACKAGE_LIMIT"));
        const name = entry.fileName.replaceAll("\\", "/");
        if (name.startsWith("/") || name.split("/").some((part: string) => part === "..") || name.includes(":") || name.includes("\0")) {
          return fail(new ImportFormatError("The package contains an unsafe file path."));
        }
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail(new ImportFormatError("A package entry could not be read."));
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > entry.uncompressedSize || bytes > MAX_UNCOMPRESSED) stream.destroy(new Error("Entry size mismatch")); else chunks.push(chunk); });
          stream.on("error", () => fail(new ImportFormatError("An archive entry failed validation.")));
          stream.on("end", () => {
            if (["collection.anki2", "collection.anki21", "collection.anki21b", "media", "meta"].includes(name) || /^\d+$/.test(name)) entries.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.readEntry();
    });
  });
}

function decodeVarint(buffer: Buffer, offset: number): { value: number; next: number } {
  let value = 0; let shift = 0; let cursor = offset;
  while (cursor < buffer.length && shift < 56) { const byte = buffer[cursor++]!; value |= (byte & 0x7f) << shift; if (!(byte & 0x80)) return { value: value >>> 0, next: cursor }; shift += 7; }
  throw new ImportFormatError("Package metadata is malformed.");
}

function protoFields(buffer: Buffer): Array<{ number: number; wire: number; value: Buffer | number }> {
  const values: Array<{ number: number; wire: number; value: Buffer | number }> = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const tag = decodeVarint(buffer, cursor); cursor = tag.next;
    const number = tag.value >>> 3; const wire = tag.value & 7;
    if (wire === 0) { const value = decodeVarint(buffer, cursor); cursor = value.next; values.push({ number, wire, value: value.value }); }
    else if (wire === 2) { const length = decodeVarint(buffer, cursor); cursor = length.next; if (length.value > buffer.length - cursor) throw new ImportFormatError("Package metadata is truncated."); values.push({ number, wire, value: buffer.subarray(cursor, cursor + length.value) }); cursor += length.value; }
    else if (wire === 1 || wire === 5) { const size = wire === 1 ? 8 : 4; if (cursor + size > buffer.length) throw new ImportFormatError("Package metadata is truncated."); cursor += size; }
    else throw new ImportFormatError("Package metadata uses an unsupported encoding.");
  }
  return values;
}

function parseMediaEntries(buffer: Buffer, modern: boolean): string[] {
  const data = modern ? Buffer.from(zstdDecompress(buffer)) : buffer;
  if (!modern) {
    try { const mapping = JSON.parse(data.toString("utf8")) as Record<string, string>; return Object.values(mapping); }
    catch { throw new ImportFormatError("The package media map is invalid."); }
  }
  return protoFields(data).filter((field) => field.number === 1 && Buffer.isBuffer(field.value)).map((field) => {
    const name = protoFields(field.value as Buffer).find((part) => part.number === 1 && Buffer.isBuffer(part.value))?.value as Buffer | undefined;
    return name?.toString("utf8") ?? "";
  }).filter(Boolean);
}

function query<T extends Record<string, unknown>>(db: SqlDatabase, sql: string): T[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])) as T);
}

function parseJsonColumn(value: unknown): Record<string, any> {
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as Record<string, any>; } catch { return {}; }
}

function noteTypeFor(model: Record<string, any>): "basic" | "basic_reversed" | "cloze" {
  if (model.type === 1) return "cloze";
  if (Array.isArray(model.tmpls) && model.tmpls.length > 1) return "basic_reversed";
  return "basic";
}

function splitFields(value: unknown): string[] { return typeof value === "string" ? value.split("\u001f") : []; }

function supportedImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  if (buffer.subarray(0, 512).toString("utf8").match(/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i)) return "image/svg+xml";
  return null;
}

const svgTags = ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "clippath", "mask", "title", "text"];
const svgAttributes = ["xmlns", "viewbox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "opacity", "transform", "id", "clip-path", "mask", "text-anchor", "font-family", "font-size", "xml:space"];

function sanitizeSvg(buffer: Buffer): Buffer | null {
  const source = buffer.toString("utf8");
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source)) return null;
  const sanitized = sanitizeHtml(source, {
    allowedTags: svgTags,
    allowedAttributes: { "*": svgAttributes },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
  if (!/^\s*<svg\b/i.test(sanitized) || !/<\/svg>\s*$/i.test(sanitized)) return null;
  // Keep only safe geometry and local references. This excludes event handlers,
  // CSS, external resources, and scriptable URL values from untrusted packages.
  const safe = sanitized.replace(/\s(viewbox|width|height|x|y|cx|cy|r|rx|ry|d|points|fill|fill-rule|fill-opacity|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-opacity|opacity|transform|id|clip-path|mask|xmlns|text-anchor|font-family|font-size|xml:space)="([^"]*)"/gi, (whole, name: string, value: string) => {
    const key = name.toLowerCase();
    const valid = key === "xmlns" ? value === "http://www.w3.org/2000/svg"
      : key === "viewbox" ? /^[\d.\s+-]+$/.test(value)
      : ["fill", "stroke"].includes(key) ? /^(?:none|currentColor|#[\da-f]{3,8}|[a-z]{1,24}|url\(#[\w.-]+\))$/i.test(value)
      : key === "clip-path" || key === "mask" ? /^url\(#[\w.-]+\)$/i.test(value)
      : key === "d" ? /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]*$/.test(value)
      : key === "points" ? /^[0-9.,\s+-]*$/.test(value)
      : key === "stroke-dasharray" ? /^(?:none|[0-9.,\s+-]*)$/.test(value)
      : key === "transform" ? /^(?:(?:matrix|translate|scale|rotate)\([0-9.,\s+-]+\)\s*)+$/.test(value)
      : key === "id" ? /^[\w.-]{1,120}$/.test(value)
      : key === "text-anchor" ? /^(?:start|middle|end)$/.test(value)
      : key === "font-family" ? /^[\w,' -]{1,100}$/.test(value)
      : key === "xml:space" ? /^(?:default|preserve)$/.test(value)
      : /^[\w.%#(),\s+-]{1,80}$/.test(value);
    return valid ? whole : "";
  });
  return Buffer.from(safe, "utf8");
}

function imageOcclusionFields(fieldNames: string[], fields: string[]): { front: string; back: string } | null {
  const index = (name: string) => fieldNames.indexOf(name);
  const image = index("image");
  const questionMask = index("question mask");
  const answerMask = index("answer mask");
  if (image < 0 || questionMask < 0 || answerMask < 0) return null;
  const value = (name: string) => { const position = index(name); return position >= 0 ? fields[position] ?? "" : ""; };
  const imageSource = (name: string) => value(name).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? "";
  const originalImage = imageSource("image");
  const layeredImage = (maskField: string) => `<div class="recallio-occlusion"><img class="recallio-occlusion-mask" src="${imageSource(maskField)}" /><img class="recallio-occlusion-image" src="${originalImage}" /></div>`;
  const header = value("header");
  const footer = value("footer");
  const notes = [value("remarks"), value("sources"), value("extra 1"), value("extra 2")].filter(Boolean).join("<br />");
  return {
    front: `${header}${layeredImage("question mask")}${footer}`,
    back: `${header}${layeredImage("answer mask")}${footer}${notes ? `<div>${notes}</div>` : ""}`,
  };
}

export async function parseApkg(filePath: string): Promise<ParsedApkg> {
  const source = await fs.readFile(filePath);
  if (source.length < 4 || source.subarray(0, 4).toString("hex") !== "504b0304") throw new ImportFormatError("Choose a valid .apkg ZIP package.");
  const entries = await readZip(filePath);
  const packageHash = createHash("sha256").update(source).digest("hex");
  const modern = entries.has("collection.anki21b");
  const collectionName = modern ? "collection.anki21b" : entries.has("collection.anki21") ? "collection.anki21" : "collection.anki2";
  const packedDb = entries.get(collectionName);
  if (!packedDb) throw new ImportFormatError("No Anki collection database was found in this package.");
  const database = modern ? Buffer.from(zstdDecompress(packedDb)) : packedDb;
  if (database.length > MAX_DATABASE) throw new ImportFormatError("The collection database exceeds the safe size limit.", "PACKAGE_LIMIT");
  const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve("sql.js")), file) });
  const db = new SQL.Database(database);
  try {
    const tables = new Set(query<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => String(row.name)));
    if (!tables.has("notes") || !tables.has("cards") || !tables.has("col")) {
      throw new ImportFormatError(modern ? "This modern Anki schema is recognized, but its normalized collection tables are not yet supported." : "This Anki database schema is not supported yet.");
    }
    const collection = query<{ decks: unknown; models: unknown }>(db, "SELECT decks, models FROM col LIMIT 1")[0];
    const rawDecks = parseJsonColumn(collection?.decks);
    const rawModels = parseJsonColumn(collection?.models);
    const decks = Object.entries(rawDecks).map(([id, raw]) => {
      const value = raw as Record<string, unknown>; const name = typeof value.name === "string" ? value.name : "Imported deck";
      const parentName = name.includes("::") ? name.split("::").slice(0, -1).join("::") : null;
      return { ankiId: id, name, parentName };
    });
    const noteRows = query<{ id: unknown; guid: unknown; mid: unknown; flds: unknown; tags: unknown }>(db, "SELECT id, guid, mid, flds, tags FROM notes LIMIT 20001");
    const cardRows = query<{ id: unknown; nid: unknown; did: unknown; ord: unknown; type: unknown; queue: unknown }>(db, "SELECT id, nid, did, ord, type, queue FROM cards LIMIT 50001");
    if (noteRows.length > MAX_NOTES || cardRows.length > MAX_CARDS) throw new ImportFormatError("This package has more notes or cards than the current import limit.", "PACKAGE_LIMIT");
    const notes = noteRows.map((row) => {
      const modelId = String(row.mid); const model = rawModels[modelId] as Record<string, any> | undefined;
      const fields = splitFields(row.flds); const noteType = model ? noteTypeFor(model) : "basic";
      const fieldNames = Array.isArray(model?.flds) ? model.flds.map((field: { name?: string }) => String(field.name ?? "").toLowerCase()) : [];
      const occlusion = imageOcclusionFields(fieldNames, fields);
      const frontIndex = Math.max(0, fieldNames.findIndex((name: string) => ["front", "text", "question"].includes(name)));
      const backIndex = Math.max(0, fieldNames.findIndex((name: string) => ["back", "extra", "answer"].includes(name) && name !== fieldNames[frontIndex]));
      const extraIndex = fieldNames.findIndex((name: string) => name === "extra" && backIndex !== fieldNames.indexOf(name));
      const did = cardRows.find((card) => String(card.nid) === String(row.id));
      const rawTags = typeof row.tags === "string" ? row.tags.trim().split(/\s+/).filter(Boolean) : [];
      return {
        ankiId: String(row.id), guid: String(row.guid), deckId: String(did?.did ?? Object.keys(rawDecks)[0] ?? "1"), noteType,
        fields: { front: occlusion?.front ?? fields[frontIndex] ?? "", back: occlusion?.back ?? fields[backIndex] ?? fields[1] ?? "", extra: occlusion ? "" : extraIndex >= 0 ? fields[extraIndex] ?? "" : "" }, tags: rawTags,
        _modelId: modelId, _hasModel: Boolean(model),
      };
    });
    const modelIds = new Set(noteRows.map((row) => String(row.mid)));
    const unsupportedNoteTypes = [...modelIds].filter((id) => !rawModels[id]).map((id) => `Unknown note type ${id}`);
    for (const id of modelIds) {
      const model = rawModels[id] as Record<string, any> | undefined;
      if (model && model.type !== 1 && (Array.isArray(model.tmpls) ? model.tmpls.length : 0) > 1) unsupportedNoteTypes.push(String(model.name ?? `Note type ${id}`));
    }
    const referenced = new Set<string>();
    for (const note of notes) for (const match of note.fields.front.concat(note.fields.back, note.fields.extra).matchAll(/(?:src=["']([^"']+)|\[sound:([^\]]+)\])/gi)) referenced.add(match[1] ?? match[2] ?? "");
    const mediaEntries = entries.get("media");
    const mediaNames = mediaEntries ? parseMediaEntries(mediaEntries, modern) : [];
    let mediaBytes = 0;
    for (const [name, body] of entries) if (/^\d+$/.test(name)) mediaBytes += modern ? zstdDecompress(body).byteLength : body.byteLength;
    if (mediaBytes > MAX_MEDIA_TOTAL) throw new ImportFormatError("Media in this package exceeds the safe import limit.", "PACKAGE_LIMIT");
    const existingMedia = new Set(mediaNames);
    const missingMedia = [...referenced].filter((name) => {
      if (!name || existingMedia.has(name)) return false;
      try { return !existingMedia.has(decodeURIComponent(name)); } catch { return true; }
    });
    const media = mediaNames.flatMap((name, index) => {
      let decodedName = name;
      try { decodedName = decodeURIComponent(name); } catch { /* Preserve the archive's literal name. */ }
      if (!referenced.has(name) && !referenced.has(decodedName)) return [];
      const packed = entries.get(String(index));
      if (!packed) return [];
      const buffer = modern ? Buffer.from(zstdDecompress(packed)) : packed;
      const mimeType = supportedImageType(buffer);
      if (!mimeType) return [];
      if (mimeType === "image/svg+xml") {
        const sanitized = sanitizeSvg(buffer);
        return sanitized ? [{ name, mimeType, buffer: sanitized }] : [];
      }
      return [{ name, mimeType, buffer }];
    });
    const schedulingRecords = tables.has("revlog") ? Number(query<{ count: unknown }>(db, "SELECT COUNT(*) AS count FROM revlog")[0]?.count ?? 0) : 0;
    return {
      packageHash, format: modern ? "anki21b-zstd" : collectionName,
      decks, notes: notes.map(({ _modelId: _model, _hasModel: _has, ...note }) => note),
      cards: cardRows.map((card) => ({ ankiId: String(card.id), noteAnkiId: String(card.nid), deckAnkiId: String(card.did), ordinal: Number(card.ord) || 0, cardType: Number(card.type) === 1 ? "learning" : "review" })),
      media,
      report: { unsupportedNoteTypes: [...new Set(unsupportedNoteTypes)], mediaFiles: mediaNames.length, mediaBytes, schedulingRecords, missingMedia, warnings: [
        ...(modern ? ["Modern package detected; collection tables must use the supported legacy-compatible schema."] : []),
        ...(mediaNames.length && !media.length ? ["No referenced supported images were found. Unsupported media is omitted."] : media.length ? [`${media.length} referenced images are ready to import; audio and video playback is not supported.`] : []),
        ...(schedulingRecords ? ["Anki review history was detected but is not migrated; imported cards will begin with Recallio scheduling state."] : []),
      ] },
    };
  } finally { db.close(); }
}
