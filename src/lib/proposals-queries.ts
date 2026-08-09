/**
 * Project / Activity Proposals — DB-facing query/mutation functions. The
 * pure counterpart (constants, validators, field parsing) is
 * `src/lib/proposals.ts`.
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" /
 * "Component Plan"; DECISION-084.
 */

import { db } from "@/lib/db";
import { proposals, proposalDecisions, members, minutes } from "@/lib/db/schema";
import type { Proposal, NewProposal, ProposalDecision, NewProposalDecision } from "@/lib/db/schema";
import { eq, and, or, ne, desc } from "drizzle-orm";
import { proposalVisibleTo, validateProposalSubmission, isNoOpDecision, type DecisionTargetStatus } from "@/lib/proposals";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates a new draft proposal. `status` is always forced to 'draft' here —
 * never accepted from `fields` (parseProposalBody() already strips it, but
 * this is the second, defense-in-depth layer: even if `fields` somehow
 * carried a `status` key, the object-literal ordering below means the
 * hardcoded `status: "draft"` always wins).
 */
export async function createDraftProposal(input: {
  proposerUserId: string;
  proposerMemberId: string;
  fields: Partial<NewProposal>;
}): Promise<Proposal> {
  const [row] = await db
    .insert(proposals)
    .values({
      ...input.fields,
      proposerUserId: input.proposerUserId,
      proposerMemberId: input.proposerMemberId,
      status: "draft",
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Ownership resolution (member-facing routes)
// ---------------------------------------------------------------------------

/**
 * Returns the proposal only if it exists AND is owned by `userId`; returns
 * null for both "doesn't exist" and "belongs to someone else" — the caller
 * must respond 404 either way (enumeration resistance, Phase 1 Adversarial
 * Pass: never a 403 that would confirm existence to a non-owner).
 */
export async function getOwnedProposal(id: string, userId: string): Promise<Proposal | null> {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
  if (!row || row.proposerUserId !== userId) return null;
  return row;
}

// ---------------------------------------------------------------------------
// Update (autosave / manual edit / explicit "Save Draft")
// ---------------------------------------------------------------------------

/**
 * Updates a proposal's fields. Atomically guarded to rows currently in
 * 'draft' or 'submitted' status — a defense-in-depth re-check beyond the
 * route handler's own pre-fetch status check, closing the race where a
 * board member locks the proposal (advances it to 'under_review') between
 * the route's read and this write. Returns null if no matching row was
 * updated (not found, or no longer editable).
 */
export async function updateProposal(id: string, fields: Partial<NewProposal>): Promise<Proposal | null> {
  const [row] = await db
    .update(proposals)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(proposals.id, id), or(eq(proposals.status, "draft"), eq(proposals.status, "submitted"))))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Discard (hard delete, draft only)
// ---------------------------------------------------------------------------

/**
 * Hard-deletes a draft proposal (Gap B). Only permitted while
 * status='draft' — a draft never became a governance record (the board
 * never saw it, no email was ever sent), so there is nothing to retain.
 * Atomically guarded the same way DELETE /api/members/reimbursements/[id]
 * guards its own withdraw path.
 */
export async function discardDraftProposal(id: string): Promise<boolean> {
  const deleted = await db
    .delete(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.status, "draft")))
    .returning({ id: proposals.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Submit (draft -> submitted)
// ---------------------------------------------------------------------------

export type SubmitProposalResult =
  | { ok: true; proposal: Proposal; decision: ProposalDecision }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_draft" }
  | { ok: false; reason: "validation"; errors: Record<string, string> };

/**
 * Runs full required-field validation, then in one transaction: snapshots
 * the proposer's name/email/phone from the live `members` row, flips
 * status='submitted', stamps submittedAt, and inserts the FIRST
 * proposalDecisions row (status='submitted', decidedByUserId = the
 * proposer's own user id — a self-transition, not a board decision). Email
 * is sent by the route handler AFTER this commits, never from inside the
 * transaction and never blocking it.
 */
export async function submitProposal(id: string): Promise<SubmitProposalResult> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, id)).limit(1);
    if (!proposal) return { ok: false, reason: "not_found" };
    if (proposal.status !== "draft") return { ok: false, reason: "not_draft" };

    const validation = validateProposalSubmission({
      projectName: proposal.projectName,
      type: proposal.type,
      needDescription: proposal.needDescription,
      chairName: proposal.chairName,
      moneyNeeded: proposal.moneyNeeded,
      estimatedCostCents: proposal.estimatedCostCents,
      estimatedCostUnknown: proposal.estimatedCostUnknown,
    });
    if (!validation.valid) return { ok: false, reason: "validation", errors: validation.errors };

    // Snapshot from the live member row — written once, here, never
    // recomputed afterward (Phase 3 "proposerMemberId/.../Snapshot").
    let nameSnapshot: string | null = null;
    let emailSnapshot: string | null = null;
    let phoneSnapshot: string | null = null;
    if (proposal.proposerMemberId) {
      const [member] = await tx.select().from(members).where(eq(members.id, proposal.proposerMemberId)).limit(1);
      if (member) {
        nameSnapshot = `${member.firstName} ${member.lastName}`.trim();
        emailSnapshot = member.email;
        phoneSnapshot = member.phone ?? null;
      }
    }

    const submittedAt = new Date();
    const [updatedProposal] = await tx
      .update(proposals)
      .set({
        status: "submitted",
        submittedAt,
        proposerNameSnapshot: nameSnapshot,
        proposerEmailSnapshot: emailSnapshot,
        proposerPhoneSnapshot: phoneSnapshot,
        updatedAt: submittedAt,
      })
      .where(eq(proposals.id, id))
      .returning();

    const [decision] = await tx
      .insert(proposalDecisions)
      .values({
        proposalId: id,
        status: "submitted",
        decidedByUserId: proposal.proposerUserId,
        decidedAt: submittedAt,
      })
      .returning();

    return { ok: true, proposal: updatedProposal, decision };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** "My Proposals" — every proposal (draft, submitted, decided) owned by
 *  this user, most-recently-updated first. */
export async function listMyProposals(userId: string): Promise<Proposal[]> {
  return db.select().from(proposals).where(eq(proposals.proposerUserId, userId)).orderBy(desc(proposals.updatedAt));
}

/** Board review list — excludes drafts (never board-visible), optionally
 *  filtered to a single status. Newest submission first. */
export async function listSubmittedProposalsForReview(opts?: { status?: string }): Promise<Proposal[]> {
  const conditions = [ne(proposals.status, "draft")];
  if (opts?.status) conditions.push(eq(proposals.status, opts.status));
  return db
    .select()
    .from(proposals)
    .where(and(...conditions))
    .orderBy(desc(proposals.submittedAt));
}

/**
 * Single-proposal read with the visibility rule enforced server-side —
 * returns null (never the row) if the viewer is neither the proposer nor a
 * PROPOSALS_REVIEW holder, so the caller renders a plain 404/notFound(),
 * never a 403 that would confirm the id exists (Phase 1 Adversarial Pass /
 * Phase 2 "Visibility — TREASURER'S ANSWER").
 */
export async function getProposalById(
  id: string,
  opts: { viewerUserId: string | null; viewerHasReviewAccess: boolean },
): Promise<Proposal | null> {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
  if (!row) return null;
  if (
    !proposalVisibleTo({
      proposerUserId: row.proposerUserId,
      viewerUserId: opts.viewerUserId,
      viewerHasReviewAccess: opts.viewerHasReviewAccess,
    })
  ) {
    return null;
  }
  return row;
}

/**
 * Resolves the best available contact email for a proposal's proposer — the
 * snapshot taken at submit time, or (best-effort, not required to succeed)
 * a fresh live lookup by proposerMemberId if the member record still
 * resolves. Used only for the decision-notification email (Phase 3 Email
 * #3: "falling back to a live member lookup ... if present — best-effort
 * either way"); never for anything requiring guaranteed delivery.
 */
export async function resolveProposerContactEmail(proposal: Proposal): Promise<string | null> {
  if (proposal.proposerEmailSnapshot) return proposal.proposerEmailSnapshot;
  if (!proposal.proposerMemberId) return null;
  const [member] = await db
    .select({ email: members.email })
    .from(members)
    .where(eq(members.id, proposal.proposerMemberId))
    .limit(1);
  return member?.email ?? null;
}

/** Full decision history for one proposal, oldest first — feeds the
 *  proposer's status timeline and the admin decision panel. */
export async function listDecisionsForProposal(proposalId: string): Promise<ProposalDecision[]> {
  return db
    .select()
    .from(proposalDecisions)
    .where(eq(proposalDecisions.proposalId, proposalId))
    .orderBy(proposalDecisions.decidedAt);
}

// ---------------------------------------------------------------------------
// Board decision
// ---------------------------------------------------------------------------

export interface DecideProposalInput {
  id: string;
  targetStatus: DecisionTargetStatus;
  decidedByUserId: string;
  note?: string | null;
  chairName?: string | null;
  citingMinutesId?: string | null;
  meetingDate?: string | null;
}

export type DecideProposalResult =
  | { ok: true; proposal: Proposal; decision: ProposalDecision }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "is_draft" }
  | { ok: false; reason: "no_op" };

/**
 * Records a board decision: inserts the append-only proposalDecisions row
 * and updates proposals.status in one transaction — the
 * currentVersionId-on-parent / append-only-children shape documentVersions
 * already established, generalized here. Optionally updates
 * proposals.chairName in the SAME transaction when `chairName` is supplied —
 * the one field a PROPOSALS_REVIEW holder may edit directly, resolving
 * "chair named after lock" without reopening the general edit-lock rule for
 * every other field.
 *
 * No additional locking beyond the transaction — two board members deciding
 * simultaneously (Phase 3 "Edge Cases") can each pass the same-status guard
 * and each insert a legitimate decision row; both rows persist as the
 * honest append-only record.
 */
export async function decideProposal(input: DecideProposalInput): Promise<DecideProposalResult> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.id)).limit(1);
    if (!proposal) return { ok: false, reason: "not_found" };
    if (proposal.status === "draft") return { ok: false, reason: "is_draft" };
    if (isNoOpDecision(proposal.status, input.targetStatus)) return { ok: false, reason: "no_op" };

    const decidedAt = new Date();
    const [decision] = await tx
      .insert(proposalDecisions)
      .values({
        proposalId: input.id,
        status: input.targetStatus,
        decidedByUserId: input.decidedByUserId,
        decidedAt,
        meetingDate: input.meetingDate ?? null,
        citingMinutesId: input.citingMinutesId ?? null,
        note: input.note ?? null,
      })
      .returning();

    const updateSet: Partial<NewProposal> = {
      status: input.targetStatus,
      updatedAt: decidedAt,
    };
    if (input.chairName !== undefined && input.chairName !== null && input.chairName.trim()) {
      updateSet.chairName = input.chairName.trim();
    }

    const [updatedProposal] = await tx.update(proposals).set(updateSet).where(eq(proposals.id, input.id)).returning();

    return { ok: true, proposal: updatedProposal, decision };
  });
}

// ---------------------------------------------------------------------------
// Backfill citing minutes / meeting date onto a decision row
// ---------------------------------------------------------------------------

export interface BackfillDecisionInput {
  proposalId: string;
  decisionId: string;
  citingMinutesId?: string | null;
  meetingDate?: string | null;
}

export type BackfillDecisionResult =
  | { ok: true; decision: ProposalDecision }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "minutes_not_found" };

/**
 * Quiet record-keeping update — no email, same as documentVersions' citing
 * minutes backfill. The decision row must belong to `proposalId` (guards
 * against a decisionId from a different proposal being targeted).
 */
export async function backfillDecisionCitingMinutes(input: BackfillDecisionInput): Promise<BackfillDecisionResult> {
  const [decision] = await db
    .select()
    .from(proposalDecisions)
    .where(and(eq(proposalDecisions.id, input.decisionId), eq(proposalDecisions.proposalId, input.proposalId)))
    .limit(1);
  if (!decision) return { ok: false, reason: "not_found" };

  if (input.citingMinutesId) {
    const [minutesRow] = await db.select({ id: minutes.id }).from(minutes).where(eq(minutes.id, input.citingMinutesId)).limit(1);
    if (!minutesRow) return { ok: false, reason: "minutes_not_found" };
  }

  const updateSet: Partial<NewProposalDecision> = {};
  if (input.citingMinutesId !== undefined) updateSet.citingMinutesId = input.citingMinutesId;
  if (input.meetingDate !== undefined) updateSet.meetingDate = input.meetingDate;

  const [updated] = await db.update(proposalDecisions).set(updateSet).where(eq(proposalDecisions.id, input.decisionId)).returning();

  return { ok: true, decision: updated };
}
