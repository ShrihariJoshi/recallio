import { Router } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { Card } from "../cards/card.model.js";
import { Deck } from "../decks/deck.model.js";
import { CardState, ReviewEvent } from "../reviews/review.model.js";
import { asSchedulerCard, ensureReviewStateMigration, initializeCardStatesForCards } from "../reviews/review.service.js";
import { replayReviewTimeline } from "../reviews/review-replay.js";
import { reviewEventSchedulerFields, schedulerStateFields } from "../reviews/review-metrics.js";

const offlineReviewSchema = z.object({
  eventId: z.string().uuid(),
  cardId: z.string().refine(Types.ObjectId.isValid, "Invalid card id."),
  rating: z.enum(["again", "hard", "good", "easy"]),
  deviceId: z.string().trim().min(1).max(100),
  sessionId: z.string().uuid(),
  reviewedAt: z.string().datetime(),
});
const pushSchema = z.object({ reviews: z.array(offlineReviewSchema).min(1).max(100) }).superRefine(({ reviews }, context) => {
  const ids = new Set<string>();
  reviews.forEach((review, index) => {
    if (ids.has(review.eventId)) context.addIssue({ code: "custom", path: ["reviews", index, "eventId"], message: "Event IDs must be unique in a sync batch." });
    ids.add(review.eventId);
    const time = new Date(review.reviewedAt).getTime();
    if (time > Date.now() + 5 * 60_000 || time < Date.now() - 90 * 24 * 60 * 60_000) context.addIssue({ code: "custom", path: ["reviews", index, "reviewedAt"], message: "Review time is outside the allowed sync window." });
  });
});

export const syncRouter = Router();
syncRouter.use(authenticate);

syncRouter.get("/decks/:deckId", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const deckId = req.params.deckId;
  if (typeof deckId !== "string" || !Types.ObjectId.isValid(deckId)) throw new AppError(400, "INVALID_DECK", "Choose a valid deck.");
  const userId = new Types.ObjectId(req.userId!);
  const deck = await Deck.findOne({ _id: deckId, userId, archivedAt: null }).lean();
  if (!deck) throw new AppError(404, "DECK_NOT_FOUND", "This deck could not be found.");
  await ensureReviewStateMigration(req.userId!);
  const cards = await Card.find({ userId, deckId: deck._id, suspended: false }).sort({ _id: 1 }).lean();
  if (cards.length > 5000) throw new AppError(413, "DECK_TOO_LARGE_FOR_OFFLINE", "This deck has too many cards to download at once. Split it into smaller decks first.");
  const cardIds = cards.map((card) => card._id);
  await initializeCardStatesForCards(req.userId!, cardIds);
  const states = await CardState.find({ userId, cardId: { $in: cardIds } }).select("cardId schedulerCard dueAt").lean();
  const stateByCard = new Map(states.map((state) => [String(state.cardId), state]));
  const downloadedAt = new Date();
  res.json({ success: true, data: {
    deck: { id: String(deck._id), name: deck.name, parentDeckId: deck.parentDeckId ? String(deck.parentDeckId) : null, cardCount: cards.length, downloadedAt: downloadedAt.toISOString() },
    cards: cards.flatMap((card) => {
      const state = stateByCard.get(String(card._id));
      if (!state) return [];
      return [{ id: String(card._id), noteId: String(card.noteId), deckId: String(card.deckId), cardType: card.cardType, front: card.front, back: card.back, dueAt: state.dueAt.toISOString(), schedulerCard: asSchedulerCard(state.schedulerCard), previews: [] }];
    }),
    cardCount: cards.length,
    downloadedAt: downloadedAt.toISOString(),
  } });
}));

syncRouter.post("/reviews", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { reviews } = pushSchema.parse(req.body);
  await ensureReviewStateMigration(req.userId!);
  const userId = new Types.ObjectId(req.userId!);
  const byCard = new Map<string, typeof reviews>();
  for (const review of reviews) byCard.set(review.cardId, [...(byCard.get(review.cardId) ?? []), review]);
  const cardIds = [...byCard.keys()].map((id) => new Types.ObjectId(id));
  const ownedCards = await Card.find({ userId, _id: { $in: cardIds }, suspended: false }).select("_id").lean();
  if (ownedCards.length !== cardIds.length) throw new AppError(404, "CARD_NOT_FOUND", "One or more queued cards could not be found.");
  await initializeCardStatesForCards(req.userId!, cardIds);

  const session = await mongoose.startSession();
  let syncedEventIds: string[] = [];
  try {
    await session.withTransaction(async () => {
      const accepted: string[] = [];
      for (const [cardId, incoming] of byCard) {
        const cardObjectId = new Types.ObjectId(cardId);
        const existingLogs = await ReviewEvent.find({ userId, cardId: cardObjectId }).sort({ reviewedAt: 1, eventId: 1 }).session(session).lean();
        const existingIds = new Set(existingLogs.map((event) => event.eventId));
        const newReviews = incoming.filter((review) => !existingIds.has(review.eventId));
        if (!newReviews.length) { accepted.push(...incoming.map((review) => review.eventId)); continue; }

        const state = await CardState.findOne({ userId, cardId: cardObjectId }).session(session);
        if (!state) throw new AppError(409, "CARD_STATE_MISSING", "A queued card has no scheduler state. Refresh and retry sync.");
        const firstReview = existingLogs.find((event) => event.eventType === "review");
        const initialCard = firstReview ? asSchedulerCard(firstReview.beforeCard) : asSchedulerCard(state.schedulerCard);
        const undoneIds = new Set(existingLogs.filter((event) => event.eventType === "undo" && event.undoOfEventId).map((event) => event.undoOfEventId as string));
        const activeReviews = existingLogs.filter((event) => event.eventType === "review" && !undoneIds.has(event.eventId)).map((event) => ({
          eventId: event.eventId,
          rating: event.rating as "again" | "hard" | "good" | "easy",
          reviewedAt: new Date(event.reviewedAt),
          incoming: false as const,
        }));
        const timeline = [
          ...activeReviews,
          ...newReviews.map((review) => ({ eventId: review.eventId, rating: review.rating, reviewedAt: new Date(review.reviewedAt), incoming: true as const, source: review })),
        ].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime() || a.eventId.localeCompare(b.eventId));

        const replay = await replayReviewTimeline(initialCard, timeline);
        const schedulerCard = replay.card;
        const newLogRecords: Array<Record<string, unknown>> = replay.transitions.filter(({ entry }) => entry.incoming).map(({ entry, beforeCard, afterCard, schedulerReviewLog }) => ({
          userId,
          cardId: cardObjectId,
          eventId: entry.eventId,
          eventType: "review",
          deviceId: entry.source!.deviceId,
          sessionId: entry.source!.sessionId,
          rating: entry.rating,
          reviewedAt: entry.reviewedAt,
          ...reviewEventSchedulerFields(beforeCard, afterCard, schedulerReviewLog),
        }));
        if (newLogRecords.length) await ReviewEvent.insertMany(newLogRecords, { session, ordered: true });

        const actions = [
          ...existingLogs.map((event) => ({ eventId: event.eventId, reviewedAt: new Date(event.reviewedAt) })),
          ...newReviews.map((event) => ({ eventId: event.eventId, reviewedAt: new Date(event.reviewedAt) })),
        ].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime() || a.eventId.localeCompare(b.eventId));
        const lastEventId = actions.at(-1)?.eventId ?? state.lastEventId;
        const updated = await CardState.updateOne({ _id: state._id, lastEventId: state.lastEventId }, { $set: {
          ...schedulerStateFields(schedulerCard),
          lastEventId,
        } }, { session });
        if (updated.modifiedCount !== 1) throw new AppError(409, "SYNC_STATE_CONFLICT", "A card changed while sync was being applied. Retry sync.");
        accepted.push(...incoming.map((review) => review.eventId));
      }
      syncedEventIds = accepted;
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, data: { syncedEventIds, syncedCount: syncedEventIds.length } });
}));
