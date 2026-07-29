# FY2025 Budget → Actuals Mapping & Category Cleanup Analysis

> **Generated:** 2026-07-29 · **For later use** planning B-29 (budgeting restructure),
> B-30 (transaction→budget-line link), B-31 (mailed printable budget), T-25 (category cleanup).
> **Do not treat as a decision** — this is analysis + recommendations for the treasurer to review.

## Sources

- **Budget:** `2025-2026 Approved Budget.pdf` — the club's spreadsheet budget, two funds
  (Administrative / Club, and Philanthropic / Foundation). Columns: *Adopted 2024-2025 Budget*,
  *2024-2025 Actual*, **Proposed 2025-2026 Budget** (the approved figure we map from). In Lions FY
  labeling, "2025-2026" = **FY2025** (Jul 2025 – Jun 2026).
- **Actuals:** `ledger_transactions`, **posted**, `txn_date` 2025-07-01 … 2026-06-30, grouped by
  fund / category / `beneficiary_cause` / `party`.
- **Target structure:** the B-29 model — **Fund → Income/Expense → Category → Cause → Line item**,
  where a line item's `label` ≈ a transaction's `party`, and a cause ≈ `beneficiary_cause`.
- **Original source registers** (for deeper reconciliation, outside the repo, not committed):
  `/Users/cshenso/Documents/Treasurer Transfer Documents 07-2024 to 06-2026` (Quicken exports).

> **Caveat on the "no FY2025 actual" gaps.** This analysis reads *posted* ledger transactions.
> A budget line showing no actual may be genuinely unspent **or** simply not-yet-posted to the
> ledger (the source registers above are the ground truth). Notably: Club **dues** ($2,082 posted
> vs. $5,655 budgeted) and Foundation **Pancake Breakfast** income look under-posted, and the
> **Storage Unit** expense ($2,200 budgeted, $0 posted) is almost certainly a ledger-completeness
> gap, not a real non-payment. Before treating any "no actual" line as unspent, cross-check the
> source registers. (Offer stands to reconcile specific gaps against them.)

---

## Headline findings

1. **The budget's flat beneficiary list IS the line-item grain — the new structure fits the real
   data almost perfectly.** Every Foundation expense budget line (Camp Echoing Hills, Pilot Dogs,
   Buckeye Boys State, HS Scholarships…) is a **beneficiary**, i.e. a **line item** under a
   **category** (*Charitable donation out*, *Grant out*, *Scholarships*) and a **cause**. FY2025
   actuals already carry that `(category, cause, party)` triple, so the mapping is direct.

2. **Naming drift between budget labels and actual payees is pervasive — this is the strongest
   possible evidence for B-30 (explicit link).** Nearly every reconciled line has a *different*
   string on the budget vs. the check: "Caring and Sharing" → *Westerville Caring and Sharing*;
   "Ohio Lions Eye Research Fund" → *…Foundation*; "Ohio School for the Blind" → *OSSBPTS
   Foundation*; "Student VOSH" → *VOSH/Ohio*; "WARM" → *Westerville Area Resource Ministry*. A
   label==party string match would **fail on the majority of lines**. B-30's explicit
   `budget_line_id` is not a nicety — the books are not reconcilable without it.

3. **RESOLVED (Chris, 2026-07-29): decouple "breakdown-eligible" from "counts as giving."** The two
   biggest itemized expense buckets in the actuals are **non-giving**: *Fundraising event costs* (14
   Rudolph Run vendor payments, **$10,842**) and *Storage/Operations*. Chris's rule: **Rudolph
   expenses should be itemized by cause/line; Storage should not** (lump-sum). But today one flag,
   `countsAsGiving`, drives *both* cause-eligibility (`isCauseEligibleCategory`) *and* `/members/impact`
   giving reporting (`bucketGivingByCause`) — so you can't make Rudolph itemizable without wrongly
   counting event costs as philanthropic giving. **Fix: decouple** — a separate "supports cause/line
   breakdown" concept from "counts as giving." Then Rudolph = breakdown-eligible + not-giving,
   Storage = neither, Charitable donation out/Grant out/Scholarships = both. Captured as **B-33**;
   does not disturb the B-29 model (line items still live only under causes) or B-29's in-flight
   design. **Cause for Rudolph event costs — DECIDED (Chris, 2026-07-29):** reinstate a dedicated
   **"Fundraising / Event Costs"** cause (not Community & Civic — that would pollute a real
   beneficiary cause and muddy impact reporting).

4. **Same beneficiary, inconsistent cause** — needs a canonical cause per payee. *Ohio Lions
   Foundation* is tagged **both** Lions International Programs ($1,000) **and** Vision & Eye Care
   ($200). *WARM* receives money under **two categories** (*Charitable donation out* $2,000 **and**
   *Grant out* $2,500). *Pilot Dogs* is under Vision & Eye Care (arguably Health & Disability).

5. **The category catalog has real cleanup debt (T-25):** a near-dead **Club Activity fund**, a
   **"Fundraising event costs" cause that isn't a real cause**, several **zero-use categories**, and
   **budget lines with no ledger category** (4th of July Parade, Awards, Contingency, Lion L
   support, Membership). Details in the T-25 section.

6. **Bank reconciliation shows the ledger is essentially complete — the earlier "under-posted" alarm
   was wrong (§F).** Matching the two Chase CSVs by **check number**: **76 of 81** Foundation checks
   and **22 of 23** Admin checks are already posted, and the bank's **cleared-basis** FY2025 totals
   tie to the treasurer's year-end **to the penny** (Foundation expense $41,775.87 ≈ $41,775.86). The
   ledger-vs-year-end gap is almost entirely a **checkbook-date vs. bank-cleared-date timing**
   difference, **not missing money**. After verifying against the source register, **no money was
   missing at all**: the two flagged Foundation checks (8252/8253, **Gates At Eight = BMX**) were
   already posted and just needed their check numbers backfilled (done 2026-07-29 → 0 unmatched), and
   Admin check 8002 ($53.98) is recorded but filed to the Activity fund (fund question deferred to
   T-25). Non-check outflows still to be line-matched, but totals tie out. *(This supersedes both the
   initial ledger-only read and the interim "2 missing checks" read; see §F.)*

---

## A. Foundation (Charitable/Philanthropic) — expense mapping

Budget line (Proposed 2025-26) → **new structure** → FY2025 actual. ✓ = reconciles; ⚠ = issue.

| Budget line (amt) | Category | Cause | Line-item label (→ actual party) | FY25 actual | Note |
|---|---|---|---|---|---|
| Camp Echoing Hills ($750) | Charitable donation out | Health & Disability | Camp Echoing Hills *(→ Camp Echoing Hills Campership)* | $750 | ✓ label drift |
| Caring and Sharing ($1,000) | Charitable donation out | Hunger & Basic Needs | *(→ Westerville Caring and Sharing)* | $1,000 | ✓ label drift |
| Central Ohio Diabetes Assoc. ($125) | Charitable donation out | Health & Disability | *(→ Central Ohio Diabetes Association)* | $125 | ✓ Assoc./Association |
| Central Ohio Lions Eye Bank ($1,000) | Charitable donation out | Vision & Eye Care | Central Ohio Lions Eye Bank | $1,000 | ✓ |
| Foundation Fighting Blindness ($1,000) | Charitable donation out | Vision & Eye Care | Foundation Fighting Blindness | $1,000 | ✓ |
| Lions Club International Foundation ($1,000) | Charitable donation out | Lions International Programs | *(→ Lions Clubs International Foundation)* | $1,000 | ✓ |
| Ohio Lions Eye Research Fund ($750) | Charitable donation out | Vision & Eye Care | *(→ Ohio Lions Eye Research Foundation)* | $750 | ✓ Fund/Foundation |
| Ohio Lions Foundation ($1,000) | Charitable donation out | **Lions Intl Programs** *(pick one)* | Ohio Lions Foundation | $1,000 (LIP) **+ $200 (Vision)** | ⚠ same payee, two causes |
| Ohio Lions Pediatric Cancer foundation ($1,000) | Charitable donation out | Health & Disability | *(→ Ohio Lions Pediatric Cancer Foundation)* | $1,000 | ✓ |
| Ohio School for the Blind ($500) | Charitable donation out | Vision & Eye Care | *(→ OSSBPTS Foundation)* | $500 | ⚠ heavy label drift |
| OLF Eye Care Fund ($1,000) | Charitable donation out | Vision & Eye Care | OLF Eye Care Fund | $1,000 | ✓ |
| Pilot Dogs ($1,000) | Charitable donation out | Vision & Eye Care *(or Health & Disability?)* | *(→ Pilot Dogs, Inc.)* | $1,000 | ✓ cause debatable |
| Student VOSH ($500) | Charitable donation out | Vision & Eye Care | *(→ VOSH/Ohio)* | $500 | ✓ label drift |
| Big Bus ($500) | Charitable donation out | Hunger & Basic Needs | *(→ The Big Bus)* | $500 | ✓ |
| WARM ($1,000) | Charitable donation out | Hunger & Basic Needs | *(→ Westerville Area Resource Ministry)* | **$2,000 donation + $2,500 grant** | ⚠ split across 2 categories; budget also lists Caring & Sharing separately |
| Westerville Special Olympics ($500) | Charitable donation out | Health & Disability | Westerville Special Olympics | $500 | ✓ |
| HS Scholarships ($7,500) | **Scholarships** | Youth & Education | *(→ 3 students: Arden Heckman, Emilie Clark, Imani Akita)* | 3 × $2,500 = $7,500 | ✓ 1 budget line = 3 named line items — decide: keep names or roll to one "HS Scholarships" line |
| Special Interest Grants ($4,500) | **Grant out** | mixed | *(→ Heritage Middle School PTSA $500, WARM $2,500, City of Westerville $400)* | $3,400 posted | ✓ 1 budget line = several grantee line items (Grant out) |
| Rudolph Run & Winterfest — expense ($10,000) | **Fundraising event costs** | *(none — not giving)* | 14 vendors *(Rising Moon, FSP, Rent-A-John…)* | $10,842 | ⚠ real line-item detail on a **non-cause** category — see finding #3 |
| Benches ($200) | Program supplies | Bags to Benches (Recycling) | *(→ Howard Baum, 3 txns)* | $146.38 | ⚠ *Program supplies* is `countsAsGiving=false` yet rows carry a cause; party is a person (reimbursement), not a beneficiary |
| Officer Bonding ($187) | Insurance & bonding | *(none — admin)* | *(→ Western Surety)* | $187 | ✓ not a giving line |
| BMX races ($500) | *(propose: Charitable donation out)* | Youth & Education | BMX races | — | ⚠ budgeted, no FY25 actual |
| BMX Sponsorship ($500) | Charitable donation out | Youth & Education | BMX Sponsorship | — | ⚠ no actual |
| Buckeye Boys State ($300) | Charitable donation out | Youth & Education | Buckeye Boys State | — | ⚠ no actual |
| Buckeye Girls State ($350) | Charitable donation out | Youth & Education | Buckeye Girls State | — | ⚠ no actual |
| Lions Sensory Garden ($200) | Service projects | **Environment** *(new cause)* / Community & Civic | Lions Sensory Garden | — | ⚠ no actual; candidate for the new Environment cause |
| Local Eye Care Assistance ($500) | Charitable donation out | Vision & Eye Care | Local Eye Care Assistance | — | ⚠ no actual |
| Newsreel ($0) | Charitable donation out | Vision & Eye Care | Ohio Lions Newsreel | — | $0 budget |
| Leo scholarship ($0) | Scholarships | Youth & Education | Leo scholarship | — | $0 budget |
| Westerville HS Sports Teams ($500) | Charitable donation out | Youth & Education | Westerville HS Sports Teams | — | ⚠ no actual |
| Storage Unit ($2,200) | **Operations** | *(none)* | Storage unit rent | — | ✓ **genuinely $0** — the year-end report confirms Storage Unit was not paid in FY2025 (corrected; see §F) |
| Pancake Breakfast — expense ($1,500) | Event costs / Fundraising event costs | *(none)* | Pancake Breakfast | — | ⚠ no clear FY25 expense actual |
| Miscellaneous ($500) | *(misc)* | — | — | — | catch-all |

**Unbudgeted actuals** (spent, but no matching budget line): *Gates At Eight* ($1,000, Youth &
Education) and *Qdoba* ($500, Youth & Education) under Charitable donation out; *The City of
Westerville* $400 grant (the Arbor Fest line just added, Community & Civic). These need a home in
next year's budget structure.

## B. Foundation — income mapping

| Budget line (amt) | Category | FY25 actual | Note |
|---|---|---|---|
| Rudolph Run & Winterfest ($27,000) | Rudolph Run | $25,190.63 (25 txns) | ✓ |
| Donations ($100) | Public donations | $121.52 | ✓ |
| Pancake Breakfast ($4,000) | Pancake Breakfast | — (no posted FY25 income) | ⚠ unposted? |
| White Cane ($1,000) | *(no Foundation category)* | — | ⚠ White Cane exists only on the Club side |
| Restaurant fundraisers ($300) | *(no category)* | — | ⚠ no category |
| Miscellaneous ($100) | *(no category)* | — | — |
| *(unbudgeted)* | Grants received | $2,500 | actual w/o budget line |

## C. Club (Administrative) — mapping

The ledger **consolidated** several PDF budget lines, so admin is *not* 1:1. Key reconciliations:

| PDF budget line(s) | Ledger category | FY25 actual |
|---|---|---|
| District dues + International dues + Intl new member fee + Convention Support | **Per-capita tax** ($3,509) + **District & convention** ($250) | ✓ (merged) |
| Website hosting | Web hosting | $645 |
| Meeting hospitality | Meals | $719 |
| Marketing | Marketing | $843 |
| Post office box | Postage | $268 |
| Officer Bonding | Insurance & bonding | $187 |
| Miscellaneous | Miscellaneous | $1,058 |
| Tail Twisting for 501c3 | *(should be Donations to Foundation)* | — (no FY25) |
| **4th of July Parade, Awards, Contingency, Lion L support, Membership, Office supplies** | **no ledger category / zero-use** | — |
| Dues ($5,655) / New Member Fee | Club dues (income) | $2,082 (17 txns — likely more unposted) |
| Tail Twisting raffle + non-raffle | Tail-twisting | $944 |

---

## D. Category cleanup recommendations (T-25)

1. **Resolve the near-dead Club "Activity Fund."** The PDF has only two funds (Admin + Philanthropic).
   The ledger has a third — Club **Activity Fund** — with a full parallel category set (*Charitable
   donation out, Event costs, Eyeglass recycling, Service projects, Vision screening, Rudolph Run,
   Sponsorships, White Cane…*) that is **almost entirely unused** (1 posted FY25 txn, $53.98). Decide:
   retire it, or define what belongs there vs. the Foundation Charitable fund. Right now it's
   confusing dead structure.
2. **"Fundraising event costs" is a category whose `cause` value is itself "Fundraising event
   costs" — not a real cause.** It's `countsAsGiving=false` (correctly not giving), but its 14 rows
   are tagged with a pseudo-cause that isn't in `BUDGET_CAUSES`. Either stop tagging non-giving rows
   with a cause, or formalize how event-cost line items are represented (ties to finding #3).
3. **Canonical cause per beneficiary.** Fix the split tags: *Ohio Lions Foundation* (Lions Intl vs
   Vision), *WARM* (one payee, two categories), *Pilot Dogs* (Vision vs Health). Pick one and apply
   consistently so impact-by-cause reporting is trustworthy.
4. **Zero-use categories — retire or mark intentional:** Club Activity (nearly all), Club admin
   *Officer Training, Operations, Printing, Supplies, Meals-income*, Foundation *Service projects,
   Interest, Memorials*. Some may be deliberate budget placeholders — confirm, don't blind-delete.
5. **Budget lines with no ledger category** (4th of July Parade, Awards, Contingency, Lion L
   support, Membership, New Member Fee, Restaurant fundraisers, Foundation White Cane): to make
   budget-vs-actual work, every budgeted line needs a category (or the budget line is retired).
6. **Naming consistency:** align category names and the `party`/label strings the treasurer actually
   uses (the drift table above). This is the manual-review data-hygiene pass T-25 exists for, and it
   should run **before** B-30's link picker offers stale/duplicate names.
7. **`countsAsGiving` audit:** e.g. *Program supplies* (false) carries cause-tagged giving rows
   (Bags to Benches); *Eyeglass recycling* (true) has no activity. Re-derive the flag from what each
   category actually holds.

---

## E. Design implications to feed back into B-29 / B-30 / B-31

- **B-29 model gap (finding #3):** non-giving expense categories (*Fundraising event costs*,
  *Storage/Operations*) have real, board-relevant line-item detail (vendors, rent) but the current
  model forbids line items without a cause. **Reopen with the treasurer:** allow line items under a
  non-cause category (the withdrawn idea), *or* accept these stay lump-sum. The Rudolph Run vendor
  list ($10.8k across 14 payees) is the concrete case.
- **B-30 is validated (finding #2):** the label↔party drift is so pervasive that reconciliation
  *must* be an explicit link, not a string match. This analysis is the justification.
- **B-31 (mailed budget):** the compact per-cause layout you chose maps cleanly onto Section A —
  category → cause subtotal → beneficiary lines. Scholarships (1 budget line → 3 named students) and
  Grant out / Special Interest Grants (1 line → many grantees) are the cases where "one budget line
  vs. many actual line items" must be presented deliberately.
- **HS Scholarships labeling:** decide once whether named students appear as line items (traceable,
  but PII on a mailed doc) or roll up to one "HS Scholarships" line. The 2026-07 seed script chose
  to drop student names to a generic line — worth confirming that's still the intent for the mailed
  version.

---

## F. Reconciliation vs. the last treasurer's June 2026 year-end reports

Added 2026-07-29 from `WLCF June 2026 Monthly Report.pdf` and `WLC June 2026 Monthly Report.pdf`
(Statements of Financial Condition, **Twelve Months Ended 6/30/26** = FY2025 authoritative actuals).
These reports are **bank-cleared basis** ("not included until posted by the bank") and are the last
treasurer's official year-end numbers.

### Foundation — corrected by bank reconciliation (2026-07-29): the ledger is essentially complete

An initial ledger-vs-year-end read suggested a ~$4,375 Foundation under-posting. **The Chase bank
CSVs correct that.** Matching by **check number**, **76 of 81** Foundation checks and **22 of 23**
Admin checks are already in the ledger, and the bank's **cleared-basis** FY2025 totals reconcile to
the year-end report **to the penny**:

| Account | Bank cleared (FY2025, by post date) | Treasurer year-end | Match |
|---|---|---|---|
| Foundation expense | $41,775.87 | $41,775.86 | ✓ |
| Foundation revenue | $27,812.16 | $27,812.15 | ✓ |
| Admin expense | $7,852.61 | $7,852.61 | ✓ |

So the year-end report **is** the bank-cleared basis. The ledger is on a **checkbook (written-date)
basis** (per T-24), so the ledger-vs-year-end gaps ($37,400.86 vs $41,775.87 charitable; $7,478.83
vs $7,852.61 admin) are overwhelmingly a **timing/basis difference** for checks straddling the 6/30
boundary — **not missing money**. The "posted at half" and "6 missing lines" from the initial read
were checks that ARE in the ledger, dated in a different FY window or attributed to a different party
than the year-end label.

**Genuinely unaccounted in the ledger** — turned out to be essentially nothing:
- Foundation checks **8252/8253** — **RESOLVED 2026-07-29, no missing money.** The register shows
  both are $500 checks to **Gates At Eight** (= the **BMX** org, confirmed by Chris; memos
  "Sponsorship" / "Scholarships", written 3/7/2026). The ledger *already had* both — they simply
  lacked their check numbers, which is what tripped the check-# match. Backfilled `check_number`
  8252 (Sponsorship) / 8253 (Scholarships) onto the two existing rows (metadata only). **All FY2025
  Foundation checks now reconcile — 0 unmatched.** Note: payee "Gates At Eight" vs. the budget's
  "BMX Race Scholarships / BMX Sponsorship" is a textbook label↔party drift case for **B-30**.
- Admin check **8002** ($53.98, Jane Enneking, "Bags to Benches / trash bags") is already recorded
  under the **Activity fund** — not missing. Whether it belongs in Administrative is deferred to the
  **T-25** Activity-fund decision (see T-26).
- **Not yet line-matched:** non-check outflows (ACH, debit card, billpay) — roughly $12k of
  Foundation activity in the file. The account totals tie out, so they're likely captured, but they
  have not been reconciled transaction-by-transaction.
- Checks 8029/8030 ($500 each, 7/31/2024) are FY2024/pre-window; 8022 is the pre-window check already
  baked into the opening balance — none are FY2025 gaps.

### Club (Administrative) — reconciles within categorization + timing differences

- **Per-capita tax** (ledger $3,508.86) = **District Dues + International Dues + Intl New Member Fee**
  (treasurer $1,008 + $2,430.86 + $70 = $3,508.86) — exact. The ledger consolidated three PDF lines
  into one; the mailed budget should decide which grain to show.
- Website hosting $645, Officer Bonding $187, Post Office Box $268 all tie out. Meeting Hospitality
  ($724.20) ≈ ledger Meals ($719.20). Marketing and Misc differ by small timing amounts (e.g. the
  June "Fourth Friday space rental" $319.80).
- **June dues $696 are FY2027 payments** received early (per the treasurer's own annotation) — a
  reminder that the fiscal-year cutoff needs care when reconciling.

### Corrections to earlier sections of this report

- **Storage Unit:** genuinely **$0** in FY2025 (year-end confirms) — *not* miscategorized as first
  guessed. Corrected in §A.
- The §A "no FY2025 actual" lines are **not** all ledger-missing (bank recon corrects this): only
  **BMX (checks 8252/8253, $1,000)** is genuinely absent. The others' checks are in the ledger,
  dated in a different FY window (checkbook vs. cleared) or attributed to a different party than the
  year-end label — a categorization/timing difference, not missing money.
- Minor **budget-version drift** between the PDF "Proposed 2025-2026" and the year-end "Annual
  Budget" columns (e.g. Special Interest Grants $4,500 vs $4,000; The Big Bus $500 vs $1,000) — use
  the year-end "Annual Budget" as the adopted figure of record.

---

## G. Category consistency, miscategorization flags & consolidation/split recommendations (T-25)

Added 2026-07-29 from transaction-level review. Recommendations for the treasurer — not applied.

### G1. Rudolph Run income: separating "the race" from "donations" (Chris's ask)

Today **one** category (`Rudolph Run`, Foundation income) holds three genuinely different revenue
types, only distinguishable by eyeballing `party`/memo:
- **Sponsorships / donations** — the bulk: named businesses & individuals at $250–$1,000 (Stone
  Environmental, M/I Homes, Nichols & Co., Schneider's Bakery, Central College Presbyterian…), plus
  lump "Rudolph Run Sponsorships" deposits.
- **Race entry fees** — e.g. the "Rudolph Run Entry Receipts" lump (the run itself) and "Square
  deposit" day-of sales.
- Occasional one-offs.

**Recommendation — split the income category** so the financial statement shows the split directly:
- `Rudolph Run – Registration / Entry Fees` (the race itself)
- `Rudolph Run – Sponsorships & Donations` (sponsor and donor money)
- *(optional)* `Rudolph Run – Day-of / Merchandise` (Square, sales)

The sponsors are already individually named in `party`, so if income later gets a line-item/label
grain (a natural sibling to **B-30** on the expense side), each sponsor becomes a line under
"Sponsorships & Donations" — but the **two-category split alone** answers the race-vs-donations
question now, with no new mechanism.

### G2. Likely-miscategorized transactions to review (specific, actionable)

| Txn | Currently | Should likely be | Why |
|---|---|---|---|
| 2025-04-09 **$3,655.00** "Rudolph Run Sponsorships" | **Pancake Breakfast** income (Foundation) | **UNRESOLVED — verify** | Memo says Rudolph Run, but the **April timing fits Pancake Breakfast** (Chris). Genuine memo-vs-category conflict (**T-09**) — resolve from the deposit detail; do **not** assume it's miscategorized. |
| 2025-12-10 $5.00 Miriam Reinhoudt "Meeting hospitality" | **Marketing** (admin) | **Meals / Meeting hospitality** | Memo is meeting hospitality (minor) |
| 2024-07-08 $552.00 "Tailtwisting funds transfer from club" | **Public donations** (Foundation) | **Inter-fund transfer** (not public donation) | It's a club→foundation transfer; inflates "public donations" |
| 2026-03-09 $10.00 "Test donation through Zeffy" | **Public donations** (Foundation) | Remove / reclassify | Test data (also T-10) |
| Bags-to-Benches $53.98 (Jane Enneking) | **Activity** fund | **Administrative** (cleared admin acct) | See T-26 #2 / T-25 |
| Ohio Lions Foundation $1,000 (LIP) **and** $200 (Vision) | two causes | one canonical cause | Same payee split across causes |
| Admin "Miscellaneous": Peace poster kit / pop-up tent ($422.12), eyeglass collection boxes ($102.86), 50-yr pins ($195.80), member polos ($239.60) | **Miscellaneous** | program/service or member-recognition (if the club wants that visibility) | "Misc" is absorbing distinct program + recognition spend |

### G3. Consolidation — retire duplication

- **Keep the Club "Activity Fund" — but as the Zeffy pass-through firewall, not a duplicate ledger.**
  (Corrected per Chris — do NOT retire it.) Zeffy is wired to the **Club** bank account, so online
  public donations must land in the Club and be transferred to the Foundation; the Activity fund is
  that firewall. **Zero out its budget** (balanced pass-through) and **prune its duplicate/unused
  categories** (the parallel copies of Charitable donation out, Service projects, White Cane, etc. —
  all real philanthropy records in the Foundation). Give it only the explicit categories the
  pass-through needs — see **§G6**.
- **Standardize the two "misc" names:** admin income `Misc` vs admin expense `Miscellaneous` → one
  spelling (`Miscellaneous`).
- **Cross-fund duplicate names that should NOT be merged** (each entity legitimately has its own):
  `Insurance & bonding`, and the intentional per-entity `Public donations`/`Interest` — leave, but
  make sure activity-fund copies are retired with the fund above.

### G4. Splitting

- **Rudolph Run income** → G1 (do this).
- **Leave `Charitable donation out` as-is** — it looks like a huge catch-all (16 beneficiaries, 5
  causes), but that's exactly what the **cause → line-item** breakdown (B-29) is for; the causes ARE
  the split. No category-level split needed.
- **Event costs** — once B-33 gives event costs a home, **Rudolph Run** expenses (the vendor list)
  become itemizable there. (**Wine With the Lions is marketing, not a fundraiser** — per Chris — so it
  stays in Marketing; corrected from an earlier draft.)

### G5. Naming consistency tweaks

- `Meals` (admin) → **`Meeting hospitality`** (matches the budget line and every memo).
- Decide the **Lions-dues grain**: the ledger merges District + International + New-Member dues into
  `Per-capita tax` (+ `District & convention`), but the budget lists them as separate lines. Pick
  one grain so budget-vs-actual lines up (this also affects the mailed budget, B-31).
- Align category names with the budget's line names generally, so a reader can trace a budget line to
  a ledger category without a mental map (the §C admin table shows how far they've drifted).

### G6. Inter-fund transfers & the Zeffy pass-through — model it explicitly (Chris's ask)

The Activity fund's real job: **Zeffy is connected to the Club bank account**, so online public
donations land in the Club and must move to the Foundation. Keep the fund as that firewall, zero its
budget, and record each dollar as it moves — with **explicit** categories, never `Public
donations`/`Misc` overloading:

1. **Zeffy donation arrives** → **income** to the **Activity fund**, category **`Zeffy Donations`**
   (or `Online Donations`). This is the single entry point for online public money.
2. **Transfer to the Foundation** → **two legs, same amount**:
   - **expense** out of the Activity fund → category **`Transfer to Foundation`** (the club side
     already has a `Donations to Foundation` admin category — collapse to one explicit transfer
     category and reuse it).
   - **income** into the Foundation Charitable fund → category **`Transfer from Club`** —
     **not** `Public donations`. The gift was already recorded as public income in the Activity fund;
     the Foundation side is a *transfer*, not a second public donation.
3. Net: the Activity fund lands at ~$0 (in = out) — exactly the "balanced pass-through within $100"
   rule already coded for `activity` funds.

**Reporting caveat (why the explicit name matters):** the same dollar is income in two funds, so any
org-wide "total income" roll-up must recognize `Transfer from Club` as an inter-fund transfer and
**eliminate it**, or consolidated income double-counts. A dedicated, explicitly-named transfer
category is what makes that elimination possible — and it retroactively fixes the $552 "tailtwisting
transfer" now mislabeled as Foundation `Public donations` (§G2). *(Best modeled as its own small
feature — a recognized "transfer" category type or a transfer-pair entry — worth a backlog item.)*

### G7. No "Miscellaneous" catch-all categories (Chris's standing preference)

Replace `Miscellaneous`/`Misc` with **explicit** categories and reclassify their contents, then retire
the bucket. From the admin `Miscellaneous` sample, each item has a real home:

| Current "Miscellaneous" item | Explicit category it wants |
|---|---|
| Peace poster kit, pop-up tent ($422.12) | Youth programs / Program supplies |
| Eyeglass collection boxes ($102.86) | Vision / eyeglass program |
| 50-year pins ($195.80), member polos ($239.60) | Member recognition |
| Speaker gifts ($55.08) | Member recognition (or Meeting hospitality) |
| Santa/costume cleaning ($42.80) | Rudolph Run / Santa event costs |

Same rule on the income side — every deposit routes to an explicit source category (this is also what
makes the Rudolph Run race-vs-sponsorship split in §G1 stick).

---

## Cross-references

- **B-30 / T-25** in `docs/backlog.md` and `docs/treasurer-todo.md` — this doc is the evidence base.
- FY2025 actuals were also the source for `scripts/seed-fy2026-foundation-budget.ts` (the
  cause+label seed), which encodes some of the labeling rules (e.g. Scholarships drop labels, Qdoba
  folds into a generic line) referenced above.
