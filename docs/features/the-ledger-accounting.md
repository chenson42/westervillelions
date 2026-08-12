# The Ledger — Back-Office Accounting (Implementation Spec)

> **Status:** Pre-pipeline implementation spec (input to the 6-phase pipeline, increment by increment).
> **Date:** 2026-06-24
> **Sources:** the `Westerville_Lions_Ledger.html` prototype (data model + compliance engine) and `Lions_Financial_Transparency.pdf` (authoritative club rules; the "rules engine" spec). See also `/donate` (Zeffy) and the shipped dues feature, which this builds on.
> **Caveat:** This encodes tax/compliance rules from the transparency doc and public IRS guidance. It is not legal/accounting advice; the Foundation's IRS determination letter and whoever files the 990 govern edge cases.
> **Historical:** This is the pre-implementation spec — several details evolved during the build (e.g. `flow='transfer'` dropped, `dueDate` replaced by `dueMonth`/`dueDay`, the `isGiving` keyword check dropped, `receipt_url` → opaque storage key). For what actually shipped, see DECISIONs 016–026 and the per-increment work-logs.

---

## 1. Overview

A back-office accounting system ("The Ledger") for the two Westerville Lions entities:

- **Westerville Lions Club** — 501(c)(4) social-welfare org. Donations NOT tax-deductible.
- **Westerville Lions Foundation** — 501(c)(3) public charity (the giving arm). Donations tax-deductible.

Each entity has its own bank account(s), EIN, fiscal year (Jul 1 – Jun 30), and federal return. The system records income/expense transactions against **funds**, enforces the Lions **two-fund firewall**, tracks a **compliance calendar** (federal + Ohio filings), computes the correct **990 form**, and feeds a member-facing **philanthropy/impact dashboard**. Everything is permission-gated; the portal is board-only initially with a one-setting flip to all members.

This is **cash-basis, single-entry with fund tagging** — appropriate for a club this size and sufficient for 990-N/EZ. Not double-entry. The dues feature is the architectural template (cents money, treasurer role, admin route group, idempotent migrations, pure-helper + server-query split, member-portal surface).

### Increments (each ships through the full pipeline)
1. **Books** — entities, bank accounts, funds, categories, transactions, **budgets**, fund reports (Budget / Actual / Variance), overview.
2. **Controls** — approvals workflow (record vs approve), the guardrails engine, bank reconciliation.
3. **Compliance** — filings calendar, `determine990`, retention + standing rules, Ohio items.
4. **Reports / 990-prep** — CSV export mapped to 990 lines; the per-report government-filing summary.
5. **Impact dashboard** — `/impact` board-gated, all-members toggle; giving-by-cause.
6. **Integrations** — dues → Admin-fund income; Zeffy → Activity/Charitable income + donor records + acknowledgment letters.

---

## 2. Fiscal-year convention (DECISION)

**Adopt the start-year convention already shipped in the dues feature:** `FY2026 = Jul 1 2026 – Jun 30 2027`. (The prototype used end-year, `FY2026 = Jul 2025 – Jun 2026`; we drop that — it conflicts with dues and would cause mis-filing.) The transparency doc's per-capita cycle (Jul 2026 → Jun 2027 = one Lions year) matches the start-year labeling.

**Refactor:** extract `getFiscalYear`, `currentFiscalYear`, `fiscalYearLabel` from `src/lib/dues.ts` into `src/lib/fiscal-year.ts` (single source of truth); re-export from `dues.ts` for back-compat. The Ledger imports from `@/lib/fiscal-year`. No change to dues behavior.

---

## 3. Permissions (FEATURES)

New keys in `src/lib/permissions.ts`, bound via an idempotent migration (existing role-seed pattern). Roles already exist: `admin`, `treasurer`, `board_member`, `member`. Admin auto-gets all features.

| Key | Constant | Roles | Gates |
|-----|----------|-------|-------|
| `ledger.view` | `LEDGER_VIEW` | admin, treasurer, board_member | All read surfaces (overview, ledger, reports, compliance, approvals list) |
| `ledger.record` | `LEDGER_RECORD` | admin, treasurer | Create/edit/delete transactions; reconcile; mark filings filed |
| `ledger.approve` | `LEDGER_APPROVE` | admin, board_member | Approve pending disbursements (segregation of duties — treasurer records, board approves) |
| `ledger.manage` | `LEDGER_MANAGE` | admin | Entities, bank accounts, funds, categories, budgets, settings |
| `impact.view` | `IMPACT_VIEW` | admin, treasurer, board_member | Philanthropy dashboard. Further gated by the `philanthropy_visibility` setting (`board` → only these roles; `members` → all signed-in members) |

Read routes: `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`. Writes: the specific key. Reuses `auth()` + `hasFeature` from `permissions-server` (the "Viewing as" selector in the prototype is dropped — gating is real session-based).

---

## 4. Data model (Drizzle, `src/lib/db/schema.ts`)

All money is **integer cents**. All tables get `createdAt`/`updatedAt` (`timestamp ... defaultNow()`), uuid pks (`uuid("id").primaryKey().defaultRandom()`). Migrations idempotent (`CREATE TABLE IF NOT EXISTS`, guarded seeds).

### 4.1 `ledger_entities`
- `slug` text unique notNull — `'club' | 'foundation'`
- `name` text notNull, `shortName` text
- `taxClassification` text notNull — `'501c4' | '501c3'`
- `charityStatus` text — `'public_charity' | 'private_foundation'` (foundation only; drives 990 vs **990-PF**)
- `ein` text, `ohioEntityNumber` text, `fiscalYearEnd` text default `'06-30'`
- `donationsDeductible` boolean notNull

### 4.2 `ledger_bank_accounts`
- `entityId` → entities (cascade)
- `name` text, `institution` text, `last4` text, `accountType` text (`checking|savings|investment`)
- `requiredSigners` integer default 2  *(board sets # of signers on a check)*
- `isActive` boolean default true
- Join `ledger_account_signers` (`accountId`, `userId` → users) — board-approved authorized signers.

### 4.3 `ledger_funds`
- `entityId` → entities (cascade)
- `slug` text — `'admin' | 'activity' | 'charitable' | 'scholarship'` (unique per entity)
- `name` text, `kind` text notNull — `'administrative' | 'activity' | 'charitable' | 'scholarship'`
- `openingBalanceCents` integer notNull default 0
- *Firewall + giving classification keys off `kind`.*

### 4.4 `ledger_categories`
- `entityId` → entities; `fundKind` text; `flow` text (`income|expense`); `name` text
- `form990Line` text (nullable — maps to a 990 line for prep); `sortOrder` integer; `isActive` boolean
- Seeded from the transparency doc (see §8).

### 4.5 `ledger_transactions`
- `entityId` → entities; `fundId` → funds; `bankAccountId` → bank_accounts (nullable)
- `txnDate` date notNull
- `flow` text notNull — `'income' | 'expense' | 'transfer'`
- `categoryId` → categories (nullable); `amountCents` integer notNull (positive; `flow` gives direction)
- `party` text — itemized source/payee (required for income; doc: "sources for all deposits itemized")
- `memo` text; `beneficiaryCause` text (nullable — for giving classification + dashboard; maps to existing causes)
- `status` text notNull default `'posted'` — `'posted' | 'pending'` (pending = awaiting board approval)
- `boardMinute` text (approval reference); `approvedByUserId` → users (nullable); `approvedAt` timestamp (nullable)
- `reconciled` boolean default false; `reconciledAt` timestamp (nullable)
- `transferFromFundId` → funds (nullable — set on transfer/cross-fund income; firewall detection)
- `paymentMethod` text (nullable — `check|cash|zeffy|other`; doc: disbursements by **check** only — cash-out warns)
- `receiptUrl` text (nullable — retention)
- `recordedByUserId` → users
- Indexes: `(entityId, fundId)`, `(fundId, txnDate)`, `(status)`

### 4.6 `ledger_budgets`
- `entityId`, `fundId` → funds; `fiscalYear` integer; `categoryId` → categories (nullable); `flow` text
- `annualAmountCents` integer notNull
- Unique `(fundId, fiscalYear, categoryId, flow)`. *Powers Budget/Actual/Variance reports (doc requires a budget per fund).*

### 4.7 `ledger_filings` (compliance calendar)
- `entityId` → entities (nullable); `title` text; `agency` text; `fiscalYear` integer
- `dueDate` date; `status` text — `'not_started' | 'in_progress' | 'filed' | 'future' | 'na'`
- `note` text; `confirmation` text (nullable); `filedOn` date (nullable); `recurrence` text (`annual|5_year`)

### 4.8 `ledger_settings` (singleton)
- `philanthropyVisibility` text default `'board'` — `'board' | 'members'`
- `treasurerBonded` boolean default false
- `reserveWarnThresholdCents` integer default `2500000` ($25k)
- `disbApprovalThresholdCents` integer default `25000` ($250 — board pre-authorizes fixed expenses below this)
- `retentionYears` integer default 7

### 4.9 Donors & acknowledgments (increment 6)
- `ledger_donors` — `name`, `email`, `address`, `memberId` → members (nullable)
- `ledger_acknowledgments` — `donationTxnId` → transactions, `donorId`, `amountCents`, `sentAt`, `letterUrl`, `quidProQuoValueCents` (nullable), `type` (`written_ack_250 | quid_pro_quo_75`)
- Drives the **$250 written acknowledgment** and **$75 quid-pro-quo disclosure** (Foundation/c3).

---

## 5. Pure helpers (`src/lib/ledger.ts`)

No DB; unit-tested like `dues.ts`.

- `fundBalanceCents(openingCents, postedTxns)` / `entityBalanceCents` / `fundPendingCents`
- `grossReceiptsCents(postedIncomeTxns)`
- `isGiving(txn, fundKind)` — fund kind ∈ {charitable, activity} AND category is a giving category (donation/grant/scholarship/vision/relief/screening)
- `totalGivingCents(...)`
- `determine990({ classification, charityStatus, grossReceiptsCents, assetsCents })` → `{ form, why }`
  - `private_foundation` → `990-PF` (any size, must e-file)
  - `grossReceipts ≤ $50k` → `990-N`
  - `grossReceipts < $200k AND assets < $500k` → `990-EZ`
  - else → `990`
- `budgetVariance(actualCents, budgetCents)` → `{ varianceCents, pct }`
- `guardrails(state)` → `Array<{ severity: 'ok'|'warn'|'high', title, detail, policyCite? }>` (see §7)

---

## 6. Server queries (`src/lib/ledger-queries.ts`) & API

### Queries (server components import these)
- `getEntities()`, `getEntity(slug)`, `getFunds(entityId)`, `getBankAccounts(entityId)`
- `listTransactions(entityId, { fundId?, fiscalYear?, status?, search? })`
- `getFundReport(fundId, fiscalYear)` → `{ openingCents, income[], expense[], endingCents, budgetByCategory, variance }`
- `getOverview(entityId, fiscalYear)` → fund balances, gross receipts, `determine990`, `guardrails`
- `getPendingApprovals()`, `listFilings(fiscalYear)`, `getSettings()`
- `getPhilanthropy(fiscalYear)` → giving by cause from **activity + charitable funds only** (never admin), totals + filing summary (for `/impact`)

### API routes (`src/app/api/admin/ledger/...`) — gate each
| Method · Path | Gate |
|---|---|
| `POST /transactions` · `PATCH·DELETE /transactions/[id]` | `LEDGER_RECORD` |
| `POST /transactions/[id]/approve` (pending→posted, set minute + approver) | `LEDGER_APPROVE` |
| `POST /transactions/[id]/reconcile` | `LEDGER_RECORD` |
| `PATCH /budgets` | `LEDGER_MANAGE` |
| `PATCH /filings/[id]` (status, confirmation, filedOn) | `LEDGER_RECORD` |
| `PATCH /settings`; entities/accounts/funds/categories CRUD | `LEDGER_MANAGE` |
| `GET /export?entity=&fy=` (CSV / 990-prep) | `LEDGER_VIEW` OR `REPORTS_EXPORT` |
| `GET /api/members/impact?fy=` (member dashboard data) | `IMPACT_VIEW` (+ visibility setting) |

Validate every input; never trust client. Parameterized Drizzle only.

---

## 7. Compliance rules engine (from the transparency doc)

`guardrails()` returns flags; the doc's language drives each:

1. **Two-fund firewall (HIGH).** *"Under no circumstances may the net income of club projects or activities raised from the public be used in any manner whatsoever for administrative expenditures."* Flag **any** Activity→Admin flow: transfers, **percentage allocations even if explicitly stated**, AND **interest** earned on activity money posted to admin. Detect via `transferFromFundId` (source kind activity, dest kind administrative) or income to an admin fund whose source is an activity fund.
2. **Unapproved disbursements (WARN).** Pending expenses > `disbApprovalThresholdCents` await board approval. Board authorizes all disbursements; may pre-authorize fixed expenses below the limit.
3. **Within fiscal year (WARN/BLOCK).** Board may only authorize payments/pledges within the current FY; no indebtedness or donations committed beyond it.
4. **Reserves (WARN).** Entity balance > `reserveWarnThresholdCents` threatens exempt status — require a documented carryover plan (note field).
5. **Unreconciled (WARN).** Posted txns not reconciled — monthly bank reconciliation so the audit ties out.
6. **Negative fund (HIGH).** Any fund balance < 0.
7. **Treasurer not bonded (WARN).** Bond, or add extra controls (multiple bank statements, spot checks).
8. **Itemized source (WARN).** Income missing `party`/source — deposits must be itemized.
9. **Cash disbursement (WARN).** Expense with method `cash` — disbursements should be by check on a club account.
10. **Filing status (WARN/HIGH).** Overdue/approaching filings; **3 consecutive missed 990s = automatic revocation** (HIGH).
11. **Retention (INFO).** Expenses missing receipts — retain records 7 years.

Standing reminders (static, surfaced on the compliance screen): raffle **50% to charity**, **no political endorsements**, **sales tax** on taxable fundraising products, gaming/games-of-chance rules, no "employment" issues (gift cards / waiving dues), social-media monitoring warning.

---

## 8. Seed data (idempotent migration)

- **Entities:** Westerville Lions Club (501c4, deductible=false) · Westerville Lions Foundation (501c3, public_charity, deductible=true). EINs / Ohio entity numbers / banks = **placeholders pending real values**.
- **Funds:** club → `administrative`, `activity`; foundation → `charitable`, `scholarship`. Opening balances from the latest treasurer's report.
- **Categories (from the doc):** Admin income — Club dues, Meals, Tail-twisting, Misc · Admin expense — Per-capita tax, Meals, Postage, Printing, Officer Training, Supplies · Activity income — Rudolph Run, White Cane, Pancake Breakfast, Public donations, Sponsorships, Interest · Activity expense — Event costs, Charitable donation out, Eyeglass recycling, Vision screening · Charitable income — Public donations, Grants received, Memorials, Interest · Charitable expense — Grant out, Charitable donation out, Disaster relief.
- **Filings (current FY):** IRS 990-N (club + foundation, due Nov 15) · Ohio AG Charitable Annual Report ×2 (Nov 15) · Ohio Unclaimed Funds ×2 (period ending Jun 30, due Nov 1, negative/NONE report ok) · Statement of Continued Existence (every 5 years, Ohio SoS) · Annual Treasurer's Audit ×2.
- **Settings:** visibility `board`, reserve $25k, disb threshold $250, retention 7, bonded = TBD.
- **Per-capita:** recurring Admin expense — $25 LCI + $10.50 District, semi-annual (Jul/Jan) = $71/member/yr. Note Family (½ after first), Life (none), Student (½/none), Leo (½) per-capita discounts.

---

## 9. Integration with existing features

- **Dues → Admin-fund income.** A recorded dues payment posts a Club/Administrative income transaction (category "Club dues", party = member). The dues feature is effectively the Admin-fund income side; the **family vs individual** rate mirrors the **family ½ per-capita** discount in the doc. (Auto-post on dues create, or batch import — decision below.)
- **Zeffy / `/donate` → Activity or Charitable income + donor record + acknowledgment.** Club fundraisers (Rudolph Run "Race registrations (Zeffy)") → Activity fund; Foundation appeals → Charitable fund. Donations ≥ $250 trigger a written acknowledgment; quid-pro-quo > $75 a disclosure.
- **Causes/Campaigns.** `beneficiaryCause` maps to the existing causes taxonomy → powers the `/impact` by-cause breakout.

---

## 10. Open decisions (confirm before increment 1)

1. **Fiscal-year convention** — adopt start-year (matches dues). *(Recommended; see §2.)*
2. **Real entity facts** — EINs, Ohio entity numbers, bank names/last-4, and the **Foundation's IRS determination letter** (public charity vs private foundation → 990 vs 990-PF).
3. **Book of record?** — is The Ledger authoritative, or does QuickBooks/Wave remain the source and this is a portal view? (Affects how hard reconciliation/audit is enforced.)
4. **Accounting depth** — cash-basis single-entry w/ fund tagging *(recommended)* vs full double-entry.
5. **Receipt attachments** — storage approach (existing `public/uploads` vs external object store) for 7-yr retention.
6. **Dues/Zeffy auto-post** — automatically post to the ledger, or manual entry with import?
7. **Opening balances** — source the real fund opening balances for the current FY.

---

## 11. Mapping to the prototype (so naming stays consistent)

`S.entities`→`ledger_entities` · `S.funds`→`ledger_funds` · `S.txns`→`ledger_transactions` · `S.filings`→`ledger_filings` · `S.settings`→`ledger_settings` · `S.cats`→`ledger_categories` · `PERMS`/`can()`→`FEATURES`/`hasFeature()` · `determine990()`/`guardrails()`/`fundBalance()`→`src/lib/ledger.ts` · localStorage `Store`→Postgres. Floats→cents; "Viewing as"→real auth.
