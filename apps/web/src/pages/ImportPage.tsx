import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FileArchive, ShieldCheck, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { learningApi } from "../api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

type ImportPreview = Awaited<ReturnType<typeof learningApi.uploadApkg>>["import"];

export function ImportPage({ user }: { user: PublicUser }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<{ importedDecks: number; importedNotes: number; updatedNotes: number; importedCards: number; warningCount: number } | null>(null);
  const [error, setError] = useState("");
  const cache = useQueryClient(); const navigate = useNavigate();
  const analyze = useMutation({ mutationFn: learningApi.uploadApkg, onSuccess: ({ import: result }) => setPreview(result) });
  const confirm = useMutation({ mutationFn: () => learningApi.confirmImport(preview!.id), onSuccess: async ({ summary: result }) => { setSummary(result); setPreview(null); await Promise.all([cache.invalidateQueries({ queryKey: ["decks"] }), cache.invalidateQueries({ queryKey: ["cards"] }), cache.invalidateQueries({ queryKey: ["dashboard-statistics"] })]); } });

  async function selectFile(next: File | null) {
    setError(""); setPreview(null); setSummary(null); setFile(next);
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".apkg")) { setError("Choose an Anki .apkg file."); setFile(null); return; }
    if (next.size > 35 * 1024 * 1024) { setError("This file is larger than the 35 MB upload limit."); setFile(null); return; }
    try { const result = await analyze.mutateAsync(next); setPreview(result.import); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "We couldn’t read this package."); }
  }

  async function discard() {
    if (!preview) return;
    await learningApi.discardImport(preview.id).catch(() => undefined); setPreview(null); setFile(null);
  }

  return <WorkspaceLayout user={user} title="Import from Anki">
    <div className="editor-heading"><Link to="/decks" className="back-link"><ArrowLeft size={16} />Your decks</Link><div className="date-label">BRING YOUR CARDS</div><h1>Import an Anki deck</h1><p>Review what’s inside before adding it to Recallio.</p></div>
    {!preview && !summary && <section className="import-dropzone"><span className="import-icon-large"><Upload size={20} /></span><h2>{analyze.isPending ? "Reading your package…" : "Choose an .apkg file"}</h2><p>Up to 35 MB. Your deck is analyzed before anything is added.</p><label className="small-primary import-file-button">{analyze.isPending ? "Analyzing…" : "Choose file"}<input type="file" accept=".apkg,application/octet-stream" disabled={analyze.isPending} onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} /></label>{file && <span className="selected-file"><FileArchive size={15} />{file.name}</span>}<div className="import-security-note"><ShieldCheck size={15} />Package contents are treated as untrusted. Templates are never executed.</div>{error && <p className="inline-error" role="alert">{error}</p>}</section>}
    {preview && <section className="import-preview"><div className="preview-header"><div><div className="date-label">IMPORT PREVIEW</div><h2>{preview.filename}</h2><p>Format detected: {preview.format}</p></div><span className="preview-ready"><Check size={14} />Ready to review</span></div>
      {preview.preview.duplicatePackage && <div className="import-alert">This package was imported before. Confirming again updates its matching notes and cards with the current importer, including their image links, without adding duplicate notes.</div>}
      <div className="import-stat-grid"><div><strong>{preview.preview.deckCount}</strong><span>Decks</span></div><div><strong>{preview.preview.noteCount}</strong><span>Notes</span></div><div><strong>{preview.preview.cardCount}</strong><span>Cards</span></div><div><strong>{preview.preview.tagCount}</strong><span>Tags</span></div></div>
      {preview.preview.decks.length > 0 && <div className="preview-decks"><strong>Decks included</strong>{preview.preview.decks.map((deck) => <span key={deck}>{deck}</span>)}</div>}
      <div className="compatibility-report"><strong>Compatibility report</strong><div><span>Review history detected</span><b>{preview.report.schedulingRecords.toLocaleString()} entries</b></div><div><span>Media references</span><b>{preview.report.mediaFiles} files · {Math.round(preview.report.mediaBytes / 1024)} KB</b></div>{preview.report.unsupportedNoteTypes.length > 0 && <div className="report-warning"><span>Note types requiring a simplified card view</span><b>{preview.report.unsupportedNoteTypes.slice(0, 5).join(", ")}</b></div>}{preview.report.missingMedia.length > 0 && <div className="report-warning"><span>Missing media references</span><b>{preview.report.missingMedia.length}</b></div>}{preview.report.warnings.map((warning) => <div className="report-warning" key={warning}><span>Import note</span><b>{warning}</b></div>)}</div>
      <div className="import-actions"><button className="small-primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "Importing…" : "Confirm import"}</button><button className="secondary-button" onClick={() => void discard()}>Cancel import</button></div>{confirm.error && <p className="inline-error" role="alert">{confirm.error.message}</p>}
    </section>}
    {summary && <section className="import-success"><span><Check size={22} /></span><div className="date-label">IMPORT COMPLETE</div><h2>Your Anki deck is in Recallio.</h2><p>{summary.importedDecks} decks · {summary.importedNotes} notes · {summary.importedCards} cards imported{summary.updatedNotes ? ` · ${summary.updatedNotes} notes updated` : ""}</p><div><button className="small-primary" onClick={() => navigate("/browse")}>Browse cards</button><Link to="/decks" className="secondary-button">View decks</Link></div></section>}
  </WorkspaceLayout>;
}
