/**
 * PaymentSnapshot -> desired order + stuffy values. PURE: no IO, no clock, no
 * database. The one place Zeffy answers become workshop fields, shared by the
 * apply path (webhook, Sync, Reprocess payment) and the local Remap (which
 * feeds it the stored raw answers instead of a fresh snapshot).
 *
 * Rules (Phase 3, "Mapper rules"; DECISION-123):
 *   - An item becomes a stuffy iff type = 'ticket' AND its rate id is one the
 *     admin marked. Donations never do; a wrong campaign mapping (no marked
 *     rate) therefore creates nothing.
 *   - Only status 'succeeded' yields registrants.
 *   - Questions match by normalized text (question-fields.ts). A question whose
 *     text is in no map entry sets `unmapped_question`; a missing required value
 *     sets `missing_name` / `missing_snack` / `unmapped_window`. Raw Q&A is
 *     always kept (capped); nothing is ever dropped.
 *   - Photo consent is OPT-IN: absent, false, blank or unrecognised means no.
 *   - Text is stored verbatim (HTML included) and length-capped; React escapes
 *     on render and frames use fillText, so there is no sanitiser here to bypass.
 *   - Refund state is DERIVED from the order, never stored per stuffy (ruling 7).
 */

import type { PaymentSnapshot, SnapshotQuestion } from "@/lib/zeffy/snapshot";
import {
  answerToText,
  fieldDef,
  interpretConsent,
  normalizeQuestionText,
  type QuestionFieldKey,
  type QuestionMap,
} from "./question-fields";

export const ATTENTION_CODES = [
  "unmapped_question",
  "missing_name",
  "missing_snack",
  "unmapped_window",
  "not_in_order_now",
  "truncated",
] as const;
export type AttentionCode = (typeof ATTENTION_CODES)[number];

export const FIELD_CAPS = {
  name: 200,
  description: 1000,
  snack: 200,
  childFirstName: 100,
  noteToSanta: 5000,
  careNote: 5000,
  buyerPhone: 50,
  windowRaw: 200,
  /** Per value in a stuffy's stored raw Q&A (must be >= the largest field cap). */
  rawTicketAnswer: 5000,
  /** Per value in an order's stored buyer Q&A. */
  rawBuyerAnswer: 2000,
  rawAnswersCount: 60,
  buyerAnswersCount: 40,
} as const;

export interface MapperSession {
  windows: readonly { id: string; label: string }[];
  ticketRateIds: readonly string[];
  questionMap: QuestionMap;
}

export interface MappedStuffy {
  itemKey: string;
  name: string | null;
  description: string | null;
  childFirstName: string | null;
  snack: string | null;
  noteToSanta: string | null;
  careNote: string | null;
  photoConsent: boolean;
  rawAnswers: SnapshotQuestion[];
  attentionCodes: AttentionCode[];
}

export interface MappedOrder {
  paymentStatus: string;
  buyerFirstName: string | null;
  buyerLastName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  amountCents: number;
  refundStatus: "none" | "partial" | "full";
  refundedCents: number;
  windowId: string | null;
  windowLabelRaw: string | null;
  buyerAnswers: SnapshotQuestion[];
  acknowledged: boolean | null;
}

export interface MappedPayment {
  /** status === 'succeeded': only then may NEW registrants be created. */
  succeeded: boolean;
  order: MappedOrder;
  stuffies: MappedStuffy[];
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function mappedStrings(map: QuestionMap, key: string): Set<string> {
  return new Set((map[key] ?? []).map(normalizeQuestionText));
}

function allMappedStrings(map: QuestionMap): Set<string> {
  const all = new Set<string>();
  for (const key of Object.keys(map)) for (const s of map[key] ?? []) all.add(normalizeQuestionText(s));
  return all;
}

function isBlank(answer: unknown): boolean {
  if (answer === true || answer === false) return false;
  return answerToText(answer).trim() === "";
}

/**
 * The first non-blank answer to any string mapped to `key`, looked up in the
 * field's home scope first and the other scope as a fallback (ruling 4).
 * Returns `undefined` when none matched at all.
 */
function findAnswer(
  key: QuestionFieldKey,
  map: QuestionMap,
  scopes: { ticket: readonly SnapshotQuestion[]; buyer: readonly SnapshotQuestion[] },
): SnapshotQuestion["answer"] | undefined {
  const strings = mappedStrings(map, key);
  if (strings.size === 0) return undefined;
  const home = fieldDef(key).scope;
  const order: ("ticket" | "buyer")[] = home === "ticket" ? ["ticket", "buyer"] : ["buyer", "ticket"];
  for (const scope of order) {
    for (const q of scopes[scope]) {
      if (strings.has(normalizeQuestionText(q.question)) && !isBlank(q.answer)) return q.answer;
    }
  }
  return undefined;
}

function hasUnmappedQuestion(questions: readonly SnapshotQuestion[], map: QuestionMap): boolean {
  const known = allMappedStrings(map);
  return questions.some((q) => !known.has(normalizeQuestionText(q.question)));
}

function capText(value: unknown, max: number): { text: string | null; truncated: boolean } {
  if (value === undefined) return { text: null, truncated: false };
  const text = answerToText(value).trim();
  if (!text) return { text: null, truncated: false };
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

export function capRawAnswers(
  questions: readonly SnapshotQuestion[],
  perValueMax: number,
  countMax: number,
): SnapshotQuestion[] {
  return questions.slice(0, countMax).map((q) => ({
    question: q.question,
    type: q.type,
    answer: Array.isArray(q.answer)
      ? q.answer.slice(0, 50)
      : typeof q.answer === "string"
        ? q.answer.length > perValueMax
          ? q.answer.slice(0, perValueMax)
          : q.answer
        : q.answer,
  }));
}

// ---------------------------------------------------------------------------
// Order-level (buyer) mapping
// ---------------------------------------------------------------------------

export interface BuyerFields {
  buyerPhone: string | null;
  windowId: string | null;
  windowLabelRaw: string | null;
  acknowledged: boolean | null;
}

export function mapBuyerFields(
  buyerQuestions: readonly SnapshotQuestion[],
  firstTicketQuestions: readonly SnapshotQuestion[],
  session: MapperSession,
): BuyerFields {
  const scopes = { ticket: firstTicketQuestions, buyer: buyerQuestions };
  const phone = capText(findAnswer("buyer_phone", session.questionMap, scopes), FIELD_CAPS.buyerPhone);
  const windowRaw = capText(findAnswer("dropoff_window", session.questionMap, scopes), FIELD_CAPS.windowRaw);

  let windowId: string | null = null;
  if (windowRaw.text) {
    const wanted = normalizeQuestionText(windowRaw.text);
    const hit = session.windows.find(
      (w) => normalizeQuestionText(w.label) === wanted || normalizeQuestionText(w.id) === wanted,
    );
    windowId = hit?.id ?? null;
  }

  const ack = findAnswer("acknowledgment", session.questionMap, scopes);
  return {
    buyerPhone: phone.text,
    windowId,
    windowLabelRaw: windowRaw.text,
    acknowledged: ack === undefined ? null : interpretConsent(ack),
  };
}

// ---------------------------------------------------------------------------
// Stuffy-level mapping
// ---------------------------------------------------------------------------

/**
 * Maps one ticket's answers. `windowMatched` is the order-level window result
 * (a stuffy of an order with no matching window carries `unmapped_window`).
 */
export function mapStuffyFromAnswers(
  ticketQuestions: readonly SnapshotQuestion[],
  buyerQuestions: readonly SnapshotQuestion[],
  windowMatched: boolean,
  session: MapperSession,
): Omit<MappedStuffy, "itemKey"> {
  const scopes = { ticket: ticketQuestions, buyer: buyerQuestions };
  const get = (key: QuestionFieldKey) => findAnswer(key, session.questionMap, scopes);

  const name = capText(get("stuffy_name"), FIELD_CAPS.name);
  const description = capText(get("stuffy_description"), FIELD_CAPS.description);
  const snack = capText(get("snack"), FIELD_CAPS.snack);
  const note = capText(get("note_to_santa"), FIELD_CAPS.noteToSanta);
  const care = capText(get("care_note"), FIELD_CAPS.careNote);
  const child = capText(get("child_first_name"), FIELD_CAPS.childFirstName);

  const codes: AttentionCode[] = [];
  if (hasUnmappedQuestion(ticketQuestions, session.questionMap) || hasUnmappedQuestion(buyerQuestions, session.questionMap)) {
    codes.push("unmapped_question");
  }
  if (!name.text) codes.push("missing_name");
  if (!snack.text) codes.push("missing_snack");
  if (!windowMatched) codes.push("unmapped_window");
  if ([name, description, snack, note, care, child].some((f) => f.truncated)) codes.push("truncated");

  return {
    name: name.text,
    description: description.text,
    childFirstName: child.text,
    snack: snack.text,
    noteToSanta: note.text,
    careNote: care.text,
    photoConsent: interpretConsent(get("photo_consent")),
    rawAnswers: capRawAnswers(ticketQuestions, FIELD_CAPS.rawTicketAnswer, FIELD_CAPS.rawAnswersCount),
    attentionCodes: codes,
  };
}

// ---------------------------------------------------------------------------
// Whole payment
// ---------------------------------------------------------------------------

export function isStuffyItem(item: { type: string; rateId: string | null }, session: MapperSession): boolean {
  return item.type === "ticket" && item.rateId !== null && session.ticketRateIds.includes(item.rateId);
}

export function mapPaymentToRegistrants(snapshot: PaymentSnapshot, session: MapperSession): MappedPayment {
  const tickets = snapshot.items.filter((item) => isStuffyItem(item, session));
  const buyerFields = mapBuyerFields(snapshot.buyerQuestions, tickets[0]?.questions ?? [], session);

  const order: MappedOrder = {
    paymentStatus: snapshot.status,
    buyerFirstName: snapshot.buyer.firstName,
    buyerLastName: snapshot.buyer.lastName,
    buyerEmail: snapshot.buyer.email,
    buyerPhone: buyerFields.buyerPhone,
    amountCents: snapshot.amountCents,
    refundStatus: snapshot.refundStatus,
    refundedCents: snapshot.refundedCents,
    windowId: buyerFields.windowId,
    windowLabelRaw: buyerFields.windowLabelRaw,
    buyerAnswers: capRawAnswers(snapshot.buyerQuestions, FIELD_CAPS.rawBuyerAnswer, FIELD_CAPS.buyerAnswersCount),
    acknowledged: buyerFields.acknowledged,
  };

  const succeeded = snapshot.status === "succeeded";
  const stuffies = succeeded
    ? tickets.map((item) => ({
        itemKey: item.key,
        ...mapStuffyFromAnswers(item.questions, snapshot.buyerQuestions, buyerFields.windowId !== null, session),
      }))
    : [];

  return { succeeded, order, stuffies };
}

// ---------------------------------------------------------------------------
// Display + derived refund state
// ---------------------------------------------------------------------------

/** "Unnamed stuffy, order of 3": the worker and admin label when the form gave no name. */
export function displayStuffyName(name: string | null, orderSize: number): string {
  return name && name.trim() ? name : `Unnamed stuffy, order of ${orderSize}`;
}

export interface RefundOrderState {
  refundStatus: string;
  refundedCents: number;
  paymentDeleted: boolean;
  /** The refunded_cents the admin last chose to Keep; null if never resolved. */
  refundResolutionCents: number | null;
}

/**
 * (refund_status != 'none' OR payment_deleted) AND resolution IS DISTINCT FROM refunded_cents.
 * "Keep" stores the refunded amount it accepted, so a later, bigger refund
 * reopens the flag by itself; a reversed refund closes it with no code.
 */
export function refundOpen(o: RefundOrderState): boolean {
  return (o.refundStatus !== "none" || o.paymentDeleted) && o.refundResolutionCents !== o.refundedCents;
}

/** The grey "Refunded" badge a worker sees: open AND (full refund OR payment removed). */
export function workerRefundBadge(o: RefundOrderState): boolean {
  return refundOpen(o) && (o.refundStatus === "full" || o.paymentDeleted);
}

/** The admin-only "partial refund, admin to resolve" flag. Never a per-stuffy badge. */
export function partialRefundFlag(o: RefundOrderState): boolean {
  return refundOpen(o) && o.refundStatus === "partial" && !o.paymentDeleted;
}
