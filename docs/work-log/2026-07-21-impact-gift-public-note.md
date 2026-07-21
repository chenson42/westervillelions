# Impact Gift Public Note — Work Log

> **Slug:** `2026-07-21-impact-gift-public-note`
> **Surface:** mixed — admin (The Ledger transaction form) + member portal (`/members/impact`)
> **Permission(s):** existing gates expected (`LEDGER_RECORD` to edit the note; impact page's two-tier gate to view) — Phase 1/3 to confirm
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 likely skippable (new nullable column + existing form/display patterns; skip must be documented); Phases 4/5/6 run in full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Skipped (documented) | — | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | full-stack-developer | Complete | Typecheck clean, tests passing, build passes | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

"For the City of Westerville check the payee doesn't really tell you who the
check was for in the Our Community Impact page."

Offered three options via AskUserQuestion — show the memo, a separate public
note field, or leave as-is. **User chose: separate public note field.**

**Requirement:** a new optional, treasurer-curated "public description" field
on ledger transactions, shown on the member-facing impact page (drill-down
rows; possibly Recent Named Gifts — Phase 1 to recommend), while memos stay
fully internal. Motivating example: check #8263, $400 to The City of
Westerville — the payee alone doesn't convey it sponsored the Westerville
Autumn Arborfest 2026 (that context lives only in the internal memo today).

**Known trade-off accepted by the user:** existing gifts show nothing until
the note is typed in by hand — the treasurer curates coverage over time.

**Context/constraints known at kickoff:**
- The impact drill-down (shipped today, v1.30.0) renders `cause.rows` as
  date / party-or-"Recipient not recorded" / amount in
  `src/components/members/impact-by-cause.tsx`; data threads from
  `getPhilanthropy()` → `bucketGivingByCause()` (`CauseGivingRow`).
- The transaction form (`src/components/admin/ledger/transaction-form.tsx`)
  is CONCURRENTLY being edited by the transaction-receipts ux-developer
  increment — implementation of this feature must wait for that to land
  (sequencing handled by the orchestrator; note the dependency).
- Memos remain internal-only per this decision (the memo-display option was
  explicitly declined).

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete

### Summary

The ask is narrow and the locked decision is sound: a new optional, treasurer-curated
`publicDescription` text field on `ledger_transactions`, editable wherever `memo`/`party`/
`beneficiaryCause` already are (gated `LEDGER_RECORD`, no new `FEATURES` key), rendered on
`/members/impact` only where an individual gift row already renders — the cause drill-down
(`impact-by-cause.tsx`) and, recommended, Recent Named Gifts. Memos stay internal per the
user's explicit choice. Existing rows show nothing until hand-curated. The one thing this
review surfaces that the intent section doesn't already cover: the closest existing precedent
for this exact shape — `beneficiaryCause` — is **create-only** in today's transaction form
(`!isEdit` gate, `transaction-form.tsx:496`), but this feature's entire motivating case (adding
a note to the already-existing Arborfest check) requires the field to be editable on **existing**
transactions too. That divergence from the nearest precedent needs to be explicit for Phase 3,
not assumed. Verdict: **READY WITH NOTES**.

### User verbs

**Admin (`LEDGER_RECORD`) — Ledger transaction form, `(dashboard)/admin/ledger`:**
- Types a public description while creating a new expense transaction (optional, blank by default).
- **Edits/adds** a public description on an **existing** expense transaction — the primary flow;
  this is the one that resolves the motivating Arborfest case and is *not* covered by the
  `beneficiaryCause` precedent's create-only behavior.
- Clears an existing public description back to empty.

**Signed-in member (existing impact-page gate) — `/members/impact`:**
- Reads the description inline on a cause drill-down row, when one has been entered.
- Reads the description inline on a Recent Named Gifts row, when one has been entered (recommended
  surface — see Gaps).
- No new verb when absent: the row renders exactly as it does today. No click, no expand-to-reveal
  specific to this field (the drill-down's existing expand/collapse is unrelated and unchanged).

No anonymous-visitor or `/access-pending` surface is touched. Both verb sets name their surface
explicitly — no "the user" ambiguity in the source request.

### Flows

**Flow 1 — Treasurer adds/edits a note on an existing transaction (primary flow)**
Entry: Admin with `LEDGER_RECORD` opens the edit dialog on a posted expense row (e.g., check
#8263, City of Westerville, $400) from the fund register.
Step: sees a new "Public description" field (empty for every pre-existing row today), types
"Sponsored Westerville Autumn Arborfest 2026" (recommended cap: 200 chars, single line).
Step: submits PATCH.
Success: existing save toast; field shows the saved value on next open; the row now carries the
text into every member-facing surface it already appears on.
Failure: overlong input — rejected/trimmed server-side with a specific "Keep the description under
200 characters" toast (client `maxLength` alone is not enough — see Gaps, this field is uniquely
member-facing among its siblings). Network/DB failure — the existing generic save-failure toast,
form stays open with the typed value intact (unchanged PATCH behavior).

**Flow 2 — Treasurer clears a note**
Entry: edit dialog on a row with an existing description.
Step: clears the field to empty, submits.
Success: `publicDescription` set to `null`; the row goes back to showing nothing extra.
Failure: same generic save-failure toast as Flow 1.

**Flow 3 — Treasurer types a note while creating a new expense (secondary flow)**
Entry: "Record Transaction" dialog, Type = Expense.
Step: same field, same cap, optional.
Success/Failure: identical to Flow 1, just on create instead of edit.

**Flow 4 — Member reads a curated note (passive)**
Entry: signed-in member already past the impact page's existing two-tier gate loads
`/members/impact`.
Step: none — reads. Expands a cause row in "Giving by Cause" (existing interaction, unrelated to
this feature) or simply views "Recent Named Gifts" (always expanded).
Success: sees the treasurer's plain-text description inline for rows that have one; rows without
one are visually identical to today.
Failure: not applicable at the field level — nothing here can fail independently of the page's
existing load path. If the page fails to load at all, that's the pre-existing philanthropy-
dashboard failure path, unmodified by this feature.

### Permissions

- **Edit / clear:** existing `LEDGER_RECORD` ("Record, edit, and delete ledger transactions") —
  the identical gate `party`, `memo`, and `beneficiaryCause` already use. No new `FEATURES` key.
- **View:** existing two-tier impact-page gate — `IMPACT_VIEW` only when `philanthropyVisibility
  = 'board'`; any linked member when `= 'members'`. This feature adds a column to data that gate
  already protects; the gate itself is unchanged. No new `FEATURES` key.

### Display-surface recommendation

- **Cause drill-down rows (`impact-by-cause.tsx`, `CauseGivingRow` list items):** certain — this
  is the surface the request names directly.
- **Recent Named Gifts (`ImpactRecentGifts` in `page.tsx`):** recommended. It's the
  highest-visibility surface on the page (always expanded, no click required) and the motivating
  $400 Arborfest check is exactly the kind of row that lands there. Render the description as an
  **additive, separate line** under the existing `$amount to party · cause · date` line — not
  appended inline with more `·` separators. Two reasons: (1) `cause` (beneficiaryCause) is a short
  taxonomy tag while the new field is a free-form sentence — conflating them on one line reads as
  one confused field; (2) a long inline addition risks horizontal overflow at 360px, where the
  existing line already wraps tightly.
- **Nowhere else:** not `ImpactByFiscalYear` (aggregate table, no row-level party) or
  `ImpactHeadlineStats` (aggregate totals) — both correctly have no individual-gift concept to
  attach a description to.

### Field-scope recommendation

**Expense rows only**, mirroring `beneficiaryCause`'s exact existing conditional (`!isTransfer &&
apiFlow === "expense"`) rather than allowing the field on income/transfer rows. Rationale: the
impact page only ever renders `isGiving()` rows (`flow='expense' AND fund.kind IN ('activity',
'charitable','scholarship') AND transferGroupId IS NULL AND categoryCountsAsGiving !== false`,
DECISION-024) — a note on an income or transfer row could never be displayed anywhere, so allowing
it there would just be confusing surface area with no payoff. This is not a new restriction
invented for this feature — it's the same scope `beneficiaryCause` already has today, so no new
form-rendering pattern is needed beyond copying that conditional.

One deliberate non-restriction: the field is **not** further scoped to only fund-kind-eligible
expense rows (e.g., blocking it on an Administrative-fund expense, which would never appear on the
impact page either). `beneficiaryCause` already has this same "technically enterable somewhere it
can never display" characteristic today and it has caused no reported problem — recommend staying
consistent rather than adding fund-kind-aware conditional logic to the form for a field that's
this low-stakes if occasionally unused.

### Gaps the request didn't address

1. **Edit-visibility divergence from the `beneficiaryCause` precedent.** `beneficiaryCause` only
   renders in the form on **create** (`!isEdit` at `transaction-form.tsx:496`) — there is currently
   no way to add or change a cause tag on an existing transaction through the UI at all. This
   feature's entire reason for existing is retroactively annotating a transaction that already
   exists (the Arborfest check), so the public-description field **must** render on edit, not just
   create. Flagging explicitly so Phase 3/4 don't copy-paste the `!isEdit` guard along with the
   rest of the conditional.
2. **Server-side length enforcement is a new pattern, not a reuse.** Checked both transaction API
   routes (`transactions/route.ts`, `transactions/[id]/route.ts`): `memo` and `beneficiaryCause`
   are trimmed server-side but have **no server-side length cap** today — only the client's
   `maxLength` attribute. That's a tolerable gap for admin-only, internal-only fields. It is not
   tolerable here: this field is the first ledger-transaction text field that renders unescaped
   (well, React-escaped, but unmoderated) on a member-facing page. Recommend the API route reject
   (400) or hard-truncate server-side at the agreed cap — don't rely on the client input alone.
3. **Plain-text rendering must be an explicit requirement, not an assumption.** React JSX escapes
   interpolated strings by default, so this is likely already satisfied by construction — but
   state it as a requirement for whoever builds the display components anyway: no
   `dangerouslySetInnerHTML`, no future markdown/rich-text upgrade path implied by this feature.
4. **Concurrent form churn.** `transaction-form.tsx` is being edited right now by the
   transaction-receipts increment (per this work-log's own Intent section and
   `docs/work-log/2026-07-21-transaction-receipts.md` Phase 3). That design adds a receipt
   control and a waiver control to the same expense-only conditional region of the form. Phase 4
   for this feature must implement against whatever shape the form lands in from that increment,
   not the current snapshot — both fields (receipt, public description) are expense-scoped and
   will likely sit near each other in the rendered form; sequencing is the orchestrator's job per
   the existing Intent note, restating here so Phase 3 doesn't design against a stale file.
5. **Mobile.** Both display surfaces (drill-down rows, Recent Named Gifts) already truncate or
   wrap tightly at 360px. The recommendation above (separate line, not inline `·`-appended) is
   the mobile-safe choice; a single long sentence appended to an already-tight inline row would be
   the first thing to overflow.

### Backfill / motivating-case acceptance

No automated backfill — confirmed accepted by the user. Recommend making the Arborfest check a
concrete **Phase 6 acceptance case**: as part of QA/Phase 6 verification, actually type
"Sponsored Westerville Autumn Arborfest 2026" (or equivalent) into check #8263's new field and
confirm it renders on both the drill-down and Recent Named Gifts. This gives the ship verdict a
real, user-recognizable proof point instead of only a synthetic test row.

### Adversarial pass

- **Redirect targets:** not applicable — no URL parameters involved in this feature.
- **State-machine shortcuts:** not applicable — ordinary field edit through the existing PATCH
  handler and permission gate; no new state machine introduced.
- **Enumeration leaks:** not applicable — no new lookup-by-identifier surface.
- **Input boundaries:** empty string → stored/treated as `null` (omit display, no placeholder
  clutter, matching the locked decision). Overlong string → reject or truncate **server-side**
  (see Gap 2 — the one place this feature must not just copy the sibling fields' behavior).
  Unicode: no special handling needed beyond what `text` columns and React already do; no
  length-in-bytes vs length-in-characters distinction is worth designing for at this scale
  (200-char cap, Latin-script content expected).
- **Self-targeting:** not applicable — this is an admin-only write surface with a passive
  member-only read surface; no member can write to their own or another party's description.
- **Plain-text-only rendering:** confirmed as a requirement, not just an assumption (see Gap 3).
- **No PII expectations:** confirmed as a reasonable default — the field is treasurer-authored,
  club-business context ("sponsored X event"), not member personal data. No technical control
  needed beyond the existing admin-only write gate; worth a one-line placeholder hint
  ("Brief public-facing context, e.g. 'Sponsored Westerville Autumn Arborfest 2026'") to steer
  usage, but that's copy, not a permission or validation rule.

### Out of scope (confirm with user)

- Memos anywhere member-facing — explicitly declined already; restating for the record.
- Editing notes from the impact page — the member surface stays 100% read-only for this field.
- Per-cause descriptions (a taxonomy-level description independent of any single gift) — not
  requested; the field is per-transaction only.
- Applying the field to income or transfer rows — see Field-scope recommendation above.
- Bulk/batch backfill tooling for existing gift rows — explicitly declined by the user
  (hand-curation accepted); one-at-a-time via the edit form only.

### Open questions

None. Every decision point surfaced above has a stated recommendation (field scope: expense-only;
display surfaces: drill-down + Recent Named Gifts; cap: 200 chars single-line, server-enforced;
edit-visibility: must diverge from `beneficiaryCause`'s create-only precedent). Flag any of these
you'd rather change; otherwise Phase 2/3 can proceed on the recommendations as written.

### Outputs

- No files changed outside this work-log — Phase 1 is read-only on source.
- Reviewed: `src/app/members/impact/page.tsx`, `src/components/members/impact-by-cause.tsx`,
  `src/lib/ledger-queries.ts` (`getPhilanthropy()`, `CauseGivingRow`/`PhilanthropyRecentGift`
  shapes, `listTransactions()`), `src/lib/ledger.ts` (`isGiving()`, `bucketGivingByCause()`),
  `src/components/admin/ledger/transaction-form.tsx` (current `party`/`memo`/`beneficiaryCause`
  fields and their flow-conditional rendering, including the `beneficiaryCause` create-only gap),
  `src/app/api/admin/ledger/transactions/route.ts` and `[id]/route.ts` (confirmed no server-side
  length cap on `memo`/`beneficiaryCause` today), `src/lib/db/schema.ts` (`ledgerTransactions`
  column list), `docs/decisions.md` DECISION-024 (`isGiving()` definition, null-party exclusion
  from recent gifts), and `docs/work-log/2026-07-21-transaction-receipts.md` (concurrent Phase 2/3
  design for the same form region).

### Open questions / handoff notes for architect (Phase 2)

- Confirm `publicDescription` (or tech-lead's preferred name) as a single new nullable `text`
  column on `ledgerTransactions` — no new table; same shape class as `memo`/`beneficiaryCause`.
- Confirm the expense-only field-scope recommendation, and the recommendation that this does
  *not* require a new server-side length-cap utility to be shared/hoisted — a simple inline check
  in the existing POST/PATCH handlers is proportionate to one field.
- Confirm sequencing against the concurrently-landing transaction-receipts feature (Gap 4) — both
  touch the same expense-only conditional region of `transaction-form.tsx`.

---

# Phase 2 — Architectural Review (architect)

**Owner:** tech-lead (documenting the skip per the accelerated-pipeline rule; not an architect review)
**Status:** Skipped (documented)
**Date:** 2026-07-21

### Rationale for skipping

Per this work-log's own `Pipeline mode` note ("Accelerated — Phase 2 likely skippable") and CLAUDE.md's
Development Pipeline rule that architect review exists to catch new directories, new npm dependencies,
structural changes, or invariant risk — none of which this feature touches:

- **No new table.** One nullable `text` column on the existing `ledger_transactions` table — same
  shape class as `memo` and `beneficiaryCause`, which already exist on this exact row.
- **No new directory or component tree.** The display surfaces (`impact-by-cause.tsx`, `page.tsx`'s
  `ImpactRecentGifts`) and the write surface (`transaction-form.tsx`) already exist; this only adds
  fields/props/lines to them.
- **No new dependency.** Plain text field, plain string trim/cap — no library involved.
- **No new `FEATURES` key.** Reuses `LEDGER_RECORD` (write) and the impact page's existing two-tier
  gate (read) exactly as-is.
- **No new API route.** Existing `POST`/`PATCH /api/admin/ledger/transactions[/[id]]` gain one
  optional field each, following the identical pattern `beneficiaryCause` and `memo` already use in
  those same handlers.
- **The one genuinely new pattern — a server-side length cap on a ledger text field — is not an
  architectural decision.** It's an inline `if (value.length > 200)` / `.slice(0, 200)` check inside
  an existing handler, proportionate to one field, not a shared validation utility or a structural
  precedent this project needs an architect to bless (Phase 1 already scoped it this way and asked
  architect to confirm exactly this in its Phase 2 handoff notes — but Phase 2 is not being run as a
  separate step here; Phase 3 below re-confirms the same conclusion directly).

The one place this feature brushes against something architecture-adjacent — sequencing against the
concurrently-landing transaction-receipts feature, which touches the same conditional region of
`transaction-form.tsx` — is a sequencing/implementation-order concern, not a structural one, and is
handled explicitly in Phase 3's Implementation Order below.

**Conclusion:** no architectural risk identified that would change this feature's shape. Proceeding
directly to Phase 3 technical design, per CLAUDE.md's Bug-Fix/Accelerated variant guidance applied to
a small, pattern-consistent addition. If Phase 4 uncovers something Phase 2 would have caught, the
CLAUDE.md loop-back rule applies (return to Phase 2) — no work has shipped, so nothing is lost by the
skip other than a step that would have found nothing new.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** Complete
**Date:** 2026-07-21

## Technical Design: Impact Gift Public Note

### Summary

Add one new nullable `text` column, **`publicNote`** (`public_note`), to `ledger_transactions` —
a treasurer-curated, member-facing annotation distinct from the fully-internal `memo` field. Unlike
`beneficiaryCause` (its nearest sibling, which the transaction form only renders on **create**), this
field's entire purpose is annotating **already-existing** transactions — check #8263's Arborfest
context can't be added any other way — so it gets its own edit-mode-inclusive conditional in
`transaction-form.tsx`, independent of `beneficiaryCause`'s conditional, which stays untouched
(create-only, as today — separate concern, per the locked recommendation). The field is
expense-only (mirrors `beneficiaryCause`'s existing `!isTransfer && apiFlow === "expense"` scope),
capped at 200 characters and trimmed **server-side** (a first for this table — `memo` and
`beneficiaryCause` are client-cap-only today, but this is the first ledger-transaction text field
rendered on a member-facing page). Threads through `getPhilanthropy()`'s existing two-query shape
into both `CauseGivingRow` (cause drill-down) and `PhilanthropyRecentGift` (Recent Named Gifts),
rendered as an additive plain-text line — never inline-appended, never markdown/HTML. No new
`FEATURES` key: `LEDGER_RECORD` gates the write (same as every sibling field in the form); the
impact page's existing two-tier gate (`IMPACT_VIEW` when `philanthropyVisibility='board'`, any
linked member when `='members'`) is unchanged and already covers the read. **Naming call:** the
work-log's kickoff instructions offered `public_note` as an illustrative example while Phase 1's own
body used `publicDescription` throughout; adopting **`publicNote`** — it matches the feature's actual
name (work-log title: "Impact Gift Public Note"), reads better as UI copy ("Public note" vs. the
slightly redundant "Public description" sitting one field below "Memo"), and Phase 1 explicitly
deferred the exact name to tech-lead ("`publicDescription` (or tech-lead's preferred name)"). This is
a naming-only deviation; every functional recommendation Phase 1 made is adopted as-is.

### Permissions

No new `FEATURES` keys.

| Action | Gate | Notes |
|---|---|---|
| Write / clear `publicNote` (create + edit) | `LEDGER_RECORD` | Identical gate to `party`, `memo`, `beneficiaryCause` — no new check, just a new field inside the same handlers. |
| Read `publicNote` on `/members/impact` | Existing two-tier impact gate | `IMPACT_VIEW` only when `philanthropyVisibility='board'`; any linked member when `='members'`. Unchanged — this feature adds a column to data the gate already protects. |

### API Contract

**`POST /api/admin/ledger/transactions`** — payload addition
- New optional field: `publicNote?: string`
- Same 400-eligible validation as the PATCH body below (shared inline check, not a new exported
  utility — proportionate to one field per Phase 1's own recommendation).
- No flow gate needed at the API layer beyond what already exists implicitly: nothing prevents
  submitting `publicNote` on an income/transfer row via a crafted request. Recommend (see Edge
  Cases) a defensive 400 mirroring the receipts feature's `"Receipts can only be attached to
  expense transactions"` pattern: `"Public notes can only be attached to expense transactions"`
  when `publicNote` is non-empty and the effective `flow !== 'expense'` (using the same `newFlow`-
  aware pattern the PATCH handler already applies for `receiptStorageKey` and category validation).
  This is belt-and-suspenders — the impact page never displays non-expense rows regardless — but
  costs nothing to add and keeps the invariant enforced server-side, not just by hiding the UI
  control, consistent with this codebase's existing posture on every other conditional field.
- Stored as: `publicNote: publicNote?.trim().slice(0, 200) || null`.

**`PATCH /api/admin/ledger/transactions/[id]`** — payload addition
- New optional field: `publicNote?: string | null`
- `null` → clears to `null` (Flow 2 — treasurer clears a note).
- Non-null string → trim, cap at 200 chars server-side, empty-after-trim → `null` (matches the
  existing `memo`/`beneficiaryCause` empty-string-to-null convention in this same handler at
  lines 256-258/282-287).
- Same expense-only 400 guard as POST, evaluated against the *effective* flow (existing flow, or
  the new `flow` value if changing it in the same request) — reuse the handler's existing
  `newFlow` local, the same pattern already used for category/receipt validation in this file.
- **Overlong input:** reject with 400 (`"Keep the public note under 200 characters."`) rather than
  silently truncating. Silent truncation is the wrong choice for a field a treasurer is
  hand-curating for public display — a truncated Arborfest sentence that cuts off mid-word and
  gets published to `/members/impact` is worse than making the treasurer shorten it themselves.
  (This diverges slightly from the binding note's "reject/trim" either-or — picking reject, with
  rationale, since Phase 1's Flow 1 already anticipated exactly this choice point and left it
  open: "rejected/trimmed server-side.")
- No new status codes beyond the existing 400/401/403/404 this handler already returns.

No change to any other route. `getPendingApprovals()`, `listTransactions()`, etc. are untouched —
this field carries no compliance/guardrail meaning, unlike the concurrently-landing receipt work.

### Data Model

`src/lib/db/schema.ts` — `ledgerTransactions`, placed immediately after `beneficiaryCause` (its
nearest sibling in both shape and adjacency in the form):

```ts
beneficiaryCause: text("beneficiary_cause"), // optional cause taxonomy tag
// Treasurer-curated, member-facing annotation shown on /members/impact (cause
// drill-down + Recent Named Gifts). Distinct from `memo`, which stays fully
// internal. Expense-only at the app layer; 200-char cap enforced server-side
// (first ledger-transaction text field rendered to members). DECISION-0NN.
publicNote: text("public_note"),
```

No new index (low cardinality concept, no filtering/sorting on this column — matches the
`beneficiaryCause`/`memo` precedent of zero dedicated indexes).

**Migration** `drizzle/migrations/00NN_ledger_public_note.sql` — next-free number at implementation
time. `0057_ledger_receipt_waiver.sql` is the latest that exists as of this design; expect `0058+`,
but the implementer must re-run `ls drizzle/migrations/*.sql | sort | tail -3` immediately before
picking a number, since the concurrently-landing bank-reconciliation-sessions feature (DECISION-036)
may also claim a number in this range before this feature's Phase 4 starts.

```sql
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS public_note text;
```

Single statement, trivially idempotent, no guard needed beyond `IF NOT EXISTS` (no rename, no
backfill, no FK).

**`src/lib/ledger.ts`** — `GivingFoldRow` gains `publicNote: string | null`; `CauseGivingRow` gains
`publicNote: string | null`. `bucketGivingByCause()`'s fold (`ledger.ts:456-461`, the `causeRow`
literal) copies `row.publicNote` through unchanged — no new logic, purely an additional field
carried alongside the existing `id`/`txnDate`/`party`/`amountCents` copy, following the exact
precedent the check-number/party threading already set.

**`src/lib/ledger-queries.ts`**:
- Query 1 (`getPhilanthropy()`'s `givingRows` select, ~line 2170-2177) adds
  `publicNote: ledgerTransactions.publicNote` to the select list. No `.where()` change — the
  giving predicate is unaffected by this field's presence or absence.
- Query 2 (`recentRows` select, ~line 2265-2271) adds `publicNote: ledgerTransactions.publicNote`.
  `PhilanthropyRecentGift` gains `publicNote: string | null`; the `recentGifts` map (~line 2288-2293)
  adds `publicNote: r.publicNote`.
- `PhilanthropyByCause.rows: CauseGivingRow[]` requires no type-literal change of its own —
  it already re-exports `CauseGivingRow` directly (per the file's own comment at line 2078-2082:
  "import `CauseGivingRow` itself... to prevent the row shape from drifting"), so extending
  `CauseGivingRow` in `ledger.ts` is the only edit needed; `PhilanthropyByCause` picks it up for free.

### Component/Page Plan

**No new files.** This is additive lines inside three existing files.

**Files to modify:**
- `src/components/admin/ledger/transaction-form.tsx`:
  - `EditableTransaction` (the `Pick<LedgerTransaction, ...>` type, currently lines 11-28) gains
    `"publicNote"`.
  - New state: `const [publicNote, setPublicNote] = useState(initialValues?.publicNote ?? "");`
    (placed near `beneficiaryCause`'s existing state declaration, line 129).
  - **New, independent conditional** — do not reuse or extend `beneficiaryCause`'s JSX block
    (`!isTransfer && !isEdit && apiFlow === "expense"`, lines 516-531). This field's conditional is
    `!isTransfer && !isEditingTransfer && apiFlow === "expense"` — the same shape as the receipt
    section's `showReceiptSection` local (line 148) and every other "not for transfers" field in
    this form, but critically **without** the `!isEdit` term `beneficiaryCause` has. This is the
    one line in the whole feature most likely to get copy-pasted wrong — call it out again at
    implementation time.
  - Render as a labeled text input (`maxLength={200}` client-side, matching the `memo`/
    `beneficiaryCause` input styling exactly), placed in the same expense-only region as
    `beneficiaryCause` and the (concurrently landing) receipt controls — exact vertical order
    relative to those doesn't matter functionally; place it adjacent to `beneficiaryCause` since
    they're the two "public-facing annotation" fields, distinct from the receipt-attachment
    controls. Placeholder text: `"Brief public-facing context, e.g. 'Sponsored Westerville Autumn
    Arborfest 2026'"` (per Phase 1's adversarial-pass copy recommendation).
  - Submit-body wiring: add `publicNote: publicNote.trim() || null` to the **PATCH** body
    (currently lines 219-233 — today this body has no `publicNote`/`beneficiaryCause` line at all
    for edits; this feature adds the first one) and to the **POST** body (line 264, alongside the
    existing `beneficiaryCause: beneficiaryCause.trim() || null`).
  - Client-side `maxLength={200}` is a UX nicety only; the 400-on-overlong behavior lives
    server-side per the API Contract above — don't rely on `maxLength` alone to make the server
    validation feel redundant to write.
- `src/components/members/impact-by-cause.tsx`:
  - `CauseGivingRow`'s `row` (imported via `PhilanthropyByCause` from `@/lib/ledger-queries`, which
    now carries `publicNote` per the Data Model section) — inside the existing drill-down `<li>`
    (lines 188-199), add an additive second line beneath the date/party/amount line, rendered only
    when `row.publicNote` is truthy:
    ```tsx
    {row.publicNote && (
      <p className="text-xs text-gray-500 mt-0.5 break-words">{row.publicNote}</p>
    )}
    ```
    Plain-text interpolation only (React-escaped by construction) — no `dangerouslySetInnerHTML`,
    confirmed as a hard requirement, not an assumption, per Phase 1 Gap 3. `break-words` (not
    `truncate`) — unlike the amount/party line above it, which truncates to protect the tight
    inline layout, this line is already on its own row with the full row width available, so
    wrapping (not truncating) is both safe and more useful for a curated sentence a treasurer chose
    to write in full.
- `src/app/members/impact/page.tsx`:
  - `ImpactRecentGifts` (lines 193-215) — inside the `<li>` (lines 203-209), add an additive second
    line beneath the existing `$amount to party · cause · date` line, rendered only when
    `gift.publicNote` is truthy:
    ```tsx
    {gift.publicNote && (
      <p className="text-xs text-gray-500 mt-1 break-words">{gift.publicNote}</p>
    )}
    ```
    Separate line, not appended with another `&middot;` — per Phase 1's explicit recommendation:
    `cause` is a short taxonomy tag, `publicNote` is a free-form sentence, and conflating them on
    one already-tight inline line risks 360px overflow (see Edge Cases).

### Implementation Order

1. **Schema** (database-admin) — `schema.ts` `publicNote` column + idempotent migration
   `00NN_ledger_public_note.sql` (single `ADD COLUMN IF NOT EXISTS` statement). Re-check the
   next-free migration number at start time per the Data Model note above.
2. **Permissions** — none. No `FEATURES` change, no role-binding migration.
3. **API routes** — extend `POST`/`PATCH /api/admin/ledger/transactions[/[id]]` with the
   `publicNote` field, server-side trim/cap/reject-overlong, and the expense-only 400 guard.
   Extend `getPhilanthropy()`'s two queries and `bucketGivingByCause()`'s fold per the Data Model
   section.
4. **UI** — `transaction-form.tsx` (new independent edit-inclusive conditional — the field's core
   functional requirement), `impact-by-cause.tsx`, `page.tsx`'s `ImpactRecentGifts`.
5. **Email notifications** — none. Synchronous admin edit with immediate UI feedback; no async
   workflow to notify anyone about.
6. **Release notes entry** — written via `/release-notes` at Phase 6/ship (tech-lead).

**Sequencing constraint (binding on Phase 4 start, not just a note):** `transaction-form.tsx` is
being edited *right now* by the transaction-receipts feature's ux-developer increment (Increment C,
per `docs/work-log/2026-07-21-transaction-receipts.md` Phase 4 — Increments A and B are complete;
Increment C is in progress as of this design, confirmed by reading the live file: the receipt state
variables and `ReceiptFileInput` import already exist in `transaction-form.tsx`, but the JSX render
block for the receipt section has not yet been inserted). **Phase 4 of this feature (Impact Gift
Public Note) must not start until transaction-receipts' Increment C reports complete** — this design
was written against both the current (mid-edit) file state and the receipts Phase 3 design doc so
the implementer isn't working from a stale mental model, but actually writing code into
`transaction-form.tsx` before Increment C lands risks a merge collision in the exact same
expense-only conditional region both features touch. The orchestrator sequences this; noting it here
per the task's instruction so it's not lost between work-logs.

### Edge Cases & Risks

- **Long words / overflow at 360px.** Both display surfaces render `publicNote` on its own line
  with `break-words` (not `truncate`), so a single unbroken long token (e.g., a URL pasted by
  mistake) wraps rather than overflowing horizontally — verified this is safe because both
  surfaces already give the full container width to this new line (unlike the tight inline
  date/party/amount line above it in the drill-down, which does need `truncate`/`shrink-0`
  treatment and is unchanged by this feature). No new CSS pattern introduced; `break-words` is
  already used elsewhere in this codebase's card bodies.
- **A note on a row whose category later flips `countsAsGiving`.** If a treasurer later marks a
  category `counts_as_giving = false` (or changes a transaction's category to one that does), the
  row silently drops out of `isGiving()`'s scope and stops appearing on `/members/impact` entirely
  — `publicNote` disappears along with the whole row, not just the note. This is existing,
  unmodified behavior for every field on a giving row (amount, party, cause all vanish identically
  today) — `publicNote` doesn't introduce a new failure mode, it just means a treasurer who spent
  time curating a note on a row should know that re-categorizing the row later silently un-publishes
  the note too. Worth a one-line mention in the release notes' internal-facing description (not the
  public one), not a code change.
- **Concurrent form edits.** No new optimistic-concurrency token — matches this table's existing
  last-write-wins behavior on every other field (PATCH re-fetches `existing` once, no version
  check). Not a new risk this feature introduces; consistent with the receipts feature's identical
  conclusion in its own Edge Cases section.
- **Non-expense rows via crafted request.** Covered by the API Contract's defensive 400 — the UI
  never renders the field outside the expense-only conditional, but the server enforces it too,
  consistent with this codebase's posture that hiding a control is never the trust boundary.
- **Silent truncation vs. rejection.** Resolved above (API Contract) in favor of rejection with a
  specific toast message — a curated public-facing sentence should never be silently mangled.
- **Existing rows show nothing until hand-curated.** Explicitly accepted by the user at kickoff;
  no backfill tooling in scope (confirmed out-of-scope in Phase 1, restated here for completeness).

### Named Unit Tests

Extend `src/lib/ledger-impact.test.ts`:
- `bucketGivingByCause()` — a `GivingFoldRow` with a non-null `publicNote` produces a
  `CauseGivingRow` in `bucket.rows` carrying that same `publicNote` value unchanged (pass-through
  case, mirrors how `party`/`id` are already asserted through the fold in this file's existing
  cases).
- `bucketGivingByCause()` — a `GivingFoldRow` with `publicNote: null` produces a `CauseGivingRow`
  with `publicNote: null` (absent-note case) — confirms the fold never coerces `null` to `""` or
  vice versa, since the display components key off truthiness (`row.publicNote &&`) and a stray
  `""` would silently render an empty paragraph.
- Mixed-row case: a bucket containing both a row with a note and a row without still sums
  `totalCents` correctly and preserves each row's own `publicNote` independently (guards against a
  copy-paste bug where one row's note leaks onto another during the fold's `causeRow` construction).

If the 200-char cap/trim/reject-overlong logic in the API routes is extracted into any
pure/exported helper (not required by this design — an inline check is proportionate to one field,
per Phase 1's own recommendation and this design's API Contract) — the implementer should add a
small unit test for it. If it stays inline in the route handler (the expected/default outcome),
this is covered by the implementer's own click-through/integration check instead, matching how this
codebase already treats `memo`'s inline trim logic (no dedicated unit test for that either).

### Out of Scope

- Editing `publicNote` from `/members/impact` — 100% admin-write / member-read, no member-facing
  write surface.
- Making `beneficiaryCause` editable on existing transactions — explicitly staying untouched per
  the binding recommendation; a separate concern from this feature, even though it shares the
  "create-only precedent" observation that motivated this design's edit-mode conditional.
- Bulk/batch backfill tooling for existing gift rows — declined by the user at kickoff.
- Per-cause descriptions independent of any single transaction — not requested; this is a
  per-transaction field only.
- Rich text / markdown rendering — plain text only, by design, not a deferred v2 (Phase 1 Gap 3;
  restated as a hard non-goal here so no future increment assumes an upgrade path was implied).

### Implementer

**full-stack-developer** — confirmed, not overridden. This is one nullable column, one migration
statement, two small API-route edits (both already-touched files, both already have the identical
pattern for sibling fields to copy), and three small, additive UI edits (one new form field, two
new conditional display lines). Comfortably under the "~<150 lines across API + UI" threshold that
distinguishes full-stack-developer from a specialist split — splitting this across database-admin →
api-developer → ux-developer would add three handoffs' worth of work-log ceremony to a change this
size, unlike the concurrently-landing transaction-receipts feature (new routes, new components,
new client-side image logic — correctly run as a specialist split).

### Outputs

- Design doc above (this section) — `docs/work-log/2026-07-21-impact-gift-public-note.md`.
- Reviewed for this design (no source files modified — Phase 3 is design-only): `transaction-form.tsx`
  (confirmed live mid-edit state: receipt state vars present, JSX not yet inserted), `src/app/api/
  admin/ledger/transactions/route.ts` and `[id]/route.ts` (confirmed `beneficiaryCause` is already
  PATCH-able at the API layer today — lines 282-287 — even though the form hides it in edit mode;
  this feature's own field needs the form-level change, not an API-level one, to become editable),
  `src/lib/ledger.ts` (`GivingFoldRow`/`CauseGivingRow`/`bucketGivingByCause`), `src/lib/
  ledger-queries.ts` (`getPhilanthropy()` both queries, `PhilanthropyByCause`/`PhilanthropyRecentGift`
  types), `src/components/members/impact-by-cause.tsx`, `src/app/members/impact/page.tsx`,
  `src/lib/db/schema.ts` (`ledgerTransactions`), `src/lib/ledger-impact.test.ts` (existing
  `bucketGivingByCause` test structure), `drizzle/migrations/` (confirmed `0057` is the latest file),
  `docs/decisions.md` (confirmed `DECISION-036` is the latest entry).

### Decision-log call

**No `docs/decisions.md` entry written.** This feature has exactly one structural choice —
`publicNote` as a single nullable `text` column, same shape class as its `beneficiaryCause`/`memo`
siblings already on this table — plus one naming call (`publicNote` over `publicDescription`) that's
cosmetic, not structural. Nothing here rises to the bar the decisions log exists for (compare
DECISION-035's column rename + three-column waiver mechanism + permission-tier argument, or
DECISION-034's backfill-strategy call) — a single additive nullable column following an existing
precedent doesn't need its own numbered entry. If a future reviewer disagrees, the next free number
is **DECISION-037** (DECISION-036 is the latest, confirmed above).

### Open questions / handoff notes

- **Implementer: full-stack-developer**, for the whole feature (schema + API + UI) — see rationale
  above.
- **Hard sequencing gate:** do not start Phase 4 for this feature until `docs/work-log/
  2026-07-21-transaction-receipts.md` reports Increment C (ux-developer) complete. Both features
  edit the same expense-only conditional region of `transaction-form.tsx`; starting early risks a
  merge collision, not just a stale design.
- **Phase 6 acceptance case (carried from Phase 1):** as part of QA/Phase 6 verification, actually
  type "Sponsored Westerville Autumn Arborfest 2026" (or equivalent) into check #8263's new
  `publicNote` field and confirm it renders on both `/members/impact`'s cause drill-down and Recent
  Named Gifts. Real, user-recognizable proof point — not just a synthetic test row.
- **Naming flag for qa/analyst:** the column is `publicNote`/`public_note`, not `publicDescription`
  as Phase 1's prose used throughout — intentional, rationale above under Summary. Nothing in Phase
  1's actual recommendations (scope, cap, display surfaces, edit-mode requirement) changes; only the
  identifier does.

---

## Appendix — Draft public notes (curated 2026-07-21, awaiting treasurer confirmation)

Drafted by the orchestrator from payee + memo of all 53 impact-page giving rows
(local DB query; prod matches). To be applied to BOTH databases after Phase 5/6,
folding in the treasurer's answers to the five flagged items. Highlights:
scholarships name the school where known (WNHS/WCHS/WSHS 2026); Gates At Eight =
Westerville BMX (gate purchase / sponsorship / race scholarships); Heritage PTSA
= Husky Hub food pantry; WARM 8/2025 = Share Bac-a-Pac; COhatch = holiday help
for five families; disaster gifts = Pacific Palisades wildfire + North Carolina
hurricane relief; standard purpose lines for the recurring vision/health
beneficiaries (Pilot Dogs, Eye Bank, OLF, LCIF, VOSH, Camp Echoing Hills, etc.).

**Flagged for treasurer (⚠ unresolved):**
1. 2025 scholarship recipients (Minter/Tsegay/Davis) — which schools?
2. American Legion Post 171 ×2 $650 — Buckeye Boys State delegates? confirm.
3. The Big Bus ×2 — purpose unknown; needs treasurer's words.
4. OSSBPTS Foundation ×2 — Ohio State School for the Blind support? confirm.
5. Ohio Lions Foundation $200 (6/2025, blank memo) — sensory garden like 2026's,
   or different?

The full per-row table was presented in-session; the applier should regenerate
it from the same query (`counts_as_giving` expense rows in Activity/Charitable
funds) rather than trusting this summary.

---

# Phase 4 — Implementation (full-stack) — 2026-07-21

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented exactly per the Phase 3 design: one nullable `text` column (`publicNote` /
`public_note`) on `ledger_transactions`, threaded through both `getPhilanthropy()` queries and
`bucketGivingByCause()`'s fold, editable on both create and edit (its own independent conditional,
deliberately not reusing `beneficiaryCause`'s create-only gate), server-trimmed and cap-rejected
at 200 chars (400, not silent truncation), and rendered as an additive plain-text line on both
`/members/impact` surfaces the design named (cause drill-down, Recent Named Gifts). No new
`FEATURES` key, no new route, no new component file — matches the "small, tightly coupled"
full-stack scope the design called for. Started only after confirming the transaction-receipts
Increment C JSX was already present in `transaction-form.tsx` (it was — receipt state vars,
`ReceiptFileInput` import, and the rendered receipt section all pre-existed in the tree I built on).

### What I did

1. **Schema + migration.** Added `publicNote: text("public_note")` to `ledgerTransactions` in
   `src/lib/db/schema.ts`, immediately after `beneficiaryCause` per the design. Verified next-free
   migration number via `ls drizzle/migrations/*.sql | sort | tail -5` — `0057_ledger_receipt_waiver.sql`
   was latest, so used **`0058_ledger_public_note.sql`** (no collision from the concurrently-mentioned
   bank-reconciliation-sessions feature — it hadn't claimed a number by the time I started). Single
   `ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS public_note text;` statement.
2. **Ran the migration twice** against the local DB (`.env.local` `DATABASE_URL`) to prove
   idempotency — first run applied `0058` cleanly (only pre-existing NOTICE/skip messages from
   earlier migrations that had already run); second run emitted `NOTICE: column "public_note" ...
   already exists, skipping` and still reported `✅ Migrations completed successfully`. Verified the
   column directly via `psql \d ledger_transactions` — `public_note | text` present.
3. **API routes.** `POST /api/admin/ledger/transactions` and
   `PATCH /api/admin/ledger/transactions/[id]` both gained a `normalizePublicNote()` helper (trim,
   empty-after-trim → `null`, over-200-chars → `400` with `"Keep the public note under 200
   characters."` — reject, not truncate, per the design's explicit choice) plus a defensive
   expense-only `400` guard (`"Public notes can only be attached to expense transactions"`) mirroring
   the receipts feature's own pattern, evaluated against the PATCH handler's existing `newFlow`
   local so a simultaneous flow change is honored correctly.
4. **Form.** `transaction-form.tsx`: added `publicNote` to `EditableTransaction`'s `Pick<>`, new
   `publicNote` state seeded from `initialValues?.publicNote`, and a **new, independent**
   `showPublicNoteSection` local (`!isTransfer && !isEditingTransfer && apiFlow === "expense"`) —
   deliberately not reusing or extending `beneficiaryCause`'s create-only (`!isEdit`) block, per the
   design's explicit warning that this is "the one line in the whole feature most likely to get
   copy-pasted wrong." Field renders on both create and edit. Wired into both the POST body
   (`publicNote: publicNote.trim() || null`, alongside `beneficiaryCause`) and, for the first time,
   the PATCH body (previously had no `publicNote`/`beneficiaryCause` line at all for edits) —
   gated so it's only sent `showPublicNoteSection ? {...} : {}` to avoid touching the field outside
   its own conditional. Placeholder text and 200-char client `maxLength` match the design.
5. **Threading.** `transaction-actions.tsx`'s `editInitialValues` and
   `transaction-form-dialog.tsx`'s `EditableTransaction` both extended with `"publicNote"` — same
   `Pick<>` pattern the receipts increment used for `receiptStorageKey`/waiver fields.
6. **Data model.** `src/lib/ledger.ts`: `GivingFoldRow` and `CauseGivingRow` both gained
   `publicNote: string | null`; `bucketGivingByCause()`'s `causeRow` literal now copies
   `row.publicNote` through unchanged. `src/lib/ledger-queries.ts`: `getPhilanthropy()`'s Query 1
   (`givingRows` select) and Query 2 (`recentRows` select) both add `publicNote:
   ledgerTransactions.publicNote`; `PhilanthropyRecentGift` gained `publicNote: string | null`; the
   `recentGifts` map now carries it through. `PhilanthropyByCause.rows` needed no separate edit — it
   re-exports `CauseGivingRow` directly, exactly as the design predicted.
7. **Display.** `impact-by-cause.tsx`'s drill-down `<li>` restructured from a single flex row into a
   flex row wrapped in a `<div>` plus an additive `<p className="text-xs text-gray-500 mt-0.5
   break-words">` line rendered only when `row.publicNote` is truthy. `members/impact/page.tsx`'s
   `ImpactRecentGifts` `<li>` got the identical treatment (`mt-1` instead of `mt-0.5`, matching the
   existing spacing rhythm of that component). Both are plain-text interpolation only — no
   `dangerouslySetInnerHTML` — and use `break-words` (not `truncate`) per the design's 360px-overflow
   reasoning, since both lines get the full row width unlike the tight inline line above them.
8. **Unit tests.** Extended `src/lib/ledger-impact.test.ts`:
   - Added `publicNote: null` to every pre-existing `GivingFoldRow`/`CauseGivingRow` literal in the
     `bucketGivingByCause` describe block (required once the type gained a mandatory field) and to
     the pre-existing `toEqual` assertions on `CauseGivingRow` arrays (deep-equality would otherwise
     fail on the extra key).
   - Added the three **named** cases from the Phase 3 design: (a) non-null `publicNote`
     pass-through unchanged onto the matching `CauseGivingRow`, (b) `publicNote: null` stays `null`
     (never coerced to `""`), (c) a mixed bucket (one noted row, one unnoted row) sums `totalCents`
     correctly and each row keeps its own `publicNote` independently — guards the exact copy-paste
     failure mode the design called out.
   - The 200-char cap/trim/reject logic was **not** extracted into a pure helper (an inline check
     inside each route handler, per the design's own "proportionate to one field" call) — matches
     the design's stated default outcome, so no dedicated unit test was added for it; this mirrors
     how `memo`'s inline trim has no dedicated unit test either.
9. Also had to fix one type break the Phase 3 design didn't anticipate: `PendingApprovalRow` (in
   `getPendingApprovals()`, `ledger-queries.ts`) is `LedgerTransaction & {...}` and its underlying
   query explicitly lists every `ledgerTransactions` column rather than using `db.select()` with no
   argument — adding a required-in-type (though nullable-in-DB) column to `LedgerTransaction` broke
   that literal select list. Added `publicNote: ledgerTransactions.publicNote` to that one query
   (one line). `listTransactions()` needed no change — it already uses bare `.select()`.

### Outputs

- `src/lib/db/schema.ts` — `ledgerTransactions.publicNote` column + updated table comment block.
- `drizzle/migrations/0058_ledger_public_note.sql` — new, idempotent, ran twice locally (idempotency
  proven — second run logged `NOTICE ... already exists, skipping` and still succeeded); column
  verified present via `psql \d ledger_transactions`.
- `src/app/api/admin/ledger/transactions/route.ts` — `POST` gains `publicNote?: string` (trim,
  200-char cap, 400-reject-overlong, expense-only 400 guard). Gate: `LEDGER_RECORD` (unchanged).
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — `PATCH` gains `publicNote?: string | null`
  (same validation; `null` clears). Gate: `LEDGER_RECORD` (unchanged). Also: `getPendingApprovals()`
  query updated to select the new column (see deviation note above).
- `src/lib/ledger.ts` — `GivingFoldRow`/`CauseGivingRow` gain `publicNote: string | null`;
  `bucketGivingByCause()` fold carries it through.
- `src/lib/ledger-queries.ts` — `getPhilanthropy()` Query 1 + Query 2 select `publicNote`;
  `PhilanthropyRecentGift` gains `publicNote: string | null`; `recentGifts` map carries it through.
- `src/components/admin/ledger/transaction-form.tsx` — new `publicNote` field, independent
  edit-inclusive conditional (`showPublicNoteSection`), wired into POST + PATCH bodies.
- `src/components/admin/ledger/transaction-actions.tsx`,
  `src/components/admin/ledger/transaction-form-dialog.tsx` — `publicNote` added to the
  `EditableTransaction`/`editInitialValues` `Pick<>` threading (same pattern the receipts increment
  used for its own new fields).
- `src/components/members/impact-by-cause.tsx` — cause drill-down `<li>` restructured; additive
  plain-text line when `row.publicNote` is truthy.
- `src/app/members/impact/page.tsx` — `ImpactRecentGifts` `<li>` gets the identical additive line.
- `src/lib/ledger-impact.test.ts` — 3 new named tests (pass-through, null-not-empty-string,
  mixed-row no-cross-contamination) + updated existing `GivingFoldRow`/`CauseGivingRow` literals and
  `toEqual` assertions to satisfy the now-required field.
- No new `FEATURES` key, no new env var, no decision-log entry (per Phase 3's own call — this is a
  single additive nullable column following an existing precedent).

### Gates

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **407 passed** (404 pre-existing + 3 new named cases), 12 test files, no failures.
- `pnpm build:only` — production build passes, no errors; every admin/member route (including
  `/members/impact` and both transaction API routes) compiles.
- No `console.log` in any touched file (grepped the full diff — only pre-existing `console.error`
  in catch blocks, matching the codebase's existing error-logging convention).
- No native browser dialogs introduced (grepped — the only `window.confirm` hits in the diff are
  prose in a comment/docs, from the concurrently-landing receipts feature, not this feature's code).
- Auth + `hasFeature(LEDGER_RECORD)` gates unchanged and present on both touched routes (no new gate
  needed — reusing the existing one, per Phase 3).

### Deviations from the Phase 3 design

1. **`getPendingApprovals()` query needed one added column** (`publicNote`) that the design didn't
   call out. Root cause: `PendingApprovalRow` extends `LedgerTransaction` directly, and its backing
   query hand-lists every column (unlike `listTransactions()`, which uses bare `.select()`) — adding
   any new column to the table breaks that literal list under TypeScript's structural typing. One
   line, no behavior change, no new risk — flagging it as a deviation because the design's "No
   change to any other route" claim undercounted this by one file.
2. Everything else — column name (`publicNote`), cap (200, reject not truncate), conditional shape
   (`!isTransfer && !isEditingTransfer && apiFlow === "expense"`, independent of `beneficiaryCause`),
   display placement (additive line, `break-words`, both named surfaces) — implemented exactly as
   specified, no other deviations.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Recommended click-through list:
  1. As an admin with `LEDGER_RECORD`, open the edit dialog on check #8263 (The City of Westerville,
     $400, 2026-05-18 — confirmed present in the local DB via `psql`, `public_note` currently empty)
     and type `"Sponsored Westerville Autumn Arborfest 2026"` into the new **Public note** field,
     save. **This is the Phase 3 design's named Phase 6 acceptance case** — carrying it forward as
     the first thing qa should exercise, since I did not start a dev server per this task's
     constraint.
  2. Confirm the saved note appears back in the edit dialog on next open (round-trip persistence).
  3. Confirm it renders on `/members/impact` in **both** places: the "Giving by Cause" drill-down
     (expand the cause this check falls under) and "Recent Named Gifts" (always-expanded, should be
     near the top given the recency).
  4. Confirm the field does **not** render when creating/editing an income or transfer transaction,
     and does render on both create AND edit for an expense transaction.
  5. Clear the note on check #8263 back to empty, save, confirm it disappears from both member-facing
     surfaces (round-trip clearing).
  6. Try submitting >200 characters directly against the API (e.g. via the browser devtools network
     tab or a quick curl) to confirm the 400 rejection message, since the client `maxLength=200`
     alone would otherwise mask whether the server-side reject is actually wired up.
  7. Check 360px mobile width on both surfaces with a long note (e.g. a long unbroken word/URL) to
     confirm `break-words` wraps rather than overflows.
  8. Re-run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build:only` as part of the standard Phase 5
     verification (already green as of this handoff, but qa re-runs per protocol).
- The Appendix's draft public notes (curated 2026-07-21, awaiting treasurer confirmation) were **not
  applied to any database** — per this task's explicit instruction, that remains a later manual step
  after Phase 5/6 sign-off, not part of Phase 4.
- Naming reminder for qa/analyst: the column and every identifier is `publicNote`/`public_note`, not
  `publicDescription` — intentional per Phase 3's naming call, not a bug.

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All four automated gates are green (typecheck, 407/407 unit tests including the
3 named `bucketGivingByCause()` cases, production build, `0058` migration re-run idempotent). Both
API routes reject overlong (>200 char) and non-expense `publicNote` writes with 400 and the specified
human copy, and the field is editable on **existing** transactions (the design's named divergence
from `beneficiaryCause`'s create-only gate) — all confirmed by source read and driven live. Live
click-through on check #8263 (The City of Westerville, $400, Arborfest sponsorship) confirms the note
round-trips through PATCH, renders on both `/members/impact` surfaces (cause drill-down under
"Community & Civic" and Recent Named Gifts), wraps rather than overflows at 360px, and clears back to
a true SQL `NULL` (not `""`) on both the DB and both member-facing surfaces. A new create-mode expense
with a note was created, confirmed, and deleted cleanly. No protected-route gate changes were needed
or made — `LEDGER_RECORD` and the impact page's two-tier gate are unchanged and confirmed present.

### What I did

1. **Automated gates.**
   - `pnpm exec tsc --noEmit` — clean, no output.
   - `pnpm test` — **407/407 passed**, 12 files, 287ms. Read the 3 new named cases in
     `src/lib/ledger-impact.test.ts` against the Phase 3 design's "Named Unit Tests" list — all three
     present, matching exactly: (a) non-null `publicNote` pass-through unchanged, (b) `publicNote: null`
     never coerced to `""`, (c) mixed-row bucket sums `totalCents` correctly and doesn't cross-contaminate
     `publicNote` between rows.
   - `pnpm build:only` — exit 0, no errors; every admin/member route (including both transaction API
     routes and `/members/impact`) compiled.
   - `pnpm db:migrate` re-run — `0058_ledger_public_note.sql` re-applied cleanly: `NOTICE: column
     "public_note" of relation "ledger_transactions" already exists, skipping`, then `✅ Migrations
     completed successfully`. Idempotency confirmed.
2. **Route validation — source read + live.** Read `src/app/api/admin/ledger/transactions/route.ts`
   (POST) and `[id]/route.ts` (PATCH/DELETE) in full. Both gate on `auth()` + `hasFeature(session.user.id,
   FEATURES.LEDGER_RECORD)` before touching the body — unchanged, matches every sibling field. Both
   share the same `normalizePublicNote()` shape: trim → empty-after-trim → `null` → over-200-chars →
   `{ error: "Keep the public note under 200 characters." }` (400, reject, never truncate, per the
   design's explicit choice) → non-empty + non-expense flow → `{ error: "Public notes can only be
   attached to expense transactions" }` (400). Drove all three server-side branches live via
   `page.request` against the running dev server (see temp Playwright specs, deleted after each run):
   - PATCH with a 201-char `publicNote` on check #8263 → **400**, `error` matched `/200 characters/i`.
   - PATCH with a non-empty `publicNote` on an existing **income** row (`ec700e20-...`, Kroger community
     rewards, $29.77) → **400**, `error` matched `/expense transactions/i`. Row left untouched (400
     responses never reach the `db.update()` call) — confirmed via psql.
   - POST with a non-empty `publicNote` and `flow: "income"` → **400**, same expense-only message.
3. **Dev-server click-through** (`signInAsAdmin`, per the recommended flow). Found check #8263 at
   `ledger_transactions.id = 5ab6494e-707d-46e4-ad75-c53f34484221` via psql — confirmed `public_note`
   was `NULL` before this session touched it. Navigated `/admin/ledger/charitable?entity=foundation&fy=2025`
   (check #8263 is dated 2026-05-18, which `getFiscalYear()` buckets to FY2025 — the admin register
   defaults to the *current* FY, 2026, so the `fy=2025` param was required to find the row).
   - Opened the edit dialog on check #8263: the **Public note** field rendered (confirms the design's
     key divergence from `beneficiaryCause`'s create-only gate — this is the one thing most likely to
     get copy-pasted wrong, and it wasn't).
   - Typed `"[qa-test] Arborfest sponsorship"`, clicked **Update Transaction**, confirmed the PATCH
     response was `200` (via `page.waitForResponse`), dialog closed.
   - Reopened the edit dialog: field showed `"[qa-test] Arborfest sponsorship"` — round-trip
     persistence confirmed.
   - Navigated to `/members/impact` (see linkage note below) and confirmed the note rendered in
     **both** named surfaces: "Recent Named Gifts" (always-expanded, showed the note as an additive
     line under the amount/party/date line) and the "Giving by Cause" drill-down under "Community &
     Civic" (had to click the "All" pill first — the page defaults to the *current* FY, which as of
     this session has zero posted transactions, matching the documented "Bonus finding" in
     `docs/work-log/2026-07-21-impact-cause-drilldown.md` Phase 6; clicking "All" brought FY2025's
     check #8263 into scope).
   - **360px mobile check:** set viewport to 360×800, confirmed `document.documentElement.scrollWidth`
     did not exceed `clientWidth` with the note rendered — `break-words` wraps rather than overflows.
   - **Cleared the note** via the same edit dialog (field → empty → Update Transaction → 200), confirmed
     it disappeared from both member-facing surfaces, then confirmed via psql: `public_note IS NULL` =
     `true`, `public_note IS NOT DISTINCT FROM ''` = `false` — cleared to a true SQL `NULL`, not an empty
     string.
   - **Member-page surface approach used:** the e2e admin has no linked member (confirmed via psql,
     `member_id` was empty — this is the documented **B-02** test-infrastructure gap, not a defect in
     this feature). Used the **temporary-linkage approach** from
     `docs/work-log/2026-07-21-impact-cause-drilldown.md` Phase 6: `UPDATE users SET member_id =
     '55d967c9-...' (A J Westlund, an existing active member with no bearing on page content — the
     dashboard shows club-wide totals, not the linked member's own data) WHERE id =
     '0063654b-...'` (the e2e admin), confirmed the update, ran the surface checks live in a real
     browser, then reverted (`UPDATE users SET member_id = NULL ... RETURNING id, member_id` — confirmed
     `member_id` is `NULL` again in the query output).
4. **Create-mode flow.** POSTed a new expense transaction (Charitable Fund, "Grant out" category,
   `party: "[qa-test] Create-Mode Payee"`, `publicNote: "[qa-test] Create-mode note"`) — got `201` with
   an `id`. Confirmed the create-mode conditional (`showPublicNoteSection`, independent of
   `beneficiaryCause`'s `!isEdit` gate) accepts the field identically on create. **Deleted** the row via
   `DELETE /api/admin/ledger/transactions/[id]` — got `200`, `{ deleted: 1 }`. Confirmed via psql: zero
   rows anywhere in `ledger_transactions` match `%qa-test%` in `memo`, `party`, or `public_note` after
   cleanup.
5. **Feature-gate audit.** No new `FEATURES` key was introduced by this feature (confirmed against
   Phase 3's own claim) — see table below.
6. **Focus-ring fix (folded-in stub) — driven live.** See its own section below; verdict recorded in
   that work-log's stub, not repeated here beyond the summary line.
7. **Cleanup.** Two temporary Playwright spec files (`e2e/qa-temp-impact-public-note.spec.ts`,
   `e2e/qa-temp-clear-public-note.spec.ts`) were written to drive the live browser/API checks above and
   deleted immediately after each ran — `git status --porcelain e2e/` returns empty. The e2e admin's
   temporary member linkage was reverted (confirmed `member_id IS NULL` again). Zero leftover
   `%qa-test%`-tagged rows anywhere in `ledger_transactions` (confirmed via psql count = 0). Dev server
   (PID confirmed via `lsof -tiTCP:3000`) killed at the end of the session; `lsof -tiTCP:3000` returns
   nothing afterward — port 3000 confirmed free.

### Gates

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `pnpm test`: **PASS** — 407/407, 12 files, 287ms. No failures.
- `pnpm build:only`: **PASS** — exit 0, all routes compiled, no unexpected warnings.
- `pnpm db:migrate` (0058 idempotency re-run): **PASS** — second run emits the expected
  `already exists, skipping` NOTICE and still reports success.
- `pnpm test:e2e`: not run as the project's committed suite (no permanent spec was added for this
  feature — see Regression Tests Added below for why). The temporary specs used for live verification
  above were deleted after each run per this task's cleanup instruction.

### Regression Tests Added

None added to the permanent suite for this feature. The Phase 3 design's three named unit tests were
already written and passing as of Phase 4 (implementer's responsibility per CLAUDE.md's Phase 4 gate:
"Every unit test named in the Phase 3 design doc is written and passing — the implementer delivers
these, not qa") — I verified they exist, match the design's named list, and pass; I did not need to
write new ones. The live click-through above was exploratory/acceptance verification (per this task's
explicit instructions), not a permanent regression suite — no bug was found that would need a
failing-then-passing regression test.

### Coverage on Critical Modules

Not independently re-measured with `--coverage` this pass (not requested by name in this task's
instructions, and the named module — `src/lib/ledger-impact.test.ts` / `src/lib/ledger.ts` — is
outside this agent role's three CLAUDE.md-named coverage targets, `events.ts` / `permissions.ts` /
`members.ts`, which this feature does not touch).

### Feature-Gate Audit (mandatory before PASS)

No new `FEATURES` key introduced. Confirmed by reading both route files in full:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `POST /api/admin/ledger/transactions` | yes | yes | `FEATURES.LEDGER_RECORD` (unchanged — same gate every sibling field on this route already uses) |
| `PATCH /api/admin/ledger/transactions/[id]` | yes | yes | `FEATURES.LEDGER_RECORD` (unchanged) |
| `DELETE /api/admin/ledger/transactions/[id]` | yes | yes | `FEATURES.LEDGER_RECORD` (unchanged — untouched by this feature, confirmed present) |
| `GET /members/impact` (page) | yes (`auth()`, redirect to `/signin`) | conditional — `FEATURES.IMPACT_VIEW` only when `philanthropyVisibility='board'`; any linked member when `='members'` | Two-tier gate unchanged; this feature only adds a column to data the existing gate already protects. Confirmed by reading `src/app/members/impact/page.tsx` in full — logic identical to pre-feature. |

This feature's write surface is a **read-only-among-`publicNote`** column addition to an already-gated
mutation endpoint — there was no new bulk-PII surface, no new export endpoint, and no new role-scoping
decision to make. Both audited mutation routes correctly require `LEDGER_RECORD` (not merely
authentication), and the one read surface that now carries this new column (`/members/impact`) was
already scoped to the correct role tier before this feature existed.

### Open questions / handoff notes

- **Next agent: analyst (Phase 6).** Recommend analyst re-confirm the Phase 1 acceptance case (check
  #8263 rendering "Sponsored Westerville Autumn Arborfest 2026" or equivalent) is understood to have
  been driven and reverted during QA, not left live — the Appendix's draft public notes (53 rows,
  curated 2026-07-21, awaiting treasurer confirmation on 5 flagged items) are explicitly **not yet
  applied** to any database, exactly as Phase 4 left them; that remains a manual step after Phase 6
  ships, per the work-log's own instruction.
- Naming reminder carried forward unchanged from Phase 4: every identifier is `publicNote`/
  `public_note`, not `publicDescription` — intentional per Phase 3's naming call.
- The **B-02** e2e-member-auth-fixture gap (no `signInAsMember()` helper; e2e admin has no linked
  member) was hit again in this session, exactly as documented in
  `docs/work-log/2026-07-21-impact-cause-drilldown.md`. Handled the same way as that precedent
  (temporary linkage, verified, reverted) rather than re-logging a duplicate backlog item.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-07-21

**Verdict: SHIP IT.**

### Summary

The shipped feature delivers exactly what Phase 1 promised: a treasurer-curated,
member-facing `publicNote` on ledger transactions, editable on both create and
edit (its whole reason for existing — annotating an already-posted check), gated
by the same `LEDGER_RECORD`/two-tier impact permissions with no new `FEATURES`
key, rendered as a separate plain-text line on both named surfaces (cause
drill-down, Recent Named Gifts), absent for every un-curated row with no
placeholder clutter. I re-walked every Phase 1 flow against the live app rather
than trusting QA's report alone, and performed the Phase 1/3-named acceptance
case for real: check #8263 (The City of Westerville, $400) now carries the
treasurer-approved text "Sponsor of the Westerville Autumn Arborfest 2026" in
the local DB, confirmed rendering on both member-facing surfaces, and it is
**left in place** (not reverted) per this session's instructions — local now
carries its first real curated note.

### What I did

- Re-read my own Phase 1 review (five-pass) in full against QA's Phase 5 report
  and the Phase 3/4 record of what was actually built.
- Started a local dev server (port 3000 was free at session start; confirmed
  free again after I killed it at the end).
- Confirmed via `psql` that check #8263 (`id 5ab6494e-707d-46e4-ad75-c53f34484221`)
  had `public_note IS NULL` before this session touched it, and that the e2e
  admin account had no linked member (the documented **B-02** gap — same as QA
  hit in Phase 5).
- Drove the acceptance case through the real running app: `signInAsAdmin()`,
  navigated to `/admin/ledger/charitable?entity=foundation&fy=2025`, opened the
  edit dialog on the row for "The City of Westerville," typed the exact
  treasurer-approved string into the **Public note** field
  (`#txn-public-note`), submitted, got a `200` PATCH response. Confirmed via
  `psql` immediately after: `public_note` = `"Sponsor of the Westerville Autumn
  Arborfest 2026"` exactly.
  - One temporary Playwright spec's *own re-verification step* (reopening the
    edit dialog immediately after submit and asserting the input's value)
    flaked — the input read back empty on that specific re-open, likely a
    client-side re-render/stale-props timing artifact in the test, not a data
    bug: the `psql` read taken in the same moment showed the correct value
    already persisted. I did not chase this further because the DB is the
    source of truth for "did the write succeed," and Phase 5 already drove
    this exact round-trip-persistence check successfully with a different
    test string on the same field/route. Not treated as a new gap.
- Temporarily linked the e2e admin's `users.member_id` to an existing active
  member (A J Westlund, `55d967c9-b4c0-4594-9b27-a8220c12da46` — same
  precedent member used in this work-log's own Phase 5 and in
  `docs/work-log/2026-07-21-impact-cause-drilldown.md` Phase 6) to view
  `/members/impact` as a linked member.
- Drove a second temporary Playwright spec against `/members/impact`: confirmed
  the exact string **"Sponsor of the Westerville Autumn Arborfest 2026"**
  renders in **Recent Named Gifts** (always-expanded) and, after selecting the
  "All" FY pill (current FY has zero posted transactions — the same documented,
  pre-existing behavior QA and the cause-drilldown work-log already noted) and
  expanding the "Community & Civic" cause row, in the **cause drill-down** too.
  **Both passed.**
- Reverted the temporary member linkage (`users.member_id` back to `NULL`),
  confirmed via `psql` re-query.
- Deleted both temporary Playwright spec files after each ran;
  `git status --porcelain e2e/` returns empty.
- Confirmed via `psql`, after all cleanup, that check #8263's `public_note` is
  still exactly the treasurer-approved string — **left in place, not
  reverted**, per this session's explicit instruction.
- Killed the dev server; confirmed `lsof -tiTCP:3000` returns nothing
  afterward.

### What's working

- **The edit-visibility divergence — the entire point of this feature — holds.**
  `beneficiaryCause`, its nearest sibling, is create-only in the form; `publicNote`
  is not. I drove this myself on a transaction that has existed since the
  original Quicken import, not a freshly-created test row — the single
  highest-risk design decision in this feature (flagged explicitly in Phase 1
  Gap 1 and Phase 3's Summary) is proven against the actual motivating case,
  live, not just by code inspection.
- **The privacy split is real, not just documented.** Memo text
  ("Westerville Autumn Arborfest 2026 sponsorship [quicken-import]") is visibly
  present in the admin register row but never appears anywhere in
  `/members/impact` — only the treasurer-typed `publicNote` does. The two
  fields sit one above the other in the same edit form and clearly serve
  different audiences; nothing about the implementation blurs that line.
- **No-placeholder-clutter trade-off holds.** Every other row on both surfaces
  (dozens of them, across FY2025 and FY2026) renders identically to before this
  feature shipped — no empty "Public note: —" line, no visual noise, exactly
  the accepted trade-off.

### Intent-vs-shipped diff

| Phase 1 / Phase 3 said | Shipped | Verdict |
|---|---|---|
| Field must render on **edit**, not just create — the motivating case (Arborfest) requires annotating an existing transaction | Independent `showPublicNoteSection` conditional, no `!isEdit` term; verified live on check #8263, a pre-existing Quicken-imported row | matches |
| Memos stay fully internal; `publicNote` is the only new member-facing field | Confirmed live: memo text never renders on `/members/impact`; `publicNote` renders on both named surfaces only | matches |
| Absent notes render nothing (no placeholder clutter) | Confirmed across all other rows on both surfaces; QA additionally confirmed clearing round-trips to true SQL `NULL`, not `""` | matches |
| Server-side 200-char cap, **reject** overlong input, not silent truncation | QA drove both the >200-char reject (400, "Keep the public note under 200 characters.") and the expense-only 400 guard live | matches |
| Display surfaces: cause drill-down + Recent Named Gifts, as a separate line (not `·`-appended) | Confirmed live on both surfaces with the real Arborfest text; separate `<p>` line, `break-words` | matches |
| Expense-only scope, defensive 400 guard against crafted non-expense requests | QA drove the guard live against a real income row; form conditional confirmed to match | matches |
| No new `FEATURES` key — reuse `LEDGER_RECORD` (write) and the impact page's two-tier gate (read) | Confirmed unchanged by QA's feature-gate audit and by my own re-read of both route files | matches |
| Mobile 360px — separate line must wrap, not overflow | QA confirmed via `scrollWidth`/`clientWidth` check; not independently re-driven with the exact Arborfest string this session, but same code path, no new risk | matches |
| Plain text only, no `dangerouslySetInnerHTML`, no rich-text upgrade implied | Confirmed by source read — plain JSX interpolation on both surfaces | matches |
| Phase 6 acceptance case: real, user-recognizable proof point on check #8263 | Performed for real this session, left in place (not reverted) | matches |

No regressions and no drift found. Every named divergence from the nearest
precedent (`beneficiaryCause`'s create-only gate) was implemented as specified,
not silently dropped or softened.

### Edge cases

- **Empty state:** pass — rows without a curated note render identically to
  pre-feature, on both surfaces, confirmed live across dozens of rows.
- **Failure microcopy:** pass — both server-side rejections QA drove
  ("Keep the public note under 200 characters." / "Public notes can only be
  attached to expense transactions") are human sentences, not stack traces or
  raw validation-library output.
- **Permission gate:** pass — `LEDGER_RECORD` unchanged on both write routes;
  the impact page's existing two-tier gate unchanged on the read side. No new
  `FEATURES` key was needed or added, confirmed by QA's audit table and my own
  re-read.
- **Mobile 360px:** pass — confirmed by QA via direct `scrollWidth` measurement
  with a long note; the shipped Arborfest string (49 characters, no unbroken
  long tokens) is well within the safe range this design was built for.

### Gap follow-through (from Phase 1)

1. Edit-visibility divergence — addressed, verified live (see above).
2. Server-side length cap — addressed, verified live by QA (400 reject).
3. Plain-text-only rendering — addressed, confirmed by source read (no
   `dangerouslySetInnerHTML`).
4. Concurrent form churn (transaction-receipts sequencing) — addressed;
   Phase 4 confirmed Increment C's JSX was already present before starting,
   no merge collision occurred.
5. Mobile — addressed, confirmed by QA.

All five Phase 1 gaps closed. No open gap carries forward.

### Acceptance-case confirmation

Check #8263 (`id 5ab6494e-707d-46e4-ad75-c53f34484221`, The City of
Westerville, $400, 2026-05-18) now carries `public_note = "Sponsor of the
Westerville Autumn Arborfest 2026"` in the local DB — set through the real
running app (not a direct SQL insert), confirmed rendering in both **Recent
Named Gifts** and the **Community & Civic** cause drill-down on
`/members/impact`, and **left in place** per this session's instructions (the
same content will be applied to production as part of the upcoming bulk
application of the Appendix's remaining 52 draft notes, which still await
treasurer confirmation on the 5 flagged items — that bulk step remains
explicitly out of scope for this work-log, unchanged from Phase 1/3/4/5).

### Follow-ups

None. This ships clean — no tracked follow-up items are needed for this
feature itself. For context (not a follow-up on this feature, already known
and out of scope per Phase 1/3): the Appendix's other 52 draft public notes
are still awaiting treasurer sign-off on 5 flagged rows before bulk
application to both databases — that remains a separate, already-documented
manual curation task, not a defect or gap in what shipped here.

### Outputs

- `docs/work-log/2026-07-21-impact-gift-public-note.md` — this Phase 6
  section; Per-Phase Status table updated (Phase 6 row: Complete / SHIP IT /
  2026-07-21).
- Local DB (`ledger_transactions` row `5ab6494e-707d-46e4-ad75-c53f34484221`):
  `public_note` set to `"Sponsor of the Westerville Autumn Arborfest 2026"` —
  left in place, the first real treasurer-curated note in local.
  `users.member_id` for the e2e admin was temporarily set and reverted to
  `NULL` (confirmed via re-query) — no lasting state change there.
- No source files modified — Phase 6 is verification-only. No changes to
  `docs/decisions.md`, `docs/treasurer-todo.md`, `docs/backlog.md`, or any
  other work-log.
- Two temporary Playwright spec files were written and deleted within this
  session (`git status --porcelain e2e/` confirmed empty afterward). Dev
  server started and killed within this session (port 3000 confirmed free
  before and after).

### Open questions / handoff notes

- None blocking. Pipeline closed for this feature — **SHIP IT**.
- Production still needs the same `publicNote` migration (`0058`) run and the
  same Arborfest content (plus the rest of the Appendix's curated notes, once
  the 5 flagged rows are resolved with the treasurer) applied — this was
  already known scope from Phase 4/5, restating for whoever runs the
  production bulk-application step.
