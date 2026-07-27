# Ledger Budgeting — In-App Guidance (Guide section + inline links) — Work Log

> **Slug:** `2026-07-27-ledger-budgeting-guide`
> **Surface:** (dashboard) admin — Treasury User's Guide (`/admin/ledger/guide`) + Budgeting page (`/admin/ledger/budgeting`)
> **Permission(s):** existing — `FEATURES.LEDGER_VIEW` / `LEDGER_RECORD` / `LEDGER_MANAGE` / `LEDGER_APPROVE` (guide, any-of) and existing `FEATURES.LEDGER_MANAGE` (budgeting page). No new key.
> **Estimated complexity:** small (content + two components, no schema/API)
> **Pipeline mode:** Accelerated — Phase 2 and Phase 3 both skipped (rationale below)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-27 |
| 2 — Architectural review | architect | Skipped (see rationale) | N/A | 2026-07-27 |
| 3 — Technical design | tech-lead | Skipped (see rationale) | N/A | 2026-07-27 |
| 4 — Implementation | ux-developer | Complete | — | 2026-07-27 |
| 5 — Verification | qa | Complete | PASS | 2026-07-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Teach the treasurer *why* the app enforces different budget-balance rules per fund kind, in the same in-app guide they already read for everything else — no new mechanism, no schema, just a new guide section plus two small annotations on an existing page.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer/board, gated by existing ledger features) | Reads the new "Budgeting" section top-to-bottom or jumps to it from the TOC | Occasional — onboarding a new treasurer, or refreshing memory before annual budget-build |
| Admin | Clicks "How budgeting works" inline link on `/admin/ledger/budgeting` | On demand, in-context, while looking at a specific fund's balance badge |
| Admin | Reads the one-line "why" note under a fund's balance advisory on the Budgeting page | Every time they view that page, no click required |
| Admin | Clicks from the new guide section to the existing Compliance Calendar section for 990/registration deadlines | On demand, cross-link, no duplicated content to read twice |

No other surface touches this — anonymous visitors, access-pending members, and ordinary signed-in members never see the Ledger at all.

## Flows

**Flow 1 — Reading the guide section on its own:**
`/admin/ledger/guide` (existing entry) → treasurer opens the "Contents" `<details>` (or scrolls) → clicks "Budgeting" in the TOC → lands on `#budgeting` → reads six subsections in order → optionally clicks through to `/admin/ledger/budgeting` (to *do* the budgeting) or to `#compliance-990` (for filing deadlines) → outcome: treasurer understands the two-fund rule, how funds map to entities, how to build the budget, why reserves differ by fund kind, and the deductibility distinction.
- Failure: none really — this is a static read-only Server Component section. The only "failure" is the two live reads on the guide page (990 determination, settings recap) already fail soft to a one-line fallback per existing `try/catch` pattern (DECISION-037) — the new section doesn't add a live read, so it can't introduce a new failure mode. Confirmed no new empty/failure state is needed here.

**Flow 2 — Landing on the guide from the Budgeting page's inline link:**
`/admin/ledger/budgeting` (existing entry, requires `LEDGER_MANAGE`) → treasurer sees a fund card with a "Needs review" or "Informational" badge → reads the new one-line "why" note under the existing balance message → clicks "How budgeting works" → navigates to `/admin/ledger/guide#budgeting` (new tab or same tab, consistent with how other guide cross-links behave in this codebase) → outcome: treasurer lands directly on the new section instead of a blind link to an external PDF or nothing at all.
- Failure: if the anchor target doesn't exist (component not registered in `page.tsx`'s section list / TOC), the link 404s to nowhere in particular — it just scrolls to page bottom with no visible target. This is a build-time-checkable failure (the implementer must add the import + TOC entry), not a runtime one — flagging so QA click-through checks the anchor actually lands mid-page, not just that the guide page loads.

## Permissions

- **Permission(s):** No new key. Guide section reuses the guide page's existing `hasAnyFeature` gate (`LEDGER_VIEW | LEDGER_RECORD | LEDGER_MANAGE | LEDGER_APPROVE`). The inline link + "why" note live on the Budgeting page, already gated to `LEDGER_MANAGE` only.
- **Default roles:** Whatever already holds these keys (Treasurer, Admin roles per existing Ledger role bindings) — unchanged.
- **Confirmed non-issue:** `LEDGER_MANAGE` is a member of the guide's any-of list, so anyone who can reach the Budgeting page (and therefore see the inline link) can always reach the guide section it points to. No permission-mismatch edge case where the link target 403s for a user who clicked it legitimately.

## Gaps the Request Didn't Address

- **Stale-content risk (figures, not principles).** Dues amounts, district per-capita rates, and any dollar thresholds (e.g., "3–6 months operating reserve," the Activity fund's $100 tolerance) drift over time and are easy to hardcode into prose that nobody remembers to update. `guardrails-section.tsx` already establishes the precedent for this exact problem — it deliberately keeps dollar/day-count thresholds out of prose and points to the live Settings page instead (see its header comment, lines 12-19). The new Budgeting section must follow the same rule: state reserve guidance and the near-zero tolerance as *principles* ("hold several months of operating reserve," "aim to disburse, not accumulate, on the public/charitable side"), not as numbers baked into copy. The one genuinely fixed, code-verifiable number ($100 Activity tolerance, from `ACTIVITY_BALANCE_TOLERANCE_CENTS` in `src/lib/ledger.ts`) may be stated once in the "why" note on the Budgeting page itself, since it's read directly off the constant it's currently accompanying — but the guide section should still describe it as "roughly $100" or defer to the live page rather than repeat the number a second time in a place nobody will update in sync.
- **"Why" notes must match `computeBudgetBalanceStatus`'s actual thresholds, not a paraphrase of the source material.** The sourced content says "Administrative: income≥expense" — the actual function warns only on strict `<` (equal is OK), which matches. "Activity: net ~$0 ±$100" matches `ACTIVITY_BALANCE_TOLERANCE_CENTS = 10_000` exactly. "Charitable/Scholarship: always info" matches (never warns). Implementer should write the "why" note copy by reading `computeBudgetBalanceStatus`'s JSDoc (`src/lib/ledger.ts` lines ~1014-1040) directly, not by re-deriving from this work-log, to avoid a second layer of paraphrase drift.
- **Not duplicating the Compliance Calendar section.** The sourced material's "990/registration deadlines" content must NOT be repeated in the new Budgeting section — it must be a single cross-link (`#compliance-990` anchor) per the feature request's explicit instruction. Locked in the outline below as a one-line pointer, no calendar content restated.
- **Anchor-target verification.** Per Flow 2's failure path above — QA must confirm the inline link on the Budgeting page actually scrolls to the new section (not just that both pages independently load).
- **Placement in the guide's linear order wasn't specified by the request.** I'm recommending a placement below (after Reports, before Reconciliation) but this is a layout call, not content — ux-developer can adjust without a design-doc round-trip since it doesn't change any content or invariant.

## Out of Scope (confirm with user)

- Any UI change to the budget-editor's data entry (line items, seeding logic) — this feature is purely explanatory content plus two link/annotation additions. No behavior change to `computeBudgetBalanceStatus`, seeding, or the editor.
- A budgeting-specific compliance calendar or deadline list — explicitly deferred to the existing Compliance Calendar section via cross-link, not built here.
- Printable/exportable version of the new section — the guide already supports `print:hidden` classing on nav-only elements; the new section should follow the same pattern others use (content prints, TOC/nav doesn't) with no new print styling work implied.

## Open Questions

- Confirm the two exact citations ("Standard Club Constitution Art. VII §3(g)"; "LCI Board Policy Manual Ch. XV — Use of Funds") are the versions currently in force before they're quoted verbatim in-app — the sourced material is described as already cite-backed and approved, but a citation embedded in a live app page has a longer shelf life than a one-off briefing document did. Recommend a one-time confirmation now, not a recurring review burden.
- Should the inline "How budgeting works" link open in the same tab (losing the treasurer's place on the Budgeting page) or a new tab? Other guide cross-links in this codebase (e.g., `guardrails-section.tsx` → Compliance page) use same-tab `<Link>`. Recommend consistency: same tab, same-origin `<Link>`, no `target="_blank"` — but flagging since the request didn't specify.

---

## LOCKED CONTENT OUTLINE — `budgeting-section.tsx`

Anchor id: `budgeting` · TOC label: **"Budgeting"** · Recommended TOC position: after `reports`, before `reconciliation` (budget-building naturally follows "what actually happened last year"; Reconciliation/Settings are end-of-cycle, budgeting is forward-looking). Not a hard requirement — ux-developer may place it wherever reads best; content below is unaffected by position.

Follows the established section shape: `<section id="budgeting" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">`, `<h2>` title, `<h3>` per subsection, `Link` cross-refs styled with the shared `linkClass` constant used in `dues-section.tsx` / `guardrails-section.tsx`.

1. **Intro (no heading, one paragraph).** One or two sentences framing why budgeting has its own guide section: the Budgeting page (`/admin/ledger/budgeting`) enforces different "balanced" rules depending on which fund you're looking at, and this section explains the policy reasoning behind that. Link out to `/admin/ledger/budgeting`.

2. **"The Two-Fund Rule" (h3).** The keystone rule, stated plainly: money raised from the public may never fund club administration. Cite: Standard Club Constitution Art. VII §3(g); LCI Board Policy Manual Ch. XV, "Use of Funds." One sentence of rationale: the public gives on the understanding that net proceeds serve a community need, and diverting them is a breach of that trust. One line on the netting nuance: only a fundraiser's *direct* costs may be deducted from its proceeds — general overhead may not be netted against public donations.

3. **"How Our Funds Map" (h3).** Club entity ((c)(4)) = Administrative + Activity funds. Foundation ((c)(3)) = Charitable + Scholarship funds. The Activity fund is a pass-through clearing account — it targets roughly zero balance and sweeps to the Foundation. This is the paragraph that sets up why the balance rule differs per fund kind (referenced again in subsection 5).

4. **"Building the Budget" (h3).** Practical, principle-first, no dollar figures: start from prior-year actuals — this is what the "Seed from last year" button on the Budgeting page does (link to `/admin/ledger/budgeting`); project revenue conservatively and lean high on expected expenses; each fund's budget must balance on its own terms, not against another fund; enter dues and insurance first since they're the most predictable lines; plan a small intentional surplus on the Administrative side rather than budgeting to exactly zero.

5. **"Reserves vs. Disbursement — Why the Rule Differs by Fund" (h3).** The direct payoff subsection: on the Administrative side, the goal is to hold a healthy operating reserve (several months of expenses) because that fund covers the club's own bills. On the Charitable/Scholarship side, the goal is the opposite — disburse, don't accumulate; a large idle public-donation balance can put exempt status at risk. This is explicitly stated as *the reason* the Budgeting page's balance badges ("Balanced" / "Needs review" / "Informational") behave differently per fund kind — one sentence explicitly bridging to the live page's behavior, so a treasurer reading this then looking at the Budgeting page recognizes the connection.

6. **"Deductibility — Which Gifts Are Tax-Deductible" (h3).** Gifts to the Club (a 501(c)(4)) are not tax-deductible to the donor; gifts to the Foundation (a 501(c)(3)) are. One line of guidance: steer deduction-sensitive donors toward the Foundation / the campaigns that route there.

7. **"Compliance Deadlines" (h3, short — cross-link only, no restated content).** One sentence: budgeting decisions feed the annual 990 and state-registration filings: see the Compliance Calendar section above for the current filing calendar — `<Link href="#compliance-990">`. No dates, forms, or thresholds repeated here.

**Explicit "confirm before quoting" flags for the implementer:**
- The two citations in subsection 2 (Art. VII §3(g); Board Policy Ch. XV) — quote verbatim, but see Open Questions above re: one-time currency check.
- Do NOT state the Activity fund's $100 tolerance or the "3–6 months" reserve guidance as a precise, permanent-feeling number inside this guide section's prose — describe them as principles. (The $100 figure may appear once, on the Budgeting page's own "why" note, since it's read directly from the constant it annotates — see Gaps above.)
- No specific dues dollar amounts, district per-capita rates, or LCI due dates anywhere in this section — those belong to the Dues section (existing) and Compliance Calendar section (existing, cross-linked, not duplicated).

## LOCKED CONTENT — Budgeting page annotations

**Inline link (new, on `/admin/ledger/budgeting`, page-level, near the top intro copy or the fund-cards heading — implementer's call on exact placement):**
> "How budgeting works →" — `<Link href="/admin/ledger/guide#budgeting">`, same tab, styled with the page's existing link treatment.

**Per-fund "why" one-liner (new, appended directly under the existing `balanceMessage()` paragraph inside each fund's review card in `guided-budget-setup.tsx`, right after line ~323 in the current file):** one sentence per fund kind, matching `computeBudgetBalanceStatus`'s actual rule, not a generic restatement:
- `administrative`: "This fund covers the club's own operations, so it's expected to hold a real reserve — budgeted income should never fall short of planned expense."
- `activity`: "This fund is a pass-through for publicly-raised money on its way to the Foundation, so 'balanced' means net income and expense land within about $100 of each other — not a surplus."
- `charitable` / `scholarship`: "This fund holds public and charitable money meant to be disbursed, not stockpiled — a planned drawdown is normal and won't trigger a warning."
- unrecognized kind: omit the "why" note entirely (falls through to the existing generic "Net budgeted" message with no added annotation — nothing meaningful to explain for a kind the app doesn't recognize).

Each "why" note may itself carry the same inline link ("How budgeting works →") or a single shared link can sit once above the fund-card grid — implementer's call; either satisfies the request's "inline link on the Budgeting page" requirement as long as it's reachable from that page without a separate navigation step through the guide's TOC.

---

## Recommended Implementer

**ux-developer.** This is pure content plus two small React component changes (one new guide section component + import/TOC registration in `page.tsx`; one small addition of a link and per-fund-kind string inside the existing client island `guided-budget-setup.tsx`). No schema, no API, no new permission key, no new directory pattern — the guide's section-component convention and the Budgeting page's client-island structure both already exist and are being extended, not invented.

## Phase 2/3 Skip Rationale (documented per Workflow Rule — no silent skips)

**Phase 2 (architect) skipped.** No new directory, no new npm dependency, no new server/client boundary decision (the guide section is a Server Component exactly like its ten siblings; the Budgeting page changes land inside the existing `"use client"` island), no invariant is touched or reinterpreted. The `guardrails-section.tsx` precedent this review leans on for the stale-figures gap is itself evidence the pattern is already architecturally settled.

**Phase 3 (tech-lead) skipped.** No API contract, no data model, no new component *pattern* — only a new instance of an existing pattern (guide section) and two small edits to an existing component (`guided-budget-setup.tsx`) using a function (`computeBudgetBalanceStatus`) that already exists and is not being modified. The content outline locked above in this Phase 1 review *is* the design — there's no technical decision left for tech-lead to make that isn't a content decision already resolved here. If the implementer discovers a genuine structural question while building (e.g., the anchor-linking mechanism doesn't work the way `guardrails-section.tsx`'s cross-links imply), that reopens Phase 3, not this review.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** See Phase 2/3 Skip Rationale above.

---

# Phase 3 — Technical Design (tech-lead)

**Skipped.** See Phase 2/3 Skip Rationale above. Content outline and component/file plan are locked in this Phase 1 entry above and stand in place of a design doc.

---

# Phase 4 — Implementation (UI) — 2026-07-27

**Owner:** ux-developer
**Status:** complete

### Summary

Added the new "Budgeting" section to the Treasury User's Guide (all seven locked subsections, no dollar figures baked into prose except principle-level language) and registered it in the guide's TOC/section list between Reports and Reconciliation. Added an inline "How budgeting works →" link near the top of the Budgeting page, and a per-fund "why" one-liner under each fund's `balanceMessage()` output in the guided-budget-setup client island, worded to match `computeBudgetBalanceStatus`'s actual per-fund-kind rule.

### What I did

- Read the Phase 1 locked outline and legal citations in this work-log, plus `guardrails-section.tsx`'s "point to live values, don't hardcode figures" precedent and `computeBudgetBalanceStatus`'s JSDoc in `src/lib/ledger.ts` (lines ~1005-1059) directly, per the Phase 1 gap notes — not re-derived from paraphrase.
- Built `budgeting-section.tsx` following `dues-section.tsx` / `guardrails-section.tsx` markup conventions exactly: `<section id="budgeting" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">`, `<h2>` + `<h3>` per subsection, shared `linkClass` constant, `Link` cross-refs.
- Registered the section in `guide/page.tsx`: import, TOC array entry (after "Reports", before "Bank Reconciliation"), and JSX placement in the same order — matching the recommended (not mandatory) position from the Phase 1 outline. Updated the page's header doc comment (section count eleven → twelve, added a pointer to this work-log).
- Added the "How budgeting works →" inline link to the Budgeting page's `PageHeader` (server component, one shared link above the fund-card grid rather than repeating it per card — satisfies the "reachable without a TOC round-trip" requirement per the outline's either/or note).
- Added `balanceWhyNote(fundKind)` to `guided-budget-setup.tsx`, rendered directly under the existing `balanceMessage()` paragraph inside each fund's review card. Copy is the exact locked wording from the work-log for `administrative` / `activity` / `charitable` / `scholarship`; unrecognized kinds render no note (`null`), matching the outline's explicit "omit for unrecognized kind" instruction.
- Confirmed the anchor target for the compliance cross-link by reading `compliance-calendar-section.tsx` directly — it's `#compliance-990`, not `#compliance` as the tech-lead brief guessed; used the real id.
- Kept the two legal citations verbatim (Standard Club Constitution Art. VII §3(g); LCI Board Policy Manual Ch. XV, "Use of Funds") with the "as of current LCI governing documents" soft framing called for in the brief, per the Phase 1 Open Question about citation currency.
- Did not restate the $100 Activity tolerance or "3–6 months" reserve figure in the guide section prose — both stated as principles ("roughly zero," "a few months of operating costs"). The $100 figure appears once, in the `activity` why-note on the Budgeting page itself (reads directly off the value the note annotates, per the Phase 1 gap note's explicit carve-out).

### Outputs

- **Created:** `/home/user/westervillelions/src/components/admin/ledger/guide/budgeting-section.tsx`
- **Modified:** `/home/user/westervillelions/src/app/(dashboard)/admin/ledger/guide/page.tsx` — import, TOC entry, JSX placement, header comment update.
- **Modified:** `/home/user/westervillelions/src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — inline "How budgeting works →" link added inside `PageHeader`.
- **Modified:** `/home/user/westervillelions/src/components/admin/ledger/guided-budget-setup.tsx` — new `balanceWhyNote()` helper + render call under each fund card's `balanceMessage()` paragraph.
- No schema, API, or new permission changes — none were in scope.

### UX-gate confirmations

- Cards stay `rounded-2xl` (new section container matches every sibling section); no `rounded-xl` introduced.
- No new buttons; the one new link and the guide's existing cross-links use `rounded` (link/focus-ring), never `rounded-full` — links aren't buttons in this pattern, consistent with `dues-section.tsx` / `guardrails-section.tsx`.
- Inline link on the Budgeting page styled per UX guidelines: `text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition` + `focus:outline-none focus:ring-2 focus:ring-lions-blue rounded`.
- Guide-section cross-links use the shared `linkClass` (`text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded`), identical to every existing section.
- `lions-gold` not used as a new accent here (none of the locked content called for a badge); no `lions-red` anywhere.
- Per-fund why-note styled subtly: `text-xs text-gray-500`, exactly as directed.
- New guide section is a plain Server Component (no `'use client'`, no hooks, no DB access) — presentational only, matching every sibling section.
- The only `'use client'` file touched, `guided-budget-setup.tsx`, already had that directive; no new client boundary introduced.
- No native browser dialogs added or touched. No `console.log` introduced.
- Mobile-first: no new layout primitives — inherits the guide's existing `max-w-4xl` single-column flow and the Budgeting page's existing responsive grid.

### Verification run

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 17 files, **516 passed**, 0 failed (unchanged count, no regressions).
- `pnpm lint` — could not run; ESLint 9.39.2's own config loader fails with `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`, a pre-existing environment/tooling break unrelated to these changes (no source files under `src/` were touched that would trigger new lint rules; typecheck already covers syntax/type correctness). Flagging for qa/deployment-engineer as a pre-existing gap, not introduced here.

### Open questions / handoff notes

- **For qa's manual click-through:**
  1. `/admin/ledger/guide` — confirm "Budgeting" appears in the Contents TOC between "Reports" and "Bank Reconciliation", and clicking it scrolls to the new `#budgeting` section (not page-bottom with no target).
  2. Within the new section, confirm the "Compliance Calendar section above" link actually scrolls up to the Form 990 section (anchor `#compliance-990`) rather than 404ing or landing nowhere.
  3. `/admin/ledger/budgeting` — confirm "How budgeting works →" appears near the page header and, when clicked, navigates to `/admin/ledger/guide#budgeting` and lands mid-page on the right section (same-tab, per the Phase 1 recommendation — no `target="_blank"` was added).
  4. On the Budgeting page's fund cards, confirm each fund kind shows the correct why-note text under its balance message: Administrative/Activity/Charitable/Scholarship funds each get the locked one-liner; if any fund in the live data has an unrecognized `kind` string, confirm it shows no why-note (falls through cleanly, no blank paragraph artifact — note the conditional render skips the `<p>` entirely when `balanceWhyNote` returns `null`).
  5. Resize to mobile width and confirm the new section and the inline link don't introduce any horizontal scroll or cramped touch targets.
- **New copy strings the Lions Club may want to refine:** none of the locked outline's wording was changed from what was specified in this work-log — if the club wants to soften/adjust any of the seven-subsection prose, that's a content-only change with no component impact.
- **UX decisions made without a design-doc round-trip (per Phase 1's explicit allowance):**
  - Section placement: after Reports, before Reconciliation — matches the Phase 1 recommendation exactly.
  - Inline link placement: one shared link in the Budgeting page's `PageHeader`, above the fund-card grid, rather than duplicating it inside every fund card's why-note. Chosen because the outline explicitly allows either approach ("implementer's call") and a single link avoids visual repetition across a grid that can have several fund cards.
  - Same-tab navigation for both the Budgeting→Guide link and the Guide's internal Compliance cross-link, consistent with every existing guide cross-link in the codebase (no `target="_blank"` anywhere in this pattern).
- **Next agent:** qa (Phase 5) — verify per the click-through list above, then hand to analyst for Phase 6 shipped-vs-intent.
- **Known pre-existing gap (not introduced by this change):** `pnpm lint` is currently broken at the ESLint-config-loading level (`minimatch` ESM/CJS interop error under ESLint 9.39.2) — this predates this feature and blocks lint entirely for any change right now. Worth a deployment-engineer look independent of this feature.

---

# Phase 5 — Verification (qa) — 2026-07-27

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Typecheck, unit tests, and the build's compile/TypeScript stages are clean; the production-build failure that does occur is the documented pre-existing sandbox limitation (no `DATABASE_URL`), not a regression. Content audit confirms all seven locked subsections are present and accurate, no invented figures, the compliance cross-link anchor is real, the inline link href is exact, and the per-fund "why" notes match `computeBudgetBalanceStatus`'s actual per-fund-kind rule word-for-word against the source. No protected route or gate was touched or weakened.

### What I did

- Read the Phase 1 locked content outline and the Phase 4 ux-developer report (files changed, click-through list) in full before touching anything.
- Read all four changed/added files: `budgeting-section.tsx`, `guide/page.tsx`, `budgeting/page.tsx`, `guided-budget-setup.tsx`.
- Read `compliance-calendar-section.tsx` directly to verify the `#compliance-990` anchor id actually exists (it does, line 28) rather than trusting the Phase 4 self-report.
- Read `computeBudgetBalanceStatus` and its JSDoc in `src/lib/ledger.ts` (lines 996-1059+) directly and diffed its stated per-fund-kind rule against each `balanceWhyNote()` string in `guided-budget-setup.tsx`.
- Ran the verification stack: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build:only`, `pnpm lint`.
- Grepped the four changed files for volatile hardcoded figures (`$100`, "3-6"/"3–6", "months"), native dialogs, `console.log`, `rounded-full`, `lions-red`.
- Checked `e2e/` for any existing spec touching `/admin/ledger/guide` or `/admin/ledger/budgeting` — none exist, so no e2e regression surface and none to add for a content-only change per the Phase 1/4 scope.
- Confirmed `.env.local` / `DATABASE_URL` are absent in this sandbox, so the dev server and Playwright cannot run here — flagged as the known limitation and deferred to manual click-through per the task's explicit allowance.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — no output, clean exit.

#### Unit Tests
`pnpm test`: **PASS**
Total: 516 | Passed: 516 | Failed: 0
Duration: 4.02s
Failures: none. Count matches Phase 4's reported 516/516 exactly — no regression. No new unit tests expected or added (content/UI-only change, no pure-TS logic added).

#### Production Build
`pnpm build:only`: **PASS (with documented pre-existing environment limitation)**
- `✓ Compiled successfully in 29.2s` (Turbopack)
- `Running TypeScript ... Finished TypeScript in 42s` — clean, no errors from any of the four changed files.
- Fails afterward at "Collecting page data" with `Error: DATABASE_URL or DB_URL environment variable is not set`, surfaced via `/api/admin/announcements/[id]` (a route this feature never touched). This is exactly the KNOWN sandbox limitation called out in the task brief — no `.env.local` / `DATABASE_URL` exists in this environment. Not a regression: the compile and TypeScript passes (the stages this feature could actually break) both succeeded.
- `pnpm lint`: still broken with the pre-existing `minimatch`/ESLint 9.39.2 ESM interop error, independent of this change (same failure signature Phase 4 already flagged).

#### End-to-End Tests
`pnpm test:e2e`: **NOT RUN** — no `.env.local`/`DATABASE_URL` in this sandbox, so `pnpm dev` cannot come up and Playwright has no server to test against. Substitution: code/content audit below plus a nomination for manual click-through (Phase 1's own click-through list, unchanged). No existing spec under `e2e/` targets `/admin/ledger/guide` or `/admin/ledger/budgeting`, so there is no existing e2e coverage this change could have regressed.

#### Code / Content Audit (dev server unavailable — static-read substitution, stated per task allowance)

- **TOC registration + anchor:** `guide/page.tsx` imports `BudgetingSection` (line 21), lists `{ id: "budgeting", label: "Budgeting" }` in `TOC` between `reports` and `reconciliation` (line 37), and renders `<BudgetingSection />` in the same position in the JSX section list (line 167). `budgeting-section.tsx` line 23: `<section id="budgeting" ...>`. IDs match exactly — the TOC anchor link (`href="#budgeting"`, page.tsx line 145) targets a real element.
- **Content accuracy — all seven locked subsections present and faithful to the outline, verified line-by-line against `budgeting-section.tsx`:**
  1. Intro paragraph, links to `/admin/ledger/budgeting` (lines 26-34).
  2. "The Two-Fund Rule" — states the rule, cites "Standard Club Constitution, Art. VII §3(g)" and "LCI Board Policy Manual, Ch. XV" verbatim, includes the direct-cost netting nuance (lines 36-50).
  3. "How Our Funds Map" — Club (c)(4) = Administrative + Activity; Foundation (c)(3) = Charitable + Scholarship; Activity is pass-through targeting "roughly a zero balance" (lines 52-61).
  4. "Building the Budget" — prior-year actuals / Seed link, conservative revenue, per-fund independent balance, dues/insurance first, small admin-side surplus (lines 63-85).
  5. "Reserves vs. Disbursement" — admin holds reserve, charitable/scholarship disburse not accumulate, explicit bridge sentence to the Budgeting page's balance-badge behavior (lines 87-100).
  6. "Deductibility" — (c)(4) gifts not deductible, (c)(3) gifts deductible, steer donors to Foundation (lines 102-108).
  7. "Compliance Deadlines" — one-sentence cross-link only, no dates/forms restated (lines 110-118).
- **No invented or inaccurate claims found.** Fund-kind → entity mapping, deductibility direction, and the two-fund citation match the locked outline exactly; nothing added beyond it.
- **No volatile hardcoded figures in the guide section prose:** grepped `budgeting-section.tsx` for `$100` / "3-6" / "3–6" / "months" — the only `$100` hit is in the header *comment* (not rendered), and the one prose "months" usage reads "a few months of operating costs" (principle-level, no number), matching the Phase 1 gap note's explicit instruction.
- **Compliance cross-link anchor verified real, not assumed:** read `compliance-calendar-section.tsx` directly — `<section id="compliance-990" ...>` at line 28. `budgeting-section.tsx` line 114 links to `href="#compliance-990"`. Match confirmed independently (Phase 4's self-report of having verified this is corroborated, not just trusted).
- **Budgeting-page inline link href exact:** `budgeting/page.tsx` line 202: `href="/admin/ledger/guide#budgeting"` — matches the spec exactly (same-tab `<Link>`, no `target="_blank"`).
- **`balanceWhyNote` vs. `computeBudgetBalanceStatus` — verified word-for-word against the source function, not the work-log's paraphrase:**
  - `administrative`: function warns only on strict `budgetedIncomeCents < budgetedExpenseCents` (equal is ok, `ledger.ts` line 1049). Why-note: "budgeted income should never fall short of planned expense" — matches (fall short = strict less-than).
  - `activity`: function warns when `Math.abs(netCents) > ACTIVITY_BALANCE_TOLERANCE_CENTS` (10,000 cents = $100, line 1012, 1053). Why-note: "within about $100 of each other — not a surplus" — matches the tolerance and correctly frames it as a band around zero, not a one-sided surplus check.
  - `charitable` / `scholarship`: function always returns `info`, never warns (per JSDoc lines 1028-1029). Why-note: "a planned drawdown is normal and won't trigger a warning" — matches.
  - Unrecognized kind: `balanceWhyNote()` returns `null` (line 71), and the render site (`guided-budget-setup.tsx` line 344) only renders the `<p>` when the note is truthy — no blank paragraph artifact. Matches the outline's explicit "omit entirely" instruction.
  - **No mismatch found — this was the highest-risk item per the task brief, and it checks out.**

#### UX / Gate Audit

- **No auth or permission change.** `guide/page.tsx` still gates on `hasAnyFeature(..., [LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` (lines 70-76, unchanged). `budgeting/page.tsx` still gates on `hasFeature(..., FEATURES.LEDGER_MANAGE)` only (lines 33-34, unchanged). Neither gate was touched, widened, or weakened by this change.
- Cards: new section container is `rounded-2xl shadow-sm overflow-hidden` (line 23), matching every sibling guide section — no `rounded-xl` introduced.
- Links: inline "How budgeting works →" uses `text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition` + focus ring (`budgeting/page.tsx` lines 202-206); guide cross-links use the shared `linkClass` with `hover:underline` + focus ring (`budgeting-section.tsx` lines 3-4). No `rounded-full` anywhere in the four files (grep confirmed).
- Colors: no `lions-red` in any of the four files (grep confirmed). `lions-gold` unchanged usage elsewhere (eyebrow labels), nothing new introduced by this feature.
- `budgeting-section.tsx` is a plain Server Component — no `"use client"`, no hooks, no DB import. Matches every sibling section.
- `guided-budget-setup.tsx` already had `"use client"` before this change; no new client boundary introduced.
- No `console.log`, no `window.confirm`/`alert`/`prompt` in any of the four files (grep confirmed).
- Mobile: no new layout primitives; inherits existing `max-w-4xl` (guide) and existing responsive grid (budgeting page).

### Regression Tests Added

- None. This is a content/UI-only change with no pure-TS logic modified (`computeBudgetBalanceStatus` itself was read, not touched) and no bug being fixed — no regression-test obligation per the Regression Test Discipline section.

### Coverage on Critical Modules

- `src/lib/events.ts`, `src/lib/permissions.ts`, `src/lib/members.ts`: unaffected by this feature; not re-measured here (no changes touch these modules). Existing coverage stands from prior reviews.
- `src/lib/ledger.ts` (`computeBudgetBalanceStatus`): unmodified by this feature — its existing unit tests (already part of the 516 green) continue to cover it; no new branches were introduced.

### Feature-Gate Audit (mandatory before PASS)

No new or changed protected routes/server actions. This feature added zero routes, zero server actions, and zero new permission keys — it only added a static content component and two annotations to two pages whose gates were already correct and are unchanged.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/ledger/guide` (page) | yes (unchanged, line 67-68) | yes — `hasAnyFeature` (unchanged, line 70-76) | `LEDGER_VIEW \| LEDGER_RECORD \| LEDGER_MANAGE \| LEDGER_APPROVE` (any-of, correct for a read-only guide) |
| `GET /admin/ledger/budgeting` (page) | yes (unchanged, line 31) | yes — `hasFeature` (unchanged, line 33-34) | `LEDGER_MANAGE` (correct — guided budget setup is a write-capable tool, not view-only) |

### Verdict: PASS

### Open questions / handoff notes

- **For analyst (Phase 6):** shipped content matches the Phase 1 locked outline subsection-for-subsection; recommend confirming the "why" note wording reads naturally to a non-technical treasurer (a judgment call outside QA's remit) and that this satisfies the Phase 1 user verbs.
- **Manual click-through still owed before full confidence (dev server unavailable in this sandbox — no `DATABASE_URL`/`.env.local`):** the 5-item list Phase 4 already wrote (TOC → `#budgeting` scroll; in-section compliance link → `#compliance-990` scroll; Budgeting page inline link → lands mid-page on `/admin/ledger/guide#budgeting`; per-fund why-notes render correctly for each live fund kind, including graceful omission for any unrecognized kind; mobile width has no horizontal scroll). Structural/static checks above all line up (matching ids, matching hrefs, matching rule logic), so risk is low, but a live click-through has not yet been performed by a human. **Recommend the user (chenson42) or the next session with a working `.env.local` perform this before Phase 6 closes, or accept it as a SHIP WITH NOTES follow-up.**
- **Pre-existing, out-of-scope gaps carried forward (not blocking this PASS):** `pnpm lint` still broken (`minimatch`/ESLint 9.39.2 ESM interop) — flagged again for deployment-engineer, unrelated to this feature. Build's DB-dependent "Collecting page data" stage cannot be exercised in this sandbox at all — environment gap, not a code defect.
- **Next agent:** analyst, for Phase 6 shipped-vs-intent review.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-27

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The treasurer now gets the "why" where they budget — a faithful, citation-accurate Budgeting section in the Guide, reachable in one click from the Budgeting page, with per-fund why-notes that match the actual balance-check code exactly; the only thing standing between this and a clean SHIP IT is a live click-through that the sandbox genuinely cannot run, which is a low-risk, trackable follow-up, not a blocker.

## What's Working

- **The two-fund rule lands as the keystone it's supposed to be.** `budgeting-section.tsx` states it before anything else, cites both sources verbatim ("Standard Club Constitution, Art. VII §3(g)" and "LCI Board Policy Manual, Ch. XV"), and includes the direct-cost-netting nuance the sourced material called out. A treasurer reading top to bottom gets the rule, the citation, and the one exception, in that order — no rediscovery needed later.
- **The bridge sentence in "Reserves vs. Disbursement" does exactly the connective job Phase 1 asked for.** It explicitly ties the abstract policy (hold reserve vs. disburse) to the concrete UI behavior ("this is exactly why the Budgeting page's balance badges behave differently per fund"). That's the single most important sentence in the section for making the Guide and the Budgeting page feel like one coherent explanation instead of two disconnected documents, and it's there, worded plainly.
- **The stale-content guardrail held.** I flagged in Phase 1 that dollar/day-count figures rot in prose. Spot-checking `budgeting-section.tsx` directly: the reserve guidance reads "a few months of operating costs" (no number), the Activity tolerance reads "roughly a zero balance" / "roughly $100" is not restated at all in the guide section — it appears exactly once, in the Budgeting page's own why-note, read live off `ACTIVITY_BALANCE_TOLERANCE_CENTS`. That's the precedent from `guardrails-section.tsx` applied correctly, not just claimed.
- **The why-note copy is not a paraphrase — it's a correct restatement of the actual function.** I read `computeBudgetBalanceStatus` in `src/lib/ledger.ts` (lines ~1000-1059) directly rather than trust the work-log chain: `administrative` warns only on strict income `<` expense (equal is fine) — the why-note says "should never fall short," which is the strict-less-than case worded for a human. `activity` warns when `|net| > 10_000` cents — the why-note says "within about $100 of each other," matching the band framing exactly (not a one-sided surplus check, which would be wrong). `charitable`/`scholarship` always return `info` — the why-note says a drawdown "won't trigger a warning," accurate. Unrecognized kind returns `null` from `balanceWhyNote()`, and the render site (`guided-budget-setup.tsx` line 344) skips the `<p>` entirely rather than rendering an empty one. All four cases check out against the source, independent of qa's audit.

## Intent-vs-Shipped Diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| New "Budgeting" guide section, 7 locked subsections, placed after Reports / before Reconciliation | All 7 subsections present verbatim in content and order; `guide/page.tsx` TOC array and JSX render list both show `reports → budgeting → reconciliation` | Matches |
| Inline "How budgeting works →" link on the Budgeting page, same-tab, reachable without a TOC round-trip | One shared link in `PageHeader`, `href="/admin/ledger/guide#budgeting"`, same-tab `<Link>`, no `target="_blank"` | Matches (implementer chose "one shared link" over "per fund-card," both were explicitly allowed as either/or in the Phase 1 outline) |
| Per-fund "why" one-liner under each fund's `balanceMessage()`, matching `computeBudgetBalanceStatus`'s real rule, omitted for unrecognized kind | `balanceWhyNote()` renders under the message for admin/activity/charitable/scholarship with the locked copy verbatim; returns `null` and renders nothing for any other kind | Matches |
| Compliance-deadline content: one cross-link only, no restated dates/forms | Section 7 is a single sentence + `<Link href="#compliance-990">`; anchor confirmed real by direct read of `compliance-calendar-section.tsx` line 28 | Matches |
| No new dollar figures baked into permanent-feeling prose (Gap note) | Confirmed by direct read: no `$100` in rendered prose, no "3-6"/"3–6" anywhere; "a few months" and "roughly a zero balance" used instead | Matches |
| Citations quoted verbatim, framed as "current as of" rather than permanently fixed (Open Question) | Both citations present verbatim with "citations as of current LCI governing documents" framing | Matches — but the *content* of that confirmation (are these still the operative citations right now) was never answered by a human; see Follow-ups |
| Same-tab navigation both directions (Open Question, recommended) | Both links (`Budgeting → Guide`, `Guide → Compliance`) are same-tab, no `target="_blank"` | Matches |
| Anchor-target verification flagged as the one build-time-checkable failure mode in Flow 2 | `id="budgeting"` in `budgeting-section.tsx` line 23 matches `href="#budgeting"` in `guide/page.tsx`; `id="compliance-990"` matches the guide-section's internal link | Matches — verified independently by me, not just re-trusting qa |
| Manual click-through owed (qa carried forward) | Not performed — sandbox has no `DATABASE_URL`, `pnpm dev` cannot come up | Acceptable drift — see Follow-ups |

## Edge Cases

- **Empty state:** not applicable. This is static content plus a link/annotation on an existing page with its own established empty states (unaffected by this change).
- **Failure microcopy:** pass. The guide section is a plain Server Component with no data fetch of its own, so it cannot introduce a new failure mode; the two pre-existing live reads on the guide page keep their existing fail-soft fallback (DECISION-037), untouched by this change.
- **Permission gate:** pass. Confirmed directly (not just via qa's report): `guide/page.tsx` still gates on `hasAnyFeature(..., [LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])`; `budgeting/page.tsx` still gates on `hasFeature(..., FEATURES.LEDGER_MANAGE)`. Neither gate was touched. Since `LEDGER_MANAGE` is a member of the guide's any-of list, anyone who can see the inline link can always reach its target — the Phase 1 "confirmed non-issue" holds.
- **Mobile:** pass, by inheritance. No new layout primitives were introduced; the guide section reuses the existing `max-w-4xl` single-column flow and the Budgeting page reuses its existing responsive grid. Not independently re-verified at 360px in this review (no dev server available), but the change is additive prose/links inside containers that are already mobile-tested elsewhere in the guide, so risk is low.
- **Brand consistency:** pass. `rounded-2xl` on the new section container, no `rounded-xl`; no new buttons (links only, correctly not `rounded-full`); no `lions-red`; `lions-gold` usage unchanged. `ConfirmDialog` not implicated — no destructive action was added by this feature.

## Follow-ups (SHIP WITH NOTES)

1. **Live click-through of the two navigation paths and the four fund why-notes, on a real dev server with `DATABASE_URL` set.** Every static check (matching `id`/`href` pairs, matching rule logic) lines up, and I independently re-verified the two anchor pairs and the four why-note cases myself rather than trusting the chain — so I judge this a low-risk, non-blocking follow-up rather than a ship blocker. This is presentational content with no write path, no schema, and no new permission logic; the failure mode a live click-through would catch (a scroll landing short, a CSS `scroll-margin-top` offset hiding the section under a sticky header) is a polish bug, not a correctness bug. Recommend the user or the next session with a working `.env.local` runs the 5-item list already written in Phase 4/5 before the next deploy, but it should not hold this work-log open.
2. **One-time confirmation that the two citations (Art. VII §3(g); Board Policy Ch. XV) are still the current, operative versions.** This was flagged as an open question in Phase 1 and never actually answered by a human — the shipped page states them with "as of current governing documents" framing, which is good defensive wording, but framing isn't the same as confirming. Low urgency (citations don't change often) but worth a one-time check by whoever holds the current LCI governing documents, logged back to this work-log or `docs/decisions.md` once done.

## Rationale for SHIP WITH NOTES (not SHIP IT, not NEEDS REWORK)

Every content and wiring claim I could verify by reading the shipped files directly — the two anchor-id/href pairs, all seven subsections against the locked outline, the four why-note strings against `computeBudgetBalanceStatus`'s actual branching, the unrecognized-kind fallthrough, the absence of hardcoded volatile figures, the unchanged permission gates — checks out with zero discrepancies. There is no regression, no invented content, no weakened gate, and no brand violation. The only gap is procedural, not substantive: nobody has clicked through it in a running browser, and one open question about citation currency was never closed out with a human answer. Both are exactly the kind of carry-forward that should become a tracked note rather than block a low-risk, static-content feature from shipping — reopening Phase 3/4 here would be pure overhead with no design or code to actually change.
