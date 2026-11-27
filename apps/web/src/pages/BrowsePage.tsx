import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Search, Trash2, Pencil } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { learningApi } from "../api";
import { RichContent } from "../components/RichContent";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

export function BrowsePage({ user }: { user: PublicUser }) {
  const [query, setQuery] = useState("");
  const [searchParams] = useSearchParams();
  const cache = useQueryClient();
  const remove = useMutation({ mutationFn: learningApi.deleteNote, onSuccess: async () => { await Promise.all([cache.invalidateQueries({ queryKey: ["cards"] }), cache.invalidateQueries({ queryKey: ["decks"] }), cache.invalidateQueries({ queryKey: ["dashboard-statistics"] })]); } });
  const cards = useQuery({ queryKey: ["cards", query], queryFn: () => learningApi.cards(query) });
  const decks = useQuery({ queryKey: ["decks"], queryFn: learningApi.decks });
  const deckId = searchParams.get("deckId");
  const filtered = (cards.data?.cards ?? []).filter((card) => !deckId || card.deckId === deckId);
  return <WorkspaceLayout user={user} title="Browse">
    <div className="page-heading-row"><div><div className="date-label">YOUR LIBRARY</div><h1>Card browser</h1><p>Find and review the material you’ve created.</p></div><Link to="/add" className="primary-action">Add cards</Link></div>
    <div className="browser-toolbar"><label className="browser-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions and answers" /></label><select aria-label="Filter by deck" value={deckId ?? ""} onChange={(event) => window.location.assign(event.target.value ? `/browse?deckId=${event.target.value}` : "/browse")}><option value="">All decks</option>{decks.data?.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></div>
    <section className="deck-list-panel browser-list"><div className="list-panel-header"><div><strong>Cards</strong><small>{filtered.length} shown · maximum 100</small></div></div>{cards.isLoading ? <p className="panel-empty">Loading cards…</p> : cards.error ? <p className="inline-error">Couldn’t load cards.</p> : filtered.length ? (() => { const seen = new Set<string>(); return filtered.map((card) => { const firstOfNote = !seen.has(card.noteId); seen.add(card.noteId); return <article className="browser-card" key={card.id}><span className="browser-card-type">{card.cardType}</span><div className="browser-card-copy"><RichContent userId={user.id} className="browser-card-front" html={card.front} /><RichContent userId={user.id} className="browser-card-back" html={card.back} /></div><span className="browser-deck"><BookOpen size={13} />{decks.data?.decks.find((deck) => deck.id === card.deckId)?.name ?? "Deck"}</span>{firstOfNote && <div className="browser-actions"><Link to={`/add?noteId=${card.noteId}`} aria-label="Edit note"><Pencil size={14} /></Link><button aria-label="Delete note and generated cards" onClick={() => { if (window.confirm("Delete this note and all cards generated from it?")) remove.mutate(card.noteId); }}><Trash2 size={14} /></button></div>}</article>; }); })() : <div className="panel-empty"><BookOpen size={22} /><strong>No cards found yet.</strong><span><Link to="/add">Add a note</Link> or <Link to="/import">import an Anki deck</Link>.</span></div>}</section>
  </WorkspaceLayout>;
}
