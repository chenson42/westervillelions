# Event-Edit Orphans Existing RSVPs — Work Log

> **Slug:** `2026-05-22-event-edit-orphans-rsvps`
> **Surface:** admin event-edit form (`/(dashboard)/admin/events/[id]`)
> **Permission(s):** existing — no new key
> **Estimated complexity:** small to medium (depends on chosen mitigation)
> **Pipeline mode:** Bug-fix variant (Phase 2 likely skipped; Phase 3 brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Pending | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Intent

When an admin edits a recurring event and changes any field that shifts the wall-clock occurrence times (notably `start_date`, but also `recurrence_pattern`, `recurrence_day_of_week`, etc.), existing rows in `event_rsvps` retain their old `occurrence_date` strings. The generated-occurrence keys built from the new event row no longer match the stored RSVP keys, so:

- Per-occurrence views (admin "Signups by Occurrence" accordion; public/member event detail page) show **0 attendees per occurrence**.
- The series-level rollup keeps counting all rows (no occurrence-date filter in the sum), so the header still reads "N attending across M occurrences" — N is unchanged.
- The RSVPs are effectively orphaned: invisible per-occurrence, but inflating the total.

### How it surfaced

Discovered on 2026-05-22 while diagnosing why the Farmer's Market Signup series in production displayed 33 attending in the rollup but 0 on every occurrence row. Root cause for that incident was a different bug (legacy naive-timestamp-as-UTC RSVP inserts — see [[project_naive_timestamp_tz_bug]]) — but the same symptom (rollup-vs-per-occurrence mismatch) would arise from this orphan-on-edit pattern, and the data path the admin edit form takes today does not protect against it.

### Out of scope (confirm in Phase 1)

- Schema changes to RSVPs. The mitigation should be a UI/server-action change in the event-edit path, not a relational change.
- Retroactively rescuing already-orphaned RSVPs in other events (we have not surveyed prod for this; only the Farmer's Market incident is known to have been affected).

### Open questions for Phase 1

1. **Block, warn, or migrate?** Three options for what to do when the admin saves an edit that would shift wall-clock occurrence times while RSVPs exist:
   - **Block:** refuse the edit, surface "X RSVPs exist on the current occurrences — delete them first or contact engineering."
   - **Warn + offer migration:** show "X RSVPs will be orphaned unless we shift them by the same delta. Shift them? (yes/no)"
   - **Silently migrate:** compute the wall-clock delta and `UPDATE event_rsvps SET occurrence_date = occurrence_date + <delta> WHERE event_id = ...`. No prompt.

2. **Which fields trigger the check?** `start_date` time-of-day is the obvious one. What about `recurrence_pattern`, `recurrence_day_of_week`, `recurrence_end_date` (truncation), or `is_recurring` flips?

3. **What's the right delta math when DST changes inside the recurrence window?** Subtract/add hours via `INTERVAL` (DST-naive)? Or recompute each RSVP's new occurrence from the new recurrence rule + ordinal position? The latter is safer but more work.

---

# Phase 1 — Functional Refinement (analyst)

[Pending — to be run after the plastic feature ships.]

---

# Phase 2 — Architectural Review (architect)

[Pending.]

---

# Phase 3 — Technical Design (tech-lead)

[Pending.]

---

# Phase 4 — Implementation

[Pending.]

---

# Phase 5 — Verification (qa)

[Pending.]

---

# Phase 6 — Shipped vs Intent (analyst)

[Pending.]
