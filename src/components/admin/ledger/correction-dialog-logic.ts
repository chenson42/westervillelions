/**
 * Pure helpers behind the Move and Delete correction dialogs. Kept free of
 * React so the request shapes, validity rules and failure routing are unit
 * testable in this project's DOM-less Vitest environment.
 */

import {
  MOVE_FAILED_MESSAGE,
  normalizeCorrectionReason,
  type CorrectionErrorBody,
  type MoveInput,
} from "@/lib/ledger-correction";

export function formatMoneyCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Exactly the four keys the move route accepts; "" means "No category". */
export function buildMoveBody(input: {
  destFundId: string;
  categoryId: string;
  reason: string;
  expectedFundId: string;
}): MoveInput {
  return {
    destFundId: input.destFundId,
    categoryId: input.categoryId === "" ? null : input.categoryId,
    reason: input.reason,
    expectedFundId: input.expectedFundId,
  };
}

/** Confirm is enabled only with a destination and a valid reason. */
export function isMoveSubmittable(input: { destFundId: string; reason: string }): boolean {
  return input.destFundId !== "" && normalizeCorrectionReason(input.reason).ok;
}

export function isDeleteSubmittable(input: { reason: string }): boolean {
  return normalizeCorrectionReason(input.reason).ok;
}

/** Deep link to the Activity register with the sweep form prefilled (D2). */
export function sweepDeepLink(input: {
  fundSlug: string;
  entitySlug: string;
  transactionId: string;
}): string {
  const params = new URLSearchParams({
    entity: input.entitySlug,
    sweepFrom: input.transactionId,
  });
  return `/admin/ledger/${input.fundSlug}?${params.toString()}`;
}

/**
 * How the Move dialog reacts to a failed POST.
 *  - close_and_refresh: the row changed or the caller is not allowed; toast the
 *    server's message, close, and refresh the register (403/404/409).
 *  - inline: a field problem the user can fix; keep the dialog open (400).
 *  - retry: anything else (500, network); toast and keep the dialog open.
 */
export type MoveFailureMode = "close_and_refresh" | "inline" | "retry";

export function moveFailureAction(
  status: number,
  body: Partial<CorrectionErrorBody> | null,
): { mode: MoveFailureMode; message: string } {
  const message = body?.error || MOVE_FAILED_MESSAGE;
  if (status === 403 || status === 404 || status === 409) {
    return { mode: "close_and_refresh", message };
  }
  if (status === 400) return { mode: "inline", message };
  return { mode: "retry", message: status >= 500 ? MOVE_FAILED_MESSAGE : message };
}

/** How the Delete dialog reacts to a failed DELETE; it always stays open. */
export function deleteFailureAction(
  status: number,
  body: Partial<CorrectionErrorBody> | null,
): { message: string; receiptSent: boolean } {
  const fallback = "Could not delete this transaction. Nothing was changed.";
  return {
    message: body?.error || fallback,
    receiptSent: status === 409 && body?.code === "receipt_sent",
  };
}

/**
 * What closing (or trying to close) the Move dialog does. A close while a
 * request is in flight is ignored; the register is refreshed only when the
 * dialog closes AFTER a successful move (D2: the row leaves this register, so
 * refreshing earlier would unmount the dialog's own success step).
 */
export function resolveMoveClose(input: {
  nextOpen: boolean;
  phase: "loading" | "load_error" | "blocked" | "form" | "success";
  submitting: boolean;
}): { proceed: boolean; refresh: boolean } {
  if (input.nextOpen) return { proceed: true, refresh: false };
  if (input.submitting) return { proceed: false, refresh: false };
  return { proceed: true, refresh: input.phase === "success" };
}
