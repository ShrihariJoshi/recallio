import { DefaultScheduler, Rating, type DefaultSchedulerCard, type Grade } from "ts-fsrs";

export type RecallRating = "again" | "hard" | "good" | "easy";
export type FsrsCard = DefaultSchedulerCard<"FSRS-7">;
export type FsrsReviewLog = Awaited<ReturnType<Awaited<ReturnType<typeof DefaultScheduler>>["review"]>>["revlog"];

const schedulerPromise = DefaultScheduler({ version: "FSRS-7", desiredRetention: 0.9 });
const ratingValues: Record<RecallRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface RatingPreview {
  rating: RecallRating;
  dueAt: string;
  intervalLabel: string;
}

export function formatIntervalLabel(from: Date, due: Date): string {
  const minutes = Math.max(0, Math.round((due.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.max(1, Math.round(hours / 24));
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export async function createNewFsrsCard(now = new Date()): Promise<FsrsCard> {
  const scheduler = await schedulerPromise;
  return scheduler.newCard({ now });
}

export async function previewRatings(card: FsrsCard, now = new Date()): Promise<RatingPreview[]> {
  const scheduler = await schedulerPromise;
  const ratingForGrade = new Map<Grade, RecallRating>(Object.entries(ratingValues).map(([key, value]) => [value, key as RecallRating]));
  return Array.from(scheduler.preview({ card, now }), ({ grade, card: nextCard }) => ({
    rating: ratingForGrade.get(grade)!,
    dueAt: nextCard.dueAt.toISOString(),
    intervalLabel: formatIntervalLabel(now, nextCard.dueAt),
  }));
}

export async function reviewFsrsCard(card: FsrsCard, rating: RecallRating, now = new Date()) {
  const scheduler = await schedulerPromise;
  return scheduler.review({ card, grade: ratingValues[rating], now });
}

export const fsrsMetadata = { packageVersion: "ts-fsrs@6.0.1", modelVersion: "FSRS-7", desiredRetention: 0.9 } as const;
