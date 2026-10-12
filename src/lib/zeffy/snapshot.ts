/**
 * Payment -> PaymentSnapshot: the WHITELIST projection (DECISION-123).
 *
 * The snapshot is the only shape that crosses into storage (zeffy_events.payload,
 * sw_orders) and the only input to the workshop mapper. It deliberately drops
 * the buyer's address, receipt URL, payment method, dispute, discount, tribute,
 * contact and fund. Pure: no IO, no clock.
 *
 * A CSV adapter (contingent, B-167 backlog text) would map into this same shape.
 */

import { isQuestionAnswer, isRecord, type ZeffyPayment } from "./types";

/** Longest question text / answer string kept. The workshop mapper applies its own, smaller, per-field caps. */
export const SNAPSHOT_QUESTION_MAX = 300;
export const SNAPSHOT_ANSWER_MAX = 20_000;
const SNAPSHOT_ARRAY_ELEMENT_MAX = 500;
const SNAPSHOT_ARRAY_MAX = 50;
const SNAPSHOT_QUESTIONS_MAX = 60;
const SNAPSHOT_ITEMS_MAX = 200;
const NAME_MAX = 200;
const EMAIL_MAX = 320;

export type SnapshotAnswer = string | string[] | boolean;

export interface SnapshotQuestion {
  question: string;
  type: string;
  answer: SnapshotAnswer;
}

export interface SnapshotItem {
  /** Our stable key for the item (see itemKey). */
  key: string;
  type: string;
  rateId: string | null;
  amountCents: number;
  questions: SnapshotQuestion[];
}

export type SnapshotRefundStatus = "none" | "partial" | "full";

export interface PaymentSnapshot {
  paymentId: string;
  status: string;
  paymentType: string | null;
  campaignId: string | null;
  amountCents: number;
  refundStatus: SnapshotRefundStatus;
  /** Sum of SUCCEEDED refunds, in cents. */
  refundedCents: number;
  /** Unix seconds when Zeffy created the payment; null when absent. */
  createdAtSeconds: number | null;
  buyer: { email: string | null; firstName: string | null; lastName: string | null };
  buyerQuestions: SnapshotQuestion[];
  items: SnapshotItem[];
}

export type SnapshotResult =
  | { ok: true; snapshot: PaymentSnapshot }
  | { ok: false; reason: "invalid" };

/**
 * How an item is keyed. `item_id` is believed stable across an order edit
 * (Ruling 5); the S2 spike settles it. If S2 shows otherwise, flip this one
 * constant (the column is the neutral `zeffy_item_key`, so no migration).
 */
export const ITEM_KEY_STRATEGY: "item_id" | "index" = "item_id";

export function itemKey(
  paymentId: string,
  item: { id?: string | null },
  index: number,
  strategy: "item_id" | "index" = ITEM_KEY_STRATEGY,
): string {
  if (strategy === "item_id" && typeof item.id === "string" && item.id.length > 0) {
    return item.id;
  }
  return `${paymentId}#${index}`;
}

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function capNullable(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? cap(value.trim(), max) : null;
}

function toCents(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeAnswer(answer: unknown): SnapshotAnswer {
  if (typeof answer === "boolean") return answer;
  if (Array.isArray(answer)) {
    return answer
      .filter((x): x is string => typeof x === "string")
      .slice(0, SNAPSHOT_ARRAY_MAX)
      .map((x) => cap(x, SNAPSHOT_ARRAY_ELEMENT_MAX));
  }
  return typeof answer === "string" ? cap(answer, SNAPSHOT_ANSWER_MAX) : "";
}

function toQuestions(value: unknown): SnapshotQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: SnapshotQuestion[] = [];
  for (const q of value) {
    if (!isQuestionAnswer(q)) continue;
    out.push({
      question: cap(q.question, SNAPSHOT_QUESTION_MAX),
      type: cap(q.type, 40),
      answer: normalizeAnswer(q.answer),
    });
    if (out.length >= SNAPSHOT_QUESTIONS_MAX) break;
  }
  return out;
}

function refundStatusOf(value: unknown): SnapshotRefundStatus {
  return value === "partial" || value === "full" ? value : "none";
}

/** Sums SUCCEEDED refunds only (a pending or failed refund is not money returned). */
function refundedCentsOf(refunds: unknown): number {
  if (!Array.isArray(refunds)) return 0;
  let total = 0;
  for (const r of refunds) {
    if (isRecord(r) && r.status === "succeeded") total += toCents(r.amount);
  }
  return total;
}

export function toSnapshot(payment: unknown): SnapshotResult {
  if (!isRecord(payment)) return { ok: false, reason: "invalid" };
  const p = payment as Partial<ZeffyPayment> & Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || p.id.length > 200) return { ok: false, reason: "invalid" };
  if (typeof p.status !== "string" || !p.status) return { ok: false, reason: "invalid" };

  const buyer = isRecord(p.buyer) ? p.buyer : {};
  const rawItems = Array.isArray(p.items) ? p.items.slice(0, SNAPSHOT_ITEMS_MAX) : [];
  const items: SnapshotItem[] = [];
  rawItems.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.type !== "string") return;
    items.push({
      key: itemKey(p.id as string, raw as { id?: string }, index),
      type: cap(raw.type, 40),
      rateId: typeof raw.rate_id === "string" && raw.rate_id ? cap(raw.rate_id, 200) : null,
      amountCents: toCents(raw.amount),
      questions: toQuestions(raw.questions),
    });
  });

  return {
    ok: true,
    snapshot: {
      paymentId: p.id,
      status: cap(p.status, 40),
      paymentType: capNullable(p.type, 40),
      campaignId: capNullable(p.campaign_id, 200),
      amountCents: toCents(p.amount),
      refundStatus: refundStatusOf(p.refund_status),
      refundedCents: refundedCentsOf(p.refunds),
      createdAtSeconds:
        typeof p.created === "number" && Number.isFinite(p.created) ? Math.round(p.created) : null,
      buyer: {
        email: capNullable(buyer.email, EMAIL_MAX),
        firstName: capNullable(buyer.first_name, NAME_MAX),
        lastName: capNullable(buyer.last_name, NAME_MAX),
      },
      buyerQuestions: toQuestions(p.buyer_questions),
      items,
    },
  };
}

/** True for a value that has the shape of a stored PaymentSnapshot (as kept on zeffy_events.payload). */
export function isPaymentSnapshot(value: unknown): value is PaymentSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.paymentId === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.items) &&
    Array.isArray(value.buyerQuestions) &&
    isRecord(value.buyer)
  );
}
