import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { Types } from "mongoose";
import { rateLimit } from "express-rate-limit";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { Card } from "../cards/card.model.js";
import { initializeCardStatesForCards } from "../reviews/review.service.js";
import { Deck } from "../decks/deck.model.js";
import { generateCards } from "../notes/card-generation.js";
import { Note } from "../notes/note.model.js";
import { ImportJob, ImportStage } from "./import.model.js";
import { ImportFormatError, parseApkg } from "./apkg-parser.js";
import { MediaAsset } from "../assessments/assessment.models.js";
import { deleteMedia, mediaStorageProvider, putMedia } from "../assessments/media-storage.js";
import { sanitizeNoteFields } from "../notes/sanitize-content.js";

export const importRouter = Router();
importRouter.use(authenticate);
importRouter.use(rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir(), filename: (_req, _file, cb) => cb(null, `recallio-${randomUUID()}.apkg`) }),
  limits: { fileSize: 35 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === ".apkg"),
});

importRouter.post("/", upload.single("file"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (!req.file) throw new AppError(400, "FILE_REQUIRED", "Choose an .apkg file to import.");
  const tempPath = req.file.path;
  const storageProvider = mediaStorageProvider();
  const storedMedia: Array<{ storageKey: string; assetId: string | null }> = [];
  let createdJobId: Types.ObjectId | null = null;
  try {
    const parsed = await parseApkg(tempPath);
    const existing = await ImportJob.findOne({ userId: req.userId, packageHash: parsed.packageHash, status: "imported" }).lean();
    const mediaUrls = new Map<string, string>();
    for (const image of parsed.media) {
      const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
      const storageKey = `${randomUUID()}.${extension}`;
      storedMedia.push({ storageKey, assetId: null });
      await putMedia(storageKey, image.buffer, image.mimeType);
      const asset = await MediaAsset.create({ userId: req.userId, storageKey, storageProvider, mimeType: image.mimeType, sizeBytes: image.buffer.byteLength, sha256: createHash("sha256").update(image.buffer).digest("hex"), originalName: path.basename(image.name).slice(0, 180) });
      storedMedia[storedMedia.length - 1]!.assetId = String(asset._id);
      mediaUrls.set(image.name, `/api/v1/media/${asset._id}`);
      try { mediaUrls.set(decodeURIComponent(image.name), `/api/v1/media/${asset._id}`); } catch { /* Keep the literal archive name. */ }
    }
    const notes = parsed.notes.map((note) => ({ ...note, fields: sanitizeNoteFields(Object.fromEntries(Object.entries(note.fields).map(([field, html]) => [field, html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix: string, quote: string, source: string) => {
      const normalized = source.replace(/&amp;/gi, "&");
      const safeSource = mediaUrls.get(normalized) ?? (() => { try { return mediaUrls.get(decodeURIComponent(normalized)); } catch { return undefined; } })();
      return safeSource ? `${prefix}${quote}${safeSource}${quote}` : match;
    })])) as { front: string; back: string; extra: string }) }));
    const job = await ImportJob.create({
      userId: req.userId, packageHash: parsed.packageHash, filename: path.basename(req.file.originalname), format: parsed.format,
      status: "preview", report: parsed.report, mediaAssetIds: storedMedia.map((entry) => entry.assetId).filter(Boolean),
      preview: { deckCount: parsed.decks.length, noteCount: parsed.notes.length, cardCount: parsed.cards.length, tagCount: new Set(parsed.notes.flatMap((note) => note.tags)).size, duplicatePackage: Boolean(existing), decks: parsed.decks.slice(0, 100).map((deck) => deck.name) },
    });
    createdJobId = job._id;
    const stages = [
      ...parsed.decks.map((payload) => ({ userId: req.userId, importId: job._id, kind: "deck", sourceId: payload.ankiId, payload })),
      ...notes.map((payload) => ({ userId: req.userId, importId: job._id, kind: "note", sourceId: payload.ankiId, payload })),
      ...parsed.cards.map((payload) => ({ userId: req.userId, importId: job._id, kind: "card", sourceId: payload.ankiId, payload })),
    ];
    for (let offset = 0; offset < stages.length; offset += 500) await ImportStage.insertMany(stages.slice(offset, offset + 500));
    res.status(201).json({ success: true, data: { import: { id: String(job._id), filename: job.filename, format: job.format, status: job.status, preview: job.preview, report: job.report } }, message: "Package analyzed. Review the preview before importing." });
  } catch (error) {
    if (createdJobId) { await ImportStage.deleteMany({ importId: createdJobId }); await ImportJob.deleteOne({ _id: createdJobId, userId: req.userId }); }
    await Promise.all(storedMedia.map(async ({ storageKey, assetId }) => { await deleteMedia(storageKey, storageProvider).catch(() => undefined); if (assetId) await MediaAsset.deleteOne({ _id: assetId, userId: req.userId }); }));
    if (error instanceof ImportFormatError) throw new AppError(400, error.code, error.message);
    throw error;
  } finally { await fs.rm(tempPath, { force: true }); }
}));

importRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const job = await ImportJob.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This import could not be found.");
  res.json({ success: true, data: { import: { id: String(job._id), filename: job.filename, format: job.format, status: job.status, preview: job.preview, report: job.report, summary: job.summary } } });
}));

importRouter.post("/:id/confirm", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const job = await ImportJob.findOne({ _id: req.params.id, userId: req.userId });
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This import could not be found.");
  if (job.status === "imported") { res.json({ success: true, data: { summary: job.summary }, message: "This package was already imported." }); return; }
  const stages = await ImportStage.find({ userId: req.userId, importId: job._id }).lean();
  const deckStages = stages.filter((stage) => stage.kind === "deck");
  const noteStages = stages.filter((stage) => stage.kind === "note");
  const cardStages = stages.filter((stage) => stage.kind === "card");
  const deckMap = new Map<string, string>();
  for (const stage of deckStages) {
    const data = stage.payload as { name: string; ankiId: string };
    let parentDeckId: Types.ObjectId | null = null;
    let deck: InstanceType<typeof Deck> | null = null;
    for (const part of data.name.split("::").filter(Boolean)) {
      deck = await Deck.findOne({ userId: req.userId, name: part, parentDeckId });
      if (!deck) deck = await Deck.create({ userId: req.userId, name: part, parentDeckId });
      parentDeckId = deck._id;
    }
    if (!deck) continue;
    deckMap.set(data.ankiId, String(deck._id));
  }
  const noteMap = new Map<string, string>();
  let importedNotes = 0; let updatedNotes = 0; let importedCards = 0;
  for (const stage of noteStages) {
    const data = stage.payload as { ankiId: string; guid: string; deckId: string; noteType: "basic" | "basic_reversed" | "cloze"; fields: { front: string; back: string; extra: string }; tags: string[] };
    const deckId = deckMap.get(data.deckId) ?? String((await Deck.findOne({ userId: req.userId }))?._id ?? "");
    if (!deckId) continue;
    let note = await Note.findOne({ userId: req.userId, externalAnkiGuid: data.guid });
    if (note) { note.deckId = new Types.ObjectId(deckId); note.noteType = data.noteType; note.fields = data.fields; note.tags = data.tags; await note.save(); updatedNotes += 1; }
    else { note = await Note.create({ userId: req.userId, deckId, noteType: data.noteType, fields: data.fields, tags: data.tags, source: "anki", externalAnkiGuid: data.guid, externalAnkiId: data.ankiId }); importedNotes += 1; }
    noteMap.set(data.ankiId, String(note._id));
  }
  const cardByNote = new Map<string, typeof cardStages>();
  for (const stage of cardStages) { const data = stage.payload as { noteAnkiId: string }; cardByNote.set(data.noteAnkiId, [...(cardByNote.get(data.noteAnkiId) ?? []), stage]); }
  for (const stage of noteStages) {
    const data = stage.payload as { ankiId: string; deckId: string; noteType: "basic" | "basic_reversed" | "cloze"; fields: { front: string; back: string; extra: string } };
    const noteId = noteMap.get(data.ankiId); if (!noteId) continue;
    const generated = generateCards(data.noteType, data.fields);
    const imported = cardByNote.get(data.ankiId) ?? [];
    const sourceCards = imported.length ? imported : generated.map((card) => ({ sourceId: String(card.templateOrdinal), payload: { ordinal: card.templateOrdinal, cardType: card.cardType } }));
    for (const source of sourceCards) {
      const payload = source.payload as { ordinal: number; cardType?: string; deckAnkiId?: string };
      const generatedCard = generated.find((card) => card.templateOrdinal === payload.ordinal) ?? generated[0];
      if (!generatedCard) continue;
      const externalAnkiId = imported.length ? source.sourceId : null;
      await Card.updateOne({ userId: req.userId, noteId, templateOrdinal: payload.ordinal }, { $set: { deckId: deckMap.get(payload.deckAnkiId ?? data.deckId) ?? String((await Note.findById(noteId))?.deckId), cardType: generatedCard.cardType, front: generatedCard.front, back: generatedCard.back, ...(externalAnkiId ? { externalAnkiId } : {}) }, $setOnInsert: { userId: req.userId, noteId, dueAt: new Date() } }, { upsert: true });
      importedCards += 1;
    }
  }
  const importedNoteIds = [...noteMap.values()].map((id) => new Types.ObjectId(id));
  if (importedNoteIds.length) {
    const importedCardIds = (await Card.distinct("_id", { userId: req.userId, noteId: { $in: importedNoteIds } })).map((id) => id as Types.ObjectId);
    await initializeCardStatesForCards(req.userId!, importedCardIds);
  }
  job.status = "imported";
  job.summary = { importedDecks: deckMap.size, importedNotes, updatedNotes, importedCards, warningCount: (job.report as { warnings?: unknown[] }).warnings?.length ?? 0 };
  await job.save();
  await ImportStage.deleteMany({ importId: job._id });
  res.json({ success: true, data: { summary: job.summary }, message: "Anki package imported." });
}));

importRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const job = await ImportJob.findOneAndDelete({ _id: req.params.id, userId: req.userId, status: "preview" });
  if (!job) throw new AppError(404, "IMPORT_NOT_FOUND", "This pending import could not be found.");
  await ImportStage.deleteMany({ importId: job._id });
  const mediaAssets = await MediaAsset.find({ _id: { $in: job.mediaAssetIds ?? [] }, userId: req.userId }).lean();
  await Promise.all(mediaAssets.map((asset) => deleteMedia(asset.storageKey, asset.storageProvider ?? "filesystem").catch(() => undefined)));
  if (mediaAssets.length) await MediaAsset.deleteMany({ _id: { $in: mediaAssets.map((asset) => asset._id) }, userId: req.userId });
  res.json({ success: true, message: "Pending import discarded." });
}));
