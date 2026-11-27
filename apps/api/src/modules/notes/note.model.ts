import { model, Schema } from "mongoose";

const noteSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  deckId: { type: Schema.Types.ObjectId, required: true },
  noteType: { type: String, enum: ["basic", "basic_reversed", "cloze"], required: true },
  source: { type: String, enum: ["manual", "anki"], default: "manual" },
  externalAnkiGuid: { type: String, default: null },
  externalAnkiId: { type: String, default: null },
  fields: { front: { type: String, default: "" }, back: { type: String, default: "" }, extra: { type: String, default: "" } },
  tags: { type: [String], default: [] },
}, { timestamps: true, versionKey: false });

noteSchema.index({ userId: 1, deckId: 1, updatedAt: -1 });
noteSchema.index({ userId: 1, tags: 1 });
noteSchema.index({ userId: 1, externalAnkiGuid: 1 }, { unique: true, partialFilterExpression: { externalAnkiGuid: { $type: "string" } } });
export const Note = model("Note", noteSchema);
