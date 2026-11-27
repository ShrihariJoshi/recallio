import { Router } from "express";
import mongoose, { Types, type PipelineStage } from "mongoose";
import { z } from "zod";
import { formatIntervalLabel, previewRatings, reviewFsrsCard } from "@recallio/scheduler";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { Card } from "../cards/card.model.js";
import { CardState, ReviewEvent } from "./review.model.js";
import { asSchedulerCard, ensureReviewStateMigration } from "./review.service.js";
import { reviewEventSchedulerFields, schedulerStateFields } from "./review-metrics.js";

const ratingSchema = z.enum(["again", "hard", "good", "easy"]);
const eventInputSchema = z.object({
  eventId: z.string().uuid(),
  deviceId: z.string().trim().min(1).max(100).default("web"),
  sessionId: z.string().uuid().optional(),
});
const reviewInputSchema = eventInputSchema.extend({ cardId: z.string().min(1), rating: ratingSchema, reviewedAt: z.string().datetime().optional() });
const objectId = (value: string) => Types.ObjectId.isValid(value);

export const reviewRouter = Router();
reviewRouter.use(authenticate);

reviewRouter.get("/due", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const deckId = typeof req.query.deckId === "string" ? req.query.deckId : undefined;
  if (deckId && !objectId(deckId)) throw new AppError(400, "INVALID_DECK", "Choose a valid deck.");
  const now = new Date();
  await ensureReviewStateMigration(req.userId!);

  const pipeline: PipelineStage[] = [
    { $match: { userId: new Types.ObjectId(req.userId!), dueAt: { $lte: now } } },
    { $sort: { dueAt: 1 } },
    { $lookup: { from: Card.collection.name, localField: "cardId", foreignField: "_id", as: "card" } },
    { $unwind: "$card" },
    { $match: { "card.userId": new Types.ObjectId(req.userId!), "card.suspended": false, ...(deckId ? { "card.deckId": new Types.ObjectId(deckId) } : {}) } },
    { $limit: 100 },
  ];
  const due = await CardState.aggregate(pipeline);
  const cards = due.map((item) => ({
    id: String(item.card._id),
    noteId: String(item.card.noteId),
    deckId: String(item.card.deckId),
    cardType: item.card.cardType as string,
    front: item.card.front as string,
    back: item.card.back as string,
    dueAt: new Date(item.dueAt).toISOString(),
    previews: undefined as Awaited<ReturnType<typeof previewRatings>> | undefined,
    stateId: String(item._id),
    schedulerCard: asSchedulerCard(item.schedulerCard),
  }));
  const result = await Promise.all(cards.map(async (card) => ({
    ...card,
    previews: await previewRatings(card.schedulerCard, now),
  })));
  res.json({ success: true, data: { cards: result, dueCount: result.length, checkedAt: now.toISOString() } });
}));

reviewRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = reviewInputSchema.parse(req.body);
  if (!objectId(input.cardId)) throw new AppError(400, "INVALID_CARD", "Choose a valid card.");

  const session = await mongoose.startSession();
  let response: { eventId: string; dueAt: string; intervalLabel: string; reviewedAt: string; schedulerCard: ReturnType<typeof asSchedulerCard>; duplicate: boolean } | undefined;
  try {
    await session.withTransaction(async () => {
      const existing = await ReviewEvent.findOne({ userId: req.userId, eventId: input.eventId }).session(session).lean();
      if (existing) {
        response = { eventId: existing.eventId, dueAt: new Date(existing.dueAt).toISOString(), intervalLabel: "Saved", reviewedAt: new Date(existing.reviewedAt).toISOString(), schedulerCard: asSchedulerCard(existing.afterCard), duplicate: true };
        return;
      }
      const card = await Card.findOne({ _id: input.cardId, userId: req.userId, suspended: false }).session(session).lean();
      if (!card) throw new AppError(404, "CARD_NOT_FOUND", "This card could not be found.");
      const state = await CardState.findOne({ userId: req.userId, cardId: card._id }).session(session);
      if (!state) throw new AppError(409, "CARD_STATE_MISSING", "Refresh the study session and try again.");
      const now = input.reviewedAt ? new Date(input.reviewedAt) : new Date();
      if (now.getTime() > Date.now() + 5 * 60_000 || now.getTime() < Date.now() - 90 * 24 * 60 * 60_000) throw new AppError(400, "INVALID_REVIEW_TIME", "This review timestamp is outside the allowed sync window.");
      if (state.dueAt.getTime() > now.getTime()) throw new AppError(409, "CARD_NOT_DUE", "This card is not due yet.");
      const beforeCard = asSchedulerCard(state.schedulerCard);
      const result = await reviewFsrsCard(beforeCard, input.rating, now);
      const event = {
        userId: new Types.ObjectId(req.userId!),
        cardId: card._id,
        eventId: input.eventId,
        eventType: "review",
        deviceId: input.deviceId,
        sessionId: input.sessionId ?? null,
        rating: input.rating,
        reviewedAt: now,
        ...reviewEventSchedulerFields(beforeCard, result.card, result.revlog),
      };
      await ReviewEvent.create([event], { session });
      const update = await CardState.updateOne(
        { _id: state._id, lastEventId: state.lastEventId },
        { $set: {
          ...schedulerStateFields(result.card),
          lastEventId: input.eventId,
        } },
        { session },
      );
      if (update.modifiedCount !== 1) throw new AppError(409, "REVIEW_CONFLICT", "This card changed in another session. Refresh and try again.");
      response = { eventId: input.eventId, dueAt: result.card.dueAt.toISOString(), intervalLabel: formatIntervalLabel(now, result.card.dueAt), reviewedAt: now.toISOString(), schedulerCard: result.card, duplicate: false };
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const existing = await ReviewEvent.findOne({ userId: req.userId, eventId: input.eventId }).lean();
      if (existing) response = { eventId: existing.eventId, dueAt: new Date(existing.dueAt).toISOString(), intervalLabel: "Saved", reviewedAt: new Date(existing.reviewedAt).toISOString(), schedulerCard: asSchedulerCard(existing.afterCard), duplicate: true };
      else throw error;
    } else throw error;
  } finally {
    await session.endSession();
  }
  res.json({ success: true, data: response });
}));

reviewRouter.post("/:eventId/undo", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = eventInputSchema.parse(req.body);
  const targetEventId = String(req.params.eventId);
  const session = await mongoose.startSession();
  let response: { eventId: string; undoneEventId: string; dueAt: string; duplicate: boolean } | undefined;
  try {
    await session.withTransaction(async () => {
      const existingUndo = await ReviewEvent.findOne({ userId: req.userId, eventId: input.eventId, eventType: "undo" }).session(session).lean();
      if (existingUndo) {
        response = { eventId: existingUndo.eventId, undoneEventId: existingUndo.undoOfEventId ?? targetEventId, dueAt: new Date(existingUndo.dueAt).toISOString(), duplicate: true };
        return;
      }
      const target = await ReviewEvent.findOne({ userId: req.userId, eventId: targetEventId, eventType: "review" }).session(session).lean();
      if (!target) throw new AppError(404, "REVIEW_EVENT_NOT_FOUND", "The review to undo could not be found.");
      const state = await CardState.findOne({ userId: req.userId, cardId: target.cardId }).session(session);
      if (!state || state.lastEventId !== target.eventId) throw new AppError(409, "UNDO_NOT_LATEST", "Undo is available only for the latest review of this card.");
      const beforeUndo = asSchedulerCard(state.schedulerCard);
      const restored = asSchedulerCard(target.beforeCard);
      const now = new Date();
      await ReviewEvent.create([{
        userId: new Types.ObjectId(req.userId!),
        cardId: target.cardId,
        eventId: input.eventId,
        eventType: "undo",
        deviceId: input.deviceId,
        sessionId: input.sessionId ?? target.sessionId,
        rating: null,
        reviewedAt: now,
        ...reviewEventSchedulerFields(beforeUndo, restored, null),
        undoOfEventId: target.eventId,
      }], { session });
      const update = await CardState.updateOne(
        { _id: state._id, lastEventId: target.eventId },
        { $set: {
          ...schedulerStateFields(restored),
          lastEventId: input.eventId,
        } },
        { session },
      );
      if (update.modifiedCount !== 1) throw new AppError(409, "REVIEW_CONFLICT", "This card changed in another session. Refresh and try again.");
      response = { eventId: input.eventId, undoneEventId: target.eventId, dueAt: restored.dueAt.toISOString(), duplicate: false };
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const existingUndo = await ReviewEvent.findOne({ userId: req.userId, eventId: input.eventId, eventType: "undo" }).lean();
      if (existingUndo) response = { eventId: existingUndo.eventId, undoneEventId: existingUndo.undoOfEventId ?? targetEventId, dueAt: new Date(existingUndo.dueAt).toISOString(), duplicate: true };
      else throw error;
    } else throw error;
  } finally {
    await session.endSession();
  }
  res.json({ success: true, data: response });
}));
