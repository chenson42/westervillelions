/**
 * Pure logic for the sweep builder (B-172 Increment 2b, rulings B1, B2, B5, B6,
 * B7). Client-safe: no database import. Every code, copy record and type comes
 * from the carrier `@/lib/ledger-sweep`; nothing here types a fund name.
 */

import { normalizeCorrectionReason } from "@/lib/ledger-correction";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  BOARD_MINUTE_MAX_LEN,
  SWEEP_BATCH_MAX,
  SWEEP_ERROR_COPY,
  SWEEP_INT4_MAX,
  type FoundationReceiptState,
  type SweepBatchCreatedResponse,
  type SweepErrorBody,
  type SweepErrorCode,
  type SweepPreviewResponse,
  type SweepRowRefusal,
} from "@/lib/ledger-sweep";

export { BOARD_MINUTE_MAX_LEN };

function money(cents: number): string {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "Mar 4, 2026" from "2026-03-04", with no Date-in-local-time hazard. */
export function formatSweepDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const formatSweepMoney = money;

// ---------------------------------------------------------------------------
// Date (B5)
// ---------------------------------------------------------------------------

/** A sweep is recorded after the money moves; both strings are YYYY-MM-DD (Eastern today). */
export function isFutureSweepDate(sweepDate: string, today: string): boolean {
  return sweepDate > today;
}

// ---------------------------------------------------------------------------
// Tier line (B2)
// ---------------------------------------------------------------------------

export interface SweepTierLine {
  /** Posts now, or waits for the board. */
  statusLine: string;
  /** Present only when the batch needs the Manage Ledger permission and a reason. */
  tierLine: string | null;
}

/**
 * The tier, needs-reason and pending/posted text, or null. Null for a preview
 * with no accepted gift (`count === 0`), which includes an all-refused one: the
 * server's tier is read over refused rows on purpose (a record-only caller must
 * still see `manage`), so it must never be printed for a batch that is not one.
 */
export function sweepTierLine(preview: SweepPreviewResponse): SweepTierLine | null {
  if (preview.count === 0) return null;
  const statusLine =
    preview.status === "pending"
      ? `This sweep is over the board's approval threshold of ${money(preview.thresholdCents)}, so it goes to the board and posts when one approver agrees.`
      : `This sweep is within the board's approval threshold of ${money(preview.thresholdCents)}, so it posts right away.`;
  const tierLine =
    preview.tier === "manage" || preview.needsReason
      ? "It includes a gift, or a sweep date, from an earlier fiscal year. That needs the Manage Ledger permission and a reason."
      : null;
  return { statusLine, tierLine };
}

// ---------------------------------------------------------------------------
// Review signature and drift (B7)
// ---------------------------------------------------------------------------

/**
 * What the treasurer reviewed: the ids, each row's refusal, Foundation category,
 * receipt state and flags, and the batch figures. Typed-amount fields are left
 * out on purpose (they follow the keyboard, not the books).
 */
export function reviewSignature(preview: SweepPreviewResponse): string {
  return JSON.stringify({
    rows: preview.rows.map((r) => [
      r.sourceId,
      r.refusal,
      r.foundationCategoryId,
      r.foundationReceipt,
      r.receiptSentOn,
      r.amountCents,
      [...r.flags].sort(),
    ]),
    totalCents: preview.totalCents,
    count: preview.count,
    status: preview.status,
    tier: preview.tier,
    needsReason: preview.needsReason,
    canPost: preview.canPost,
    fiscalYears: preview.fiscalYears,
    sentStatementMonths: preview.sentStatementMonths,
    warnings: preview.warnings,
  });
}

export function reviewDrifted(reviewed: SweepPreviewResponse, latest: SweepPreviewResponse): boolean {
  return reviewSignature(reviewed) !== reviewSignature(latest);
}

export const DRIFT_MESSAGE = "The list changed while you were reviewing. Check it and post again.";

// ---------------------------------------------------------------------------
// Submit gating
// ---------------------------------------------------------------------------

export interface SweepSubmitState {
  preview: SweepPreviewResponse | null;
  /** The typed bank amount parsed by `parseDollarsToCents`; null when empty or invalid. */
  typedCents: number | null;
  boardMinute: string;
  priorYearReason: string;
  sweepDate: string;
  today: string;
  submitting: boolean;
  previewLoading: boolean;
}

export function canSubmitSweep(s: SweepSubmitState): boolean {
  const p = s.preview;
  if (!p || s.submitting || s.previewLoading) return false;
  if (!p.canPost || p.count === 0 || p.totalCents > SWEEP_INT4_MAX) return false;
  if (s.typedCents === null || s.typedCents !== p.totalCents) return false;
  const minute = s.boardMinute.trim();
  if (minute === "" || minute.length > BOARD_MINUTE_MAX_LEN) return false;
  if (p.needsReason && !normalizeCorrectionReason(s.priorYearReason).ok) return false;
  if (!s.sweepDate || isFutureSweepDate(s.sweepDate, s.today)) return false;
  return true;
}

/** Live "the bank amount is $X more or less than the gifts" sentence, or null. */
export function describeBankDifference(totalCents: number, typedCents: number | null): string | null {
  if (typedCents === null) return null;
  const diff = typedCents - totalCents;
  if (diff === 0) return null;
  return diff > 0
    ? `That is ${money(diff)} more than the selected gifts total.`
    : `That is ${money(-diff)} less than the selected gifts total.`;
}

// ---------------------------------------------------------------------------
// Create failures (B6)
// ---------------------------------------------------------------------------

/** What each server code means to the builder. A new code is a compile error. */
export const CREATE_CODE_KIND: Record<SweepErrorCode, "fix" | "denied" | "refresh" | "claimed"> = {
  invalid_body: "fix",
  invalid_id: "fix",
  no_rows: "fix",
  batch_too_large: "fix",
  duplicate_ids: "fix",
  invalid_date: "fix",
  future_date: "fix",
  invalid_amount: "fix",
  minute_required: "fix",
  reason_required: "fix",
  bank_account_invalid: "fix",
  fund_not_found: "fix",
  direction_denied: "fix",
  use_sweep_batch: "fix",
  total_mismatch: "fix",
  total_too_large: "fix",
  manage_required: "denied",
  rows_refused: "refresh",
  rows_claimed: "claimed",
};

export type CreateFailure =
  /** The create was accepted. */
  | { kind: "created"; created: SweepBatchCreatedResponse }
  /** The outcome is unknown (network, 5xx, or a claim after our own send): check by preview. */
  | { kind: "verify" }
  /** Someone else got there first, or rows were refused: refresh the list. */
  | { kind: "refresh"; message: string; rows: { sourceId: string; code: SweepRowRefusal }[] }
  /** The treasurer can fix an input and post again. */
  | { kind: "fix"; message: string }
  | { kind: "denied"; message: string };

function isErrorBody(value: unknown): value is SweepErrorBody {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { code?: unknown }).code === "string" &&
    (value as { code: string }).code in CREATE_CODE_KIND
  );
}

/**
 * Read a create response. `status` is null for a network error. `priorAttempt`
 * is true once this page instance has already sent a create. An unknown outcome
 * is never a "failed" screen (B6): it asks for a verification preview.
 */
export function interpretCreateFailure(input: {
  status: number | null;
  body: unknown;
  priorAttempt: boolean;
  labels: FundLabels;
}): CreateFailure {
  const { status, body, labels } = input;
  if (status === 201 && body && typeof body === "object" && "legId" in body) {
    return { kind: "created", created: body as SweepBatchCreatedResponse };
  }
  if (status === null || status >= 500) return { kind: "verify" };
  if (!isErrorBody(body)) return { kind: "verify" };
  const kind = CREATE_CODE_KIND[body.code];
  const message = typeof body.error === "string" && body.error ? body.error : SWEEP_ERROR_COPY[body.code](labels);
  switch (kind) {
    case "claimed":
      return input.priorAttempt
        ? { kind: "verify" }
        : { kind: "refresh", message: SWEEP_ERROR_COPY.rows_claimed(labels), rows: [] };
    case "refresh":
      return { kind: "refresh", message: SWEEP_ERROR_COPY.rows_refused(labels), rows: body.rows ?? [] };
    case "denied":
      return { kind: "denied", message };
    case "fix":
      if (body.code === "total_mismatch" && body.derivedCents !== undefined && body.typedCents !== undefined) {
        return {
          kind: "fix",
          message: `${message} The gifts total ${money(body.derivedCents)}; you entered ${money(body.typedCents)}.`,
        };
      }
      return { kind: "fix", message };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export const UNKNOWN_OUTCOME_MESSAGE =
  "These gifts are already in a sweep batch, most likely the one you just posted. Check Approvals and the registers before trying again.";
export const UNCONFIRMED_MESSAGE =
  "We could not confirm whether the sweep was recorded. Check Approvals and the registers before trying again.";
export const NOT_RECORDED_MESSAGE = "The sweep was not recorded. Nothing changed, and you can post again.";

/** After an unknown outcome: what a verification preview says. */
export function interpretVerification(
  preview: SweepPreviewResponse | null,
): "already_in_batch" | "not_recorded" | "unconfirmed" {
  if (!preview || preview.rows.length === 0) return "unconfirmed";
  const swept = preview.rows.filter((r) => r.refusal === "already_swept").length;
  if (swept === preview.rows.length) return "already_in_batch";
  if (swept === 0 && preview.rows.every((r) => r.refusal === null)) return "not_recorded";
  return "unconfirmed";
}

// ---------------------------------------------------------------------------
// Post controller: submit lock, re-preview, create (B6, B7). Pure of React.
// ---------------------------------------------------------------------------

export interface SweepPostBody {
  sourceIds: string[];
  sourceBankAccountId: string;
  destBankAccountId: string;
  sweepDate: string;
  bankAmountCents: number;
  boardMinute: string;
  priorYearReason?: string;
}

export type PostResult =
  | { kind: "ignored" }
  | { kind: "drifted"; preview: SweepPreviewResponse }
  | { kind: "preview_failed"; message: string }
  | { kind: "created"; created: SweepBatchCreatedResponse }
  | { kind: "fix"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "refresh"; message: string; rows: { sourceId: string; code: SweepRowRefusal }[] }
  | { kind: "already_in_batch"; message: string }
  | { kind: "not_recorded"; message: string }
  | { kind: "unconfirmed"; message: string };

type FetchLike = (input: string, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;

export const PREVIEW_URL = "/api/admin/ledger/sweep-batches/preview";
export const CREATE_URL = "/api/admin/ledger/sweep-batches";

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
): Promise<{ status: number | null; body: unknown }> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch {
    return { status: null, body: null };
  }
}

/**
 * One controller per page instance. `post()` is re-entrant-safe: a second call
 * while one is in flight, or after a create was accepted, returns `ignored`
 * without touching the network, so a double click sends exactly one create.
 */
export function createSweepPostController(deps: { fetch: FetchLike; labels: FundLabels }) {
  let inFlight = false;
  let finished = false;
  let attempted = false;

  async function previewFor(body: SweepPostBody): Promise<SweepPreviewResponse | null> {
    const res = await postJson(deps.fetch, PREVIEW_URL, body);
    if (res.status === 200 && res.body && typeof res.body === "object" && "rows" in res.body) {
      return res.body as SweepPreviewResponse;
    }
    return null;
  }

  return {
    get attempted() {
      return attempted;
    },
    /** Re-arm after a failure the treasurer may retry (never after unknown or created). */
    async post(args: { body: SweepPostBody; reviewed: SweepPreviewResponse }): Promise<PostResult> {
      if (inFlight || finished) return { kind: "ignored" };
      inFlight = true;
      try {
        // B7: preview again; write nothing if what was reviewed changed.
        const pre = await postJson(deps.fetch, PREVIEW_URL, args.body);
        if (!(pre.status === 200 && pre.body && typeof pre.body === "object" && "rows" in pre.body)) {
          const failure = isErrorBody(pre.body) ? pre.body : null;
          return {
            kind: "preview_failed",
            message: failure?.error ?? "We could not re-check the list just now. Nothing was recorded; try again.",
          };
        }
        const latest = pre.body as SweepPreviewResponse;
        if (reviewDrifted(args.reviewed, latest)) return { kind: "drifted", preview: latest };

        const sentBefore = attempted;
        attempted = true;
        const res = await postJson(deps.fetch, CREATE_URL, args.body);
        const outcome = interpretCreateFailure({
          status: res.status,
          body: res.body,
          // A claim after an earlier send from this page is most likely our own batch.
          priorAttempt: sentBefore,
          labels: deps.labels,
        });
        switch (outcome.kind) {
          case "created":
            finished = true;
            return { kind: "created", created: outcome.created };
          case "verify": {
            finished = true; // no automatic retry from an unknown outcome
            const check = await previewFor(args.body);
            const verdict = interpretVerification(check);
            if (verdict === "already_in_batch") return { kind: "already_in_batch", message: UNKNOWN_OUTCOME_MESSAGE };
            if (verdict === "not_recorded") {
              finished = false; // the check shows nothing landed, so a retry is safe
              return { kind: "not_recorded", message: NOT_RECORDED_MESSAGE };
            }
            return { kind: "unconfirmed", message: UNCONFIRMED_MESSAGE };
          }
          case "refresh":
            return outcome;
          case "fix":
          case "denied":
            return outcome;
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      } finally {
        inFlight = false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Select-all is capped at one batch's worth of gifts. */
export function selectAllIds(ids: readonly string[]): { ids: string[]; capped: boolean } {
  return { ids: ids.slice(0, SWEEP_BATCH_MAX), capped: ids.length > SWEEP_BATCH_MAX };
}

// ---------------------------------------------------------------------------
// Review-step copy that is not in the carrier (the Lions Club may refine it)
// ---------------------------------------------------------------------------


/** One line about the Foundation's receipt for a gift in the review. */
export function describeFoundationReceipt(state: FoundationReceiptState, receiptSentOn: string | null): string {
  switch (state) {
    case "may_be_needed":
      return "The Foundation may need to send a receipt for this gift.";
    case "not_needed":
      return "No receipt needed.";
    case "already_sent":
      return receiptSentOn
        ? `A receipt was already sent on ${formatSweepDate(receiptSentOn)}.`
        : "A receipt was already sent.";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export const SWEEP_FIFO_LINE =
  "Dollars age oldest-first, so a gift can show here as unswept while its dollars have already been counted as spent.";
