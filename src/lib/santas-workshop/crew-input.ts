/**
 * Request-body validators for the crew routes. Pure (no db, no env): each returns
 * `{ ok: true, value }` or `{ ok: false, error }` (the route answers 400
 * invalid_input with that sentence). Ids that become database uuid columns
 * (idempotency keys, photo ids) must be uuids.
 */

import { isUuid } from "@/lib/utils";
import { isStuffyState, type StuffyState } from "./state-machine";
import { normalizeTagCode } from "./tag-binding";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function uuid(v: unknown, what: string): Parsed<string> {
  return typeof v === "string" && isUuid(v) ? { ok: true, value: v.toLowerCase() } : bad(`${what} is required`);
}

function state(v: unknown, what: string): Parsed<StuffyState> {
  return typeof v === "string" && isStuffyState(v) ? { ok: true, value: v } : bad(`${what} is not a known state`);
}

function optionalDate(v: unknown): Parsed<Date | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return bad("The time is not valid");
  return { ok: true, value: new Date(v) };
}

export interface TagInput {
  tagCode: string;
  expectedState: StuffyState;
  expectedTagCode: string | null;
  expectedLast4: string | null;
  confirm?: "move" | "replace";
  idempotencyKey: string;
  clientTakenAt: Date | null;
}

export function parseTagRequest(body: unknown): Parsed<TagInput> {
  const b = obj(body);
  if (!b) return bad("A request body is required");
  const code = normalizeTagCode(b.tagCode);
  if (!code.ok) return bad(code.error);
  const expectedState = state(b.expectedState, "The expected state");
  if (!expectedState.ok) return expectedState;
  if (b.expectedTagCode !== null && typeof b.expectedTagCode !== "string") return bad("The expected sticker is not valid");
  if (b.expectedLast4 !== undefined && b.expectedLast4 !== null && (typeof b.expectedLast4 !== "string" || b.expectedLast4.length === 0 || b.expectedLast4.length > 4)) return bad("The expected sticker tail is not valid");
  const key = uuid(b.idempotencyKey, "A request id");
  if (!key.ok) return key;
  if (b.confirm !== undefined && b.confirm !== "move" && b.confirm !== "replace") return bad("Unknown confirmation");
  const taken = optionalDate(b.clientTakenAt);
  if (!taken.ok) return taken;
  return {
    ok: true,
    value: {
      tagCode: code.code,
      expectedState: expectedState.value,
      expectedTagCode: (b.expectedTagCode as string | null | undefined) ?? null,
      expectedLast4: (b.expectedLast4 as string | null | undefined) ?? null,
      confirm: b.confirm as "move" | "replace" | undefined,
      idempotencyKey: key.value,
      clientTakenAt: taken.value,
    },
  };
}

export interface CheckInWithoutPhoto {
  expectedState: StuffyState;
  idempotencyKey: string;
  refundContinue: boolean;
}

export function parseCheckInWithoutPhoto(body: unknown): Parsed<CheckInWithoutPhoto> {
  const b = obj(body);
  if (!b || b.withoutPhoto !== true) return bad("A photo is required");
  if (b.expectedState !== "tagged") return bad("The expected state must be tagged");
  const key = uuid(b.idempotencyKey, "A request id");
  if (!key.ok) return key;
  return { ok: true, value: { expectedState: "tagged", idempotencyKey: key.value, refundContinue: b.refundContinue === true } };
}

export interface CheckInPhotoMeta {
  expectedState: StuffyState;
  refundContinue: boolean;
}

/** The check-in specific fields of the multipart `meta` (photo fields are parsePhotoMeta's). */
export function parseCheckInMeta(meta: unknown): Parsed<CheckInPhotoMeta> {
  const b = obj(meta);
  if (!b) return bad("The upload details are missing");
  if (b.expectedState !== "tagged") return bad("The expected state must be tagged");
  return { ok: true, value: { expectedState: "tagged", refundContinue: b.refundContinue === true } };
}

export interface PortraitPhotoMeta {
  expectedState: StuffyState;
  replace: boolean;
}

export function parsePortraitMeta(meta: unknown): Parsed<PortraitPhotoMeta> {
  const b = obj(meta);
  if (!b) return bad("The upload details are missing");
  if (b.expectedState !== "checked_in" && b.expectedState !== "portrait_taken") return bad("The expected state must be checked in or portrait taken");
  return { ok: true, value: { expectedState: b.expectedState, replace: b.replace === true } };
}

export interface PickupCheckInput {
  result: "matched" | "someone_else";
  note: string | null;
  idempotencyKey: string;
}

export const PICKUP_NOTE_MAX = 500;

export function parsePickupCheck(body: unknown): Parsed<PickupCheckInput> {
  const b = obj(body);
  if (!b) return bad("A request body is required");
  if (b.result !== "matched" && b.result !== "someone_else") return bad("Choose matched or someone else");
  const key = uuid(b.idempotencyKey, "A request id");
  if (!key.ok) return key;
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") return bad("The note is not valid");
    note = b.note.trim().slice(0, PICKUP_NOTE_MAX) || null;
  }
  return { ok: true, value: { result: b.result, note, idempotencyKey: key.value } };
}

export interface PickupInput {
  expectedState: "checked_in" | "portrait_taken";
  idempotencyKey: string;
}

export function parsePickup(body: unknown): Parsed<PickupInput> {
  const b = obj(body);
  if (!b) return bad("A request body is required");
  if (b.expectedState !== "checked_in" && b.expectedState !== "portrait_taken") return bad("The expected state must be checked in or portrait taken");
  const key = uuid(b.idempotencyKey, "A request id");
  if (!key.ok) return key;
  return { ok: true, value: { expectedState: b.expectedState, idempotencyKey: key.value } };
}

export interface RevertInput {
  toState: StuffyState;
  expectedState: StuffyState;
}

export function parseRevert(body: unknown): Parsed<RevertInput> {
  const b = obj(body);
  if (!b) return bad("A request body is required");
  const to = state(b.toState, "The target state");
  if (!to.ok) return to;
  const expected = state(b.expectedState, "The expected state");
  if (!expected.ok) return expected;
  return { ok: true, value: { toState: to.value, expectedState: expected.value } };
}

export function parseAttempt(header: string | null): number {
  const n = Number(header);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 1;
}

export { uuid as parseUuid };

export function parsePickupName(body: unknown): Parsed<{ idempotencyKey: string }> {
  const b = obj(body);
  if (!b) return bad("A request body is required");
  const key = uuid(b.idempotencyKey, "A request id");
  return key.ok ? { ok: true, value: { idempotencyKey: key.value } } : key;
}
