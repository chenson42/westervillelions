# Public Funds category sync with the Foundation's charitable income categories

> **Type:** production data write (no code change)
> **Started:** 2026-11-05
> **Pipeline:** none; a one-time configuration write done at the user's explicit instruction (CLAUDE.md Workflow Rule 10). Phases 1–6 not applicable.

## Why

The treasurer could not record a Rudolph Run donation in Public Funds: only three Club Public Funds income categories were active (Public donations, White Cane, Zeffy Donations), while the Foundation's Charitable fund has eleven. A Public Funds gift is sweepable only if its category has a Foundation counterpart (`mirrors_category_id`, DECISION-126/127).

## What was written (production, 2026-11-05)

One `DO $$ … $$` block that raised (and rolled back) unless exactly 8 rows were inserted. It inserted 8 Club `activity` / `income` categories, each named after and linked (`mirrors_category_id`) to the active Foundation `charitable` / `income` category of the same name, with `counts_as_giving` and `ack_not_required` copied from the counterpart, `form_990_line` NULL (Club-owned, for the treasurer to set), `is_active = true`, `sort_order` continuing after the existing maximum:

Kroger Community Rewards; Pizza Challenge - Sponsorships & Donations; Pizza Challenge - Ticket Sales; Restaurant fundraisers; Rudolph Run – Day-of / Merchandise; Rudolph Run – Registration/Entry Fees; Rudolph Run – Sponsorships & Donations; Tail-twisting.

- **Before:** Club Public Funds income categories total 7, active 3, linked 3.
- **After:** total 15, active 11, linked 11. Every link points at an active Foundation charitable income category.
- **Audit:** none written, matching the app's `POST /api/admin/ledger/categories`, which writes no audit row on create.
- **Not touched:** Foundation `Transfer from Club` (lump-sweep category); the inactive Club `Rudolph Run`, `Pancake Breakfast`, `Sponsorships`, `Interest`; all expense categories.
- **First attempt:** an earlier transaction aborted before COMMIT on a faulty guard expression; a read afterwards confirmed nothing was written.

## Control bypassed, with the user's consent

The Club's FY2026 budget is `locked`, and the app's create route refuses a new category while the current year's budget is locked. The user was told this and chose to insert anyway ("option 1"). No budget amount changed; the new categories appear as unbudgeted income lines.

## User's words

- "can you sync up the public fund categories with the charitable fund in foundation for me at the database level?"
- After the proposed list of 8: "go"
- After being told about the budget lock and offered three options: "and option 1"

## Consequence to know

Everything recorded under these 8 categories is sweepable to the Foundation, including Rudolph entry fees and pizza ticket sales (matching how the Foundation books them today).
