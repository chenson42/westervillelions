/**
 * Pure helpers for the Approvals page and the Approve / Reject dialogs
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3).
 * Kept out of the components so the rules that must agree with the routes
 * (who may Approve / Reject, what a failed request does) are testable without
 * a DOM. Branches on the response `code`, never on the English `error` string.
 */

import {
  describeApprovalConflict,
  isApprovalConflict,
  type ApprovalKind,
} from "@/lib/ledger-approval";

export const SELF_ROW_MESSAGE =
  "You recorded this, so another board member must decide it.";

export const APPROVE_HINT = "Add a minute reference to enable Approve.";

/** Shown when a 409 body is not the typed carrier (proxy, older deploy). */
export const GENERIC_CONFLICT_MESSAGE = "This entry is no longer waiting for approval.";
export const NOT_FOUND_MESSAGE = "This entry no longer exists.";

/**
 * Which controls a pending row offers the viewer. Reject is hidden (not just
 * disabled) on a row the viewer recorded because the routes 403 it.
 */
export function rowActions(isSelf: boolean): {
  approve: boolean;
  reject: boolean;
  selfMessage: string | null;
} {
  return isSelf
    ? { approve: false, reject: false, selfMessage: SELF_ROW_MESSAGE }
    : { approve: true, reject: true, selfMessage: null };
}

export interface ApprovalFailureAction {
  /** Close the dialog (the decision is already made, or the row is gone). */
  close: boolean;
  /** Refresh the server render so the card leaves the list. */
  refresh: boolean;
  toastKind: "info" | "error";
  message: string;
}

/**
 * What a non-2xx response (or a network failure, status null) should do.
 * 409 and 404 close + refresh; everything else keeps the dialog open so the
 * typed minute or reason is preserved.
 */
export function approvalFailureAction(
  status: number | null,
  body: unknown,
  verb: "approve" | "reject",
  noun: ApprovalKind = "disbursement",
): ApprovalFailureAction {
  if (status === 409) {
    return {
      close: true,
      refresh: true,
      toastKind: "info",
      message: isApprovalConflict(body)
        ? describeApprovalConflict(body, noun)
        : GENERIC_CONFLICT_MESSAGE,
    };
  }
  if (status === 404) {
    return { close: true, refresh: true, toastKind: "error", message: NOT_FOUND_MESSAGE };
  }
  const serverError =
    status !== null &&
    body &&
    typeof body === "object" &&
    typeof (body as { error?: unknown }).error === "string" &&
    (body as { error: string }).error.trim()
      ? (body as { error: string }).error
      : null;
  return {
    close: false,
    refresh: false,
    toastKind: "error",
    message: serverError ?? `Could not ${verb} ${noun}. Please try again.`,
  };
}

/** The line explaining a disabled Approve button, or null when it is enabled. */
export function approveHint(
  boardMinute: string,
  existingBoardMinute: string | null | undefined,
): string | null {
  return boardMinute.trim() || existingBoardMinute ? null : APPROVE_HINT;
}
