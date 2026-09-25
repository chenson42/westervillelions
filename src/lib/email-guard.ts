import { CLUB_GROUP_EMAIL, BOARD_EMAIL } from "@/lib/club-contacts";

/**
 * The single source of truth for "Outbound Email Is Deny-By-Default Outside
 * Production" (CLAUDE.md). Extracted from `sendEmail()` (src/lib/email.ts)
 * so a second call site that can reach a real `resend.emails.send()` never
 * has to hand-copy the predicate.
 *
 * Why a second call site exists at all: src/app/api/admin/email-queue/
 * retry/route.ts deliberately bypasses sendEmail() (DECISION-092) to
 * re-send a PERSISTED queue row's own `to`/`attachments`/etc. directly,
 * rather than re-queuing through sendEmail() and losing the identity/
 * attachment linkage. Before this extraction, that route had NO deny-by-
 * default check at all outside production — see docs/work-log/
 * 2026-09-25-email-silent-success.md, "Per-Message Retry (Follow-Up #3)"
 * Phase 5, finding 2. `sendEmail()` and the retry route must therefore
 * import and call the SAME predicate, never re-implement it, per CLAUDE.md's
 * duplication-is-a-correctness-defect rule — a rule living in two places is
 * two places to get it wrong.
 *
 * This file holds ONLY the pure predicate, with no `@/lib/db` import and no
 * enqueue/send side effects, so both a DB-coupled module (sendEmail()) and a
 * route that must never re-queue a new row can share it.
 */
const CLUB_DISTRIBUTION_LISTS: readonly string[] = [CLUB_GROUP_EMAIL, BOARD_EMAIL];

/** Accepts both "a@b.org" and "Name <a@b.org>" forms. */
function extractAddress(to: string): string {
  return (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase();
}

function isClubDistributionList(to: string): boolean {
  const address = extractAddress(to);
  return CLUB_DISTRIBUTION_LISTS.some((list) => list.toLowerCase() === address);
}

/**
 * Addresses a non-production process is permitted to mail, from
 * EMAIL_DEV_ALLOWLIST (comma-separated). Empty or unset means nothing sends,
 * which is the correct default: a developer who has not thought about it
 * does not mail the club. A club distribution list is refused even if
 * listed.
 */
function isDevAllowedRecipient(to: string): boolean {
  const raw = process.env.EMAIL_DEV_ALLOWLIST;
  if (!raw) return false;
  const address = extractAddress(to);
  if (isClubDistributionList(address)) return false; // never, allowlist or not
  return raw
    .split(",")
    .map((a) => extractAddress(a))
    .filter(Boolean)
    .includes(address);
}

/**
 * Returns true when a send to `to` must be refused because the process is
 * not production and the recipient hasn't cleared the guard.
 *
 * `bulk: true` widens the block unconditionally — no address matching, even
 * for an otherwise-allowlisted address — because a bulk-individual-
 * recipient send is exactly the shape that leaked in the 2026-08-12
 * incident (DECISION-085): a developer's own allowlisted address also
 * appearing in a real member list must not turn a bulk dev/QA run into a
 * real delivery to that member.
 *
 * Always false in production — this guard exists to protect non-production
 * processes only.
 */
export function shouldBlockNonProductionSend(to: string, opts: { bulk?: boolean } = {}): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return Boolean(opts.bulk) || !isDevAllowedRecipient(to);
}
