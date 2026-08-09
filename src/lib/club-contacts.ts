/**
 * Club contact/distribution-list addresses — pure constants, NO imports.
 *
 * Extracted 2026-08-09 (Meeting Minutes, Phase 4 server half) to close a
 * drift risk this session hit for the third time: a module that needs to
 * stay pure/DB-free (unit-testable without DATABASE_URL, importable from a
 * "use client" file, etc.) sits next to a module that legitimately needs
 * `@/lib/db`, and the two end up duplicating a literal instead of sharing
 * one source of truth. The prior two occurrences were the MEMBERSHIP_TYPES
 * taxonomy (src/lib/members.ts imports @/lib/db, so member-form.tsx — a
 * "use client" component — re-declares TYPE_OPTIONS locally with a
 * drift-guard test, src/components/admin/member-form.test.ts) and this
 * feature's own first attempt at MINUTES_KIND_EMAIL (src/lib/minutes.ts
 * inlined the literal "club@westervillelions.org" rather than import
 * CLUB_GROUP_EMAIL from google-groups.ts, because google-groups.ts imports
 * @/lib/db at module scope and throws immediately without DATABASE_URL/DB_URL
 * set — true under `pnpm test`, which loads no .env file).
 *
 * This file is the fix for THIS occurrence, not a general policy change: it
 * holds only the two addresses both google-groups.ts (DB-coupled, syncs
 * members to the Google Group at this address) and minutes.ts (pure, no DB
 * access, must stay importable from a "use client" editor component and
 * unit-testable without a database) need to agree on. Keep it this way —
 * do NOT import `@/lib/db`, `next/server`, or anything else here that would
 * reintroduce the exact problem this file exists to solve.
 */

/** The Google Group this app auto-syncs every active/prospective member to
 *  (see CLUB_LIST_ELIGIBLE_STATUSES in src/lib/google-groups.ts). Reaches
 *  the current membership reliably because this app keeps that list correct. */
export const CLUB_GROUP_EMAIL = "club@westervillelions.org";

/** The club's board distribution address. Unlike CLUB_GROUP_EMAIL, this is
 *  NOT a Google Group this app syncs — it appears nowhere in
 *  google-groups.ts's sync surface. Presumed externally/manually managed;
 *  if its membership is ever stale, that's outside this app's control
 *  (DECISION-075 §7). */
export const BOARD_EMAIL = "board@westervillelions.org";
