# Treasurer's Todo

A living checklist of book-keeping, compliance, and data-cleanup follow-ups for The Ledger.
Sourced initially from the 2026-07-20 review of the Quicken registers (07/2024–06/2026) during the
first real-books seed (see `docs/work-log/2026-07-20-ledger-quicken-seed.md`).

**How to use this file:** check items off as they're resolved — append the date and outcome to the
item rather than deleting it. Add new flags as they surface. Items carry stable IDs (`T-nn`) so they
can be referenced from work-logs, board minutes, and future sessions.

---

## Money & compliance

- [ ] **T-24 — Standing reference: accounting basis + Lions International financial-transparency standard.**
  (added 2026-07-28) **Books are kept on a modified-cash ("checkbook") basis** — transactions
  recorded when entered (checks when written, income when deposited/recorded), not full accrual and
  not strict clear-date cash. This is why book balance and bank balance differ by outstanding items
  (e.g. FY2025 Foundation: $14,425.28 book vs. $20,000.28 bank at 6/30/2025 = outstanding checks);
  the monthly statement shows book balance and footnotes the cash difference. **Lions International
  does NOT mandate a specific basis** — per *Best Practices for Financial Transparency*
  (LCI **DA-BPFT.EN 6/2024**, saved this session), the requirements are principle-based:
  the financial report must **balance to the bank statement**, all expenditures must be
  **board-approved and reflected in minutes**, income itemized by source (fundraisers itemized),
  and each report shows **opening balance → income → expenditures → ending balance per account**.
  Cash/modified-cash is the norm for clubs this size and satisfies the "balance to the bank"
  requirement most simply — keep it, but the club "should consult an accounting professional…
  compliant with local regulations and the district rules of audit" (LCI's own caveat).
  **How the app already meets the LCI standard:** the member Monthly Statement (`/members/financial-reports`)
  IS the LCI Financial Report shape (opening/income/expenditures/ending, per fund); the reconciliation
  workbench enforces "report balances to the bank"; `boardMinute` + budget approve/lock = board-approved
  expenditures; the two-entity/fund model = LCI's Public(activity) vs Administrative fund split.
  **Gap-check items to confirm against the LCI flyer (each may become its own T-nn):**
  (a) board receives a financial report **no less than monthly** — now aided by the member statements;
  (b) **two bank signatories from different households**, both signing checks where appropriate;
  (c) **annual audit/review** at treasurer transition or term-end (bank statement, minutes, event
  reports, receipts, year-end report that reconciles);
  (d) **treasurer bonded** (already a budget line — "Officer Bonding");
  (e) itemized fundraiser reports (money received + each expense, validated by attendance/tickets) —
  the statement is category-level today; per-event itemization is a possible enhancement.

- [ ] **T-01 — Foundation paid for member polo shirts.** Check #8221, 4/13/2025, $250, register
  category "Membership." 501(c)(3) public money spent on member apparel is a private-benefit
  problem. The club correctly bought polos from the admin account in May 2026 (#8019, $239.60), so
  the practice was already corrected — decide whether the 2025 purchase needs a board minute
  acknowledging the error or a reimbursement from admin to the Foundation.
- [ ] **T-02 — Two outstanding checks to Ohio Lions Foundation.** #8249 ($1,000) and #8257 ($200),
  both written 3/7/2026, still uncleared as of the 7/9/2026 register export (~4 months stale).
  Contact the payee; void and reissue if lost. Imported as `reconciled = false` in the Ledger.
  *2026-07-21 analysis: no replacement checks were ever issued (these are genuinely outstanding),
  and the wrong-address theory fits the evidence — the same-day #8258 to OLF Eye Care Fund ($1,000)
  cleared while these two to OLF general did not, and the prior year's identical trio (6/20/2025)
  all cleared. Likely a stale general-OLF remittance address. Action: get OLF's current address,
  stop payment on #8249/#8257, reissue, and record the void + reissue in the Ledger.*
- [ ] **T-03 — Clarify tailtwisting policy.** July 2024: $552 of tailtwisting was swept to the
  Foundation, memo calling it "the philanthropic account." Since then (~$2,000 over two years) every
  tailtwisting deposit stayed in admin with no further sweeps. Board should clarify: is tailtwisting
  admin income or charitable money? If charitable, there's a growing unswept balance, and the
  Ledger's "Tail-twisting" category should move from admin income to an activity/charitable flow.
- [ ] **T-04 — Public money deposited into the admin account.** Pancake Breakfast Square receipts
  ($97.50, 3/17/2025) and two donations ($40 Jeff Reschke 2/22/2025, $1 Winterfest 1/25/2025).
  Mapped to the club's activity fund in the Ledger, but the cash physically sits in admin checking.
  Going forward, deposit fundraiser/donation money to the Foundation account — the Ledger's
  direct-to-admin guardrail (v1.26.0) now warns on this pattern. *2026-07-20: this same $84.52 now
  also trips the club-side aged-public-fund WARN (oldest income 1/25/2025 > 365 days). Treasurer
  decision: keep the guardrail as-is (no de minimis floor, no club exemption) — clearing this item
  (forward $84.52 to the Foundation or spend on service) clears the warning naturally.*
  **Resolution plan (2026-07-21):** inform the board about the Activity Fund — what it is
  (publicly-raised money held club-side, per the reference note's pass-through policy) and its
  current balance (**$84.52**) — and obtain a **board motion to transfer the $84.52 to the
  Foundation account**. After the motion: write the club check / transfer, record it in the Ledger
  (club Activity Fund expense → Foundation Public donations income, both citing the minute), which
  zeroes the fund and clears both club-side guardrail warnings.
- [ ] **T-05 — Officer bonding: verify, transfer, and track renewals.** Both entities carry fidelity
  bonds at $187/yr: club via CNA Surety from admin (10/2024, 9/2025), Foundation via Western Surety
  from the Foundation account (3/2025, 2/2026). Western Surety is a CNA Surety company; two bonds for
  two legal entities is almost certainly intentional — the certificates will confirm. Incoming-treasurer
  steps:
  - [ ] Locate both bond certificates and confirm whether coverage is position-based ("Treasurer of…")
    or names the prior treasurer individually — if named, notify the surety to transfer to Chris Henson.
  - [ ] Check each bond's coverage limit against peak balances (Foundation swings to ~$45k around
    Rudolph Run season); raise with the board if the limit is materially below peak.
  - [ ] Renewal calendar: club/CNA invoice expected ~September 2026 (pay from admin); Foundation/
    Western Surety expected ~February 2027 (pay from Foundation).
  - [ ] Once verified current and correctly named, tick the "treasurer bonded" checkbox in the
    Ledger's settings so the compliance view reflects it.
- [ ] **T-19 — Storage unit: decide the right payer.** Westerville North Self Storage annual rent
  was paid by the Foundation twice ($794 7/22/2024, $948 5/29/2025, memo "for fundraising
  supplies") — both payments fell within FY2024–25, so FY2025–26 shows no storage expense at all.
  Treasurer reports the unit stores general club property, not just fundraising supplies → mixed
  use means the Foundation paying subsidizes the club (same direction as T-01).
  *2026-07-20 — treasurer paid this year's fee from the **club (admin) account**, per instinct that
  it's clearly a club expense, and sent a note to the former treasurers asking for their thoughts
  on the historical Foundation treatment ("My instinct was that this was clearly an Administrative
  Club Account expense… However it was logged under the Foundation in the 24-25 fiscal year. We
  made the payment for 24 and 25 both in the 24-25 fiscal year. Thoughts?").*
  *2026-07-21 — Jim (former treasurer) replied: the Foundation-payer history WAS deliberate — the
  unit was originally rented to store fundraising-event supplies (a Foundation purpose), and he
  believes most contents are still fundraising-related, with some non-fundraising items (e.g.
  marketing materials) mixed in. His suggestion: "review the usage, and if necessary divide the
  expense between the two accounts proportionately."*
  Remaining:
  - [ ] Inventory/eyeball the storage unit's contents and estimate the fundraising vs. club-use
    split (a rough percentage is fine — this doesn't need a spreadsheet).
  - [ ] Decide the split policy: if predominantly fundraising, the Foundation reimbursing the club
    a proportional share of this year's fee is the precise treatment (club already paid 100%,
    which is the compliance-safe direction — the club overpaying is always fine; the reverse isn't).
    If roughly 50/50 or unclear, keeping it 100% club-paid is simplest and defensible.
  - [ ] Record the chosen policy in board minutes; apply it at next year's renewal.
- [ ] **T-06 — One PO box or two?** USPS box rental paid from the Foundation ($256, 12/2024) and
  from admin ($268, 12/2025). If it's one box, pick the account that pays it consistently.

## Data cleanup

- [ ] **T-07 — Identify the PayPal account.** "Transfer from PayPal" +$563.80 (11/25/2025,
  uncategorized) implies a club PayPal account outside the transferred documents. What is it, what
  balance remains in it, and what were the underlying receipts? Parked in admin "Misc" income.
- [ ] **T-08 — Attribute the $2,344 lump dues deposit** (5/27/2025, no memo) to members if
  per-member dues tie-out is wanted for that year.
- [ ] **T-09 — Resolve two memo/category conflicts on large deposits:** 4/9/2025 $3,655 categorized
  Pancake Breakfast, memo "Rudolph Run Sponsorships"; 12/20/2025 $14,451.90 "Rudolph Run Entry
  Receipts," memo "Rudolph Run Sponsorships." Totals are unaffected; per-event reporting is.
- [ ] **T-10 — Categorize the catch-all rows.** 16 imported rows landed in Operations /
  Miscellaneous / Misc (itemized in the seed work-log), including two uncategorized 7/31/2024
  purchases (Costco $47.94, Home Depot $249) and a $50 gift card whose memo reads "Wrapped gift
  card for ????". The $10 "Test donation through Zeffy" (3/9/2026) is real money — decide whether
  it stays labeled a test.
- [ ] **T-11 — Re-record the two A J Westlund dues rows if they were real.** Two rows dated
  6/26/2026 ($60 + $75) were deleted as increment-6a test data during the seed. Their register
  dues ($216 family, 7/19/2025) did import. If the June 2026 rows were genuine FY-2027 dues
  recordings, re-enter them in the Ledger.
- [ ] **T-25 — Clean up the category catalog and make budget→transaction→report fully traceable.**
  (added 2026-07-29, from the FY2026 budget-meeting debrief) Review `ledger_categories` across both
  entities: dedupe/retire unused categories, reconcile inconsistent naming between the Club and
  Foundation, and confirm every active category is one the treasurer actually budgets and posts
  against. Goal is **full traceability** — each category (and, once cause breakdowns exist, each
  cause + line item) should trace cleanly from the budget through posted transactions to the fund
  report with nothing orphaned or double-counted. Directly supports **B-31** (the mailed printable
  budget must be traceable) and is the data-hygiene prerequisite that makes **B-30**'s explicit
  transaction→budget-line link trustworthy. Do this cleanup pass before or alongside B-30 so the
  link picker isn't offering stale/duplicate categories. **Concrete recommendations now written up in
  `docs/2026-07-29-budget-actuals-mapping-and-category-cleanup.md` §G** — Rudolph Run income split
  (race vs. sponsorships/donations), a specific miscategorization-flag table (incl. the $3,655 Rudolph
  sponsorship filed as Pancake Breakfast, and Wine-With-the-Lions costs filed as Marketing), retiring
  the near-dead Activity fund, the Misc/Miscellaneous naming, and `Meals`→`Meeting hospitality`.
- [ ] **T-26 — Post the two genuinely-missing FY2025 checks + fix one fund-misfiling.**
  (added 2026-07-29, **scoped down after bank reconciliation** — see
  `docs/2026-07-29-budget-actuals-mapping-and-category-cleanup.md` §F) Bank-CSV reconciliation by
  check number showed the ledger is **essentially complete** (76/81 Foundation + 22/23 Admin checks
  present; the bank's cleared-basis FY2025 totals tie to the treasurer's year-end to the penny — the
  earlier "~$4,375 under-posted" was a checkbook-vs-cleared **timing** artifact, not missing money).
  Status / to-dos:
  1. ✅ **DONE 2026-07-29 — checks 8252 & 8253 were NOT missing money.** The register showed both are
     $500 checks to **Gates At Eight** (the BMX org; memos "Sponsorship" / "Scholarships", written
     3/7/2026), and the ledger *already had* both — they were just missing their check numbers, which
     is why the check-# match flagged them. Backfilled `check_number` 8252 (Sponsorship) and 8253
     (Scholarships) onto the two existing 2026-03-07 Gates At Eight rows (metadata only, no new
     transactions). **All FY2025 Foundation checks now reconcile to the bank (0 unmatched).**
  2. ⏸ **Admin check 8002** ($53.98, Jane Enneking, "Bags to Benches / trash bags", cleared the Admin
     account 7/29/2025) is **already recorded** — filed under the **Activity** fund, not missing.
     Whether to re-file it to **Administrative** is entangled with **T-25** ("resolve the near-dead
     Activity fund" — this is that fund's only FY2025 txn) and needs an admin-category choice.
     **Deferred to the T-25 Activity-fund decision — do not move in isolation.**
  3. **(Lower priority) Line-match the non-check outflows** (ACH / debit card / billpay, ~$12k of
     Foundation activity) transaction-by-transaction — the account totals tie out, so this is
     verification, not a known gap.
  Source: `Chase2000_..._foundation.csv` / `Chase8338_..._admin.csv`, `WLCF/WLC June 2026 Monthly
  Report.pdf`, registers at `/Users/cshenso/Documents/Treasurer Transfer Documents 07-2024 to 06-2026`.
  Net: the ledger is **materially complete**; no missing money was found.

## Operational / next steps

- [x] **T-12 — Seed production.** ~~The import ran against the local DB only. When ready:
  `scripts/import-quicken-ledger.ts --apply` with the production `DATABASE_URL` (idempotent —
  deletes and re-inserts its own `[quicken-import]`-tagged rows).~~ — **2026-07-20 done:** ported
  from dev via `scripts/port-ledger-dev-to-prod.ts` (not a re-run of the CSV import — dev's
  already-hardened ledger data was copied over, remapped by natural key). 276 marker transactions,
  15 dev-only categories, both fund opening balances, and both bank-account renames landed in
  production; the 7 live dues-auto-post rows were left untouched. All verification numbers matched
  exactly (club $16,218.64, foundation $4,836.57, per-cause totals, 3 overhead categories). See
  `docs/work-log/2026-07-20-ledger-quicken-seed.md` Phase 4c for full detail. Also backfilled 14
  missing dues-ledger rows in the same session via `scripts/backfill-dues-ledger.ts` (see that
  same work-log entry) — production dues ledger total is now $2,501.00.
- [ ] **T-13 — Reconcile the 24 monthly bank-statement PDFs** (Jul 2025–Jun 2026, both accounts, in
  the transfer-documents folder) against the imported register; mark discrepancies here.
- [ ] **T-14 — Upload the Foundation's IRS determination letter** to the Ledger's filings surface
  (source PDF in the transfer-documents folder).
- [ ] **T-15 — Decide on scholarship fund accounting.** Historical books paid scholarships from the
  general Foundation pool, so the seed used a "Scholarships" charitable expense category and left
  the scholarship fund empty. If fund-level scholarship accounting is wanted, start posting new
  awards to the scholarship fund (and consider an opening transfer into it).
- [ ] **T-16 — Earmark multi-year commitments in board minutes.** The aged public-fund guardrail
  (v1.26.0) will WARN on the Foundation's balance because its oldest income exceeds the 365-day
  holding period. LCI guidance allows aged public funds when earmarked for specific projects —
  document any such earmarks in board minutes. (In-app earmark support is a tracked feature follow-up.)

- [ ] **T-18 — Structured check numbers in the Ledger.** *(In progress, 2026-07-21 — Bank
  Reconciliation inc1.)* Original framing below turned out to be wrong on inspection
  (DECISION-034): memo/party text almost never carries a check number, and the
  uncashed-checks list has never read memo text for detection (it detects via
  `paymentMethod='check'` + `flow='expense'` + `reconciled=false`; memo is only
  ever displayed). The real numbers are recoverable from the original Quicken
  register CSVs' "Check #" column. Schema (`check_number` text column + index)
  and the backfill script (`scripts/backfill-check-numbers.ts`) are built and
  dry-run verified against local dev: 101 of 105 check rows matched
  unambiguously; 4 are genuinely ambiguous (two same-day/same-amount/same-payee
  check pairs — see script output) and need manual resolution, not a guess.
  `--apply` has **not** been run yet — pending treasurer review of the dry-run
  output. Original (superseded) framing: ~~Check numbers from the register live
  in free-text memos (e.g. "Check #8249" context only in memo/party text). The
  Ledger dashboard's uncashed-checks list (2026-07-20 feature, DECISION-031)
  reads memo text in v1.~~

- [ ] **T-17 — Zeffy donations flow through the Activity Fund (plan revised 2026-07-21).**
  ~~Original plan: open a second Zeffy account so the club account backs the dues form and the
  Foundation account backs donation forms.~~ **2026-07-21 — treasurer decision: do NOT open a
  second Zeffy account.** Keep the single Zeffy account settling to the club (admin) bank account
  for everything. Instead, leverage the existing Activity Fund pass-through policy for donations:
  - Dues via Zeffy → admin income (unchanged, auto-post already does this).
  - **Donations via Zeffy → record as club Activity Fund (public) income**, then promptly sweep to
    the Foundation per the Activity Fund's clearing-account policy (reference note below: target
    balance $0, spend on service or sweep — never club operations). Recording them to the Activity
    Fund rather than admin income keeps the direct-to-admin guardrail quiet; the aged-public-fund
    guardrail still backstops any sweep that gets forgotten (>365 days).
  - Caveat to keep in view: money given through a club-side Zeffy form is legally a gift to the
    club, not the 501(c)(3) Foundation — donor tax-deductibility is only clean once funds are in
    the Foundation. Keep steering larger/deduction-sensitive donors to Foundation channels, and
    batch the sweeps often enough that donations don't sit club-side.
  - Remaining action: none structural — fold the "sweep Zeffy donations" habit into the monthly
    close (pairs with the T-04 board motion, which zeroes the current $84.52 the same way).

- [ ] **T-21 — Fix four rows mistagged `paymentMethod='check'`.** Found 2026-07-21 by the
  check-number backfill dry-run (`scripts/backfill-check-numbers.ts`, inc1 of
  `2026-07-21-bank-reconciliation`): the register's "Check #" column shows these aren't paper
  checks. Three are confirmed debit-card purchases (Check #="Card"): FSP Product Decorator
  −$2,225.00 (10/23/2025), OTC Brands −$208.32 (10/10/2025), Walmart −$226.77 (10/9/2025) — the
  script corrects these to `debit_card` when run with `--fix-payment-method`. One needs judgment:
  Don Niebling +$120.00 (1/10/2026) has Check #="DEP" (a deposit tagged as check — likely
  `paymentMethod` should be check-received or deposit, treasurer's call; the script reports it but
  won't auto-correct). Also pending from the same dry-run: 4 ambiguous check-number assignments
  (two same-day/same-amount/same-payee $500 check pairs to Gates At Eight — #8252/#8253 on
  3/7/2026 and #8029/#8030 on 7/28/2024; either assignment is defensible, just pick one).
  *2026-07-21 — backfill applied to the local DB with treasurer approval: 101 check numbers
  written, 3 debit-card rows corrected to `paymentMethod='debit_card'`. Remaining: (a) the Don
  Niebling $120 "DEP" row (treasurer judgment on correct payment method), (b) type the four Gates
  At Eight check numbers in by hand via the transaction form's new Check # field (treasurer chose
  manual assignment), (c) re-run the backfill against production when this ships (same script,
  production DATABASE_URL) or port via the dev→prod script.*

- [x] **T-23 — Public gift descriptions + Legion reclassification (both DBs).** — **2026-07-21
  done** (treasurer approved content row-by-row): 51 treasurer-curated public notes applied to
  local and production after the v1.31.0 deploy (scholarship schools confirmed — Arden=North,
  Emilie=Central, Imani=South, memos correct as-is; 2025 recipients generic; The Big Bus =
  mobile-classroom tutoring + school food-pantry drives; OSSBPTS = Ohio State School for the
  Blind; both $200 Ohio Lions gifts = sensory garden). Both $650 American Legion Post 171 checks
  (4/2025, 3/2026) reclassified Grant out → Fundraising event costs with matching cause (pancake
  breakfast venue rental, per treasurer + the books' own $250/$840 hall-rental precedent) —
  −$1,300 from giving totals. Apply script: idempotent, natural-key matched (kept in session
  scratchpad; regenerate from this entry if ever needed).

- [x] **T-22 — Mirror local book corrections to production.** — **2026-07-21 done** (treasurer
  approved): check-number backfill applied to production (100 script-matched rows + 1 direct
  update for check #8263/Arborfest, whose prod memo lacked the `[quicken-import]` marker so the
  matcher skipped it); 3 debit-card mistags corrected; the 7 Bags to Benches rows moved to the
  new non-giving "Program supplies" categories. Verified post-apply: 101 rows with check
  numbers, Arborfest = 8263, 7 rows in Program supplies (counts_as_giving = false), 5
  import-marked checks intentionally still blank (4 Gates At Eight + 1 Don Niebling — tracked
  in T-21). Production and local books now match on all of today's corrections — NOTHING further
  is owed to production for this item. (Historical record of what was mirrored on 2026-07-21:
  (1) check-number backfill via `scripts/backfill-check-numbers.ts --apply --fix-payment-method`
  against production — 101 check numbers written, 3 debit-card mistags corrected; (2) the 7 Bags
  to Benches supply-reimbursement rows — Jane Enneking, Howard Baum, Costco; $374.53 total,
  `beneficiary_cause ILIKE '%bag%'` — moved out of "Service projects" into a new non-giving
  "Program supplies" expense category created in both entities, `counts_as_giving = false`, per
  treasurer decision, since they were supply reimbursements, not gifts. Both verified live against
  production 2026-07-28.)
  Context: 2026-05-18 check #8263 to The City of Westerville ($400) was confirmed as the
  Autumn Arborfest 2026 sponsorship — already correctly memoed and counted under
  "Community & Civic"; no change needed.

- [ ] **T-20 — Minute the petty-cash opening adjustment.** 2026-07-21: $250 of petty cash on hand
  (origin predates the books / unknown) was brought onto the books as an opening-balance
  adjustment — club Administrative Fund opening raised $19,090.10 → $19,340.10 in production and
  dev, and a "Petty Cash" account (cash type, 1 signer) was added alongside Administrative
  Checking. Remaining: record one line in the next board minutes ("$250 petty cash on hand brought
  onto the books, opening-balance adjustment"); count the box and confirm it actually holds $250;
  going forward, record cash spent from the box as normal expenses against the Petty Cash account.
  NOTE for future sessions: `scripts/import-quicken-ledger.ts --apply` hard-codes the register-only
  opening ($19,090.10) and would clobber this adjustment if ever re-run — re-apply the +$250
  afterward (the port script is safe; it copies dev's live values).

## Reference notes (context, not action items)

- **Activity Fund policy: pass-through, target balance $0.** The club's Activity Fund exists to
  receive public money that physically arrives in club hands (event cash, Square receipts, checks
  written to the club, Zeffy while T-17 is unresolved). It may only be spent on public/service
  purposes — never club operations. Because the Foundation (501c3) does everything the Activity
  Fund does plus tax-deductibility and grant eligibility, the operating policy is: money landing
  in the Activity Fund is promptly either spent directly on service or swept to the Foundation —
  it is a clearing account, not a home. The Ledger's guardrails enforce the drift cases
  (direct-to-admin WARN for public money in the wrong fund; aged-public-fund WARN for loitering
  balances — see T-04's $84.52). Steer donors to the Foundation whenever possible so their gift
  is deductible.

- **Zeffy payouts land as Monday lump deposits.** Zeffy sweeps the prior week's payments into the
  bank account every Monday, so one bank-statement line covers several individual Ledger rows (dues
  auto-post records each member's payment separately, on the day they paid — keep it that way).
  Reconciliation practice: for each Monday deposit, sum the Zeffy-method Ledger transactions from
  the preceding week — Zeffy takes no fees (tips go to Zeffy directly), so the sum should equal the
  deposit exactly. A mismatch means a payment straddled the payout cutoff or was recorded with the
  wrong method. If manual matching gets tedious as volume grows, consider a "payout batch"
  reconciliation feature (enter the deposit, check off the rows it contains, totals must match).

- Fundraisers (Rudolph Run, Pancake Breakfast) run through the **Foundation** account, not the
  club's activity fund — the Ledger's category catalog was extended to match (Foundation income
  categories: Rudolph Run, Pancake Breakfast, Fundraising events).
- Source registers are **Quicken** exports (not QuickBooks). They live outside the repo at
  `~/Documents/Treasurer Transfer Documents 07-2024 to 06-2026/` and must not be committed
  (financial + member data).
- Register ending balances at import: Foundation $4,836.57, Club $16,218.64 — the Ledger reconciles
  to both exactly. Opening balances: club/admin $19,090.10 (6/30/2024), foundation/charitable
  $28,569.30 (carryover minus pre-window check #8022).
