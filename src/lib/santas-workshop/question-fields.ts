/**
 * The fields a Zeffy form question can be mapped to, and the pure text helpers
 * that interpret answers. Client-safe (shared with the admin mapping screen):
 * no database, no server imports.
 *
 * Matching is by NORMALIZED QUESTION TEXT, never by position (Zeffy's
 * QuestionAnswer has no id and form edits reorder or reword). The answer `type`
 * interprets the value but is not part of the key (Phase 3 ruling 4).
 */

export type QuestionScope = "ticket" | "buyer";

export interface QuestionFieldDef {
  key: string;
  label: string;
  /** Where the answer is looked up first; the other scope is the fallback. */
  scope: QuestionScope;
  required: boolean;
}

export const QUESTION_FIELDS = [
  { key: "stuffy_name", label: "Stuffy name", scope: "ticket", required: true },
  { key: "stuffy_description", label: "What the stuffy is", scope: "ticket", required: false },
  { key: "snack", label: "Snack choice", scope: "ticket", required: true },
  { key: "note_to_santa", label: "Note to Santa", scope: "ticket", required: false },
  { key: "care_note", label: "Care note", scope: "ticket", required: false },
  { key: "child_first_name", label: "Child's first name", scope: "ticket", required: false },
  { key: "photo_consent", label: "Photo sharing", scope: "ticket", required: false },
  { key: "buyer_phone", label: "Parent mobile", scope: "buyer", required: false },
  { key: "dropoff_window", label: "Drop-off window", scope: "buyer", required: true },
  { key: "acknowledgment", label: "Acknowledgment", scope: "buyer", required: false },
] as const satisfies readonly QuestionFieldDef[];

export type QuestionFieldKey = (typeof QUESTION_FIELDS)[number]["key"];

/**
 * A question the admin has seen and deliberately does not map (for example a
 * generic buyer question). It is a map key like any field, so ignoring a string
 * clears its "needs attention" flag everywhere.
 */
export const IGNORED_QUESTION_KEY = "ignored" as const;

export const QUESTION_MAP_KEYS: readonly string[] = [
  ...QUESTION_FIELDS.map((f) => f.key),
  IGNORED_QUESTION_KEY,
];

export function isQuestionMapKey(key: string): boolean {
  return QUESTION_MAP_KEYS.includes(key);
}

export function fieldDef(key: QuestionFieldKey): QuestionFieldDef {
  return QUESTION_FIELDS.find((f) => f.key === key) as QuestionFieldDef;
}

/** field key -> normalized question texts. Several strings may map to one field. */
export type QuestionMap = Partial<Record<string, string[]>>;

/** NFKC, case-fold, collapse whitespace, strip trailing `*`, `:` and `?`. */
export function normalizeQuestionText(text: string): string {
  let t = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  while (/[*:?]$/.test(t)) t = t.slice(0, -1).trimEnd();
  return t;
}

export const ANSWER_ELEMENT_MAX = 500;

/** string as-is, number/boolean to string, array joined with ", " (each element capped). */
export function answerToText(answer: unknown): string {
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" || typeof answer === "boolean") return String(answer);
  if (Array.isArray(answer)) {
    return answer
      .filter((x): x is string => typeof x === "string")
      .map((x) => (x.length > ANSWER_ELEMENT_MAX ? x.slice(0, ANSWER_ELEMENT_MAX) : x))
      .join(", ");
  }
  return "";
}

/**
 * Photo sharing is OPT-IN: true only for boolean `true` or a normalized string
 * in this fixed set. Absent, `false`, blank or unrecognised mean NO, and are
 * never an error and never flagged. The exact strings the real form uses are
 * settled by the S2 spike; an unrecognised affirmative fails SAFE (no sharing).
 */
export const CONSENT_AFFIRMATIVE: readonly string[] = [
  "yes",
  "y",
  "true",
  "yes please",
  "agree",
  "i agree",
  "consent",
  "i consent",
];

export function interpretConsent(answer: unknown): boolean {
  if (answer === true) return true;
  if (typeof answer === "string") return CONSENT_AFFIRMATIVE.includes(normalizeQuestionText(answer));
  if (Array.isArray(answer)) {
    return answer.some((x) => typeof x === "string" && CONSENT_AFFIRMATIVE.includes(normalizeQuestionText(x)));
  }
  return false;
}
