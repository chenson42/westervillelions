/**
 * Hand-typed subset of the Zeffy public API (https://api.zeffy.com/api/docs,
 * OpenAPI 3.1). Only fields this codebase reads are declared; everything is
 * optional-leaning because the payload is external input. Narrow with the
 * guards below, never with a cast.
 *
 * Nothing in src/lib/zeffy/ knows about the workshop (consumer-injection test).
 */

export interface ZeffyQuestionAnswer {
  question: string;
  type: string;
  answer: string | string[] | boolean;
}

export interface ZeffyRefund {
  id?: string;
  /** Cents. */
  amount: number;
  status: string;
}

export interface ZeffyItem {
  id?: string;
  /** "donation" | "ticket" | "additional_donation" */
  type: string;
  /** Cents. */
  amount?: number;
  rate_id?: string | null;
  rate_title?: string | null;
  questions?: ZeffyQuestionAnswer[];
}

export interface ZeffyBuyer {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface ZeffyPayment {
  id: string;
  /** Unix seconds. */
  created?: number;
  /** Cents. */
  amount?: number;
  status: string;
  type?: string;
  /** "none" | "partial" | "full" */
  refund_status?: string;
  refunds?: ZeffyRefund[];
  buyer?: ZeffyBuyer;
  campaign_id?: string;
  campaign_category?: string;
  buyer_questions?: ZeffyQuestionAnswer[];
  items?: ZeffyItem[];
}

export interface ZeffyRate {
  id: string;
  title: string;
  /** Cents. */
  amount?: number;
}

export interface ZeffyOccurrence {
  id: string;
  start?: number;
  end?: number;
}

export interface ZeffyCampaign {
  id: string;
  title: string;
  type?: string;
  status?: string;
  start_date?: number | null;
  end_date?: number | null;
  rates?: ZeffyRate[];
  occurrences?: ZeffyOccurrence[];
}

/** The webhook envelope shared by every event. `data` depends on `type`. */
export interface ZeffyEnvelope {
  id: string;
  type: string;
  version: number;
  dispatchedAt: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A parsed envelope, or null when the shape is wrong (then there is no id to claim). */
export function parseEnvelope(json: unknown): ZeffyEnvelope | null {
  if (!isRecord(json)) return null;
  const { id, type, version, dispatchedAt, data } = json;
  if (!isNonEmptyString(id) || id.length > 200) return null;
  if (!isNonEmptyString(type) || type.length > 100) return null;
  if (typeof version !== "number" || !Number.isInteger(version)) return null;
  if (typeof dispatchedAt !== "string" || Number.isNaN(Date.parse(dispatchedAt))) return null;
  return { id, type, version, dispatchedAt, data };
}

/** `{ id }` of an id-only reference (payment.updated / payment.deleted), else null. */
export function paymentReferenceId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return isNonEmptyString(data.id) && data.id.length <= 200 ? data.id : null;
}

export function isQuestionAnswer(value: unknown): value is ZeffyQuestionAnswer {
  if (!isRecord(value)) return false;
  if (typeof value.question !== "string" || typeof value.type !== "string") return false;
  const a = value.answer;
  return (
    typeof a === "string" ||
    typeof a === "boolean" ||
    (Array.isArray(a) && a.every((x) => typeof x === "string"))
  );
}

export function isCampaign(value: unknown): value is ZeffyCampaign {
  return isRecord(value) && isNonEmptyString(value.id) && typeof value.title === "string";
}
