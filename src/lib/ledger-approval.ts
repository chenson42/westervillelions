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
 * single fund ("plain").
 */
export function describeApprovalFund(input: {
  fundName: string | null;
  partnerFundName: string | null;
  entityId: string;
  partnerEntityId: string | null;
}): { kind: ApprovalKind | "plain"; text: string } {
  const from = input.fundName ?? "Unknown Fund";
  const hasPartner = input.partnerFundName !== null || input.partnerEntityId !== null;
  if (!hasPartner) return { kind: "plain", text: from };
  const to = input.partnerFundName ?? "Unknown Fund";
  const crossEntity =
    input.partnerEntityId !== null && input.partnerEntityId !== input.entityId;
  return { kind: crossEntity ? "sweep" : "transfer", text: `${from} → ${to}` };
}

/** Toast text for a 409, per the Phase 3 copy table. */
export function describeApprovalConflict(
  body: ApprovalConflictBody,
  noun: ApprovalKind,
): string {
  const name = body.deciderName ? displayDeciderName(body.deciderName) : null;
  const who = name ?? "A board member";
  switch (body.decision) {
    case "approved":
      return body.decidedByViewer
        ? `You already approved this ${noun}.`
        : `${who} already approved this ${noun}. Only one approval is needed.`;
    case "rejected":
      return `${who} already rejected this ${noun}.`;
    case null:
      return `This ${noun} is no longer waiting for approval.`;
    default: {
      const _exhaustive: never = body.decision;
      return _exhaustive;
    }
  }
}
