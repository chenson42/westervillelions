/**
 * Pure helpers for the batch dialog (B-172 Increment 2b, B3, B9). Branches on the
 * response `code`, never on the English `error` string; every refusal's words come
 * from the carrier (`SWEEP_VOID_BLOCK_COPY`), never retyped here.
 */

import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  SWEEP_VOID_BLOCK_COPY,
  sweepBatchState,
  type SweepBatchDetail,
  type SweepBatchState,
  type SweepVoidBlock,
} from "@/lib/ledger-sweep";

/** The state of a batch from the detail the dialog loaded (approved is a boolean there). */
export function detailBatchState(detail: Pick<SweepBatchDetail, "status" | "approved">): SweepBatchState {
  return sweepBatchState({ status: detail.status, approvedAt: detail.approved ? "approved" : null });
}

export const SWEEP_VOID_REASON_HELP =
  "For example: entered against the wrong bank deposit. Do not type a donor's name; the reason is kept for the board to read.";

export const SWEEP_VOID_GENERIC_ERROR = "Could not void this batch. Nothing was changed.";
export const SWEEP_BATCH_LOAD_ERROR = "Could not load this batch. Close this and try again.";

export interface SweepVoidFailure {
  /** What happened. */
  message: string;
  /** What to do about it; null when the server gave no typed next step. */
  nextStep: string | null;
  /** The page's data is out of date: refresh it and reload the dialog. */
  refresh: boolean;
}

function isVoidBlock(code: unknown): code is SweepVoidBlock {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(SWEEP_VOID_BLOCK_COPY, code);
}

/**
 * What a non-2xx void response (or a network failure, status null) shows. Every
 * `SweepVoidBlock` renders the carrier's message and next step. A block that says
 * the batch's state moved under the viewer (pending, rejected, approved, gone)
 * also asks for a refresh so the chip and the dialog catch up.
 */
export function voidFailure(status: number | null, body: unknown, labels: FundLabels): SweepVoidFailure {
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (status === 409 || status === 404) {
    if (isVoidBlock(code)) {
      const copy = SWEEP_VOID_BLOCK_COPY[code](labels);
      const stale =
        code === "pending_use_reject" || code === "already_rejected" || code === "approved" || code === "not_found";
      return { message: copy.message, nextStep: copy.nextStep, refresh: stale };
    }
    return { message: SWEEP_VOID_BLOCK_COPY.not_found(labels).message, nextStep: SWEEP_VOID_BLOCK_COPY.not_found(labels).nextStep, refresh: true };
  }
  const serverError =
    status !== null && body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error.trim()
      : "";
  if (status === 400 && code === "reason_required" && serverError) {
    return { message: serverError, nextStep: null, refresh: false };
  }
  return { message: SWEEP_VOID_GENERIC_ERROR, nextStep: null, refresh: false };
}

export function voidSuccessMessage(copiesRemoved: number): string {
  return `Batch voided. ${copiesRemoved} ${copiesRemoved === 1 ? "gift is" : "gifts are"} free to sweep again.`;
}

/** The state as a short label for the dialog header. */
export const SWEEP_STATE_LABEL: Record<SweepBatchState, string> = {
  pending: "Waiting for board approval",
  posted: "Posted",
  approved: "Approved by the board",
  rejected: "Rejected",
};
