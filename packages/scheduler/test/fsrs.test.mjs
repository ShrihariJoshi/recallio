import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DefaultScheduler } from "ts-fsrs";
import {
  createNewFsrsCard,
  fsrsMetadata,
  previewRatings,
  reviewFsrsCard,
} from "../dist/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const startAt = new Date("2026-01-01T12:00:00.000Z");

describe("Recallio FSRS-7 scheduler", () => {
  it("creates new cards and previews all ratings in increasing interval order", async () => {
    const card = await createNewFsrsCard(startAt);
    const previews = await previewRatings(card, startAt);

    assert.equal(fsrsMetadata.modelVersion, "FSRS-7");
    assert.equal(fsrsMetadata.desiredRetention, 0.9);
    assert.equal(card.scheduleStatus, "new");
    assert.deepEqual(previews.map(({ rating }) => rating), ["again", "hard", "good", "easy"]);

    const intervals = previews.map(({ dueAt }) => Date.parse(dueAt) - startAt.getTime());
    assert.ok(intervals.every((interval) => interval > 0));
    assert.ok(intervals.every((interval, index) => index === 0 || interval > intervals[index - 1]));
  });

  it("strengthens a card after successful recall and records a lapse after Again", async () => {
    let card = await createNewFsrsCard(startAt);
    let now = startAt;
    const initialStability = card.stability;

    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const result = await reviewFsrsCard(card, "good", now);
      card = result.card;
      now = card.dueAt;

      assert.equal(card.reps, repetition);
      assert.equal(card.lapses, 0);
      assert.equal(card.scheduleStatus, "review");
      assert.ok(card.stability > initialStability);
    }

    const matureStability = card.stability;
    const lapse = await reviewFsrsCard(card, "again", now);
    assert.equal(lapse.card.lapses, 1);
    assert.equal(lapse.card.scheduleStatus, "learning");
    assert.ok(lapse.card.stability < matureStability);
    assert.ok(lapse.card.dueAt.getTime() > now.getTime());
    assert.ok(lapse.card.dueAt.getTime() < now.getTime() + DAY_MS);
  });

  it("maintains about 90% simulated recall with fewer reviews than daily review", async (t) => {
    const scheduler = await DefaultScheduler({ version: "FSRS-7", desiredRetention: fsrsMetadata.desiredRetention });
    let seed = 0x51f15e;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };

    const simulatedCards = 200;
    const horizon = new Date(startAt.getTime() + 365 * DAY_MS);
    let reviews = 0;
    let successfulRecalls = 0;

    for (let index = 0; index < simulatedCards; index += 1) {
      let card = await createNewFsrsCard(startAt);
      card = (await reviewFsrsCard(card, "good", startAt)).card;
      let safetyCount = 0;

      while (card.dueAt <= horizon && safetyCount < 100) {
        safetyCount += 1;
        const reviewedAt = card.dueAt;
        const elapsedDays = (reviewedAt.getTime() - card.lastReviewAt.getTime()) / DAY_MS;
        const predictedRecall = scheduler.model.forgettingCurve(card, elapsedDays);
        const recalled = random() < predictedRecall;

        reviews += 1;
        if (recalled) successfulRecalls += 1;
        card = (await reviewFsrsCard(card, recalled ? "good" : "again", reviewedAt)).card;
      }
    }

    const simulatedRetention = successfulRecalls / reviews;
    const dailyReviewBaseline = simulatedCards * 365;

    assert.ok(simulatedRetention >= 0.85 && simulatedRetention <= 0.95, `simulated retention was ${(simulatedRetention * 100).toFixed(1)}%`);
    assert.ok(reviews < dailyReviewBaseline / 5, `FSRS scheduled ${reviews} reviews versus ${dailyReviewBaseline} for daily review`);
    t.diagnostic(`Model-based simulation: ${(simulatedRetention * 100).toFixed(1)}% recall across ${reviews.toLocaleString()} reviews; daily baseline ${dailyReviewBaseline.toLocaleString()}.`);
  });
});
