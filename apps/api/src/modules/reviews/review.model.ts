import { model, Schema } from "mongoose";

const cardStateSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  cardId: { type: Schema.Types.ObjectId, required: true },
  schedulerPackage: { type: String, required: true },
  schedulerModel: { type: String, required: true },
  desiredRetention: { type: Number, required: true },
  schedulerCard: { type: Schema.Types.Mixed, required: true },
  dueAt: { type: Date, required: true },
  state: { type: Number, required: true },
  reps: { type: Number, required: true, default: 0 },
  lapses: { type: Number, required: true, default: 0 },
  lastReviewAt: { type: Date, default: null },
  lastEventId: { type: String, default: null },
}, { timestamps: true, versionKey: false });
cardStateSchema.index({ cardId: 1 }, { unique: true });
cardStateSchema.index({ userId: 1, dueAt: 1 });

const reviewEventSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  cardId: { type: Schema.Types.ObjectId, required: true },
  eventId: { type: String, required: true },
  eventType: { type: String, enum: ["review", "undo"], required: true },
  deviceId: { type: String, required: true },
  sessionId: { type: String, default: null },
  rating: { type: String, enum: ["again", "hard", "good", "easy"], default: null },
  reviewedAt: { type: Date, required: true },
  schedulerPackage: { type: String, required: true },
  schedulerModel: { type: String, required: true },
  beforeCard: { type: Schema.Types.Mixed, required: true },
  afterCard: { type: Schema.Types.Mixed, required: true },
  schedulerReviewLog: { type: Schema.Types.Mixed, default: null },
  dueAt: { type: Date, required: true },
  scheduledDays: { type: Number, required: true },
  undoOfEventId: { type: String, default: null },
}, { timestamps: true, versionKey: false, collection: "reviewLogs" });
reviewEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
reviewEventSchema.index({ userId: 1, cardId: 1, reviewedAt: -1 });
reviewEventSchema.index({ userId: 1, eventType: 1, reviewedAt: 1 });
reviewEventSchema.index({ userId: 1, undoOfEventId: 1 }, { unique: true, partialFilterExpression: { undoOfEventId: { $type: "string" } } });

export const CardState = model("CardState", cardStateSchema);
export const ReviewEvent = model("ReviewEvent", reviewEventSchema);
