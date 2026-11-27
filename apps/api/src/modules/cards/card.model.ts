import { model, Schema } from "mongoose";

const cardSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  noteId: { type: Schema.Types.ObjectId, required: true },
  deckId: { type: Schema.Types.ObjectId, required: true },
  templateOrdinal: { type: Number, required: true },
  cardType: { type: String, enum: ["basic", "reversed", "cloze"], required: true },
  externalAnkiId: { type: String, default: null },
  front: { type: String, required: true },
  back: { type: String, required: true },
  dueAt: { type: Date, default: Date.now },
  suspended: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false });

cardSchema.index({ userId: 1, noteId: 1, templateOrdinal: 1 }, { unique: true });
cardSchema.index({ userId: 1, deckId: 1, dueAt: 1, suspended: 1 });
export const Card = model("Card", cardSchema);
