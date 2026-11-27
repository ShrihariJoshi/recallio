import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, RotateCcw, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { previewRatings, reviewFsrsCard } from "@recallio/scheduler";
import { learningApi } from "../api";
import { RichContent } from "../components/RichContent";
import { SyncStatus } from "../components/SyncStatus";
import { getCachedStudyCards, hasOfflineStudyData, localCardKey, localDb, queueOfflineReview, queueOfflineUndo, replaceCachedStudyCards, saveSyncedReview, saveSyncedUndo, type CachedStudyCard, type LocalReviewEvent } from "../offline/database";
import { getDeviceId } from "../offline/sync";

type RecallRating = "again" | "hard" | "good" | "easy";
type LastReview = { eventId: string; cardId: string; position: number };
const ratingOrder: RecallRating[] = ["again", "hard", "good", "easy"];
const ratingCopy: Record<RecallRating, { label: string; hint: string }> = {
  again: { label: "Again", hint: "Couldn’t recall" },
  hard: { label: "Hard", hint: "With effort" },
  good: { label: "Good", hint: "Remembered" },
  easy: { label: "Easy", hint: "Came right away" },
};

export function StudyPage({ user }: { user: PublicUser }) {
  const [searchParams] = useSearchParams();
  const deckId = searchParams.get("deckId") ?? undefined;
  const cache = useQueryClient();
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [lastReview, setLastReview] = useState<LastReview | null>(null);
  const [actionError, setActionError] = useState("");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [sessionId] = useState(() => crypto.randomUUID());
  const eventIds = useRef(new Map<string, string>());
  const due = useQuery({ queryKey: ["due-cards", user.id, deckId], queryFn: async () => {
    try {
      const data = await learningApi.dueCards(deckId);
      await replaceCachedStudyCards(user.id, deckId, data.cards);
      const cards = data.cards.map((card) => ({ ...card, schedulerCard: { ...card.schedulerCard, dueAt: new Date(card.schedulerCard.dueAt), lastReviewAt: card.schedulerCard.lastReviewAt == null ? null : new Date(card.schedulerCard.lastReviewAt) } }));
      return { ...data, cards, offline: false };
    } catch (error) {
      if (!(error instanceof TypeError) && navigator.onLine) throw error;
      const cached = await getCachedStudyCards(user.id, deckId);
      return { cards: cached, dueCount: cached.length, checkedAt: new Date().toISOString(), offline: true, offlineAvailable: await hasOfflineStudyData(user.id, deckId) };
    }
  }, staleTime: 0 });
  const rateMutation = useMutation({ mutationFn: learningApi.rateCard });
  const undoMutation = useMutation({ mutationFn: ({ targetEventId, eventId }: { targetEventId: string; eventId: string }) => learningApi.undoReview(targetEventId, { eventId, deviceId: getDeviceId(), sessionId }) });
  const cards = due.data?.cards ?? [];
  const current = cards[position];
  const done = !due.isLoading && cards.length > 0 && position >= cards.length;

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);

  const rate = useCallback(async (rating: RecallRating) => {
    if (!current || !revealed || rateMutation.isPending || due.isFetching) return;
    setActionError("");
    try {
      const idempotencyKey = `review:${current.id}:${rating}`;
      const eventId = eventIds.current.get(idempotencyKey) ?? crypto.randomUUID();
      eventIds.current.set(idempotencyKey, eventId);
      const reviewedAt = new Date().toISOString();
      const cardKey = localCardKey(user.id, current.id);
      const cachedCard = await localDb.cards.get(cardKey) ?? { ...current, key: cardKey, userId: user.id, cachedAt: reviewedAt } satisfies CachedStudyCard;
      const reviewed = await reviewFsrsCard(cachedCard.schedulerCard, rating, new Date(reviewedAt));
      const event: LocalReviewEvent = { eventId, userId: user.id, cardId: current.id, rating, reviewedAt, sessionId, beforeCard: cachedCard.schedulerCard, afterCard: reviewed.card, status: "pending" };
      const nextCard: CachedStudyCard = { ...cachedCard, dueAt: reviewed.card.dueAt.toISOString(), schedulerCard: reviewed.card, previews: await previewRatings(reviewed.card, new Date(reviewedAt)), cachedAt: reviewedAt };
      if (!isOnline) {
        await queueOfflineReview(event, cachedCard, getDeviceId(), nextCard);
      } else {
        try {
          const result = await rateMutation.mutateAsync({ cardId: current.id, rating, eventId, deviceId: getDeviceId(), sessionId, reviewedAt });
          const authoritativeCard = { ...nextCard, dueAt: result.schedulerCard.dueAt.toISOString(), schedulerCard: { ...result.schedulerCard, dueAt: new Date(result.schedulerCard.dueAt), lastReviewAt: result.schedulerCard.lastReviewAt == null ? null : new Date(result.schedulerCard.lastReviewAt) } };
          await saveSyncedReview({ ...event, afterCard: authoritativeCard.schedulerCard, status: "synced", syncedAt: new Date().toISOString() }, cachedCard, authoritativeCard);
        } catch (error) {
          if (!(error instanceof TypeError) && isOnline) throw error;
          await queueOfflineReview(event, cachedCard, getDeviceId(), nextCard);
        }
      }
      eventIds.current.delete(idempotencyKey);
      void cache.invalidateQueries({ queryKey: ["dashboard-statistics"] });
      setLastReview({ eventId, cardId: current.id, position });
      setPosition((value) => value + 1);
      setRevealed(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn’t save that review. Try again.");
    }
  }, [cache, current, due.isFetching, isOnline, position, rateMutation, revealed, sessionId, user.id]);

  const undo = useCallback(async () => {
    if (!lastReview || undoMutation.isPending) return;
    setActionError("");
    try {
      const idempotencyKey = `undo:${lastReview.eventId}`;
      const eventId = eventIds.current.get(idempotencyKey) ?? crypto.randomUUID();
      eventIds.current.set(idempotencyKey, eventId);
      const cardKey = localCardKey(user.id, lastReview.cardId);
      const cachedCard = await localDb.cards.get(cardKey) ?? { ...cards[lastReview.position], key: cardKey, userId: user.id, cachedAt: new Date().toISOString() };
      if (!isOnline) {
        await queueOfflineUndo({ userId: user.id, targetEventId: lastReview.eventId, eventId, sessionId, deviceId: getDeviceId(), card: cachedCard });
      } else {
        try {
          await undoMutation.mutateAsync({ targetEventId: lastReview.eventId, eventId });
          await saveSyncedUndo({ userId: user.id, targetEventId: lastReview.eventId, card: cachedCard });
        } catch (error) {
          if (!(error instanceof TypeError) && isOnline) throw error;
          await queueOfflineUndo({ userId: user.id, targetEventId: lastReview.eventId, eventId, sessionId, deviceId: getDeviceId(), card: cachedCard });
        }
      }
      eventIds.current.delete(idempotencyKey);
      void cache.invalidateQueries({ queryKey: ["dashboard-statistics"] });
      setPosition(lastReview.position);
      setLastReview(null);
      setRevealed(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn’t undo that review. Try again.");
    }
  }, [cache, cards, isOnline, lastReview, sessionId, undoMutation, user.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "Space" && current && !revealed && !done) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && current) {
        const rating = ratingOrder[Number(event.key) - 1];
        if (rating) { event.preventDefault(); void rate(rating); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, done, rate, revealed]);

  async function startAnotherPass() {
    setPosition(0);
    setRevealed(false);
    setLastReview(null);
    setActionError("");
    await due.refetch();
  }

  return <main className="study-shell">
    <header className="study-topbar">
      <Link className="study-back" to={deckId ? "/decks" : "/"} aria-label="Exit study session"><ArrowLeft size={17} /><span>Exit session</span></Link>
      <Link className="brand study-brand" to="/"><span className="brand-mark">r</span><span>recallio</span></Link>
      <div className="study-top-actions">{lastReview && <button className="study-undo" onClick={() => void undo()} disabled={undoMutation.isPending}><RotateCcw size={14} />Undo</button>}<SyncStatus userId={user.id} /><span className="study-user">{user.name.split(" ")[0]}</span></div>
    </header>

    <section className="study-main">
      {due.isLoading ? <div className="study-message"><span className="study-loading" /><p>Finding cards that are due…</p></div>
        : due.error ? <div className="study-message"><p>We couldn’t load your cards.</p><button className="primary-action" onClick={() => void due.refetch()}>Try again</button></div>
        : !cards.length ? <div className="study-message"><span className="study-message-icon"><Sparkles size={19} /></span><div className="date-label">{due.data?.offline ? "OFFLINE LIBRARY" : "A QUIET MOMENT"}</div><h1>{due.data?.offline && !due.data.offlineAvailable ? "No cards saved for offline study." : "You’re all caught up."}</h1><p>{due.data?.offline && !due.data.offlineAvailable ? "Connect and use the Offline button on a deck to save its cards on this device." : "No cards are due right now. Come back when it’s time for your next recall."}</p><Link to={deckId ? "/decks" : "/"} className="primary-action">Back to your space <ArrowLeft size={15} /></Link></div>
        : done ? <div className="study-message"><span className="study-message-icon completed"><Check size={20} /></span><div className="date-label">SESSION COMPLETE</div><h1>That’s a good session.</h1><p>You reviewed {position} {position === 1 ? "card" : "cards"}. Your next reviews are now scheduled.</p><div className="study-completion-actions"><button className="primary-action" onClick={() => void startAnotherPass()}>Check again <RotateCcw size={14} /></button><Link to={deckId ? "/decks" : "/"} className="secondary-button">Finish for now</Link></div></div>
        : current && <>
          <div className="study-progress-row"><span>{deckId ? "DECK REVIEW" : "DAILY REVIEW"}</span><span>{position + 1}<i />{cards.length}</span></div>
          <div className="study-progress-track" role="progressbar" aria-label="Study session progress" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={position}><span style={{ width: `${(position / cards.length) * 100}%` }} /></div>
          <article key={current.id} className={`study-card ${revealed ? "is-revealed" : ""}`}>
            <div className="study-card-head"><span>{revealed ? "ANSWER" : "QUESTION"}</span><span>{current.cardType.replaceAll("_", " ")}</span></div>
            <div className="study-card-flip"><div className={`study-card-inner ${revealed ? "is-revealed" : ""}`}>
              <section className="study-card-face study-card-front" aria-hidden={revealed}>
                <div className="study-card-content"><RichContent userId={user.id} className="study-prompt" html={current.front || "(No question text)"} /></div>
                <button className="reveal-button" tabIndex={revealed ? -1 : 0} onClick={() => setRevealed(true)} disabled={due.isFetching || revealed}>Show answer <span>Space</span></button>
              </section>
              <section className="study-card-face study-card-back" aria-hidden={!revealed}>
                <div className="study-card-content">
                  <RichContent userId={user.id} className="study-prompt" html={current.front || "(No question text)"} />
                  <div className="study-answer"><span className="study-answer-label">ANSWER</span><RichContent userId={user.id} className="study-answer-content" html={current.back || "(No answer text)"} /></div>
                </div>
                <div className="study-rating-block"><div className="rating-prompt">How well did you remember?</div><div className="rating-grid">{ratingOrder.map((rating, index) => {
                  const preview = current.previews.find((item) => item.rating === rating);
                  return <button key={rating} className={`rating-button rating-${rating}`} tabIndex={revealed ? 0 : -1} onClick={() => void rate(rating)} disabled={!revealed || rateMutation.isPending || due.isFetching}>
                    <span className="rating-topline"><strong>{ratingCopy[rating].label}</strong><kbd>{index + 1}</kbd></span><span className="rating-hint">{ratingCopy[rating].hint}</span><span className="rating-interval">{preview?.intervalLabel ?? "—"}</span>
                  </button>;
                })}</div></div>
              </section>
            </div></div>
          </article>
          <div className="study-bottom-line">{actionError ? <span className="study-error" role="alert">{actionError}</span> : <span>Your recall shapes the next review.</span>}<span>{position} completed</span></div>
        </>}
    </section>
    <footer className="study-footer"><span>Take your time. Recall works best without rushing.</span><span>LEARN · RECALL · REPEAT</span></footer>
  </main>;
}
