import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronDown, ChevronRight, Download, LoaderCircle, MoreHorizontal, Plus, Play } from "lucide-react";
import { Link } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { learningApi, mediaAssetUrl } from "../api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { cacheDeckList, cacheMediaImages, cacheOfflineDeck, getCachedDecks, getCachedMediaImage } from "../offline/database";

export function DecksPage({ user }: { user: PublicUser }) {
  const [name, setName] = useState("");
  const [parentDeckId, setParentDeckId] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const cache = useQueryClient();
  const decksQuery = useQuery({ queryKey: ["decks", user.id], queryFn: async () => {
    try {
      const result = await learningApi.decks();
      await cacheDeckList(user.id, result.decks);
      return result;
    } catch (error) {
      if (!(error instanceof TypeError) && navigator.onLine) throw error;
      return { decks: await getCachedDecks(user.id) };
    }
  } });
  const offlineDecks = useQuery({ queryKey: ["offline-decks", user.id], queryFn: () => getCachedDecks(user.id) });
  const download = useMutation({ mutationFn: async (deckId: string) => {
    const payload = await learningApi.downloadDeck(deckId);
    const mediaIds = [...new Set(payload.cards.flatMap((card) => [card.front, card.back]).flatMap((html) => [...html.matchAll(/\/api\/v1\/media\/([a-f\d]{24})/gi)].map((match) => match[1]!)))];
    const images = (await Promise.all(mediaIds.map(async (mediaId) => {
      if (await getCachedMediaImage(user.id, mediaId)) return null;
      const response = await fetch(mediaAssetUrl(mediaId), { credentials: "include" });
      if (!response.ok) throw new Error("A card image could not be saved for offline study.");
      const blob = await response.blob();
      if (!(response.headers.get("content-type") ?? blob.type).startsWith("image/")) throw new Error("A card attachment is not a supported image.");
      return { mediaId, blob, mimeType: response.headers.get("content-type") ?? blob.type };
    }))).filter((image): image is NonNullable<typeof image> => Boolean(image));
    await cacheMediaImages(user.id, images);
    await cacheOfflineDeck(user.id, payload.deck, payload.cards, payload.downloadedAt);
    return payload;
  }, onSuccess: async ({ deck, cardCount }) => {
    setMessage(`${deck.name}: ${cardCount} cards saved for offline study.`);
    await cache.invalidateQueries({ queryKey: ["offline-decks", user.id] });
    await cache.invalidateQueries({ queryKey: ["due-cards", user.id] });
  } });
  const create = useMutation({ mutationFn: learningApi.createDeck, onSuccess: () => { setName(""); setParentDeckId(""); setMessage("Deck created."); void cache.invalidateQueries({ queryKey: ["decks"] }); } });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => learningApi.renameDeck(id, name), onSuccess: () => void cache.invalidateQueries({ queryKey: ["decks"] }) });
  const remove = useMutation({ mutationFn: learningApi.deleteDeck, onSuccess: () => { setMessage("Empty deck deleted."); void cache.invalidateQueries({ queryKey: ["decks"] }); } });
  const decks = decksQuery.data?.decks ?? [];
  const offlineById = new Map((offlineDecks.data ?? []).filter((deck) => deck.offlineAvailable).map((deck) => [deck.id, deck]));
  const tree = useMemo(() => {
    const children = new Map<string | null, typeof decks>();
    for (const deck of decks) children.set(deck.parentDeckId, [...(children.get(deck.parentDeckId) ?? []), deck]);
    return children;
  }, [decks]);

  function DeckRows({ parentId, depth = 0 }: { parentId: string | null; depth?: number }) {
    return <>{(tree.get(parentId) ?? []).map((deck) => {
      const childCount = tree.get(deck.id)?.length ?? 0;
      return <div className="deck-node" key={deck.id}>
        <div className="deck-row" style={{ paddingLeft: 15 + depth * 24 }}>
          <button className="tree-toggle" aria-label={expanded.has(deck.id) ? "Collapse subdecks" : "Expand subdecks"} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(deck.id)) next.delete(deck.id); else next.add(deck.id); return next; })}>{childCount ? expanded.has(deck.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <span className="tree-spacer" />}</button>
          <BookOpen size={17} className="deck-row-icon" /><Link className="deck-name" to={`/browse?deckId=${deck.id}`}>{deck.name}</Link>
          <span className="deck-count">{deck.cardCount} cards</span><Link className="deck-study-link" to={`/study?deckId=${deck.id}`} aria-label={`Study ${deck.name}`}><Play size={13} />Study</Link>
          <button type="button" className={`deck-offline-button ${offlineById.has(deck.id) ? "is-downloaded" : ""}`} onClick={() => download.mutate(deck.id)} disabled={download.isPending || !navigator.onLine || deck.cardCount === 0} title={offlineById.has(deck.id) ? `Refresh offline copy (${offlineById.get(deck.id)?.offlineCardCount ?? 0} cards)` : "Save this deck for offline study"} aria-label={offlineById.has(deck.id) ? `Refresh offline copy of ${deck.name}` : `Download ${deck.name} for offline study`}>
            {download.isPending && download.variables === deck.id ? <LoaderCircle size={13} className="sync-spin" /> : offlineById.has(deck.id) ? <Check size={13} /> : <Download size={13} />}
            <span>{download.isPending && download.variables === deck.id ? "Saving" : offlineById.has(deck.id) ? "Saved" : "Offline"}</span>
          </button>
          <details className="deck-menu"><summary aria-label={`Actions for ${deck.name}`}><MoreHorizontal size={17} /></summary><div><button onClick={() => { const value = window.prompt("Deck name", deck.name)?.trim(); if (value && value !== deck.name) rename.mutate({ id: deck.id, name: value }); }}>Rename</button><button disabled={deck.cardCount > 0 || childCount > 0} onClick={() => { if (window.confirm(`Delete the empty deck “${deck.name}”?`)) remove.mutate(deck.id); }}>Delete empty deck</button></div></details>
        </div>
        {expanded.has(deck.id) && <DeckRows parentId={deck.id} depth={depth + 1} />}
      </div>;
    })}</>;
  }

  return <WorkspaceLayout user={user} title="Decks">
    <div className="page-heading-row"><div><div className="date-label">YOUR LIBRARY</div><h1>Your decks</h1><p>Organize your subjects and save a deck to study without a connection.</p></div><div className="heading-actions"><Link to="/import" className="secondary-button">Import Anki</Link><Link to="/add" className="primary-action"><Plus size={16} />Add cards</Link></div></div>
    <section className="create-deck-panel"><div className="panel-intro"><span className="action-icon"><Plus size={18} /></span><div><strong>Create a deck</strong><small>Use a subject or topic to organize your cards.</small></div></div><form className="create-deck-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); create.mutate({ name, parentDeckId: parentDeckId || null }); }}><input aria-label="Deck name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Anatomy" maxLength={80} required /><select aria-label="Parent deck" value={parentDeckId} onChange={(event) => setParentDeckId(event.target.value)}><option value="">Top-level deck</option>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select><button className="small-primary" disabled={create.isPending || !name.trim()}>{create.isPending ? "Creating…" : "Create deck"}</button></form>{message && <p className="inline-success" role="status">{message}</p>}{create.error && <p className="inline-error" role="alert">{create.error.message}</p>}</section>
    {message && <p className="inline-success" role="status">{message}</p>}{download.error && <p className="inline-error" role="alert">{download.error.message}</p>}
    <section className="deck-list-panel"><div className="list-panel-header"><div><strong>All decks</strong><small>{decks.length} {decks.length === 1 ? "deck" : "decks"}</small></div><span className="list-head-count">CARDS</span></div>{decksQuery.isLoading ? <p className="panel-empty">Loading your decks…</p> : decksQuery.error ? <p className="inline-error">Couldn’t load decks. Refresh to try again.</p> : decks.length ? <DeckRows parentId={null} /> : <div className="panel-empty"><BookOpen size={22} /><strong>Your deck list is ready.</strong><span>Create your first deck above to get started.</span></div>}</section>
  </WorkspaceLayout>;
}
