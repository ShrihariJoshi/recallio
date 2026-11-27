import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, CopyPlus, Download, FileUp, ImagePlus, Pencil, Plus, Timer, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { assessmentApi, mediaAssetUrl, type AssessmentAttemptData, type AssessmentQuestionData } from "../api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { RichContent } from "../components/RichContent";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import { cacheAssessmentPackage, getCachedAssessment, getCachedAssessments, getLocalAssessmentAttempt, localDb, saveLocalAssessmentAttempt, type LocalAssessmentAttempt } from "../offline/database";
import { syncPendingAssessments } from "../offline/sync";

type AssessmentItem = { id: string; title: string; description: string; durationSeconds: number; questionIds: string[]; questionCount: number; version: number; status: "draft" | "published"; downloaded?: boolean };
const optionIds = ["a", "b", "c", "d"];
const emptyOptions = optionIds.map((id) => ({ id, text: "" }));
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)} min`;
const remainingTime = (deadline: string) => Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
function displayAttempt(item: LocalAssessmentAttempt): AssessmentAttemptData {
  return { id: item.attemptId, assessmentId: item.assessmentId, title: item.title, version: item.version, status: item.status, startedAt: item.startedAt, deadlineAt: item.deadlineAt, durationSeconds: item.durationSeconds, submittedAt: item.submittedAt, score: item.score ?? null, maxScore: item.maxScore ?? item.questions.length, correctCount: item.correctCount ?? null, questions: item.questions, answers: item.answers };
}

export function AssessmentsPage({ user }: { user: PublicUser }) {
  const { attemptId } = useParams();
  const [questions, setQuestions] = useState<AssessmentQuestionData[]>([]);
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; title: string; version: number; status: "in_progress" | "submitted"; startedAt: string; score: number | null; maxScore: number; correctCount: number | null }>>([]);
  const [attempt, setAttempt] = useState<AssessmentAttemptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<AssessmentQuestionData | null>(null);
  const [editingAssessment, setEditingAssessment] = useState<AssessmentItem | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const cachedPackages = await getCachedAssessments(user.id).catch(() => []);
    const cachedVersions = new Map(cachedPackages.map((item) => [item.assessmentId, item.version]));
    try {
      const [q, a, h] = await Promise.all([assessmentApi.questions(), assessmentApi.assessments(), assessmentApi.attempts()]);
      setQuestions(q.questions); setAssessments(a.assessments.map((item) => ({ ...item, downloaded: cachedVersions.get(item.id) === item.version }))); setHistory(h.attempts);
    } catch (e) {
      if (cachedPackages.length) {
        setAssessments(cachedPackages.map((item) => ({ id: item.assessmentId, title: item.title, description: item.description, durationSeconds: item.durationSeconds, questionIds: item.questions.map((q) => q.id), questionCount: item.questions.length, version: item.version, status: "published", downloaded: true })));
        setQuestions([]);
        const localAttempts = await localDb.assessmentAttempts.where("userId").equals(user.id).toArray();
        setHistory(localAttempts.map((item) => ({ id: item.attemptId, title: item.title, version: item.version, status: item.status, startedAt: item.startedAt, score: item.score ?? null, maxScore: item.maxScore ?? 0, correctCount: item.correctCount ?? null })));
      } else setError(e instanceof Error ? e.message : "Could not load assessments.");
    }
    finally { setLoading(false); }
  }, [user.id]);

  const loadAttempt = useCallback(async (id: string) => {
    setLoading(true); setError("");
    try {
      const local = await getLocalAssessmentAttempt(user.id, id);
      if (local) { setAttempt(displayAttempt(local)); setSecondsLeft(remainingTime(local.deadlineAt)); if (navigator.onLine && local.syncStatus !== "synced") void syncPendingAssessments(user.id); return; }
      const result = await assessmentApi.attempt(id);
      const a = result.attempt;
      const localAttempt: Omit<LocalAssessmentAttempt, "key"> = { userId: user.id, attemptId: a.id, clientAttemptId: crypto.randomUUID(), assessmentId: a.assessmentId, title: a.title, version: a.version, durationSeconds: Math.max(0, Math.floor((new Date(a.deadlineAt).getTime() - new Date(a.startedAt).getTime()) / 1000)), questions: a.questions, startedAt: a.startedAt, deadlineAt: a.deadlineAt, answers: a.answers, status: a.status, syncStatus: "synced", submittedAt: a.submittedAt ?? null, score: a.score, maxScore: a.maxScore, correctCount: a.correctCount };
      await saveLocalAssessmentAttempt(localAttempt); setAttempt(a); setSecondsLeft(remainingTime(a.deadlineAt));
    }
    catch (e) {
      const local = await getLocalAssessmentAttempt(user.id, id);
      if (local) { setAttempt(displayAttempt(local)); setSecondsLeft(remainingTime(local.deadlineAt)); }
      else setError(e instanceof Error ? e.message : "Could not load this attempt.");
    }
    finally { setLoading(false); }
  }, [user.id]);

  useEffect(() => { if (attemptId) void loadAttempt(attemptId); else { setAttempt(null); void load(); } }, [attemptId, load, loadAttempt]);

  useEffect(() => {
    if (!attemptId) return;
    const updateFromLocal = async () => { const local = await getLocalAssessmentAttempt(user.id, attemptId); if (local) setAttempt(displayAttempt(local)); };
    window.addEventListener("recallio-assessment-sync-change", updateFromLocal);
    return () => window.removeEventListener("recallio-assessment-sync-change", updateFromLocal);
  }, [attemptId, user.id]);

  const submit = useCallback(async () => {
    if (!attempt || attempt.status === "submitted" || busy) return;
    setBusy(true); setError("");
    try {
      const local = await getLocalAssessmentAttempt(user.id, attempt.id);
      if (!local) throw new Error("This attempt is not saved on this device yet.");
      const pending = { ...local, status: "submitted" as const, submittedAt: new Date().toISOString(), syncStatus: "pending" as const };
      await saveLocalAssessmentAttempt(pending);
      setAttempt(displayAttempt(pending));
      if (navigator.onLine) {
        if (local.serverAttemptId) {
          await assessmentApi.submitAttempt(local.serverAttemptId);
          const latest = await assessmentApi.attempt(local.serverAttemptId);
          const saved = { ...pending, status: latest.attempt.status, submittedAt: latest.attempt.submittedAt ?? pending.submittedAt, questions: latest.attempt.questions, answers: latest.attempt.answers, score: latest.attempt.score, maxScore: latest.attempt.maxScore, correctCount: latest.attempt.correctCount, syncStatus: "synced" as const };
          await saveLocalAssessmentAttempt(saved); setAttempt(displayAttempt(saved));
        } else { await syncPendingAssessments(user.id); const synced = await getLocalAssessmentAttempt(user.id, attempt.id); if (synced) setAttempt(displayAttempt(synced)); }
      } else setNotice("Submitted on this device. Your score will appear after it syncs.");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not submit the assessment."); }
    finally { setBusy(false); }
  }, [attempt, busy, user.id]);

  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      const left = remainingTime(attempt.deadlineAt); setSecondsLeft(left);
      if (left === 0) void submit();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, submit]);

  async function downloadTest(item: AssessmentItem) {
    setDownloadingId(item.id); setError("");
    try {
      const { assessment } = await assessmentApi.downloadAssessment(item.id);
      const mediaIds = [...new Set(assessment.questions.map((q) => q.imageAssetId).filter((id): id is string => Boolean(id)))];
      const images = await Promise.all(mediaIds.map(async (mediaId) => {
        const response = await fetch(mediaAssetUrl(mediaId), { credentials: "include" });
        if (!response.ok) throw new Error("One of the test images could not be downloaded.");
        const blob = await response.blob();
        return { mediaId, blob, mimeType: response.headers.get("content-type") ?? blob.type };
      }));
      await cacheAssessmentPackage({ userId: user.id, assessmentId: assessment.id, title: assessment.title, description: assessment.description, version: assessment.version, durationSeconds: assessment.durationSeconds, questions: assessment.questions }, images);
      setAssessments((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, downloaded: true, version: assessment.version } : entry));
      setNotice("Test and images are saved on this device for offline use.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not download the test."); }
    finally { setDownloadingId(""); }
  }

  function downloadQuestionTemplate() {
    const template = [{
      prompt: "Which structure carries oxygenated blood from the lungs to the heart?",
      options: [{ id: "a", text: "Pulmonary artery" }, { id: "b", text: "Pulmonary vein" }, { id: "c", text: "Aorta" }, { id: "d", text: "Vena cava" }],
      correctOptionId: "b",
      explanation: "Pulmonary veins return oxygenated blood to the left atrium.",
      subject: "Physiology",
      topic: "Cardiovascular system",
      tags: ["example"],
    }];
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "recallio-question-template.json"; link.click(); URL.revokeObjectURL(url);
  }

  async function importQuestionFile(file?: File) {
    if (!file) return;
    setBulkImporting(true); setError("");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const batch = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown })?.questions;
      if (!Array.isArray(batch) || !batch.length || batch.length > 300) throw new Error("Choose a JSON array containing 1–300 questions.");
      const { questions: imported } = await assessmentApi.bulkCreateQuestions(batch as Parameters<typeof assessmentApi.bulkCreateQuestions>[0]);
      setQuestions((previous) => [...imported, ...previous]);
      setNotice(`${imported.length} questions imported. Create a test and select the questions you need.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not import these questions."); }
    finally { setBulkImporting(false); }
  }

  async function start(item: AssessmentItem) {
    setBusy(true); setError("");
    try {
      if (navigator.onLine) {
        try {
          const { attempt: created } = await assessmentApi.startAttempt(item.id);
          const clientAttemptId = crypto.randomUUID();
          await saveLocalAssessmentAttempt({ userId: user.id, attemptId: created.id, serverAttemptId: created.id, clientAttemptId, assessmentId: created.assessmentId, title: created.title, version: created.version, durationSeconds: created.durationSeconds, questions: created.questions, startedAt: created.startedAt, deadlineAt: created.deadlineAt, answers: {}, status: "in_progress", syncStatus: "synced", submittedAt: null, maxScore: created.maxScore });
          navigate(`/assessment/${created.id}`); return;
        } catch (onlineError) {
          const cached = await getCachedAssessment(user.id, item.id);
          if (!cached) throw onlineError;
          setNotice("Starting the downloaded test offline. Your score will sync when connection returns.");
          const startedAt = new Date().toISOString(); const clientAttemptId = crypto.randomUUID(); const id = `offline-${clientAttemptId}`;
          await saveLocalAssessmentAttempt({ userId: user.id, attemptId: id, clientAttemptId, assessmentId: cached.assessmentId, title: cached.title, version: cached.version, durationSeconds: cached.durationSeconds, questions: cached.questions, startedAt, deadlineAt: new Date(Date.now() + cached.durationSeconds * 1000).toISOString(), answers: {}, status: "in_progress", syncStatus: "pending", submittedAt: null, maxScore: cached.questions.length });
          navigate(`/assessment/${id}`); return;
        }
      }
      const cached = await getCachedAssessment(user.id, item.id);
      if (!cached) throw new Error("Download this test while online before starting it offline.");
      const startedAt = new Date().toISOString(); const clientAttemptId = crypto.randomUUID(); const id = `offline-${clientAttemptId}`;
      await saveLocalAssessmentAttempt({ userId: user.id, attemptId: id, clientAttemptId, assessmentId: cached.assessmentId, title: cached.title, version: cached.version, durationSeconds: cached.durationSeconds, questions: cached.questions, startedAt, deadlineAt: new Date(Date.now() + cached.durationSeconds * 1000).toISOString(), answers: {}, status: "in_progress", syncStatus: "pending", submittedAt: null, maxScore: cached.questions.length });
      navigate(`/assessment/${id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start this assessment."); }
    finally { setBusy(false); }
  }

  async function saveAnswer(questionId: string, optionId: string) {
    if (!attempt) return;
    setAttempt((current) => current ? { ...current, answers: { ...current.answers, [questionId]: optionId } } : current);
    setBusy(true); setError("");
    try {
      const local = await getLocalAssessmentAttempt(user.id, attempt.id);
      if (!local) throw new Error("This attempt is not saved on this device yet.");
      const pending = { ...local, answers: { ...local.answers, [questionId]: optionId }, syncStatus: "pending" as const };
      await saveLocalAssessmentAttempt(pending); setAttempt(displayAttempt(pending));
      if (navigator.onLine && local.serverAttemptId) {
        try {
          await assessmentApi.saveAnswer(local.serverAttemptId, questionId, optionId);
          const saved = { ...pending, syncStatus: "synced" as const };
          await saveLocalAssessmentAttempt(saved); setAttempt(displayAttempt(saved));
        } catch { setNotice("Answer saved on this device. It will sync when the connection returns."); }
      } else if (navigator.onLine) void syncPendingAssessments(user.id);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Answer could not be saved on this device."); }
    finally { setBusy(false); }
  }

  if (attemptId) return <WorkspaceLayout user={user} title="Assessment">
    <div className="assessment-page">
      <Link className="back-link" to="/assessments"><ArrowLeft size={14} />Assessments</Link>
      {loading ? <section className="assessment-panel panel-empty">Loading assessment…</section> : attempt && <>
        <div className="assessment-run-head"><div><span className="eyebrow">{attempt.status === "submitted" ? "RESULT REVIEW" : `VERSION ${attempt.version}`}</span><h1>{attempt.title}</h1><p>{attempt.questions.length} questions · {attempt.status === "submitted" ? "Submitted" : "Timed assessment"}</p></div>{attempt.status === "submitted" ? <div className="score-chip"><strong>{attempt.score}/{attempt.maxScore}</strong><small>{attempt.correctCount} correct</small></div> : <div className={`assessment-clock ${secondsLeft < 60 ? "clock-urgent" : ""}`}><Timer size={16} /><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</strong></div>}</div>
        {attempt.questions.map((q, index) => <AssessmentQuestionCard key={q.id} userId={user.id} question={q} index={index} selected={attempt.answers[q.id]} submitted={attempt.status === "submitted"} onSelect={(id) => void saveAnswer(q.id, id)} />)}
        {error && <p className="inline-error">{error}</p>}
        {attempt.status === "submitted" ? <div className="assessment-submit-row"><Link className="secondary-button" to="/assessments">Back to assessments</Link><span>Review explanations and correct answers above.</span></div> : <div className="assessment-submit-row"><span>{navigator.onLine ? "Answers save on this device as you select them." : "Offline · answers are saved on this device and will sync when you reconnect."}</span><button className="small-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Submit assessment"}<ArrowRight size={14} /></button></div>}
      </>}
    </div>
  </WorkspaceLayout>;

  return <WorkspaceLayout user={user} title="Assessments">
    <div className="assessment-page">
      <div className="page-heading-row assessment-heading"><div><span className="eyebrow">EXAM PREPARATION</span><h1>Assessments</h1><p>Build question sets, then take them in a timed, versioned test.</p></div><div className="assessment-actions"><button className="secondary-button" onClick={() => { setQuestionOpen((v) => !v); setQuizOpen(false); }}><Plus size={14} />Question</button><button className="small-primary" disabled={!questions.length} onClick={() => { setQuizOpen((v) => !v); setQuestionOpen(false); }}>Create test<ArrowRight size={14} /></button></div></div>
      {error && <p className="inline-error">{error}</p>}{notice && <p className="inline-success"><CheckCircle2 size={14} />{notice}</p>}
      {(questionOpen || editingQuestion) && <QuestionForm key={editingQuestion?.id ?? "new"} userId={user.id} initial={editingQuestion ?? undefined} onCancel={() => { setQuestionOpen(false); setEditingQuestion(null); }} onSave={async (input) => { const { question } = editingQuestion ? await assessmentApi.updateQuestion(editingQuestion.id, input) : await assessmentApi.createQuestion(input); setQuestions((prev) => editingQuestion ? prev.map((q) => q.id === question.id ? question : q) : [question, ...prev]); setQuestionOpen(false); setEditingQuestion(null); setNotice(editingQuestion ? "Question updated. Published versions remain unchanged." : "Question saved in your bank."); window.setTimeout(() => setNotice(""), 3500); }} />}
      {(quizOpen || editingAssessment) && <AssessmentForm key={editingAssessment?.id ?? "new"} questions={questions} initial={editingAssessment ?? undefined} onCancel={() => { setQuizOpen(false); setEditingAssessment(null); }} onSave={async (input, id, publish) => { setCreating(true); setError(""); try { const { assessment } = id ? (await assessmentApi.updateAssessmentDraft(id, input)) : await assessmentApi.createAssessment(input); if (publish) await assessmentApi.publishAssessment(assessment.id); setQuizOpen(false); setEditingAssessment(null); setNotice(publish ? "Test published as a new immutable version." : "Draft saved."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save this assessment."); } finally { setCreating(false); } }} creating={creating} />}
      <div className="assessment-columns">
        <section className="assessment-panel"><div className="assessment-section-heading"><div><strong>Tests and drafts</strong><small>Published versions stay frozen; drafts are editable.</small></div><span>{assessments.length}</span></div>
          {loading ? <div className="panel-empty">Loading…</div> : assessments.length ? <div className="assessment-list">{assessments.map((item) => <article className="assessment-list-row" key={item.id}><div className="assessment-symbol">{item.status === "published" ? <Clock3 size={17} /> : <Pencil size={16} />}</div><div className="assessment-copy"><strong>{item.title}</strong><small>{item.questionCount} questions · {formatDuration(item.durationSeconds)} · {item.status === "published" ? `v${item.version}` : "Draft"}</small>{item.description && <p>{item.description.replace(/<[^>]*>/g, " ")}</p>}</div><div className="assessment-row-actions">{item.status === "draft" ? <button className="row-action" aria-label={`Edit ${item.title}`} onClick={() => { setEditingAssessment(item); setQuizOpen(false); }}><Pencil size={14} /></button> : <><button className="row-action" aria-label={`Create a new draft from ${item.title}`} onClick={async () => { try { const { assessment } = await assessmentApi.forkAssessmentDraft(item.id); await load(); const draft = (await assessmentApi.assessments()).assessments.find((a) => a.id === assessment.id); if (draft) setEditingAssessment(draft); } catch (e) { setError(e instanceof Error ? e.message : "Could not create a draft."); } }}><CopyPlus size={14} /></button><button className="row-action" disabled={downloadingId === item.id || item.downloaded} onClick={() => void downloadTest(item)} aria-label={item.downloaded ? `${item.title} downloaded` : `Download ${item.title} for offline use`} title={item.downloaded ? "Downloaded for offline use" : "Download for offline use"}>{item.downloaded ? <CheckCircle2 size={14} /> : <Download size={14} />}</button><button className="row-action" disabled={busy} onClick={() => void start(item)} aria-label={`Start ${item.title}`}><ArrowRight size={16} /></button></>}</div></article>)}</div> : <div className="panel-empty"><Clock3 size={22} /><strong>No tests yet</strong><span>Add questions to your bank, then save a draft or publish a test.</span></div>}
        </section>
        <section className="assessment-panel"><div className="assessment-section-heading"><div><strong>Question bank</strong><small>Import up to 300 questions from a JSON file</small></div><span>{questions.length}</span></div><div className="bulk-question-tools"><button className="secondary-button" type="button" onClick={downloadQuestionTemplate}><Download size={14} />Template</button><label className="secondary-button"><FileUp size={14} />{bulkImporting ? "Importing…" : "Import JSON"}<input type="file" accept="application/json,.json" disabled={bulkImporting} onChange={(event) => { void importQuestionFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
          {loading ? <div className="panel-empty">Loading…</div> : questions.length ? <div className="question-bank-list">{questions.slice(0, 8).map((q) => <article className="bank-question" key={q.id}>{q.imageAssetId && <AuthenticatedImage userId={user.id} mediaId={q.imageAssetId} alt="Question illustration" />}<div><RichContent html={q.prompt} /><small>{q.subject || "Uncategorized"}{q.topic ? ` · ${q.topic}` : ""}</small></div><span>{q.options.length} options</span><div className="assessment-row-actions"><button className="row-action" aria-label="Edit question" onClick={() => { setEditingQuestion(q); setQuestionOpen(false); }}><Pencil size={14} /></button><button className="row-action" aria-label="Delete question" onClick={async () => { if (!window.confirm("Remove this question from your bank? Published tests keep their saved version.")) return; try { await assessmentApi.deleteQuestion(q.id); setQuestions((prev) => prev.filter((item) => item.id !== q.id)); setNotice("Question removed from the bank."); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete this question."); } }}><Trash2 size={14} /></button></div></article>)}</div> : <div className="panel-empty"><Plus size={22} /><strong>Your bank is empty</strong><span>Add text or image questions to build timed tests.</span></div>}
        </section>
      </div>
      {history.length > 0 && <section className="assessment-panel assessment-history"><div className="assessment-section-heading"><div><strong>Recent attempts</strong><small>Pick up an active attempt or review a submitted result.</small></div><span>{history.length}</span></div><div className="assessment-list">{history.map((item) => { const percentage = item.score == null || item.maxScore <= 0 ? null : Math.round((item.score / item.maxScore) * 100); return <article className="assessment-list-row" key={item.id}><div className="assessment-symbol">{item.status === "submitted" ? <CheckCircle2 size={17} /> : <Timer size={17} />}</div><div className="assessment-copy"><strong>{item.title}</strong><small>Version {item.version} · {new Date(item.startedAt).toLocaleDateString()}</small></div>{item.status === "submitted" && <span className="attempt-score" aria-label={percentage == null ? "Score unavailable" : `Score ${percentage}%`}>{percentage == null ? "—" : `${percentage}%`}</span>}<button className="row-action" onClick={() => navigate(`/assessment/${item.id}`)} aria-label={item.status === "submitted" ? `Review ${item.title}` : `Continue ${item.title}`}><ArrowRight size={16} /></button></article>; })}</div></section>}
    </div>
  </WorkspaceLayout>;
}

function QuestionForm({ userId, initial, onCancel, onSave }: { userId: string; initial?: AssessmentQuestionData; onCancel: () => void; onSave: (input: Parameters<typeof assessmentApi.createQuestion>[0]) => Promise<void> }) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? ""); const [options, setOptions] = useState(optionIds.map((id, index) => initial?.options[index] ?? { id, text: "" })); const [correct, setCorrect] = useState(initial?.correctOptionId ?? "a"); const [explanation, setExplanation] = useState(initial?.explanation ?? ""); const [subject, setSubject] = useState(initial?.subject ?? ""); const [topic, setTopic] = useState(initial?.topic ?? ""); const [imageAssetId, setImageAssetId] = useState<string | null>(initial?.imageAssetId ?? null); const [imagePreview, setImagePreview] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  async function upload(file?: File) { if (!file) return; setBusy(true); setError(""); try { const { asset } = await assessmentApi.uploadImage(file); setImageAssetId(asset.id); setImagePreview(URL.createObjectURL(file)); } catch (e) { setError(e instanceof Error ? e.message : "Image upload failed."); } finally { setBusy(false); } }
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await onSave({ prompt, options: options.filter((o) => o.text.trim()), correctOptionId: correct, explanation, imageAssetId, subject, topic, tags: initial?.tags ?? [] }); } catch (e) { setError(e instanceof Error ? e.message : "Question could not be saved."); } finally { setBusy(false); } }
  return <form className="assessment-form-panel" onSubmit={(e) => void submit(e)}><div className="assessment-form-head"><div><strong>{initial ? "Edit question" : "New question"}</strong><small>Keep question prompts focused and easy to scan.</small></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close"><X size={16} /></button></div>
    <label className="assessment-field">Question<textarea required maxLength={12000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Write the question prompt" /></label>
    <div className="assessment-option-grid">{options.map((option, i) => <label className="assessment-field" key={option.id}><span>Option {i + 1}{correct === option.id && <em>Correct answer</em>}</span><div className="answer-edit"><input required={i < 2} maxLength={500} value={option.text} onChange={(e) => setOptions(options.map((item) => item.id === option.id ? { ...item, text: e.target.value } : item))} placeholder={`Answer choice ${i + 1}`} /><input type="radio" name="correct" aria-label={`Mark option ${i + 1} correct`} checked={correct === option.id} onChange={() => setCorrect(option.id)} /></div></label>)}</div>
    <div className="assessment-form-meta"><label className="assessment-field">Subject<input value={subject} maxLength={100} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Anatomy" /></label><label className="assessment-field">Topic<input value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Upper limb" /></label></div>
    <label className="assessment-field">Explanation <small>Shown after submission</small><textarea value={explanation} maxLength={4000} onChange={(e) => setExplanation(e.target.value)} placeholder="Explain why the answer is correct" /></label>
    <div className="image-upload-row"><label className="secondary-button"><ImagePlus size={15} />{busy ? "Uploading…" : imageAssetId ? "Replace image" : "Add image"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} /></label><small>JPEG, PNG, WebP or GIF · up to 10 MB</small>{imageAssetId && <button type="button" className="text-button" onClick={() => { setImageAssetId(null); setImagePreview(""); }}>Remove</button>}</div>{imageAssetId && !imagePreview && <AuthenticatedImage userId={userId} mediaId={imageAssetId} alt="Current question image" className="question-image-preview" />}{imagePreview && <img className="question-image-preview" src={imagePreview} alt="Selected question" />}
    {error && <p className="inline-error">{error}</p>}<div className="assessment-form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button className="small-primary" disabled={busy || !prompt.trim()}>{busy ? "Saving…" : "Save question"}</button></div>
  </form>;
}

function AssessmentForm({ questions, initial, onCancel, onSave, creating }: { questions: AssessmentQuestionData[]; initial?: AssessmentItem; onCancel: () => void; onSave: (input: { title: string; description: string; durationSeconds: number; questionIds: string[] }, id: string | null, publish: boolean) => Promise<void>; creating: boolean }) {
  const [title, setTitle] = useState(initial?.title ?? ""); const [description, setDescription] = useState(initial?.description ?? ""); const [duration, setDuration] = useState(String(Math.max(1, Math.round((initial?.durationSeconds ?? 1800) / 60)))); const [selected, setSelected] = useState<string[]>(initial?.questionIds.filter((id) => questions.some((q) => q.id === id)) ?? questions.map((q) => q.id));
  function save(publish: boolean) { return onSave({ title, description, durationSeconds: Number(duration) * 60, questionIds: selected }, initial?.id ?? null, publish); }
  return <form className="assessment-form-panel quiz-form" onSubmit={(e) => { e.preventDefault(); void save(false); }}><div className="assessment-form-head"><div><strong>{initial ? "Edit test draft" : "Create a timed test"}</strong><small>Published versions stay frozen; changes here apply to the next version.</small></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close"><X size={16} /></button></div><div className="assessment-form-meta"><label className="assessment-field">Test title<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anatomy unit test 1" /></label><label className="assessment-field">Time limit (minutes)<input required type="number" min="1" max="360" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label></div><label className="assessment-field">Description<textarea maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional instructions or syllabus coverage" /></label><div className="assessment-question-picker"><strong>Questions included <small>{selected.length} selected</small></strong>{questions.map((q) => <label key={q.id}><input type="checkbox" checked={selected.includes(q.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, q.id] : selected.filter((id) => id !== q.id))} /><span><RichContent html={q.prompt} /></span></label>)}</div><div className="assessment-form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="secondary-button" disabled={creating || !title.trim() || !selected.length}>{creating ? "Saving…" : "Save draft"}</button><button type="button" className="small-primary" disabled={creating || !title.trim() || !selected.length} onClick={() => void save(true)}>{creating ? "Publishing…" : "Publish test"}</button></div></form>;
}

function AssessmentQuestionCard({ userId, question, index, selected, submitted, onSelect }: { userId: string; question: AssessmentQuestionData; index: number; selected?: string; submitted: boolean; onSelect: (id: string) => void }) {
  return <article className="assessment-question-card"><div className="assessment-question-label"><span>QUESTION {String(index + 1).padStart(2, "0")}</span>{question.subject && <small>{question.subject}{question.topic ? ` · ${question.topic}` : ""}</small>}</div><div className="assessment-prompt"><RichContent html={question.prompt} />{question.imageAssetId && <AuthenticatedImage userId={userId} mediaId={question.imageAssetId} alt="Question illustration" />}</div><div className="assessment-answer-list">{question.options.map((option, i) => { const isSelected = selected === option.id; const isCorrect = question.correctOptionId === option.id; const state = submitted && isCorrect ? "correct" : submitted && isSelected && !isCorrect ? "wrong" : isSelected ? "selected" : ""; return <button type="button" key={option.id} aria-pressed={isSelected} disabled={submitted} className={`assessment-answer${state ? ` assessment-answer-${state}` : ""}`} onClick={() => onSelect(option.id)}><span>{String.fromCharCode(65 + i)}</span><strong>{option.text}</strong>{submitted && isCorrect && <CheckCircle2 size={15} />}</button>; })}</div>{submitted && question.explanation && <div className="answer-explanation"><strong>Explanation</strong><RichContent html={question.explanation} /></div>}</article>;
}
