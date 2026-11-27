import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CardState, ReviewEvent } from "../dist/modules/reviews/review.model.js";
import { asSchedulerCard } from "../dist/modules/reviews/review.service.js";
import { reviewEventSchedulerFields, schedulerStateFields } from "../dist/modules/reviews/review-metrics.js";
import { replayReviewTimeline } from "../dist/modules/reviews/review-replay.js";
import { summarizeDashboardActivity } from "../dist/modules/statistics/statistics-aggregation.js";
import { createNewFsrsCard, fsrsMetadata, previewRatings, reviewFsrsCard } from "@recallio/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;
const startAt = new Date("2026-01-01T12:00:00.000Z");
const userId = "64b000000000000000000001";
const cardId = "64b000000000000000000002";
const textCard = Object.freeze({ front: "What is FSRS?", back: "A spaced-repetition scheduling algorithm." });

describe("text-card FSRS persistence and fetch pipeline", () => {
  it("stores review events and mirrored scheduler metrics, then restores dates on fetch", async () => {
    assert.equal(textCard.front.includes("<img"), false);
    let schedulerCard = await createNewFsrsCard(startAt);
    let reviewedAt = startAt;
    const savedEvents = [];

    for (const [index, rating] of ["good", "hard", "again", "good", "easy"].entries()) {
      const beforeCard = schedulerCard;
      const result = await reviewFsrsCard(beforeCard, rating, reviewedAt);
      const eventId = `offline-text-review-${index + 1}`;
      const event = new ReviewEvent({
        userId,
        cardId,
        eventId,
        eventType: "review",
        deviceId: "mock-device",
        sessionId: "mock-session",
        rating,
        reviewedAt,
        ...reviewEventSchedulerFields(beforeCard, result.card, result.revlog),
      });

      await event.validate();
      savedEvents.push(event.toObject());
      schedulerCard = result.card;
      reviewedAt = schedulerCard.dueAt;
    }

    const state = new CardState({ userId, cardId, lastEventId: savedEvents.at(-1).eventId, ...schedulerStateFields(schedulerCard) });
    await state.validate();
    const stored = state.toObject();

    assert.equal(stored.schedulerModel, "FSRS-7");
    assert.equal(stored.desiredRetention, 0.9);
    assert.equal(stored.reps, schedulerCard.reps);
    assert.equal(stored.lapses, schedulerCard.lapses);
    assert.equal(stored.state, schedulerCard.state);
    assert.equal(stored.dueAt.getTime(), schedulerCard.dueAt.getTime());
    assert.equal(stored.lastReviewAt.getTime(), schedulerCard.lastReviewAt.getTime());
    for (const metric of ["stability", "stabilityFast", "difficulty", "scheduledDays", "learningStep"]) {
      assert.equal(stored.schedulerCard[metric], schedulerCard[metric], `${metric} should persist in the scheduler card`);
    }

    for (const event of savedEvents) {
      assert.equal(event.eventType, "review");
      assert.ok(event.schedulerReviewLog);
      assert.equal(event.schedulerModel, "FSRS-7");
      assert.equal(event.afterCard.dueAt.getTime(), event.dueAt.getTime());
      assert.equal(event.afterCard.scheduledDays, event.scheduledDays);
      assert.ok(event.beforeCard && event.afterCard);
    }

    // Mongo Mixed fields and JSON/offline responses can expose ISO strings;
    // the API's fetch normalizer must restore Date instances before FSRS uses them.
    const fetched = asSchedulerCard(JSON.parse(JSON.stringify(stored.schedulerCard)));
    assert.ok(fetched.dueAt instanceof Date);
    assert.ok(fetched.lastReviewAt instanceof Date);
    assert.equal(fetched.stability, stored.schedulerCard.stability);
    assert.equal(fetched.stabilityFast, stored.schedulerCard.stabilityFast);
    assert.equal(fetched.difficulty, stored.schedulerCard.difficulty);
    const previews = await previewRatings(fetched, fetched.dueAt);
    assert.deepEqual(previews.map((preview) => preview.rating), ["again", "hard", "good", "easy"]);
    assert.ok(previews.every((preview) => Number.isFinite(Date.parse(preview.dueAt))));
  });

  it("replays queued reviews by their review time and produces the same final metrics as online review", async () => {
    const initial = await createNewFsrsCard(startAt);
    const first = await reviewFsrsCard(initial, "good", startAt);
    const secondAt = first.card.dueAt;
    const second = await reviewFsrsCard(first.card, "hard", secondAt);
    const thirdAt = second.card.dueAt;
    const third = await reviewFsrsCard(second.card, "again", thirdAt);
    const fourthAt = third.card.dueAt;

    const replay = await replayReviewTimeline(initial, [
      { eventId: "event-4", rating: "easy", reviewedAt: fourthAt, incoming: true, source: { deviceId: "mock-device", sessionId: "mock-session" } },
      { eventId: "event-2", rating: "hard", reviewedAt: secondAt, incoming: true, source: { deviceId: "mock-device", sessionId: "mock-session" } },
      { eventId: "event-1", rating: "good", reviewedAt: startAt, incoming: true, source: { deviceId: "mock-device", sessionId: "mock-session" } },
      { eventId: "event-3", rating: "again", reviewedAt: thirdAt, incoming: true, source: { deviceId: "mock-device", sessionId: "mock-session" } },
    ]);
    const online = await reviewFsrsCard(third.card, "easy", fourthAt);

    assert.deepEqual(replay.transitions.map((transition) => transition.entry.eventId), ["event-1", "event-2", "event-3", "event-4"]);
    for (const metric of ["stability", "stabilityFast", "difficulty", "scheduledDays", "reps", "lapses", "state", "scheduleStatus"]) {
      assert.equal(replay.card[metric], online.card[metric], `${metric} should match after offline replay`);
    }
    assert.equal(replay.card.dueAt.getTime(), online.card.dueAt.getTime());
    assert.equal(replay.card.lastReviewAt.getTime(), online.card.lastReviewAt.getTime());
    assert.equal(replay.transitions.length, 4);
  });

  it("returns activity and rating metrics for the requested days, including zero-activity days", () => {
    const summary = summarizeDashboardActivity(
      ["2026-01-01", "2026-01-02", "2026-01-03"],
      [
        { _id: "2026-01-01", reviews: 3, again: 1, hard: 1, good: 1, easy: 0 },
        { _id: "2026-01-03", reviews: 2, again: 0, hard: 0, good: 1, easy: 1 },
      ],
    );

    assert.deepEqual(summary.activity, [
      { date: "2026-01-01", reviews: 3 },
      { date: "2026-01-02", reviews: 0 },
      { date: "2026-01-03", reviews: 2 },
    ]);
    assert.deepEqual(summary.ratings, { again: 1, hard: 1, good: 2, easy: 1 });
    assert.equal(summary.rangeReviews, 5);
    assert.equal(summary.studyDays, 2);
  });
});
