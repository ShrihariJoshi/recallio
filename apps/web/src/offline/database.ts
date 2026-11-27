import Dexie, { type Table } from "dexie";
import { previewRatings, type FsrsCard } from "@recallio/scheduler";

export type RecallRating = "again" | "hard" | "good" | "easy";
export interface CachedStudyCard {
  key: string;
  userId: string;
  id: string;
  noteId: string;
  deckId: string;
  cardType: string;
  front: string;
  back: string;
  dueAt: string;
  schedulerCard: FsrsCard;
  previews: Array<{ rating: RecallRating; dueAt: string; intervalLabel: string }>;
  cachedAt: string;
}
export interface LocalReviewEvent {
  eventId: string;
  userId: string;
  cardId: string;
  rating: RecallRating;
  reviewedAt: string;
  sessionId: string;
  beforeCard: FsrsCard;
  afterCard: FsrsCard;
  undoneAt?: string;
  status: "pending" | "synced" | "failed";
  error?: string;
  syncedAt?: string;
}
export interface SyncQueueEntry {
  eventId: string;
  userId: string;
  operation: "review" | "undo";
  cardId?: string;
  rating?: RecallRating;
  targetEventId?: string;
  sessionId: string;
  deviceId: string;
  reviewedAt: string;
  createdAt: string;
  status: "pending" | "failed";
  error?: string;
}
export interface CachedDeckInfo {
  id: string;
  name: string;
  parentDeckId: string | null;
  cardCount: number;
  offlineAvailable?: boolean;
  offlineCardCount?: number;
  downloadedAt?: string;
}

export interface OfflineAssessmentQuestion {
  id: string;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  imageAssetId: string | null;
  subject: string;
  topic: string;
  correctOptionId?: string;
  explanation?: string;
  points?: number;
}
export interface CachedAssessmentPackage {
  key: string;
  userId: string;
  assessmentId: string;
  title: string;
  description: string;
  version: number;
  durationSeconds: number;
  questions: OfflineAssessmentQuestion[];
  downloadedAt: string;
}
export interface CachedAssessmentImage {
  key: string;
  userId: string;
  mediaId: string;
  blob: Blob;
  mimeType: string;
}
export interface CachedMediaImage { key: string; userId: string; mediaId: string; blob: Blob; mimeType: string; cachedAt: string }
export interface LocalAssessmentAttempt {
  key: string;
  userId: string;
  attemptId: string;
  clientAttemptId: string;
  assessmentId: string;
  title: string;
  version: number;
  durationSeconds: number;
  questions: OfflineAssessmentQuestion[];
  startedAt: string;
  deadlineAt: string;
  answers: Record<string, string>;
  status: "in_progress" | "submitted";
  syncStatus: "synced" | "pending" | "failed";
  submittedAt: string | null;
  serverAttemptId?: string;
  score?: number | null;
  maxScore?: number;
  correctCount?: number | null;
  syncError?: string;
}

class RecallioDatabase extends Dexie {
  decks!: Table<{ key: string; userId: string; value: unknown }, string>;
  notes!: Table<{ key: string; userId: string; value: unknown }, string>;
  cards!: Table<CachedStudyCard, string>;
  cardStates!: Table<{ key: string; userId: string; cardId: string; dueAt: string; value: unknown }, string>;
  reviewEvents!: Table<LocalReviewEvent, string>;
  syncQueue!: Table<SyncQueueEntry, string>;
  syncMetadata!: Table<{ key: string; userId: string; value: unknown }, string>;
  assessmentPackages!: Table<CachedAssessmentPackage, string>;
  assessmentImages!: Table<CachedAssessmentImage, string>;
  assessmentAttempts!: Table<LocalAssessmentAttempt, string>;
  mediaImages!: Table<CachedMediaImage, string>;

  constructor() {
    super("recallio-local");
    this.version(1).stores({
      decks: "key,userId",
      notes: "key,userId",
      cards: "key,userId,id,deckId,[userId+deckId]",
      cardStates: "key,userId,cardId,dueAt",
      reviewEvents: "eventId,userId,cardId,reviewedAt,status",
      syncQueue: "eventId,userId,operation,createdAt,status",
      syncMetadata: "key,userId",
    });
    this.version(2).stores({
      decks: "key,userId",
      notes: "key,userId",
      cards: "key,userId,id,deckId,[userId+deckId]",
      cardStates: "key,userId,cardId,dueAt",
      reviewEvents: "eventId,userId,cardId,reviewedAt,status",
      syncQueue: "eventId,userId,operation,createdAt,status",
      syncMetadata: "key,userId",
      assessmentPackages: "key,userId,assessmentId,version",
      assessmentImages: "key,userId,mediaId",
      assessmentAttempts: "key,userId,assessmentId,status,syncStatus",
    });
    this.version(3).stores({
      decks: "key,userId",
      notes: "key,userId",
      cards: "key,userId,id,deckId,[userId+deckId]",
      cardStates: "key,userId,cardId,dueAt",
      reviewEvents: "eventId,userId,cardId,reviewedAt,status",
      syncQueue: "eventId,userId,operation,createdAt,status",
      syncMetadata: "key,userId",
      assessmentPackages: "key,userId,assessmentId,version",
      assessmentImages: "key,userId,mediaId",
      assessmentAttempts: "key,userId,assessmentId,status,syncStatus",
      mediaImages: "key,userId,mediaId",
    });
  }
}

export const localDb = new RecallioDatabase();
export const localCardKey = (userId: string, cardId: string) => `${userId}:${cardId}`;
export const localAssessmentKey = (userId: string, assessmentId: string) => `${userId}:${assessmentId}`;
export const localAssessmentImageKey = (userId: string, mediaId: string) => `${userId}:${mediaId}`;

export async function cacheAssessmentPackage(input: Omit<CachedAssessmentPackage, "key" | "userId" | "downloadedAt"> & { userId: string }, images: Array<{ mediaId: string; blob: Blob; mimeType: string }>): Promise<void> {
  const key = localAssessmentKey(input.userId, input.assessmentId);
  const downloadedAt = new Date().toISOString();
  await localDb.transaction("rw", localDb.assessmentPackages, localDb.assessmentImages, async () => {
    await localDb.assessmentPackages.put({ ...input, key, downloadedAt });
    for (const image of images) await localDb.assessmentImages.put({ ...image, key: localAssessmentImageKey(input.userId, image.mediaId), userId: input.userId });
  });
}

export async function getCachedAssessment(userId: string, assessmentId: string): Promise<CachedAssessmentPackage | undefined> {
  return localDb.assessmentPackages.get(localAssessmentKey(userId, assessmentId));
}

export async function getCachedAssessmentImage(userId: string, mediaId: string): Promise<CachedAssessmentImage | undefined> {
  return localDb.assessmentImages.get(localAssessmentImageKey(userId, mediaId));
}

export async function getCachedAssessments(userId: string): Promise<CachedAssessmentPackage[]> {
  return localDb.assessmentPackages.where("userId").equals(userId).toArray();
}

export async function getLocalAssessmentAttempt(userId: string, attemptId: string): Promise<LocalAssessmentAttempt | undefined> {
  return localDb.assessmentAttempts.get(localAssessmentKey(userId, attemptId));
}

export async function saveLocalAssessmentAttempt(attempt: Omit<LocalAssessmentAttempt, "key">): Promise<void> {
  await localDb.assessmentAttempts.put({ ...attempt, key: localAssessmentKey(attempt.userId, attempt.attemptId) });
  window.dispatchEvent(new Event("recallio-assessment-sync-change"));
}

export async function getCachedMediaImage(userId: string, mediaId: string): Promise<CachedMediaImage | undefined> {
  return localDb.mediaImages.get(`${userId}:${mediaId}`);
}

export async function cacheMediaImages(userId: string, images: Array<{ mediaId: string; blob: Blob; mimeType: string }>): Promise<void> {
  if (!images.length) return;
  const cachedAt = new Date().toISOString();
  await localDb.mediaImages.bulkPut(images.map((image) => ({ ...image, userId, key: `${userId}:${image.mediaId}`, cachedAt })));
}

function normalizeSchedulerCard(card: FsrsCard): FsrsCard {
  return { ...card, dueAt: new Date(card.dueAt), lastReviewAt: card.lastReviewAt == null ? null : new Date(card.lastReviewAt) };
}

export async function cacheDeckList(userId: string, decks: CachedDeckInfo[]): Promise<void> {
  const existing = await localDb.decks.where("userId").equals(userId).toArray();
  const prior = new Map(existing.map((deck) => [deck.key, deck.value as CachedDeckInfo]));
  await localDb.transaction("rw", localDb.decks, async () => {
    const current = await localDb.decks.where("userId").equals(userId).toArray();
    const nextKeys = new Set(decks.map((deck) => `${userId}:${deck.id}`));
    await localDb.decks.bulkDelete(current.filter((deck) => !nextKeys.has(deck.key) && !(deck.value as CachedDeckInfo).offlineAvailable).map((deck) => deck.key));
    await localDb.decks.bulkPut(decks.map((deck) => {
      const old = prior.get(`${userId}:${deck.id}`);
      return { key: `${userId}:${deck.id}`, userId, value: { ...deck, ...(old?.offlineAvailable ? { offlineAvailable: true, offlineCardCount: old.offlineCardCount, downloadedAt: old.downloadedAt } : {}) } };
    }));
  });
}

export async function getCachedDecks(userId: string): Promise<CachedDeckInfo[]> {
  const records = await localDb.decks.where("userId").equals(userId).toArray();
  return records.map((record) => record.value as CachedDeckInfo).sort((a, b) => a.name.localeCompare(b.name));
}

export async function hasOfflineStudyData(userId: string, deckId?: string): Promise<boolean> {
  const decks = await getCachedDecks(userId);
  if (decks.some((deck) => deck.offlineAvailable && (!deckId || deck.id === deckId))) return true;
  const cards = await localDb.cards.where("userId").equals(userId).toArray();
  return cards.some((card) => !deckId || card.deckId === deckId);
}

export async function cacheOfflineDeck(userId: string, deck: Omit<CachedDeckInfo, "offlineAvailable" | "offlineCardCount">, cards: Array<Omit<CachedStudyCard, "key" | "userId" | "cachedAt">>, downloadedAt: string): Promise<void> {
  await localDb.transaction("rw", localDb.decks, localDb.cards, localDb.cardStates, localDb.syncMetadata, async () => {
    const previous = await localDb.cards.where("userId").equals(userId).toArray();
    const replaced = previous.filter((card) => card.deckId === deck.id);
    await localDb.cards.bulkDelete(replaced.map((card) => card.key));
    await localDb.cardStates.bulkDelete(replaced.map((card) => card.key));
    const normalized = cards.map((card) => ({ ...card, schedulerCard: normalizeSchedulerCard(card.schedulerCard), key: localCardKey(userId, card.id), userId, cachedAt: downloadedAt }));
    await localDb.cards.bulkPut(normalized);
    await localDb.cardStates.bulkPut(normalized.map((card) => ({ key: card.key, userId, cardId: card.id, dueAt: card.dueAt, value: card.schedulerCard })));
    await localDb.decks.put({ key: `${userId}:${deck.id}`, userId, value: { ...deck, offlineAvailable: true, offlineCardCount: normalized.length, downloadedAt } satisfies CachedDeckInfo });
    await localDb.syncMetadata.put({ key: `${userId}:deck:${deck.id}:download`, userId, value: { downloadedAt, cardCount: normalized.length } });
  });
}

export async function replaceCachedStudyCards(userId: string, deckId: string | undefined, cards: Array<Omit<CachedStudyCard, "key" | "userId" | "cachedAt">>): Promise<void> {
  const cachedAt = new Date().toISOString();
  const filter = deckId ? (card: CachedStudyCard) => card.deckId === deckId : () => true;
  await localDb.transaction("rw", localDb.cards, localDb.cardStates, localDb.syncMetadata, localDb.decks, async () => {
    const previous = await localDb.cards.where("userId").equals(userId).toArray();
    const downloadedDeckRecords = await localDb.decks.where("userId").equals(userId).toArray();
    const offlineDeckIds = new Set(downloadedDeckRecords.filter((record) => (record.value as CachedDeckInfo).offlineAvailable).map((record) => (record.value as CachedDeckInfo).id));
    const replaced = previous.filter((card) => filter(card) && !offlineDeckIds.has(card.deckId));
    await localDb.cards.bulkDelete(replaced.map((card) => card.key));
    await localDb.cardStates.bulkDelete(replaced.map((card) => card.key));
    const normalized = cards.map((card) => ({ ...card, schedulerCard: normalizeSchedulerCard(card.schedulerCard), key: localCardKey(userId, card.id), userId, cachedAt }));
    await localDb.cards.bulkPut(normalized);
    await localDb.cardStates.bulkPut(normalized.map((card) => ({ key: card.key, userId, cardId: card.id, dueAt: card.dueAt, value: card.schedulerCard })));
    await localDb.syncMetadata.put({ key: `${userId}:last-card-download`, userId, value: cachedAt });
  });
}

export async function getCachedStudyCards(userId: string, deckId?: string): Promise<CachedStudyCard[]> {
  const cards = await localDb.cards.where("userId").equals(userId).toArray();
  const now = new Date();
  return Promise.all(cards.filter((card) => (!deckId || card.deckId === deckId) && new Date(card.dueAt) <= now).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map(async (card) => ({
    ...card,
    schedulerCard: normalizeSchedulerCard(card.schedulerCard),
    previews: await previewRatings(normalizeSchedulerCard(card.schedulerCard), now),
  })));
}

export async function queueOfflineReview(event: LocalReviewEvent, card: CachedStudyCard, deviceId: string, nextCard: CachedStudyCard): Promise<void> {
  await localDb.transaction("rw", localDb.reviewEvents, localDb.syncQueue, localDb.cards, localDb.cardStates, async () => {
    await localDb.reviewEvents.put(event);
    await localDb.syncQueue.put({ eventId: event.eventId, userId: event.userId, operation: "review", cardId: event.cardId, rating: event.rating, sessionId: event.sessionId, deviceId, reviewedAt: event.reviewedAt, createdAt: new Date().toISOString(), status: "pending" });
    await localDb.cards.put(nextCard);
    await localDb.cardStates.put({ key: card.key, userId: card.userId, cardId: card.id, dueAt: nextCard.dueAt, value: nextCard.schedulerCard });
  });
  window.dispatchEvent(new Event("recallio-sync-change"));
}

export async function saveSyncedReview(event: LocalReviewEvent, card: CachedStudyCard, nextCard: CachedStudyCard): Promise<void> {
  await localDb.transaction("rw", localDb.reviewEvents, localDb.cards, localDb.cardStates, async () => {
    await localDb.reviewEvents.put({ ...event, status: "synced", syncedAt: new Date().toISOString() });
    await localDb.cards.put(nextCard);
    await localDb.cardStates.put({ key: card.key, userId: card.userId, cardId: card.id, dueAt: nextCard.dueAt, value: nextCard.schedulerCard });
  });
}

function cardRestoredFromEvent(event: LocalReviewEvent, card: CachedStudyCard, now: Date): CachedStudyCard {
  const schedulerCard = normalizeSchedulerCard(event.beforeCard);
  return { ...card, schedulerCard, dueAt: schedulerCard.dueAt.toISOString(), previews: [], cachedAt: now.toISOString() };
}

export async function queueOfflineUndo(input: { userId: string; targetEventId: string; eventId: string; sessionId: string; deviceId: string; card: CachedStudyCard }): Promise<void> {
  const now = new Date();
  const sourceEvent = await localDb.reviewEvents.get(input.targetEventId);
  if (!sourceEvent || sourceEvent.userId !== input.userId) throw new Error("The review state for this card is no longer available on this device.");
  const priorQueueEntry = await localDb.syncQueue.get(input.targetEventId);
  const createdAt = new Date(Math.max(now.getTime(), priorQueueEntry ? new Date(priorQueueEntry.createdAt).getTime() + 1 : now.getTime())).toISOString();
  const restored = cardRestoredFromEvent(sourceEvent, input.card, now);
  restored.previews = await previewRatings(restored.schedulerCard, now);
  await localDb.transaction("rw", localDb.reviewEvents, localDb.syncQueue, localDb.cards, localDb.cardStates, async () => {
    const event = await localDb.reviewEvents.get(input.targetEventId);
    if (!event || event.userId !== input.userId) throw new Error("The review state for this card is no longer available on this device.");
    await localDb.syncQueue.put({ eventId: input.eventId, userId: input.userId, operation: "undo", targetEventId: input.targetEventId, sessionId: input.sessionId, deviceId: input.deviceId, reviewedAt: now.toISOString(), createdAt, status: "pending" });
    await localDb.reviewEvents.update(input.targetEventId, { undoneAt: now.toISOString() });
    await localDb.cards.put(restored);
    await localDb.cardStates.put({ key: input.card.key, userId: input.userId, cardId: input.card.id, dueAt: restored.dueAt, value: restored.schedulerCard });
  });
  window.dispatchEvent(new Event("recallio-sync-change"));
}

export async function saveSyncedUndo(input: { userId: string; targetEventId: string; card: CachedStudyCard }): Promise<void> {
  const now = new Date();
  const sourceEvent = await localDb.reviewEvents.get(input.targetEventId);
  if (!sourceEvent || sourceEvent.userId !== input.userId) return;
  const restored = cardRestoredFromEvent(sourceEvent, input.card, now);
  restored.previews = await previewRatings(restored.schedulerCard, now);
  await localDb.transaction("rw", localDb.reviewEvents, localDb.cards, localDb.cardStates, async () => {
    const event = await localDb.reviewEvents.get(input.targetEventId);
    if (!event || event.userId !== input.userId) return;
    await localDb.reviewEvents.update(input.targetEventId, { undoneAt: now.toISOString() });
    await localDb.cards.put(restored);
    await localDb.cardStates.put({ key: input.card.key, userId: input.userId, cardId: input.card.id, dueAt: restored.dueAt, value: restored.schedulerCard });
  });
}

export async function pendingSyncCount(userId: string): Promise<number> {
  return localDb.syncQueue.where("userId").equals(userId).count();
}
