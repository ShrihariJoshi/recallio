import { Router } from "express";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { sanitizeRichText } from "../notes/sanitize-content.js";
import { Assessment, AssessmentAttempt, AssessmentQuestion, AssessmentResponse, AssessmentVersion, MediaAsset } from "./assessment.models.js";

export const assessmentRouter = Router();
assessmentRouter.use(authenticate);

const questionInput = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  options: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/), text: z.string().trim().min(1).max(500) })).min(2).max(6),
  correctOptionId: z.string().min(1),
  explanation: z.string().max(4_000).default(""),
  imageAssetId: z.string().nullable().optional(),
  subject: z.string().trim().max(100).default(""),
  topic: z.string().trim().max(120).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
}).refine((value) => new Set(value.options.map((option) => option.id)).size === value.options.length, { message: "Option IDs must be unique.", path: ["options"] })
  .refine((value) => value.options.some((option) => option.id === value.correctOptionId), { message: "Select one of the listed options as correct.", path: ["correctOptionId"] });
const assessmentInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).default(""),
  durationSeconds: z.number().int().min(60).max(6 * 60 * 60),
  questionIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(300),
}).refine((value) => new Set(value.questionIds).size === value.questionIds.length, { message: "Questions can only appear once.", path: ["questionIds"] });

function plainText(value: string): string { return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim(); }
function safeQuestion(question: any, includeAnswer = false) {
  return {
    id: String(question.questionId ?? question._id), prompt: question.prompt,
    options: question.options, imageAssetId: question.imageAssetId ? String(question.imageAssetId) : null,
    subject: question.subject, topic: question.topic,
    ...(includeAnswer ? { correctOptionId: question.correctOptionId, explanation: question.explanation, points: question.points ?? 1 } : {}),
  };
}

assessmentRouter.get("/questions", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const questions = await AssessmentQuestion.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(300).lean();
  res.json({ success: true, data: { questions: questions.map((q) => ({ id: String(q._id), prompt: q.prompt, options: q.options, correctOptionId: q.correctOptionId, explanation: q.explanation, imageAssetId: q.imageAssetId ? String(q.imageAssetId) : null, subject: q.subject, topic: q.topic, tags: q.tags })) } });
}));

assessmentRouter.post("/questions", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = questionInput.parse(req.body);
  if (input.imageAssetId && !await MediaAsset.exists({ _id: input.imageAssetId, userId: req.userId })) throw new AppError(404, "MEDIA_NOT_FOUND", "Upload an image from your account first.");
  const question = await AssessmentQuestion.create({
    ...input, userId: req.userId, prompt: sanitizeRichText(input.prompt),
    options: input.options.map((option) => ({ ...option, text: plainText(option.text) })),
    explanation: sanitizeRichText(input.explanation),
  });
  res.status(201).json({ success: true, data: { question: { id: String(question._id), prompt: question.prompt, options: question.options, correctOptionId: question.correctOptionId, explanation: question.explanation, imageAssetId: question.imageAssetId ? String(question.imageAssetId) : null, subject: question.subject, topic: question.topic, tags: question.tags } }, message: "Question added to your bank." });
}));

assessmentRouter.post("/questions/bulk", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = z.object({ questions: z.array(questionInput).min(1).max(300) }).parse(req.body);
  const imageIds = [...new Set(input.questions.map((question) => question.imageAssetId).filter((id): id is string => Boolean(id)))];
  if (imageIds.length && await MediaAsset.countDocuments({ _id: { $in: imageIds }, userId: req.userId }) !== imageIds.length) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "One or more images are not available in this account.");
  }
  const documents = input.questions.map((question) => ({
    ...question,
    userId: req.userId,
    prompt: sanitizeRichText(question.prompt),
    options: question.options.map((option) => ({ ...option, text: plainText(option.text) })),
    explanation: sanitizeRichText(question.explanation),
  }));
  const created = await AssessmentQuestion.insertMany(documents, { ordered: true });
  res.status(201).json({ success: true, data: { questions: created.map((question) => ({ id: String(question._id), prompt: question.prompt, options: question.options, correctOptionId: question.correctOptionId, explanation: question.explanation, imageAssetId: question.imageAssetId ? String(question.imageAssetId) : null, subject: question.subject, topic: question.topic, tags: question.tags })) }, message: `${created.length} questions imported.` });
}));

assessmentRouter.patch("/questions/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = questionInput.parse(req.body);
  if (input.imageAssetId && !await MediaAsset.exists({ _id: input.imageAssetId, userId: req.userId })) throw new AppError(404, "MEDIA_NOT_FOUND", "Upload an image from your account first.");
  const question = await AssessmentQuestion.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { ...input, prompt: sanitizeRichText(input.prompt), options: input.options.map((option) => ({ ...option, text: plainText(option.text) })), explanation: sanitizeRichText(input.explanation) } },
    { new: true, runValidators: true },
  ).lean();
  if (!question) throw new AppError(404, "QUESTION_NOT_FOUND", "This question could not be found.");
  res.json({ success: true, data: { question: { id: String(question._id), prompt: question.prompt, options: question.options, correctOptionId: question.correctOptionId, explanation: question.explanation, imageAssetId: question.imageAssetId ? String(question.imageAssetId) : null, subject: question.subject, topic: question.topic, tags: question.tags } }, message: "Question updated. Published tests keep their saved version." });
}));

assessmentRouter.delete("/questions/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const question = await AssessmentQuestion.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!question) throw new AppError(404, "QUESTION_NOT_FOUND", "This question could not be found.");
  res.json({ success: true, message: "Question removed from your bank. Published tests keep their saved version." });
}));

assessmentRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const assessments = await Assessment.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
  res.json({ success: true, data: { assessments: assessments.map((item) => ({ id: String(item._id), title: item.title, description: item.description, durationSeconds: item.durationSeconds, questionIds: item.questionIds.map(String), questionCount: item.questionIds.length, version: item.currentVersion, status: item.currentVersion > 0 ? "published" : "draft" })) } });
}));

assessmentRouter.get("/:id/download", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId, currentVersion: { $gt: 0 } }).lean();
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "This published test could not be found.");
  const version = await AssessmentVersion.findOne({ assessmentId: assessment._id, version: assessment.currentVersion, userId: req.userId }).lean();
  if (!version) throw new AppError(409, "VERSION_NOT_FOUND", "The published version could not be loaded.");
  res.json({ success: true, data: { assessment: { id: String(assessment._id), title: version.title, description: version.description, version: version.version, durationSeconds: version.durationSeconds, questions: version.questions.map((question) => safeQuestion(question)) } } });
}));

assessmentRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = assessmentInput.parse(req.body);
  const questions = await AssessmentQuestion.find({ _id: { $in: input.questionIds }, userId: req.userId }).select("_id").lean();
  if (questions.length !== input.questionIds.length) throw new AppError(400, "INVALID_QUESTIONS", "Some selected questions are missing from your question bank.");
  const assessment = await Assessment.create({ ...input, title: plainText(input.title), description: sanitizeRichText(input.description), questionIds: input.questionIds, userId: req.userId });
  res.status(201).json({ success: true, data: { assessment: { id: String(assessment._id) } }, message: "Assessment draft created." });
}));

assessmentRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = assessmentInput.parse(req.body);
  const questions = await AssessmentQuestion.find({ _id: { $in: input.questionIds }, userId: req.userId }).select("_id").lean();
  if (questions.length !== input.questionIds.length) throw new AppError(400, "INVALID_QUESTIONS", "Some selected questions are missing from your question bank.");
  const assessment = await Assessment.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, currentVersion: 0 },
    { $set: { ...input, title: plainText(input.title), description: sanitizeRichText(input.description) } },
    { new: true, runValidators: true },
  ).lean();
  if (!assessment) throw new AppError(409, "DRAFT_NOT_EDITABLE", "Only drafts can be edited. Create a new draft to make another version.");
  res.json({ success: true, data: { assessment: { id: String(assessment._id) } }, message: "Draft updated." });
}));

assessmentRouter.post("/:id/draft", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const published = await Assessment.findOne({ _id: req.params.id, userId: req.userId, currentVersion: { $gt: 0 } }).lean();
  if (!published) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "This published assessment could not be found.");
  const draft = await Assessment.create({ userId: req.userId, title: published.title, description: published.description, durationSeconds: published.durationSeconds, questionIds: published.questionIds, currentVersion: 0 });
  res.status(201).json({ success: true, data: { assessment: { id: String(draft._id) } }, message: "A new draft was created from the published test." });
}));

assessmentRouter.post("/:id/publish", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId });
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "This assessment could not be found.");
  const questions = await AssessmentQuestion.find({ _id: { $in: assessment.questionIds }, userId: req.userId }).lean();
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  if (byId.size !== assessment.questionIds.length) throw new AppError(409, "QUESTIONS_CHANGED", "Rebuild this assessment because one or more questions are no longer available.");
  const publishedAt = new Date();
  const version = assessment.currentVersion + 1;
  const snapshot = assessment.questionIds.map((id) => {
    const q = byId.get(String(id))!;
    return { questionId: q._id, prompt: q.prompt, options: q.options, correctOptionId: q.correctOptionId, explanation: q.explanation, imageAssetId: q.imageAssetId, subject: q.subject, topic: q.topic, points: 1 };
  });
  await AssessmentVersion.create({ userId: req.userId, assessmentId: assessment._id, version, title: assessment.title, description: assessment.description, durationSeconds: assessment.durationSeconds, questions: snapshot, publishedAt });
  assessment.currentVersion = version;
  assessment.publishedAt = publishedAt;
  await assessment.save();
  res.json({ success: true, data: { version }, message: `Version ${version} published.` });
}));

assessmentRouter.post("/:id/attempts", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId, currentVersion: { $gt: 0 } }).lean();
  if (!assessment) throw new AppError(404, "ASSESSMENT_NOT_FOUND", "This assessment is not available.");
  const version = await AssessmentVersion.findOne({ assessmentId: assessment._id, version: assessment.currentVersion, userId: req.userId }).lean();
  if (!version) throw new AppError(409, "VERSION_NOT_FOUND", "The published version could not be loaded.");
  const startedAt = new Date();
  const attempt = await AssessmentAttempt.create({ userId: req.userId, assessmentId: assessment._id, versionId: version._id, version: version.version, title: version.title, durationSeconds: version.durationSeconds, questions: version.questions, startedAt, deadlineAt: new Date(startedAt.getTime() + version.durationSeconds * 1000), maxScore: version.questions.reduce((sum, q) => sum + q.points, 0) });
  res.status(201).json({ success: true, data: { attempt: { id: String(attempt._id), assessmentId: String(attempt.assessmentId), title: attempt.title, version: attempt.version, durationSeconds: attempt.durationSeconds, startedAt, deadlineAt: attempt.deadlineAt, status: attempt.status, maxScore: attempt.maxScore, questions: attempt.questions.map((q) => safeQuestion(q)) } } });
}));

assessmentRouter.get("/attempts", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const attempts = await AssessmentAttempt.find({ userId: req.userId }).sort({ startedAt: -1 }).limit(30).select("title version status startedAt submittedAt score maxScore correctCount").lean();
  res.json({ success: true, data: { attempts: attempts.map((item) => ({ id: String(item._id), title: item.title, version: item.version, status: item.status, startedAt: item.startedAt, submittedAt: item.submittedAt, score: item.score, maxScore: item.maxScore, correctCount: item.correctCount })) } });
}));

assessmentRouter.get("/attempts/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const attempt = await AssessmentAttempt.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "This attempt could not be found.");
  const responses = await AssessmentResponse.find({ attemptId: attempt._id, userId: req.userId }).lean();
  const answers = Object.fromEntries(responses.map((response) => [String(response.questionId), response.selectedOptionId]));
  const submitted = attempt.status === "submitted";
  res.json({ success: true, data: { attempt: { id: String(attempt._id), assessmentId: String(attempt.assessmentId), title: attempt.title, version: attempt.version, durationSeconds: attempt.durationSeconds, status: attempt.status, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, submittedAt: attempt.submittedAt, score: attempt.score, maxScore: attempt.maxScore, correctCount: attempt.correctCount, questions: attempt.questions.map((q) => safeQuestion(q, submitted)), answers } } });
}));

assessmentRouter.put("/attempts/:id/responses/:questionId", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = z.object({ selectedOptionId: z.string().min(1).max(30) }).parse(req.body);
  const attempt = await AssessmentAttempt.findOne({ _id: req.params.id, userId: req.userId });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "This attempt could not be found.");
  if (attempt.status !== "in_progress" || Date.now() >= attempt.deadlineAt.getTime()) throw new AppError(409, "ATTEMPT_CLOSED", "Time is up. Submit your saved answers to see your result.");
  const question = attempt.questions.find((q) => String(q.questionId) === req.params.questionId);
  if (!question) throw new AppError(404, "QUESTION_NOT_IN_ATTEMPT", "This question is not part of this attempt.");
  if (!question.options.some((option) => option.id === input.selectedOptionId)) throw new AppError(400, "INVALID_OPTION", "Choose one of the available options.");
  await AssessmentResponse.updateOne({ attemptId: attempt._id, questionId: question.questionId, userId: req.userId }, { $set: { selectedOptionId: input.selectedOptionId, savedAt: new Date() } }, { upsert: true });
  res.json({ success: true, data: { saved: true } });
}));

assessmentRouter.post("/attempts/:id/submit", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const attempt = await AssessmentAttempt.findOne({ _id: req.params.id, userId: req.userId });
  if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "This attempt could not be found.");
  if (attempt.status === "submitted") {
    res.json({ success: true, data: { score: attempt.score, maxScore: attempt.maxScore, correctCount: attempt.correctCount, duplicate: true } });
    return;
  }
  const responses = await AssessmentResponse.find({ attemptId: attempt._id, userId: req.userId }).lean();
  const answers = new Map(responses.map((r) => [String(r.questionId), r.selectedOptionId]));
  let score = 0;
  let correctCount = 0;
  for (const question of attempt.questions) if (answers.get(String(question.questionId)) === question.correctOptionId) { score += question.points; correctCount += 1; }
  attempt.status = "submitted";
  attempt.submittedAt = new Date();
  attempt.score = score;
  attempt.correctCount = correctCount;
  await attempt.save();
  res.json({ success: true, data: { score, maxScore: attempt.maxScore, correctCount, duplicate: false } });
}));

assessmentRouter.post("/attempts/offline-sync", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = z.object({
    attemptId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    clientAttemptId: z.string().min(8).max(100),
    assessmentId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    version: z.number().int().positive().optional(),
    startedAt: z.string().datetime(),
    submitted: z.boolean(),
    answers: z.array(z.object({ questionId: z.string().regex(/^[a-f\d]{24}$/i), selectedOptionId: z.string().min(1).max(30) })).max(300),
  }).parse(req.body);
  let attempt = input.attemptId ? await AssessmentAttempt.findOne({ _id: input.attemptId, userId: req.userId }) : null;
  if (!attempt) attempt = await AssessmentAttempt.findOne({ userId: req.userId, clientAttemptId: input.clientAttemptId });
  if (!attempt) {
    if (!input.assessmentId || !input.version) throw new AppError(400, "OFFLINE_ATTEMPT_CONTEXT_REQUIRED", "The downloaded test version could not be identified.");
    const version = await AssessmentVersion.findOne({ assessmentId: input.assessmentId, version: input.version, userId: req.userId }).lean();
    if (!version) throw new AppError(404, "VERSION_NOT_FOUND", "This published test version is no longer available.");
    const startedAt = new Date(input.startedAt);
    attempt = await AssessmentAttempt.create({ userId: req.userId, assessmentId: version.assessmentId, versionId: version._id, version: version.version, title: version.title, durationSeconds: version.durationSeconds, questions: version.questions, startedAt, deadlineAt: new Date(startedAt.getTime() + version.durationSeconds * 1000), maxScore: version.questions.reduce((sum, question) => sum + question.points, 0), clientAttemptId: input.clientAttemptId, integrity: "offline_unverified" });
  }
  if (attempt.status === "submitted") {
    const prior = await AssessmentResponse.find({ attemptId: attempt._id, userId: req.userId }).lean();
    res.json({ success: true, data: { attempt: { id: String(attempt._id), status: attempt.status, score: attempt.score, maxScore: attempt.maxScore, correctCount: attempt.correctCount, questions: attempt.questions.map((q) => safeQuestion(q, true)), answers: Object.fromEntries(prior.map((response) => [String(response.questionId), response.selectedOptionId])) } } });
    return;
  }
  const questionMap = new Map(attempt.questions.map((question) => [String(question.questionId), question]));
  for (const answer of input.answers) {
    const question = questionMap.get(answer.questionId);
    if (!question || !question.options.some((option) => option.id === answer.selectedOptionId)) throw new AppError(400, "INVALID_OFFLINE_RESPONSE", "An offline answer does not match this test version.");
    await AssessmentResponse.updateOne({ attemptId: attempt._id, questionId: question.questionId, userId: req.userId }, { $set: { selectedOptionId: answer.selectedOptionId, savedAt: new Date() } }, { upsert: true });
  }
  attempt.integrity = "offline_unverified";
  const expired = Date.now() >= attempt.deadlineAt.getTime();
  if (input.submitted || expired) {
    const responses = await AssessmentResponse.find({ attemptId: attempt._id, userId: req.userId }).lean();
    const answers = new Map(responses.map((response) => [String(response.questionId), response.selectedOptionId]));
    let score = 0; let correctCount = 0;
    for (const question of attempt.questions) if (answers.get(String(question.questionId)) === question.correctOptionId) { score += question.points; correctCount += 1; }
    attempt.status = "submitted"; attempt.submittedAt = new Date(); attempt.score = score; attempt.correctCount = correctCount;
  }
  await attempt.save();
  const responses = await AssessmentResponse.find({ attemptId: attempt._id, userId: req.userId }).lean();
  res.json({ success: true, data: { attempt: { id: String(attempt._id), status: attempt.status, score: attempt.score, maxScore: attempt.maxScore, correctCount: attempt.correctCount, questions: attempt.questions.map((q) => safeQuestion(q, attempt!.status === "submitted")), answers: Object.fromEntries(responses.map((response) => [String(response.questionId), response.selectedOptionId])) } } });
}));

