import type { NoteTypeKey } from "@recallio/contracts";

export interface NoteFields { front: string; back: string; extra: string }
export interface GeneratedCard { templateOrdinal: number; cardType: "basic" | "reversed" | "cloze"; front: string; back: string }

const clozePattern = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs;

function clozeNumbers(text: string): number[] {
  return [...new Set(Array.from(text.matchAll(clozePattern), (match) => Number(match[1])))].sort((a, b) => a - b);
}

function renderCloze(text: string, ordinal: number, reveal: boolean): string {
  return text.replace(clozePattern, (_match, number: string, answer: string, hint?: string) => {
    if (Number(number) !== ordinal || reveal) return answer;
    return hint ? `[${hint}]` : "[…]";
  });
}

export function generateCards(noteType: NoteTypeKey, fields: NoteFields): GeneratedCard[] {
  if (noteType === "cloze") {
    return clozeNumbers(fields.front).map((ordinal) => ({
      templateOrdinal: ordinal,
      cardType: "cloze",
      front: renderCloze(fields.front, ordinal, false),
      back: [renderCloze(fields.front, ordinal, true), fields.back, fields.extra].filter(Boolean).join("\n\n"),
    }));
  }
  if (!fields.front.trim() || !fields.back.trim()) return [];
  const cards: GeneratedCard[] = [{ templateOrdinal: 0, cardType: "basic", front: fields.front, back: fields.back }];
  if (noteType === "basic_reversed") cards.push({ templateOrdinal: 1, cardType: "reversed", front: fields.back, back: fields.front });
  return cards;
}
