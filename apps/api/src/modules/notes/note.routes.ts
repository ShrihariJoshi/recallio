import { Router } from "express";
import mongoose, { Types } from "mongoose";
import { noteInputSchema, noteTypes } from "@recallio/contracts";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { Card } from "../cards/card.model.js";
import { CardState } from "../reviews/review.model.js";
import { initializeCardStatesForCards } from "../reviews/review.service.js";
import { Deck } from "../decks/deck.model.js";
import { generateCards } from "./card-generation.js";
import { sanitizeNoteFields } from "./sanitize-content.js";
import { Note } from "./note.model.js";

export const noteRouter = Router();
noteRouter.use(authenticate);

noteRouter.get("/types", (_req, res) => res.json({ success: true, data: { noteTypes } }));

noteRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const note = await Note.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!note) throw new AppError(404, "NOTE_NOT_FOUND", "This note could not be found.");
  res.json({ success: true, data: { note: { id: String(note._id), deckId: String(note.deckId), noteType: note.noteType, fields: note.fields, tags: note.tags } } });
}));

noteRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const filter: Record<string, unknown> = { userId: req.userId };
  if (typeof req.query.deckId === "string") filter.deckId = req.query.deckId;
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
    filter.$or = [{ "fields.front": { $regex: escaped, $options: "i" } }, { "fields.back": { $regex: escaped, $options: "i" } }];
  }
  const notes = await Note.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
  const noteIds = notes.map((note) => note._id);
  const cardCounts = await Card.aggregate([{ $match: { userId: notes[0]?.userId ?? null, noteId: { $in: noteIds } } }, { $group: { _id: "$noteId", count: { $sum: 1 } } }]);
  const countMap = new Map(cardCounts.map((item) => [String(item._id), item.count as number]));
  res.json({ success: true, data: { notes: notes.map((note) => ({ ...note, id: String(note._id), cardCount: countMap.get(String(note._id)) ?? 0, _id: undefined })) } });
}));

noteRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = noteInputSchema.parse(req.body);
  const fields = sanitizeNoteFields(input.fields);
  const generated = generateCards(input.noteType, fields);
  if (!generated.length) throw new AppError(400, "NO_CARDS_GENERATED", input.noteType === "cloze" ? "Add at least one cloze deletion, such as {{c1::answer}}." : "Fill in both the question and answer to create a card.");
  const session = await mongoose.startSession();
  let result: { note: { id: string; deckId: string; noteType: string; fields: typeof fields; tags: string[]; cardCount: number } } | undefined;
  try {
    await session.withTransaction(async () => {
      if (!await Deck.exists({ _id: input.deckId, userId: req.userId, archivedAt: null }).session(session)) throw new AppError(404, "DECK_NOT_FOUND", "Choose a deck from your account.");
      const [note] = await Note.create([{ ...input, fields, userId: req.userId }], { session });
      if (!note) throw new AppError(500, "NOTE_CREATE_FAILED", "The note could not be saved. Please try again.");
      const createdCards = await Card.insertMany(generated.map((card) => ({ ...card, userId: req.userId, noteId: note._id, deckId: note.deckId })), { session });
      await initializeCardStatesForCards(req.userId!, createdCards.map((card) => card._id), session);
      result = { note: { id: String(note._id), deckId: String(note.deckId), noteType: note.noteType, fields, tags: note.tags, cardCount: generated.length } };
    });
  } finally { await session.endSession(); }
  if (!result) throw new AppError(500, "NOTE_CREATE_FAILED", "The note could not be saved. Please try again.");
  res.status(201).json({ success: true, data: result, message: `${generated.length} ${generated.length === 1 ? "card" : "cards"} created.` });
}));

noteRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = noteInputSchema.omit({ deckId: true }).partial().parse(req.body);
  const session = await mongoose.startSession();
  let result: { note: { id: string; deckId: string; noteType: string; fields: { front: string; back: string; extra: string }; tags: string[]; cardCount: number } } | undefined;
  try {
    await session.withTransaction(async () => {
      const note = await Note.findOne({ _id: req.params.id, userId: req.userId }).session(session);
      if (!note) throw new AppError(404, "NOTE_NOT_FOUND", "This note could not be found.");
      const nextFields = sanitizeNoteFields({ front: note.fields?.front ?? "", back: note.fields?.back ?? "", extra: note.fields?.extra ?? "", ...input.fields });
      const nextType = input.noteType ?? note.noteType;
      const generated = generateCards(nextType, nextFields);
      if (!generated.length) throw new AppError(400, "NO_CARDS_GENERATED", "This edit would leave the note without a reviewable card.");
      note.fields = nextFields;
      note.noteType = nextType;
      if (input.tags) note.tags = input.tags;
      await note.save({ session });
      const retainedOrdinals = generated.map((card) => card.templateOrdinal);
      for (const card of generated) {
        await Card.updateOne(
          { userId: req.userId, noteId: note._id, templateOrdinal: card.templateOrdinal },
          { $set: { ...card, deckId: note.deckId }, $setOnInsert: { userId: req.userId, noteId: note._id } },
          { upsert: true, session },
        );
      }
      const currentCardIds = (await Card.distinct("_id", { userId: req.userId, noteId: note._id }).session(session)).map((id) => id as Types.ObjectId);
      await initializeCardStatesForCards(req.userId!, currentCardIds, session);
      const removedCards = await Card.find({ userId: req.userId, noteId: note._id, templateOrdinal: { $nin: retainedOrdinals } }).select("_id").session(session).lean();
      if (removedCards.length) {
        await Card.deleteMany({ _id: { $in: removedCards.map((card) => card._id) }, userId: req.userId }, { session });
        await CardState.deleteMany({ userId: req.userId, cardId: { $in: removedCards.map((card) => card._id) } }, { session });
      }
      result = { note: { id: String(note._id), deckId: String(note.deckId), noteType: note.noteType, fields: nextFields, tags: note.tags ?? [], cardCount: generated.length } };
    });
  } finally { await session.endSession(); }
  if (!result) throw new AppError(500, "NOTE_UPDATE_FAILED", "The note could not be updated. Please try again.");
  res.json({ success: true, data: result, message: "Note updated." });
}));

noteRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.userId }).session(session);
      if (!note) throw new AppError(404, "NOTE_NOT_FOUND", "This note could not be found.");
      const cardIds = await Card.find({ userId: req.userId, noteId: note._id }).distinct("_id").session(session);
      await Card.deleteMany({ userId: req.userId, noteId: note._id }, { session });
      if (cardIds.length) await CardState.deleteMany({ userId: req.userId, cardId: { $in: cardIds } }, { session });
    });
  } finally { await session.endSession(); }
  res.json({ success: true, message: "Note and its cards deleted." });
}));
