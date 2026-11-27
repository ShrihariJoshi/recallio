import { assessmentApi, learningApi } from "../api";
import { localDb, type LocalAssessmentAttempt } from "./database";

const activeSyncs = new Map<string, Promise<void>>();

export function getDeviceId(): string {
  const key = "recallio:device-id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export async function syncPendingReviews(userId: string): Promise<void> {
  if (!navigator.onLine) return;
  const existing = activeSyncs.get(userId);
  if (existing) return existing;
  const task = (async () => {
    window.dispatchEvent(new Event("recallio-sync-start"));
    try {
      const entries = await localDb.syncQueue.where("userId").equals(userId).sortBy("createdAt");
      for (let index = 0; index < entries.length;) {
        const entry = entries[index];
        try {
          if (entry.operation === "review" && entry.cardId && entry.rating) {
            const batch = [] as typeof entries;
            for (const candidate of entries.slice(index, index + 100)) {
              if (candidate.operation !== "review" || !candidate.cardId || !candidate.rating) break;
              batch.push(candidate);
            }
            const result = await learningApi.syncReviews(batch.map((item) => ({ eventId: item.eventId, cardId: item.cardId!, rating: item.rating!, deviceId: item.deviceId, sessionId: item.sessionId, reviewedAt: item.reviewedAt })));
            const synced = new Set(result.syncedEventIds);
            if (batch.some((item) => !synced.has(item.eventId))) throw new Error("The server did not confirm every queued review.");
            const syncedAt = new Date().toISOString();
            await localDb.transaction("rw", localDb.syncQueue, localDb.reviewEvents, async () => {
              for (const item of batch) {
                await localDb.syncQueue.delete(item.eventId);
                await localDb.reviewEvents.update(item.eventId, { status: "synced", syncedAt, error: undefined });
              }
            });
            index += batch.length;
            continue;
          } else if (entry.operation === "undo" && entry.targetEventId) {
            await learningApi.undoReview(entry.targetEventId, { eventId: entry.eventId, deviceId: entry.deviceId, sessionId: entry.sessionId });
          } else {
            throw new Error("This queued action is incomplete and could not be synced.");
          }
          await localDb.transaction("rw", localDb.syncQueue, localDb.reviewEvents, async () => {
            await localDb.syncQueue.delete(entry.eventId);
            if (entry.operation === "review") await localDb.reviewEvents.update(entry.eventId, { status: "synced", syncedAt: new Date().toISOString(), error: undefined });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not sync this review.";
          await localDb.syncQueue.update(entry.eventId, { status: "failed", error: message });
          if (entry.operation === "review") await localDb.reviewEvents.update(entry.eventId, { status: "failed", error: message });
          break;
        }
        index += 1;
      }
    } finally {
      window.dispatchEvent(new Event("recallio-sync-end"));
      window.dispatchEvent(new Event("recallio-sync-change"));
    }
  })();
  activeSyncs.set(userId, task);
  try { await task; } finally { activeSyncs.delete(userId); }
}

export async function syncPendingAssessments(userId: string): Promise<void> {
  if (!navigator.onLine) return;
  const attempts = await localDb.assessmentAttempts.where("userId").equals(userId).and((item) => item.syncStatus === "pending" || item.syncStatus === "failed").toArray();
  for (const attempt of attempts) {
    try {
      const result = await assessmentApi.syncOfflineAttempt({
        ...(attempt.serverAttemptId ? { attemptId: attempt.serverAttemptId } : {}),
        clientAttemptId: attempt.clientAttemptId,
        assessmentId: attempt.assessmentId,
        version: attempt.version,
        startedAt: attempt.startedAt,
        submitted: attempt.status === "submitted",
        answers: Object.entries(attempt.answers).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId })),
      });
      const next: LocalAssessmentAttempt = {
        ...attempt,
        serverAttemptId: result.attempt.id,
        status: result.attempt.status,
        syncStatus: "synced",
        score: result.attempt.score,
        maxScore: result.attempt.maxScore,
        correctCount: result.attempt.correctCount,
        ...(result.attempt.status === "submitted" ? { questions: result.attempt.questions } : {}),
        syncError: undefined,
      };
      await localDb.assessmentAttempts.put(next);
    } catch (error) {
      await localDb.assessmentAttempts.update(attempt.key, { syncStatus: "failed", syncError: error instanceof Error ? error.message : "Could not sync this assessment." });
    }
  }
  window.dispatchEvent(new Event("recallio-assessment-sync-change"));
}
