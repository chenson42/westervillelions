# Acknowledgment / Thank-You Letter Generation — Work Log

> **Slug:** `2026-08-08-acknowledgment-letter-generation`
> **Surface:** (dashboard) admin — The Ledger, donors & acknowledgments
> **Permission(s):** TBD Phase 1 — expected to reuse ledger.record / ledger.manage
> **Estimated complexity:** large — IRS-compliant document generation with an editable template
> **Pipeline mode:** Full — produces legally-significant documents

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | NEEDS REWORK — open questions returned to treasurer | 2026-08-08 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**NEEDS REWORK** — not because the feature is unwanted (it clearly is: 49 gifts already shipped without it), but because the request as stated conflates two different documents ("legal substantiation" and "thank-you note") into one editable form letter without saying how they're kept apart, and it doesn't sequence against a dependency that changes what's legally safe to generate today. Section-by-section notes below say exactly what needs to be pinned down before this is buildable; none of it is a rewrite of the ask, all of it is answerable by the treasurer in one sitting. Recommend the open questions go back to the treasurer, then this returns for a fast READY FOR DESIGN pass — I'd expect that to be a single round trip, not a redesign.

## ONE-LINE TAKE

> Generate the IRS-required Pub. 1771 substantiation text as a locked block the treasurer cannot edit, wrap it in a treasurer-editable thank-you letter shell, snapshot the merged result into `letter_text` at generation time, and gate the whole thing behind whether the in-flight `ackNotRequired` category flag has actually reached production — because right now it hasn't.

## Context confirmed in code and data (read-only checks, not implementation)

- `ledger_acknowledgments.letterText`/`letterStorageKey` (`src/lib/db/schema.ts:844-846`) are currently write-only from the *treasurer's own* paste-in/upload in `MarkSentDialog` (`src/components/admin/ledger/mark-sent-dialog.tsx`) — nothing in the app generates either field today. `AcknowledgeDialog` (`src/components/admin/ledger/acknowledge-dialog.tsx`) creates the ack row with a `typeOverride` and `quidProQuoValueCents`, no letter content.
- `deriveAckType()` (`src/lib/ledger.ts:769-790`, not `determineAcknowledgmentType` — the actual export name) already classifies `written_ack_250` vs `quid_pro_quo_75` vs `null`, with quid-pro-quo taking precedence per DECISION-026.
- **The EIN exists and is populated in both production entities** — confirmed via read-only query against `PROD_DATABASE_URL`: Club (`club`, 501c4) `26-1286829`, Foundation (`foundation`, 501c3) `32-0467239`. `ledgerEntities.ein` (`schema.ts:516`, comment says "placeholder" but it isn't one anymore) is already surfaced in `ledger-entity-detail.tsx:102`. This closes what would otherwise be the scariest open question — but only the Foundation's donations are deductible (`donationsDeductible`, checked by `listPendingAcknowledgments()`), and only the Foundation's CWAs need the EIN/deductibility language; the Club is a 501(c)(4), whose contributions are generally not tax-deductible, so a Club "thank you" must never borrow Foundation CWA language.
- **Donor email is almost entirely unpopulated in production.** Read-only query against `PROD_DATABASE_URL`: `ledger_donors` currently has exactly 1 row, with `email IS NULL`. This isn't a hypothetical edge case — it's the actual current state the day this feature would ship. Email-only delivery is not viable as the default path yet, independent of any UI decision.
- **The `ackNotRequired` per-category flag is NOT yet in production.** `schema.ts:611` (`ackNotRequired: boolean("ack_not_required")`) and `drizzle/migrations/0075_ledger_category_ack_not_required.sql` both exist in the repo and `listPendingAcknowledgments()` (`src/lib/ledger-queries.ts`) already filters on it — but a direct `\d ledger_categories` against `PROD_DATABASE_URL` shows no `ack_not_required` column. That migration has not run against production yet, meaning it hasn't shipped to `main`/prod. Confirms the task's framing that this is a genuinely in-flight, not-yet-shipped dependency, not a shipped safety net I can assume is live.
- `sendEmail()` (`src/lib/email.ts:1-11`) takes `{ to: string; from; subject; html; replyTo? }` — **no attachment parameter exists.** Emailing a letter means the letter becomes the HTML body, not a PDF attachment. That's a real design fork, not a detail — see Gaps.
- The print → Save-as-PDF precedent is a **locked Phase 1 decision**, not a style choice: `print-statement-button.tsx`'s own comment reads *"This IS the 'Save as PDF' flow (locked Phase 1 decision — no PDF-generation dependency)."* Reusing that pattern here is consistent with an existing invariant, not a new one.
- File storage for the letter already has an abstraction: `getReceiptStorage()` (`src/lib/receipt-storage/`), already used by the ack-letter upload route (`src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts`) for `letterStorageKey`. Generation doesn't need a new storage mechanism.
- `LEDGER_RECORD`/`LEDGER_MANAGE` (`src/lib/permissions.ts:53-56`) already gate every ack read/write path today.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer, `LEDGER_RECORD`) | Generate a letter for a single acknowledgment (from the per-transaction row or donor detail page) | On demand, per gift ≥$250 or quid-pro-quo ≥$75 |
| Admin (treasurer, `LEDGER_RECORD`) | Generate letters for a batch of acknowledgments at once (e.g. all Rudolph Run sponsors from one event) | Periodic — end of a fundraiser, year-end catch-up |
| Admin (treasurer, `LEDGER_MANAGE`, proposed) | Edit the club's letter template(s) (thank-you shell content) | Rare — once per template, occasional revision |
| Admin (treasurer, `LEDGER_RECORD`) | Review a generated letter before sending (preview) | Every generation |
| Admin (treasurer, `LEDGER_RECORD`) | Deliver a letter — print/Save-as-PDF and/or email | Every generation, per donor |
| Admin (treasurer, `LEDGER_RECORD`) | Mark a batch of letters sent at once (bulk Mark Sent) | Same cadence as batch generation |

The request never named which surface — I'm assigning it to admin/`LEDGER_RECORD` because every existing touchpoint (`AcknowledgeDialog`, `MarkSentDialog`, `AckQueue`) already lives there and is already gated that way. Template editing is a step up in blast radius (a bad edit affects every future letter, not one record) — I'm proposing it sit behind `LEDGER_MANAGE` specifically, not `LEDGER_RECORD`, and naming that as an open question below rather than assuming it.

## Flows

**Flow 1 — Generate a single letter:** Treasurer on `/admin/ledger/donors` (pending queue) or a donor's detail page → clicks "Generate Letter" on an acknowledged-but-unsent row → system merges the fixed IRS-required block (entity name, EIN, amount, date, no-goods-or-services statement OR quid-pro-quo FMV/deductible-amount statement, per `deriveAckType()`) with the treasurer-editable thank-you template → preview screen shows the merged letter → treasurer clicks "Save" → `letter_text` is snapshotted (immutable from this point), `letterStorageKey` unset unless treasurer also chooses PDF.
- Failure: donor has no name/address on file → system should block with a specific message ("This donor record is missing an address — add one before generating a letter" ) rather than emit a letter addressed to nobody. Not addressed by the request — see Gaps.
- Failure: transaction's category has `ackNotRequired = true` (once that flag ships) → "Generate Letter" should not be offered at all, same as it's already excluded from the pending queue.

**Flow 2 — Edit the letter template:** Treasurer on a new `/admin/ledger/settings/acknowledgment-template` (or similar) page → edits salutation/body/signature fields in a form, **not** a free-text blob that includes the required IRS language → clicks Save → template row updated, versioned.
- Failure: treasurer's edit strips something required → per the Central Tension below, this should be structurally impossible (required fields aren't in the editable surface at all), not a validate-and-warn dialog. If tech-lead's design instead makes required text theoretically editable, the failure path must be "Save is blocked, here's exactly which required sentence is missing" — never a silent save.

**Flow 3 — Batch generate:** Treasurer selects multiple pending/acknowledged rows (e.g. filtered to one event or date range) on the donors/ack screen → "Generate Letters" → system produces one merged letter per selected donor → batch preview (list, not full text) → treasurer downloads a combined PDF (or per-letter set) via print/Save-as-PDF, or triggers batch email send for donors with an email on file.
- Failure: a selected row has no donor linked, or the donor has no address/email → that row is skipped with a visible reason in the batch result ("3 of 49 skipped — no donor linked"), never silently dropped.
- This flow is not in the request's literal words but is required by the request's own stated origin (49 gifts arriving at once) — flagging as a gap below rather than inventing it as settled.

**Flow 4 — Deliver:** From the preview or the pending-queue row → "Print / Save as PDF" (always available, matches the `print-statement-button.tsx` precedent) and, only when the donor has an email on file, "Send by Email" (enqueues via `sendEmail()`, letter content becomes the HTML body since there's no attachment support today).
- Failure: donor has no email → the "Send by Email" control simply isn't offered (not disabled-with-tooltip weirdness) — print/Save-as-PDF is always the fallback.
- Open question: does a successful email send auto-set `sentAt`, or does the treasurer still separately confirm via `MarkSentDialog`? See Gaps.

## Permissions

- **Generate / preview / deliver a letter:** existing `FEATURES.LEDGER_RECORD` covers this — same surface, same gate as `AcknowledgeDialog`/`MarkSentDialog` today. No new key needed.
- **Edit the letter template:** recommend gating behind existing `FEATURES.LEDGER_MANAGE`, not `LEDGER_RECORD`. Rationale: `LEDGER_RECORD` already lets someone record acknowledgments and mark them sent (transactional, per-gift, low blast radius); template edits change every future letter's legal and voice content club-wide, which matches the higher-blast-radius bar `LEDGER_MANAGE` already sets for fund/category/settings changes elsewhere in the ledger. This is a role-binding recommendation, not a new `FEATURES.*` key — confirm with the treasurer whether the same person holds both today (if so this is moot in practice, but the binding should still be correct for whoever holds `LEDGER_RECORD` without `LEDGER_MANAGE` in the future).
- **Default roles:** whichever roles currently hold `LEDGER_RECORD` (Treasurer, Admin per existing role bindings) get generate/deliver; `LEDGER_MANAGE` holders (Treasurer, Admin) get template edit.

## Gaps the Request Didn't Address

- **The editable-vs-fixed boundary isn't drawn.** The request says "editable form letter" and "thank you as well" with no line between what's club voice and what's legal text. **Recommendation:** required elements (organization name, EIN, cash amount, gift date, and either the no-goods-or-services statement or the quid-pro-quo description + good-faith FMV estimate + deductible-amount statement) are **generated, non-editable structure** — rendered as fixed paragraphs the template wraps around, not fields in an edit form at all. Editable: salutation, an opening/closing paragraph of warmth, signature block, letterhead styling. This should be a **block-based template** (ordered list of fixed and editable blocks), not a single free-text field with required substrings validated on save — validate-on-save is weaker (a treasurer can still delete a sentence and not notice a warning banner) and this is exactly the class of mistake Pub. 1771 exists to prevent. If tech-lead finds a free-text-with-validation approach cheaper to build, that's a real tradeoff worth discussing explicitly in Phase 3, but my recommendation is block-based lockable structure.
- **Template storage/versioning is unaddressed.** Confirmed: `letter_text` should snapshot the fully-merged letter at generation time (this is *already* implied by `amountCents` on the ack row being immutable per DECISION-026 — the same immutability logic applies to the letter). Practically this means: (a) a `letter_templates` table (or similar) holding the current editable-block content, versioned or at minimum timestamped; (b) `letter_text` on `ledger_acknowledgments` is a point-in-time render, never re-derived from the live template after generation; (c) editing the template after letters are sent must not retroactively change what a `sentAt`-marked row's `letter_text` says. This needs an explicit tech-lead data-model decision — the request doesn't name it.
- **Two ack types, one or two templates?** Recommend one template shell (the editable thank-you/voice parts) with a **required-block variant chosen by `deriveAckType()`** — not two independently-editable templates, because two templates double the number of things that can drift out of compliance when the treasurer edits only one. The Rudolph Run case (race entry received in exchange for payment) is a real, current `quid_pro_quo_75` scenario per the club's own data model — the fixed block for that type must include the FMV of the entry and the deductible-amount math, which `written_ack_250` must not include at all (no goods/services were provided).
- **Aggregate deposits need their own guard, and it can't fully lean on the `ackNotRequired` flag yet — because that flag isn't in production.** Confirmed via direct schema check against `PROD_DATABASE_URL`: `ledger_categories.ack_not_required` doesn't exist there yet, even though it's in `schema.ts` and has a migration file (`0075_ledger_category_ack_not_required.sql`) ready to run. Two consequences: (1) this feature's generation path must filter on the same category flag `listPendingAcknowledgments()` uses, so it inherits the guard the moment that flag ships — don't reinvent a second exclusion list; (2) until that flag is live in prod, generation should not be enabled at all, or it inherits today's real risk (already flagged in the 2026-08-08-acknowledgment-donor-link Phase 6 review) that a batch/event deposit gets acknowledged as if it were a single donor's gift. Recommend this feature's Phase 2/3 explicitly sequence after `ack-not-required-flag` reaches production, not just after it's coded.
- **Delivery mechanics are underspecified for the data that actually exists.** `sendEmail()` has no attachment field — email delivery means the letter text becomes the HTML email body, not a PDF attachment matching what print/Save-as-PDF produces. And donor email is essentially unpopulated in production (1 donor, 0 emails) as of this review, so email cannot be the primary delivery path on day one; print/Save-as-PDF must be the default, with email as an enhancement once donor email data exists. Recommend explicitly deciding: does the club want a batch-email push now for a near-empty donor-email dataset, or is that follow-up work once donor records improve?
- **Does a successful email send auto-set `sentAt`, or is Mark Sent still a separate manual confirmation?** `sentAt` today means "the treasurer said it went" (per the existing schema comment and `MarkSentDialog`'s manual date field) — that's a deliberate design already in place. If email delivery becomes possible, auto-setting `sentAt` on send would be a meaningful behavior change to an existing invariant (the treasurer's attestation), not just a UI convenience. Recommend keeping `sentAt` as a manual treasurer confirmation even for emailed letters — "email sent" and "treasurer confirms delivery" are not the same fact — but this is a call for the treasurer, not something I should silently decide.
- **Non-deductible Club (501c4) acknowledgments vs. deductible Foundation (501c3) CWAs.** `ledgerEntities.donationsDeductible` already distinguishes these; `listPendingAcknowledgments()` already filters to `donationsDeductible = true`. A "thank you" letter for a Club gift must not carry Foundation CWA language (deductibility statement, EIN framed as "your gift is tax-deductible") — the request's "we'll want to use it as a thank you as well" reads as wanting a friendlier version of the *same* letter, but a Club thank-you and a Foundation CWA are legally different documents wearing the same UI. Needs an explicit call: is "thank you" scoped only to non-required-threshold Foundation gifts (under $250, no CWA required, still warm), or does it also cover Club-side non-deductible gifts? If the latter, the template system needs an entity-aware fixed block (or lack thereof), not just an ack-type-aware one.
- **Donor address is required to mail/print a letter but isn't confirmed as required data.** `ledgerDonors.address` (`schema.ts`) is nullable, "max 500 chars at app layer," with no format validation implied. Generation needs to handle "no address on file" explicitly (block with a clear message, per Flow 1's failure path) rather than generate a letter with a blank address line.
- **Mobile / print CSS for the preview and merged letter.** Not addressed by the request. The preview screen should follow the existing `print:hidden`/print-stylesheet pattern from `print-statement-button.tsx` and `budget-print-worksheet.tsx`; batch preview at 360px needs its own pass since it's list-based, not a single document.

## Out of Scope (confirm with user)

- PDF-attachment email delivery (would require a PDF-generation dependency the project has deliberately avoided — architect should weigh in if this is ever wanted, but nothing in the request asks for it).
- Retroactively generating letters for the 49 already-closed historical gifts using this new templated flow — the request frames those as "handled outside the Ledger entirely," which reads as already resolved by other means, not a backfill this feature needs to perform. Confirm the 49 don't need letters generated through this system.
- Multi-language or multi-signature-block letters (different board members signing different funds) — nothing in the request suggests this, flagging only so it isn't assumed later.
- Automatic triggering of letter generation on transaction posting — the request describes an on-demand treasurer action ("automate that" in context clearly means "stop hand-writing the words," not "stop the treasurer from reviewing every gift"), not a background job. Confirm this reading is correct — if the treasurer actually wants zero-touch generation for routine gifts, that's a materially different, higher-risk design (auto-generated legal documents with no human review before Save).

## Open Questions

1. Editable-vs-fixed split: does the treasurer agree with locking the required elements as non-editable generated structure (my recommendation), or do they want a fully free-text template with validation instead? This is the single highest-leverage decision in this feature.
2. Template edit permission: should template editing require `LEDGER_MANAGE` (stricter than the `LEDGER_RECORD` used for day-to-day acknowledgment work), or does the treasurer want the same person/role to do both without a permission split?
3. One template shell with type/entity-aware fixed blocks, or fully separate templates per type? (Recommend one shell — confirming intent before Phase 3 locks it in.)
4. Email delivery: given donor email is essentially unpopulated in production today, is email delivery in scope for this increment at all, or should this ship as print/Save-as-PDF only, with email added later once donor records are more complete?
5. Does a successful email send auto-set `sentAt`, or does the treasurer still manually confirm via Mark Sent (my recommendation: manual, to preserve the existing "treasurer attests" meaning of that field)?
6. Does "thank you" letter scope extend to non-deductible Club (501c4) gifts, or only to Foundation gifts below the $250 CWA threshold? This changes whether the template system needs to be entity-aware, not just ack-type-aware.
7. Sequencing: can Phase 2/3 proceed now with the guard implemented against the *code* for `ackNotRequired` (already present in `schema.ts` and `ledger-queries.ts`), on the understanding that this feature must not enable generation in production until the `ackNotRequired` migration (`0075_ledger_category_ack_not_required.sql`) has actually run there? Or does the treasurer want to wait until that flag is confirmed live before starting this feature's design at all?
8. Batch generation: confirm the scope in Flow 3 (select rows → generate → combined print or batch email) matches what's needed for cases like Rudolph Run, or if a narrower "one at a time" first increment is preferred with batch as a fast-follow.

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions

- Permission key(s): `area.action`
- Default role bindings: [list]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → add migration in `drizzle/migrations/` and update `src/lib/db/schema.ts`
2. `FEATURES` entry in `src/lib/permissions.ts` + role binding migration
3. Route handlers / server actions
4. UI
5. Email notification (if applicable) — enqueue via `sendEmail` in `src/lib/email.ts`
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]


---

## Treasurer Decisions (2026-08-08) — answering the Phase 1 NEEDS REWORK questions

1. **Editable warmth, generated compliance.** The treasurer writes and edits the greeting, thank-you
   body, closing, and signature. The entity name, EIN, gift amount, gift date, and the required
   no-goods-or-services / quid-pro-quo statement are GENERATED, non-editable structure that the
   editable text wraps around — not a free-text field validated on save. Rationale: an edit must never
   be able to produce a legally deficient letter. A warm letter missing the required statement is worse
   than no letter, because the donor believes they are substantiated when they are not.
2. **Print / Save-as-PDF first; no email in v1.** Matches the locked precedent
   (`print-statement-button.tsx`, `budget-print-worksheet.tsx`). Decisive practical reason: production
   holds exactly one donor row and its email is NULL, so an email path would ship unused. Revisit once
   donor emails are actually being captured. Note `sendEmail()` has no attachment support, so email
   would mean the letter as message body — a real design fork, deferred rather than decided now.
3. **Batch AND single generation.** The 49-gift backlog arrived from essentially two events; one-at-a-
   time is what causes a feature to be abandoned in December when the letters are actually due.
4. **One template whose generated section adapts** to `written_ack_250` vs `quid_pro_quo_75`, rather
   than two separately-maintained templates. One thank-you voice to edit; correct legal wording either
   way. The club has real quid pro quo cases — Rudolph Run registration fees, where the payer receives
   a race entry.

## Carried from Phase 1 — must hold in design

- **`letter_text` snapshots the merged result at generation time.** If the template is edited later,
  letters already sent must still read as sent. Mirrors the `amountCents` immutability precedent
  (DECISION-026).
- **EIN exists and is populated** in `ledger_entities.ein` — Club `26-1286829`, Foundation
  `32-0467239`. No new data capture needed.
- **Sequencing:** this feature's aggregate-deposit guard depends on the `ackNotRequired` category flag
  (`docs/work-log/2026-08-08-ack-not-required-flag.md`), which is built but not yet deployed to
  production. Design may assume it, but must not ship ahead of it.
- Where the design states an IRS requirement, it must be precise about what Pub. 1771 actually requires
  versus what is merely good practice. Do not invent legal specifics.

**Phase 1 verdict upgraded to READY FOR DESIGN** on the strength of these answers; Phase 2 (architect)
is next.
