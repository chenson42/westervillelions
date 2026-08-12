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
 */

import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export type TreasurerResolution =
  | { ok: true; memberId: string; firstName: string; lastName: string; email: string }
  | { ok: false; reason: "no_board_group" | "none" | "multiple"; boardGroupId?: string };

/**
 * Resolves the single Board of Directors member whose position is
 * "Treasurer" (case-insensitive, trimmed — matches the leniency
 * /api/public/leadership/route.ts already applies to `position` values).
 * Never guesses: zero or multiple matches both return ok: false.
 */
export async function resolveTreasurer(): Promise<TreasurerResolution> {
  const boardGroup = await db.query.groups.findFirst({
    where: sql`lower(${groups.name}) = 'board of directors'`,
  });
  if (!boardGroup) return { ok: false, reason: "no_board_group" };

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
        eq(groupMemberships.groupId, boardGroup.id),
        sql`lower(trim(${groupMemberships.position})) = 'treasurer'`,
      ),
    );

  if (rows.length === 0) return { ok: false, reason: "none", boardGroupId: boardGroup.id };
  if (rows.length > 1) return { ok: false, reason: "multiple", boardGroupId: boardGroup.id };
  return { ok: true, ...rows[0] };
}
