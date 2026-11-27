import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Eye, ImagePlus, Plus, RotateCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { NoteInput, NoteTypeKey, PublicUser } from "@recallio/contracts";
import { assessmentApi, learningApi } from "../api";
import { RichContent } from "../components/RichContent";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

const initialFields = { front: "", back: "", extra: "" };

export function CardEditorPage({ user }: { user: PublicUser }) {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("noteId");
  const [deckId, setDeckId] = useState("");
  const [noteType, setNoteType] = useState<NoteTypeKey>("basic");
  const [fields, setFields] = useState(initialFields);
  const [tagsText, setTagsText] = useState("");
  const [previewBack, setPreviewBack] = useState(false);
  const [message, setMessage] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const activeField = useRef<keyof typeof initialFields>("front");
  const fieldRefs = useRef<Partial<Record<keyof typeof initialFields, HTMLTextAreaElement | null>>>({});
  const selection = useRef({ start: 0, end: 0 });
  const cache = useQueryClient();
  const decks = useQuery({ queryKey: ["decks"], queryFn: learningApi.decks });
  const types = useQuery({ queryKey: ["note-types"], queryFn: learningApi.noteTypes });
  const existing = useQuery({ queryKey: ["note", editId], queryFn: () => learningApi.note(editId!), enabled: Boolean(editId) });
  const [loadedId, setLoadedId] = useState("");
  useEffect(() => {
    if (!existing.data || loadedId === editId) return;
    setLoadedId(editId ?? ""); setDeckId(existing.data.note.deckId); setNoteType(existing.data.note.noteType);
    setFields(existing.data.note.fields); setTagsText(existing.data.note.tags.join(", "));
  }, [existing.data, loadedId, editId]);
  const save = useMutation({ mutationFn: (input: NoteInput) => editId ? learningApi.updateNote(editId, { noteType: input.noteType, fields: input.fields, tags: input.tags }) : learningApi.createNote(input), onSuccess: async (result) => { setMessage(result.note.cardCount === 1 ? "Card saved." : `${result.note.cardCount} cards saved.`); await Promise.all([cache.invalidateQueries({ queryKey: ["cards"] }), cache.invalidateQueries({ queryKey: ["decks"] }), cache.invalidateQueries({ queryKey: ["notes"] }), cache.invalidateQueries({ queryKey: ["note", editId] }), cache.invalidateQueries({ queryKey: ["dashboard-statistics"] })]); } });
  const noteTypeInfo = types.data?.noteTypes.find((type) => type.id === noteType);
  const frontPreview = noteType === "basic_reversed" && previewBack ? fields.back : fields.front;
  const backPreview = noteType === "basic_reversed" && previewBack ? fields.front : fields.back;

  function update(field: keyof typeof fields, value: string) { setFields((current) => ({ ...current, [field]: value })); }
  function focusField(field: keyof typeof fields) {
    activeField.current = field;
    const element = fieldRefs.current[field];
    selection.current = { start: element?.selectionStart ?? fields[field].length, end: element?.selectionEnd ?? fields[field].length };
  }
  async function insertImage(file?: File) {
    if (!file) return;
    setImageBusy(true); setImageError("");
    try {
      const { asset } = await assessmentApi.uploadImage(file);
      const field = activeField.current;
      const html = `<img src="${asset.url}" alt="">`;
      const { start, end } = selection.current;
      const next = `${fields[field].slice(0, start)}${html}${fields[field].slice(end)}`;
      update(field, next);
      selection.current = { start: start + html.length, end: start + html.length };
      requestAnimationFrame(() => { const element = fieldRefs.current[field]; element?.focus(); element?.setSelectionRange(selection.current.start, selection.current.end); });
    } catch (error) { setImageError(error instanceof Error ? error.message : "Image upload failed."); }
    finally { setImageBusy(false); if (imageInput.current) imageInput.current.value = ""; }
  }
  function submit(andAnother: boolean) {
    setMessage("");
    save.mutate({ deckId, noteType, fields, tags: tagsText.split(",").map((tag) => tag.trim()).filter(Boolean) }, { onSuccess: () => { if (andAnother) { setFields(initialFields); setTagsText(""); setPreviewBack(false); } } });
  }

  return <WorkspaceLayout user={user} title="Add cards">
    <div className="editor-heading"><Link to="/decks" className="back-link"><ArrowLeft size={16} />Your decks</Link><div className="date-label">CARD EDITOR</div><h1>{editId ? "Edit a note" : "Add a note"}</h1><p>Write it in your own words. Clear prompts make better reviews.</p></div>
    <div className="editor-layout"><form className="editor-form" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
      <input ref={imageInput} className="visually-hidden-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => void insertImage(event.target.files?.[0])} />
      <div className="editor-row"><label className="editor-select-label">Deck<select value={deckId} onChange={(event) => setDeckId(event.target.value)} required><option value="">Choose a deck</option>{decks.data?.decks.map((deck) => <option value={deck.id} key={deck.id}>{deck.parentDeckId ? "↳ " : ""}{deck.name}</option>)}</select></label><label className="editor-select-label">Note type<select value={noteType} onChange={(event) => setNoteType(event.target.value as NoteTypeKey)}>{types.data?.noteTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label></div>
      <div className="editor-field"><div className="editor-field-head"><label htmlFor="question-field">{noteType === "cloze" ? "Text with cloze deletion" : "Front · question"}</label><button type="button" className="editor-image-action" onMouseDown={(event) => event.preventDefault()} onClick={() => { focusField("front"); imageInput.current?.click(); }} disabled={imageBusy}><ImagePlus size={14} />{imageBusy ? "Uploading…" : "Add image"}</button></div>{noteType === "cloze" && <small>Wrap the answer like <code>{"{{c1::answer}}"}</code>. Use c2, c3 to create additional cards.</small>}<textarea ref={(element) => { fieldRefs.current.front = element; }} id="question-field" value={fields.front} onFocus={() => focusField("front")} onSelect={() => focusField("front")} onChange={(event) => update("front", event.target.value)} placeholder={noteType === "cloze" ? "The heart has {{c1::four}} chambers." : "Write a clear question or prompt…"} rows={5} required /></div>
      {noteType !== "cloze" && <div className="editor-field"><div className="editor-field-head"><label htmlFor="answer-field">Back · answer</label><button type="button" className="editor-image-action" onMouseDown={(event) => event.preventDefault()} onClick={() => { focusField("back"); imageInput.current?.click(); }} disabled={imageBusy}><ImagePlus size={14} />{imageBusy ? "Uploading…" : "Add image"}</button></div><textarea ref={(element) => { fieldRefs.current.back = element; }} id="answer-field" value={fields.back} onFocus={() => focusField("back")} onSelect={() => focusField("back")} onChange={(event) => update("back", event.target.value)} placeholder="Add the answer…" rows={4} required /></div>}
      {noteType === "cloze" && <><div className="editor-field"><label htmlFor="extra-field">Extra information <span>OPTIONAL</span></label><textarea id="extra-field" value={fields.extra} onChange={(event) => update("extra", event.target.value)} placeholder="Add a helpful explanation…" rows={3} /></div><div className="editor-field"><label htmlFor="cloze-back">Additional back content <span>OPTIONAL</span></label><textarea id="cloze-back" value={fields.back} onChange={(event) => update("back", event.target.value)} placeholder="Supporting context shown after reveal…" rows={3} /></div></>}
      <div className="editor-field"><label htmlFor="tags-field">Tags <span>OPTIONAL · COMMA SEPARATED</span></label><input id="tags-field" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="e.g. anatomy, cardiology" /></div>
      {imageError && <p className="inline-error" role="alert">{imageError}</p>}{save.error && <p className="inline-error" role="alert">{save.error.message}</p>}{message && <p className="inline-success" role="status"><Check size={15} />{message}</p>}
      <div className="editor-actions"><button className="small-primary" type="submit" disabled={save.isPending || !deckId}>{save.isPending ? "Saving…" : editId ? "Update note" : "Save note"}</button>{!editId && <button className="secondary-button" type="button" disabled={save.isPending || !deckId} onClick={() => submit(true)}><Plus size={15} />Save and add another</button>}</div>
    </form>
    <aside className="preview-panel"><div className="preview-heading"><span><Eye size={15} /> PREVIEW</span>{noteType === "basic_reversed" && <button onClick={() => setPreviewBack(!previewBack)}><RotateCw size={13} />{previewBack ? "Reverse" : "Forward"}</button>}</div><div className="preview-card"><span className="preview-side">{previewBack ? "BACK" : "FRONT"}</span>{frontPreview ? <RichContent userId={user.id} className="preview-content" html={frontPreview} /> : <div className="preview-content"><span className="preview-placeholder">Your question will appear here.</span></div>}{previewBack && (backPreview ? <RichContent userId={user.id} className="preview-answer" html={backPreview} /> : <div className="preview-answer"><span className="preview-placeholder">Your answer will appear here.</span></div>)}<div className="preview-card-foot">{noteTypeInfo?.name ?? "Basic"}<span>Recallio</span></div></div><p className="preview-note">{noteTypeInfo?.description}</p>{noteType === "basic_reversed" && <p className="preview-note">This note creates two review cards, one in each direction.</p>}</aside></div>
  </WorkspaceLayout>;
}
