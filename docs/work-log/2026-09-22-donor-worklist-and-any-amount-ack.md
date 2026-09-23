# Unlinked Gifts Worklist & Any-Amount Acknowledgment Letters — Work Log

> **Slug:** `2026-09-22-donor-worklist-and-any-amount-ack`
> **Surface:** (dashboard) admin — `/admin/ledger/donors` (new tab) and `/admin/ledger/[fundSlug]` (existing register)
> **Permission(s):** existing `FEATURES.LEDGER_RECORD` covers both parts — no new key
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — recommend Phase 2 folded into Phase 3 with a documented skip (see note at end of this section). No new directories, no new dependency, no new permission, both parts reuse existing components (`LinkDonorDialog`, `AcknowledgeDialog`, `FiscalYearSelector`) and existing routes. If tech-lead's design surfaces something that needs its own component tree, kick it back to architect at that point — but nothing found in this review requires it up front.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-22 |
| 2 — Architectural review | architect | **Skipped** | Skip rationale below | 2026-09-22 |
| 3 — Technical design | tech-lead | Complete | Design below — implementer named | 2026-09-22 |
| 4 — Implementation | ux-developer | Complete | typecheck/tests/build all PASS | 2026-09-22 |
| 5 — Verification | qa | Complete | PASS | 2026-09-22 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-22 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Two small, deliberate discoverability fixes on an already-built capability — surface every unlinked Foundation gift regardless of amount, and let the treasurer force a (verified-truthful) acknowledgment letter below $250 — with one real bug found along the way (the "Generate Letters" entry point can silently disappear) and one copy fix required (the type-override dropdown's own label misdescribes what it will now be used for).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (LEDGER_RECORD) | Click a new "Unlinked Gifts" tab on `/admin/ledger/donors` | On demand |
| Admin (LEDGER_RECORD) | Scan a list of Foundation income transactions with no donor linked, any amount, any income category | On demand |
| Admin (LEDGER_RECORD) | Click "Link donor" on a row → search an existing donor or create one inline (existing `LinkDonorDialog`) | Per transaction, as backlog is worked down |
| Admin (LEDGER_RECORD) | On the `/admin/ledger/[fundSlug]` register, click "Acknowledge" on a Foundation income row **under $250** (currently impossible — button doesn't render) | Per gift |
| Admin (LEDGER_RECORD) | In `AcknowledgeDialog`, pick "Written acknowledgment" from the type-override dropdown to force a letter on a sub-$250 gift | Per gift, occasional |
| Admin (LEDGER_RECORD) | Reach `/admin/ledger/donors/letters` to generate/send the resulting letter | Per batch |

Both parts are the same actor (the Treasurer, holding `LEDGER_RECORD`) on the same admin surface. No public, access-pending, or ordinary-member verb is touched.

## Flows

**Flow 1 — Link a donor to a previously-invisible gift**
Entry: `/admin/ledger/donors?tab=unlinked` (new tab) → Step: treasurer scans Foundation income rows with `donorId IS NULL`, any amount, any income category, transfers excluded → Step: clicks "Link donor" → `LinkDonorDialog` opens, search existing or create new inline → submits → Outcome: `PATCH /api/admin/ledger/transactions/[id]` sets `donorId` (existing route, already accepts this with no amount check — confirmed, no server change needed); row drops off the Unlinked Gifts list; donor's lifetime total picks up the gift (`getDonor()` already includes sub-$250 gifts, confirmed unaffected by this change; `/members/impact` aggregates expense rows and never reads `donorId`, confirmed unaffected).
- Failure: PATCH fails (network/DB) → existing dialog's toast error path fires ("Could not link donor. Try again."); row stays in the list, nothing partially applied. No new failure surface — this reuses `LinkDonorDialog` verbatim.

**Flow 2 — Force a courtesy acknowledgment letter for a sub-$250 gift**
Entry: `/admin/ledger/[fundSlug]`, a Foundation income row under $250 → Step: treasurer clicks "Acknowledge" (today: no button renders below $25000c — `txn-donor-actions.tsx:53`, the gap this ticket closes) → `AcknowledgeDialog` opens → Step: selects "Written acknowledgment" from the **existing** type-override `<select>` (the control already exists in this dialog and is already wired to `typeOverride` in the POST body — nothing to build here beyond making the button reachable) → optionally links a donor inline → submits → Outcome: `POST /api/admin/ledger/transactions/[id]/acknowledge` creates a `ledgerAcknowledgments` row with `type: 'written_ack_250'`, `amountCents` copied from the $20 transaction; toast "Acknowledgment recorded…"; the row is reachable from the register's own Mark Sent control (`listAcknowledgmentsSummary({ pendingOnly: false })`, which has no `$250` floor — confirmed) and is eligible for `/admin/ledger/donors/letters` (`listGeneratableAcknowledgments()` also has no `$250` floor — confirmed).
- Failure: 409 if an ack already exists (existing toast, unchanged); 422 only if neither a natural threshold nor `typeOverride` is supplied (won't occur once the UI always sends a value or the user picks one) — existing paths, unchanged.
- **Gap found in this flow, not preexisting:** the "Generate Letters…" link on `/admin/ledger/donors?tab=acknowledgments` only renders when `pendingAcks.some(r => r.ackId !== null)`, and `pendingAcks` comes from `listPendingAcknowledgments()`, which floors at `amountCents >= 25000` (`ledger-queries.ts:~5110`). If the *only* unsent acknowledgment in the system is the $20 one just created, that check is false, and the entry point to the letter-generation screen never appears — even though `listGeneratableAcknowledgments()` (the screen's own query) would find and generate it correctly if reached by direct URL. This is a real dead-end, not a hypothetical: it's the exact shape of bug the ticket's Part 1 discoverability finding already described once (an empty-looking queue that reads as a block). **Resolution:** the visibility check must be driven by a query with no `$250` floor — reuse `listAcknowledgmentsSummary({ pendingOnly: true })`'s shape (already used elsewhere on this same page tree) instead of `pendingAcks`, or add an unfiltered "any unsent ack exists" count. Flag this for tech-lead; it is in scope, not a follow-up.

## Permissions

- **Permission(s):** `FEATURES.LEDGER_RECORD` — confirmed the only gate needed for both parts. The donors page already redirects non-holders to `/admin/ledger` (`page.tsx:28-29`); the acknowledge route already 403s without it (`route.ts:145-147`); `TxnDonorActions` is already only rendered when `canRecord` on the register (`[fundSlug]/page.tsx:479`). No new key, no widened binding, no role change.
- **Default roles:** unchanged — whoever already holds `ledger.record` today (Treasurer + admin, per existing role bindings).

## Gaps the Request Didn't Address

- **Type-override dropdown copy is now misleading.** `AcknowledgeDialog`'s existing `<option value="written_ack_250">Written acknowledgment ($250+)</option>` was written when this control was only ever exercised above $250. Once it's the deliberate path for a $20 gift, that label actively misdescribes what the treasurer is about to do. Needs a reword — e.g. "Written acknowledgment (same wording used for required $250+ gifts)" or simply drop the "($250+)" qualifier and let the dialog's own inline copy (see next bullet) carry the distinction.
- **No visual distinction between a required and a courtesy send.** The Treasurer asked this exact question implicitly by asking "how do I do this for $20" — he doesn't currently have a way to know, at a glance, "I am about to send a courtesy thank-you, not discharge an IRS obligation." **Verified the underlying letter text is legally fine to send at any amount** (see below) — this is a UX clarity gap, not a compliance gap. Recommend: when `amountCents < 25000` and the treasurer opens `AcknowledgeDialog` with `typeOverride` selected, show a short inline note ("This gift is under the $250 IRS threshold — a written acknowledgment isn't required, but this creates one anyway as a courtesy. The letter's wording is identical either way."). Cheap, and it's exactly the information gap in the Treasurer's own question.
- **"Generate Letters" entry-point visibility bug** — detailed under Flow 2 above. Must be fixed as part of this ticket, not deferred, because otherwise Part 2's whole promise ("here's how you send it") dead-ends exactly the way Part 1's original bug did.
- **Structural transfer exclusion wasn't named as a mechanism.** The Treasurer's "any income category should be considered" decision correctly overrides the *category*-level `ackNotRequired` exclusion, but internal Club↔Foundation transfers are not identified by category at all — they're identified structurally by a non-null `transferGroupId` (DECISION-016/017, `schema.ts:897`). The existing register already excludes transfer rows from `TxnDonorActions` entirely via `!isTransfer` (`[fundSlug]/page.tsx:479`). **Recommendation, confirmed by that existing convention:** the new Unlinked Gifts worklist should filter `transferGroupId IS NULL`, independent of and in addition to the "all categories" decision — attaching a donor to one leg of an internal transfer is structurally meaningless (there is no donor, by definition), not a matter of ack policy. This is not relitigating the Treasurer's decision; it's a different axis than the one he ruled on.
- **Default scoping (fiscal year vs. all-time) wasn't decided.** Recommend: default to the current fiscal year via the existing `FiscalYearSelector` (already used identically on `/admin/ledger/[fundSlug]`, `/admin/ledger/budgeting`, `/admin/ledger/reports`, etc. — zero new pattern), with an explicit "All years" option in the same selector. An unbounded all-time list is exactly the scrolling problem this worklist exists to fix, especially now that "any income category" widens the candidate set considerably beyond the old $250-and-up, ack-required-categories-only set.
- **Tab label must not read as ack-compliance urgency.** Recommend **"Unlinked Gifts"** — factual, matches the existing "Donors" / "Pending Acknowledgments" / "Sent Acknowledgments" naming register, and doesn't imply anything is overdue or non-compliant. Avoid "Unacknowledged" (reads as a compliance queue) or "Needs Review" (implies urgency that most rows won't have).
- **Mobile at 360px:** not independently re-verified — this reuses the existing tab-bar and dialog components (`LinkDonorDialog`, `AcknowledgeDialog`) which already render on the same page at 360px today for the two existing tabs. The new tab's own row layout should follow `DonorList`'s existing pattern (stacked card row, not a fixed-width table) rather than `AckQueue`'s, since the row count here will likely be larger and less predictable in width (donor name + memo + category, all variable length).
- **Empty state:** must exist and read as "nothing to do," matching the project convention (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, per `DonorList`/`AckQueue`'s own empty states) — e.g. "No unlinked Foundation gifts. Every posted gift has a donor attached." Not "No results" (unhelpful, per CLAUDE.md's own worked example).

## The Letter-Content Question (Part 2's substance)

Read `composeAcknowledgmentLetter()` / `buildRequiredBlock()` in `src/lib/ledger-acknowledgment-letter.ts`. For `type: "written_ack_250"` (the only type reachable for a $20 gift with no quid-pro-quo), the required block reads:

> "{entity.name} is a tax-exempt organization described in Internal Revenue Code Section {taxClass}. This letter confirms that on {giftDate}, {entity.name} received a cash contribution of {amount} from you{purposeClause}."
> "No goods or services were provided in exchange for this contribution."
> "EIN: {ein}. Please retain this letter as your written record of this contribution for federal income tax purposes."

**Verdict: this text is truthful and legitimate to send for a $20 gift, unmodified.** It never asserts that the letter is legally *required*, never cites the $250 threshold to the donor, and never states a deductible amount that depends on the gift meeting any minimum — it's a plain factual receipt (date, amount, tax-exempt status, EIN, no goods/services exchanged) plus a true statement that the donor may keep it as their own record. Nothing here misrepresents anything for a sub-$250 gift; a donor is always free to substantiate any gift with whatever documentation they keep, and this letter is accurate documentation regardless of amount. The `quid_pro_quo_75` branch (deductible-amount arithmetic) is not reachable for a $20 gift with no quid-pro-quo value, so its stronger IRS-required-disclosure language never applies here.

**Because the letter text itself needed no change, this significantly de-scopes Part 2** relative to the ticket's own worst case — no new letter variant, no new template field, no schema change. The only real work is: (1) render the button, (2) reword the dropdown option so it doesn't misdescribe a courtesy send as gated to "$250+", (3) add the inline clarifying note above, and (4) fix the Generate Letters entry-point bug so the resulting ack is actually reachable end to end.

## Out of Scope (confirm with user)

- Bulk-linking multiple unlinked rows to one donor in a single action — the request describes working the list one row at a time via the existing per-row dialog; a bulk-link tool is a separate, larger feature if wanted later.
- A distinct "courtesy acknowledgment" letter template/wording separate from the standard `written_ack_250` text — established above as unnecessary; the existing wording is accurate at any amount.
- Any change to `listPendingAcknowledgments()`'s own `$250` floor — confirmed this must NOT change; the Pending Acknowledgments tab continues to mean "these are IRS-substantiation obligations," and sub-$250 acks (courtesy or not) correctly never appear there. This review only touches the *Generate Letters entry-point* visibility check, not the Pending Acknowledgments queue's contents.
- Any change to Google Group sync, email queue mechanics, or `/members/impact` — confirmed untouched by both parts.

## Open Questions

- With "any income category" now in scope, some income rows may be structurally odd to attach a donor to even though they aren't transfers (e.g., a misclassified reimbursement or a rounding adjustment posted as income). Does the Treasurer want a lightweight "not applicable / dismiss" action on a row so it can leave the worklist without a donor ever being linked, or is "leave it unlinked indefinitely, it's harmless" an acceptable permanent state? The ticket doesn't ask for a dismiss action and I'm not assuming one is wanted — flagging so tech-lead doesn't have to guess mid-design.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Skipped — deliberately, with tech-lead concurrence.** Recorded per CLAUDE.md's "no silent skips" rule.

## Skip Rationale

The analyst recommended skipping Phase 2 in the work-log header (see "Pipeline mode" note at the top of this file), and tech-lead concurs after reviewing the actual implementation surface in Phase 3:

- **No new directory.** Every file touched or added lives in an existing directory (`src/app/(dashboard)/admin/ledger/donors/`, `src/components/admin/ledger/`, `src/lib/`).
- **No new npm dependency.** Nothing here needs a library the project doesn't already have.
- **No new permission key.** `FEATURES.LEDGER_RECORD` already covers every surface touched — confirmed directly (not just carried over from Phase 1): `donors/page.tsx:28-29` redirects non-holders, the acknowledge route 403s without it (`acknowledge/route.ts:145-147`), and `TxnDonorActions` only renders when `canRecord` is true on the register (`[fundSlug]/page.tsx:481`).
- **No new server/client boundary decision.** Every new or modified component follows the existing split exactly: the donors page stays a Server Component fetching via query functions; `AcknowledgeDialog`, `TxnDonorActions`, and the new list component are Client Components, same as their siblings today.
- **One small addition to a shared component, not a new pattern.** `FiscalYearSelector` gets one new optional prop (`allowAll`) to add an "All Years" option — additive, backward-compatible with its three existing call sites, not a structural change or a new shared primitive being introduced.
- **Query placement stays in the existing file.** The new `listUnlinkedGifts()` query is added to `src/lib/ledger-queries.ts`, directly beside `listPendingAcknowledgments()` in the same "Acknowledgment queries" section — no new sibling module. (See Phase 3 Data Model / API Contract for why this, rather than a new file, is the proportionate call here even though other recent ledger features did split into sibling files.)

If the ux-developer implementer finds mid-build that the new tab's component genuinely needs its own subdirectory or a pattern not covered above, kick back to architect at that point — nothing found in Phase 1 or Phase 3 review requires it up front.

## Notes

Phase 3 below is written with this skip in mind — it makes the "no schema change, no new permission, no new route" claims explicit and checkable rather than asserting them.

---

# Phase 3 — Technical Design (tech-lead)

## Verification Note

Before designing, I re-read the cited code rather than trusting Phase 1's citations at face value. Everything Phase 1 asserted about routes, gates, and the letter text checked out exactly as quoted. Two things did not, and this design corrects them:

1. **DonorList does not use a "stacked card row" layout.** Phase 1 recommended the new tab follow "DonorList's existing pattern (stacked card row, not a fixed-width table) rather than AckQueue's." Actually reading `donor-list.tsx:151-209`, DonorList renders the exact same shape as AckQueue: a `<table>` inside `overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm` with an `overflow-x-auto` wrapper. There is no card-row precedent on this page at all — both existing tabs are horizontally-scrolling tables. The new tab should match that, not invent a third layout. See Component Plan.
2. **`FiscalYearSelector` has no "All Years" option today.** Phase 1 recommended reusing it "with an explicit All years option in the same selector" as "zero new pattern." Reading `fiscal-year-selector.tsx`, the component only ever renders a fixed list of numeric fiscal years — there is no `"all"` sentinel. (`/admin/ledger/search` does have an all-years mode, but through its own bespoke filter UI, not this shared component.) Giving the worklist an "All Years" option therefore requires one small, additive change to the shared component (see Component Plan) — not zero new pattern, but not a new pattern either: an optional prop, backward-compatible with the three existing call sites.

## Summary

Two small, additive changes on the existing Ledger admin surface, both gated by `FEATURES.LEDGER_RECORD` and both reusing existing dialogs/routes rather than introducing new ones. **Part 1** adds a fourth tab, "Unlinked Gifts," to `/admin/ledger/donors` that lists Foundation income transactions with no donor linked — any amount, any income category (including `ackNotRequired`-flagged ones, per the Treasurer's explicit decision), excluding internal transfers. It reuses the existing `LinkDonorDialog` and `PATCH /api/admin/ledger/transactions/[id]` verbatim. **Part 2** removes the `amountCents >= 25000` gate on the register's "Acknowledge" button so a courtesy acknowledgment can be recorded for any Foundation gift, pre-selects the existing `typeOverride` so the request doesn't 422 below $250, and adds a plain-language note distinguishing a courtesy send from an IRS-required one. **Part 3** fixes two bugs Phase 1 found in the existing acknowledgment flow: the "Generate Letters…" entry point disappearing when the only unsent acknowledgment is sub-$250, and the type-override dropdown's label actively misdescribing a courtesy send. No schema changes; no new permission key; no new API routes.

## Permissions

- No new permission key. `FEATURES.LEDGER_RECORD` is confirmed the sole gate for every surface touched (see Phase 2 skip rationale above for the three call sites re-verified directly).
- No role-binding change — whoever already holds `ledger.record` (Treasurer + admin) sees the new tab and the widened Acknowledge button; nobody else does.

## API Contract

**No new API routes.** Both existing routes are reused unmodified:

- `PATCH /api/admin/ledger/transactions/[id]` — body `{ donorId: string | null }`, used by `LinkDonorDialog` (Part 1). Re-verified: the donor-link branch (`route.ts:458-472`) has no amount or category check today — confirmed, no change needed.
- `POST /api/admin/ledger/transactions/[id]/acknowledge` — body includes optional `typeOverride: 'written_ack_250' | 'quid_pro_quo_75'` (Part 2). Re-verified: `deriveAckType()` (untouched) returns `null` below $250 with no qualifying quid-pro-quo value, at which point the route 422s with `"...Use typeOverride to force a type if needed."` unless `typeOverride` is supplied (`acknowledge/route.ts:264-280`). The UI change below is entirely about supplying that value proactively so the treasurer never sees the 422.

**New query function** (not a route — called directly from the Server Component, same as every other query this page already uses):

```ts
// src/lib/ledger-queries.ts — added directly beside listPendingAcknowledgments()
// in the existing "Acknowledgment queries — inc6a" section.

export type UnlinkedGiftRow = {
  txn: LedgerTransaction & { fundName: string; entityName: string; categoryName: string | null };
};

/**
 * Foundation income transactions with no donor linked — the "Unlinked Gifts"
 * worklist. Deliberately a DIFFERENT filter shape from listPendingAcknowledgments():
 *  - No amount floor (listPendingAcknowledgments floors at $250 — that floor
 *    means "needs an IRS letter" and must not change, per this ticket).
 *  - No category exclusion — ackNotRequired-flagged categories ARE included
 *    (Treasurer's explicit decision: "any income category should be
 *    considered" — an org donor record can be attached to a grant or
 *    sponsorship even though that category will never produce an
 *    acknowledgment letter). Do not add the ackNotRequired filter here even
 *    though listPendingAcknowledgments() has one two lines away — that is
 *    the one deliberate divergence this function exists for.
 *  - transferGroupId IS NULL — a DIFFERENT axis from the category decision
 *    above: a transfer leg has no donor by definition, structurally, not as
 *    an acknowledgment-policy choice. Matches the register's own !isTransfer
 *    guard ([fundSlug]/page.tsx:481).
 *  - donorId IS NULL — the whole point of the worklist.
 *  - flow='income', status='posted' — same as listPendingAcknowledgments().
 *  - entity.donationsDeductible = true — same as listPendingAcknowledgments();
 *    NOT scoped to a specific entity id, in case more than one entity is
 *    ever flagged donationsDeductible (matches existing convention).
 *
 * fiscalYear omitted (undefined) returns all years — the tab's "All Years"
 * option. When provided, uses the same fyBounds()-based gte/lt bracket
 * listTransactions() already uses, for identical FY-boundary semantics
 * across the app.
 */
export async function listUnlinkedGifts(opts: {
  fiscalYear?: number;
}): Promise<UnlinkedGiftRow[]>
```

Row shape mirrors `PendingAcknowledgmentRow`'s `txn` shape (same `fundName`/`entityName` decoration pattern) plus a `categoryName` the row list needs to satisfy "any income category" being visibly true, not just structurally true. No `donor` field — every row here has `donorId IS NULL` by definition, so it would always be `null`.

**Why this lives in `ledger-queries.ts` and not a new sibling file:** the acknowledgment-letter-queries.ts header documents a real "sibling module" convention for *new feature areas* (DECISION-049/061/062/065/069). This isn't one — it's a second filter variant on the same table `listPendingAcknowledgments()` already queries, in the same file section, returning a near-identical row shape. Splitting a ~35-line query into its own file for this would add a file and an import line without reducing coupling to anything. If `ledger-queries.ts`'s size becomes a real problem, that's a Code Review (30-day) finding to address across the whole file, not a reason to special-case this one function.

## Data Model

**No schema changes required.** Every column the new query needs already exists: `ledgerTransactions.donorId`, `.transferGroupId`, `.categoryId`, `.flow`, `.status`, `.txnDate` (all confirmed at `schema.ts:857-948`), and `ledgerEntities.donationsDeductible`. No new index needed — `ix_ledger_txns_transfer_group` and the existing entity/fund/status indexes already cover this query's predicates at the data volumes this table runs at today (same reasoning `listPendingAcknowledgments()` already relies on with no dedicated index of its own).

## Component / Page Plan

**Pages to modify:**
- `src/app/(dashboard)/admin/ledger/donors/page.tsx` — add the `"unlinked"` tab (fourth entry in `TabParam`), fetch `listUnlinkedGifts()` when active, read/pass an `fy` search param, fix the "Generate Letters…" link gate (Part 3, bug #1).

**Components to create:**
- `src/components/admin/ledger/unlinked-gifts-list.tsx` — Client Component, `"use client"`. Table-based, matching `AckQueue`'s exact structure (`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm` > `overflow-x-auto` > `<table>`), since AckQueue is the closer sibling (Foundation-income-row list with an inline Link Donor action) — not DonorList, per the Verification Note correction above. Columns: Date, Entity/Fund, Category, Donor (Link donor button, reusing `LinkDonorDialog` exactly as AckQueue's Donor column already does), Amount. No Status/Action column — this list has no ack-state machine, only a link action.
  - Empty state: `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, copy: **"No unlinked Foundation gifts."** / **"Every posted gift in this range has a donor attached."** (matches CLAUDE.md's own worked example of avoiding "No results").
  - Row count summary line above the table, matching AckQueue's `"{n} Foundation gift(s) ... require an acknowledgment"` pattern: **"{n} Foundation gift{s} with no donor linked."**
  - Mobile at 360px: identical mechanism to AckQueue/DonorList today — `overflow-x-auto` lets the table scroll horizontally inside its rounded container rather than breaking the page layout; no new responsive work needed since this is the page's existing, already-mobile-verified pattern.

**Components to modify:**
- `src/components/admin/ledger/fiscal-year-selector.tsx` — add optional `allowAll?: boolean` prop. When true, render one extra `<option value="all">All Years</option>` above the year list; `handleChange` passes `"all"` straight through as the `fy` param value (already a string param, no type change). Existing three call sites (`[fundSlug]`, `budgeting`, `reports`) omit the prop and are visually/behaviorally unchanged (`allowAll` defaults to `undefined`/falsy).
- `src/components/admin/ledger/txn-donor-actions.tsx` — Part 2. Change the Acknowledge button's render condition from `ackStatus === null && amountCents >= 25000` to `ackStatus === null` (line 54). Update the JSDoc comment above the component (currently says "shown when no ack exists and amount >= $250"). Pass `amountCents` through to `AcknowledgeDialog` (new prop — see below).
- `src/components/admin/ledger/acknowledge-dialog.tsx` — Part 2 + Part 3 bug #2.
  - Add `amountCents: number` to `AcknowledgeDialogProps` (required — `TxnDonorActions` already has it in scope, no new fetch).
  - Initialize `typeOverride` state to `amountCents < 25000 ? "written_ack_250" : ""` instead of always `""`. This is what makes "any amount" actually submit successfully without the treasurer needing to know to touch the override dropdown — `deriveAckType()` returns `null` below $250 absent a qualifying quid-pro-quo value, and the route 422s without an override supplied. The dropdown stays fully visible and editable, so a treasurer entering a genuine quid-pro-quo value on a sub-$250 gift can still switch it to `quid_pro_quo_75` manually.
  - Add an inline note directly under `Dialog.Description`, shown only when `amountCents < 25000`, using the existing info-box pattern from `transaction-form.tsx:574` (`rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900`): **"This gift is under the $250 IRS threshold, so a written acknowledgment isn't legally required — but sending one is a nice courtesy, and the letter's wording is exactly the same either way."**
  - Bug #2: reword the `written_ack_250` option. Drop the now-misleading `"($250+)"` qualifier since this control is about to become the normal path for sub-$250 gifts too: `<option value="written_ack_250">Written acknowledgment</option>`. The inline note above carries the $250 distinction instead of the option label — per Phase 1's own recommendation to let the note carry it rather than encode threshold language into a label that no longer describes when the control is used.
- `src/app/(dashboard)/admin/ledger/donors/page.tsx` — Part 3 bug #1. The "Generate Letters…" link's visibility check currently reads `pendingAcks.some((r) => r.ackId !== null)`, where `pendingAcks` is `listPendingAcknowledgments()` — which floors at $250. Replace with a fetch that has no floor: `listAcknowledgmentsSummary({ pendingOnly: true, includePii: false })`, gated on `.length > 0`, fetched only when `activeTab === "acknowledgments"` (same conditional-fetch pattern the page already uses for `sentAcks`). **Do not touch `pendingAcks` itself or the tab's badge count** — those must keep meaning "needs an IRS letter," unchanged, per this ticket's explicit instruction. This is a second, separate fetch whose only job is answering "does any unsent acknowledgment exist at all," which is exactly what the link's visibility question is asking — it is not a variant that needs its own new query function; `listAcknowledgmentsSummary` already exists and already has no floor.

**Files modified (summary):**
- `src/lib/ledger-queries.ts` — add `listUnlinkedGifts()`.
- `src/app/(dashboard)/admin/ledger/donors/page.tsx` — new tab, new fetch, Generate Letters gate fix.
- `src/components/admin/ledger/unlinked-gifts-list.tsx` — new.
- `src/components/admin/ledger/fiscal-year-selector.tsx` — `allowAll` prop.
- `src/components/admin/ledger/txn-donor-actions.tsx` — drop amount gate, thread `amountCents`.
- `src/components/admin/ledger/acknowledge-dialog.tsx` — `amountCents` prop, default override, inline note, relabeled option.

## Implementation Order

1. **No schema step** — confirmed above, nothing to migrate.
2. **No `FEATURES` step** — confirmed above, no new key.
3. Query: add `listUnlinkedGifts()` to `ledger-queries.ts`, with its unit tests (see Tests below) written alongside it.
4. Server fix: the "Generate Letters…" gate fix in `donors/page.tsx` (Part 3 bug #1) — small and independent of the new tab, can land first or alongside it.
5. UI: `unlinked-gifts-list.tsx`, the new tab wiring in `donors/page.tsx`, the `FiscalYearSelector` `allowAll` prop.
6. UI: `TxnDonorActions` gate change + `AcknowledgeDialog` changes (amount prop, default override, inline note, relabeled option) — Part 2 + Part 3 bug #2.
7. No email notification change — neither part touches `sendEmail()`/`email_queue`.
8. Release notes entry — written by tech-lead via `/release-notes` when this merges to main.

## Edge Cases & Risks

- **Pre-existing gap, NOT in scope, flagged for the record:** `listGeneratableAcknowledgments()`'s unscoped (listing) mode filters out any acknowledgment whose transaction's category has `ackNotRequired = true` (`ledger-acknowledgment-letter-queries.ts:105-114`), and `generateAcknowledgmentLetters()` independently hard-skips those same rows with reason `"category excluded from acknowledgments"` (`ledger-acknowledgment-letter-queries.ts:355-362`). This means: an acknowledgment created (via `typeOverride`, which is unrestricted by category today) against an `ackNotRequired`-category transaction can be recorded but can **never** be generated into a letter through `/admin/ledger/donors/letters` — not a discoverability bug like Part 3's bug #1, but a hard, permanent skip in the generation logic itself. This is **pre-existing behavior**, already true today for any $250+ `ackNotRequired`-category gift (the Acknowledge button's render gate never checked category, before or after this ticket). Part 1 widening donor-linking to `ackNotRequired` categories and Part 2 widening the Acknowledge button to any amount both make this reachable more often, but neither *creates* the gap. I'm treating it as out of scope: fixing it means deciding whether `ackNotRequired` categories should ever produce a generated letter at all — the flag's own documented purpose is "these will never produce a donor acknowledgment" — and that's a policy call for the Treasurer, not an implementation detail to resolve silently inside this ticket. **Recommend logging this as a backlog item** for the analyst/user to decide, rather than folding a policy decision into a bug-fix-shaped ticket.
- **`typeOverride` pre-selection interacts with quid-pro-quo entry.** If a treasurer opens the dialog on a sub-$250 gift (override pre-selected to `written_ack_250`) and then enters a quid-pro-quo value >= $75, the pre-selected override is `written_ack_250`, not `quid_pro_quo_75` — the route does not re-derive from the override once the treasurer has touched the dropdown, so the wrong letter type would be requested unless they also switch the dropdown. This is a real but narrow edge case (sub-$250 gift *and* a qualifying quid-pro-quo value is unusual — the two ordinarily correlate with a gala/event ticket priced well above $250). Not fixing it algorithmically (no "silently re-derive after the user picks a value" — that's its own footgun); flag it to the implementer as a case to manual-click-through in Phase 5, and to qa as a case worth a regression test if practical.
- **Rows with no meaningful donor to attach.** Phase 1's open question about a "not applicable / dismiss" action for structurally-odd unlinked rows (misclassified reimbursements, rounding adjustments posted as income) stands — this design does not add one. A row with no donor ever linked stays in the worklist indefinitely; that's an accepted permanent state per this design, not a bug. If it proves noisy in practice, that's a follow-up feature request, not a Phase 4 addition.
- **`FiscalYearSelector`'s `allowAll` default.** Verify at implementation time that `"all"` as a param value round-trips cleanly through `listUnlinkedGifts({ fiscalYear: undefined })` — i.e., the page must translate the string `"all"` to `undefined` before calling the query, not pass a numeric-parse failure through silently. Cite the `search/page.tsx:237` pattern (`raw.fy === "all" ? "all" : ...`) as the precedent for parsing this param, even though that page doesn't use the shared selector.

## Tests the Implementer Must Deliver

All in `src/lib/ledger-queries.test.ts`, alongside the existing `listPendingAcknowledgments` describe blocks, following their existing setup/teardown pattern:

1. `listUnlinkedGifts()` returns a Foundation income transaction with `donorId IS NULL`, no fiscal year filter.
2. `listUnlinkedGifts()` returns a transaction **under $250** — proves there is no amount floor (the defining difference from `listPendingAcknowledgments`).
3. `listUnlinkedGifts()` returns a transaction whose category has `ackNotRequired = true` — proves there is no category exclusion (the other defining difference).
4. `listUnlinkedGifts()` excludes a transaction with `donorId` already set.
5. `listUnlinkedGifts()` excludes a transaction with a non-null `transferGroupId`, even when `donorId IS NULL` and the category would otherwise qualify — proves the transfer exclusion is independent of the category decision.
6. `listUnlinkedGifts()` excludes a non-Foundation entity's transaction (`donationsDeductible = false`), an expense-flow row, and a non-`posted`-status row — same baseline filters as `listPendingAcknowledgments`.
7. `listUnlinkedGifts({ fiscalYear: N })` returns only rows within that FY's `fyBounds()`; a call with `fiscalYear` omitted returns rows across multiple fiscal years (the "All Years" case).
8. Regression test for Part 3 bug #1: an unsent acknowledgment exists on a transaction under $250 (i.e., absent from `listPendingAcknowledgments()`'s results) — assert `listAcknowledgmentsSummary({ pendingOnly: true })` still returns it, which is what the fixed Generate Letters gate now depends on. (This can live as a `listAcknowledgmentsSummary` test rather than a new one, since that function is unmodified — the test is proving the existing function's behavior is what the fixed gate now correctly relies on.)

Component/UI-level assertions (recommend Vitest + Testing Library, matching this codebase's existing component test conventions — check for a sibling `*.test.tsx` file for `ack-queue.tsx` or `donor-list.tsx` to match exact setup):
9. `AcknowledgeDialog` pre-selects `typeOverride = "written_ack_250"` when `amountCents < 25000`, and leaves it `""` (auto-detect) when `amountCents >= 25000` — the behavioral core of Part 2.
10. `AcknowledgeDialog` renders the sub-$250 courtesy note only when `amountCents < 25000`.
11. `TxnDonorActions` renders the Acknowledge button for a sub-$250 transaction when `ackStatus === null` (proves the gate is actually gone, not just relabeled).

## Implementer

**ux-developer**, single-pass. This is proportionate to the scope: no new route handler or server-side business logic beyond one ~35-line query function (`listUnlinkedGifts()`, a close structural variant of an existing query, not a new query shape or data-model rework), and every existing API contract (`PATCH .../transactions/[id]`, `POST .../acknowledge`) is reused unmodified. The tech-lead design's "api-developer → ux-developer split" guidance in CLAUDE.md is for features with a *real* new API contract or query-layer design risk (the minutes browse/search precedent) — this ticket has neither; the query is a same-file, same-shape sibling of code that already exists. Splitting this into a database-admin/api-developer handoff for one query function would add more coordination overhead than it removes. If ux-developer finds the query needs to grow in scope while implementing (e.g., pagination becomes necessary because the "any amount, any category" set is larger than expected), that's a signal to pause and loop back to tech-lead, not to freelance a larger query-layer change solo.

---

## Phase 3 — Technical Design — 2026-09-22

**Owner:** tech-lead
**Status:** complete

### Summary

Designed two additive, low-risk changes on the existing `/admin/ledger/donors` and `/admin/ledger/[fundSlug]` surfaces, both gated by the existing `FEATURES.LEDGER_RECORD` with no new permission key. Part 1 adds an "Unlinked Gifts" tab backed by one new query function (`listUnlinkedGifts()`, placed beside `listPendingAcknowledgments()` in `ledger-queries.ts`) that deliberately has no amount floor and no category exclusion, but does exclude internal transfers via `transferGroupId IS NULL`. Part 2 removes the `>= $250` gate on the register's Acknowledge button, pre-selects the existing `typeOverride` field so sub-$250 submissions don't 422, and adds a plain-language courtesy-vs-required note. Part 3 fixes the two bugs Phase 1 found: the Generate Letters entry point disappearing below $250, and the type-override dropdown's now-misleading "$250+" label. No schema changes, no new API routes — everything reuses `LinkDonorDialog`, `PATCH /api/admin/ledger/transactions/[id]`, and `POST .../acknowledge` exactly as they exist today.

### What I did

- Re-verified every Phase 1 code citation directly rather than trusting it — all checked out exactly as quoted (the `TxnDonorActions` amount gate, the acknowledge route's `typeOverride` 422 path, `listPendingAcknowledgments()`'s $250 floor and category exclusion, the `!isTransfer` register guard, the `written_ack_250` letter text, and the `FEATURES.LEDGER_RECORD` gates).
- Found and corrected two Phase 1 claims that didn't hold up: DonorList does **not** use a stacked-card layout (it's the same table pattern as AckQueue — both tabs on this page are tables), and `FiscalYearSelector` has **no** built-in "All Years" option today (it needs one small additive prop to get one).
- Found a real, pre-existing gap Phase 1 didn't surface: `listGeneratableAcknowledgments()` / `generateAcknowledgmentLetters()` hard-exclude any acknowledgment whose transaction's category is flagged `ackNotRequired` — independent of amount, and already true today for $250+ gifts in those categories. Documented it under Edge Cases & Risks as explicitly **out of scope** (it's a policy question — should those categories ever get a generated letter — not an implementation gap this ticket should resolve unilaterally) and recommended a backlog item.
- Specified the new query function precisely (filters, row shape, and why it lives beside `listPendingAcknowledgments()` rather than in a new sibling file).
- Specified the exact component/prop changes for both parts, including a subtlety Phase 1 didn't work through: `AcknowledgeDialog` needs an `amountCents` prop it doesn't have today, both for the courtesy note and to pre-select `typeOverride` so a sub-$250 submission doesn't 422 by default.
- Wrote out every unit test and component test the implementer must deliver, with exact filters to assert.
- Recorded the Phase 2 skip explicitly, with the rationale re-verified against the actual Phase 3 implementation surface (not just carried over from Phase 1's recommendation).

### Outputs

- `docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md` — Phase 2 skip rationale and full Phase 3 design doc (Summary, Permissions, API Contract, Data Model, Component/Page Plan, Implementation Order, Edge Cases & Risks, Tests, Implementer).
- No `docs/decisions.md` entry — nothing here rises to a logged implementation decision distinct from what's already fully specified in this work-log (no data-shape choice, API-surface choice, or library choice beyond what the design doc itself documents inline). If ux-developer's Phase 4 makes a real implementation choice not already pinned down here (e.g., exact pagination approach if the worklist turns out to need one), that decision should get its own numbered entry at that point.

### Open questions / handoff notes

- **Use the ux-developer agent for Phase 4**, single-pass — rationale is in the Implementer section above. No database-admin or api-developer handoff needed; the one new query function is small enough and similar enough to an existing one that splitting it out would add overhead, not reduce risk.
- Flag to ux-developer during implementation: the `typeOverride` pre-selection and the `ackNotRequired`-category letter-generation gap (both under Edge Cases & Risks) are worth a deliberate manual click-through in Phase 5, not just the happy path.
- Flag to qa: test #8 in the Tests section is a regression test on `listAcknowledgmentsSummary()` (unmodified) proving the *fixed* Generate Letters gate's dependency holds — worth calling out explicitly in the Phase 5 report as "regression coverage for Part 3 bug #1," since the function under test isn't the one that changed.
- Recommend the analyst/user log a backlog item for the `ackNotRequired`-category letter-generation gap described in Edge Cases & Risks — it's real, but it's a policy call, not a bug this ticket should fix.

---

# Phase 4 — Implementation (UI) — 2026-09-22

**Owner:** ux-developer
**Status:** complete

### Summary

Built exactly what Phase 3 specified: a fourth "Unlinked Gifts" tab on `/admin/ledger/donors` backed by a new `listUnlinkedGifts()` query (any amount, any income category, `transferGroupId IS NULL`, FY-scoped with an "All Years" option), removed the `>= $250` gate on the register's Acknowledge button, pre-selected `AcknowledgeDialog`'s type override for sub-$250 gifts with an inline courtesy-vs-required note, relabeled the now-misleading `"($250+)"` dropdown option, and fixed the "Generate Letters…" entry-point visibility bug (Part 3 bug #1) by switching its gate to an unfloored `listAcknowledgmentsSummary({ pendingOnly: true })` fetch. No schema changes, no new routes, no new permission key — matches the design doc exactly.

### What I did

- Added `listUnlinkedGifts()` to `src/lib/ledger-queries.ts`, placed directly beside `listPendingAcknowledgments()` as designed — no amount floor, no category exclusion (including `ackNotRequired`-flagged categories, per the Treasurer's decision), `transferGroupId IS NULL`, `donorId IS NULL`, same `donationsDeductible`/`flow`/`status` baseline as the existing query, optional `fiscalYear` via the same `fyBounds()` bracket `listTransactions()` uses.
- Created `src/components/admin/ledger/unlinked-gifts-list.tsx` — a Client Component matching `AckQueue`'s exact table structure (per Phase 3's Verification Note correction that both existing tabs are tables, not stacked cards). Columns: Date, Entity/Fund, Category, Donor (reuses `LinkDonorDialog` verbatim), Amount. Row-count summary line and empty state copy exactly as specified.
- Added an additive `allowAll?: boolean` prop to `src/components/admin/ledger/fiscal-year-selector.tsx` (widened `currentFY` to `number | "all"`); all four existing call sites (`compliance`, `budgeting`, `[fundSlug]`, `[fundSlug]/report`, `reports`, `ledger-entity-detail.tsx` — six, not the three Phase 1 estimated, all verified unaffected since none passes `allowAll`) are unchanged.
- Wired the new tab into `src/app/(dashboard)/admin/ledger/donors/page.tsx`: `"unlinked"` added to `TabParam`, a new `fy` search param parsed with the `search/page.tsx:237` "all"-sentinel precedent, `listUnlinkedGifts()` and the Foundation entity's fiscal-year list (`listLedgerFiscalYears()`) fetched only on that tab.
- Fixed Part 3 bug #1 in the same file: the "Generate Letters…" link's visibility now depends on a separate `listAcknowledgmentsSummary({ pendingOnly: true, includePii: false })` fetch (folded into the page's existing `Promise.all`, active only on the acknowledgments tab) instead of `pendingAcks.some(r => r.ackId !== null)`. `pendingAcks` itself and the tab's badge count are untouched, per the ticket's explicit instruction.
- `src/components/admin/ledger/txn-donor-actions.tsx`: dropped the `amountCents >= 25000` condition on the Acknowledge button (now renders whenever `ackStatus === null`, any amount); updated the JSDoc; threads `amountCents` into `AcknowledgeDialog`.
- `src/components/admin/ledger/acknowledge-dialog.tsx`: added a required `amountCents` prop; pre-selects `typeOverride` and shows the inline courtesy note via two new pure helpers (see below); reworded the `written_ack_250` option to drop `"($250+)"`.
- Extracted the amount-threshold decision into `src/lib/acknowledge-dialog-ui.ts` (`isUnderAckThreshold`, `defaultTypeOverride`, `showCourtesyNote`) — **not named in the Phase 3 design**, added because `AcknowledgeDialog` renders inside a Radix `Dialog.Portal`, which no-ops under this project's DOM-less Vitest config (`environment: "node"`, no jsdom/Testing Library — verified this empirically before writing the tests: `renderToStaticMarkup` of the dialog comes back as an empty string). Mirrors the codebase's own established split (`ack-queue-ui.ts`'s documented rationale) rather than adding a new pattern or a new dependency.
- Found and fixed two other `AcknowledgeDialog` call sites that needed the now-required `amountCents` prop to keep compiling: `AckQueue` (`ack-queue.tsx`, looks up the row by `txnId`) and the donor detail page (`donors/[id]/donor-detail-client.tsx`, looks up the row in `givingHistory`). **Left the donor detail page's own separate `>= 25000` Acknowledge-button gate untouched** — it's a third copy of the same amount check Phase 1/3 didn't surface, out of scope for this ticket's named surfaces (register + worklist only); flagged below for a backlog item.
- Wrote every test the Phase 3 design named (items 1–11), plus one addition (`acknowledge-dialog-ui.test.ts`) that replaces the Radix-portal-blocked component test for items 9–10 with an equivalent pure-function test, and a small extra `TxnDonorActions` coverage case (button *not* rendered once an ack exists).

### Outputs

- `src/lib/ledger-queries.ts` — added `listUnlinkedGifts()` + `UnlinkedGiftRow` type.
- `src/lib/ledger-queries.test.ts` — 8 new tests: `listUnlinkedGifts` (no amount floor, no category exclusion, donor_id/transfer_group_id/donations_deductible/flow/status WHERE-clause assertions, FY-omitted vs FY-provided bounds) + 1 regression test on unmodified `listAcknowledgmentsSummary` proving the Part 3 bug #1 fix's dependency (design doc test #8).
- `src/lib/acknowledge-dialog-ui.ts` — new pure helper module (not in the Phase 3 file list — see rationale above).
- `src/lib/acknowledge-dialog-ui.test.ts` — new; covers design doc tests #9–10 (pre-selected override below $250, auto-detect at/above $250, courtesy note visibility).
- `src/components/admin/ledger/unlinked-gifts-list.tsx` — new.
- `src/components/admin/ledger/txn-donor-actions.tsx` — dropped the amount gate; threads `amountCents`.
- `src/components/admin/ledger/txn-donor-actions.test.tsx` — new; covers design doc test #11 plus the "ack already exists" negative case.
- `src/components/admin/ledger/acknowledge-dialog.tsx` — `amountCents` prop, pre-selected override + courtesy note via the new helper, relabeled option.
- `src/components/admin/ledger/ack-queue.tsx` — passes `amountCents` to `AcknowledgeDialog` (row lookup by `txnId`).
- `src/components/admin/ledger/fiscal-year-selector.tsx` — additive `allowAll` prop, `currentFY: number | "all"`.
- `src/app/(dashboard)/admin/ledger/donors/page.tsx` — new "unlinked" tab, new `fy` param handling, Generate Letters gate fix.
- `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx` — passes `amountCents` to `AcknowledgeDialog` (row lookup by `txnId` in `givingHistory`); its own separate `>= 25000` gate left as-is (out of scope, flagged below).
- No `docs/decisions.md` entry — nothing here rises above what Phase 3 already pinned down, except the `acknowledge-dialog-ui.ts` extraction, which is a same-codebase-convention testability split (mirrors `ack-queue-ui.ts`), not a new architectural decision.

## Schema Changes

None.

### Open questions / handoff notes

- **For qa (Phase 5):** manual click-through should cover — (1) linking a donor to a sub-$250, `ackNotRequired`-category Foundation gift from the new Unlinked Gifts tab; (2) acknowledging a $20 Foundation gift from the register, confirming the courtesy note appears and the type-override pre-selects "Written acknowledgment"; (3) confirming that gift is then reachable end-to-end through "Generate Letters…" even when it's the only unsent ack in the system (the Part 3 bug #1 regression, verified at the query layer in this phase but worth confirming in the browser too); (4) the `typeOverride` pre-selection + quid-pro-quo interaction edge case Phase 3 flagged (open the dialog on a sub-$250 gift, enter a qualifying quid-pro-quo value, confirm the dropdown needs manual switching to `quid_pro_quo_75` — documented, deliberately not auto-resolved); (5) `/admin/ledger/donors?tab=unlinked` at 360px — reuses `AckQueue`'s already-mobile-verified `overflow-x-auto` table pattern, not independently re-screenshotted here.
- **New copy the Lions Club may want to refine:** the Unlinked Gifts empty state ("No unlinked Foundation gifts." / "Every posted gift in this range has a donor attached."), the row-count line ("{n} Foundation gift(s) with no donor linked."), and the courtesy note in `AcknowledgeDialog` ("This gift is under the $250 IRS threshold…").
- **UX decision flagged for a backlog item, not fixed here:** `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx` has its own, third copy of the `amountCents >= 25000` Acknowledge-button gate (line ~249), duplicating exactly the decision this ticket removed from `txn-donor-actions.tsx`. Phase 1/3 review scoped this ticket to the register (`[fundSlug]`) and the new worklist tab only, so I left the donor-detail page's gate untouched — but per CLAUDE.md's duplication-is-a-correctness-finding rule, this is now the same decision hard-coded in two places (one on, one off), which is exactly the shape of drift that rule exists to catch. Recommend a follow-up ticket to remove that third gate for consistency.
- **Both non-negotiables verified untouched:** `listPendingAcknowledgments()`'s `$250` floor and `deriveAckType()` — neither function was edited; confirmed via `git diff` scope and by the new tests asserting the *new* query has no such floor (rather than asserting the old one changed).
- Recommend the analyst/user log the pre-existing `ackNotRequired`-category letter-generation gap (Phase 3 Edge Cases & Risks) as a backlog item, as tech-lead already recommended — still out of scope here, not silently resolved.

### Addendum — donor-detail page's third gate, pulled back into scope (2026-09-22)

The coordinator reviewed this Phase 4 report and overrode the "out of scope" call above: leaving `donors/[id]/donor-detail-client.tsx`'s own `amountCents >= 25000` Acknowledge gate in place meant the Treasurer could acknowledge a $20 gift from the register and from the new Unlinked Gifts tab, but not from the donor's own detail page — the single most natural place to look at one donor's giving history and act on it. That's a worse end state than the uniform $250 gate this ticket started with (inconsistent beats uniformly-wrong), and it is exactly the "same decision in more than two places" correctness finding CLAUDE.md calls out by name, not a style nit. Fixed in the same Phase 4 pass, same implementer, no new phase needed — this was a completeness correction to Part 2's own stated goal ("Acknowledge at any amount"), not a new feature.

**What changed:**
- `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx` — removed the `row.txn.amountCents >= 25000` half of the Acknowledge button's render condition; it now matches `txn-donor-actions.tsx` exactly (`ackStatus === null`, any amount). `amountCents` was already threaded to `AcknowledgeDialog` from the earlier pass (needed once the prop became required), so no further plumbing was needed there.
- `src/lib/acknowledge-dialog-ui.ts` — expanded the module header with an explicit **IMPORTANT** note: this module answers a UI-affordance question (pre-select the override, show the courtesy note), `deriveAckType()` (`src/lib/ledger.ts`, untouched) answers the IRS-rule question, and the two must stay separate functions even though they currently share the $250 figure — so a future pass doesn't "deduplicate" them into one and quietly couple UI convenience to tax law. Also documents, in the same header, that no Acknowledge-button visibility check anywhere in the app gates on amount anymore at all.
- New `src/lib/acknowledge-threshold-consolidation.test.ts` — a static-source regression test (same technique `admin-page-feature-gates.test.ts` already uses in this codebase) that fails if a bare `amountCents >= 25000`-shaped comparison reappears in any of the six UI files this feature touches, with an explicit allowlist (and reasoning) for the three files that legitimately still contain the literal `25000` for unrelated reasons (`acknowledge-dialog-ui.ts` itself, `deriveAckType()`, `listPendingAcknowledgments()`'s untouched $250 floor, and `ledgerSettings.disbApprovalThresholdCents`'s coincidentally-identical default). Also directly asserts the donor-detail page's specific old condition string is gone.
- New `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.test.tsx` — renders `DonorDetailClient` (via `renderToStaticMarkup`, same technique as `txn-donor-actions.test.tsx` — its Radix dialogs are all closed on initial mount, so no Portal blocks the static render) with a sub-$250, unacknowledged giving-history row and asserts the Acknowledge button is present.

**Gates re-run after this addendum:** `pnpm exec tsc --noEmit` — PASS. `pnpm test` — PASS (2029/2029, up from 2025). `pnpm build:only` — PASS (`✓ Compiled successfully`).

**Verified untouched again:** `deriveAckType()` and `listPendingAcknowledgments()`'s $250 floor — neither function was edited in this addendum either; the consolidation test's allowlist exists precisely so both can keep expressing the $250 figure independently without tripping the new guard.

---

## Phase 5 — Verification — 2026-09-22

**Owner:** qa
**Status:** complete

### Summary

**PASS.** All three automated gates are green (typecheck, 2029/2029 Vitest, production build), every code claim in the Phase 4 report and addendum checked out against the actual diff (not inferred from the report), and I drove the treasurer's literal request — acknowledging a $20 Foundation gift — through a real browser session against the dev DB, end to end, with no 422. The one non-negotiable this ticket could not touch (`listPendingAcknowledgments()`'s $250 floor, `deriveAckType()`) is confirmed untouched three ways: an empty `git diff` on `src/lib/ledger.ts`, a structural WHERE-clause test proving the new query has no floor of its own, and a live entry-point check. Scope matched the ticket exactly — no schema, no new route, no new permission key, proportionate verification (no live-fixture treatment).

### What I did

**Automated gates (re-run myself, not trusted from the report):**
- `pnpm exec tsc --noEmit` — **PASS**, clean.
- `pnpm test` — **PASS**, 112 files / 2029 tests, 2.05s. Matches the Phase 4 report's reported count exactly.
- `pnpm build:only` — **PASS**, `✓ Compiled successfully in 790ms`, no warnings, full route manifest printed with no errors.

**Source-level audit (read the actual diffs, not the report's description of them):**
- `git diff -- src/lib/ledger.ts` — **empty**. `deriveAckType()` is byte-for-byte untouched, confirming the IRS-rule function this ticket must never touch.
- `git diff -- src/lib/ledger-queries.ts` — confirmed `listPendingAcknowledgments()`'s function body has zero changed lines; `listUnlinkedGifts()` is purely additive below it. Read the new function directly: `donorId IS NULL`, `transferGroupId IS NULL`, `donationsDeductible = true`, `flow = 'income'`, `status = 'posted'`, no amount condition, no `ackNotRequired`/category condition, optional `fyBounds()` bracket — matches the design doc's filter list exactly.
- `git diff -- src/components/admin/ledger/txn-donor-actions.tsx acknowledge-dialog.tsx` — confirmed the `amountCents >= 25000` gate is gone from the button's render condition (now `ackStatus === null` only), `amountCents` is threaded into `AcknowledgeDialog`, `typeOverride`'s initial state now calls `defaultTypeOverride(amountCents)`, the courtesy note renders via `showCourtesyNote(amountCents)`, and the dropdown option text reads `"Written acknowledgment"` with no `"($250+)"` qualifier.
- `git diff -- .../donor-detail-client.tsx` (the addendum's third gate) — confirmed the same `amountCents >= 25000` half of the condition is removed; `amountCents` is now threaded into that page's `AcknowledgeDialog` call too, sourced from a `givingHistory.find()` lookup.
- `git diff -- .../donors/page.tsx` — confirmed the Generate Letters link's visibility now depends on a new `listAcknowledgmentsSummary({ pendingOnly: true, includePii: false })` fetch (`anyUnsentAck`), fetched only on the acknowledgments tab, and that `pendingAcks`/`pendingAckCount` (the badge) are untouched — still driven by the unmodified, still-$250-floored `listPendingAcknowledgments()`. Read `listAcknowledgmentsSummary()` directly: its only WHERE condition under `pendingOnly` is `sentAt IS NULL` — no amount floor anywhere in the function, confirming it's a legitimate fix for the fixed gate to depend on.
- Read `src/lib/acknowledge-dialog-ui.ts` in full — a clean, well-documented pure module; its own header explicitly warns against ever merging its $250 figure with `deriveAckType()`'s, which is exactly the discipline this ticket needed.
- Read `src/lib/acknowledge-threshold-consolidation.test.ts` in full — a genuine static-source regression test (same technique as `admin-page-feature-gates.test.ts`), with an explicit, reasoned allowlist for the four files legitimately allowed to still say `25000`. Confirmed it's wired into the same `pnpm test` run (part of the 2029).
- `git diff --stat -- src/app/api` — **empty**. No API route file was touched by this feature; both routes it depends on are pre-existing.

**Feature-gate audit (read the route/page files directly, per the mandatory audit — see table below).**

**Live click-through (real browser, real dev DB, per item 5's "prove it rather than inferring it"):**
- Started `pnpm dev` against `.env.local`'s `DATABASE_URL` (confirmed this is the dev host, `ep-orange-sunset-...`, distinct from `PROD_DATABASE_URL`'s `ep-rough-smoke-...` — never touched the latter).
- Wrote a temporary Playwright spec (not committed, deleted before finishing — see below) modeled on `e2e/ack-queue-workflow.spec.ts`'s own sign-in/create/teardown pattern, using a dedicated sentinel fiscal year (FY2097, unclaimed by any existing suite per their own comments) so it could never collide with real or other-suite data. Signed in as the real e2e admin account (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`) and:
  1. Recorded a real $20.00 Foundation income transaction on the `/admin/ledger/charitable` register.
  2. Confirmed the **Acknowledge button renders** on that sub-$250 row (Part 2's core claim — previously impossible).
  3. Opened `AcknowledgeDialog` and confirmed the **courtesy note is visible** ("under the $250 IRS threshold...") and the **type-override `<select>` is pre-selected to `written_ack_250`**, with its option text reading exactly `"Written acknowledgment"` (no `"($250+)"` — confirmed absent).
  4. Submitted with no further input and captured the network response: **`POST .../acknowledge` returned 201**, not 422, with `type: "written_ack_250"` and `amountCents: 2000` in the response body — this is direct proof the pre-selection actually prevents the 422 the design doc predicted without it.
  5. Navigated to `/admin/ledger/donors?tab=unlinked&fy=2097` and confirmed the **same transaction appears** in the Unlinked Gifts tab (it was never donor-linked) with a working "Link donor" button.
  6. Navigated to `/admin/ledger/donors?tab=acknowledgments` and confirmed the **"Generate Letters…" link is visible** with the sub-$250 unsent ack now in the system (Part 3 bug #1's entry point).
  - All 3 assertions passed on the corrected run (two early failures were test-script bugs on my part — a wrong sentinel-year/date pairing and a Playwright `option`-visibility quirk — not product bugs; documented and fixed before the run that counts).
- Verified dev-DB cleanup after the run: `SELECT count(*) FROM ledger_transactions WHERE party LIKE 'QA Temp SubThreshold%'` → **0**, and the joined acknowledgment row count → **0**. The spec's own `afterAll` (transaction DELETE, cascading the ack row via FK) worked correctly even on the two failed intermediate runs — verified no orphan rows before proceeding each time.
- Deleted the temporary spec file (`e2e/qa-temp-unlinked-gifts-any-amount-ack.spec.ts`) and `test-results/` before finishing; `git status --porcelain` afterward matches the pre-verification Phase 4 file set exactly, with no stray changes.
- Stopped the dev server.

**Not independently re-driven in the browser (covered instead by direct code + existing test evidence, per the ticket's proportionality instruction):**
- The `typeOverride` pre-selection vs. quid-pro-quo interaction edge case (Phase 3/4 flagged this as a documented, deliberately-not-auto-resolved case, not a defect to hunt for) — confirmed by reading the code that the dropdown stays editable and nothing auto-re-derives after a manual change; this is the designed behavior, not a bug.
- Mobile at 360px for the new tab — reuses `AckQueue`'s existing `overflow-x-auto` pattern verbatim (confirmed by reading `unlinked-gifts-list.tsx`), which is already relied on unmodified by the two existing tabs on this same page.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS**

#### Unit Tests
`pnpm test`: **PASS**
Total: 2029 | Passed: 2029 | Failed: 0
Duration: 2.05s (112 test files)
Failures: none

#### Production Build
`pnpm build:only`: **PASS**
Notes: `✓ Compiled successfully in 790ms`; full static/dynamic route manifest printed with no errors or warnings; no new routes introduced (confirmed via `git diff --stat -- src/app/api`, empty).

#### End-to-End Tests
`pnpm test:e2e` (full suite): **not re-run in full** — proportionate to a small, additive, no-new-route ticket per the assignment's explicit instruction ("Scale verification accordingly... Do not pad"), and the full suite is a ~12-minute serial run against the same shared dev DB every other spec in this project also depends on. Instead, drove the exact user-facing flow live (see "Live click-through" above) with a dedicated, collision-free sentinel fiscal year, cleaned up afterward, and confirmed via `git status` / direct DB queries that no state was left behind.
Total: 3/3 ad hoc verification checks passed (temporary spec, deleted after the run — not part of the permanent suite)
Failures: none (after fixing two test-script issues unrelated to the product — see above)

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Acknowledge button renders on a sub-$250 Foundation register row | pass | `ackStatus === null` gate confirmed live; no amount check |
| AcknowledgeDialog courtesy note + pre-selected type override below $250 | pass | Note text visible; `<select>` value = `written_ack_250`; option label reads "Written acknowledgment" with no "($250+)" |
| Submitting the sub-$250 ack does not 422 | pass | `POST .../acknowledge` → 201, `type: written_ack_250`, `amountCents: 2000` |
| Same gift reachable from Unlinked Gifts tab (any amount, no donor) | pass | Row visible at `?tab=unlinked&fy=2097` with working Link donor button |
| Generate Letters entry point reachable with only a sub-$250 unsent ack in play | pass | Link visible on Pending Acknowledgments tab |
| Permission gate — donors page + both routes read directly, not inferred | pass | See Feature-Gate Audit below |
| Dev DB left clean after verification | pass | 0 stray transactions, 0 stray acknowledgments, confirmed by direct query |

### Regression Tests Added

*(Written by the implementer per CLAUDE.md's Phase 4 gate — "every unit test named in the Phase 3 design doc is written and passing, the implementer delivers these, not qa." I verified each by reading it, not by trusting the pass count alone.)*

- `listUnlinkedGifts()` — no amount floor — `src/lib/ledger-queries.test.ts` — guards against: the worklist silently re-acquiring a $250 floor and hiding small gifts again.
- `listUnlinkedGifts()` — no `ackNotRequired` category exclusion — `src/lib/ledger-queries.test.ts` — guards against: the worklist silently excluding categories the Treasurer explicitly asked to include.
- `listUnlinkedGifts()` — `transferGroupId IS NULL` — `src/lib/ledger-queries.test.ts` — guards against: internal Club↔Foundation transfer legs appearing as donor-linkable gifts.
- `listAcknowledgmentsSummary({ pendingOnly: true })` — no amount floor (Part 3 bug #1 regression) — `src/lib/ledger-queries.test.ts` — guards against: the fixed Generate Letters gate silently depending on a function that later grows a floor.
- `defaultTypeOverride` / `showCourtesyNote` boundary tests at $249.99 / exactly $250 — `src/lib/acknowledge-dialog-ui.test.ts` — guards against: an off-by-one on the IRS threshold boundary.
- `TxnDonorActions` renders Acknowledge at $20 and at $500, not once an ack exists — `src/components/admin/ledger/txn-donor-actions.test.tsx` — guards against: the amount gate regressing on the register specifically.
- `DonorDetailClient` renders Acknowledge for a sub-$250 gift — `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.test.tsx` — regression for: the addendum's third-copy-of-the-gate bug (donor detail page silently disagreeing with the other two surfaces).
- `acknowledge-threshold-consolidation.test.ts` — static-source scan for a reintroduced bare `amountCents >= 25000` in any of the 6 UI files this feature touches — regression for: the exact duplication CLAUDE.md's "same decision in more than two places" rule exists to catch, which is what caused the addendum in the first place.

### Coverage on Critical Modules

Not separately measured with `--coverage` for this ticket — out of proportion for an additive change to a file (`ledger-queries.ts`) that isn't itself one of the three modules this project holds to a numeric coverage target (`events.ts` 90%+, `permissions.ts` 100%, `members.ts` 80%+). None of those three modules were touched by this feature; confirmed via `git diff --stat` (not present in the changed-file list).

### Feature-Gate Audit (mandatory before PASS)

No new protected route or server action shipped — every surface this feature touches reuses an existing, already-gated route or page. Read each directly rather than inferring from passing tests:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `GET /admin/ledger/donors` (page, incl. new "unlinked" tab) | yes (`page.tsx:30-31`) | yes (`page.tsx:34-35`, redirects if absent) | `FEATURES.LEDGER_RECORD` |
| `PATCH /api/admin/ledger/transactions/[id]` (donor-link, reused by `LinkDonorDialog` on the new tab) | yes (`route.ts:162`) | yes (`route.ts:166`) | `FEATURES.LEDGER_RECORD` |
| `POST /api/admin/ledger/transactions/[id]/acknowledge` (now reachable at any amount) | yes (`route.ts:141`) | yes (`route.ts:145`) | `FEATURES.LEDGER_RECORD` |
| `PATCH /api/admin/ledger/transactions/[id]/acknowledge` (Mark Sent) | yes (`route.ts:375`) | yes (`route.ts:379`) | `FEATURES.LEDGER_RECORD` |
| `listUnlinkedGifts()` (new query fn, not a route — called only from the already-gated Server Component page) | n/a (no independent entry point) | n/a — inherits the page's gate | n/a |

No route returns bulk PII to a wider audience than before: `listUnlinkedGifts()` is only ever called from `donors/page.tsx`, which is already gated identically to the other three tabs on the same page (`donors`, `acknowledgments`, `sent`) that already return donor/gift data to the same `LEDGER_RECORD` holders. No widening occurred.

### Verified Fact vs. Root-Cause Theory

**Established (reproduced/confirmed by more than one method):**
- The `>= $250` gate is gone from all three Acknowledge-button call sites — confirmed by `git diff` (source) and by live browser interaction (button visible, dialog pre-selected, POST returns 201) on one of the three (the register); the other two (`AckQueue`, donor-detail) confirmed by source diff + their own unit/component tests, which I read directly.
- `listPendingAcknowledgments()` and `deriveAckType()` are untouched — confirmed by empty `git diff` on the relevant function/file, independent of anything the report claimed.
- The Generate Letters entry-point fix works — confirmed by source diff, by the unit test proving `listAcknowledgmentsSummary({ pendingOnly: true })` has no floor, and live in the browser with a real sub-$250 unsent ack as the state.

**Theory, not independently re-verified here (inherited from Phase 3/4, consistent with what I read):**
- The pre-existing `ackNotRequired`-category letter-generation gap (out of scope per the assignment) — I did not re-derive this from the letter-generation code myself; I'm relying on Phase 3's citation (`ledger-acknowledgment-letter-queries.ts:105-114` / `355-362`), which is internally consistent with the rest of what I did verify and was called out explicitly as out of scope. Not re-checked because the assignment explicitly says not to fail on it.

### Open questions / handoff notes

- **Verdict: PASS.** Nominating **analyst** for Phase 6.
- Recommend the analyst/user log the `ackNotRequired`-category letter-generation gap as a backlog item, as both tech-lead and ux-developer already recommended — real, but a policy call, still out of scope for this ticket.
- No regressions found, no loop-back needed. The addendum (donor-detail page's third gate) was the one place Phase 4 caught its own gap before QA had to — worth noting in Phase 6 as a case where mid-phase coordinator review worked as intended.
- The temporary e2e spec used for the live click-through was deliberately not committed (per the assignment's proportionality guidance and "Do NOT commit or push") — if a future review wants a permanent e2e regression test for the register's Acknowledge-button gate specifically, that's a reasonable small follow-up, not a blocker for this ticket.

---

# Phase 6 — Shipped vs Intent — 2026-09-22

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Both of the Treasurer's literal asks now work end to end — a $20 gift can be found, donor-linked, and acknowledged without a 422 — and the two non-negotiables (the $250 "needs a letter" floor, `deriveAckType()`) are provably untouched; the only thing keeping this off a clean SHIP IT is that a real, repeatedly-flagged policy gap never made it into `docs/backlog.md` where it can't be forgotten.

## What I Did

- Re-read this file's own Phase 1 section against the shipped code rather than trusting Phase 3/4/QA's summaries of it.
- Independently re-verified, by reading source directly (not re-trusting the work-log's citations):
  - `listUnlinkedGifts()` in `src/lib/ledger-queries.ts` (lines ~5162–5202) — confirmed no amount condition, no `ackNotRequired`/category condition, `isNull(donorId)`, `isNull(transferGroupId)`, `donationsDeductible = true`, `flow = 'income'`, `status = 'posted'`, optional `fyBounds()` bracket. Matches "any amount, any income category, transfers excluded" exactly.
  - `listPendingAcknowledgments()` (lines ~5075–5115) — the `>= 25000` floor and the `ackNotRequired` category exclusion are both still present, unchanged.
  - `git log --oneline -- src/lib/ledger.ts` — no commit from this feature touches the file that holds `deriveAckType()`. The IRS rule is untouched, independently of any UI affordance.
  - `src/lib/acknowledge-dialog-ui.ts` — read in full. Cleanly separate from `deriveAckType()`, with an explicit module-level warning against ever merging the two.
  - `txn-donor-actions.tsx` and `donor-detail-client.tsx` — both Acknowledge buttons now gate on `ackStatus === null` only, no amount check anywhere.
  - `src/lib/acknowledge-threshold-consolidation.test.ts` — a real static-source regression test, with a reasoned, narrow allowlist for the four files legitimately allowed to still say `25000`.
  - `unlinked-gifts-list.tsx` — `rounded-2xl` card/table containers, `bg-gray-50 ... text-gray-500` empty state, no `window.confirm`, no destructive action on this surface at all (nothing to confirm).
  - `docs/backlog.md` — grepped for any trace of the `ackNotRequired`-category letter-generation gap. **None found.** Phase 3, Phase 4, and QA each independently recommended logging it; nobody actually did.
- Did not re-run the e2e click-through myself — QA's live browser proof (real $20 transaction, `POST .../acknowledge` → 201 with `type: written_ack_250`, `amountCents: 2000`, then reachable through both the Unlinked Gifts tab and the Generate Letters entry point) is concrete, reproducible, and consistent with the source I read independently. Re-driving it would be redundant, not additional rigor, for a ticket this size.

## What's Working

- **The actual Treasurer request, verified twice over.** Ask 1 (link a donor to a sub-$250 gift) and Ask 2 (send a $20 acknowledgment letter) both work, confirmed by source read plus QA's live 201 response — not just "the code looks right," an actual sub-$250 gift went in one end and a sendable acknowledgment came out the other, through the Unlinked Gifts tab, the register, and Generate Letters, in one continuous browser session.
- **The negative property held.** This is the one QA and the design doc were most careful about, and it's real: `listPendingAcknowledgments()`'s $250 floor and its `ackNotRequired` exclusion are byte-for-byte unchanged. A sub-$250 gift, courtesy-acknowledged or not, still never appears in the Pending Acknowledgments queue as an obligation. That queue still means what it always meant.
- **The mid-phase catch on the donor-detail page's third gate.** Phase 4 shipped an inconsistent state (button on in two places, off in a third) and the coordinator caught it before QA had to. That's the pipeline working as designed, and the fix included a static-source test (`acknowledge-threshold-consolidation.test.ts`) that makes the specific mistake structurally hard to reintroduce — a better outcome than just patching the third site and moving on.

## Intent-vs-Shipped Diff

- Phase 1 said: any-amount, any-category, transfer-excluded worklist at `/admin/ledger/donors?tab=unlinked`. Shipped: exactly that, via `listUnlinkedGifts()`. **Matches.**
- Phase 1 said: remove the `>= $250` Acknowledge-button gate on the register. Shipped: gate removed on the register, **plus** the same gate independently removed from `AckQueue` and the donor-detail page once Phase 4 noticed those were the same decision duplicated. **Acceptable drift** — Part A below judges this call directly.
- Phase 1 said: fix the "Generate Letters…" entry-point visibility bug so a sub-$250-only ack doesn't dead-end. Shipped: gate switched to unfloored `listAcknowledgmentsSummary({ pendingOnly: true })`, `pendingAcks`/badge count left untouched. **Matches.**
- Phase 1 said: reword the misleading `"($250+)"` dropdown option and add a courtesy-vs-required inline note. Shipped: both, plus pre-selecting the override so the happy path never 422s in the first place (a Phase 3 addition, not a Phase 1 ask, but directly in service of it). **Matches, with a reasonable addition.**
- Phase 1 said (Out of Scope, confirmed): no change to `listPendingAcknowledgments()`'s floor, no new letter template, no bulk-link tool. Shipped: none of those changed. **Matches.**
- Phase 1 flagged (Open Question): whether a "not applicable / dismiss" action is wanted for structurally-odd unlinked rows. Not built, not answered by the Treasurer, correctly left open rather than assumed. **Matches — appropriately deferred, not silently dropped.**

## Assessment (per the coordinator's three questions)

**A. The mid-phase scope addition (donor-detail page's third gate).** The right call, and for the reason given: shipping two entry points where "Acknowledge a $20 gift" works and a third, equally natural one (the donor's own detail page) where it doesn't is a worse, more confusing end state than the uniform $250 gate this ticket started with — a treasurer who tries it from the "wrong" page and gets nothing would reasonably conclude the feature is broken, not that they picked the wrong URL. Pulling it in was proportionate: same implementer, same pass, no new phase, and it came with its own regression test rather than a bare fix. On the `acknowledge-dialog-ui.ts` vs. `deriveAckType()` split: **keep them separate**, and the module's own header comment already makes the argument better than I could restate it — one encodes what the server enforces (Pub. 1771), the other encodes what the dialog shows before submission. They agree on a number today; they are not obligated to agree forever, and collapsing them would make a future independent change to either impossible to express without a comment archaeology exercise. I would not touch this.

**B. Did the pipeline right-size itself?** Mostly yes. Skipping Phase 2 with a recorded, re-verified-not-just-carried-over rationale was correct — no new directory, no new dependency, no new permission, no new route. QA's choice not to re-run the full e2e suite but instead drive one real, cleaned-up, collision-proof browser session against a sentinel fiscal year is exactly the right proportionality call for a no-new-route ticket touching three existing gates. Where I'd push back slightly: the amount of prose in this work-log (three full re-verification passes — tech-lead re-checking Phase 1's citations, QA re-checking Phase 4's diffs, now me re-checking QA's) is more redundant checking than the risk here warrants. Each pass found real things (tech-lead caught two wrong Phase 1 claims about component layout; QA caught nothing wrong but did catch the value of proving the 201 live rather than trusting a unit test). That's a genuine argument for verifying, not just asserting. But the write-up volume is disproportionate to a "one read-only tab, one gate removal, two copy fixes" ticket — this is the broader over-processing pattern the coordinator is asking about, and my honest read is yes, it happened here, mildly. I would not change what got checked; I would compress how much of the checking got narrated.

**C. The deferred `ackNotRequired` letter-generation exclusion.** Deferring the *fix* was right — whether `ackNotRequired`-category gifts should ever produce a generated letter is a real policy call (the flag's own documented purpose is "these will never produce a donor acknowledgment"), and resolving it silently inside a bug-fix-shaped ticket would be exactly the kind of unilateral policy call this pipeline exists to avoid. But deferring the *tracking* was not done correctly: three separate phases (tech-lead, ux-developer, qa) each said "recommend logging this as a backlog item," and none of them logged it — `docs/backlog.md` has no trace of it. A recommendation repeated three times and written by nobody is functionally the same as never having surfaced it, from the Treasurer's perspective. **What he should be told plainly:** the "any income category" decision now means he *can* link a donor and record a courtesy acknowledgment against a gift in a category like grants, race entries, or pooled fundraiser deposits — but if he does, that acknowledgment will never appear on `/admin/ledger/donors/letters`, silently, because `generateAcknowledgmentLetters()` hard-skips any `ackNotRequired`-category row regardless of amount or whether an ack record exists. This was already true today for $250+ gifts in those categories; his own scoping decision just makes it reachable more often. He should decide, not have it decided for him by omission, whether `ackNotRequired` should mean "never generate a letter" (current, silent) or "don't require one, but still generate on request" (a real code change). Until he decides, the correct interim behavior is what's shipped — but it needs to be a tracked, visible gap, not a comment in a work-log three phases deep.

## Edge Cases

- Empty state: **pass** — `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, copy reads "No unlinked Foundation gifts. Every posted gift in this range has a donor attached." — helpful, matches convention, avoids "No results."
- Failure microcopy: **pass** — Flow 1 (link donor) reuses `LinkDonorDialog`'s existing toast error path verbatim, nothing new to regress. Flow 2's only failure modes (409 already-acknowledged, 422 missing type) are pre-existing, unchanged paths, and the 422 path is now effectively unreachable from the UI since the override pre-selects.
- Permission gate: **pass** — confirmed directly (not inferred from QA's table) that `FEATURES.LEDGER_RECORD` gates the donors page, the PATCH donor-link route, and both acknowledge routes; no widening of who can see what.
- Mobile (360px): **pass, by inheritance** — `unlinked-gifts-list.tsx` uses the same `overflow-x-auto` table wrapper as `AckQueue`, which is already relied on unmodified at this width by the two existing tabs on the same page. Not independently re-screenshotted, which is proportionate for a layout with zero new responsive mechanism.

- **Logged as `B-63` in `docs/backlog.md` (Now tier)**, done as part of this Phase 6 review rather than left as a third unactioned recommendation: `generateAcknowledgmentLetters()` / `listGeneratableAcknowledgments()` hard-exclude any acknowledgment whose transaction's category is flagged `ackNotRequired`, independent of amount — this was already true at $250+ and is now reachable more often given "any income category." Needs the Treasurer's explicit decision on whether `ackNotRequired` should ever produce a generated letter. This is the one action item that actually closes this ticket's own loose end; everything else shipped clean.
- **Tell the Treasurer directly, in plain language** (not just log it): if he links a donor and records a courtesy acknowledgment on a gift in a category like grants or race entries, the resulting acknowledgment will not show up in "Generate Letters" — so he should not assume every acknowledgment he records is retrievable as a letter until this policy question is resolved.
- **Optional, low priority:** a permanent Playwright regression for the register's Acknowledge-button-at-any-amount gate, to replace the temporary spec QA wrote and deleted for this verification. Not a blocker — the unit/component tests already give equivalent coverage — but a future full e2e-suite regression on this specific gate would need to be written from scratch otherwise.

## Red Flags

None. Nothing here blocks shipping.
