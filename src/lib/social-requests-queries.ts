/**
 * Social Media Post Requests — DB-facing query/mutation functions. The pure
 * counterpart (constants, validators, field parsing) is
 * `src/lib/social-requests.ts`.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "API Contract" /
 * "Component Plan". One-for-one mirrors of `src/lib/proposals-queries.ts`'s
 * functions of the same shape, including the same transaction boundaries,
 * the same atomic `WHERE status IN (...)` edit-lock guard, and the same
 * 404-not-403 ownership-resolution contract. No backfill-decision function —
 * this feature's decisions carry no minutes-citation trio to backfill (see
 * schema.ts doc comment on `social_request_decisions`).
 */

import { db } from "@/lib/db";
import { socialRequests, socialRequestDecisions, members } from "@/lib/db/schema";
import type { SocialRequest, NewSocialRequest, SocialRequestDecision } from "@/lib/db/schema";
import { eq, and, or, ne, desc } from "drizzle-orm";
import {
  socialRequestVisibleTo,
  validateSocialRequestSubmission,
  isNoOpDecision,
  type DecisionTargetStatus,
} from "@/lib/social-requests";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates a new draft social request. `status` is always forced to 'draft'
 * here — never accepted from `fields` (parseSocialRequestBody() already
 * strips it, but this is the second, defense-in-depth layer: even if
 * `fields` somehow carried a `status` key, the object-literal ordering below
 * means the hardcoded `status: "draft"` always wins).
 */
export async function createDraftSocialRequest(input: {
  requesterUserId: string;
  requesterMemberId: string;
  fields: Partial<NewSocialRequest>;
}): Promise<SocialRequest> {
  const [row] = await db
    .insert(socialRequests)
    .values({
      ...input.fields,
      requesterUserId: input.requesterUserId,
      requesterMemberId: input.requesterMemberId,
      status: "draft",
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Ownership resolution (member-facing routes)
// ---------------------------------------------------------------------------

/**
 * Returns the request only if it exists AND is owned by `userId`; returns
 * null for both "doesn't exist" and "belongs to someone else" — the caller
 * must respond 404 either way (enumeration resistance — never a 403 that
 * would confirm existence to a non-owner).
 */
export async function getOwnedSocialRequest(id: string, userId: string): Promise<SocialRequest | null> {
  const [row] = await db.select().from(socialRequests).where(eq(socialRequests.id, id)).limit(1);
  if (!row || row.requesterUserId !== userId) return null;
  return row;
}

// ---------------------------------------------------------------------------
// Update (autosave / manual edit / explicit save)
// ---------------------------------------------------------------------------

/**
 * Updates a social request's fields. Atomically guarded to rows currently in
 * 'draft' or 'submitted' status — a defense-in-depth re-check beyond the
 * route handler's own pre-fetch status check, closing the race where a
 * board member locks the request (advances it to 'under_review') between
 * the route's read and this write. Returns null if no matching row was
 * updated (not found, or no longer editable).
 */
export async function updateSocialRequest(id: string, fields: Partial<NewSocialRequest>): Promise<SocialRequest | null> {
  const [row] = await db
    .update(socialRequests)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(socialRequests.id, id),
        or(eq(socialRequests.status, "draft"), eq(socialRequests.status, "submitted")),
      ),
    )
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Discard (hard delete, draft only)
// ---------------------------------------------------------------------------

/**
 * Hard-deletes a draft social request. Only permitted while status='draft' —
 * a draft never became a governance record (the board never saw it, no
 * email was ever sent), so there is nothing to retain. Cascades to
 * social_request_decisions, always empty for a draft (no decision row
 * exists pre-submit).
 */
export async function discardDraftSocialRequest(id: string): Promise<boolean> {
  const deleted = await db
    .delete(socialRequests)
    .where(and(eq(socialRequests.id, id), eq(socialRequests.status, "draft")))
    .returning({ id: socialRequests.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Submit (draft -> submitted)
// ---------------------------------------------------------------------------

export type SubmitSocialRequestResult =
  | { ok: true; socialRequest: SocialRequest; decision: SocialRequestDecision }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_draft" }
  | { ok: false; reason: "validation"; errors: Record<string, string> };

/**
 * Runs full required-field validation, then in one transaction: snapshots
 * the requester's name/email/phone from the live `members` row, flips
 * status='submitted', stamps submittedAt, and inserts the FIRST
 * social_request_decisions row (status='submitted', decidedByUserId = the
 * requester's own user id — a self-transition, not a board decision). Email
 * is sent by the route handler AFTER this commits, never from inside the
 * transaction and never blocking it.
 */
export async function submitSocialRequest(id: string): Promise<SubmitSocialRequestResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(socialRequests).where(eq(socialRequests.id, id)).limit(1);
    if (!request) return { ok: false, reason: "not_found" };
    if (request.status !== "draft") return { ok: false, reason: "not_draft" };

    const validation = validateSocialRequestSubmission({
      platforms: request.platforms,
      postCopy: request.postCopy,
    });
    if (!validation.valid) return { ok: false, reason: "validation", errors: validation.errors };

    // Snapshot from the live member row — written once, here, never
    // recomputed afterward.
    let nameSnapshot: string | null = null;
    let emailSnapshot: string | null = null;
    let phoneSnapshot: string | null = null;
    if (request.requesterMemberId) {
      const [member] = await tx.select().from(members).where(eq(members.id, request.requesterMemberId)).limit(1);
      if (member) {
        nameSnapshot = `${member.firstName} ${member.lastName}`.trim();
        emailSnapshot = member.email;
        phoneSnapshot = member.phone ?? null;
      }
    }

    const submittedAt = new Date();
    const [updatedRequest] = await tx
      .update(socialRequests)
      .set({
        status: "submitted",
        submittedAt,
        requesterNameSnapshot: nameSnapshot,
        requesterEmailSnapshot: emailSnapshot,
        requesterPhoneSnapshot: phoneSnapshot,
        updatedAt: submittedAt,
      })
      .where(eq(socialRequests.id, id))
      .returning();

    const [decision] = await tx
      .insert(socialRequestDecisions)
      .values({
        socialRequestId: id,
        status: "submitted",
        decidedByUserId: request.requesterUserId,
        decidedAt: submittedAt,
      })
      .returning();

    return { ok: true, socialRequest: updatedRequest, decision };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** "My Requests" — every request (draft, submitted, decided) owned by this
 *  user, most-recently-updated first. */
export async function listMySocialRequests(userId: string): Promise<SocialRequest[]> {
  return db.select().from(socialRequests).where(eq(socialRequests.requesterUserId, userId)).orderBy(desc(socialRequests.updatedAt));
}

/** Board review list — excludes drafts (never board-visible), optionally
 *  filtered to a single status. Newest submission first. */
export async function listSubmittedSocialRequestsForReview(opts?: { status?: string }): Promise<SocialRequest[]> {
  const conditions = [ne(socialRequests.status, "draft")];
  if (opts?.status) conditions.push(eq(socialRequests.status, opts.status));
  return db
    .select()
    .from(socialRequests)
    .where(and(...conditions))
    .orderBy(desc(socialRequests.submittedAt));
}

/**
 * Single-request read with the visibility rule enforced server-side —
 * returns null (never the row) if the viewer is neither the requester nor a
 * SOCIAL_REQUESTS_REVIEW holder, so the caller renders a plain 404, never a
 * 403 that would confirm the id exists.
 */
export async function getSocialRequestById(
  id: string,
  opts: { viewerUserId: string | null; viewerHasReviewAccess: boolean },
): Promise<SocialRequest | null> {
  const [row] = await db.select().from(socialRequests).where(eq(socialRequests.id, id)).limit(1);
  if (!row) return null;
  if (
    !socialRequestVisibleTo({
      requesterUserId: row.requesterUserId,
      viewerUserId: opts.viewerUserId,
      viewerHasReviewAccess: opts.viewerHasReviewAccess,
    })
  ) {
    return null;
  }
  return row;
}

/**
 * Resolves the best available contact email for a request's requester — the
 * snapshot taken at submit time, or (best-effort, not required to succeed)
 * a fresh live lookup by requesterMemberId if the member record still
 * resolves. Used only for the decision-notification email; never for
 * anything requiring guaranteed delivery.
 */
export async function resolveRequesterContactEmail(request: SocialRequest): Promise<string | null> {
  if (request.requesterEmailSnapshot) return request.requesterEmailSnapshot;
  if (!request.requesterMemberId) return null;
  const [member] = await db
    .select({ email: members.email })
    .from(members)
    .where(eq(members.id, request.requesterMemberId))
    .limit(1);
  return member?.email ?? null;
}

/** Full decision history for one social request, oldest first — feeds the
 *  requester's status timeline and the admin decision panel. */
export async function listDecisionsForSocialRequest(socialRequestId: string): Promise<SocialRequestDecision[]> {
  return db
    .select()
    .from(socialRequestDecisions)
    .where(eq(socialRequestDecisions.socialRequestId, socialRequestId))
    .orderBy(socialRequestDecisions.decidedAt);
}

// ---------------------------------------------------------------------------
// Board decision
// ---------------------------------------------------------------------------

export interface DecideSocialRequestInput {
  id: string;
  targetStatus: DecisionTargetStatus;
  decidedByUserId: string;
  note?: string | null;
}

export type DecideSocialRequestResult =
  | { ok: true; socialRequest: SocialRequest; decision: SocialRequestDecision }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "is_draft" }
  | { ok: false; reason: "no_op" };

/**
 * Records a board decision: inserts the append-only social_request_decisions
 * row and updates social_requests.status in one transaction. No additional
 * locking beyond the transaction — two SOCIAL_REQUESTS_REVIEW holders
 * deciding simultaneously can each pass the same-status guard and each
 * insert a legitimate decision row; both persist as the honest append-only
 * record, same as Proposals' documented behavior.
 */
export async function decideSocialRequest(input: DecideSocialRequestInput): Promise<DecideSocialRequestResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(socialRequests).where(eq(socialRequests.id, input.id)).limit(1);
    if (!request) return { ok: false, reason: "not_found" };
    if (request.status === "draft") return { ok: false, reason: "is_draft" };
    if (isNoOpDecision(request.status, input.targetStatus)) return { ok: false, reason: "no_op" };

    const decidedAt = new Date();
    const [decision] = await tx
      .insert(socialRequestDecisions)
      .values({
        socialRequestId: input.id,
        status: input.targetStatus,
        decidedByUserId: input.decidedByUserId,
        decidedAt,
        note: input.note ?? null,
      })
      .returning();

    const [updatedRequest] = await tx
      .update(socialRequests)
      .set({ status: input.targetStatus, updatedAt: decidedAt })
      .where(eq(socialRequests.id, input.id))
      .returning();

    return { ok: true, socialRequest: updatedRequest, decision };
  });
}
