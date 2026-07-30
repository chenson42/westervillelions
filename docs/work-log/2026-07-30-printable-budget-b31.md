# B-31 — Printable Budget as a Board-Presentation / Mailed Review Document — Work Log

> **SUPERSEDED (2026-07-30):** This work-log's Phase 1-3 design (RESOLVED Locked
> Decisions, layout/pagination plan, `printFundSums` helper) shipped as part of
> `docs/work-log/2026-07-30-budgeting-overview-restructure.md` Phase 4 instead
> of being implemented standalone — that restructure's overview route needed
> the exact same board-document output, so its own Phase 3 design folded this
> one in wholesale (with `printFundSums` relocated/renamed to the shared
> `computeFundPlanSums` export per DECISION-060). This work-log's own Phase
> 4/5/6 are **not** run separately — see the restructure work-log for the
> actual implementation, verification, and shipped-vs-intent record.

> **Slug:** `2026-07-30-printable-budget-b31`
> **Surface:** (dashboard) admin — `/admin/ledger/budgeting`, `budget-print-worksheet.tsx` + `print-budget-button.tsx`, possibly a small addition to `getFundReport`'s consumer (no new query — see Data Source below)
> **Permission(s):** existing `budget.view` / `budget.edit` / `ledger.manage` / `ledger.approve` (any-of) covers this — no new key
> **Estimated complexity:** medium–large
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES + RESOLVED (Chris) | 2026-07-30 |
| 2 — Architectural review | architect (pre-checked by tech-lead) | Complete | Approved — no new dir/dep/structural change | 2026-07-30 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-30 |
| 4 — Implementation | ux-developer | Superseded | Folded into 2026-07-30-budgeting-overview-restructure.md Phase 4 | 2026-07-30 |
| 5 — Verification | qa | Superseded | See restructure work-log Phase 5 | — |
| 6 — Shipped vs intent | analyst | Superseded | See restructure work-log Phase 6 | — |

---

# Phase 1 — Functional Refinement (analyst)

## RESOLVED (Chris, 2026-07-30)

Chris reviewed the Open Questions below and locked the following decisions. Design (Phase 3) is built to these, not to the open options they replace.

1. **One clean board report** (resolves Open Question 1) — drop the blank hand-annotation "meeting worksheet" lines entirely. Produce a single tightened, presentable document; do not build a second "Meeting Worksheet" mode.
2. **Consolidated all-funds summary front page** (resolves Open Question 3) — a one-page overview (per fund: beginning balance July 1, income total, expense total, net surplus/(deficit), projected ending balance June 30) BEFORE the per-fund detail sections.
3. **Audience = board only** (resolves Open Question 5) — cause-line labels (recipient/individual names) render in full; no PII redaction needed. This is a board document, not a full-membership mailing.

**Defaults carried forward from the Phase 1 research without further discussion (not reopened):**
- Add the draft-vs-approved status stamp — thread the page's existing `approvalSummary` into the worksheet; show a clear "DRAFT" vs "APPROVED — adopted [date], minute [ref]" callout on the front page.
- Beginning balance source: `getFundReport(fund.id, targetFY).openingCents` (already fetched per fund — no new query). Projected Ending Balance = beginning + budgeted net (income − expense).
- Balances shown as reference, kept OUT of the budget math (NFF convention) — context blocks, not summed into income/expense.
- Totals must match the screen — reuse `computeFundLineSums` / `computeBudgetBalanceStatus`, the same functions the live budgeting page uses, so print and screen never diverge.
- Cause + line-item detail renders (B-31's core traceability requirement), with inline star/notes preserved at category and cause-line grain.
- Reconciliation footnote (resolves Open Question 2: build it) — `openingCents` sums posted, not only reconciled, transactions; add a footnote when the target FY's opening period isn't fully reconciled.
- Zero-budget funds: omit from print, as today (resolves Open Question 4: keep current silent-omit behavior, not Phase 1's "print a placeholder" suggestion).
- Prior-year actual vs. current-year budget comparison columns: keep/extend the existing prior-budget/prior-actual columns.

Open Question 6 (a roll-up "Notes & Discussion Items" list) was not picked up — inline notes only, per the Phase 1 recommendation to treat it as a nice-to-have, not a requirement.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Today's `BudgetPrintWorksheet` is a meeting-annotation scratch sheet (category grain, blank ruled lines, no totals, no balances); Chris needs it upgraded into a board-presentation document — fund-by-fund totals, a net surplus/(deficit), a July-1 beginning balance and projected ending balance, cause/line-item traceability, and visible approval status — that can stand on its own when mailed to people who weren't in the room.

## Research: how nonprofits present a board budget (cited)

1. **Income and expense grouped with subtotals, and an explicit net surplus/(deficit) line** — don't make board members do the subtraction in their heads. ("Make sure to include a formula subtracting expenses from revenue, which is a simple way to save board members from having to do the calculation in their heads." — [Nonprofit Finance Fund, Budgeting Best Practices](https://nff.org/insights/budgeting-best-practices/))
2. **Prior-year actual vs. current-year budget as comparison columns** for historical context — "review financial trends over multiple years to project how the current year is likely to close" ([Elliott Davis, Budget planning for nonprofits](https://www.elliottdavis.com/insights/budget-planning-for-nonprofits-approaches-for-the-next-fiscal-year); also [Aplos Budget-to-Actual guide](https://help.aplos.com/hc/en-us/articles/42995756975501-Budget-to-Actual-Report-Guide)). We already do this at category grain; the gap is doing it consistently once totals/balances are added.
3. **Beginning/ending cash balances are reference-only, shown separately from the budget math, not treated as a budget line item** — NFF is explicit: "against including beginning and ending cash balances in the main budget... should be reference-only if shown at all, as the budget should represent only the next 12 months of activity" ([NFF, Budgeting Best Practices](https://nff.org/insights/budgeting-best-practices/)). This directly shapes our answer to requirement #3: the July-1 balance belongs in a labeled reference block per fund, not folded into the income/expense subtotal arithmetic.
4. **Fund/functional separation, not a single blended budget.** GAAP/Form 990 convention groups expenses by program vs. management-and-general vs. fundraising ([GivingArc, Nonprofit Budget Format](https://givingarc.com/nonprofit-budget-format/)). Lions Clubs specifically split the book into **Administrative** (dues-funded, club operations) and **Activities** (public fundraising, returned to the community) accounts — "Monies are to be accounted for in two separate accounts: Administrative and Activities" ([Lions Club treasurer training materials, e-district.org](https://e-district.org/userfiles/1080/file/Training/Learn%20to%20Roar%202021/Lions%20Club%20-%20Treasurer%20Training%20-2021.pdf)). Our `ledger_funds.kind` (`administrative` / `activity` / `charitable` / `scholarship`) already mirrors this — the per-fund section break in today's worksheet is the right shape; it's the missing per-fund total/balance that undercuts it.
5. **Notes/assumptions to pre-empt board questions on variances** — "Notes & Assumptions: Document your reasoning and key assumptions to address board questions" ([NFF](https://nff.org/insights/budgeting-best-practices/); similar in [GivingArc](https://givingarc.com/nonprofit-budget-format/)'s "executive summary highlighting key variances"). The star/notes feature (DECISION-057) already gives us the raw material — the gap is making the notes *findable* on a multi-page mailed document, not just present inline.
6. **The budget is a formally approved board artifact, voted before the fiscal year starts** — "the annual budget should be formally reviewed and approved by a board vote" ([Giddings Consulting, Nonprofit Budget Template + Guide](https://giddingsconsulting.com/blog/nonprofit-budget-template-guide/)). A document mailed for review must be legible as to *which* state it's in — draft-for-discussion vs. board-approved-final — because it will be read by people with no other context.

I could not find a text-extractable official Lions Clubs International budget *template* (the club-treasurer PDFs I could reach were scanned images) — the Administrative/Activities split above is the one concrete, sourced Lions-specific convention; the rest comes from general nonprofit finance guidance, which is consistent with it.

## Current state vs. desired (gap summary)

`budget-print-worksheet.tsx` today, read end to end:
- Renders each fund as its own `<section>`, each with an Income `<table>` and an Expense `<table>` — **no page break between funds** (only `break-inside-avoid-page` at the category-row grain), so funds run together mid-page.
- Renders category rows with Prior Budget (FY-1) / Prior Actual (FY-1) / New Budget (FY) columns, cause/line-item breakdown, and star (★)/note rendering — this part is solid and already does cause-grain traceability for **categories that have been broken down**, per the Budgeting Page Restructure.
- Has **no Income Total, Expense Total, or Net Surplus/(Deficit) row** — a reader has to hand-add every visible number to know if a fund is in the black.
- Has **no beginning-of-FY balance and no ending/projected balance anywhere on the page.**
- Ends every category with 2 blank hand-annotation ruled lines — appropriate for the live meeting worksheet this was built for (Increment 1, "MUST-HAVE for the 2026-07-28 budget meeting"), out of place on a document meant to be mailed and read, not written on.
- Carries **no approval/lock status** — a DRAFT budget and a board-approved budget print identically. The page (`budgeting/page.tsx`) already computes `approvalSummary` (approver name, date, board-minute text, or unlock reason) for the on-screen `GuidedBudgetSetup`, but never passes it to `BudgetPrintWorksheet`.
- Funds with zero live budget lines are **silently omitted** (`FundWorksheet` returns `null`) — fine for "nothing to work on at the meeting," questionable for "does every configured fund show up in the mailed document."

## Recommended document layout

**Front matter (new, one page):** entity name, "Annual Operating Budget, FY{targetFY}" (retitled from "Budget Worksheet" — a worksheet reads as a draft; a document mailed for review should read as a finished budget, even in DRAFT state it should say so explicitly), prior-year reference line (kept), and an **approval-status line**: `"Approved {date} — Board Minute: {text}"` when `approval` is present and not unlocked, else `"DRAFT — Not Yet Approved by the Board"` in a visually distinct (bordered/bold) callout. Underneath, a **consolidated summary table**, one row per fund — Fund | Beginning Balance (7/1) | Budgeted Income | Budgeted Expense | Net Surplus/(Deficit) | Projected Ending Balance (6/30) — plus an "All Funds" total row for orientation. This does **not** net funds against each other in the detail pages (Administrative and Activity money stay legally/functionally separate per convention #4) — it's an at-a-glance index into the per-fund detail that follows, matching how board members skim a mailed packet before reading line by line.

**Per-fund section (page break before each fund):**
1. Fund name + fund kind label ("Administrative Fund", "Charitable Fund", etc.)
2. **Beginning Fund Balance, July 1, FY{targetFY}: $X** — its own labeled block, *not* a row inside the income/expense tables (research point #3).
3. Income table (existing category/cause/line grain, unchanged) + **Income Total** row.
4. Expense table (existing grain, unchanged) + **Expense Total** row.
5. **Net Surplus/(Deficit): $X** — Income Total − Expense Total, computed via `computeFundLineSums` fed this fund's `budgetCents` values server-side, so print and the live on-screen balance badge (`computeBudgetBalanceStatus`) can never disagree.
6. **Projected Ending Balance, June 30, FY{targetFY}: $X** = Beginning Balance + Net Surplus/(Deficit), explicitly labeled "projected" (it's plan, not actual).
7. Drop the 2 blank hand-annotation ruled lines per category (open question below — see "single vs. dual print mode").

Stars/notes: keep the existing inline rendering (note directly under its category/cause-line row) — it's already at the right grain per DECISION-057. I'm *not* recommending a separate "Notes & Discussion Items" roll-up unless Chris wants one; flagging it as an idea, not a requirement (see Open Questions).

## Data source for the July-1 balance — resolved

Use `getFundReport(fund.id, targetFY).openingCents`. This is **already computed and already fetched** — `budgeting/page.tsx` calls `getFundReport(f.id, targetFY)` for every fund today (`targetReports`), it's just not threaded into `FundSetupItem`/`PrintFund`. `openingCents` is documented as "Rolled forward: fund.openingBalanceCents seed + net of all POSTED transactions dated before the FY start" (`rolledForwardOpeningCents`, DECISION-029) — the exact same rolled-forward balance the Statement of Financial Condition's `getMonthlyStatement` treats as canonical for "beginning balance" (it uses the analogous `priorReport.endingCents` pattern). **No new query is required.** Projected ending balance is simple arithmetic on top (§ above), also computable server-side with no new query.

Caveat to flag on the document itself, not just in this write-up: `openingCents` sums **all posted transactions**, not only *reconciled* ones. The club treats posted-and-reconciled as equivalent to the true bank balance (this is exactly what `isMonthGatedForEntity` gates on for the member-facing Statement of Financial Condition — a month doesn't appear until every transaction through its last day is reconciled). If a treasurer prints the FY budget in early July before June is fully reconciled, the "July 1" figure on this document could still move by the time reconciliation closes. Recommend a lightweight version of the same guard: check whether the prior FY's June is fully reconciled (reuse/adapt the existing reconciliation-completeness query) and if not, print a footnote — "Beginning balance reflects posted transactions as of {date}; June reconciliation not yet complete" — rather than presenting a number that reads as final. This is a judgment call for Chris (see Open Questions) since it's new logic, not a reuse of an existing query the way the balance itself is.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (Treasurer / Budget Committee — `budget.edit`/`budget.view`/`ledger.manage`) | Clicks "Print / Save as PDF" on `/admin/ledger/budgeting` | Per budget cycle (meeting prep, then again after board approval) |
| Admin | Reads the printed/PDF document to hand-annotate live at the budget meeting | Once, at the meeting (existing use case, must not regress) |
| Admin (Treasurer/Secretary) | Mails or emails the printed/PDF document to board members / general membership for review | Once per budget cycle, likely twice (draft-for-discussion, then approved-final) |
| Board member / member (recipient, off-platform) | Reads the mailed document, understands totals/balances/notes without further explanation | Per copy received — this reader has **no access to the live app**, so the document must be self-contained |

The last row is the one the current worksheet doesn't serve: it was built for someone sitting at the meeting with the on-screen editor open a moment earlier. B-31's audience is someone who has never seen the screen.

## Flows

**Flow 1 — Treasurer prints for the live budget meeting (existing, must not regress):**
`/admin/ledger/budgeting` (gated: `budget.view`/`budget.edit`/`ledger.manage`/`ledger.approve`, any-of) → click "Print / Save as PDF" → browser print dialog opens over the static snapshot → treasurer prints or saves as PDF → outcome: a copy with hand-annotation space, used to mark up changes during discussion.
- Failure: `window.print()` has no app-visible failure mode (browser-native, effectively silent if blocked) — low-severity, noting for completeness, not asking for new error handling.

**Flow 2 — Treasurer/Secretary generates the document mailed to board/members for review (B-31's core ask):**
Same entry, same button (see single-vs-dual-mode open question) → outcome: a multi-page, per-fund document with totals, balances, cause/line-item detail, notes, and a visible draft/approved status → treasurer exports/prints it and distributes off-platform (mail or email attachment) to people who never open the app.
- Failure: no distinct failure path from Flow 1's print mechanics. The real "failure" this flow needs to guard against isn't a broken button, it's a **misleading document** — a DRAFT budget mailed without saying so, or a July-1 balance stated as certain when reconciliation isn't done. Both addressed above as gaps to close, not open failure UI to build.

**Flow 3 (edge) — A fund with no budget lines / no cause breakdown / a newly-configured fund:**
- No cause breakdown on a category: renders as it does today (no indented rows) — fine, no change needed.
- Zero live budget lines for a fund: today the fund is omitted entirely from the printout. For a document whose stated purpose is "fully traceable," a configured fund silently vanishing is a gap — recommend it still prints its section header + "No budget lines set for FY{targetFY}." + its beginning balance, rather than disappearing. A board member scanning the mailed packet for "did Scholarship even get budgeted this year" should get an answer, not silence.
- Zero or negative opening/projected balance: `formatBudgetReferenceCents` already renders negatives correctly (`-$X.XX`) — no gap, just confirming.

## Permissions

- **Permission(s):** existing `budget.view` OR `budget.edit` OR `ledger.manage` OR `ledger.approve` (any-of) — the same gate `/admin/ledger/budgeting` already enforces covers print, since printing consumes data already visible on that page. No new `FEATURES` key.
- **Default roles:** unchanged — Treasurer/Budget Committee (`BUDGET_EDIT`/`BUDGET_VIEW`), board members with `LEDGER_APPROVE`, `LEDGER_MANAGE` holders.
- Note: the *distribution* step (mailing/emailing the output) happens off-platform once the treasurer has the PDF — there is no in-app "send to board" action to gate, and none is being proposed here.

## Gaps the Request Didn't Address

- **Draft vs. approved status isn't on the printout at all.** Given this document is now explicitly a board/mail artifact, a reader must be able to tell "this is a discussion draft" from "the board approved this on X date." Fix: surface the `approvalSummary` the page already computes. (High priority — directly caused by promoting this from an internal worksheet to an external-facing document.)
- **No totals, no balances today** — this is the literal ask (#2/#3 of the request) and is addressed in the layout above.
- **No fund-level page break** — funds currently run together; for a multi-page mailed document this reads as unstructured. Addressed above (`break-before-page` per fund section, first fund excepted).
- **Empty funds vanish silently** — tension with the "fully traceable" requirement; addressed above.
- **The July-1 balance is a book balance, not guaranteed-reconciled** — flagged above with a proposed footnote; needs Chris's call on whether to build the reconciliation check now or defer.
- **Hand-annotation blank lines conflict with a "clean, mailed" document** — see Open Questions: single output serving both audiences, or two.
- **No mention of email in the request.** This is a print/PDF/off-platform-mail feature, not an in-app send — `sendEmail()`/the email queue isn't implicated unless Chris wants an in-app "email this PDF to the board" action, which is out of scope unless he says otherwise (see Out of Scope).
- **Mobile/360px:** not applicable — this is a `print:` media-query-only surface (`hidden print:block`), never rendered on a phone screen; the existing pattern is correct and this doesn't change that.
- **Brand consistency:** the printed page doesn't use `rounded-2xl`/`rounded-lg`/lions-blue on-screen brand classes today (correctly — it's print output, not a screen card), and shouldn't gain them. No ConfirmDialog need — nothing destructive happens here.

## Out of Scope (confirm with user)

- An in-app "email this budget PDF directly to board members" send action (would need the email queue, a recipient list, and a new permission conversation) — assuming Chris means printed/exported-then-mailed-by-hand-or-attachment, not an in-app blast.
- Building a *second*, distinct "consolidated all-funds" report page outside the print worksheet (e.g., a screen-viewable summary) — the consolidated summary table proposed above is print-only front matter, not a new admin page.
- Re-opening B-30's transaction↔budget-line link work — this document consumes whatever "Prior Actual" resolution B-30/T-25 eventually produce; no change to that here.
- A downloadable/attachable native PDF (via a PDF-generation library) — sticking with the existing "browser print → Save as PDF" pattern (`print-statement-button.tsx` precedent), not introducing a new dependency, per architect's existing ruling on this pattern.

## Open Questions

1. **Single print output or two modes?** The existing worksheet's blank hand-annotation lines exist for the live meeting; a clean mailed document arguably shouldn't have them. Do you want (a) one unified printout with the blank lines *removed* (meeting attendees annotate a separate copy or the screen), (b) one unified printout that *keeps* the blank lines even when mailed, or (c) two distinct outputs (a "Meeting Worksheet" mode and a "Board/Mail Report" mode, e.g. a second button or a query-param toggle)?
2. **Reconciliation caveat on the July-1 balance:** build the "not fully reconciled yet" footnote now, or treat it as an edge case that in practice never triggers (treasurer only prints after year-end close is done) and defer?
3. **Consolidated all-funds summary front page** — want it, or is per-fund detail-only sufficient? (Research favors it for skimmability; not explicitly requested.)
4. **Empty-fund handling** — print "No budget lines set" for a configured-but-empty fund, or keep omitting it as today?
5. **Who receives the mailed document** — full membership roster, or board only? This matters if any cause-line `label` text could ever contain identifying information (e.g., a named scholarship recipient) that's fine for board eyes but not for a full-membership mailing — worth a quick gut-check before this scales to "mailed to members."
6. **Roll-up "Notes & Discussion Items" list per fund**, gathering every starred/noted line's text in one place at the top or bottom of the fund's section (in addition to the existing inline notes) — worth it, or is inline-only sufficient given most funds likely have only a handful of starred lines?

---

# Phase 2 — Architectural Review (architect)

> Note authored by **tech-lead**, at the orchestrating agent's explicit direction, as a pre-check rather than a separate architect invocation — see the per-phase table. Recorded here so the decision has a paper trail; architect can review/override at any time.

## Verdict

**Approved.** None of architect's stated Phase 2 triggers apply:

- **No new directory or module.** Both touched files already exist: `src/components/admin/ledger/budget-print-worksheet.tsx` and `src/app/(dashboard)/admin/ledger/budgeting/page.tsx`. `print-budget-button.tsx` is not touched at all — the button already just calls `window.print()`, nothing about B-31 changes that mechanism.
- **No new npm dependency.** Confirmed with Chris's own Phase-1 "Out of Scope" ruling: sticking with the existing browser print → Save-as-PDF pattern, no PDF-generation library.
- **No new query.** Confirmed per Phase 1's "Data source for the July-1 balance — resolved": `getFundReport(fund.id, targetFY).openingCents` is already fetched by `budgeting/page.tsx` today (`targetReports`), just not threaded into the print props. The one genuinely new piece of server logic — the reconciliation-completeness footnote — reuses an **existing exported function**, `isMonthGatedForEntity(entityId, monthEnd)` from `src/lib/financial-report-queries.ts`, already used by the Statement of Financial Condition gating. No new query is authored; this is a new *call site* of an existing query.
- **No structural change.** Everything is additional props into an existing component tree (`page.tsx` → `BudgetPrintWorksheet`) plus new pure computation inside `budget-print-worksheet.tsx` reusing existing `@/lib/ledger` exports (`computeFundLineSums`, `formatBudgetReferenceCents`, `isCauseLineLive`, `sumBudgetCauseLines`). No new abstraction layer, no new shared primitive.

Net: **the page just needs to pass more props** (as Phase 1 anticipated) — `approvalSummary`/`locked` (already computed, currently only passed to `GuidedBudgetSetup`), a per-fund `openingCents` map (already fetched into `targetReports`, currently unused after that), and a single new entity-level boolean from one new call to `isMonthGatedForEntity`. See Phase 3 for the exact shape.

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: B-31 — Printable Budget as a Board-Presentation Document

### Summary

Rebuild `BudgetPrintWorksheet` from a live-meeting annotation sheet into a single, clean, mailable board document: a one-page all-funds summary (beginning balance, budgeted income/expense, net, projected ending balance, per fund) up front, followed by page-broken per-fund detail sections that now show Income/Expense subtotals, a Net Surplus/(Deficit) line, and Beginning/Projected-Ending balance blocks, all computed via the exact same pure helpers (`computeFundLineSums`, `formatBudgetReferenceCents`) the live screen already uses. A DRAFT/APPROVED status stamp (sourced from the page's existing `approvalSummary`) and a reconciliation-completeness footnote (one new call to the existing `isMonthGatedForEntity`) make the document self-contained for a reader who has never opened the app. No schema, API route, or new dependency — this is a props-and-presentation change to two existing files.

### Permissions

No change. Existing gate on `/admin/ledger/budgeting` (`LEDGER_MANAGE` / `LEDGER_APPROVE` / `BUDGET_VIEW` / `BUDGET_EDIT`, any-of) already covers everything the print worksheet renders — it's a snapshot of data already visible on that page. No new `FEATURES` key.

### API Contract

No new routes or server actions. `budgeting/page.tsx` is a Server Component that already calls `getFundReport`, `getBudgetApproval`, etc. directly; this design adds exactly one new call, to an **existing exported function**:

```ts
import { isMonthGatedForEntity } from "@/lib/financial-report-queries";

const juneNotReconciled = await isMonthGatedForEntity(entity.id, `${targetFY}-06-30`);
```

Fold this into the existing `Promise.all([...])` that already fetches `targetReports`/`priorReports`/`labelOptions`, so it doesn't add a serial round-trip.

Reasoning on the date: the FY `targetFY` runs Jul `targetFY`–Jun `targetFY+1`, so its **July 1 beginning balance** is the rolled-forward balance as of **June 30 of `targetFY`** (calendar) — the last day of the *prior* fiscal year. That's the same month-end `isMonthGatedForEntity` already knows how to gate (it's entity-scoped, joins `ledgerFunds`, and checks posted-but-unreconciled transactions on or before the date). One call covers every fund in the entity — no per-fund variant needed, since the beginning-balance caveat is really "is this entity's books closed out through that date," not a per-fund question.

### Data Model

No schema changes required.

### Component/Page Plan

**Files to modify:**
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — add the `isMonthGatedForEntity` call; build an `openingCentsByFundId` map from `targetReports` (already fetched, currently discarded after `fundItems` is built); pass three new props to `BudgetPrintWorksheet`.
- `src/components/admin/ledger/budget-print-worksheet.tsx` — full rebuild of the render tree (see below). `PrintFund`/`PrintLine`/`PrintCauseLine` types are unchanged in shape (still duck-typed from `FundSetupItem`) — no change to what the page has to build for `funds`.

**Files NOT modified:**
- `src/components/admin/ledger/print-budget-button.tsx` — untouched. It's still just `window.print()`; B-31 doesn't add a second mode or button (Locked Decision 1).
- `src/components/admin/ledger/guided-budget-setup.tsx` — untouched. The on-screen editor is a separate concern; nothing here changes what's editable or how the live balance badge behaves.

**No new files, no new component directory.**

### New props into `BudgetPrintWorksheet`

```ts
{
  entityName: string;       // unchanged
  priorFY: number;          // unchanged
  targetFY: number;         // unchanged
  funds: PrintFund[];       // unchanged shape — still fundItems, duck-typed

  // NEW:
  locked: boolean;                          // same value already computed for GuidedBudgetSetup (isBudgetLocked(approval))
  approval: BudgetApprovalSummary | null;    // same object already computed for GuidedBudgetSetup — import the type from guided-budget-setup.tsx, don't redeclare it
  openingCentsByFundId: Record<string, number>;  // fund.id -> targetReports[i].openingCents
  juneNotReconciled: boolean;               // isMonthGatedForEntity(entity.id, `${targetFY}-06-30`)
}
```

Why a separate `openingCentsByFundId` map rather than adding an `openingCents` field onto the shared `fundItems`/`FundSetupItem` objects: `fundItems` is passed to **both** `GuidedBudgetSetup` (which has no use for a balance figure — it's a live editor, not a report) and `BudgetPrintWorksheet`. Keeping the print-only field in its own small dict, built inline where `BudgetPrintWorksheet` is rendered, avoids widening `FundSetupItem`'s contract with a field only one of its two consumers reads. `BudgetApprovalSummary` is reused (imported, not redeclared) since it's already an exported type from `guided-budget-setup.tsx` and the shape is identical to what the print worksheet needs — no reason to fork it.

### Worksheet internal structure (component plan, not code)

```
BudgetPrintWorksheet(props)
├── computes once, top-level, before rendering anything:
│   printableFunds = funds
│     .map(fund => ({ fund, sums: printFundSums(fund), openingCents: openingCentsByFundId[fund.fundId] ?? 0 }))
│     .filter(pf => pf has at least one live (non-pending-delete) income or expense line)
│                                      // ^ same predicate FundWorksheet uses today — pulled up so
│                                      //   the summary table and the detail sections can never disagree
│                                      //   about which funds are "in" this printout (Locked Decision:
│                                      //   zero-budget funds omitted, as today).
│
├── <DocumentHeader> (page 1, no break-before)
│     entity name + "Annual Operating Budget, FY{targetFY}" (retitled from "Budget Worksheet" —
│       Locked Decision 1, this is a finished document, not a worksheet, even in DRAFT state)
│     "FY{targetFY} budget • prior-year reference: FY{priorFY}" (unchanged subtitle line)
│     Approval/status callout — three states, see "Draft/Approved rendering" below
│
├── <ConsolidatedSummary printableFunds targetFY juneNotReconciled> (page 1, same page as header)
│     one row per printable fund: Fund | Beginning Balance (7/1) | Budgeted Income | Budgeted Expense
│       | Net Surplus/(Deficit) | Projected Ending Balance (6/30)
│     "All Funds" total row — sum of the five numeric columns across printableFunds
│       (single-entity scope only; this worksheet only ever receives one entity's funds, so
│       there's no cross-entity Club/Foundation summation to worry about)
│     reconciliation footnote directly under the table, only when juneNotReconciled — see below
│
└── printableFunds.map(pf => <FundWorksheet pf priorFY targetFY />)   // every fund break-before-page,
                                                                        // including the first (page 1
                                                                        // is fully spoken for by the
                                                                        // header + summary)
      FundWorksheet(pf):
        fund name (unchanged h2)
        "Beginning Fund Balance, July 1, FY{targetFY}: {formatBudgetReferenceCents(pf.openingCents)}"
          — own labeled block, NOT a table row (NFF convention — balances are reference, not
          part of the income/expense math; Locked Decision default)
        Income <FlowTable> (existing category/cause/line grain, UNCHANGED) — see FlowTable delta below
        Expense <FlowTable> (same)
        "Net Surplus/(Deficit): {formatBudgetReferenceCents(pf.sums.incomeCents - pf.sums.expenseCents)}"
        "Projected Ending Balance, June 30, FY{targetFY}: {formatBudgetReferenceCents(pf.openingCents + net)}"
          — label says "Projected" explicitly (it's a plan, not an actual)
```

### `printFundSums` — the one new pure helper, and why totals can't diverge from the screen

`guided-budget-setup.tsx` already has the exact recipe for "sum a fund's live budget lines into income/expense totals, correctly excluding pending-delete lines and pending-delete cause lines under a still-live parent": `seedLineValues` + `seedPendingDeleteKeys` + `seedCauseLinePendingCents` (three small maps) fed into `computeFundLineSums()`. `printFundSums(fund: PrintFund)` is a direct, single-fund port of that same three-map-then-reduce shape, operating on `PrintFund`'s already-available fields (`budgetCents`, `pendingDeleteAt`, `causeLines[].pendingDeleteAt`) — not a new algorithm, the same one, called with print's data instead of the client island's live-edited state. This is what satisfies the Locked Decision "totals must match the screen": both call sites terminate in the same `computeFundLineSums()` export from `@/lib/ledger`.

Concretely, for one `PrintFund`:
1. `lineValues[${categoryId}_${flow}] = budgetCents ?? 0` for every line (mirrors `seedLineValues`).
2. `pendingDeleteKeys[${categoryId}_${flow}] = pendingDeleteAt !== null` for every line (mirrors `seedPendingDeleteKeys`).
3. `causeLinePendingCents[${categoryId}_${flow}] = sumBudgetCauseLines(causeLines.filter(cl => cl.pendingDeleteAt != null))` per line (mirrors `seedCauseLinePendingCents` — this is the one easy-to-miss case: a still-live category whose `budgetCents` total includes dollars from an individually-deleted cause line underneath it; without step 3 the print total would silently be too high, exactly the bug `seedCauseLinePendingCents`'s doc comment already warns about on-screen).
4. `computeFundLineSums(lineValues, pendingDeleteKeys, causeLinePendingCents)` → `{ incomeCents, expenseCents }`.

This computation happens **once per fund, at the top of `BudgetPrintWorksheet`**, not separately inside `ConsolidatedSummary` and `FundWorksheet` — both consume the same `pf.sums` object, so the front-page summary row and that fund's own detail-page total are structurally guaranteed to match (not just "computed the same way," but literally the same number, computed once).

### `FlowTable` delta (existing component, category/cause/line grain unchanged)

- **Removed:** the two blank hand-annotation `<tr>` rows at the end of every category's `<tbody>` (Locked Decision 1). Nothing else about a category or cause-line row changes — same star rendering, same inline note rendering, same Prior Budget (FY{priorFY}) / Prior Actual (FY{priorFY}) / New Budget (FY{targetFY}) columns.
- **Added:** one final row, in its own `break-inside-avoid-page` `<tbody>` after the mapped line rows, holding the flow's total — "Income Total" or "Expense Total" — bold, `border-t-2`. Extends the existing Prior Budget/Prior Actual columns per the Locked Decision to "keep/extend" them: that row also shows the **sum of `priorBudgetCents`/`priorActualCents`** across the flow's live lines (nulls treated as 0 for the sum — a per-line "—" is a legitimate "no data for that one line," but a *total* that silently drops missing lines instead of zero-filling them would understate the prior-year comparison). This total row is deliberately placed inside the table's own flow (not a separate `<tfoot>`) so it prints exactly once, immediately after the last line item, regardless of where the table happens to break across pages — `<thead>` already repeats on each printed page by default browser behavior (`display: table-header-group`), which this design relies on and does not change.
- Cause/beneficiary detail, inline stars, and inline notes are otherwise **byte-for-byte unchanged** from the current implementation.

### Draft/Approved rendering (three states, not two)

`locked` can be `false` even when `approval` is non-null (a budget approved once, then reopened for amendment — `isBudgetLocked` checks `approval.status === "locked"`, and unlocking flips status away from `"locked"` while preserving the historical `approvedByName`/`approvedAtLabel`). A document that just says "DRAFT — Not Yet Approved" in that case would be misleading — a board member could reasonably ask "wait, didn't we already approve this?" So:

1. **`locked === true`:** `"APPROVED — adopted {approval.approvedAtLabel}, board minute: {approval.boardMinute}"` — bordered/bold callout, echoing the exact phrasing the on-screen locked banner already uses (`"Approved by {approvedByName} on {approvedAtLabel} — board minute: {boardMinute}."`, `guided-budget-setup.tsx` L816-818) so the language matches between screen and print.
2. **`locked === false && approval === null`:** `"DRAFT — Not Yet Approved by the Board"` — the never-approved case, Phase 1's original recommendation.
3. **`locked === false && approval !== null`:** `"DRAFT — Reopened for Amendment"` with a sub-line: `"Previously approved {approval.approvedAtLabel}; reopened {approval.unlockedAtLabel} by {approval.unlockedByName}{approval.unlockReason ? `: "${approval.unlockReason}"` : ""}."` — mirrors the on-screen unlock-panel footnote (`guided-budget-setup.tsx` L884-888) so a reader gets the same "why is this open again" context the treasurer sees on screen.

All three render in the same bordered callout box in `DocumentHeader`; only the copy changes.

### Reconciliation footnote

Renders once, directly under the `ConsolidatedSummary` table (not repeated per-fund — the check is entity-scoped, and repeating a full sentence on every fund's detail page for a caveat that's fundamentally about the whole book's close status would bloat a multi-page document for a marginal robustness gain; Phase 1 didn't ask for per-fund repetition and Chris's Locked Decisions didn't add it). Only rendered when `juneNotReconciled` is true:

> "Beginning balances above reflect posted transactions through {June 30, targetFY, formatted}; reconciliation for that period is not yet complete, and these figures may still change before it closes."

This reads correctly in both directions the check can fire: the common case (treasurer prints in early July before June's reconciliation wraps up) and the less common case (treasurer prints a *future* FY's budget before that FY's opening month has even happened yet — `isMonthGatedForEntity` returns `true` whenever `hasMonthElapsed(monthEnd)` is `false`, which is correct: a not-yet-arrived month's reconciliation state is trivially "not complete").

### Print/pagination CSS

- Root: `hidden print:block` — unchanged, this is still purely a print-media surface, never rendered on screen or on mobile.
- `DocumentHeader` + `ConsolidatedSummary`: page 1, no `break-before`. Wrap `ConsolidatedSummary`'s `<table>` in `break-inside-avoid-page` — for the realistic fund count (2–4 per entity) it should comfortably fit one page as a single block; this just prevents an awkward mid-table split if it ever runs close to a page boundary.
- Every `FundWorksheet` section: `break-before-page` (Tailwind's built-in `break-before-page` utility — no arbitrary-property CSS needed), applied uniformly to **every** fund including the first, since page 1 is already fully spoken for by the header/summary. This resolves the current gap ("funds currently run together") flagged in Phase 1.
- Category rows: `break-inside-avoid-page` on each category's `<tbody>` — **unchanged**, already correct.
- New Income/Expense Total row: its own `break-inside-avoid-page` `<tbody>`, appended after the mapped category tbodies, so the total never splits from itself across a page (it's one row, this is mostly a no-op safeguard, but consistent with the category-row pattern already established).
- No screen-only classes change — this file has never used `rounded-2xl`/`rounded-lg`/`lions-blue` (correctly, per Phase 1's own confirmation that print output shouldn't gain screen brand classes) and this design doesn't introduce any.

### Edge Cases & Risks

- **Locked vs. draft budget:** three-state rendering above (not a boolean) — the risk being guarded against is a stale-looking "still draft" stamp on a budget that WAS approved and is now mid-amendment. Handled.
- **Fund with cause breakdown vs. lump-sum:** `printFundSums`'s cause-line-pending-cents step only has an effect when `causeLines` is non-null and at least one entry has its own `pendingDeleteAt` set; a lump-sum category (`causeLines === null`) or a fully-live breakdown contributes `0` at that step, falling through to the plain `budgetCents` sum unchanged. No special-casing needed — verified by construction, not by a new branch.
- **Negative/drawdown net (Charitable/Scholarship funds):** `formatBudgetReferenceCents` already renders negative cents correctly (`-$X.XX`), so a negative Net Surplus/(Deficit) or a Projected Ending Balance lower than the Beginning Balance just prints as a signed number — no clamping, no red styling. Deliberately **no color-coded status badge** on print (unlike the on-screen `computeBudgetBalanceStatus` warn/ok/info badge) — Locked Decisions ask for totals and balances, not a warn/ok verdict, and per-fund-kind "is this normal" framing (a charitable-fund drawdown is expected, per NFF guidance already cited in Phase 1) is exactly the kind of interactive/contextual judgment call that belongs on the live screen, not baked as a fixed verdict into a document that might be read months after printing.
- **June-not-reconciled footnote:** scoped to render once, front-page-only (see above) — a per-fund detail page photocopied and separated from the cover page would lose the caveat; judged out of scope (Phase 1 didn't flag it, Locked Decisions didn't add it, and the mailed-distribution flow in Phase 1 doesn't describe pages being split apart).
- **`approval.unlockedAtLabel` present but `approval.approvedAtLabel` absent:** not reachable — `getBudgetApproval`'s row can't record an unlock without a prior approval row to unlock (enforced by the existing approve/unlock write paths, unrelated to this feature) — no defensive branch needed beyond what state 3 above already handles.
- **`openingCentsByFundId` missing a key** (a fund present in `funds` but absent from `targetReports`): can't happen — both arrays are built from the same `funds` (from `getFunds(entity.id)`) in the same `Promise.all` order in `page.tsx`; the `?? 0` fallback in the lookup is defensive-only, matching this codebase's existing convention of defensive fallbacks even on invariants that "can't" break.
- **Very long fund (many categories):** unchanged risk profile from today — `break-inside-avoid-page` at the category-tbody grain already handles this; adding the Income/Expense Total row and the balance blocks doesn't change how the existing category list paginates.

### Out of Scope

- A second "Meeting Worksheet" print mode (Locked Decision 1 closes this).
- Redacting cause-line labels for a wider (non-board) mailing (Locked Decision 3 closes this — board-only audience, confirmed).
- A roll-up "Notes & Discussion Items" list (Phase 1 Open Question 6, not picked up).
- Any in-app "email this PDF to the board" action, or a native PDF-generation dependency — both already ruled out in Phase 1's Out of Scope and unchanged here.
- A `fundKind`-aware balance-status badge on print (see Edge Cases above) — deliberately not added.

---

## Implementer

**ux-developer**, single-agent, no specialist split. Rationale: no schema (database-admin not needed), no new route/server action/query (api-developer not needed — the one new server call is a single existing exported function invoked from an existing Server Component page, the same pattern `budgeting/page.tsx` already uses for `getFundReport`/`getBudgetApproval`/etc.). Everything here is presentation logic — a component rebuild plus prop-threading in a page that already does its own data composition inline. This mirrors how every recent increment of the budgeting page (v1.46 running totals, v1.47 environment cause + stale-totals fix, v1.48 page restructure, v1.49 star & notes) has been implemented as a single ux-developer pass, not a specialist split — the pattern holds here too.

---

# Phase 4 — Implementation

Pending

---

# Phase 5 — Verification (qa)

Pending

---

# Phase 6 — Shipped vs Intent (analyst)

Pending

---

## Phase 3 — Technical Design — 2026-07-30

**Owner:** tech-lead
**Status:** complete

### Summary

Rebuilt the design for `BudgetPrintWorksheet` (currently a live-meeting annotation sheet) into a single, clean, board-mailable document per Chris's Locked Decisions: a one-page all-funds Consolidated Summary (beginning balance, budgeted income/expense, net, projected ending balance per fund) ahead of page-broken per-fund detail sections that now carry Income/Expense Total rows, a Net Surplus/(Deficit) line, and Beginning/Projected-Ending balance blocks. A three-state DRAFT/APPROVED/Reopened status stamp and a reconciliation-completeness footnote make the document self-contained for an off-platform reader. No schema, no new route, no new dependency, no new query — one existing exported function (`isMonthGatedForEntity`) gets a new call site.

### What I did

- Recorded Chris's Locked Decisions as a "RESOLVED (Chris)" block at the top of Phase 1, resolving Open Questions 1–5 and confirming which Phase 1 defaults carry forward unchanged.
- Read `budget-print-worksheet.tsx`, `print-budget-button.tsx`, and `budgeting/page.tsx` end to end, plus the shared helpers the design leans on: `computeFundLineSums`/`computeBudgetBalanceStatus`/`formatBudgetReferenceCents`/`isBudgetLocked` (`src/lib/ledger.ts`), `isMonthGatedForEntity` (`src/lib/financial-report-queries.ts`), `FundReport`/`openingCents` (`src/lib/ledger-queries.ts`), and `guided-budget-setup.tsx`'s `seedLineValues`/`seedPendingDeleteKeys`/`seedCauseLinePendingCents`/`fundSums` (the pattern `printFundSums` ports).
- Wrote and recorded a self-certified Phase 2 note (no architect invocation this round, per the orchestrating agent's explicit direction) confirming no new directory/dependency/query — verdict: Approved.
- Authored the full Phase 3 design doc in place under "Phase 3 — Technical Design" above: new props into `BudgetPrintWorksheet`, the `printFundSums` helper spec (a direct single-fund port of the existing on-screen sum recipe, guaranteeing print/screen totals can never diverge), the `FlowTable` delta (drop the 2 blank hand-annotation lines, add an Income/Expense Total row that also sums the Prior Budget/Prior Actual columns), three-state Draft/Approved/Reopened rendering (reusing the exact on-screen copy for consistency), the reconciliation footnote's placement and wording, and pagination/print CSS (`break-before-page` per fund, `break-inside-avoid-page` at category and summary-table grain).

### Outputs

- `docs/work-log/2026-07-30-printable-budget-b31.md` — RESOLVED (Chris) block, Phase 2 note, full Phase 3 design doc, Implementer recommendation, per-phase status table updated (Phase 2 & 3 marked Complete).
- No `docs/decisions.md` entry — nothing here rises to a numbered implementation decision distinct from what's already fully specified in the design doc itself (no data-shape choice, API surface choice, or library choice that isn't already the direct, obvious consequence of Chris's Locked Decisions).

### Open questions / handoff notes

- **Use the ux-developer agent** for the whole of Phase 4 — no specialist split. Two files: rebuild `src/components/admin/ledger/budget-print-worksheet.tsx` per the design doc's component/CSS plan, and extend `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` with the three new props (`locked`, `approval` — both already computed there, just not threaded to the print component today — plus a new `openingCentsByFundId` map built from the already-fetched `targetReports`, and one new `isMonthGatedForEntity` call folded into the existing `Promise.all`).
- Implementer should re-read the design doc's "`printFundSums`" section carefully before writing it — the cause-line-pending-cents step (step 3) is the one part of the port that's easy to drop by accident, and dropping it would silently overstate a fund's total whenever a cause line is individually deleted under a still-live category.
- No unit tests are named in this design doc as MUST-HAVE (the design leans entirely on existing, already-tested pure functions — `computeFundLineSums`, `formatBudgetReferenceCents`, `isBudgetLocked`, `isMonthGatedForEntity` — composed at the presentation layer, not new business logic). If the implementer introduces `printFundSums` as a standalone exported pure function (recommended, for the same Vitest-seam reason `computeFundLineSums` itself was extracted), a small Vitest suite covering the cause-line-pending-cents case is good practice but is qa's call at Phase 5, not a Phase 4 gate here.
- Flag for qa at Phase 5: verify the printed page count/break behavior manually (typecheck + build won't catch a pagination regression) — print preview or "Save as PDF" the budgeting page for an entity with 2+ funds and confirm each fund starts a new page, and that the Consolidated Summary's numbers match each fund's own detail-page total exactly.
