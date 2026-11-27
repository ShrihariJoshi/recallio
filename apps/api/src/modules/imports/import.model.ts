import { model, Schema } from "mongoose";

const importJobSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  packageHash: { type: String, required: true },
  filename: { type: String, required: true },
  format: { type: String, required: true },
  status: { type: String, enum: ["preview", "imported", "failed"], default: "preview" },
  preview: { type: Schema.Types.Mixed, required: true },
  report: { type: Schema.Types.Mixed, required: true },
  mediaAssetIds: { type: [Schema.Types.ObjectId], default: [] },
  summary: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, versionKey: false });
importJobSchema.index({ userId: 1, packageHash: 1 });
export const ImportJob = model("ImportJob", importJobSchema);

const importStageSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  importId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ["deck", "note", "card"], required: true },
  sourceId: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
}, { timestamps: false, versionKey: false });
importStageSchema.index({ importId: 1, kind: 1 });
export const ImportStage = model("ImportStage", importStageSchema);
