import { model, Schema } from "mongoose";

const questionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  prompt: { type: String, required: true },
  options: [{ id: { type: String, required: true }, text: { type: String, required: true } }],
  correctOptionId: { type: String, required: true },
  explanation: { type: String, default: "" },
  imageAssetId: { type: Schema.Types.ObjectId, default: null },
  subject: { type: String, default: "" },
  topic: { type: String, default: "" },
  tags: { type: [String], default: [] },
}, { timestamps: true, versionKey: false });
questionSchema.index({ userId: 1, updatedAt: -1 });
export const AssessmentQuestion = model("AssessmentQuestion", questionSchema);

const snapshotQuestionSchema = new Schema({
  questionId: { type: Schema.Types.ObjectId, required: true },
  prompt: { type: String, required: true },
  options: [{ id: { type: String, required: true }, text: { type: String, required: true } }],
  correctOptionId: { type: String, required: true },
  explanation: { type: String, default: "" },
  imageAssetId: { type: Schema.Types.ObjectId, default: null },
  subject: { type: String, default: "" },
  topic: { type: String, default: "" },
  points: { type: Number, default: 1 },
}, { _id: false });

export const Assessment = model("Assessment", new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  durationSeconds: { type: Number, required: true },
  questionIds: [{ type: Schema.Types.ObjectId }],
  currentVersion: { type: Number, default: 0 },
  publishedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false }).index({ userId: 1, updatedAt: -1 }));

export const AssessmentVersion = model("AssessmentVersion", new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  assessmentId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  durationSeconds: { type: Number, required: true },
  questions: { type: [snapshotQuestionSchema], required: true },
  publishedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false }).index({ assessmentId: 1, version: 1 }, { unique: true }));

export const AssessmentAttempt = model("AssessmentAttempt", new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  assessmentId: { type: Schema.Types.ObjectId, required: true },
  versionId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  title: { type: String, required: true },
  durationSeconds: { type: Number, required: true },
  questions: { type: [snapshotQuestionSchema], required: true },
  startedAt: { type: Date, required: true },
  deadlineAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  status: { type: String, enum: ["in_progress", "submitted"], default: "in_progress" },
  clientAttemptId: { type: String, default: null },
  integrity: { type: String, enum: ["online", "offline_unverified"], default: "online" },
  score: { type: Number, default: null },
  maxScore: { type: Number, required: true },
  correctCount: { type: Number, default: null },
}, { timestamps: true, versionKey: false }).index({ userId: 1, startedAt: -1 }).index({ userId: 1, clientAttemptId: 1 }, { unique: true, partialFilterExpression: { clientAttemptId: { $type: "string" } } }));

export const AssessmentResponse = model("AssessmentResponse", new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  attemptId: { type: Schema.Types.ObjectId, required: true },
  questionId: { type: Schema.Types.ObjectId, required: true },
  selectedOptionId: { type: String, required: true },
  savedAt: { type: Date, required: true },
}, { timestamps: false, versionKey: false }).index({ attemptId: 1, questionId: 1 }, { unique: true }));

export const MediaAsset = model("MediaAsset", new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  storageKey: { type: String, required: true, unique: true },
  storageProvider: { type: String, enum: ["filesystem", "s3"], default: "filesystem" },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  originalName: { type: String, required: true },
}, { timestamps: true, versionKey: false }).index({ userId: 1, createdAt: -1 }));
