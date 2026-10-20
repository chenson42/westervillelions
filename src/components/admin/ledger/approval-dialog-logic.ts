/**
 * Pure helpers for the Approvals page and the Approve / Reject dialogs
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3).
 * Kept out of the components so the rules that must agree with the routes
 * (who may Approve / Reject, what a failed request does) are testable without
 * a DOM. Branches on the response `code`, never on the English `error` string.
 */

import {
  approvalNounLabel,
  describeApprovalConflict,
  describeApprovalFund,
  displayDeciderName,
  formatDecisionDateTime,
  isApprovalConflict,
  isCosignConflict,
  isCosignForbidden,
  isDecideTheBatch,
  type ApprovalKind,
  type CosignerView,
  type DecidedApprovalRow,
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
  /**
   * Lost the approve race to someone else's approval: leave the dialog and land
   * on the entry (`approvalEntryHref`) where Add your approval is offered.
   * Supersedes `refresh` at the call site.
   */
  showEntry: boolean;
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
  // A copy's id reached the route (B-172 Inc 2a ruling A5). The page lists only
  // legs, so this is a stale or hand-made request: say what the server said,
  // close, and reload the list.
  if (status === 400 && isDecideTheBatch(body)) {
    return { close: true, refresh: true, showEntry: false, toastKind: "error", message: body.error };
  }
  if (status === 409) {
    return {
      close: true,
      refresh: true,
      showEntry:
        verb === "approve" &&
        isApprovalConflict(body) &&
        body.decision === "approved" &&
        !body.decidedByViewer,
      toastKind: "info",
      message: isApprovalConflict(body)
        ? describeApprovalConflict(body, noun, verb)
        : GENERIC_CONFLICT_MESSAGE,
    };
  }
  if (status === 404) {
    return {
      close: true,
      refresh: true,
      showEntry: false,
      toastKind: "error",
      message: NOT_FOUND_MESSAGE,
    };
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
    showEntry: false,
    toastKind: "error",
    message: serverError ?? `Could not ${verb} ${noun}. Please try again.`,
  };
}

/**
 * The sentence a batch's Approve or Reject dialog adds (B-172 Increment 2b, B8).
 * One decision covers every gift, so say so before the approver commits.
 */
export function describeBatchDecision(verb: "approve" | "reject", count: number): string {
  const gifts = count === 1 ? "1 gift" : `${count} gifts`;
  return `This decides the whole batch of ${gifts}; individual gifts cannot be decided separately. ${
    verb === "approve" ? "Approving posts all of them." : "Rejecting frees all of them to be swept again."
  }`;
}

/** The line explaining a disabled Approve button, or null when it is enabled. */
export function approveHint(
  boardMinute: string,
  existingBoardMinute: string | null | undefined,
): string | null {
  return boardMinute.trim() || existingBoardMinute ? null : APPROVE_HINT;
}

// Noun-correct dialog copy (Increment 1 Phase 6 finding F1): a Transfer or Sweep
// dialog must never say "disbursement".

/** "Approve Sweep" / "Reject Transfer" / "Approve Disbursement". */
export function approvalDialogTitle(verb: "approve" | "reject", noun: ApprovalKind): string {
  return `${verb === "approve" ? "Approve" : "Reject"} ${approvalNounLabel(noun)}`;
}

/** "Sweep approved." / "Transfer rejected." */
export function approvalSuccessMessage(verb: "approve" | "reject", noun: ApprovalKind): string {
  return `${approvalNounLabel(noun)} ${verb === "approve" ? "approved" : "rejected"}.`;
}

export function rejectPlaceholder(noun: ApprovalKind): string {
  return `Explain why this ${noun} is being rejected…`;
}

export function minuteHelper(noun: ApprovalKind): string {
  return `Enter the board-meeting minute or motion reference that authorized this ${noun}.`;
}

export function minuteRequiredMessage(noun: ApprovalKind): string {
  return `A board-minute reference is required to approve a ${noun}.`;
}

/**
 * Where the approve dialog sends someone who lost the race to a colleague's
 * approval. Built from the dialog's own transaction id (the expense leg the
 * card rendered from), never from the response.
 */
export function approvalEntryHref(transactionId: string): string {
  return `/admin/ledger/approvals?txn=${encodeURIComponent(transactionId)}`;
}

// ---------------------------------------------------------------------------
// Increment 2b: "Add your approval" (informational co-sign).
// ---------------------------------------------------------------------------

export const COSIGN_SUCCESS_MESSAGE = "Your approval was added.";
export const COSIGN_RETRY_MESSAGE = "Could not add your approval. Please try again.";
export const COSIGN_NOT_FOUND_MESSAGE = "We can't find that entry. It may have been deleted.";
export const COSIGN_HELP_LINE =
  "These are already posted. You can add your approval to any entry you did not record.";

/** The request the co-sign dialog sends: POST, no body, no Content-Type. */
export function cosignRequest(transactionId: string): { url: string; init: RequestInit } {
  return {
    url: `/api/admin/ledger/transactions/${encodeURIComponent(transactionId)}/cosign`,
    init: { method: "POST" },
  };
}

export interface CosignFailureAction {
  /** Close the dialog (the answer is final, or the row is gone). */
  close: boolean;
  /** Refresh the server render so the entry shows its true state. */
  refresh: boolean;
  toastKind: "info" | "error";
  message: string;
}

const onDate = (iso: string | null): string => {
  const d = iso ? formatDecisionDateTime(iso) : "";
  return d ? ` on ${d}` : "";
};

/**
 * What a non-2xx response (or a network failure, status null) from the cosign
 * route should do. Branches on `code`, never on the English `error`. Every
 * typed refusal closes and refreshes with an info toast; an already-added
 * approval is success-shaped. Anything else keeps the dialog open.
 */
export function cosignFailureAction(
  status: number | null,
  body: unknown,
  noun: ApprovalKind = "disbursement",
): CosignFailureAction {
  const done = (message: string, toastKind: "info" | "error" = "info"): CosignFailureAction => ({
    close: true,
    refresh: true,
    toastKind,
    message,
  });

  if (status === 409) {
    if (!isCosignConflict(body)) {
      return done("This entry can no longer take your approval. It has been refreshed.");
    }
    switch (body.code) {
      case "already_cosigned":
        return done(`You already added your approval${onDate(body.at)}.`);
      case "already_approved":
        return done(`You approved this${onDate(body.at)}.`);
      case "not_approved":
        return done("This entry is still waiting for its first approval.");
      case "rejected": {
        const who = displayDeciderName(body.deciderName) ?? "A board member";
        return done(`${who} rejected this ${noun}${onDate(body.at)}, so it cannot take more approvals.`);
      }
      case "not_board_decision":
        return done("This entry did not need board approval.");
      default: {
        const _exhaustive: never = body.code;
        return _exhaustive;
      }
    }
  }
  if (status === 403 && isCosignForbidden(body)) {
    return done("You recorded this entry, so another board member needs to approve it.");
  }
  if (status === 404) return done(COSIGN_NOT_FOUND_MESSAGE, "error");

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
    message: serverError ?? COSIGN_RETRY_MESSAGE,
  };
}

/** The strings the co-sign dialog shows, from the embedded approved row. No user ids. */
export interface CosignDialogProps {
  transactionId: string;
  amountText: string;
  party: string;
  noun: ApprovalKind;
  fundText: string;
  memo: string | null;
  recorderName: string | null;
  boardMinute: string;
}

export function cosignDialogProps(
  row: Extract<DecidedApprovalRow, { decision: "approved" }>,
  amountText: string,
): CosignDialogProps {
  const fund = describeApprovalFund({
    fundName: row.fundName,
    partnerFundName: row.partnerFundName,
    entityId: row.entityId,
    partnerEntityId: row.partnerEntityId,
    entityName: row.entityName,
    partnerEntityName: row.partnerEntityName,
  });
  return {
    transactionId: row.id,
    amountText,
    party: row.party ?? "",
    noun: row.kind,
    fundText: fund.text,
    memo: row.memo,
    recorderName: row.recorderName,
    boardMinute: row.boardMinute,
  };
}

const shortDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(d);
};

/**
 * "Ann (Oct 10), You (Oct 11), 2 other board members" for the History card:
 * every co-signer, time order, the viewer as "You", unnamed accounts collapsed
 * into one trailing item. Empty array when there are none (the line is then
 * not rendered). Never an email, a fraction of the board, or "votes".
 */
export function cosignerItems(cosigners: readonly CosignerView[]): string[] {
  const items: string[] = [];
  let unnamed = 0;
  for (const c of cosigners) {
    const name = c.isViewer ? "You" : displayDeciderName(c.name);
    if (!name) {
      unnamed += 1;
      continue;
    }
    const when = shortDate(c.cosignedAt);
    items.push(when ? `${name} (${when})` : name);
  }
  if (unnamed === 1) items.push("a board member");
  else if (unnamed > 1) {
    items.push(items.length > 0 ? `${unnamed} other board members` : `${unnamed} board members`);
  }
  return items;
}
