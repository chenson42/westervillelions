# Treasurer's Todo

A living checklist of book-keeping, compliance, and data-cleanup follow-ups for The Ledger.
Sourced initially from the 2026-07-20 review of the Quicken registers (07/2024–06/2026) during the
first real-books seed (see `docs/work-log/2026-07-20-ledger-quicken-seed.md`).

**How to use this file:** check items off as they're resolved — append the date and outcome to the
item rather than deleting it. Add new flags as they surface. Items carry stable IDs (`T-nn`) so they
can be referenced from work-logs, board minutes, and future sessions.

---

## Money & compliance

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

- [ ] **T-18 — Structured check numbers in the Ledger.** Check numbers from the register live in
  free-text memos (e.g. "Check #8249" context only in memo/party text). The Ledger dashboard's
  uncashed-checks list (2026-07-20 feature, DECISION-031) reads memo text in v1. When check-writing
  volume or reconciliation friction warrants it, add a structured `check_number` column to
  `ledger_transactions`, backfill by parsing the imported memos, and surface it in the transaction
  form + uncashed-checks list. (Ruled out of scope for the dashboard v1 by the architect.)

- [ ] **T-17 — Split Zeffy across two accounts (transitional state as of 2026-07-20).** All Zeffy
  forms currently settle to the **club (admin) bank account** — a temporary arrangement so dues land
  correctly. Plan per treasurer: open a second Zeffy account so the club account backs the dues form
  and the Foundation account backs donation forms. Until the split is done, any *donation* received
  through Zeffy lands in the admin account and must be forwarded to the Foundation (the Ledger's
  direct-to-admin guardrail will flag these if recorded as admin income). After the split, verify
  each form's payout account and update the Zeffy links on the site if they change.

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
