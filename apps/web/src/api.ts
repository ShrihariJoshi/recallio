import type { ApiResponse, DeckInput, LoginInput, NoteInput, NoteTypeKey, PublicUser, RegisterInput } from "@recallio/contracts";
import type { FsrsCard } from "@recallio/scheduler";

export interface StudyCardData {
  id: string;
  noteId: string;
  deckId: string;
  cardType: string;
  front: string;
  back: string;
  dueAt: string;
  schedulerCard: FsrsCard;
  previews: Array<{ rating: "again" | "hard" | "good" | "easy"; dueAt: string; intervalLabel: string }>;
}

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";
export const mediaAssetUrl = (id: string) => `${API}/media/${encodeURIComponent(id)}`;
let csrfToken: string | undefined;

async function getCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API}/auth/csrf`, { credentials: "include" });
  const body = await response.json() as ApiResponse<{ csrfToken: string }>;
  if (!body.data) throw new Error("Could not start a secure session. Try refreshing the page.");
  csrfToken = body.data.csrfToken;
  return csrfToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("x-csrf-token", await getCsrf());
  const response = await fetch(`${API}${path}`, { ...init, headers, credentials: "include" });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || body.success === false) throw new Error(body.error?.message ?? "Something went wrong.");
  return body.data as T;
}

export const authApi = {
  me: () => request<{ user: PublicUser }>("/auth/me"),
  login: (input: LoginInput) => request<{ user: PublicUser }>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
  register: (input: RegisterInput) => request<{ user: PublicUser }>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (input: { name: string; email: string }) => request<{ user: PublicUser }>("/auth/profile", { method: "PATCH", body: JSON.stringify(input) }),
  logout: async () => {
    try { await request<void>("/auth/logout", { method: "POST" }); }
    finally { csrfToken = undefined; }
  },
};

export const learningApi = {
  decks: () => request<{ decks: Array<{ id: string; name: string; parentDeckId: string | null; cardCount: number }> }>("/decks"),
  downloadDeck: (deckId: string) => request<{ deck: { id: string; name: string; parentDeckId: string | null; cardCount: number; downloadedAt: string }; cards: StudyCardData[]; cardCount: number; downloadedAt: string }>(`/sync/decks/${encodeURIComponent(deckId)}`),
  createDeck: (input: DeckInput) => request<{ deck: { id: string; name: string; parentDeckId: string | null; cardCount: number } }>("/decks", { method: "POST", body: JSON.stringify(input) }),
  renameDeck: (id: string, name: string) => request<{ deck: { id: string; name: string; parentDeckId: string | null } }>(`/decks/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteDeck: (id: string) => request<void>(`/decks/${id}`, { method: "DELETE" }),
  noteTypes: () => request<{ noteTypes: Array<{ id: NoteTypeKey; name: string; description: string }> }>("/notes/types"),
  createNote: (input: NoteInput) => request<{ note: { id: string; cardCount: number } }>("/notes", { method: "POST", body: JSON.stringify(input) }),
  note: (id: string) => request<{ note: { id: string; deckId: string; noteType: NoteTypeKey; fields: { front: string; back: string; extra: string }; tags: string[] } }>(`/notes/${id}`),
  updateNote: (id: string, input: Partial<Omit<NoteInput, "deckId">>) => request<{ note: { id: string; cardCount: number } }>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteNote: (id: string) => request<void>(`/notes/${id}`, { method: "DELETE" }),
  notes: (search = "") => request<{ notes: Array<{ id: string; deckId: string; noteType: NoteTypeKey; fields: { front: string; back: string; extra: string }; tags: string[]; cardCount: number }> }>(`/notes?search=${encodeURIComponent(search)}`),
  cards: (search = "") => request<{ cards: Array<{ id: string; noteId: string; deckId: string; cardType: string; front: string; back: string; suspended: boolean }> }>(`/cards?search=${encodeURIComponent(search)}`),
  dueCards: (deckId?: string) => request<{ cards: StudyCardData[]; dueCount: number; checkedAt: string }>(`/reviews/due${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ""}`),
  rateCard: (input: { cardId: string; rating: "again" | "hard" | "good" | "easy"; eventId: string; deviceId: string; sessionId: string; reviewedAt?: string }) => request<{ eventId: string; dueAt: string; intervalLabel: string; reviewedAt: string; schedulerCard: FsrsCard; duplicate: boolean }>("/reviews", { method: "POST", body: JSON.stringify(input) }),
  syncReviews: (reviews: Array<{ eventId: string; cardId: string; rating: "again" | "hard" | "good" | "easy"; deviceId: string; sessionId: string; reviewedAt: string }>) => request<{ syncedEventIds: string[]; syncedCount: number }>("/sync/reviews", { method: "POST", body: JSON.stringify({ reviews }) }),
  undoReview: (targetEventId: string, input: { eventId: string; deviceId: string; sessionId: string }) => request<{ eventId: string; undoneEventId: string; dueAt: string; duplicate: boolean }>(`/reviews/${encodeURIComponent(targetEventId)}/undo`, { method: "POST", body: JSON.stringify(input) }),
  uploadApkg: (file: File) => { const form = new FormData(); form.set("file", file); return request<{ import: { id: string; filename: string; format: string; preview: { deckCount: number; noteCount: number; cardCount: number; tagCount: number; duplicatePackage: boolean; decks: string[] }; report: { unsupportedNoteTypes: string[]; mediaFiles: number; mediaBytes: number; schedulingRecords: number; missingMedia: string[]; warnings: string[] } } }>("/imports", { method: "POST", body: form }); },
  confirmImport: (id: string) => request<{ summary: { importedDecks: number; importedNotes: number; updatedNotes: number; importedCards: number; warningCount: number } }>(`/imports/${id}/confirm`, { method: "POST", body: "{}" }),
  discardImport: (id: string) => request<void>(`/imports/${id}`, { method: "DELETE" }),
};

export interface AssessmentQuestionData {
  id: string; prompt: string; options: Array<{ id: string; text: string }>;
  correctOptionId?: string; explanation?: string; imageAssetId: string | null; subject: string; topic: string; tags?: string[];
}
export interface AssessmentAttemptData {
  id: string; assessmentId: string; title: string; version: number; status: "in_progress" | "submitted";
  startedAt: string; deadlineAt: string; durationSeconds: number; submittedAt?: string | null; score?: number | null; maxScore: number; correctCount?: number | null;
  questions: AssessmentQuestionData[]; answers: Record<string, string>;
}
export const assessmentApi = {
  questions: () => request<{ questions: AssessmentQuestionData[] }>("/assessments/questions"),
  uploadImage: (file: File) => { const form = new FormData(); form.set("file", file); return request<{ asset: { id: string; mimeType: string; sizeBytes: number; url: string } }>("/media", { method: "POST", body: form }); },
  createQuestion: (input: { prompt: string; options: Array<{ id: string; text: string }>; correctOptionId: string; explanation: string; imageAssetId: string | null; subject: string; topic: string; tags: string[] }) => request<{ question: AssessmentQuestionData }>("/assessments/questions", { method: "POST", body: JSON.stringify(input) }),
  bulkCreateQuestions: (questions: Array<{ prompt: string; options: Array<{ id: string; text: string }>; correctOptionId: string; explanation?: string; imageAssetId?: string | null; subject?: string; topic?: string; tags?: string[] }>) => request<{ questions: AssessmentQuestionData[] }>("/assessments/questions/bulk", { method: "POST", body: JSON.stringify({ questions }) }),
  updateQuestion: (id: string, input: { prompt: string; options: Array<{ id: string; text: string }>; correctOptionId: string; explanation: string; imageAssetId: string | null; subject: string; topic: string; tags: string[] }) => request<{ question: AssessmentQuestionData }>(`/assessments/questions/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteQuestion: (id: string) => request<void>(`/assessments/questions/${id}`, { method: "DELETE" }),
  assessments: () => request<{ assessments: Array<{ id: string; title: string; description: string; durationSeconds: number; questionIds: string[]; questionCount: number; version: number; status: "draft" | "published" }> }>("/assessments"),
  downloadAssessment: (id: string) => request<{ assessment: { id: string; title: string; description: string; version: number; durationSeconds: number; questions: AssessmentQuestionData[] } }>(`/assessments/${encodeURIComponent(id)}/download`),
  attempts: () => request<{ attempts: Array<{ id: string; title: string; version: number; status: "in_progress" | "submitted"; startedAt: string; score: number | null; maxScore: number; correctCount: number | null }> }>("/assessments/attempts"),
  createAssessment: (input: { title: string; description: string; durationSeconds: number; questionIds: string[] }) => request<{ assessment: { id: string } }>("/assessments", { method: "POST", body: JSON.stringify(input) }),
  updateAssessmentDraft: (id: string, input: { title: string; description: string; durationSeconds: number; questionIds: string[] }) => request<{ assessment: { id: string } }>(`/assessments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  forkAssessmentDraft: (id: string) => request<{ assessment: { id: string } }>(`/assessments/${id}/draft`, { method: "POST", body: "{}" }),
  publishAssessment: (id: string) => request<{ version: number }>(`/assessments/${id}/publish`, { method: "POST", body: "{}" }),
  startAttempt: (id: string) => request<{ attempt: AssessmentAttemptData }>(`/assessments/${id}/attempts`, { method: "POST", body: "{}" }),
  attempt: (id: string) => request<{ attempt: AssessmentAttemptData }>(`/assessments/attempts/${id}`),
  saveAnswer: (attemptId: string, questionId: string, selectedOptionId: string) => request<{ saved: boolean }>(`/assessments/attempts/${attemptId}/responses/${questionId}`, { method: "PUT", body: JSON.stringify({ selectedOptionId }) }),
  submitAttempt: (id: string) => request<{ score: number; maxScore: number; correctCount: number; duplicate: boolean }>(`/assessments/attempts/${id}/submit`, { method: "POST", body: "{}" }),
  syncOfflineAttempt: (input: { attemptId?: string; clientAttemptId: string; assessmentId?: string; version?: number; startedAt: string; submitted: boolean; answers: Array<{ questionId: string; selectedOptionId: string }> }) => request<{ attempt: { id: string; status: "in_progress" | "submitted"; score: number | null; maxScore: number; correctCount: number | null; questions: AssessmentQuestionData[]; answers: Record<string, string> } }>("/assessments/attempts/offline-sync", { method: "POST", body: JSON.stringify(input) }),
};

export interface StatisticsSummary {
  checkedAt: string;
  timeZone: string;
  rangeDays: number;
  overview: { dueNow: number; newCards: number; totalCards: number; reviewsToday: number };
  activity: Array<{ date: string; reviews: number }>;
  ratings: { again: number; hard: number; good: number; easy: number };
  rangeReviews: number;
  studyDays: number;
}

export const statisticsApi = {
  dashboard: (days = 7) => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return request<StatisticsSummary>(`/statistics/dashboard?days=${days}&timeZone=${encodeURIComponent(timeZone)}`);
  },
};
