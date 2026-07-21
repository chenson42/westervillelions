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
- [ ] **T-03 — Clarify tailtwisting policy.** July 2024: $552 of tailtwisting was swept to the
  Foundation, memo calling it "the philanthropic account." Since then (~$2,000 over two years) every
  tailtwisting deposit stayed in admin with no further sweeps. Board should clarify: is tailtwisting
  admin income or charitable money? If charitable, there's a growing unswept balance, and the
  Ledger's "Tail-twisting" category should move from admin income to an activity/charitable flow.
- [ ] **T-04 — Public money deposited into the admin account.** Pancake Breakfast Square receipts
  ($97.50, 3/17/2025) and two donations ($40 Jeff Reschke 2/22/2025, $1 Winterfest 1/25/2025).
  Mapped to the club's activity fund in the Ledger, but the cash physically sits in admin checking.
  Going forward, deposit fundraiser/donation money to the Foundation account — the Ledger's
  direct-to-admin guardrail (v1.26.0) now warns on this pattern.
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

- [ ] **T-12 — Seed production.** The import ran against the local DB only. When ready:
  `scripts/import-quicken-ledger.ts --apply` with the production `DATABASE_URL` (idempotent —
  deletes and re-inserts its own `[quicken-import]`-tagged rows).
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

- [ ] **T-17 — Split Zeffy across two accounts (transitional state as of 2026-07-20).** All Zeffy
  forms currently settle to the **club (admin) bank account** — a temporary arrangement so dues land
  correctly. Plan per treasurer: open a second Zeffy account so the club account backs the dues form
  and the Foundation account backs donation forms. Until the split is done, any *donation* received
  through Zeffy lands in the admin account and must be forwarded to the Foundation (the Ledger's
  direct-to-admin guardrail will flag these if recorded as admin income). After the split, verify
  each form's payout account and update the Zeffy links on the site if they change.

## Reference notes (context, not action items)

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
