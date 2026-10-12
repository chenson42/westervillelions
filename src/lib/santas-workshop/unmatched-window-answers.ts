/**
 * "Answers that matched no window": the distinct drop-off window answers of
 * orders whose window id is null, grouped by normalized text with a count and
 * one example spelling. Pure and client-safe; the database read that feeds it
 * is `listUnmatchedWindowAnswers()` in session-queries.ts. The text came from a
 * buyer: it is data, rendered as text only.
 */

import { normalizeQuestionText } from "./question-fields";

export interface UnmatchedWindowAnswer {
  /** One real spelling as received, offered as the new label. */
  answer: string;
  count: number;
}

export const UNMATCHED_WINDOW_MAX = 10;
const ANSWER_MAX = 80;

export function groupUnmatchedWindowAnswers(
  rows: readonly { windowId: string | null; windowLabelRaw: string | null }[],
): UnmatchedWindowAnswer[] {
  const groups = new Map<string, UnmatchedWindowAnswer>();
  for (const r of rows) {
    if (r.windowId !== null || r.windowLabelRaw === null) continue; // matched, or purged (no raw answer)
    const key = normalizeQuestionText(r.windowLabelRaw);
    if (!key) continue;
    const hit = groups.get(key);
    if (hit) hit.count += 1;
    else groups.set(key, { answer: r.windowLabelRaw.trim().slice(0, ANSWER_MAX), count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer)).slice(0, UNMATCHED_WINDOW_MAX);
}
