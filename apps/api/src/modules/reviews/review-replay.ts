import { reviewFsrsCard, type FsrsCard, type RecallRating } from "@recallio/scheduler";

export interface ReviewTimelineEntry {
  eventId: string;
  rating: RecallRating;
  reviewedAt: Date;
  incoming: boolean;
  source?: { deviceId: string; sessionId: string };
}

export async function replayReviewTimeline(initialCard: FsrsCard, entries: ReviewTimelineEntry[]) {
  const timeline = [...entries].sort((left, right) =>
    left.reviewedAt.getTime() - right.reviewedAt.getTime() || left.eventId.localeCompare(right.eventId),
  );
  const transitions: Array<{
    entry: ReviewTimelineEntry;
    beforeCard: FsrsCard;
    afterCard: FsrsCard;
    schedulerReviewLog: Awaited<ReturnType<typeof reviewFsrsCard>>["revlog"];
  }> = [];
  let card = initialCard;

  for (const entry of timeline) {
    const beforeCard = card;
    const result = await reviewFsrsCard(beforeCard, entry.rating, entry.reviewedAt);
    card = result.card;
    transitions.push({ entry, beforeCard, afterCard: result.card, schedulerReviewLog: result.revlog });
  }

  return { card, transitions };
}
