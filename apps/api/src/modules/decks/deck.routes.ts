import { Router } from "express";
import { Types } from "mongoose";
import { deckInputSchema } from "@recallio/contracts";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { Card } from "../cards/card.model.js";
import { Note } from "../notes/note.model.js";
import { Deck } from "./deck.model.js";

export const deckRouter = Router();
deckRouter.use(authenticate);

deckRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const decks = await Deck.find({ userId: req.userId, archivedAt: null }).sort({ name: 1 }).lean();
  const counts = await Card.aggregate([{ $match: { userId: decks[0]?.userId ?? null } }, { $group: { _id: "$deckId", count: { $sum: 1 } } }]);
  const countByDeck = new Map(counts.map((item) => [String(item._id), item.count as number]));
  res.json({ success: true, data: { decks: decks.map((deck) => ({
    id: String(deck._id), name: deck.name, parentDeckId: deck.parentDeckId ? String(deck.parentDeckId) : null,
    cardCount: countByDeck.get(String(deck._id)) ?? 0,
  })) } });
}));

deckRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = deckInputSchema.parse(req.body);
  if (input.parentDeckId && !await Deck.exists({ _id: input.parentDeckId, userId: req.userId, archivedAt: null })) {
    throw new AppError(404, "PARENT_DECK_NOT_FOUND", "Choose a deck that belongs to your account.");
  }
  const deck = await Deck.create({ userId: req.userId, name: input.name, parentDeckId: input.parentDeckId ?? null });
  res.status(201).json({ success: true, data: { deck: { id: String(deck._id), name: deck.name, parentDeckId: deck.parentDeckId ? String(deck.parentDeckId) : null, cardCount: 0 } } });
}));

deckRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = deckInputSchema.partial().parse(req.body);
  const deck = await Deck.findOne({ _id: req.params.id, userId: req.userId, archivedAt: null });
  if (!deck) throw new AppError(404, "DECK_NOT_FOUND", "This deck could not be found.");
  if (input.parentDeckId !== undefined) {
    if (input.parentDeckId === req.params.id) throw new AppError(400, "INVALID_PARENT", "A deck cannot be its own parent.");
    if (input.parentDeckId && !await Deck.exists({ _id: input.parentDeckId, userId: req.userId, archivedAt: null })) throw new AppError(404, "PARENT_DECK_NOT_FOUND", "Choose a deck that belongs to your account.");
    let ancestorId = input.parentDeckId;
    const visited = new Set<string>();
    while (ancestorId) {
      if (ancestorId === req.params.id || visited.has(ancestorId)) throw new AppError(400, "INVALID_PARENT", "A deck cannot be nested inside one of its own subdecks.");
      visited.add(ancestorId);
      const ancestor = await Deck.findOne({ _id: ancestorId, userId: req.userId }).select("parentDeckId").lean();
      ancestorId = ancestor?.parentDeckId ? String(ancestor.parentDeckId) : null;
    }
    deck.parentDeckId = input.parentDeckId ? new Types.ObjectId(input.parentDeckId) : null;
  }
  if (input.name !== undefined) deck.name = input.name;
  await deck.save();
  res.json({ success: true, data: { deck: { id: String(deck._id), name: deck.name, parentDeckId: deck.parentDeckId ? String(deck.parentDeckId) : null } } });
}));

deckRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const deck = await Deck.findOne({ _id: req.params.id, userId: req.userId, archivedAt: null });
  if (!deck) throw new AppError(404, "DECK_NOT_FOUND", "This deck could not be found.");
  const [cards, children] = await Promise.all([
    Card.exists({ userId: req.userId, deckId: deck._id }),
    Deck.exists({ userId: req.userId, parentDeckId: deck._id, archivedAt: null }),
  ]);
  if (cards || children) throw new AppError(409, "DECK_NOT_EMPTY", "Move or remove this deck’s cards and subdecks before deleting it.");
  await deck.deleteOne();
  res.json({ success: true, message: "Deck deleted." });
}));
