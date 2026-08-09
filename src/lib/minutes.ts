/**
 * Meeting Minutes — pure constants, validators, and business-logic helpers
 * (no DB access). The DB-facing counterpart is `src/lib/minutes-queries.ts`.
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, DECISION-074/075/077.
 *
 * database-admin built the constants/validators/email-address-map slice of
 * this file in Phase 4 (2026-08-09); api-developer (this round) added
 * `escapeIlikeTerm()`, `MINUTES_KIND_EVENT_TITLES`, and
 * `resolveMinutesEmailTarget()` in place, per the handoff boundary documented
 * in the work-log's Phase 4 (schema) section.
 *
 * CLUB_GROUP_EMAIL / BOARD_EMAIL now come from `@/lib/club-contacts` — a new,
 * dependency-free module extracted this round specifically so this file
 * doesn't have to choose between importing `@/lib/google-groups` (which pulls
 * in `@/lib/db` at module scope and breaks this file's "pure, importable
 * without a database" contract — `pnpm test` loads no `.env` file, so
 * DATABASE_URL/DB_URL is unset) and duplicating the literal address (which is
 * what database-admin's Phase 4 pass did as a stopgap, see git history /
 * DECISION-077 §4 for that reasoning). `google-groups.ts` now imports the
 * same constant from `@/lib/club-contacts` too, so there is exactly one
 * source of truth for both addresses — see that file's header comment.
 *
 * ux-developer (this round) added `minutesKindLabel()` — a small,
 * client-safe display-label helper shared by every UI surface that shows a
 * kind badge. No DB/network import, safe alongside everything else here.
 */

import { CLUB_GROUP_EMAIL, BOARD_EMAIL } from "@/lib/club-contacts";

// ── kind ─────────────────────────────────────────────────────────────────
// DECISION-041 pattern: `minutes.kind` is plain `text`, no DB CHECK/enum.
// Adding a new kind (e.g. a new ad hoc committee) is a one-line change to
// this array + a deploy — it must NEVER require a migration.
export const MINUTES_KINDS = ["general", "board"] as const;

export type MinutesKind = (typeof MINUTES_KINDS)[number];

export function isValidMinutesKind(kind: string): kind is MinutesKind {
  return (MINUTES_KINDS as readonly string[]).includes(kind);
}

// ── status ───────────────────────────────────────────────────────────────
// DECISION-041 pattern: `minutes.status` is plain `text`, no DB CHECK/enum.
export const MINUTES_STATUSES = ["draft", "approved"] as const;

export type MinutesStatus = (typeof MINUTES_STATUSES)[number];

export function isValidMinutesStatus(status: string): status is MinutesStatus {
  return (MINUTES_STATUSES as readonly string[]).includes(status);
}

// ── motion result ────────────────────────────────────────────────────────
// DECISION-041 pattern: `minutes_motions.result` is plain `text`, no DB
// CHECK/enum.
export const MOTION_RESULTS = ["passed", "failed", "tabled", "withdrawn"] as const;

export type MotionResult = (typeof MOTION_RESULTS)[number];

export function isValidMotionResult(result: string): result is MotionResult {
  return (MOTION_RESULTS as readonly string[]).includes(result);
}

// ── kind -> recipient email map ─────────────────────────────────────────
// DECISION-075 (companion architect addendum) ruled the map itself: partial,
// hardcoded, co-located with MINUTES_KINDS (same cadence/actor/file as the
// taxonomy it governs) — a kind with no entry here simply has no email offer,
// not a fallback address. DECISION-077 §4 ruled the value SHAPE: an object,
// not a bare address string, because the treasurer's send-gating rule
// ("drafts MAY be emailed to board@ at any status; club@ receives minutes
// ONLY once approved") is a per-recipient policy, not something a bare
// `kind === 'general'` string comparison in the email route can express
// correctly once a second kind is ever mapped to the same policy tier.
export const MINUTES_KIND_EMAIL: Partial<
  Record<MinutesKind, { address: string; requiresApproval: boolean }>
> = {
  board: { address: BOARD_EMAIL, requiresApproval: false },
  general: { address: CLUB_GROUP_EMAIL, requiresApproval: true },
};

// ── kind -> candidate event-title patterns ──────────────────────────────
// Same DECISION-041-adjacent shape as MINUTES_KIND_EMAIL: extensible by
// editing this array, no migration. Feeds getNextMeetingPointer() /
// getMostRecentApprovedMinutes()'s event-resolution in minutes-queries.ts —
// candidates are matched against `events.title` via ILIKE, then run through
// the existing getNextOccurrence() (src/lib/events.ts) to find the actual
// next/most-recent date, so this list only has to be right about WHICH
// events are meetings, never about their recurrence shape. Phase 3 Component
// Plan, "New files, non-UI."
export const MINUTES_KIND_EVENT_TITLES: Partial<Record<MinutesKind, string[]>> = {
  general: ["Lions Club Meeting", "General Meeting"],
  board: ["Board Meeting"],
};

// ── ILIKE escaping (own copy — DECISION-077 §3) ─────────────────────────
// Duplicated from src/lib/ledger.ts:2238 rather than imported. Importing it
// would create a real minutes -> ledger module dependency, exactly the
// coupling DECISION-074 Ruling 2 ruled out ("minutes shares no tables, no
// permission keys, and no audience boundary with the Ledger"). Two lines of
// pure string-escaping with no ledger-specific meaning — duplicating costs
// nothing and preserves module independence. Keep in sync with the ledger.ts
// copy by inspection if either implementation ever needs to change; there is
// no shared source to drift from since there deliberately isn't one.
export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ── email-gating policy (DECISION-075 §5, the treasurer's send-gating call) ─
// The single pure function that encodes the full email-gating table from the
// Phase 3 design doc ("Email — full contract"):
//
//   kind      | status   | allowed | recipient      | DRAFT banner
//   board     | draft    | yes     | BOARD_EMAIL     | yes
//   board     | approved | yes     | BOARD_EMAIL     | no
//   general   | draft    | no      | —               | —
//   general   | approved | yes     | CLUB_GROUP_EMAIL| no
//   unmapped  | any      | no      | —               | —
//
// Driven entirely by MINUTES_KIND_EMAIL's {address, requiresApproval} shape
// (DECISION-077 §4) — adding a third kind that's also gated on approval, or
// one that isn't, is a one-line map entry, no new branching logic here.
export type MinutesEmailResolution =
  | { allowed: true; address: string; showDraftBanner: boolean }
  | { allowed: false; reason: string };

const NO_RECIPIENT_REASON = "This minutes kind has no configured recipient.";
const REQUIRES_APPROVAL_REASON = "This kind can only be emailed once minutes are approved.";

// ── display label (ux-developer, 2026-08-09) ────────────────────────────
// Small, generic display-label formatter for `kind` — capitalize with a
// couple of nicer-sounding named overrides. Kept here (not duplicated per
// UI file) because it's a pure, dependency-free function like everything
// else in this file, and every UI surface that shows a kind badge (admin
// list, admin form, member records list/detail, kind filter tabs) needs
// the identical label. Unrecognized future kinds fall back to a plain
// capitalize — adding a kind never requires touching this function.
const MINUTES_KIND_LABELS: Partial<Record<MinutesKind, string>> = {
  general: "General",
  board: "Board",
};

export function minutesKindLabel(kind: string): string {
  const known = MINUTES_KIND_LABELS[kind as MinutesKind];
  if (known) return known;
  return kind.length > 0 ? kind.charAt(0).toUpperCase() + kind.slice(1) : kind;
}

export function resolveMinutesEmailTarget(
  kind: string,
  status: string,
): MinutesEmailResolution {
  if (!isValidMinutesKind(kind)) {
    return { allowed: false, reason: NO_RECIPIENT_REASON };
  }
  const mapping = MINUTES_KIND_EMAIL[kind];
  if (!mapping) {
    return { allowed: false, reason: NO_RECIPIENT_REASON };
  }
  if (mapping.requiresApproval && status !== "approved") {
    return { allowed: false, reason: REQUIRES_APPROVAL_REASON };
  }
  return { allowed: true, address: mapping.address, showDraftBanner: status !== "approved" };
}
