/**
 * Manual add validation (pure, client-safe): the chair adds a registrant who did
 * not come through Zeffy (a phone call, a paper sign-up). Phone-usable, so only
 * what a person at the table can supply is required: parent first and last name,
 * the stuffy's name, a drop-off window and a REASON (kept in the history). Email,
 * phone, description, snack and notes are optional. The order is flagged
 * `source: 'manual'`; corrections are Withdraw + Add again (ruling 16).
 */

import { isUuid } from "@/lib/utils";
import { FIELD_CAPS } from "./payment-mapper";
import type { AdminErrorCode } from "./admin-contract";

export const MANUAL_REASON_MIN = 3;
export const MANUAL_REASON_MAX = 500;
export const MANUAL_NAME_MAX = 200;
export const MANUAL_EMAIL_MAX = 254;

export interface ManualAddInput {
  parentFirstName: string;
  parentLastName: string;
  stuffyName: string;
  description: string | null;
  windowId: string;
  snack: string | null;
  noteToSanta: string | null;
  careNote: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  photoConsent: boolean;
  reason: string;
  idempotencyKey: string;
}

export type ManualAddValidated =
  | { ok: true; value: ManualAddInput }
  | { ok: false; error: string; code: AdminErrorCode; field: string };

const bad = (field: string, error: string): ManualAddValidated => ({ ok: false, error, code: "invalid_input", field });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(v: unknown, field: string, max: number, required: boolean): { ok: true; value: string | null } | { ok: false; field: string; error: string } {
  if (v === undefined || v === null || v === "") {
    return required ? { ok: false, field, error: `${field} is required` } : { ok: true, value: null };
  }
  if (typeof v !== "string") return { ok: false, field, error: `${field} must be text` };
  const t = v.trim();
  if (!t) return required ? { ok: false, field, error: `${field} is required` } : { ok: true, value: null };
  if ([...t].length > max) return { ok: false, field, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: t };
}

export function validateManualAdd(body: unknown, windows: readonly { id: string }[]): ManualAddValidated {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return bad("body", "A request body is required");

  const parentFirstName = text(b.parentFirstName, "parentFirstName", MANUAL_NAME_MAX, true);
  if (!parentFirstName.ok) return bad(parentFirstName.field, parentFirstName.error);
  const parentLastName = text(b.parentLastName, "parentLastName", MANUAL_NAME_MAX, true);
  if (!parentLastName.ok) return bad(parentLastName.field, parentLastName.error);
  const stuffyName = text(b.stuffyName, "stuffyName", FIELD_CAPS.name, true);
  if (!stuffyName.ok) return bad(stuffyName.field, stuffyName.error);
  const description = text(b.description, "description", FIELD_CAPS.description, false);
  if (!description.ok) return bad(description.field, description.error);
  const snack = text(b.snack, "snack", FIELD_CAPS.snack, false);
  if (!snack.ok) return bad(snack.field, snack.error);
  const noteToSanta = text(b.noteToSanta, "noteToSanta", FIELD_CAPS.noteToSanta, false);
  if (!noteToSanta.ok) return bad(noteToSanta.field, noteToSanta.error);
  const careNote = text(b.careNote, "careNote", FIELD_CAPS.careNote, false);
  if (!careNote.ok) return bad(careNote.field, careNote.error);
  const parentEmail = text(b.parentEmail, "parentEmail", MANUAL_EMAIL_MAX, false);
  if (!parentEmail.ok) return bad(parentEmail.field, parentEmail.error);
  if (parentEmail.value && !EMAIL.test(parentEmail.value)) return bad("parentEmail", "That email address does not look right");
  const parentPhone = text(b.parentPhone, "parentPhone", FIELD_CAPS.buyerPhone, false);
  if (!parentPhone.ok) return bad(parentPhone.field, parentPhone.error);

  if (typeof b.windowId !== "string" || !windows.some((w) => w.id === b.windowId)) return bad("windowId", "Choose one of the session's drop-off windows");

  const reason = text(b.reason, "reason", MANUAL_REASON_MAX, true);
  if (!reason.ok) return bad(reason.field, reason.error);
  if ((reason.value as string).length < MANUAL_REASON_MIN) return bad("reason", `Give a reason of at least ${MANUAL_REASON_MIN} characters`);

  if (typeof b.idempotencyKey !== "string" || !isUuid(b.idempotencyKey)) return bad("idempotencyKey", "A request id is required");

  return {
    ok: true,
    value: {
      parentFirstName: parentFirstName.value as string,
      parentLastName: parentLastName.value as string,
      stuffyName: stuffyName.value as string,
      description: description.value,
      windowId: b.windowId as string,
      snack: snack.value,
      noteToSanta: noteToSanta.value,
      careNote: careNote.value,
      parentEmail: parentEmail.value,
      parentPhone: parentPhone.value,
      photoConsent: b.photoConsent === true,
      reason: reason.value as string,
      idempotencyKey: b.idempotencyKey.toLowerCase(),
    },
  };
}
