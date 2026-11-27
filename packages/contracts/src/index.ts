import { z } from "zod";

export const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const profileUpdateSchema = z.object({ name: z.string().trim().min(1).max(80), email: emailSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

export const noteTypeSchema = z.enum(["basic", "basic_reversed", "cloze"]);
export const noteInputSchema = z.object({
  deckId: z.string().min(1),
  noteType: noteTypeSchema,
  fields: z.object({ front: z.string().max(50_000), back: z.string().max(50_000).default(""), extra: z.string().max(50_000).default("") }),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export const deckInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentDeckId: z.string().min(1).nullable().optional(),
});
export type NoteTypeKey = z.infer<typeof noteTypeSchema>;
export type NoteInput = z.infer<typeof noteInputSchema>;
export type DeckInput = z.infer<typeof deckInputSchema>;

export const noteTypes = [
  { id: "basic", name: "Basic", description: "Question on the front, answer on the back." },
  { id: "basic_reversed", name: "Basic (and reversed)", description: "Creates a card in both directions." },
  { id: "cloze", name: "Cloze", description: "Hide one or more parts of a sentence using {{c1::text}}." },
] as const;
