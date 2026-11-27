import { model, Schema } from "mongoose";

const deckSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  parentDeckId: { type: Schema.Types.ObjectId, default: null },
  settings: { newCardsPerDay: { type: Number, default: 20 }, reviewsPerDay: { type: Number, default: 200 } },
  archivedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

deckSchema.index({ userId: 1, parentDeckId: 1, name: 1 });
export const Deck = model("Deck", deckSchema);
