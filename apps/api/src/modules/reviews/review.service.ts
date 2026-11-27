import { Types, type ClientSession } from "mongoose";
import { createNewFsrsCard, type FsrsCard } from "@recallio/scheduler";
import { Card } from "../cards/card.model.js";
import { User } from "../auth/user.model.js";
import { AppError } from "../../shared/errors.js";
import { CardState } from "./review.model.js";
import { schedulerStateFields } from "./review-metrics.js";

async function bulkInitialize(userId: string, cards: Array<{ _id: Types.ObjectId; dueAt?: Date }>, session?: ClientSession): Promise<void> {
  if (!cards.length) return;
  const operations = await Promise.all(cards.map(async (card) => {
    const schedulerCard = await createNewFsrsCard(card.dueAt ?? new Date());
    return { updateOne: { filter: { cardId: card._id }, update: { $setOnInsert: {
      userId: new Types.ObjectId(userId),
      cardId: card._id,
      ...schedulerStateFields(schedulerCard),
      lastEventId: null,
    } }, upsert: true } };
  }));
  try {
    await CardState.bulkWrite(operations, { ordered: false, ...(session ? { session } : {}) });
  } catch (error) {
    const writeErrors = (error as { writeErrors?: Array<{ code?: number }> }).writeErrors;
    const isConcurrentInitialization = (error as { code?: number }).code === 11000 || Boolean(writeErrors?.length && writeErrors.every((item) => item.code === 11000));
    if (session || !isConcurrentInitialization) throw error;
  }
}

export async function initializeCardStatesForCards(userId: string, cardIds: Types.ObjectId[], session?: ClientSession): Promise<void> {
  if (!cardIds.length) return;
  const cards = await Card.find({ userId, _id: { $in: cardIds } }).select("_id dueAt").session(session ?? null).lean();
  const existingIds = new Set((await CardState.distinct("cardId", { userId, cardId: { $in: cardIds } }).session(session ?? null)).map(String));
  const missing = cards.filter((card) => !existingIds.has(String(card._id)));
  for (let index = 0; index < missing.length; index += 500) await bulkInitialize(userId, missing.slice(index, index + 500), session);
}

export async function initializeMissingCardStates(userId: string): Promise<void> {
  const userObjectId = new Types.ObjectId(userId);
  while (true) {
    const missing = await Card.aggregate([
      { $match: { userId: userObjectId, suspended: false } },
      { $lookup: { from: CardState.collection.name, localField: "_id", foreignField: "cardId", as: "existingState" } },
      { $match: { "existingState.0": { $exists: false } } },
      { $sort: { createdAt: 1 } },
      { $limit: 500 },
      { $project: { _id: 1, dueAt: 1 } },
    ]);
    if (!missing.length) return;
    await bulkInitialize(userId, missing);
    if (missing.length < 500) return;
  }
}

export async function ensureReviewStateMigration(userId: string): Promise<void> {
  const user = await User.findById(userId).select("+reviewStateVersion").lean();
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if ((user.reviewStateVersion ?? 0) < 1) {
    await initializeMissingCardStates(userId);
    await User.updateOne({ _id: userId }, { $set: { reviewStateVersion: 1 } });
  }
}

export function asSchedulerCard(value: unknown): FsrsCard {
  const card = value as FsrsCard;
  // MongoDB preserves dates in Mixed fields. Normalize string dates as a guard
  // for data that may have been written through a JSON sync client in the future.
  return {
    ...card,
    dueAt: card.dueAt instanceof Date ? card.dueAt : new Date(card.dueAt),
    lastReviewAt: card.lastReviewAt == null ? null : card.lastReviewAt instanceof Date ? card.lastReviewAt : new Date(card.lastReviewAt),
  };
}
