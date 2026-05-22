# Write-In Signees Invisible on Event Detail — Work Log

> **Slug:** `2026-05-21-write-in-signees-invisible`
> **Surface:** public `/events/[id]` (and the member redirect target)
> **Permission(s):** existing — no new key
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phase 2 skipped (no invariants touched); Phase 3 trivial (described inline below)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (brief) | Bug confirmed | 2026-05-21 |
| 2 — Architectural review | architect | Skipped | Skipped (bug-fix variant — no invariants touched) | 2026-05-21 |
| 3 — Technical design | tech-lead | Complete (brief) | Trivial: 2-line change | 2026-05-21 |
| 4 — Implementation | full-stack-developer | Complete | Typecheck + build + 115/115 unit tests pass | 2026-05-21 |
| 5 — Verification | qa | Complete | PASS — user-verified manual click-through against the Farmers Market series; signee badges now populate | 2026-05-22 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-05-22 |

---

## Intent (from user)

> "it is the Farmers Market Signup that i can't see the attendees anywhere. it says 33 attending. but i don't see any of the slots filled out (this is in the production database) … it was working earlier"

The public event detail page (`/events/[id]`) shows a per-occurrence attendee badge list for any logged-in viewer. After v1.17.0 (`83eb6da`, 2026-05-20) shipped admin write-in (guest) signups, the count chip on the Farmers Market series correctly rolls up all signups (33), but the per-row signee badge list is empty for occurrences where every RSVP is a write-in. Members see "33 attending" with no visible names.

## Phase 1 — Brief (analyst)

**Bug confirmed.** Root cause: `src/app/events/[id]/page.tsx:72-89` selects `userName: users.name` via a left join on `eventRsvps.userId`, then line 103 pushes a signee only when `r.userName` is truthy. Write-in rows have `userId = null` and their name in `eventRsvps.rsvpName`, which the query never reads. The same loop's count map (lines 100-101) includes the row, so count and badges diverge.

**Intent preserved:** the user explicitly wants "any member [to] be able to see the signup list on any event." Showing the rsvp_name for write-ins matches that. Names render as plain text in a badge — XSS-safe by React's default escaping.

## Phase 3 — Brief (tech-lead)

Two-line surgical edit, single file:

1. `src/app/events/[id]/page.tsx` — add `rsvpName: eventRsvps.rsvpName` to the select shape.
2. Same file — replace the `if (r.userName)` block with a fallback: `const displayName = r.userName ?? r.rsvpName`; push when present.

No schema change. No migration. No new permission key. No new dependency. The `signupsByDate` count is unchanged.

**Risk surface:** none beyond the two lines.

## Phase 4 — Implementation

**Date:** 2026-05-21
**Owner:** full-stack-developer (inline — 2-line bug-fix variant)

### Files Modified

- `src/app/events/[id]/page.tsx` — added `rsvpName: eventRsvps.rsvpName` to the RSVP select; replaced the `if (r.userName)` guard with `const displayName = r.userName ?? r.rsvpName`, pushing `displayName` into `signeesByDate` when truthy.

### Schema Changes

None. `event_rsvps.rsvp_name` has existed since the anonymous-RSVP work (well before v1.17.0); the column was simply not being read on the public event-detail page.

### Verification at implementer's desk

- `pnpm exec tsc --noEmit` — clean
- `pnpm build:only` — green
- `pnpm test` — 115/115 pass (no signee-specific unit coverage on this page existed before; e2e covers public read at a smoke level)

## Phase 5 — Verification

**Date:** 2026-05-22
**Verified by:** qa + user manual click-through

- `pnpm exec tsc --noEmit` — PASS
- `pnpm build:only` — PASS
- `pnpm test` — 115/115 PASS
- Manual: user opened the Farmers Market event detail page in an incognito session against the local Neon DB, signed in via fresh password-reset token, and confirmed the per-occurrence signee badges now display the admin-recorded write-in names alongside member names. Counts and badges align.

**Verdict:** PASS

## Phase 6 — Shipped vs Intent

**Date:** 2026-05-22
**Verdict:** SHIP IT

Intent (Phase 1): "any member should be able to see the signup list on any event" — broken specifically on the Farmers Market because v1.17.0 write-ins inflated counts without contributing to the signee list.

Shipped: write-ins now fall back to `event_rsvps.rsvp_name` in the public event-detail page query, so logged-in viewers see every attendee regardless of whether they're a club member or an admin-recorded guest. Count and badges match for the first time since v1.17.0.

No regressions. No follow-ups.
