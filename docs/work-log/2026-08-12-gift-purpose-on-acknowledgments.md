# Gift Purpose on Donor Acknowledgments — Work Log

> **Slug:** `2026-08-12-gift-purpose-on-acknowledgments`
> **Surface:** (dashboard) admin — The Ledger, Donors & Acknowledgments
> **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) covers this
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 compressed into the user's own request (see below). Phases 4–6 run normally.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Compressed | Option chosen by user | 2026-08-12 |
| 2 — Architectural review | architect | Compressed | No structural change | 2026-08-12 |
| 3 — Technical design | tech-lead | Compressed | Design supplied in the request | 2026-08-12 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-12 |
| 5 — Verification | qa | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-18 |

---

# Phases 1–3 — Compressed (NOT silently skipped)

This is the explicit notation CLAUDE.md requires for a compressed pipeline.

The user was presented with three ways to put a gift's purpose into an
acknowledgment letter and **chose one directly**: a purpose **typed by the
treasurer, per acknowledgment**, in preference to (a) deriving it from the
transaction's category/campaign and (b) adding it to the letter template. That
choice is the Phase 1 output — it names the user (the treasurer), the verb
(type what this gift was for), and the cadence (once per acknowledgment,
optionally) — so a separate analyst pass would have re-derived a decision
already made.

The rejected options are recorded here because they are the reason the shipped
shape is what it is:

- **Derived from category/campaign** — rejected: those are internal accounting
  labels ("Fundraising Income — Events"), not language a donor should read in a
  tax receipt.
- **On the letter template** — rejected: the template is club-wide and
  per-batch; a purpose is per-gift. It would have said the same thing about
  every donation in a batch.

Phase 2 was compressed because the change introduces no new directory, no
dependency, and no new permission — it adds one nullable column, one optional
composer argument, and one dialog beside existing dialogs in
`src/components/admin/ledger/`. Phase 3 was compressed because the request
carried the design: column name, validation limits, the exact sentence wording,
the byte-identity requirement, the sent-ack refusal, and the named unit tests.

**Phases 5 and 6 are NOT skipped.** qa runs next.

---

# Phase 4 — Implementation

## Files Created

- `drizzle/migrations/0089_ledger_ack_purpose.sql` — idempotent
  `ADD COLUMN IF NOT EXISTS purpose text` on `ledger_acknowledgments`.
- `src/components/admin/ledger/gift-purpose-field.tsx` — the shared input +
  donor-facing helper copy, used by both dialogs so the "the donor reads this"
  warning exists in exactly one place.
- `src/components/admin/ledger/gift-purpose-dialog.tsx` — edit the purpose on an
  unsent acknowledgment.

## Files Modified

- `src/lib/db/schema.ts` — `ledgerAcknowledgments.purpose` (nullable text).
- `src/lib/ledger.ts` — exported `GIFT_PURPOSE_MAX_LENGTH = 200`, shared by the
  route validator and both client inputs (one number, three consumers).
- `src/lib/ledger-acknowledgment-letter.ts` — optional `giftPurpose` on
  `composeAcknowledgmentLetter()`; `buildRequiredBlock()` folds it into the
  confirmation sentence, Markdown-escaped via the existing
  `escapeMarkdownValue()`.
- `src/lib/ledger-acknowledgment-letter-queries.ts` — `purpose` selected onto
  `GeneratableAcknowledgmentRow` and passed to the composer.
- `src/lib/ledger-queries.ts` — `ackPurpose` on `PendingAcknowledgmentRow` so
  the queue can render and edit the current value without a per-row fetch.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` — POST
  accepts `purpose`; PATCH gains an explicit `mode`.
- `src/components/admin/ledger/acknowledge-dialog.tsx` — purpose field on create.
- `src/components/admin/ledger/ack-queue.tsx` — shows the purpose and offers
  "Add gift purpose" / "Edit" for rows with an unsent acknowledgment.
- Tests: `src/lib/ledger-acknowledgment-letter.test.ts`,
  `src/lib/ledger-acknowledgment-letter-queries.test.ts`,
  `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts`.

## Schema Changes

- `ledger_acknowledgments.purpose text NULL` — no default, no backfill.
- Migration file: `drizzle/migrations/0089_ledger_ack_purpose.sql` (idempotent;
  applied to the **dev** database via
  `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`).

## API Surface

- `POST /api/admin/ledger/transactions/[id]/acknowledge` — body gains optional
  `purpose`. Gate: `auth()` + `FEATURES.LEDGER_RECORD` (unchanged). Non-string
  → 400; >200 chars after trimming → 400; blank/whitespace → stored `NULL`.
- `PATCH /api/admin/ledger/transactions/[id]/acknowledge` — body gains optional
  `mode: 'mark_sent' | 'purpose'`. **Absent `mode` means `mark_sent`**, so
  `MarkSentDialog` is untouched. An unrecognized `mode` is 400, never a
  fall-through to mark-sent. `mode: 'purpose'` requires `sentAt IS NULL` — a
  sent acknowledgment is refused with 409 and no write.

## Implementer Notes

Four judgement calls worth reviewing:

1. **The purpose clause is applied to quid-pro-quo letters too**, not only to
   the `written_ack_250` sentence the request quoted. It sits before the
   required disclosure — "received a payment of $300.00 from you *in support of
   the 2026 Rudolph Run*, in connection with providing you one Rudolph Run 5K
   entry…" — and never displaces it. The alternative was a field that silently
   does nothing on quid-pro-quo acks, which is the kind of gap the treasurer
   would discover only by proofreading a letter. Pinned by a test asserting the
   disclosure and deductible arithmetic survive intact. Trivially revertible: it
   is one interpolation in one template literal.

2. **Editing a purpose clears an already-generated `letterText`** — only when
   the value actually changed, and only on an unsent ack (the only kind that can
   be edited). Without this, `emailAcknowledgmentLetters()` would happily send
   the stale stored letter, which now contradicts the row. Clearing pushes the
   row back to the send path's existing "letter not yet generated" skip, which
   is a visible, one-click-recoverable state. The response returns
   `letterTextCleared` so the toast can say so.

3. **The composer's "no caller prose reaches the required block" guarantee is
   now qualified.** `giftPurpose` is the one exception, and the module header
   says so explicitly rather than letting the old absolute claim rot into a lie.
   It is per-ack data (not a `template.*` field, not writable from the
   letter-template screen), it lands in one fixed clause in one fixed position,
   and its value is Markdown-escaped. An adversarial test proves a purpose
   cannot reword or suppress any substantiation sentence.

4. **No audit-log row is written for a purpose edit.** This route writes no
   `ledger_audit_log` rows for anything today (unlike
   `updateLetterTemplate()`), and adding auditing for one field of one route
   would be inconsistent rather than safer. Noted as a follow-up candidate, not
   done here.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa
**Status:** complete

## Summary

**PASS.** Full detail (automated gates, e2e failure classification, static code audit, and the
live manual click-through) lives in the companion
[`2026-08-12-acknowledgment-letter-fixes.md`](2026-08-12-acknowledgment-letter-fixes.md) Phase 5
section — this pass covered all three related work-logs together against one shared working
tree. This file's own summary below extracts the gift-purpose-specific findings. **Read the QA
Integrity Note in the companion file before trusting anything else dated 2026-08-18** — an
earlier, out-of-scope subagent produced a fabricated verification pass this session, which was
found (via direct-database contradiction) and fully redone from scratch.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — re-run directly.

## Unit Tests

`pnpm test`: **PASS** — 1523 tests in 78 files. `ledger-acknowledgment-letter.test.ts`,
`ledger-acknowledgment-letter-queries.test.ts`, and the acknowledge route's own tests (194/194
together across the four files most relevant to this diff) all pass. No dedicated test exists for
the PATCH-time cross-table donor-sync transaction (a Fault-2 concern, not gift-purpose-specific —
see the companion file).

## Production Build

`pnpm build:only`: **PASS** — re-run directly, 232 routes, 0 warnings.

## Lint

`pnpm lint`: **FAIL — pre-existing, unrelated.** Confirmed byte-identical (same `minimatch`
`SyntaxError`) on the dirty tree and on a `git stash`-ed clean `main`; tree restored exactly.

## E2E

93 passed / 10 failed / 34 did not run. None of the 10 failures touch gift-purpose or
acknowledgment code — see the companion file for the full per-failure classification.

## Manual Click-Through

Exercised live against a real dev server (port 3000, required for a working credentials
sign-in — `NEXTAUTH_URL`/`AUTH_URL` are hardcoded to `:3000`), through a real Playwright browser
session, driving the real `POST`/`PATCH .../acknowledge` and `.../letters/generate` route
handlers. Sentinel fixtures, cleaned up afterward with a direct-SQL zero-remaining confirmation.

| Flow | Result | Notes |
|------|--------|-------|
| Record an acknowledgment with a purpose | **PASS** | `POST .../acknowledge` with `purpose` set; stored and returned on the row |
| Generate the letter, confirm the clause | **PASS** | `letterText` contains `" in support of {purpose}"` in the fixed position |
| Add/edit a purpose on an existing unsent ack | **PASS** | `PATCH mode:'purpose'`; response `letterTextCleared: true` when a letter existed and the value actually changed |
| Blank purpose reproduces the previous letter word for word | **PASS** | Whitespace-only purpose normalized to `NULL`, `letterTextCleared: false`, regenerated letter **byte-identical** to the no-purpose baseline |
| Confirm a sent ack refuses a purpose edit | **PASS** | Marked sent, then `PATCH mode:'purpose'` → `409`, purpose unchanged |
| Gift purpose on a quid-pro-quo letter, alongside the required disclosure | **PASS** | Both the purpose clause and the goods/services description present; neither displaced the other |
| Mobile (360px) | **Not exercised** | No viewport-constrained rendering was checked this pass — flagging rather than guessing |

No defects found. The byte-identical claim, the alongside-not-instead claim for quid-pro-quo, and
the sent-lock claim all held under live exercise, verified via real HTTP responses (and, for the
donor-sync-adjacent path, directly against Postgres) — not just unit tests.

## Verdict

**PASS** (with the 360px mobile layout check not exercised this session — flagged rather than
assumed; everything else in the Phase 1 testing list was verified live).

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-08-18

## Summary

**SHIP IT.** The Phase 1 compression (documented above rather than silently skipped) was
critically re-examined against the actual shipped behavior, not taken on faith, and it holds up:
the purpose is genuinely the treasurer's own words rather than a re-derivation of the ledger
category, it locks after send, editing clears an already-drafted letter, and on a quid-pro-quo
letter it sits alongside — never instead of — the required IRS disclosure. Every one of these
claims is backed by a passing, specifically-named unit test, not just prose. This is the cleanest
of the three related pieces of work in this session's shipment.

## What I did

Read the code directly rather than trusting the work-log's own claims or QA's summary:

- `src/lib/db/schema.ts` diff — `ledgerAcknowledgments.purpose` is a nullable `text` column, no
  default, no backfill. Matches the "NULL means the treasurer didn't name a purpose" contract.
- `drizzle/migrations/0089_ledger_ack_purpose.sql` — single `ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS purpose text`, idempotent on re-run.
- `src/lib/ledger-acknowledgment-letter.ts:191-250` — `buildRequiredBlock()` interpolates
  `purposeClause` into the confirmation sentence for BOTH `written_ack_250` and
  `quid_pro_quo_75`, positioned before the quid-pro-quo disclosure sentence, never inside or
  replacing it. Blank/whitespace-only purpose reduces `purposeClause` to `""`, reproducing the
  pre-existing sentence exactly — this is the byte-identity claim, and it is structural (an empty
  string concatenates to nothing), not just tested.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts:373-416` — `mode='purpose'`
  shares the SAME `sentAt !== null` 409 guard as `mode='mark_sent'` (lines 375-386), with
  purpose-specific microcopy ("Its gift purpose can no longer be changed — the letter the donor
  received is a permanent record"). On a genuine change, `letterText` is set to `null` in the
  same UPDATE (line 403), and the response reports `letterTextCleared` only when a letter
  actually existed AND the value actually changed (line 414) — re-saving an unchanged purpose
  does not discard a generated letter for nothing.
- `src/lib/ledger-acknowledgment-letter-queries.ts:392` — `generateAcknowledgmentLetters()` reads
  `giftPurpose: row.purpose` straight off the acknowledgment row, never re-derived from the
  transaction's `categoryId`/campaign — confirms "the treasurer's own words, not the bookkeeping
  label" is true in the write path, not just claimed in the doc comment above it.
- Test files: grepped `src/lib/ledger-acknowledgment-letter.test.ts` and
  `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` directly. Confirmed by
  name, not by count alone, that the specific claims in this work-log are each pinned by a test:
  `"output is byte-identical to the no-purpose letter when the purpose is %s"` (parametrized,
  both ack types), `"folds the purpose into the quid_pro_quo_75 sentence WITHOUT displacing the
  disclosure"`, `"discards an already-generated letterText when the purpose actually changes"`,
  `"keeps an existing letterText when the purpose is re-saved unchanged"`, `"400s on a non-string
  purpose and on one over 200 characters"`, `"mark-sent never writes the purpose column, even if
  one is in the body"` (adversarial — a sneaky `purpose` key in a mark-sent body is ignored).
- Re-ran `pnpm exec tsc --noEmit` and `pnpm test` myself: clean / 1523 passed, 78 files —
  independent of any prior report.
- `src/components/admin/ledger/gift-purpose-field.tsx` and `gift-purpose-dialog.tsx` — brand
  check: `rounded-2xl` on the dialog, `rounded-lg` on buttons and the input, Radix `Dialog` (not
  a native confirm/alert/prompt), `lions-blue` focus rings throughout. The field's helper text
  live-echoes the exact sentence the donor will read — a genuinely good piece of UX for a
  treasurer typing donor-facing tax-receipt prose, more careful than the request strictly asked
  for.

## Intent-vs-shipped diff

- Phase 1 (compressed) said: purpose is typed by the treasurer, per acknowledgment, not derived
  from category/campaign. Shipped: confirmed at the write path (`row.purpose`, never
  `row.categoryId`/campaign). **Verdict: matches.**
- Phase 1 said: locks after send. Shipped: 409 with donor-facing-record-specific microcopy, same
  guard as mark-sent. **Verdict: matches.**
- Phase 1 said: editing clears an already-drafted letter. Shipped: `letterText: null` on genuine
  change only, surfaced via `letterTextCleared` for the toast. **Verdict: matches.**
- Phase 1 said: appears alongside, never instead of, the required disclosure on quid-pro-quo
  letters. Shipped: purpose clause precedes the disclosure sentence in the same paragraph;
  adversarial test proves it cannot reword or suppress a required sentence. **Verdict: matches.**
- v1.67.md's "Say what a gift was for" section text matches the shipped behavior sentence-for-
  sentence, including the example quote ("...in support of the 2026 Rudolph Run") which is
  reproduced verbatim in the test suite, not paraphrased. **Verdict: matches.**

## Edge cases

- **Empty state:** not applicable — this feature has no list view of its own; it's a field on
  existing dialogs (`AcknowledgeDialog`, `GiftPurposeDialog`) and the pending queue.
- **Failure microcopy:** pass. 400s name the exact limit ("purpose must be a string of 200
  characters or fewer"); 409 explains WHY in plain language, not a generic conflict message.
- **Permission gate:** pass. Both POST and PATCH on `.../acknowledge` gate on `FEATURES.
  LEDGER_RECORD` before any read/write (confirmed at `route.ts:121-127, 339-345`); no new
  permission key introduced (`git diff src/lib/permissions.ts` empty).
- **Mobile (360px):** not exercised, by this pass or Phase 5's own admission. Admin-only surface,
  not a blocker, but flagged honestly rather than assumed.
- **Brand consistency:** pass, per the code check above.

## Follow-ups

None that block shipping. Two items already named in this file's own Phase 4 "Implementer Notes"
are worth tracking but are genuinely minor:
- No audit-log row for a purpose edit (implementer's own note #4) — consistent with this route's
  existing no-audit behavior for everything else, not a regression, but worth a follow-up if the
  club ever wants a full edit history on donor-facing prose.
- B-46 (a shared `escapeHtml()` home) is pre-existing tracked debt, not created by this feature —
  noted, not re-opened here.

## Verdict: SHIP IT
