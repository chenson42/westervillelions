/**
 * Pure, client-safe vocabulary for board approval decisions on The Ledger
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3).
 *
 * NO database import, ever: the Approve / Reject dialogs import the 409 body
 * type and the toast copy from here, and a DB import would break the browser
 * bundle. The DB-importing half is ./ledger-approval-decision.ts.
 *
 * The routes' 409 body is the contract the dialogs branch on. They branch on
 * `code`, never on the English `error` string, so a removed or widened member
 * breaks `tsc` in every consumer.
 *
 * Decider names are display names only. A value that looks like an email
 * address is dropped (displayDeciderName), because a decider's email is not
 * for other board members' eyes and this module feeds toast text.
 */

export type ApprovalDecision = "approved" | "rejected";
export type ApprovalKind = "disbursement" | "transfer" | "sweep";

/**
 * Longest board-minute reference any ledger write accepts. Defined here, once
 * (B-195): the transactions route, the budget-approvals route, the transaction
 * form and decideTransaction() all import it, and a scan fails a second
 * `const BOARD_MINUTE_MAX_LEN` anywhere in non-test `src`.
 */
export const BOARD_MINUTE_MAX_LEN = 500;

// ---------------------------------------------------------------------------
// Decision groups (B-172 Increment 2a, ruling A5). A board decision targets a
// single row, a Transfer/Sweep pair (two legs sharing a transfer_group_id), or
// an itemized sweep batch (one expense leg plus N income copies that point at
// the leg through sweep_leg_txn_id). classifyDecisionGroup() is the ONE place
// that tells them apart, used by decideTransaction() and cosignTransaction()
// on the rows lockDecisionGroup() returned.
// ---------------------------------------------------------------------------

/** The columns the classifier reads; any row type carrying them is accepted. */
export interface DecisionGroupRow {
  id: string;
  flow: string;
  transferGroupId: string | null;
  sweptFromTxnId?: string | null;
  sweepLegTxnId?: string | null;
}

const present = (v: string | null | undefined): v is string => v !== null && v !== undefined;

/** Why a locked set is not one of the three legitimate shapes. */
export type DecisionGroupFaultReason = "count" | "shape" | "target_is_copy";

export type DecisionGroup<R extends DecisionGroupRow> =
  | { kind: "single"; target: R; rows: R[] }
  | { kind: "pair"; target: R; rows: R[] }
  | { kind: "sweep_batch"; target: R; leg: R; copies: R[]; rows: R[] }
  | { kind: "fault"; reason: DecisionGroupFaultReason };

/**
 * Pure classification of the rows locked for `targetId`. `rows` is the full set
 * lockDecisionGroup() returned. The target must be in `rows` (callers answer
 * 404 first); if it is not, the result is a `shape` fault.
 *
 * - target carries `sweepLegTxnId`: a copy -> fault `target_is_copy` (a batch is
 *   decided from its leg; a copy id is a caller mistake, not a pending state).
 * - target is the expense leg of N >= 1 copies: `sweep_batch`, provided the set
 *   is exactly the leg plus copies that all point at it, and the leg itself
 *   carries no pointer and is an expense.
 * - no copies, a transfer group: `pair` iff exactly two rows share the group
 *   and neither carries a sweep pointer. A leg with no copies is a one-row
 *   group, hence fault `count`.
 * - no copies, no group: `single` iff the set is exactly the target.
 */
export function classifyDecisionGroup<R extends DecisionGroupRow>(
  targetId: string,
  rows: readonly R[],
): DecisionGroup<R> {
  const target = rows.find((r) => r.id === targetId);
  if (!target) return { kind: "fault", reason: "shape" };
  if (present(target.sweepLegTxnId)) return { kind: "fault", reason: "target_is_copy" };

  const copies = rows.filter((r) => r.sweepLegTxnId === target.id);
  const all = [...rows];

  if (copies.length > 0) {
    if (target.flow !== "expense" || present(target.sweptFromTxnId)) {
      return { kind: "fault", reason: "shape" };
    }
    // Everything locked must be the leg or one of its copies.
    if (rows.length !== copies.length + 1) return { kind: "fault", reason: "shape" };
    if (copies.some((c) => c.flow !== "income" || !present(c.sweptFromTxnId))) {
      return { kind: "fault", reason: "shape" };
    }
    return { kind: "sweep_batch", target, leg: target, copies, rows: all };
  }

  // No copies: a sweep pointer anywhere in the set is a malformed row.
  if (rows.some((r) => present(r.sweptFromTxnId) || present(r.sweepLegTxnId))) {
    return { kind: "fault", reason: "shape" };
  }
  if (target.transferGroupId) {
    if (rows.length !== 2) return { kind: "fault", reason: "count" };
    if (rows.some((r) => r.transferGroupId !== target.transferGroupId)) {
      return { kind: "fault", reason: "shape" };
    }
    return { kind: "pair", target, rows: all };
  }
  if (rows.length !== 1) return { kind: "fault", reason: "count" };
  return { kind: "single", target, rows: all };
}

/** The Recently decided list is capped here; no pagination. */
export const RECENT_DECISIONS_LIMIT = 25;

/** Body of a 409 from POST .../approve or .../reject. */
export interface ApprovalConflictBody {
  /** English, a toast fallback only; the UI branches on `code`. */
  error: string;
  code: "not_pending";
  /** null: posted with no board decision, or an unreadable state. */
  decision: ApprovalDecision | null;
  /** Display name or null. NEVER an email address. */
  deciderName: string | null;
  /** ISO-8601, or null when unknown. */
  decidedAt: string | null;
  /** True on a double-click: the 409 is the viewer's own earlier success. */
  decidedByViewer: boolean;
}

/** Body of a 404 from the approve / reject routes. */
export interface ApprovalNotFoundBody {
  error: string;
  code: "not_found";
}

/**
 * Body of the 400 from POST .../approve or .../reject when the id is an itemized
 * sweep COPY (B-172 Increment 2a, ruling A5): a batch is decided from its
 * transfer leg. Dialogs branch on `code`; the page lists only legs, so this is
 * a caller mistake, never a state a user reaches.
 */
export interface DecideTheBatchBody {
  error: string;
  code: "decide_the_batch";
}

export function isDecideTheBatch(body: unknown): body is DecideTheBatchBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.code === "decide_the_batch" && typeof b.error === "string";
}

export function isApprovalConflict(body: unknown): body is ApprovalConflictBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.code === "not_pending" && typeof b.error === "string";
}

/**
 * A name safe to show to other approvers: trimmed, or null for empty/blank
 * input or anything containing "@" (an email address stored as a display name).
 */
export function displayDeciderName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed;
}

/**
 * The fund line for a pending approval. A Transfer/Sweep pair is displayed on
 * its expense (source) leg with the destination leg's fund as the partner.
 * Same entity is a Transfer, a different entity is a Sweep; no partner is a
 * single fund ("plain"). When both entity names are supplied, a Sweep names
 * the book on each side ("Charitable Fund (Foundation) -> Activity Fund (Club)").
 */
export function describeApprovalFund(input: {
  fundName: string | null;
  partnerFundName: string | null;
  entityId: string;
  partnerEntityId: string | null;
  entityName?: string | null;
  partnerEntityName?: string | null;
}): { kind: ApprovalKind | "plain"; text: string } {
  const from = input.fundName ?? "Unknown Fund";
  const hasPartner = input.partnerFundName !== null || input.partnerEntityId !== null;
  if (!hasPartner) return { kind: "plain", text: from };
  const to = input.partnerFundName ?? "Unknown Fund";
  const crossEntity =
    input.partnerEntityId !== null && input.partnerEntityId !== input.entityId;
  if (crossEntity && input.entityName && input.partnerEntityName) {
    return {
      kind: "sweep",
      text: `${from} (${input.entityName}) → ${to} (${input.partnerEntityName})`,
    };
  }
  return { kind: crossEntity ? "sweep" : "transfer", text: `${from} → ${to}` };
}

/** Toast text for a 409, per the Phase 3 copy table. */
export function describeApprovalConflict(
  body: ApprovalConflictBody,
  noun: ApprovalKind,
  verb: "approve" | "reject" = "approve",
): string {
  const name = body.deciderName ? displayDeciderName(body.deciderName) : null;
  const who = name ?? "A board member";
  switch (body.decision) {
    case "approved":
      return body.decidedByViewer
        ? `You already approved this ${noun}.`
        : verb === "approve"
          ? `${who} already approved this ${noun}. You can add your approval too.`
          : `${who} already approved this ${noun}.`;
    case "rejected":
      return body.decidedByViewer
        ? `You already rejected this ${noun}.`
        : `${who} already rejected this ${noun}.`;
    case null:
      return `This ${noun} is no longer waiting for approval.`;
    default: {
      const _exhaustive: never = body.decision;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Increment 2b: informational co-signs ("Add your approval").
// A co-sign records an endorsement; the first approval already posted the
// transaction. No quorum, and nothing reads a co-sign as authorization.
// ---------------------------------------------------------------------------

export type CosignIneligibleReason = "recorded_by_you" | "already_approved" | "already_cosigned";

/**
 * THE co-sign eligibility rule: cosignTransaction() calls it on the locked
 * rows, the queries module calls it once per History row. A null id (a deleted
 * account) never equals the viewer. Check order: recorder, poster, co-signer.
 */
export function cosignEligibility(input: {
  viewerId: string;
  /** recorded_by_user_id of BOTH legs (one entry for a non-pair row). */
  recorderIds: readonly (string | null)[];
  /** null = the posting approver's account was deleted. */
  approvedByUserId: string | null;
  /** Existing co-signers (null = deleted account). */
  cosignerUserIds: readonly (string | null)[];
}): { ok: true } | { ok: false; reason: CosignIneligibleReason } {
  const { viewerId } = input;
  if (input.recorderIds.some((id) => id !== null && id === viewerId)) {
    return { ok: false, reason: "recorded_by_you" };
  }
  if (input.approvedByUserId !== null && input.approvedByUserId === viewerId) {
    return { ok: false, reason: "already_approved" };
  }
  if (input.cosignerUserIds.some((id) => id !== null && id === viewerId)) {
    return { ok: false, reason: "already_cosigned" };
  }
  return { ok: true };
}

export type CosignConflictCode =
  | "not_approved"
  | "rejected"
  | "not_board_decision"
  | "already_approved"
  | "already_cosigned";

const COSIGN_CONFLICT_CODES: readonly string[] = [
  "not_approved",
  "rejected",
  "not_board_decision",
  "already_approved",
  "already_cosigned",
];

/** Body of a 409 from POST .../cosign. The UI branches on `code`. */
export interface CosignConflictBody {
  /** English, a toast fallback only. */
  error: string;
  code: CosignConflictCode;
  /**
   * ISO. rejected: the rejection time (rejected_at ?? updated_at);
   * already_approved: approved_at; already_cosigned: the viewer's existing
   * cosigned_at; otherwise null.
   */
  at: string | null;
  /** rejected only: the rejector via displayDeciderName(); otherwise null. NEVER an email. */
  deciderName: string | null;
}

/** Body of the 403 for a recorder. The permission 403 has NO `code`. */
export interface CosignForbiddenBody {
  error: string;
  code: "recorded_by_you";
}

/** Body of the 201. `id` is the EXPENSE leg's id. */
export interface CosignCreatedBody {
  id: string;
  cosignedAt: string;
}

export function isCosignConflict(body: unknown): body is CosignConflictBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.code === "string" &&
    COSIGN_CONFLICT_CODES.includes(b.code) &&
    typeof b.error === "string"
  );
}

export function isCosignForbidden(body: unknown): body is CosignForbiddenBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.code === "recorded_by_you" && typeof b.error === "string";
}

/** One co-signer on a History row / banner. No user id. */
export interface CosignerView {
  name: string | null;
  /** ISO. */
  cosignedAt: string;
  isViewer: boolean;
}

/**
 * "A", "A and B", "A, B and C" (no Oxford comma). Takes the first `max`
 * persons in the order given; the viewer reads "You"; unnamed persons (null
 * name, or an email-shaped name) collapse into one trailing item, "a board
 * member" (1) or "N other board members" (N > 1; "N board members" when no one
 * is named). Persons beyond `max` become `hiddenCount`, and when any are hidden
 * the text already ends "... and N others" (items then join with commas).
 * Never an email, a fraction of the board, or the word "votes".
 */
export function formatApproverList(
  entries: readonly { name: string | null; isViewer: boolean }[],
  opts?: { max?: number },
): { text: string; hiddenCount: number } {
  const max = opts?.max ?? Number.POSITIVE_INFINITY;
  const shown = entries.slice(0, max);
  const hiddenCount = Math.max(0, entries.length - shown.length);

  const named: string[] = [];
  let unnamed = 0;
  for (const e of shown) {
    if (e.isViewer) {
      named.push("You");
      continue;
    }
    const n = displayDeciderName(e.name);
    if (n) named.push(n);
    else unnamed += 1;
  }
  const items = [...named];
  if (unnamed === 1) items.push("a board member");
  else if (unnamed > 1) {
    items.push(named.length > 0 ? `${unnamed} other board members` : `${unnamed} board members`);
  }

  if (items.length === 0) return { text: "", hiddenCount };
  if (hiddenCount > 0) {
    return {
      text: `${items.join(", ")} and ${hiddenCount} ${hiddenCount === 1 ? "other" : "others"}`,
      hiddenCount,
    };
  }
  if (items.length === 1) return { text: items[0], hiddenCount };
  return {
    text: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`,
    hiddenCount,
  };
}

// ---------------------------------------------------------------------------
// Increment 2a: tabs, formatting, History row, deep-link banner.
// ---------------------------------------------------------------------------

export const APPROVAL_TABS = ["pending", "decided"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];

/** Whitelist the ?tab= value; arrays and unknown values fall to "pending". */
export function parseApprovalTab(raw: string | string[] | undefined): ApprovalTab {
  return raw === "decided" ? "decided" : "pending";
}

/** "Oct 10, 2026 at 3:42 PM" in the club's time zone, whatever the server's. */
export function formatDecisionDateTime(when: Date | string): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$2,275.00"; negative renders "-$2.50". Shared by cards, table and History. */
export function formatApprovalDollars(cents: number): string {
  return DOLLARS.format(cents / 100);
}

export function approvalNounLabel(kind: ApprovalKind): "Disbursement" | "Transfer" | "Sweep" {
  switch (kind) {
    case "disbursement":
      return "Disbursement";
    case "transfer":
      return "Transfer";
    case "sweep":
      return "Sweep";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** The Pending count line; the list mixes kinds, so the noun is "item". */
export function describePendingCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"} awaiting approval`;
}

interface DecidedBase {
  /** EXPENSE-leg id: row key, data-row-id and deep-link target. */
  id: string;
  kind: ApprovalKind;
  /** ISO; coalesce(approved_at, rejected_at, updated_at). */
  decidedAt: string;
  /** displayDeciderName(); null = unnamed. */
  deciderName: string | null;
  deciderIsViewer: boolean;
  amountCents: number;
  txnDate: string;
  party: string | null;
  memo: string | null;
  fundName: string | null;
  partnerFundName: string | null;
  entityId: string;
  partnerEntityId: string | null;
  entityName: string | null;
  partnerEntityName: string | null;
  recorderName: string | null;
  /**
   * B-172 Inc 2a: the number of copies an itemized sweep batch decided together
   * (the partner fund and entity above come from the copies); null or absent
   * for every other row.
   */
  batchCount?: number | null;
}

/** One row of Recently decided. No user ids ever appear on it. */
export type DecidedApprovalRow =
  | (DecidedBase & {
      decision: "approved";
      boardMinute: string;
      /** Co-signers in time order (cosigned_at, id). No user ids. */
      cosigners: CosignerView[];
      /** cosignEligibility() ok, computed server-side from the one result (T4). */
      canCosign: boolean;
      /** Reason already_cosigned. */
      viewerHasCosigned: boolean;
      /** Reason recorded_by_you (either leg). */
      viewerRecorded: boolean;
    })
  | (DecidedBase & {
      decision: "rejected";
      /** false: a legacy rejection with no rejected_at stamp. */
      deciderOnFile: boolean;
      rejectionReason: string | null;
    });

/** What ?txn=<id> resolves to. */
export type ApprovalTargetState =
  | { state: "not_found" }
  | { state: "pending"; rowId: string; kind: ApprovalKind; isOwn: boolean }
  | { state: "decided"; row: DecidedApprovalRow }
  | { state: "not_board_decision"; kind: ApprovalKind };

export interface ApprovalBannerModel {
  tone: "info" | "success" | "neutral";
  text: string;
  linkHref?: string;
  linkLabel?: string;
  /** "cosign": render the Add your approval button (2b). */
  action?: "cosign";
}

const DECIDED_LINK_LABEL = "See it under Recently decided";

/** The banner above the tabs for a ?txn= deep link. Plain text only. */
export function buildApprovalBanner(state: ApprovalTargetState): ApprovalBannerModel {
  switch (state.state) {
    case "not_found":
      return {
        tone: "neutral",
        text: "We can't find that disbursement. It may have been deleted after it was recorded.",
      };
    case "not_board_decision":
      return {
        tone: "neutral",
        text: "This entry did not need board approval, so there is nothing for you to do.",
      };
    case "pending":
      return state.isOwn
        ? {
            tone: "info",
            text: `You recorded this ${state.kind}, so another board member needs to decide it.`,
          }
        : {
            tone: "info",
            text: `This is the ${state.kind} from your email. It is waiting for a board decision.`,
          };
    case "decided": {
      const row = state.row;
      const amount = formatApprovalDollars(row.amountCents);
      const when = formatDecisionDateTime(row.decidedAt);
      const to = row.kind === "disbursement" && row.party ? ` to ${row.party}` : "";
      const linkHref = `/admin/ledger/approvals?tab=decided&txn=${row.id}`;
      const name = row.deciderName ?? "A board member";
      switch (row.decision) {
        case "approved": {
          const p = row.deciderIsViewer ? "You" : name;
          const everyone = row.cosigners;
          const others = everyone.filter((c) => !c.isViewer);
          const allList = formatApproverList(everyone, { max: 3 });
          const otherList = formatApproverList(others, { max: 3 });
          const also = (list: { text: string }) =>
            list.text ? ` Also approved by ${list.text}.` : "";
          // Precedence: recorded > poster > cosigned > eligible.
          if (row.viewerRecorded) {
            return {
              tone: "neutral",
              text: `You recorded this ${row.kind}, so another board member decides it. Approved by ${p} on ${when}.${also(allList)}`,
              linkHref,
              linkLabel: DECIDED_LINK_LABEL,
            };
          }
          if (row.deciderIsViewer) {
            return {
              tone: "success",
              text: `You approved this ${amount} ${row.kind}${to} on ${when}.${also(allList)}`,
              linkHref,
              linkLabel: DECIDED_LINK_LABEL,
            };
          }
          if (row.viewerHasCosigned) {
            const mine = everyone.find((c) => c.isViewer);
            const mineWhen = mine ? ` on ${formatDecisionDateTime(mine.cosignedAt)}` : "";
            return {
              tone: "success",
              text: `You added your approval${mineWhen}. Approved by ${p} on ${when}.${also(otherList)}`,
              linkHref,
              linkLabel: DECIDED_LINK_LABEL,
            };
          }
          const text =
            everyone.length > 0
              ? `Approved by ${p} on ${when}.${also(allList)} You can add your approval too.`
              : `Approved by ${p} on ${when}. It has been posted. You can add your approval too.`;
          return {
            tone: "success",
            text,
            linkHref,
            linkLabel: allList.hiddenCount > 0 ? "See everyone under Recently decided" : DECIDED_LINK_LABEL,
            ...(row.canCosign ? { action: "cosign" as const } : {}),
          };
        }
        case "rejected": {
          const trimmedReason = row.rejectionReason?.trim() ?? "";
          // A reason that already ends in punctuation must not get a second period.
          const reason = trimmedReason
            ? ` Reason: ${trimmedReason}${/[.!?]$/.test(trimmedReason) ? "" : "."}`
            : "";
          let text: string;
          if (row.deciderIsViewer) {
            text = `You rejected this ${amount} ${row.kind} on ${when}.${reason}`;
          } else if (!row.deciderOnFile) {
            text = `This ${row.kind} was rejected on ${when}.${reason}`;
          } else {
            text = `Rejected. ${name} rejected this ${amount} ${row.kind} on ${when}.${reason}`;
          }
          return { tone: "neutral", text, linkHref, linkLabel: DECIDED_LINK_LABEL };
        }
        default: {
          const _exhaustive: never = row;
          return _exhaustive;
        }
      }
    }
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
