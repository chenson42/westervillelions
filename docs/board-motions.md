# Board Motions — Proposed

Running record of **proposed** treasury/finance motions to bring to the board. These are DRAFTS for
discussion — they are **not** minutes and record no vote. Once the board acts, note the meeting date
and outcome inline (append, don't delete), and use the approved minute reference as the `boardMinute`
citation when recording the resulting Ledger entries.

Related: `docs/treasurer-todo.md` (T-04, T-20), the Activity Fund pass-through policy (todo Reference
notes), and the transfer/sweep tooling shipped in v1.51.0
(`docs/work-log/2026-07-29-ledger-account-transfers.md`).

---

## Motion 1 — Sweep the Activity Fund balance to the Foundation

> **Status:** DRAFT — proposed for the next board meeting. (Ref: treasurer-todo **T-04**.)

**Background.** The Club's **Activity Fund** is a pass-through that holds publicly-raised money which
physically arrived in Club hands (event cash, Square receipts, donations written to the Club). Its
current balance is **$84.52** — the net of Pancake Breakfast Square receipts, a $40 donation, and a $1
Winterfest donation. Per the Club's standing policy, Activity Fund money is either spent directly on
service or promptly swept to the Foundation (a 501(c)(3), where the money is tax-advantaged and
grant-eligible); it is never used for Club operations. This balance has aged past the 365-day public-
fund holding guideline and should be cleared.

**Proposed motion:**

> *RESOLVED, that the Board authorizes the Treasurer to transfer the Activity Fund balance of
> **$84.52** of publicly-raised funds from the Club to the Westerville Lions Foundation, to be applied
> to the Foundation's charitable purposes.*

**On approval (bookkeeping):**
- Physically move $84.52 from the Club's Administrative Checking to the Foundation account (Chase
  transfer or check).
- Record in the Ledger via **Sweep** (Activity → Foundation): Club Activity Fund expense + Foundation
  income (default category "Public donations"), both citing this minute. This zeroes the Activity Fund
  and clears the direct-to-admin and aged-public-fund guardrail warnings.
- **Software:** fully supported today (this is the sanctioned Sweep direction).

---

## Motion 2 — Donate the Club's petty cash to the Foundation

> **Status:** DRAFT — proposed for the next board meeting. (Ref: treasurer-todo **T-20**.)

**Background.** The Club holds **$250** in petty cash on hand (brought onto the books on 2026-07-21 as
an opening-balance adjustment to the Club's **Administrative/operating** fund, with a "Petty Cash"
account created alongside Administrative Checking). Rather than maintain a petty-cash box that has had
no activity, the Treasurer proposes donating the balance to the Foundation and retiring the petty-cash
account.

**⚠ Confirm before presenting:** count the physical box and confirm it actually holds **$250** (T-20
notes the origin predates the books and the amount is unconfirmed). Adjust the motion amount to the
counted figure.

**Proposed motion:**

> *RESOLVED, that the Board authorizes the Treasurer to donate the Club's petty cash on hand,
> **$250.00**, to the Westerville Lions Foundation as a charitable gift, and to close the Club's petty-
> cash account.*

**On approval (bookkeeping):**
- Physically deposit the $250 cash into the Foundation account.
- Record: Club **Administrative** fund expense $250 (from the Petty Cash account) + Foundation income
  $250, both citing this minute; then deactivate the Petty Cash account.
- **⚠ Software note:** this is a Club **Administrative → Foundation** move ("Donate to Foundation"),
  which the transfer/sweep feature currently **blocks by design** (deny-by-default — it was left closed
  pending a decision to open it). Two recording options once the board approves:
  1. **Open the direction** — a one-branch flip in `src/lib/ledger-transfer-policy.ts` to allow
     Administrative → Foundation as a "Donate to Foundation" transfer (the analyst already recommended
     this and reserved the branch/reason string). Then record it as a single guided move.
  2. **Two manual entries** — record the Club expense and the Foundation income as ordinary
     transactions citing the minute, without the transfer tooling.
- **Note on character:** unlike Motion 1 (public money returning to its charitable home, a policy
  requirement), this is the Club voluntarily gifting *operating* money to the Foundation — a
  discretionary board decision. Club → Foundation is always a compliance-safe direction.

---

## Questions for the Board (discussion, not motions)

Items needing the board's direction before they are built or acted on. Not resolutions — no vote
required unless the board decides one is warranted. Append outcomes inline.

### Q1 — Should board meeting minutes be readable by all members?

> **Status:** OPEN — for the next board meeting. (Raised 2026-08-08 by the Treasurer.)

**Why it is being asked.** The club is building a Minutes area in the member portal
(`docs/work-log/2026-08-08-meeting-minutes.md`) that will hold general, board, and eventually
committee minutes. Who may read board minutes has to be decided before it is built, and it is
awkward to narrow later once members are used to seeing them.

**The Treasurer's position:** all members should be able to read board minutes, since **the board
meeting itself is open to all active members** — the printed 2026-27 schedule says so explicitly.
Minutes of a meeting any member may attend are hard to justify withholding from that same member.

**The counter-argument, for completeness.** Common nonprofit practice treats board minutes as more
restricted than general-membership minutes, because board discussions can touch matters that are
reasonably confidential — personnel, a member in financial difficulty, a dispute, or legal advice.
The relevant question is not whether *these* minutes are sensitive, but whether the board wants a
standing expectation of openness that would make it awkward to handle such a matter later.

**Options if the board wants nuance rather than a simple yes:**
- Open by default, with the ability to mark an individual set of minutes as board-only.
- Open by default, with sensitive matters kept out of the minutes and handled in a separately-recorded
  executive session — which is the conventional mechanism for exactly this.

**What the board needs to decide:** yes, no, or one of the nuanced options. The build currently
assumes **yes, all members** per the Treasurer's direction; changing it later is more work than
deciding it now.

---

## Log (append outcomes here)

_No motions voted yet._
