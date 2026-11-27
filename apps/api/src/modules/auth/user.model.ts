import { model, Schema } from "mongoose";

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  reviewStateVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });

userSchema.index({ email: 1 }, { unique: true });

export interface UserRecord {
  _id: { toString(): string };
  name: string;
  email: string;
  passwordHash: string;
}

export const User = model("User", userSchema);
