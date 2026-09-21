/**
 * Board of Directors position lookups — DB-facing, no "use client" import
 * anywhere upstream needed.
 *
 * `resolveTreasurer()` is the ONE definition of "who is the Treasurer" in
 * this codebase (DECISION-086). Two different call shapes consume it:
 *   - The dues-reminder signer (src/lib/dues-reminders-queries.ts) — treats
 *     a failed resolution as a hard block (no Send button, no email signed
 *     by nobody).
 *   - The five treasury-email CC sites (ledger reimbursement + transaction
 *     routes) — treat a failed resolution as tolerant: log and send the
 *     underlying email anyway, just without a CC.
 * Both callers must agree on what "the Treasurer" means, so the lookup
 * itself lives in exactly one place. Do not duplicate this query.
 *
 * Phase 2 of the Dues Reminder Emails feature explicitly declined to reuse
 * /api/public/leadership/route.ts's own ad hoc position lookup — that route
 * optimizes for "list and sort everyone," not "find exactly one Treasurer
 * or fail loudly." Two consumers with different semantics didn't justify
 * extraction from it; this is a fresh, narrow implementation instead.
 *
 * docs/work-log/2026-08-12-dues-reminder-emails.md, Phase 3 §3.
 *
 * --- Stale Board Positions fix (2026-09-18) ---
 *
 * `members.board_position` was a hand-maintained, rarely-updated legacy
 * column that drifted badly out of sync with reality (verified 2026-09-18:
 * 6 of 13 current officers wrong, the rest null). `group_memberships.position`
 * joined through the "Board of Directors" group — what this file already
 * used for the Treasurer lookup — is the system of record. This fix adds
 * `getBoardGroupId()` and `getBoardMemberships()` as the ONE join between
 * `group_memberships` and `members` scoped to the Board group — the public
 * leadership route and the member-directory bulk lookup both consume it
 * instead of each running their own copy (see docs/decisions.md
 * DECISION-097, DECISION-098). Do not duplicate this query a third time.
 *
 * `resolveTreasurer()` below reuses `getBoardGroupId()` for the group
 * lookup but keeps its OWN SQL-level position filter rather than filtering
 * a `getBoardMemberships()` result set in application code. This is a
 * deliberate, narrower refactor than the Phase 3 design doc's "thin filter
 * over getBoardMemberships()" description: the existing regression test
 * (`src/lib/board-positions.test.ts`, case-insensitive/trimmed match case)
 * asserts on the literal SQL text of the captured `.where()` condition
 * (`lower(trim(...)) = 'treasurer'`). Moving that filter into JS would
 * change the shape of the query passed to `.where()` and break that
 * assertion, which the implementation brief for this fix required to stay
 * completely unmodified. The behavior — and every existing test case — is
 * unchanged; only the internal group-id lookup is now shared.
 *
 * docs/work-log/2026-09-18-stale-board-positions.md, Phase 3/4.
 */

import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export type TreasurerResolution =
  | { ok: true; memberId: string; firstName: string; lastName: string; email: string }
  | { ok: false; reason: "no_board_group" | "none" | "multiple"; boardGroupId?: string };

/**
 * Resolves the "Board of Directors" group id (case-insensitive, trimmed
 * name match). Returns null if no such group exists.
 */
export async function getBoardGroupId(): Promise<string | null> {
  const boardGroup = await db.query.groups.findFirst({
    where: sql`lower(${groups.name}) = 'board of directors'`,
  });
  return boardGroup?.id ?? null;
}

export type BoardMembership = {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
};

/**
 * All current Board of Directors group memberships: one row per member,
 * joined with `members` for name/email, unfiltered on position (null/blank
 * positions included — callers decide what to do with them). Single query.
 * This is now the ONE join between group_memberships and members scoped to
 * the Board group — /api/public/leadership and the member-directory
 * position lookup both consume this instead of each running their own
 * copy. Do not duplicate this query.
 */
export async function getBoardMemberships(): Promise<BoardMembership[]> {
  const boardGroupId = await getBoardGroupId();
  if (!boardGroupId) return [];

  return db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
      position: groupMemberships.position,
    })
    .from(groupMemberships)
    .innerJoin(members, eq(groupMemberships.memberId, members.id))
    .where(eq(groupMemberships.groupId, boardGroupId));
}

/**
 * Bulk board-position lookup keyed by memberId, for surfaces that render
 * many members at once (the directory, the printable roster) and need to
 * badge each one with their current Board position without an N+1 query —
 * call this ONCE per request, not once per member. Members with no row in
 * the Board group, or a null/blank position, are simply absent from the
 * map; callers treat a missing key exactly as the old column's NULL meant
 * "no position to show."
 */
export async function getBoardPositionsByMemberId(): Promise<Map<string, string>> {
  const memberships = await getBoardMemberships();
  const positions = new Map<string, string>();
  for (const membership of memberships) {
    const trimmed = membership.position?.trim();
    if (trimmed) positions.set(membership.memberId, trimmed);
  }
  return positions;
}

/**
 * Resolves the single Board of Directors member whose position is
 * "Treasurer" (case-insensitive, trimmed — matches the leniency
 * /api/public/leadership/route.ts already applies to `position` values).
 * Never guesses: zero or multiple matches both return ok: false.
 */
export async function resolveTreasurer(): Promise<TreasurerResolution> {
  const boardGroupId = await getBoardGroupId();
  if (!boardGroupId) return { ok: false, reason: "no_board_group" };

  const rows = await db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
    })
    .from(groupMemberships)
    .innerJoin(members, eq(groupMemberships.memberId, members.id))
    .where(
      and(
        eq(groupMemberships.groupId, boardGroupId),
        sql`lower(trim(${groupMemberships.position})) = 'treasurer'`,
      ),
    );

  if (rows.length === 0) return { ok: false, reason: "none", boardGroupId };
  if (rows.length > 1) return { ok: false, reason: "multiple", boardGroupId };
  return { ok: true, ...rows[0] };
}
