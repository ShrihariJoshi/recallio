import { Router } from "express";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { Card } from "./card.model.js";

export const cardRouter = Router();
cardRouter.use(authenticate);

cardRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const filter: Record<string, unknown> = { userId: req.userId };
  if (typeof req.query.deckId === "string") filter.deckId = req.query.deckId;
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
    filter.$or = [{ front: { $regex: escaped, $options: "i" } }, { back: { $regex: escaped, $options: "i" } }];
  }
  const cards = await Card.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ success: true, data: { cards: cards.map((card) => ({ id: String(card._id), noteId: String(card.noteId), deckId: String(card.deckId), cardType: card.cardType, front: card.front, back: card.back, dueAt: card.dueAt, suspended: card.suspended })) } });
}));
