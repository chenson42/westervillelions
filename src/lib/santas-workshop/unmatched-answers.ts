/**
 * The raw question-and-answer text an admin needs to see on a "needs attention"
 * row: answers whose question string maps to no field (and is not ignored), so
 * the admin can tell WHAT the buyer typed against WHICH question without opening
 * the database. Pure and client-safe. Zeffy and buyer text is untrusted: callers
 * render it as text only.
 */

import { answerToText, normalizeQuestionText, type QuestionMap } from "./question-fields";

export interface UnmatchedAnswer {
  question: string;
  answer: string;
}

export const UNMATCHED_MAX = 10;
export const UNMATCHED_TEXT_MAX = 300;

function mappedStrings(map: QuestionMap): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(map)) for (const s of list ?? []) out.add(normalizeQuestionText(s));
  return out;
}

function pick(raw: unknown, known: Set<string>, into: UnmatchedAnswer[]): void {
  if (!Array.isArray(raw)) return;
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const question = (q as { question?: unknown }).question;
    if (typeof question !== "string") continue;
    if (known.has(normalizeQuestionText(question))) continue;
    into.push({
      question: question.slice(0, UNMATCHED_TEXT_MAX),
      answer: answerToText((q as { answer?: unknown }).answer).slice(0, UNMATCHED_TEXT_MAX),
    });
  }
}

/** Ticket answers first, then the buyer's, capped. Empty when every question is mapped or ignored. */
export function unmatchedAnswers(ticketRaw: unknown, buyerRaw: unknown, map: QuestionMap): UnmatchedAnswer[] {
  const known = mappedStrings(map);
  const out: UnmatchedAnswer[] = [];
  pick(ticketRaw, known, out);
  pick(buyerRaw, known, out);
  return out.slice(0, UNMATCHED_MAX);
}
