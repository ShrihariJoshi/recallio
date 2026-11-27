import { Types, type PipelineStage } from "mongoose";
import { Card } from "../cards/card.model.js";
import { CardState, ReviewEvent } from "../reviews/review.model.js";
import { summarizeDashboardActivity, type DayRatingMetrics } from "./statistics-aggregation.js";

function partsAt(date: Date, timeZone: string): Record<string, string> {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = partsAt(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function utcForLocalMidnight(key: string, timeZone: string): Date {
  const values = key.split("-").map(Number);
  const year = values[0] ?? 0;
  const month = values[1] ?? 1;
  const day = values[2] ?? 1;
  const nominalUtc = Date.UTC(year, month - 1, day);
  let candidate = nominalUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsAt(new Date(candidate), timeZone);
    const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const next = nominalUtc - (representedAsUtc - candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

function recentLocalDateKeys(now: Date, timeZone: string, count: number): string[] {
  const today = localDateKey(now, timeZone);
  const values = today.split("-").map(Number);
  const year = values[0] ?? 0;
  const month = values[1] ?? 1;
  const day = values[2] ?? 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day - count + 1 + index));
    return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  });
}

export async function getDashboardStatistics(userId: string, timeZone: string, days: number) {
  const now = new Date();
  const userObjectId = new Types.ObjectId(userId);
  const keys = recentLocalDateKeys(now, timeZone, days);
  const rangeStart = utcForLocalMidnight(keys[0]!, timeZone);

  const cardCountsPipeline: PipelineStage[] = [
    { $match: { userId: userObjectId } },
    { $project: { cardId: 1, dueAt: 1, userId: 1, "schedulerCard.scheduleStatus": 1 } },
    { $lookup: { from: Card.collection.name, localField: "cardId", foreignField: "_id", pipeline: [{ $project: { userId: 1, suspended: 1 } }], as: "card" } },
    { $unwind: "$card" },
    { $match: { "card.userId": userObjectId, "card.suspended": false } },
    { $group: {
      _id: null,
      dueNow: { $sum: { $cond: [{ $lte: ["$dueAt", now] }, 1, 0] } },
      newCards: { $sum: { $cond: [{ $eq: ["$schedulerCard.scheduleStatus", "new"] }, 1, 0] } },
    } },
  ];

  const undoLookupPipeline: NonNullable<PipelineStage.Lookup["$lookup"]["pipeline"]> = [
    { $match: { $expr: { $and: [
      { $eq: ["$userId", "$$ownerId"] },
      { $eq: ["$eventType", "undo"] },
      { $eq: ["$undoOfEventId", "$$reviewEventId"] },
    ] } } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ];
  const activityPipeline: PipelineStage[] = [
    { $match: { userId: userObjectId, eventType: "review", reviewedAt: { $gte: rangeStart, $lte: now } } },
    { $project: { userId: 1, eventId: 1, reviewedAt: 1, rating: 1 } },
    { $lookup: { from: ReviewEvent.collection.name, let: { ownerId: "$userId", reviewEventId: "$eventId" }, pipeline: undoLookupPipeline, as: "undoEvents" } },
    { $match: { "undoEvents.0": { $exists: false } } },
    { $group: {
      _id: { $dateToString: { format: "%Y-%m-%d", date: "$reviewedAt", timezone: timeZone } },
      reviews: { $sum: 1 },
      again: { $sum: { $cond: [{ $eq: ["$rating", "again"] }, 1, 0] } },
      hard: { $sum: { $cond: [{ $eq: ["$rating", "hard"] }, 1, 0] } },
      good: { $sum: { $cond: [{ $eq: ["$rating", "good"] }, 1, 0] } },
      easy: { $sum: { $cond: [{ $eq: ["$rating", "easy"] }, 1, 0] } },
    } },
  ];

  const [totalCards, cardCounts, rawActivity] = await Promise.all([
    Card.countDocuments({ userId: userObjectId, suspended: false }),
    CardState.aggregate(cardCountsPipeline),
    ReviewEvent.aggregate(activityPipeline) as Promise<DayRatingMetrics[]>,
  ]);
  const counts = cardCounts[0] as { dueNow?: number; newCards?: number } | undefined;
  const { activity, ratings, rangeReviews, studyDays } = summarizeDashboardActivity(keys, rawActivity);
  const reviewsToday = activity.at(-1)?.reviews ?? 0;

  return {
    checkedAt: now.toISOString(),
    timeZone,
    rangeDays: days,
    overview: { dueNow: counts?.dueNow ?? 0, newCards: counts?.newCards ?? 0, totalCards, reviewsToday },
    activity,
    ratings,
    rangeReviews,
    studyDays,
  };
}
