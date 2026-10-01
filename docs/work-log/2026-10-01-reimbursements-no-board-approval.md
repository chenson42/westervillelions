# Reimbursements: Remove Board Approval Step — Work Log

> **Slug:** `2026-10-01-reimbursements-no-board-approval`
> **Surface:** mixed (signed-in member portal `/members/reimbursements` + admin `/(dashboard)/admin/ledger/reimbursements` + admin home card + Treasury guide)
> **Permission(s):** existing keys cover this — no new `FEATURES.*` key. `ledger.record` becomes the reviewer gate (reject + pay); `ledger.approve` stops gating reimbursements (it still gates disbursement Approvals and budget lock).
> **Estimated complexity:** medium (one route rewrite, one route notification change, ~6 UI/copy surfaces, one pure-data question about legacy `approved` rows; no schema change required)
> **Pipeline mode:** Full — this rewrites a governance rule (board approval → treasurer-only review with post-hoc board visibility). Not a bug fix; no phase may be skipped.

**Origin:** Reported by the treasurer 2026-10-01 after a board meeting: "We decided that we don't need board approval for reimbursements. They will show up on reports and the board can review them post-reimbursement. They just need to be aware of them. Reimbursement request emails probably only need to go to the treasurer."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-10-01 |
| 4 — Implementation | api-developer (4a), then ux-developer (4b) | Complete (server + UI) | — | 2026-10-01 |
| 5 — Verification | qa | Complete | PASS | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-01 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES.** The board's intent is clear and the change is small in code terms. Seven notes below become Phase 2/3 inputs; none needs the user before design starts, but two (N-1 threshold bypass, N-2 treasurer self-submission) are policy consequences the treasurer should be told about when this ships.

## ONE-LINE TAKE

> Collapse reimbursements to submitted → paid (or rejected) with the treasurer as the sole reviewer, email only the treasurer on submit, and give the board a post-payment review surface that is better than "an ordinary expense line on a category report" — which is all they have today.

## What I verified in the code (current state)

- **Submit** — `src/app/api/members/reimbursements/route.ts` POST inserts `status='submitted'`, then (best-effort, bare `catch {}`) sends `getEmailsForFeature(FEATURES.LEDGER_APPROVE)` — every board member and admin — an email via `sendBulkMemberEmail()`: "...requires board review" (line 185). The email does not name the submitter.
- **Review** — `src/app/api/admin/ledger/reimbursements/[id]/route.ts` PATCH:
  - `approve`: `LEDGER_APPROVE`, status must be `submitted`, self-approval blocked, `boardMinute` required (max 500), sets `approved` + reviewer fields, emails the member with the treasurer CC'd via `resolveTreasurer()`.
  - `reject`: `LEDGER_APPROVE`, same self-block, reason required, emails member + treasurer CC.
  - `pay`: `LEDGER_RECORD`, status must be `approved`, requires fund + category + date + method (budget line / note optional), one DB transaction inserts the expense `ledger_transactions` row and flips the reimbursement to `paid` with the atomic double-pay guard (`WHERE status='approved'` + `.returning()`; throws `DOUBLE_PAY` -> 409). **The transaction row copies `approvedByUserId`, `approvedAt`, `boardMinute` from the reimbursement and is hard-coded `status:'posted'` ("bypasses `disbApprovalThresholdCents` — board already approved").** There is **no self-pay check** on `pay` today; segregation of duties lived entirely in the approve step.
- **Role bindings (migrations `0045`, `0047`, `0104`)** — `ledger.approve` -> `admin` + `board_member` only. `ledger.record` -> `admin` + `treasurer`. `ledger.view` -> `admin`, `treasurer`, `board_member`. **The `treasurer` role does not hold `ledger.approve`**, so today the treasurer literally cannot approve or reject a reimbursement; a board member must. The new model therefore requires moving `reject` onto `ledger.record`.
- **Two different definitions of "treasurer".** `resolveTreasurer()` (DECISION-086) means the member holding Board-group `position = 'Treasurer'`; the permission system means holders of the `treasurer` role / `ledger.record`. Nothing guarantees they are the same person. Today that only affects a CC; after this change it decides who is told a request exists.
- **UI** — admin page `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` (tabs Submitted / Approved / Rejected / Paid; badge "Awaiting Board Review"; Approve + Reject on Submitted tab behind `canApprove`; "Self-submitted" label; Mark Paid on Approved tab behind `canRecord`); `approve-reimbursement-dialog.tsx` (required board-minute field); member page `src/app/members/reimbursements/page.tsx`; form toast in `src/components/members/reimbursement-form.tsx:118`; admin home card in `src/app/(dashboard)/admin/page.tsx` (counts `submitted`, shown to anyone with any ledger view/record/manage/approve); Treasury guide `src/components/admin/ledger/guide/reimbursements-section.tsx`.
- **`src/lib/ledger.ts` compliance flags** — nothing reasons about reimbursement approval or `boardMinute`. The only approval flag is "Disbursements pending board approval" (pending *transactions*), which never included reimbursements (they bypass the threshold). **`getPendingApprovals()` / the Approvals page never listed reimbursements** — the guide's claim that "approved-but-unpaid reimbursements ... sit in a separate Approvals queue" is already inaccurate.
- **Transaction immutability depends on `approvedAt`.** `src/app/api/admin/ledger/transactions/[id]/route.ts` PATCH (line 183) and DELETE (line 764) return 403 when `existing.approvedAt` is set. Reimbursement-derived transactions are locked today *only because* pay copies `reviewedAt` into `approvedAt`. See N-3.
- **Board awareness today** — `src/lib/financial-report-queries.ts` builds the Monthly Statement from category lines and *deliberately never exposes `party`, `memo`, `checkNumber`* (it is open to every linked member). A paid reimbursement therefore appears only as dollars inside whatever expense category the treasurer chose, and only after the month is fully reconciled. See N-5.
- **Decisions / history** — see "Decision-log impact" below. `docs/decisions.md` latest is DECISION-104; the next free number is **DECISION-105**.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | Submits a reimbursement (amount, description, optional cause, receipt) | on demand |
| Signed-in member | Edits or withdraws own request while it is `submitted` | on demand |
| Signed-in member | Reads own request status; receives paid / rejected emails | per request |
| Treasurer (`ledger.record`, admin surface) | Opens the request (from email link or admin home card) and views the receipt | per request |
| Treasurer | Marks paid: picks fund, category, optional budget line, date, method, note | per request |
| Treasurer | Rejects with a required reason | rare |
| Another `ledger.record` holder | Pays or rejects a request the treasurer submitted themself | rare, but mandatory when it happens |
| Board member (`ledger.view`, admin surface) | Reviews paid reimbursements after the fact (Paid tab; register; reports) | monthly-ish |
| Anonymous visitor / access-pending member | None. (Members without a linked `members` row still hit the existing "Account Not Linked" state.) | n/a |

## Flows

**Flow 1 — Member submits:** `/members/reimbursements` -> form (amount <= $10,000, description, optional cause, receipt upload) -> POST -> row `submitted` -> member sees it in "My requests" as "Awaiting Treasurer" with a toast that says the *treasurer* will review it -> treasurer is emailed.
- Failure: unchanged validation errors (400 messages, 409 duplicate within 60s). **If the treasurer email fails the member still sees success** (best-effort, as today) — that is acceptable only because the admin home card and the Submitted tab count are the backstop (see N-4).

**Flow 2 — Treasurer pays (the new main path):** email link or admin home "Pending Reimbursement" card -> `/admin/ledger/reimbursements` (default tab: requests awaiting action) -> view receipt -> **Mark Paid** dialog (fund, category, optional budget line, date, method, note) -> PATCH `pay` -> expense transaction posted + reimbursement `paid` -> member emailed (treasurer CC'd) -> row moves to Paid tab.
- Failure: 403 (no `ledger.record`, or own request); 409 "already paid" (double-pay guard); 409 "request was edited while you were reviewing" (new, N-6); 400 for missing fund/category/date/method/mismatched budget line (unchanged).

**Flow 3 — Treasurer rejects:** same page -> Reject -> required reason -> PATCH `reject` -> member emailed with the reason (treasurer CC'd). Failure: 403 / 409 as today.

**Flow 4 — Treasurer submits their own reimbursement (N-2):** treasurer submits at `/members/reimbursements` like anyone -> notification goes to the *other* `ledger.record` holders (never the submitter) -> on the admin page the submitter sees "Submitted by you — another reviewer must pay this" instead of buttons -> a different `ledger.record` holder pays or rejects. Failure: server returns 403 "You cannot pay your own reimbursement request" if the submitter calls the API directly.

**Flow 5 — Board reviews after the fact:** `/admin/ledger/reimbursements?tab=paid` (any `ledger.view` holder, already true for `board_member`) -> sees paid date, member, amount, description, cause, fund, who paid it, receipt link, linked transaction. Failure: empty state "No paid reimbursements yet."

**Flow 6 — In-flight rows at deploy:** any request already `submitted` or `approved` when this ships must still be payable. `approved` rows stay payable (their `boardMinute` shows as history); `submitted` rows can be paid directly.

## Recommended defaults (answers to the seven questions)

**Q1 — Lifecycle.** Lifecycle becomes `submitted -> paid | rejected`. **Keep `'approved'` as a legacy, read-only value** — no data migration, no new writes. `pay` must accept `status IN ('submitted','approved')` and the atomic double-pay guard must change to match (`WHERE id = $id AND status IN ('submitted','approved') ... RETURNING id`; still throw `DOUBLE_PAY` on zero rows — the guard itself is unchanged in shape). The `approve` PATCH action is **removed** (400 "action must be one of: reject, pay"); do not leave a dead approve path that still demands a minute. The admin "Approved" tab stays for legacy rows but should hide itself (or render a one-line "legacy" note) when its count is 0. Before deploy, someone should count `status='approved'` rows in production so Phase 5 knows whether the legacy path needs a click-through.

**Q2 — `boardMinute`.** **Drop the requirement; stop collecting it.** Do not make it optional: an optional box nobody fills in invites the old ritual back and contradicts the board's decision. Keep the column (DECISION-074 §6: no schema change to the three `boardMinute` fields) — it becomes legacy-only data. Show it on the member page and admin page only when non-null on historical rows, relabelled "Board minute (historical)". The `ledger_transactions.boardMinute` stays `null` for new reimbursement transactions.

**Q3 — Self-review.** The treasurer is now the sole reviewer, so segregation of duties collapses to one rule: **the submitter may not reject or pay their own request** (extend the existing self-check, which currently guards only approve/reject, to `pay`; the self-check compares `session.user.memberId` to `submittedByMemberId`). A different `ledger.record` holder must act. This is the one case that still needs a second person, and it is a real operational precondition: **at least two people must hold `ledger.record` (e.g. the Treasurer and the site Admin).** If only one person holds it, a treasurer-submitted request is stuck. Do not solve this with a board-approval side path; surface it instead (Flow 4's "another reviewer must pay this" message plus the notification fallback in Q4). Admin users with `ledger.record` are subject to the same rule.

**Q4 — Notification on submit.** Send to the resolved treasurer, not the `ledger.approve` fan-out.
- Recipient: `resolveTreasurer()` when `ok` **and** that person is not the submitter **and** their user account actually holds `ledger.record` (otherwise the email would link them to a page where they cannot act).
- **Fallback (resolver `none` / `multiple` / `no_board_group`, treasurer is the submitter, or treasurer lacks `ledger.record`): the `ledger.record` holders minus the submitter** — via the existing `getEmailsForFeature(FEATURES.LEDGER_RECORD)`, with a `console.warn` naming the resolver reason (same tolerant pattern as the CC sites). Rationale: the old `ledger.approve` fan-out is the wrong fallback — those people can no longer act. "Nothing plus a warning" is the worse failure: a request nobody was told about sits unpaid and the member is waiting. `ledger.record` is a 2-3 person set, so this is not spam. This is **tolerant, not a hard block** — unlike dues reminders (DECISION-101), a failed treasurer resolution must never stop a member from submitting.
- Mechanics: still through the shared send helpers (`sendEmail()` for one recipient, `sendBulkMemberEmail()` if the fallback yields several), still isolated from the DB write in the existing try/catch, still deny-by-default outside production. **This is not a durable-claim path** — no `sentAt`, no unique success row — so DECISION-102/103's `sendEmailForDurableClaim()` does not apply, and the durable-claim Phase-2 exception is not triggered. Phase 2 should still state this in one line. Replace the bare `catch {}` with a `console.warn` so a failed notification is findable in logs / `/admin/email-queue`.
- Copy: subject "New reimbursement request — $X"; body "…is waiting for your review", **include the submitter's name** (today's email omits it), keep `escapeHtml()` on every member-supplied field, link to `/admin/ledger/reimbursements`.

**Q5 — Board awareness.** "They will show up on reports" is **only partly true today.** Dollars appear, identifiable reimbursements do not:
- The Monthly Statement shows category totals only (by design — it is member-visible and must never carry `party`/`memo`), and only for fully reconciled months. A $180 reimbursement is indistinguishable from any other $180 of expense in that category. **The member-visible statement must not be changed to list reimbursements by name.**
- The ledger register does show `party` = member name and `memo` = description, but a reimbursement-derived transaction carries no marker that it *is* a reimbursement (the link only runs reimbursement -> transaction).
- The one place a board member can already see them is the **Paid tab** of `/admin/ledger/reimbursements` (`board_member` holds `ledger.view`, which the page accepts). It currently orders by *submitted* date, caps at 50 with no month filter or total, and doesn't show who paid it.
- **In this change (minimum):** make the Paid tab the board's review log — order Paid by `paidAt` desc, show payer, fund and paid date, and put one sentence on the page telling `ledger.view` holders that paid reimbursements are listed here for review. Narrow the admin-home "Pending Reimbursement" card to `ledger.record` holders (its own comment says it should only appear to people who can act; board members can no longer act on it).
- **Follow-up backlog item (not this change):** a month-scoped "Reimbursements paid" section in the admin Reports (`ledger.view`-gated, names allowed because it is admin-only), and optionally the same list in the "Send to Board" email. That second part touches the DECISION-100/101 durable-claim send path, so it needs its own pipeline pass and must not ride along here. Suggested ID: next free B-nn; one line — "board-visible monthly list of reimbursements paid".

**Q6 — Decision-log impact.** There is **no single DECISION entry that established "reimbursements need board approval"** — the rule lives in the 2026-06-24 ledger-controls work-log and was never promoted to a decision. The tech-lead should write **DECISION-105** that states the new rule, names what it supersedes, and cites the board meeting. Items it touches:
- `docs/work-log/2026-06-24-ledger-controls.md` — scope addition ("Receipt + board approval required... Reimbursements always require board approval regardless of `disbApprovalThresholdCents`"), R-1 ("locked once the board acts"), R-5 ("notify the board on a new submission"), Flow R-B/R-C, and the "bypass the threshold *because board already approved*" ruling. **Superseded in part** (approval step and board notification gone; receipt requirement, member-supplied cause, treasurer-assigns-fund R-3, R-2 resubmit-after-rejection, R-4 private receipts all stand).
- **DECISION-061** (pay requires `categoryId`; code comments say "board already approved") — unchanged in substance; the comments are stale.
- **DECISION-086** (the "five treasury-email CC sites") — the reimbursement `approve` CC site disappears (five becomes four) and the submit email gains `resolveTreasurer()` as its *recipient*, a sixth consumer with a different tolerance (fallback, not skip). Amend the count.
- **DECISION-074 §6** (`boardMinute` stays free text, no schema change) — consistent; note reimbursement `boardMinute` is now legacy-only.
- **DECISION-018 / DECISION-020** (receipt storage) — unaffected; receipt stays mandatory.
- `docs/backlog.md` **B-48** (route test for the CC rule at the reimbursement route, which has no `route.test.ts`) — this change rewrites that route, so Phase 3 should fold B-48 in (see Phase 3 test list below) and update the site count it cites.
- `docs/release-notes/v1.21.md` and the 2026-06-24 work-log are history — **do not edit**; supersede forward.
- `src/lib/db/schema.ts:1491-1493` and `:1516` comments, and the route docblocks, are code-level statements of the old rule and must be rewritten.

**Q7 — Copy inventory (every place that states the old rule).**

| Where | Current text | Change |
|-------|--------------|--------|
| `src/app/api/members/reimbursements/route.ts:185` | "...requires board review." | "...is waiting for your review." + submitter name |
| `src/app/api/members/reimbursements/route.ts` docblock/comments | "E-2: Notify LEDGER_APPROVE holders"; "every LEDGER_APPROVE holder — i.e. the board" | rewrite for treasurer recipient |
| `src/components/members/reimbursement-form.tsx:118` | toast "The board will review it shortly." | "Submitted. The treasurer will review it and you'll get an email when it's paid." |
| `src/app/members/reimbursements/page.tsx:114` | "The board will review and authorize it. The treasurer assigns the fund and processes payment." | "The treasurer reviews your request, assigns the fund, and pays it." |
| `src/app/members/reimbursements/page.tsx:30` | badge "Awaiting Review" | "Awaiting Treasurer" |
| `src/app/members/reimbursements/page.tsx:33-34` | "Approved — Awaiting Payment" | keep for legacy rows only |
| `src/app/members/reimbursements/page.tsx:177-181` | "Authorized: {boardMinute}" | show only when non-null, relabel "Board minute (historical)" |
| `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` | badge "Awaiting Board Review"; subtitle "review receipts, approve, and mark paid"; tab "Submitted"; `canApprove` gating Approve/Reject; "Self-submitted" title "You cannot approve your own reimbursement"; "Min: {boardMinute}" on Approved tab; Mark Paid only on Approved tab | badge "Awaiting Treasurer"; subtitle "review receipts, then mark paid or reject"; Mark Paid + Reject on the awaiting tab behind `LEDGER_RECORD`; self title "You submitted this request — another reviewer must act on it"; keep "Min:" for legacy rows only |
| `src/components/admin/ledger/approve-reimbursement-dialog.tsx` | whole file (required board-minute) | **delete** |
| `src/app/api/admin/ledger/reimbursements/[id]/route.ts` | docblock; `approve` branch; error strings "You cannot approve your own reimbursement request", "Reimbursement must be approved before it can be paid", "boardMinute is required"; approve email "has been approved / treasurer will process payment shortly"; inline comments "board already approved" (x3) | remove approve branch + its email; new self-pay error "You cannot pay your own reimbursement request"; pay accepts `submitted` or legacy `approved`; update comments |
| `src/app/api/members/reimbursements/[id]/route.ts` header | "Locked once any board action occurs" | "Locked once the treasurer pays or rejects it" |
| `src/lib/permissions.ts:70` comment and `:223` description | "approve/reject pending disbursements + reimbursements" | "...pending disbursements" (+ budget lock). The `features.description` DB row from `0047` carries the same string; Phase 3 decides whether to add an idempotent `UPDATE` (cosmetic) |
| `src/lib/db/schema.ts:1491-1493`, `:1516` | "requires board approval before payment... submitted -> approved | rejected -> paid" | rewrite; note `approved` is legacy |
| `src/components/admin/ledger/guide/reimbursements-section.tsx` | pipeline "submitted -> approved -> paid"; "Approved-but-unpaid reimbursements ... sit in a separate Approvals queue until a board approver acts" | rewrite: treasurer reviews and pays; board reviews afterward on the Paid tab/reports; Approvals page = large disbursements only; add the "treasurer can't pay own request" rule |
| `src/components/admin/ledger/guide/books-register-section.tsx:23` | "awaiting board approval (see Reimbursements & Approvals below)" | still true for disbursements; keep, but make sure the target section doesn't imply reimbursements are in that queue |
| Member-facing emails | approve email gone; paid / rejected emails unchanged | none beyond removing approve |
| `CLAUDE.md` | no reimbursement-approval text | none (Key Features list is silent) |

## Permissions

- **Permission(s):** existing keys only. `reject` and `pay` -> `FEATURES.LEDGER_RECORD`. Page/API read stays `ledger.view | record | manage | approve` (nav entry and page gate unchanged, so DECISION-082's derived proxy rule needs no change; the page must keep its own `auth()` + feature check, which it has). `FEATURES.LEDGER_APPROVE` no longer gates anything on reimbursements; it keeps the Approvals page, pending-disbursement approval, and budget lock.
- **Default roles:** `admin` + `treasurer` hold `ledger.record` and are therefore the reviewers. `board_member` keeps `ledger.view` (post-hoc review) and `ledger.approve` (disbursements only). **No role-binding migration is needed.**
- **Precondition to confirm in production, not in code:** the member holding Board position `Treasurer` has a user with the `treasurer` role (or otherwise `ledger.record`), and at least one *other* user holds `ledger.record` (N-2).

## Gaps the Request Didn't Address

- **N-1 — Threshold bypass becomes unconditional.** Pay already posts directly regardless of `disbApprovalThresholdCents` (default $250) on the theory that the board approved. After this change a reimbursement of up to the $10,000 form ceiling posts with **zero** second-person involvement, while an ordinary $300 vendor check still pends for board approval. Reimbursements and vendor payments end up on opposite sides of the same control. *Recommendation:* follow the board's words (no threshold on reimbursements, keep `status:'posted'`), but state the consequence in DECISION-105 and tell the treasurer. If the board wants a ceiling, the cheapest version is to route over-threshold reimbursements through the existing pending-disbursement path — that is a new decision for the board, not something to invent here.
- **N-2 — Treasurer submitting their own request** — covered in Q3/Flow 4. Needs two `ledger.record` holders; new self-check on `pay`. Add a unit test (self-pay 403, other holder 200).
- **N-3 — Dropping `approvedAt` silently unlocks paid transactions.** If the pay action stops copying `reviewedAt` -> `approvedAt`, the posted reimbursement transaction becomes **editable and deletable** by any `ledger.record` holder (the immutability guard keys on `approvedAt`). Deleting it would null the reimbursement's `ledgerTransactionId` (FK `set null`) and leave a "paid" request with no ledger entry; editing it would let the amount drift from what the member was told. *Required behavior:* a paid reimbursement's transaction stays immutable. Tech-lead picks the mechanism (stamp `approvedByUserId`/`approvedAt` with the paying treasurer and pay time — the least invasive — or add an explicit guard); `boardMinute` stays null. I recommend the former and a comment explaining that `approvedBy` here means "reviewed by the treasurer", not "board-approved".
- **N-4 — Notification is now a single point of failure.** Previously several people got the email. Now one address. Recommendations: fallback recipients (Q4), a logged warning on failure, and keeping the admin-home card + tab count as the backstop. The member also has no "we received it" email today; out of scope.
- **N-5 — "Reports" overstates visibility** — Q5. Minimum in-scope: Paid tab as the board review log. Follow-up: board-visible monthly "Reimbursements paid" list.
- **N-6 — Bait-and-switch window (adversarial).** A member may edit amount/description/receipt while `submitted`. Previously the `approved` step locked them out before the treasurer saw the pay dialog. With `submitted -> paid` the treasurer can open the dialog at $20, the member edits to $200, and `pay` (which re-reads the row) posts $200 unseen. *Required:* `pay` accepts the `amountCents` (and ideally the row's `updatedAt`) the treasurer was looking at, and returns 409 "This request was edited after you opened it — reload and review it again" on mismatch, inside the same atomic guard. Also `DELETE` (member withdraw) racing a pay currently surfaces as the misleading "already marked paid" 409; a clearer message is a nice-to-have.
- **N-7 — Legacy rows and tab semantics.** Existing `approved` rows need a visible home and payable path (Q1). Tab label "Submitted" should read as the work queue ("Awaiting action"), and the dashboard card should still count `submitted` only.
- **Empty states / failure microcopy.** Empty tab text ("No submitted reimbursement requests. Members submit requests from their member portal.") still works; adjust the wording to the renamed tab. Pay-dialog and reject-dialog failure toasts already exist. The "Account Not Linked" state for members without a `members` row is unchanged.
- **Access-pending / OAuth-vs-password:** not affected — submission is gated on `session.user.memberId`, same as today; a member with no usable role can still submit (no `FEATURES` key needed) and is not told anything new.
- **Mobile (360px):** the admin table is already `overflow-x-auto`; the action cell now holds Mark Paid + Reject — check it doesn't push past the 44px tap-target minimum (`min-h-[32px]` on current buttons is below it; carry-over, not new).
- **Brand/ConfirmDialog:** Mark Paid and Reject are Radix dialogs collecting required fields, not bare confirms, so the no-`window.confirm` rule is met. Buttons remain `rounded-lg`, cards `rounded-2xl`.
- **Adversarial pass summary:** *Redirect targets* — none (email links are server-built from `getAppUrl()`). *State-machine shortcuts* — direct `PATCH action=approve` must return 400, not 500; direct `pay` from `rejected` or `paid` must 409; direct `pay` by a non-`ledger.record` user 403 (already true). *Enumeration* — member GET still 404 for other members' ids (unchanged). *Input boundaries* — server already validates amount/description/key; `pay` fields validated server-side already. *Self-targeting* — N-2.

## Out of Scope (confirm with user)

- Raising or lowering the $10,000 per-request ceiling, or adding a dollar threshold above which board approval returns (N-1).
- A "request received" email to the member, or a digest/weekly summary email to the board (the board chose reports, not email).
- The board-visible "Reimbursements paid" report section and any change to the Send-to-Board financial email (follow-up backlog item; durable-claim path).
- Renaming/dropping the `approved` status value, the `board_minute` column, or `reviewedByUserId` columns (no schema change in this change).
- Bulk pay, export, HEIC receipt upload (B-08), structured cause (B-18).
- Rewriting the 2026-06-24 work-log or v1.21 release notes (history).

## Open Questions

Adopted defaults above; none block Phase 2. For the treasurer when this ships:
1. **N-1:** Is the board comfortable that a reimbursement of any amount (up to $10,000) is paid on the treasurer's say-so alone, when a $300 vendor check still needs board approval? (Default assumed: yes, per "no board approval for reimbursements.")
2. **N-2:** Who is the second `ledger.record` holder who will pay the treasurer's own reimbursements?
3. What was the date/minute reference of the board motion? DECISION-105 should cite it, since the app no longer records it per reimbursement.
4. Production data check (can be done by the treasurer or tech-lead via the admin UI): how many reimbursements are currently `submitted` or `approved`, and does the member with Board position `Treasurer` hold `ledger.record`?

## Phase 3 input: tests the design should name (B-48 folded in)

Create `src/app/api/admin/ledger/reimbursements/[id]/route.test.ts` (does not exist today): pay allowed from `submitted` and legacy `approved`; pay 409 from `paid`/`rejected`; double-pay guard under the widened status set; self-pay and self-reject 403; reject gated on `ledger.record` (a `ledger.approve`-only user gets 403); `approve` action returns 400; amount-mismatch 409 (N-6); posted transaction gets non-null `approvedAt` (N-3) and null `boardMinute`; treasurer CC present on reject/paid and absent-not-thrown when `resolveTreasurer()` fails. And for the submit route: recipient = resolved treasurer; fallback = `ledger.record` holders minus submitter when resolver fails / treasurer is submitter; email failure does not fail the 201.

---

# Phase 2 — Architectural Review (architect)

**Owner:** architect
**Status:** complete
**Date:** 2026-10-01

## Verdict

**Approved with suggestions.** The shape is right and needs no new module, key, table, column, route, or dependency. Phase 3 must honor the **Required** items below (R-1 to R-7); they are conditions on the design, not reasons to go back to Phase 1. Two of them (R-4, R-5) are pre-existing race defects that this change makes materially more likely, so they cannot be left for later.

## Rulings on the seven questions

### 1. Permission shape — CONFIRMED: `ledger.record`, no new key

- `reject` and `pay` both gate on `FEATURES.LEDGER_RECORD`. `FEATURES.LEDGER_APPROVE` stops gating anything reimbursement-related (it keeps Approvals page, pending-disbursement approve, budget lock).
- **Why not a `reimbursements.*` key.** `pay` creates an expense `ledger_transactions` row with `status:'posted'`. Whoever can pay therefore can post an expense, which is exactly what `ledger.record` means. A narrower key would let someone create posted expenses without holding the record key, a side door around the gate. The reviewer set is also two roles (`admin`, `treasurer`); a new key buys no precision and costs a role-binding migration. If the board ever wants "may pay reimbursements but not edit the books," that is a future DECISION, not this one.
- **Proxy / nav derivation (DECISION-082): unaffected, change nothing.** The "Reimbursements" `ADMIN_NAVIGATION` entry keeps `requiredFeature: [LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE]`. Do **not** prune `LEDGER_APPROVE` from that array: it is harmless (every `ledger.approve` holder also holds `ledger.view`) and removing it is a gratuitous change to a derived proxy rule. The page keeps its own `auth()` + `hasAnyFeature()` gate (`admin-page-feature-gates.test.ts` already covers it). Inside the page, `canApprove` goes away; Mark Paid and Reject sit behind `canRecord`.
- **Page/API read gate stays `LEDGER_VIEW`** (list route, detail GET, `/receipt` proxy). This is what lets `board_member` do the after-the-fact review; do not narrow it.
- **R-1 (self-action check).** Today's check is `session.user.memberId && reimb.submittedByMemberId && memberId === submittedByMemberId`: if the acting user's session has no `memberId` the check silently passes. Make the check match on **either** `session.user.id === reimb.submittedByUserId` **or** `memberId === submittedByMemberId`, in one local helper used by both `reject` and `pay` (two call sites; do not paste it twice). Error strings: "You cannot pay your own reimbursement request" / "You cannot reject your own reimbursement request".
- **Optional / cosmetic:** `permissions.ts:70` comment and `:223` description say "...and reimbursements" and must be corrected. The `features.description` row seeded by migration `0047` carries the same stale string and is shown in the role-management UI, where it would tell an admin that `ledger.approve` still covers reimbursements. A one-statement idempotent migration is worth it: `UPDATE features SET description = '...' WHERE name = 'ledger.approve';` (re-runs harmlessly). **Migration number is a placeholder** (latest on disk today is `0107`; database-admin re-derives the real next-free number at Phase 4 start with `ls drizzle/migrations/*.sql | sort | tail -3`). No role-binding changes.

### 2. Lifecycle — CONFIRMED, no schema, no migration (except the cosmetic UPDATE above)

- `submitted -> paid | rejected`; `approved` is a read-only legacy status, never written again. `status` has no DB CHECK (schema comment says so), `boardMinute` stays nullable; nothing to alter. Rewrite the `schema.ts:1491-1493` / `:1516` comments (comment-only edit; `db:push` sees no diff).
- `approve` action removed; unknown action returns 400 "action must be one of: reject, pay" (never 500).
- `pay` accepts `status IN ('submitted','approved')`; the atomic guard becomes `WHERE id = $id AND status IN ('submitted','approved') ... RETURNING`, still `DOUBLE_PAY` -> 409 on zero rows.
- **R-2 (legacy `approved` rows keep their history).** For a legacy `approved` row, `pay` must keep today's behavior: the transaction copies `approvedByUserId`/`approvedAt`/`boardMinute` from the reimbursement, since those are the real board approval and are provenance worth preserving. Only the `submitted` path uses the new stamping (ruling 3). Do not overwrite `reviewedBy*`/`boardMinute` on a legacy row.
- **R-3 (reject from legacy `approved`) — suggestion, not required.** Today an `approved` row can never be rejected. Once approval is no longer a board commitment, a legacy row the treasurer decides not to pay would be stranded forever. Recommend `reject` accept `IN ('submitted','approved')` with the same atomic guard. If Phase 3 declines, say so in the design.
- Pre-deploy count of production `approved`/`submitted` rows (analyst's Q1 note) is a Phase 5 input, agreed.

### 3. Immutability of paid transactions — RULING: stamp the paying user and time into `approvedByUserId` / `approvedAt`; no new mechanism

Facts verified in code: the only consumers of `ledger_transactions.approvedAt` on posted rows are the **lock guards** (transaction PATCH `:183`/`:601`, DELETE `:764`/`:804`, split `:98`, receipt-waive `:55`, and `transaction-actions.tsx:56` to hide the edit/delete buttons). Nothing reports "approved by" on a posted transaction, and nothing in `ledger.ts`, `ledger-search-queries.ts`, or `financial-report-queries.ts` reads `approvedByUserId`. In this codebase `approvedAt` on a transaction is, operationally, the "no longer freely editable" marker.

- **Rule.** For a `submitted -> paid` transition: `now = new Date()` once; transaction row gets `approvedByUserId = session.user.id`, `approvedAt = now`, `boardMinute = null`; the same UPDATE sets the reimbursement's `paidAt = now`, `reviewedByUserId = session.user.id`, `reviewedAt = now` (so a paid row always carries who/when; today a paid row only has reviewed* because approve set it).
- **Alternative rejected: an explicit guard** (`EXISTS (reimbursement WHERE ledger_transaction_id = txn.id AND status='paid')`). It would have to be added to five route sites plus a UI flag, which is the "same decision in more than two places" pattern the Duplication rule forbids, and each missed site is a silent unlock. Stamping makes the existing five guards correct with zero edits to them.
- **Transaction-approval invariants (DECISION-061 / DECISION-074 §6) are not broken.** DECISION-061 only requires `categoryId` on pay (kept). DECISION-074 §6 only says no schema change to the three `boardMinute` columns (kept; reimbursement-derived `boardMinute` is now legacy-only and null on new rows). The "approver may not be the recorder" rule lives in `transactions/[id]/approve/route.ts` and acts only on `pending` rows; reimbursement-derived rows are born `posted`, so it never runs on them. The deliberate deviation is that on these rows `approvedByUserId === recordedByUserId` (the treasurer paid it). The segregation-of-duties replacement is the submitter-cannot-pay-own-request rule (R-1) plus a second `ledger.record` holder. State this in DECISION-105 and in a code comment at the insert: "approvedBy/approvedAt here mean *reviewed and paid by the treasurer* (locks the row); board approval does not apply (DECISION-105)."
- **R-6 (guard the lock with a test).** `route.test.ts` must assert the posted transaction has non-null `approvedAt` and `approvedByUserId === acting user`, and `boardMinute === null`, for the `submitted` path, and preserved board values for the legacy path. Add one line to the `transactions/[id]/route.ts` header or the pay route comment naming the coupling so nobody "cleans up" the stamp later.
- "Paid by" for the Paid tab: define it once as the linked transaction's `recordedByUserId` (always the payer, for legacy and new rows alike), not `reviewedByUserId` (which for legacy rows is the board approver).

### 4. Amount race — RULING: stale-token check; do not lock edits on open

- **Lock-on-open rejected.** There is no "opened" state; creating one needs a column and a write on page view (a GET with a side effect) and still leaves the member stuck if the treasurer wanders off. Not worth a schema change.
- **R-4 (pay carries what the treasurer saw).** `pay` body gains `expectedAmountCents` (integer, required) and `expectedUpdatedAt` (ISO string, required), both echoed from the row the admin page rendered. On mismatch: 409 "This request was edited after you opened it. Reload and review it again." Reject the request with 400 if either is missing (no silent fallback to the old behavior; the only client is our own page).
- **Precision trap, do not compare `updated_at` in SQL.** `updatedAt` is written by `defaultNow()` (microseconds) on insert but read by Drizzle as a JS `Date` (milliseconds), so `WHERE updated_at = $1` would never match a never-edited row and every first-time pay would 409. Compare the echoed `expectedUpdatedAt` against the freshly read `reimb.updatedAt` **in application code** (both ms-truncated `Date`s, `getTime()` equality). Then make the *atomic* guard pin value columns, not timestamps: the final UPDATE's `WHERE` is `id = $id AND status IN ('submitted','approved') AND amount_cents = $readAmount AND description = $readDescription AND receipt_storage_key = $readKey` (values from the handler's own read). That closes the gap between the handler's read and its write without any timestamp equality. Add a test with a never-edited row (no prior `updatedAt` write) so the false-409 trap is covered.
- **R-5 (member-side status guard; pre-existing TOCTOU).** `members/reimbursements/[id]` PATCH checks `status === 'submitted'` then runs `UPDATE ... WHERE id = $id` with no status condition; DELETE is the same shape. A member edit that interleaves with a pay can rewrite the amount on a row that is already `paid` (reimbursement says $200, ledger says $20). Both must become `WHERE id = $id AND status = 'submitted'` + `.returning()`, 409 when zero rows. Update the route header ("Locked once the treasurer pays or rejects it"). Withdraw racing a pay should surface as "This request was already processed" rather than "already paid"; nice-to-have.
- **R-7 (reject needs the same atomic guard; pre-existing).** `reject` today reads status, then runs `UPDATE ... WHERE id = $id` with no status condition. With two `ledger.record` holders acting (treasurer plus admin) a reject can overwrite a concurrent pay (`paid -> rejected` with a posted transaction still in the books). Use `WHERE id = $id AND status IN (<allowed>) ... RETURNING`, 409 on zero rows. Add a test.

### 5. Notification recipient — RULING

- **Primary:** the Board-position Treasurer from `resolveTreasurer()` (DECISION-086), **only if** that person is also an active `ledger.record` holder and is not the submitter. Implement the "holds `ledger.record`" test by intersecting on **email** with `getEmailsForFeature(FEATURES.LEDGER_RECORD)` (case-insensitive, trimmed). `resolveTreasurer()` returns `members.email` while the holder list is `users.email`; a mismatch simply falls through to the fallback, which is safe and avoids a new member-to-user join.
- **Fallback:** all `ledger.record` holders minus the submitter (by user id/email). Use it when the resolver returns `none` / `multiple` / `no_board_group`, when the Treasurer is the submitter (Flow 4), or when the Treasurer is not in the holder set. This is the right fallback because those are the only people who can act on the link. It is tolerant, not a hard block (contrast DECISION-101): a resolution failure must never stop a member submitting.
- **Never an empty set silently.** If primary and fallback both yield zero recipients, `console.error` with the reimbursement id and the reason, and still return 201. Admin-home card plus the awaiting tab are the backstop (analyst N-4). The card must be narrowed to `ledger.record` holders (its own comment says it should only show to people who can act).
- **Placement.** The decision (who gets it) is a **pure function** `pickReimbursementNotifyRecipients({ treasurer: TreasurerResolution, recordHolderEmails: string[], submitterEmail: string })` returning `{ recipients: string[]; reason: "treasurer" | "fallback:<resolver reason | submitter_is_treasurer | treasurer_lacks_record>" }`, exported from `src/lib/ledger.ts` beside the other pure helpers (`shouldClearBudgetLineLink` precedent). The route does the DB calls and the send. This makes the recipient rule unit-testable without DB mocks and keeps `ledger-queries.ts` (already a ~4,000-line hotspot) from growing. No new file.
- **Logging, not a bare catch.** Replace `catch {}` with `console.warn("[Reimbursement notify] ...")` carrying reimbursement id, the `reason`, and counts; **do not log email addresses** (they are visible at `/admin/email-queue`). Also note: `sendBulkMemberEmail()` does not throw on provider failure, it returns `results[]` with `success:false`, so the existing try/catch never sees a failed send. Inspect `results` and warn on any `!success` (blocked non-production sends return `success:true` and are correctly not warnings).
- **Send mechanics.** Use `sendBulkMemberEmail()` directly for any recipient count (one code path, one email per recipient, no shared `To:`); do not branch to `sendEmail()` for the single-recipient case. `escapeHtml()` on `description`, `beneficiaryCause`, and the new submitter name; `amountDollars` and `appUrl` stay unescaped as the existing comment explains.
- **Durable-claim confirmation (CLAUDE.md exception): NOT triggered.** This path writes no `sentAt`, no partial-unique success row, and no append-only "sent" history row. The only record is the `email_queue` transport row `sendEmail()` already writes. Therefore `sendBulkMemberEmail()` is correct and `sendBulkMemberEmailForDurableClaim()` must **not** be used. Same for the member-facing paid/rejected emails, which keep plain `sendEmail()` with the existing treasurer CC (DECISION-086; it now doubles as the treasurer's receipt when the admin, not the Treasurer, does the paying).

### 6. Board awareness — CONFIRMED split, with one tightening

- In this change (minimum): Paid tab ordered by `paidAt` desc, showing payer (per ruling 3's definition), fund, paid date, receipt link, one explanatory sentence for `ledger.view` holders; Approved tab hidden or one-line "legacy" when empty; card narrowed to `ledger.record`.
- Out of scope, backlog: month-scoped "Reimbursements paid" section in admin Reports (and optionally the Send-to-Board email, which is the DECISION-100/101 durable-claim path and must not ride along).
- **Tightening (suggestion):** `getReimbursementsForAdmin` caps at 50 with no paging. If the Paid tab is the board's only review surface, silently truncating it defeats the control. Phase 3 should add "Load more"/offset paging (the query already takes `limit`/`offset`) or at least a visible "Showing latest 50" notice with the true total. The monthly report item should be filed at normal-next priority, not "someday", because the board's decision is premised on after-the-fact visibility. The member-visible Monthly Statement must still never list reimbursements by name (analyst Q5 stands).

### 7. Invariants touched and the $10,000 question

| Invariant | Status |
|-----------|--------|
| Permissions are the only gating mechanism | Respected. Existing key moves; no env flag, no role-name check. |
| Auth + `hasFeature()` on every protected route/page | Respected; admin PATCH keeps session + `LEDGER_RECORD` check in-body; page keeps its own gate. |
| Admin-area protection derived from nav (DECISION-082) | Unaffected (ruling 1). |
| Outbound email deny-by-default | Respected: all sends go through `sendEmail()`/`sendBulkMemberEmail()`; no direct Resend. Test runs must not add real addresses to `EMAIL_DEV_ALLOWLIST`. |
| Bulk mail via `sendBulkMemberEmail()` | Respected (ruling 5). |
| Durable-claim helpers (DECISION-102/103) | Not applicable, confirmed (ruling 5). |
| Migrations idempotent / schema is source of truth | Respected: at most one idempotent `UPDATE features`; schema.ts comment-only edit. Number is a placeholder. |
| No personal data in repo | Respected. Copy and tests use `example.com`/`example.invalid`; no named person, no hard-coded treasurer. Do not name the board member or the motion date's attendees in DECISION-105. |
| No `window.confirm`/brand | Mark Paid and Reject remain Radix dialogs with required fields; delete `approve-reimbursement-dialog.tsx` (the only dead file this creates). |
| Duplication rule | One self-action helper (not three copies); one pure recipient helper; escaper stays the shared `escapeHtml`. |

**Where the $10,000 comes from.** It is **not** a ledger setting and not a DECISION. It is `AMOUNT_MAX = 1_000_000` (cents) hard-coded in `src/app/api/members/reimbursements/route.ts:44`, duplicated in `members/reimbursements/[id]/route.ts:49` and in the client form (`max="10000"`, two copy strings). Its origin is the 2026-06-24 ledger-controls Phase 1 adversarial note: "a reasonable ceiling — e.g., $10,000" to stop typo/abuse values; the Phase 3 design calls it "a practical limit, not a schema constraint." It was a sanity bound, never an approval threshold. The actual control threshold is `ledgerSettings.disbApprovalThresholdCents` (default $250, editable at `/admin/ledger/settings` under `ledger.manage`), which reimbursements already bypassed ("board already approved").
- **Is it a concern?** It is a real change in control posture and worth stating plainly to the treasurer, but not a design blocker. The board's decision explicitly removes the approval step, so it covers the policy; what it may not have contemplated is that (a) the form ceiling is now the effective single-person payment limit, (b) there is no cumulative or per-member cap (several $10,000 requests are each payable), and (c) an ordinary $300 vendor check still needs board approval while a $9,000 reimbursement does not. **Do not invent a threshold here** (agree with analyst N-1).
- **What to tell the treasurer / put in DECISION-105 as accepted risk:** compensating controls that survive are mandatory receipt, submitter-cannot-pay-own-request with at least two `ledger.record` holders, the Paid tab review log, bank reconciliation, and the monthly statements. Ask the board whether it wants a ceiling; the cheapest version if so is to route over-threshold reimbursements through the existing pending-disbursement path, as a follow-up decision. Backlog (low): consolidate the three copies of the $10,000 constant into one exported `REIMBURSEMENT_MAX_CENTS` (the Duplication rule counts three).

## Placement

- **Directory placement:** no new directories, files (other than the new `route.test.ts` and one optional migration), or modules. Pure recipient helper goes in `src/lib/ledger.ts`; routes stay at `src/app/api/admin/ledger/reimbursements/[id]/route.ts` and `src/app/api/members/reimbursements/{route.ts,[id]/route.ts}`.
- **Server vs Client split:** admin page stays a Server Component; Mark Paid / Reject dialogs stay `'use client'` (form state) and now receive `amountCents` + `updatedAt` (ISO) as props to echo back. Delete `src/components/admin/ledger/approve-reimbursement-dialog.tsx`. Member page remains server-rendered.
- **Dependencies:** none. (`zod` etc. not needed; validation stays hand-rolled as in the existing routes.)

## Decision text for the tech-lead to file (I did not edit `docs/decisions.md`; another pipeline holds it)

> **DECISION-105: Reimbursements no longer require board approval — the treasurer reviews and pays; the board reviews after the fact.** (Status: Resolved; Date: 2026-10-01.) Supersedes, in part, the reimbursement scope in `docs/work-log/2026-06-24-ledger-controls.md` (approval step, board `ledger.approve` notification, "locked once the board acts"); the receipt requirement, member-supplied cause, treasurer-assigned fund, resubmit-after-rejection, and private receipts stand. Cite the board meeting date/minute from the treasurer.
> 1. `reject` and `pay` gate on `ledger.record`; `ledger.approve` no longer touches reimbursements. No new key (a narrower key would let someone post expenses without the record key).
> 2. Lifecycle `submitted -> paid | rejected`; `approved` is legacy read-only; `pay` accepts `submitted` or legacy `approved`; `boardMinute` is no longer collected (column retained, DECISION-074 §6).
> 3. A reimbursement-derived transaction's `approvedByUserId`/`approvedAt` are stamped with the paying user and time; they mean "reviewed and paid by the treasurer" and are what locks the row against edit/delete/split/waive. `boardMinute` is null. On these rows approver equals recorder; the replacement segregation-of-duties rule is that the submitter may never pay or reject their own request, which requires at least two `ledger.record` holders.
> 4. `pay` carries `expectedAmountCents` + `expectedUpdatedAt` (compared in app code, never as SQL timestamp equality) and pins value columns in the atomic UPDATE; member PATCH/DELETE and admin reject gain status-conditioned atomic updates.
> 5. Submit notification goes to the Board-position Treasurer if they hold `ledger.record` (else all `ledger.record` holders minus the submitter), via `sendBulkMemberEmail()`; not a durable-claim path. Amends DECISION-086: the reimbursement `approve` CC site is gone and the submit email adds `resolveTreasurer()` as a recipient consumer with fallback-not-skip tolerance (recount the site total when filing).
> 6. **Accepted risk:** a reimbursement up to the $10,000 form ceiling (a typo guard, not a policy threshold) is paid with no second approver while a vendor expense over `disbApprovalThresholdCents` still pends for the board. The board is to confirm whether it wants a ceiling.

**Backlog text for the tech-lead to file (next free B-nn; I did not edit `docs/backlog.md`):**
- "Board-visible monthly list of reimbursements paid: a `ledger.view`-gated 'Reimbursements paid' section in admin Reports (names allowed, admin-only), optionally also in the Send-to-Board email (durable-claim path, DECISION-100/101; needs its own pipeline pass). Prerequisite for the board's after-the-fact review being more than a tab."
- "Consolidate the reimbursement $10,000 ceiling (3 copies: two routes, one form) into one exported `REIMBURSEMENT_MAX_CENTS`." (low)
- "Reimbursement register marker: transactions created by pay carry no link back to their reimbursement; add a reverse marker/column if the board wants to filter them in the register." (low)

## Open questions / handoff notes for tech-lead

- **Required of Phase 3:** R-1 (self-check on user id or member id, both actions), R-2 (legacy `approved` provenance preserved), R-4 (stale-token + value-pinned atomic WHERE, no SQL timestamp equality), R-5 (member PATCH/DELETE status-guarded), R-6 (stamp + test + coupling comment), R-7 (reject atomic guard). R-3 (reject from legacy `approved`) and the Paid-tab paging are suggestions; accept or decline in the design.
- Fold B-48 into the new `route.test.ts` as the analyst listed; add: never-edited-row pay (no false 409), reject-vs-pay race (zero-row update gives 409), member PATCH on a paid row gives 409, recipient helper table tests (treasurer ok and holder; treasurer is submitter; resolver `none`/`multiple`/`no_board_group`; treasurer not a record holder; zero recipients).
- Phase 4 implementer: this spans route + page + copy + one pure helper, roughly one API surface and one page; a specialist split (api-developer then ux-developer) is cleaner than full-stack given the three route files and the dialog changes. Optional migration goes to database-admin or the api-developer (one idempotent UPDATE); number is a placeholder to be re-derived.
- Production preconditions (treasurer, not code): the Board-position Treasurer's user holds `ledger.record`; a second `ledger.record` holder exists to pay the treasurer's own requests; count of current `submitted`/`approved` rows.
- No CLAUDE.md change required (Key Features is silent on reimbursement approval). Do not edit the 2026-06-24 work-log or v1.21 release notes.

### Outputs
- `docs/work-log/2026-10-01-reimbursements-no-board-approval.md` (this section and the status table). No other files touched; `docs/decisions.md` and `docs/backlog.md` deliberately untouched (draft text above).
- No new decision logged by me directly; DECISION-105 text drafted above for the tech-lead to file.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete
**Date:** 2026-10-01

## Summary

Collapse reimbursements to `submitted -> paid | rejected` with `ledger.record` as the single reviewer gate. No schema change, no new `FEATURES` key, no new module, no new dependency. The work is: (1) rewrite the admin `[id]` PATCH to two actions (`reject`, `pay`), gated on `LEDGER_RECORD`, with a self-action check, a stale-token check on `pay`, and status-conditioned atomic UPDATEs on both; (2) rewrite the member submit notification to go to the Board-position Treasurer (fallback: the other `ledger.record` holders) through a pure recipient helper; (3) status-guard the member PATCH/DELETE (pre-existing race); (4) stamp the paying user/time into the posted transaction's `approvedByUserId`/`approvedAt` so the existing immutability guards keep the row locked; (5) turn the Paid tab into the board's review log (paid-date order, payer, fund, paging); (6) delete the approve dialog and rewrite every statement of the old rule (copy table below); (7) one idempotent migration correcting the stale `ledger.approve` feature description. Rules filed as DECISION-106.

**Ruling differences from Phase 1/2 are listed in "Rulings that differ from Phase 1 / Phase 2" below. None reverses an architect requirement; all are additive or tightenings.**

## Permissions

No new keys. No role-binding migration.

| Surface / action | Gate | Notes |
|---|---|---|
| `GET /api/admin/ledger/reimbursements` (list), `GET .../[id]`, `GET .../[id]/receipt` | `LEDGER_VIEW` | unchanged. This is what lets `board_member` review after the fact. |
| `PATCH .../[id]` `action: "reject"` | `LEDGER_RECORD` | was `LEDGER_APPROVE`. Plus self-action block. |
| `PATCH .../[id]` `action: "pay"` | `LEDGER_RECORD` | unchanged key. Plus NEW self-action block. |
| `PATCH .../[id]` `action: "approve"` | n/a | removed; 400. |
| Admin page `/admin/ledger/reimbursements` | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` | unchanged (DECISION-082 derived proxy rule untouched; do NOT prune `LEDGER_APPROVE` from the nav entry). `canApprove` is deleted; Mark Paid + Reject sit behind `canRecord`. |
| Admin home "Pending Reimbursements" card | `LEDGER_RECORD` | was any ledger key. Board members cannot act on it any more. |
| Member `POST/PATCH/DELETE /api/members/reimbursements*` | `session.user.memberId` + ownership | unchanged. |

Default role holders of `ledger.record`: `admin`, `treasurer` (migrations 0045/0047/0104). `ledger.approve` stays on `admin` + `board_member` and keeps gating the Approvals page, pending-disbursement approve/reject, and budget approve/unlock.

**Stale description fix.** `features.description` for `ledger.approve` (seeded by `0047`) and `FEATURE_DESCRIPTIONS[FEATURES.LEDGER_APPROVE]` both say "...and reimbursements". New text, byte-identical in both places:

> `Approve and reject pending disbursements, and approve or unlock budgets`

Migration (placeholder number; the implementer re-derives the real next-free number with `ls drizzle/migrations/*.sql | sort | tail -3` at Phase 4 start — latest on disk today is `0107`, and the email-queue pipeline may claim `0108`):

`drizzle/migrations/0108_ledger_approve_description.sql`
```sql
-- ledger.approve no longer covers reimbursements (DECISION-106).
-- The description below is byte-for-byte identical to
-- FEATURE_DESCRIPTIONS[FEATURES.LEDGER_APPROVE] in src/lib/permissions.ts.
-- Idempotent: the IS DISTINCT FROM guard makes every re-run a no-op.
UPDATE features
SET description = 'Approve and reject pending disbursements, and approve or unlock budgets'
WHERE name = 'ledger.approve'
  AND description IS DISTINCT FROM 'Approve and reject pending disbursements, and approve or unlock budgets';
```
No role_features statements. (There is no existing `UPDATE features` precedent in `drizzle/migrations/`; this is the first, and it is safe because the migration runner replays everything on every deploy.)

## API Contract

### Shared pure helpers (new, in `src/lib/ledger.ts`, appended at the end of the file in one delimited "Reimbursements (DECISION-106)" section)

```ts
import type { TreasurerResolution } from "@/lib/board-positions"; // type-only: no runtime import, ledger.ts stays DB-free

/** Statuses from which a request may still be paid or rejected. "approved" is legacy (read-only, never written again). */
export const REIMBURSEMENT_ACTIONABLE_STATUSES = ["submitted", "approved"] as const;

/** True when the acting user is the request's submitter. Matches on user id OR member id.
 *  A null/undefined side never matches (null === null must NOT count). */
export function isOwnReimbursementRequest(
  actor: { id: string; memberId?: string | null },
  reimb: { submittedByUserId: string | null; submittedByMemberId: string | null },
): boolean;

export type ReimbursementNotifyReason =
  | "treasurer"
  | "fallback_resolver_none"
  | "fallback_resolver_multiple"
  | "fallback_resolver_no_board_group"
  | "fallback_submitter_is_treasurer"
  | "fallback_treasurer_lacks_record";

export function pickReimbursementNotifyRecipients(input: {
  treasurer: TreasurerResolution;       // from resolveTreasurer()
  recordHolderEmails: string[];         // getEmailsForFeature(FEATURES.LEDGER_RECORD) (users.email)
  submitterEmail: string;               // session.user.email (users.email, same table as the holder list)
  submitterMemberId: string;            // session.user.memberId
}): { recipients: string[]; reason: ReimbursementNotifyReason };

/** approvedBy/approvedAt/boardMinute to write on the posted transaction. */
export function reimbursementTransactionStamp(
  reimb: { status: string; reviewedByUserId: string | null; reviewedAt: Date | null; boardMinute: string | null },
  actingUserId: string,
  now: Date,
): { approvedByUserId: string; approvedAt: Date; boardMinute: string | null };
```

`pickReimbursementNotifyRecipients` rules (all email comparisons are trimmed + lower-cased; output preserves the holder list's own casing; output is de-duplicated):
1. `holders` = `recordHolderEmails` minus the submitter's email.
2. `!treasurer.ok` -> `{ recipients: holders, reason: "fallback_resolver_" + treasurer.reason }`.
3. `treasurer.memberId === submitterMemberId` -> `{ holders, "fallback_submitter_is_treasurer" }` (compared by member id, not email, because `resolveTreasurer()` returns `members.email` while holders are `users.email`).
4. treasurer's email not in `holders` -> `{ holders, "fallback_treasurer_lacks_record" }` (the matched-by-email intersection is the architect's "holds `ledger.record`" test; a members/users email mismatch falls through to the safe fallback).
5. else `{ recipients: [matched holder entry], reason: "treasurer" }`.
An empty `recipients` is a valid return; the route handles it (never silent).

`reimbursementTransactionStamp` rules — **this is the single home of the lock-coupling comment**:
- `reimb.status === "approved"` (legacy, R-2): `{ approvedByUserId: reimb.reviewedByUserId ?? actingUserId, approvedAt: reimb.reviewedAt ?? now, boardMinute: reimb.boardMinute }`. The `??` fallbacks guarantee `approvedAt` is never null, so a malformed legacy row can never produce an unlocked posted transaction.
- otherwise (`submitted`): `{ approvedByUserId: actingUserId, approvedAt: now, boardMinute: null }`.
- Comment block (required, so nobody "cleans up" the stamp): "On a reimbursement-derived transaction, approvedBy/approvedAt mean *reviewed and paid by the treasurer*. They are the lock: every PATCH/DELETE/split/receipt-waive guard in the transactions routes, and the edit/delete buttons in transaction-actions.tsx, key on `approvedAt`. Clearing or omitting it silently unlocks a paid reimbursement's ledger row. Board approval does not apply (DECISION-106)."

### `PATCH /api/admin/ledger/reimbursements/[id]`

Order of checks (each returns and stops):
1. `auth()` -> 401 `{ error: "Unauthorized" }`.
2. `body.action` not in `{reject, pay}` -> 400 `{ error: "action must be one of: reject, pay" }` (covers legacy `approve`; never 500).
3. `hasFeature(session.user.id, LEDGER_RECORD)` -> 403 `{ error: "Forbidden" }`. **Moved ahead of the row read** (both actions share the gate), which also removes the 404-vs-403 existence oracle the old order had.
4. `getReimbursementWithMember(id)` -> 404 `{ error: "Reimbursement not found" }`.
5. `reimb.status` not in `REIMBURSEMENT_ACTIONABLE_STATUSES` -> 409: `paid` -> "This reimbursement has already been marked paid"; `rejected` -> "This reimbursement was rejected and cannot be paid" (pay) / "This reimbursement has already been rejected" (reject).
6. `isOwnReimbursementRequest(session.user, reimb)` -> 403 `"You cannot pay your own reimbursement request"` / `"You cannot reject your own reimbursement request"`. (One call site per action, one shared predicate; no inline copies.)
7. Body validation (400s) then the action.

**reject** — body `{ action: "reject", reason: string }` (`reason` required, trimmed, max 1000). Atomic:
```
UPDATE ledger_reimbursements
SET status='rejected', reviewed_by_user_id=$u, reviewed_at=now, rejection_reason=$r, updated_at=now
WHERE id=$id AND status IN ('submitted','approved')
RETURNING id
```
Zero rows -> 409 `"This request was already processed"` and **no email** (R-7). Legacy `approved` rows are rejectable (accepting architect suggestion R-3). Then the existing best-effort member email with the treasurer CC (DECISION-086, tolerant), wrapped in try/catch that `console.warn`s (no bare `catch {}`; no addresses logged). Response 200 `{ id }`.

**pay** — body (real fields from the current handler, plus the two new tokens):
```ts
{
  action: "pay",
  fundId: string,                 // REQUIRED (not optional): active fund, 404 if missing, 400 if inactive
  categoryId: string,             // REQUIRED (DECISION-061): exists, fundKind matches the fund, flow='expense'
  paymentDate: string,            // REQUIRED, YYYY-MM-DD
  paymentMethod: "check"|"cash"|"other",   // REQUIRED
  note?: string,                  // trimmed, max 1000; becomes the txn memo (falls back to description)
  budgetLineId?: string | null,   // optional; server-validated for fund/derived-FY/category/flow, 404/400 on mismatch
  expectedAmountCents: number,    // NEW, REQUIRED integer
  expectedUpdatedAt: string,      // NEW, REQUIRED ISO-8601 string
}
```
Missing/invalid `expectedAmountCents` or `expectedUpdatedAt` -> 400 (no fallback to the old behavior; our own dialog is the only client).

Stale check, **in application code, immediately after the row read and before any fund/category lookups**: `reimb.amountCents !== expectedAmountCents || reimb.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()` -> 409 `"This request was edited after you opened it. Reload and review it again."` Never compare `updated_at` in SQL (microsecond/millisecond trap, Phase 2 ruling 4).

Write, one `db.transaction`:
1. `now = new Date()` once. `stamp = reimbursementTransactionStamp(reimb, session.user.id, now)`.
2. INSERT `ledger_transactions`: `entityId: fund.entityId, fundId, txnDate: paymentDate, flow:'expense', amountCents: reimb.amountCents, categoryId, party: "First Last", memo: note ?? description, beneficiaryCause: reimb.beneficiaryCause ?? null, budgetLineId, paymentMethod, status:'posted', approvedByUserId: stamp.approvedByUserId, approvedAt: stamp.approvedAt, boardMinute: stamp.boardMinute, recordedByUserId: session.user.id`. Comment at the insert: "status 'posted' bypasses disbApprovalThresholdCents — reimbursements carry no board-approval step (DECISION-106); stamp = lock (see reimbursementTransactionStamp)". (Replaces the three stale "board already approved" comments.)
3. Atomic UPDATE of the reimbursement:
```
SET status='paid', paid_at=now, ledger_transaction_id=$txn, fund_id=$fund, updated_at=now,
    -- submitted path ONLY (legacy keeps its real reviewer/board history, R-2):
    reviewed_by_user_id=$u, reviewed_at=now
WHERE id=$id
  AND status IN ('submitted','approved')
  AND amount_cents = $readAmount
  AND description = $readDescription
  AND receipt_storage_key = $readKey
  AND (beneficiary_cause = $readCause  |  beneficiary_cause IS NULL when the read value is null)
RETURNING id
```
`beneficiary_cause` is pinned in addition to the architect's three columns because it is copied into the transaction. Use `reimb.beneficiaryCause === null ? isNull(col) : eq(col, value)` — not `IS NOT DISTINCT FROM $n` (untyped-null parameter inference failure in Postgres). No timestamp column appears in the WHERE.
4. Zero rows -> throw `ReimbursementConflictError` (module-private class; replaces the string-matched `"DOUBLE_PAY"`), rolling the INSERT back. The catch block re-reads the row once to pick the message: now `paid` -> "This reimbursement has already been marked paid"; `rejected` -> "...was rejected and cannot be paid"; row still actionable (values changed under us) -> the stale message above. 409 either way; no email.
5. After commit, best-effort member "paid" email, treasurer CC, unchanged copy, `console.warn` instead of bare catch. Response 200 `{ id, ledgerTransactionId }`.

Status-code summary for the admin PATCH: 200 / 400 (bad action, bad body, bad fund/category/budget line, missing tokens) / 401 / 403 (no `ledger.record`; own request) / 404 (row, fund, category, budget line) / 409 (not actionable; already processed; stale tokens).

### `POST /api/members/reimbursements` (submit) — notification rewrite only

Validation, duplicate guard, insert, `$10,000` ceiling: unchanged. After the insert, inside the existing isolation (never fails the 201):
1. `row = getReimbursementWithMember(newId)` (gives submitter first/last name).
2. `[treasurer, holders] = await Promise.all([resolveTreasurer(), getEmailsForFeature(FEATURES.LEDGER_RECORD)])`.
3. `pick = pickReimbursementNotifyRecipients({ treasurer, recordHolderEmails: holders, submitterEmail: session.user.email, submitterMemberId: session.user.memberId })`.
4. `pick.recipients.length === 0` -> `console.error("[Reimbursement notify] no recipients", { reimbursementId, reason: pick.reason })`; return 201 without sending. (The admin-home card and the Awaiting tab are the backstop.)
5. else `sendBulkMemberEmail({ from, subject: "New reimbursement request — $X", recipients: pick.recipients.map(to => ({ to, html })) })` — one code path for one or many recipients (architect ruling 5). Inspect `results`: any `!success` -> `console.warn("[Reimbursement notify] send failed", { reimbursementId, reason: pick.reason, failed, total })`. `blocked` non-production sends return `success: true` and are not warnings. No addresses in logs.
6. `catch (e)` -> `console.warn("[Reimbursement notify] threw", { reimbursementId, message })`. No bare `catch {}`.
7. If `pick.reason !== "treasurer"`, also `console.warn("[Reimbursement notify] fallback recipients", { reimbursementId, reason })` (the resolver-failure visibility the analyst asked for).

Email copy (HTML; `escapeHtml()` on submitter name, description, cause; `amountDollars` and `appUrl` stay unescaped as the existing comment explains):
```
<p>{escapeHtml(name)} has submitted a reimbursement request that is waiting for your review.</p>
<ul>
  <li><strong>Submitted by:</strong> {escapeHtml(name)}</li>
  <li><strong>Amount:</strong> ${amountDollars}</li>
  <li><strong>Description:</strong> {escapeHtml(description)}</li>
  {cause ? <li><strong>Cause:</strong> {escapeHtml(cause)}</li> : ""}
</ul>
<p>Review the request, then mark it paid or reject it, at <a href="{appUrl}/admin/ledger/reimbursements">{appUrl}/admin/ledger/reimbursements</a>.</p>
```
Subject unchanged. "requires board review" is removed. Rewrite the E-2 docblock/comments (they say "every LEDGER_APPROVE holder — i.e. the board").

**Durable-claim confirmation (one line, per CLAUDE.md's exception):** this path writes no `sentAt`, no partial-unique success row, no append-only "sent" history; the only record is the `email_queue` transport row `sendEmail()` already writes. `sendBulkMemberEmail()` is correct; `sendBulkMemberEmailForDurableClaim()` must NOT be used; the Phase 2 durable-claim exception is not triggered. Same for the member-facing paid/rejected emails (plain `sendEmail()` + CC).

### `PATCH` and `DELETE /api/members/reimbursements/[id]`

- PATCH: final write becomes `.where(and(eq(id), eq(status,'submitted'))).returning({ id })`; zero rows -> 409 `"This request was already processed and can no longer be changed"`.
- DELETE: already status-conditioned; zero-row message changes to 409 `"This request was already processed and can no longer be withdrawn"` (was 403 + "can no longer be withdrawn").
- Pre-read non-`submitted` branch in both: 403 -> **409** with the same messages, so one condition has one status code (the only client displays `data.error`; no caller branches on 403). Header comment: "Locked once the treasurer pays or rejects it".
- Ownership 404 and the rest unchanged.

### `GET /api/admin/ledger/reimbursements` (list) and `listReimbursementsForAdmin()`

`listReimbursementsForAdmin` (in `src/lib/ledger-queries.ts`; add, do not restructure) returns `{ reimbursements: ReimbursementAdminRow[]; total: number }` where
```ts
export type ReimbursementAdminRow = ReimbursementWithMember & {
  paidByName: string | null;   // coalesce(users.name, users.email) of ledger_transactions.recorded_by_user_id
  fundName: string | null;     // ledger_funds.name via ledger_reimbursements.fund_id
};
```
LEFT JOINs: `ledger_transactions lt ON lt.id = r.ledger_transaction_id`, `users pu ON pu.id = lt.recorded_by_user_id`, `ledger_funds f ON f.id = r.fund_id`. "Paid by" is defined **once, as the linked transaction's `recordedByUserId`** (always the payer, legacy and new rows alike), never `reviewedByUserId`. Ordering: `status = 'paid'` -> `paid_at DESC NULLS LAST, submitted_at DESC`; every other status keeps `submitted_at DESC`. `limit`/`offset` already exist. The list route is documented as returning the two extra fields; no behavior change otherwise. `getReimbursementWithMember` and `ReimbursementWithMember` are unchanged.

## Data Model

No schema changes. `ledger_reimbursements.status` has no CHECK, `board_minute` stays nullable (DECISION-074 section 6), no new column/index. `src/lib/db/schema.ts`: comment-only edits at the `ledgerReimbursements` header (~1491-1493: "requires board approval... submitted -> approved | rejected -> paid" becomes "Lifecycle: submitted -> paid | rejected; 'approved' is a legacy read-only status from the board-approval era, never written (DECISION-106)"), the `status` valid-values comment (~1516), and `boardMinute` ("legacy: collected only before DECISION-106"). `db:push` sees no diff. One data migration: the idempotent `UPDATE features` above.

## Component / Page Plan

**Files to delete:** `src/components/admin/ledger/approve-reimbursement-dialog.tsx` (the only dead file this creates; remove its import from the admin page).

**Files to create:** `src/app/api/admin/ledger/reimbursements/[id]/route.test.ts`, `src/app/api/members/reimbursements/route.test.ts`, `src/app/api/members/reimbursements/[id]/route.test.ts`, `src/lib/ledger-reimbursement.test.ts`, the migration above.

**API layer (api-developer):**
- `src/lib/ledger.ts` — helpers above (appended section). Comment-only: nothing else.
- `src/lib/ledger-queries.ts` — extend `listReimbursementsForAdmin`; add `ReimbursementAdminRow`. (Do not touch other regions: another pipeline has uncommitted edits in this file.)
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` — rewrite per contract; rewrite the docblock (two actions; gates; self-action; stale tokens; `approved` is legacy).
- `src/app/api/admin/ledger/reimbursements/route.ts` — docblock only.
- `src/app/api/members/reimbursements/route.ts` — notification rewrite; docblock/E-2 comments.
- `src/app/api/members/reimbursements/[id]/route.ts` — atomic PATCH, 409s, header.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — header comment only: one line naming the coupling ("Reimbursement-derived transactions are locked by this same approvedAt guard; the reimbursement pay action stamps approvedAt deliberately — DECISION-106").
- `src/lib/permissions.ts` — comment at `:70` and description at `:223`.
- `src/lib/db/schema.ts` — comments only.

**UI layer (ux-developer):**
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` (Server Component, keeps its own `auth()` + `hasAnyFeature` gate):
  - Remove `canApprove`, the `ApproveReimbursementDialog` import and usage.
  - Tab key `submitted` is kept (existing `?tab=submitted` links and email links keep working); its label becomes **"Awaiting action"**. The Approved tab is rendered only when its count > 0 or it is the active tab, labelled "Approved (legacy)". Default tab: `submitted` for `LEDGER_RECORD` holders; **`paid` for users without `LEDGER_RECORD`** (a view-only board member has nothing to act on).
  - Badges: `submitted` -> "Awaiting Treasurer"; `approved` -> "Approved — Awaiting Payment" (legacy only).
  - Subtitle: "Member expense reimbursements. The treasurer reviews each request, then marks it paid, which posts the expense to the fund ledger, or rejects it. The board reviews paid requests afterward on the Paid tab."
  - Awaiting and Approved(legacy) tabs: `Mark Paid` (`PayReimbursementDialog`) + `Reject` behind `canRecord`. Own row (`isOwnReimbursementRequest({ id: session.user.id, memberId: session.user.memberId }, r)`): replace both with italic text "Submitted by you — another reviewer must act on it". Buttons: `min-h-[44px]` (carry-over fix, in files we are touching anyway).
  - `Min: {boardMinute}` shown only on rows that have one, labelled "Board minute (historical)".
  - Paid tab: one sentence above the table: "Paid reimbursements are listed here, newest payment first, for board review. Each one is also posted to the ledger as an expense." Status cell shows "Paid {date}", "by {paidByName}", "Fund: {fundName}"; keep the receipt link and the `Txn:` text.
  - Paging: `?page=N` (positive int, default 1), 50 per page, `offset = (page-1)*50`; replace the "Showing first 50 of N" footer with "Showing X–Y of N" plus Previous/Next links that preserve `tab`. Applies to every tab; matters on Paid.
  - Empty states per tab (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`): awaiting "No reimbursement requests are waiting for review." + "Members submit requests from their member portal."; approved "No legacy approved requests."; rejected "No rejected reimbursement requests."; paid "No paid reimbursements yet."
  - Pass `amountCents={r.amountCents}` and `updatedAt={r.updatedAt.toISOString()}` to `PayReimbursementDialog`.
- `src/components/admin/ledger/pay-reimbursement-dialog.tsx` — props gain `amountCents: number`, `updatedAt: string`; the PATCH body sends `expectedAmountCents` and `expectedUpdatedAt` unchanged from props. On any 409: show the server's message verbatim, close the dialog, `router.refresh()` so the treasurer sees the new numbers. Dialog description: "{member} — {amount}. Choose the fund and category and confirm payment. This posts the expense to the ledger right away; there is no further approval step." Everything else (fund/category/budget-line pickers, success toast) stays.
- `src/components/admin/ledger/reject-dialog.tsx` — `RejectReimbursementDialog` unchanged (no stale tokens on reject, by design); only a comment/copy sweep if it mentions the board.
- `src/app/(dashboard)/admin/page.tsx` — narrow the Pending Reimbursement card: replace `canViewLedger` with `canActOnReimbursements = userFeatures.includes(FEATURES.LEDGER_RECORD)` for both the query and the card; rewrite the comment (it already says "only for users who could actually act").
- `src/app/members/reimbursements/page.tsx` — copy per table; `Authorized:` line becomes "Board minute (historical): {boardMinute}" and shows only when non-null.
- `src/components/members/reimbursement-form.tsx` — toast copy per table.
- `src/components/admin/ledger/guide/reimbursements-section.tsx` — rewrite (below).
- `src/components/admin/ledger/guide/books-register-section.tsx:23` — verify only (the sentence is still true for disbursements; the section it points to is rewritten so it no longer implies reimbursements are in that queue). No edit expected.

### Copy table (every statement of the old rule, from the Phase 1 inventory, with its disposition)

| File | Change | Owner |
|---|---|---|
| `src/app/api/members/reimbursements/route.ts` (~185 email body + docblock/E-2 comments) | "...requires board review" -> "...is waiting for your review" + submitter name; comments rewritten for treasurer recipient | api |
| `src/components/members/reimbursement-form.tsx:118` | toast -> "Submitted. The treasurer will review it and you'll get an email when it's paid." | ux |
| `src/app/members/reimbursements/page.tsx:114` | "The treasurer reviews your request, assigns the fund, and pays it. You will receive an email when the status changes." | ux |
| `src/app/members/reimbursements/page.tsx:30` | badge "Awaiting Review" -> "Awaiting Treasurer" | ux |
| `src/app/members/reimbursements/page.tsx:33-34` | "Approved — Awaiting Payment" kept for legacy rows | ux (no change) |
| `src/app/members/reimbursements/page.tsx:177-181` | "Authorized: {boardMinute}" -> "Board minute (historical): {boardMinute}", non-null only | ux |
| `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` | badge, subtitle, tab label, Approve button removed, Reject/Mark Paid behind `canRecord`, self label, "Min:" legacy-only, Paid-tab sentence | ux |
| `src/components/admin/ledger/approve-reimbursement-dialog.tsx` | delete | ux |
| `src/app/api/admin/ledger/reimbursements/[id]/route.ts` | docblock; approve branch + email removed; error strings; the three "board already approved" comments | api |
| `src/app/api/members/reimbursements/[id]/route.ts` header | "Locked once the treasurer pays or rejects it" | api |
| `src/lib/permissions.ts:70` comment, `:223` description | "...pending disbursements" (+ budget approve/unlock) | api |
| migration `0108_*` | `features.description` UPDATE | api |
| `src/lib/db/schema.ts:1491-1493, :1516, boardMinute` | comments only | api |
| `src/components/admin/ledger/guide/reimbursements-section.tsx` | rewrite (below) | ux |
| `src/components/admin/ledger/guide/books-register-section.tsx:23` | verify; no change expected | ux |
| `src/app/(dashboard)/admin/page.tsx` | Pending card narrowed to `ledger.record`; comment | ux |
| `docs/decisions.md` (DECISION-106 + DECISION-086 amendment), `docs/backlog.md` | filed by tech-lead, done | tech-lead |
| `CLAUDE.md` | no change (Key Features is silent on reimbursement approval) | none |
| `docs/release-notes/v1.21.md`, `docs/work-log/2026-06-24-ledger-controls.md` | history; do NOT edit | none |

### Treasury guide section rewrite (`reimbursements-section.tsx`)

Keep `id="reimbursements"` and the heading "Reimbursements & Approvals" (the guide's TOC anchor and label in `guide/page.tsx:33` stay). Replace the body: members submit requests, which move **submitted -> paid** (or **rejected**); the treasurer, or anyone else holding the Record permission, reviews the receipt, then marks it paid (which posts the expense straight to the fund ledger, outside the approval threshold) or rejects it with a reason; there is no board approval step, and the board reviews paid reimbursements afterward on the Paid tab, which lists who paid each one and from which fund. You cannot pay or reject your own request: a second person with the Record permission must, so keep at least two. The **Approvals** queue is for disbursements over the approval threshold and transfers only, not reimbursements. A short note: requests the board approved under the old process still appear under "Approved (legacy)" and can be paid or rejected. Keep the existing blue box about the Approvals page's stricter gate and both links. Update the file's header doc-comment. No dates, no names.

## Implementation Order

**Implementer: specialist split, api-developer first, then ux-developer** (justification below). database-admin is not needed: there is no schema change; the single idempotent `UPDATE features` is a one-statement data fix and rides with the api-developer rather than adding a third handoff.

Pre-step (sequencing): `docs/work-log/2026-10-01-aged-public-fund-fifo.md` has uncommitted edits in `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/ledger.test.ts`, and `package.json`. Phase 4 should start after that work is committed, or the implementer must touch only the regions named here and the user must stage by hunk. Re-read each file immediately before editing.

1. **api-developer — pure helpers first** (`ledger.ts` section + `src/lib/ledger-reimbursement.test.ts`). Fast, DB-free, and everything else depends on their signatures.
2. `ledger-queries.ts` `listReimbursementsForAdmin` extension.
3. Admin `[id]` route rewrite + `route.test.ts`.
4. Member routes (submit notification, `[id]` guards) + their tests.
5. Migration (re-derive the number), `permissions.ts` description + comment (byte-identical to the migration string), `schema.ts` comments, transactions-route coupling comment, list-route docblock.
6. **Handoff gate (api-developer -> ux-developer):** `pnpm test` and `pnpm exec tsc --noEmit` pass. The api-developer appends a "Phase 4a handoff" note to this work-log restating the contract the UI is built on (below).
7. **ux-developer** — page, pay dialog, delete approve dialog, admin-home card, member page/form copy, guide section.
8. Phase 4 gate: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm lint`, `pnpm build:only`; no native dialogs; no `console.log`; every unit test named below exists and passes.
9. At ship: release notes via `/release-notes` (below).

**Handoff contract (api -> ux).** The UI may rely on exactly this; anything else is a loop-back:
- Pay body: `{ action:"pay", fundId, categoryId, budgetLineId?, paymentDate, paymentMethod, note?, expectedAmountCents, expectedUpdatedAt }`; reject body: `{ action:"reject", reason }`; `approve` no longer exists.
- Any 409 from pay means "reload"; the message is user-presentable and shown verbatim.
- `listReimbursementsForAdmin({ status, limit, offset })` -> `{ reimbursements: ReimbursementAdminRow[], total }`; `updatedAt` is a `Date`; `paidByName`/`fundName` are `string | null`; Paid is ordered by `paid_at DESC`.
- `isOwnReimbursementRequest`, `REIMBURSEMENT_ACTIONABLE_STATUSES` are exported from `@/lib/ledger` (client-safe: no DB import).

**Why not full-stack-developer:** this is one new pure-helper module section, three route files with concurrency semantics, a query extension, a migration, three test files, and six UI surfaces: well past the ~150-line coupled threshold. The API carries a real contract (stale tokens, 409 semantics, a new paged/joined list shape) that the UI is built on, the same shape as the minutes browse/search precedent, and the race-condition details deserve an implementer focused on the server side alone.

## Unit tests the implementer must deliver (Phase 4 gate)

Hermetic pattern: mock `@/lib/auth`, `@/lib/permissions-server`, `@/lib/ledger-queries`, `@/lib/email`, `@/lib/board-positions`, `@/lib/email-compose`, and `@/lib/db` (a hand-built fake: `db.transaction(cb)` runs `cb(tx)`; `tx.insert().values().returning()` and `tx.update().set().where().returning()` are `vi.fn` chains so `.values()` / `.set()` arguments can be captured and the `.returning()` result controls the zero-row case; fund/category lookups are sequenced `mockResolvedValueOnce`). To assert WHERE clauses, serialize the captured argument with `new PgDialect().sqlToQuery(where)` (`drizzle-orm/pg-core`) and assert on `.sql` and `.params`. Use `example.com` / `example.invalid` addresses only; never add a real address to `EMAIL_DEV_ALLOWLIST` (the `@/lib/email` module is mocked, so nothing can send).

**`src/lib/ledger-reimbursement.test.ts` (pure)**
1. `isOwnReimbursementRequest`: matches on user id; matches on member id with a different user id; **matches on user id when `actor.memberId` is null/undefined** (the R-1 hole); neither matches -> false; both sides null -> false (`null === null` trap); submitter member id null and actor member id null -> false.
2. `pickReimbursementNotifyRecipients` table: treasurer ok + holds record -> `[treasurer]`, `reason "treasurer"`; email match is case-insensitive and whitespace-trimmed; treasurer ok but not a holder -> `fallback_treasurer_lacks_record` with holders minus submitter; `treasurer.memberId === submitterMemberId` -> `fallback_submitter_is_treasurer`; resolver `none`, `multiple`, `no_board_group` -> matching `fallback_resolver_*`; submitter removed from holders case-insensitively; duplicates collapsed; zero holders -> `recipients: []` with a reason (no throw).
3. `reimbursementTransactionStamp`: `submitted` -> acting user, `now`, `boardMinute null`; legacy `approved` with full history -> copies reviewer/time/minute; legacy `approved` with null `reviewedAt`/`reviewedByUserId` -> falls back to acting user/`now` (`approvedAt` is never null); legacy minute preserved even when the acting user differs.

**`src/app/api/admin/ledger/reimbursements/[id]/route.test.ts` (new; folds in B-48's reimbursement-route half)**
4. 401 unauthenticated.
5. `action: "approve"` -> 400 with the exact message; same for missing/unknown action; no DB read occurs.
6. A user holding only `ledger.approve` (the `hasFeature` mock is true only for `LEDGER_APPROVE`) gets 403 on both `reject` and `pay`; `hasFeature` was asked for `LEDGER_RECORD`.
7. 404 on a missing row.
8. Self-pay and self-reject -> 403 with the exact strings, in three variants each: user id matches; member id matches with a different user id; user id matches while `session.user.memberId` is undefined.
9. A different `ledger.record` holder pays and rejects the same request -> 200.
10. `pay` from `submitted` -> 200: the captured txn insert has `status "posted"`, `approvedByUserId === acting user`, `approvedAt` a `Date`, `boardMinute === null`, `recordedByUserId === acting user`; the captured reimbursement update has `status "paid"`, `paidAt`, `reviewedByUserId === acting user`, `reviewedAt`.
11. `pay` from legacy `approved` -> 200: the txn insert copies `approvedByUserId`/`approvedAt`/`boardMinute` from the row; the reimbursement update does NOT set `reviewedByUserId`, `reviewedAt`, or `boardMinute`.
12. `pay` from `paid` -> 409 and from `rejected` -> 409; `db.transaction` never called.
13. Double-pay race: the read says `submitted`, the atomic update returns `[]` -> 409, the insert is not committed (the error propagates out of the transaction callback), no email sent.
14. Atomic pin: the captured pay-update WHERE, serialized, contains `status in (...)` for both `submitted` and `approved`, and its params include the read amount, description, and receipt key (and the cause when non-null; `is null` when null); **no `updated_at` appears in it**.
15. Stale token: `expectedAmountCents` differs -> 409 with the exact stale message and no `db.transaction`; `expectedUpdatedAt` differs -> 409; either token missing/invalid -> 400.
16. **Never-edited row:** a row whose `updatedAt` equals its `submittedAt` (no member edit ever) with matching tokens -> 200 (guards the false-409 trap); the token is compared via `getTime()` of the ISO string, so the equal-instant case passes.
17. Retained validations still 400/404: missing `fundId`/`categoryId`/`paymentDate`/`paymentMethod`; category fundKind mismatch; budget line mismatch.
18. `reject` from `submitted` -> 200 and the captured update WHERE includes the actionable-status set; legacy `approved` is rejectable -> 200 (R-3); missing `reason` -> 400.
19. `reject` on a `paid` row -> 409 pre-read; **reject race** (read `submitted`, atomic update returns `[]`) -> 409 and no email (R-7).
20. Treasury CC (B-48): paid and rejected emails carry `cc === treasurer.email` when `resolveTreasurer()` is ok; when it returns `{ ok:false }` the email is sent with no `cc` key, `console.warn` is called, and the response is still 200; a throwing `sendEmail` still yields 200.

**`src/app/api/members/reimbursements/route.test.ts` (new; B-48's submit half)**
21. 401; 403 when `session.user.memberId` is missing.
22. Happy path: 201; exactly one `sendBulkMemberEmail` call; recipients `[treasurer's holder entry]`; body contains the submitter name (escaped), the escaped description (a `<script>` payload is neutralized), the amount and the admin link; body does NOT contain "board review"; `getEmailsForFeature` called with `LEDGER_RECORD` and never `LEDGER_APPROVE`.
23. Fallback: resolver `none` / `multiple` / `no_board_group`, treasurer is the submitter, and treasurer lacks `ledger.record` each send to the record holders minus the submitter and emit a `console.warn` whose arguments include the reason and contain no email address.
24. Zero recipients -> `console.error` with the reimbursement id, `sendBulkMemberEmail` not called, still 201.
25. `sendBulkMemberEmail` throws -> still 201; resolved with a `success:false` result -> warn with counts; a `blocked` (success true) result -> no warn.

**`src/app/api/members/reimbursements/[id]/route.test.ts` (new)**
26. PATCH on a `paid` row (pre-read) -> 409; PATCH where the read says `submitted` but the atomic update returns `[]` -> 409 (the interleaved-with-pay case, R-5); the captured WHERE includes `status = 'submitted'`.
27. DELETE: same two cases -> 409 with the "already processed" message.
28. Another member's id -> 404 (existence not leaked); owner PATCH/DELETE on a `submitted` row -> 200.

## E2E impact

`grep -rniE "reimburs|approve-reimb|Mark Paid" e2e/` returns **nothing**: no Playwright spec touches reimbursements, so no existing spec clicks Approve and none needs to change. No new e2e spec is required for this change (the flow posts a ledger row and would send mail; the unit suite plus QA's manual click-through is the right coverage). qa may add a smoke spec if cheap; it is not a gate. The `src/lib/admin-page-feature-gates.test.ts` check still passes because the page keeps its own `auth()` + `hasAnyFeature()` gate.

## Release notes

**Version: 1.85.0** (minor: a governance rule changes; new file `docs/release-notes/v1.85.md`; `package.json` -> `1.85.0`). Use the `/release-notes` skill at ship time. Entry content (value first, no file lists): *Reimbursements no longer need board approval.* Members still submit with a receipt; the treasurer is emailed and reviews each one, then marks it paid (which posts the expense) or rejects it with a reason. The board reviews paid reimbursements afterward on the Paid tab, which now shows who paid each one and from which fund, newest payment first, with paging. Worth knowing: you cannot pay or reject your own request, so at least two people must hold the Record permission; reimbursements are no longer subject to the approval threshold; requests the board already approved can still be paid or rejected; an edit a member makes while the treasurer has the pay form open is caught and the treasurer is asked to reload.

**Ordering with the aged-fund fix (1.84.1) and the email-queue retention pipeline.** Right now `package.json` already reads `1.84.1` and `docs/release-notes/v1.84.md` already carries the 1.84.1 entry, both as uncommitted working-tree edits of the aged-fund pipeline. Rule: **each pipeline re-reads `package.json`, `git log -- package.json`, and `ls docs/release-notes/` at the moment it prepares to push, and bumps relative to what is on `main` then, never relative to what this document says.**
- Expected order (aged-fund first, since its edits are already in the tree): aged-fund ships as 1.84.1 in `v1.84.md`; this change then bumps `1.84.1 -> 1.85.0` and creates `v1.85.md`.
- If this change ships first: it ships as 1.85.0; the aged-fund fix then becomes **1.85.1**, its entry moves from `v1.84.md` to `v1.85.md` (remove the uncommitted 1.84.1 section from `v1.84.md`), and its `package.json` edit is rebased to `1.85.1`.
- Any later patch (e.g., the retention pipeline, if it ships after this) bumps from whatever `main` holds (`1.85.x`).

## Edge Cases & Risks

- **Single point of failure on notification** (analyst N-4): mitigated by fallback recipients, `console.warn`/`console.error` (no addresses), and the card + Awaiting tab backstop. The empty-recipient path still returns 201.
- **Treasurer has no `ledger.record`, or only one holder exists:** the fallback covers the first; the second makes the treasurer's own request unpayable. Surfaced in the UI ("another reviewer must act on it") and in the guide. This is a production precondition, not code: see below.
- **Threshold bypass is now unconditional** (N-1, accepted risk in DECISION-106): a reimbursement up to the $10,000 form ceiling posts with no second approver while a $300 vendor check pends for the board. Compensating controls that remain: mandatory receipt, submitter-cannot-pay-own, two `ledger.record` holders, the Paid-tab review log, bank reconciliation, the monthly statements. Tell the treasurer at ship time; ask whether the board wants a ceiling.
- **Stale token vs. legacy `approved` rows:** members cannot edit approved rows, so tokens always match; the contract is deliberately uniform (the dialog always sends them).
- **`updatedAt` precision:** never compared in SQL. Tests 14 and 16 guard it.
- **Immutability regression guard:** if anyone drops the stamp, five lock sites silently open. Guarded by `reimbursementTransactionStamp` (single comment) + tests 3 and 10.
- **Member withdraw racing a pay:** DELETE's zero-row branch now returns the generic "already processed" message instead of the misleading "already paid".
- **Mobile 360px:** the action cell holds two controls; `min-h-[44px]` and the existing `overflow-x-auto` table cover it.
- **Brand:** buttons `rounded-lg`, cards `rounded-2xl`, no `lions-red`, no native dialogs (Mark Paid/Reject are Radix dialogs with required fields).
- **Another maintainer's concurrent edits:** `ledger.ts`/`ledger-queries.ts` are hot files; see the pre-step.

**Production preconditions for the treasurer (not code; confirm before or at ship):** (a) the member holding Board position `Treasurer` has a user holding `ledger.record` (the `treasurer` role); (b) a second `ledger.record` holder exists to pay the treasurer's own requests; (c) count of current `submitted`/`approved` rows (gives qa the legacy-path scope); (d) the board motion's minute reference (DECISION-106 currently cites it as "to be supplied by the treasurer").

## Out of Scope

- A ceiling or per-member cap on reimbursements; the $10,000 constant consolidation (B-84).
- A "request received" email to the member; a board digest email.
- The board-visible monthly "Reimbursements paid" report section and any change to the Send-to-Board email (B-83; durable-claim path, needs its own pipeline pass).
- A reverse marker from a ledger transaction back to its reimbursement (B-85).
- Dropping or renaming the `approved` status value or the `board_minute` / `reviewed_*` columns.
- Editing the 2026-06-24 work-log or v1.21 release notes.
- The two `transactions/route.ts` treasury-CC sites from B-48 (they remain open under B-48).

## Rulings that differ from Phase 1 / Phase 2 (all additive or tightening)

1. **`isOwnReimbursementRequest` is a shared pure export in `ledger.ts`, not a route-local helper.** The architect asked for one local helper for two call sites; the admin page is a third consumer (the "Submitted by you" label), and the Duplication rule counts three. Same user-id-OR-member-id semantics, with an explicit "null never matches" rule.
2. **Recipient helper takes `submitterMemberId` in addition to the architect's three inputs**, so "treasurer is the submitter" is decided by member id (robust to the members.email / users.email mismatch) rather than email. Reason enum spelled out; empty `recipients` is a valid return handled by the route.
3. **Two extra pure helpers:** `REIMBURSEMENT_ACTIONABLE_STATUSES` (used at four places in one route) and `reimbursementTransactionStamp` (single home of the lock-coupling comment; legacy `??` fallbacks so `approvedAt` can never be null).
4. **The atomic pay WHERE also pins `beneficiary_cause`** (`isNull` / `eq`), because it is copied onto the transaction. The architect listed amount, description, receipt key.
5. **Feature gate runs before the row read** in the admin PATCH (both actions share `LEDGER_RECORD`); removes the 404/403 existence oracle.
6. **Member PATCH/DELETE pre-read "already reviewed" moves from 403 to 409**, matching the architect's 409 for the zero-row case so one condition has one status.
7. **Migration is authored by the api-developer, not database-admin** (no schema change; one `UPDATE`).
8. **Paid-tab paging is `?page=N`, 50 per page, Previous/Next links**, applied to every tab; the architect accepted either "Load more" or a notice.
9. **View-only users default to the Paid tab.** Small addition so a board member does not land on an empty work queue.
10. **Reject carries no stale token** (a reject cannot post a wrong amount; the reason applies regardless).
11. **Helper unit tests go in a new `src/lib/ledger-reimbursement.test.ts`** rather than `ledger.test.ts`, which has a large uncommitted diff from the aged-fund pipeline.
12. **`fundId` is required on pay** (the brief wrote `fundId?`); the real handler requires fund, category, date, and method.
13. **No e2e specs exist for reimbursements**; nothing to update.

## Outputs

- This section and the status table in `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`.
- `docs/decisions.md`: DECISION-106 filed; DECISION-086 amended (the five treasury-CC sites are now four; the submit email adds a `resolveTreasurer()` recipient consumer).
- `docs/backlog.md`: B-83 (reimbursements-paid report, normal priority, Soon), B-84 and B-85 (Later); B-48 annotated (reimbursement-route half folded into this change; the two transactions-route sites remain).
- No code touched.

## Open questions / handoff notes

- **Phase 4a:** use the **api-developer** agent first (helpers + tests, query, three routes + tests, migration, comments), starting after the aged-fund pipeline's `ledger.ts`/`ledger-queries.ts` edits are committed. Write the "Phase 4a handoff" note with the contract above.
- **Phase 4b:** use the **ux-developer** agent second (page, dialogs, card, member copy, guide).
- Phase 5 (qa): reproduce the original bug-shaped risks, not just the happy path: pay while a member edits (stale 409), two reviewers racing pay/reject (409), a treasurer-submitted request (own-request label; second holder pays), a legacy `approved` row (payable and rejectable; stamp preserved), the posted transaction is locked (edit/delete 403), board member sees the Paid tab with payer/fund and no action buttons, the admin-home card is hidden from a board member. Confirm no mail leaves the machine (deny-by-default).
- Still needed from the user: the exact board meeting date / minute reference (DECISION-106 cites it generically for now), and the production preconditions above.

---

# Phase 4 — Implementation (API) — 2026-10-01

**Owner:** api-developer
**Status:** complete (server half; ux-developer's UI half pending)

## Summary

Server side of DECISION-106 is built to the Phase 3 design: three pure helpers plus a constant in `src/lib/ledger.ts`, the extended paged/ordered admin list query, the admin PATCH rewrite (reject + pay, both on `ledger.record`), the member submit notification rewrite, status-guarded member PATCH/DELETE, the `ledger.approve` description fix with its migration, and every named unit test. Gate: `pnpm exec tsc --noEmit` clean, `pnpm test` green (140 files, 2412 tests), `pnpm build:only` passes.

## What I did

- `ledger.ts`: appended the "Reimbursements (DECISION-106)" section (`REIMBURSEMENT_ACTIONABLE_STATUSES`, `isOwnReimbursementRequest`, `pickReimbursementNotifyRecipients`, `reimbursementTransactionStamp` with the lock-coupling comment) and one type-only import of `TreasurerResolution`. Nothing of the aged-fund edits was touched.
- `ledger-queries.ts`: added `ReimbursementAdminRow`; extended `listReimbursementsForAdmin` (LEFT JOINs to the linked transaction's recorder, and the fund; Paid ordered `paid_at DESC NULLS LAST, submitted_at DESC`). Other regions untouched.
- Admin `[id]` PATCH rewritten per the contract (gate before row read, single self-action predicate, stale tokens compared in app code, atomic UPDATEs on both actions, module-private `ReimbursementConflictError`, member emails through one local `sendMemberEmail` helper with the treasurer CC and a `console.warn` instead of a bare catch).
- Member POST: treasurer-first recipient with fallback, submitter name in the email, "requires board review" gone, `results[]` inspected, warns carry ids/reasons/counts only.
- Member PATCH/DELETE: status-conditioned writes, pre-read and zero-row cases are 409.
- `permissions.ts` comment + description, `schema.ts` comments (header, status valid values, `boardMinute`), transactions `[id]` route header coupling comment, list route docblock.

## Outputs

Files created:
- `drizzle/migrations/0108_ledger_approve_description.sql` (next free number re-derived at write time: 0107 was latest on disk)
- `src/lib/ledger-reimbursement.test.ts` (21 tests)
- `src/app/api/admin/ledger/reimbursements/[id]/route.test.ts` (41)
- `src/app/api/members/reimbursements/route.test.ts` (12)
- `src/app/api/members/reimbursements/[id]/route.test.ts` (8)

Files modified: `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/permissions.ts`, `src/lib/db/schema.ts` (comments only), `src/app/api/admin/ledger/reimbursements/[id]/route.ts`, `src/app/api/admin/ledger/reimbursements/route.ts` (docblock), `src/app/api/admin/ledger/transactions/[id]/route.ts` (header comment), `src/app/api/members/reimbursements/route.ts`, `src/app/api/members/reimbursements/[id]/route.ts`.

Schema changes: none. Migration: the one idempotent `UPDATE features` above; its string is byte-identical to `FEATURE_DESCRIPTIONS[FEATURES.LEDGER_APPROVE]`.

### Handoff contract for ux-developer (Phase 4b)

`PATCH /api/admin/ledger/reimbursements/[id]` (gate `ledger.record`; `approve` no longer exists and returns 400 "action must be one of: reject, pay"):
- Reject body: `{ action: "reject", reason: string }` (required, trimmed, max 1000). 200 `{ id }`.
- Pay body: `{ action: "pay", fundId, categoryId, paymentDate: "YYYY-MM-DD", paymentMethod: "check"|"cash"|"other", note?, budgetLineId?, expectedAmountCents: integer, expectedUpdatedAt: ISO string }`. `expectedAmountCents` and `expectedUpdatedAt` must be the row's `amountCents` and `updatedAt.toISOString()` as the page rendered them; missing or invalid is 400. 200 `{ id, ledgerTransactionId }`.
- Error payloads are always `{ error: string }` with a user-presentable message. 409s, all of which mean "reload": stale tokens "This request was edited after you opened it. Reload and review it again."; "This reimbursement has already been marked paid"; "This reimbursement was rejected and cannot be paid" (pay) / "This reimbursement has already been rejected" (reject); "This request was already processed" (reject race). 403: "You cannot pay your own reimbursement request" / "You cannot reject your own reimbursement request" / "Forbidden". 400/404 messages are unchanged from before.

`PATCH` and `DELETE /api/members/reimbursements/[id]`: the "already reviewed" cases are now **409** (were 403) with `{ error: "This request was already processed and can no longer be changed" }` (PATCH) / `"...can no longer be withdrawn"` (DELETE). Ownership miss stays 404. Check the member form/page for any branch on 403.

`POST /api/members/reimbursements`: request/response unchanged (201 `{ id }`).

Query: `listReimbursementsForAdmin({ status?, memberId?, limit = 50, offset = 0 }): Promise<{ reimbursements: ReimbursementAdminRow[]; total: number }>` from `@/lib/ledger-queries`, where `ReimbursementAdminRow = ReimbursementWithMember & { paidByName: string | null; fundName: string | null }`. `updatedAt` is a `Date`. `status: "paid"` orders by `paid_at DESC NULLS LAST, submitted_at DESC`; every other status (and no status) orders by `submitted_at DESC`. `total` is the count for the same filter, for "Showing X-Y of N". `paidByName` is `coalesce(users.name, users.email)` of the linked transaction's `recorded_by_user_id`. The list API route returns the same shape (minus `receiptStorageKey`).

From `@/lib/ledger` (client-safe, DB-free): `isOwnReimbursementRequest(actor: { id; memberId? }, reimb: { submittedByUserId; submittedByMemberId })`, `REIMBURSEMENT_ACTIONABLE_STATUSES`.

## Deviations / notes

- None from the design. Mild interpretation: on a stale-token mismatch the 409 is returned right after the row read and body-token validation, before the fund/category lookups, as specified; the `ReimbursementConflictError` catch re-reads the row once (a second `getReimbursementWithMember` call) to choose the message.
- Existing UI still compiles because it only calls the HTTP routes; it will send `approve` and omit the stale tokens until ux-developer lands, so **do not deploy the server half alone**.
- `schema.ts` carries other agents' uncommitted comment edits; mine are three single-line comment changes.
- No real email can send from the tests (`@/lib/email` is mocked in all four files).

Next agent: **ux-developer** (Phase 4b).

# Phase 4 — Implementation (UI) — 2026-10-01

**Owner:** ux-developer
**Status:** complete

### Summary
UI half of DECISION-106 is built on the api-developer contract: the approve dialog is gone, Mark Paid carries the two stale-check tokens and surfaces any 409 by toast plus refresh, Reject and Mark Paid sit behind `ledger.record` on the awaiting tab with a self-action label, the Paid tab is ordered by paid date with payer and fund and `?page=N` paging at 50, and every copy surface in the Phase 3 table is rewritten.

### What I did
- Admin page: removed `canApprove` and the approve dialog; tab `submitted` relabelled "Awaiting action", legacy tab "Approved (legacy)" shown only when its count is above 0 or it is active; default tab is Paid for users without `ledger.record`; badge "Awaiting Treasurer"; new subtitle; Paid-tab sentence; per-tab empty states; Mark Paid + Reject on awaiting and legacy-approved rows behind `canRecord`, replaced by "Submitted by you — another reviewer must act on it" when `isOwnReimbursementRequest` is true; paid rows show "Paid {date} by {name}" and "Fund: {fund}"; `boardMinute` shown only when non-null as "Board minute (historical)"; "Showing X-Y of N" with Previous/Next links preserving `tab`; action controls are `min-h-[44px]`.
- Pay dialog: new `amountCents` + `updatedAt` props echoed as `expectedAmountCents` / `expectedUpdatedAt`; any 409 shows the server message, closes the dialog and calls `router.refresh()`; new description copy; footer buttons 44px with focus rings.
- Reject dialog: same 409 handling (toast, close, refresh). No other change.
- Admin home: Pending Reimbursements query and card gated on `ledger.record` only.
- Members page and submit toast: copy per table; badge "Awaiting Treasurer"; board minute only when non-null, relabelled.
- Treasury guide reimbursements section rewritten (pipeline, no board step, Paid tab review, cannot pay/reject own request and keep two Record holders, Approvals queue is disbursements/transfers only, legacy note). `books-register-section.tsx` verified, no edit (sentence is still true for disbursements).

### Outputs
- Deleted: `src/components/admin/ledger/approve-reimbursement-dialog.tsx` (shows as a staged deletion because I used `git rm`; nothing committed).
- Modified: `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx`, `src/components/admin/ledger/pay-reimbursement-dialog.tsx`, `src/components/admin/ledger/reject-dialog.tsx`, `src/app/(dashboard)/admin/page.tsx`, `src/app/members/reimbursements/page.tsx`, `src/components/members/reimbursement-form.tsx`, `src/components/admin/ledger/guide/reimbursements-section.tsx`.
- No decisions logged by me.

### Deviations from the design
- Reject uses the existing `RejectReimbursementDialog` (a Radix dialog that collects the required reason), not `ConfirmDialog`, because a reason must be typed; `ConfirmDialog` has no input. No native dialogs anywhere.
- Reject trigger stays a `<span>` inside the dialog's own wrapping `<button>` (avoids nesting buttons); it was given a 44px height.
- Reject also handles 409 with toast + refresh (the design only specified this for pay).

### Open questions / handoff notes
- Gate: tsc clean; `pnpm test` 140 files / 2412 tests passed; `pnpm build:only` passed; eslint clean on all touched files.
- Walked in the browser (dev server on :3000, DATABASE_URL, e2e admin). The e2e admin has no linked member, so I temporarily linked it to an existing member to submit, then reset `users.member_id` to null. Submitted via the real form: toast "Submitted. The treasurer will review it and you'll get an email when it's paid."; row appears under Awaiting action with no Mark Paid/Reject, showing the self-action label. A second row from a different member showed Mark Paid and Reject. Changing the amount in the DB after page load and clicking Mark Paid produced the stale 409 toast; a fresh load paid it, and the Paid tab showed "Paid Oct 1, 2026 by <payer>", "Fund: Administrative Fund", the Txn id, the board-review sentence, and "Showing 1-1 of 1 request." Guide section and members page copy confirmed. Admin home card present for the admin; no horizontal overflow at 360px.
- Not exercised in the browser: Previous/Next link rendering (needs more than 50 paid rows; only 1 existed locally) and the board-member (view-only) default-to-Paid path and hidden home card (no such user signed in). Logic is simple and covered by the code path, but qa should check with a view-only user.
- Cleanup: deleted the 3 test reimbursements, the posted test transaction and the 2 blocked email_queue rows; admin `member_id` reset to null. No `ledger_receipt_files` row existed for the test key.
- Copy the club may want to refine: "Awaiting action", "Approved (legacy)", "Submitted by you — another reviewer must act on it", the Paid-tab sentence, and the guide wording.
- Pre-existing, not changed: the admin table shows each member's email address; the admin layout nests two `<main>` landmarks.
- Next agent: qa (Phase 5).

# Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All four automated gates are green, the diff matches the Phase 3 design on every point the brief named, the feature-gate audit is clean, and the dev-server walk covered the four paths the ux-developer could not (view-only user, double reject, legacy `approved` rows, paging past 50) plus the submit email. No mail left the machine (every queued row is `blocked_non_production`). Three non-blocking findings are listed under handoff notes; none is a defect against the Phase 1 intent.

### What I did

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (no output, exit 0; re-run at the end after other pipelines' edits landed, still exit 0).

#### Unit Tests
`pnpm test`: **PASS**
```
 Test Files  140 passed (140)
      Tests  2412 passed (2412)
   Duration  3.98s
```
(A later coverage run, after other pipelines added tests, read 144 files / 2441 tests, all passing.) The four reimbursement files alone: `src/lib/ledger-reimbursement.test.ts` (21), admin `[id]/route.test.ts` (41), member `route.test.ts` (12), member `[id]/route.test.ts` (8), plus `admin-page-feature-gates.test.ts` (167 in the file) all pass.

#### Lint
`pnpm lint`: **PASS** — `✖ 1 problem (0 errors, 1 warning)`. The one warning is an unused `eslint-disable` directive in `src/components/admin/ledger/budget-context-panel.tsx:114`, a file not in this diff (pre-existing).

#### Production Build
`pnpm build:only`: **PASS** — `✓ Compiled successfully in 2.2s`, `Finished TypeScript in 7.8s`, `✓ Generating static pages using 15 workers (125/125) in 3.0s`; exit 0. No unexpected output. The concurrent pipeline's files (reconciliation, utils, discard button) compiled cleanly, so nothing to attribute to "concurrent pipeline, not this diff".

#### End-to-End Tests
`pnpm test:e2e`: **not run, not a gate.** Phase 3 recorded that no Playwright spec touches reimbursements (`grep -rniE "reimburs|approve-reimb|Mark Paid" e2e/` is empty), and a full serial run is ~12 minutes against a DB two other pipelines are using right now. I drove the flows with an ad-hoc Playwright script instead (below). That is manual verification, not a committed spec.

#### Diff review against the Phase 3 design

`git diff --staged --stat`: one file, `approve-reimbursement-dialog.tsx`, 121 deletions. Unstaged diff in the scoped paths: 14 files, +902/-635 (aged-fund hunks in `ledger.ts` / `ledger-queries.ts` ignored as instructed).

| Check | Result | Evidence |
|---|---|---|
| Feature gate before row read in admin PATCH | PASS | Order in `[id]/route.ts` PATCH: `auth()` 401 -> action 400 -> `hasFeature(LEDGER_RECORD)` 403 -> `getReimbursementWithMember` 404. Live: a view-only user PATCHing a nonexistent id got 403, not 404. |
| Reject UPDATE has a status condition | PASS | `WHERE id AND status IN ('submitted','approved')` + `.returning()`; zero rows -> 409 "already processed", no email. |
| Pay UPDATE pins status, amount, description, receipt key, cause | PASS | `inArray(status)`, `eq(amountCents)`, `eq(description)`, `eq(receiptStorageKey)`, `isNull`/`eq(beneficiaryCause)`; no timestamp column. |
| Stale check is in app code, not SQL | PASS | `reimb.amountCents !== expectedAmountCents \|\| reimb.updatedAt.getTime() !== expectedUpdatedAtMs`. Live: a never-edited row paid with matching tokens (no false 409). |
| Self-action matches user id OR member id | PASS | `isOwnReimbursementRequest` (user-id match, or member-id match; null never matches), one predicate used by both actions and by the admin page. Live: self-pay and self-reject -> 403 with the exact strings. |
| Member PATCH / DELETE status-conditioned | PASS | PATCH `WHERE id AND status='submitted'` + `.returning()`; DELETE same; zero rows -> 409. Live: PATCH and DELETE on a paid row -> 409. |
| Submit notification via `sendBulkMemberEmail()`, never a loop | PASS | Single `sendBulkMemberEmail({ recipients: pick.recipients.map(...) })`; `results` inspected for `!success`; no `sendEmail()` loop; `sendBulkMemberEmailForDurableClaim` correctly not used (no durable claim written). |
| No `console.log` in production paths | PASS | grep over every touched non-test file: none. Remaining logging is `console.warn`/`console.error` with ids, reasons and counts only (no addresses). |
| Migration 0108 idempotent | PASS | `UPDATE ... WHERE name='ledger.approve' AND description IS DISTINCT FROM '<same string>'`; re-ran it against the dev DB: `UPDATE 0`. String is byte-identical to `FEATURE_DESCRIPTIONS[FEATURES.LEDGER_APPROVE]`. |
| Approve dialog gone, nothing imports it | PASS | File absent; `grep -rn "approve-reimbursement-dialog\|ApproveReimbursementDialog" src e2e` empty. |
| `grep "requires board review\|board approval" src/` | PASS | No "requires board review" anywhere. "board approval" hits are all disbursement/transfer copy (transactions route emails, Approvals page, settings form/guide, `transaction-form.tsx`, guardrails) or the DECISION-106 negation in the new route and guide comment. No stale reimbursement rule remains. |

Admin-page gate test: `src/lib/admin-page-feature-gates.test.ts` passes, including the two `admin/ledger/reimbursements/page.tsx` cases (calls `hasFeature`/`hasAnyFeature`, and enforces it with `redirect()`). Read of the page confirms its own `auth()` + `hasAnyFeature([VIEW, RECORD, MANAGE, APPROVE])` + `hasFeature(RECORD)` for the controls.

#### Dev-server smoke (DATABASE_URL only; `PROD_DATABASE_URL` never used; `EMAIL_DEV_ALLOWLIST` unset; `RESEND_API_KEY` commented out; `.env.local` not edited)

Signed in as the e2e admin via the real credentials form, plus a temporary view-only user. Every request was real HTTP against `pnpm dev` on :3000.

| Flow | Result | Notes |
|------|--------|-------|
| Admin default tab, tab labels, badge | pass | Lands on "Awaiting action"; badge reads "Awaiting Treasurer"; no Approve button anywhere; Mark Paid + Reject on rows from other members. |
| `PATCH action=approve` | pass | 400 `action must be one of: reject, pay`. |
| (a) View-only user (role `board_member` + `member`: `ledger.view` + `ledger.approve`, no `ledger.record`) | pass | Reaches the page; default tab is Paid with the board-review sentence; no Mark Paid/Reject on Paid or on an explicit `?tab=submitted`; `/admin` reachable and the Pending Reimbursement card is hidden while a submitted row exists (the admin sees it, count 2). API: GET detail 200; pay 403; reject 403 (reject really moved off `ledger.approve`); nonexistent id 403 (no existence oracle). Unauthenticated PATCH 401. |
| (b) Reject a submitted row from another member, then again | pass | First 200; second 409 "This reimbursement has already been rejected"; pay on that row 409 "was rejected and cannot be paid". |
| (c) Legacy `approved` rows (set in DB with a different reviewer and a historical minute) | pass | "Approved (legacy)" tab appears only because count > 0; "Board minute (historical): ..." shown; **Mark Paid via the UI dialog** posted the expense and the Paid tab shows it; the posted transaction copied the legacy `approved_by_user_id`, `approved_at` (2026-09-01) and `board_minute` (R-2), recorded by the acting user, and the reimbursement's own reviewer/minute were left untouched. **Reject via the UI dialog** on a second legacy row worked and shows the reason on the Rejected tab. |
| Submitted-path pay and lock (R-6) | pass | A never-edited `submitted` row paid with GET-detail tokens -> 200 (false-409 trap not tripped); posted txn has `approved_by_user_id` = payer, `approved_at` non-null, `board_minute` null; the reimbursement's `reviewed_by/at` set to the payer. Second pay 409; reject-after-pay 409. `PATCH` and `DELETE` on the posted transaction -> 403 "Approved transactions cannot be edited/deleted" (the lock works). |
| Stale token | pass | Missing tokens -> 400; wrong `expectedAmountCents` -> 409 "This request was edited after you opened it. Reload and review it again." (The browser-level stale toast was walked by the ux-developer.) |
| (d) Paging | pass | 55 `paid` fixtures + 1 real paid = 56. Page 1 "Showing 1-50 of 56 requests", Next -> `?tab=paid&page=2`, no Previous; page 2 "Showing 51-56 of 56", 6 rows, Previous -> `?tab=paid`, no Next. `page=0`, `abc`, `-3` fall back to page 1. Paid ordered by payment date: the just-paid legacy row is first, payer "E2E Test Admin" and "Fund: Administrative Fund" shown. Fixtures deleted afterward. |
| (e) Submit email | pass | Linked the e2e admin to an existing member, submitted via `POST /api/members/reimbursements` -> 201. Exactly **one** `email_queue` row, subject "New reimbursement request — $33.00", status **`blocked_non_production`**, no `sent_at`; recipient is the Board-position Treasurer's user (resolver primary path; the Treasurer holds `ledger.record` in dev); body contains the submitter's name, "is waiting for your review" and the admin link, does **not** contain "requires board review"; a `<b>bold</b> & co` description arrived escaped (`&lt;b&gt;...&amp;`). No CC on the submit mail. |
| Self-submitted row | pass | Admin page shows "Submitted by you — another reviewer must act on it" with no Mark Paid/Reject; self-pay 403 "You cannot pay your own reimbursement request"; self-reject 403 "You cannot reject your own reimbursement request". |
| Member PATCH/DELETE after pay | pass | Member PATCH on own `submitted` row 200; after the row was paid (set in DB), PATCH 409 and DELETE 409, amount unchanged. |
| Member-facing mail | pass | Rejected/paid emails to the submitter carry the treasurer CC (DECISION-086); all `blocked_non_production`. |
| 360px (screenshots `awaiting` and `paid` tabs, viewport 360x800) | pass with note | No page-level horizontal overflow (`scrollWidth` 360 on both tabs). The table scrolls horizontally inside its own card, so on the Awaiting tab the Mark Paid / Reject cell sits off-screen to the right until you scroll the table. See finding 2. Screenshots: `.../scratchpad/d106/shots/admin-reimbursements-360-awaiting.png`, `...-360-paid.png`. |

**Cleanup (verified):** deleted all 61 fixture reimbursements, the 2 posted fixture transactions, the 5 fixture `email_queue` rows (matched on a unique marker in the body, so other pipelines' rows were not touched) and the temporary view-only user (its role rows cascaded). The e2e admin's `member_id` was set to an existing member for the submit test and reset to NULL; its roles were never changed. Counts after: reimbursements 0 (as found), fixture txns/mail 0, temporary user 0. Left as found except `users.last_login_at` for the e2e admin, which any sign-in moves. The `users`/`user_roles`/`ledger_transactions` totals are higher than at my baseline only because the concurrent reconciliation-discard pipeline created its own temporary user and transactions during the same window (verified: the one new user is theirs, and no audit row targets my transactions).

#### Regression Tests Added / Guarding the Architect's Two Race Bugs

QA added no new test files; the implementer delivered the Phase 3 list. I verified the two race guards **by mutation**, because the hermetic mocks cannot interleave real requests and the guard lives in the serialized WHERE clause:

- **Reject without a status condition (R-7)** — `src/app/api/admin/ledger/reimbursements/[id]/route.test.ts:386` "from submitted is 200 and the WHERE includes the actionable status set" (with `:415` "reject race: zero rows is 409 and sends no email" and `:408` "409 pre-read on a paid row"). Removing the `inArray(status, ...)` from the reject UPDATE made `:386` fail with `expected '"ledger_reimbursements"."id" = $1' to contain '"status" in'`.
- **Member edit racing a pay (R-5)** — `src/app/api/members/reimbursements/[id]/route.test.ts:60` "owner edit of a submitted row is 200 and the WHERE pins status = submitted" (with `:68` pre-read 409 and `:75` zero-row 409; DELETE equivalents at `:94`, `:102`). Removing `eq(status,'submitted')` from the PATCH UPDATE made `:60` fail with `expected '"ledger_reimbursements"."id" = $1' to contain '"status" ='`.
- Also guarding: `:291` pay WHERE pins values and never `updated_at`; `:342` never-edited row is 200 (false-409 trap); `:278` double-pay race; the stamp/lock coupling in `src/lib/ledger-reimbursement.test.ts` plus admin route test for the `submitted` path.

Both mutations were reverted and byte-compared against backups; the suite is green again (61/61 in those three files).

#### Coverage on Critical Modules
- `src/lib/events.ts`: 94.86% statements (target 90%) — not touched by this change.
- `src/lib/permissions.ts`: not listed by the v8 report with `--coverage.include` (constants-only); comment/description edit only, and the description catalog tests pass.
- `src/lib/members.ts`: **36.84% statements, below the 80% target.** Not touched by this change; recorded for the 7-day coverage sweep, not held against this verdict.
- `src/lib/ledger.ts` (changed here): 100% statements, 95.44% branches, 100% functions.

#### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/ledger/reimbursements` | yes | yes | `LEDGER_VIEW` (read-only; board review log) |
| `GET /api/admin/ledger/reimbursements/[id]` | yes | yes | `LEDGER_VIEW` |
| `GET /api/admin/ledger/reimbursements/[id]/receipt` (unchanged) | yes | yes | `LEDGER_VIEW` |
| `PATCH /api/admin/ledger/reimbursements/[id]` `reject` | yes | yes, before the row read | `LEDGER_RECORD` (was `LEDGER_APPROVE`) |
| `PATCH /api/admin/ledger/reimbursements/[id]` `pay` | yes | yes, before the row read | `LEDGER_RECORD` |
| `POST/GET /api/members/reimbursements`, `PATCH/DELETE .../[id]` | yes | n/a by design: `session.user.memberId` + ownership + status-conditioned writes (no FEATURES key, unchanged) | n/a |
| Page `/admin/ledger/reimbursements` | yes | yes (`hasAnyFeature` for access; `hasFeature(RECORD)` for controls) | VIEW/RECORD/MANAGE/APPROVE any-of for access; `LEDGER_RECORD` for actions |
| Admin home Pending Reimbursement card | n/a (page-level `auth()`) | `userFeatures.includes(LEDGER_RECORD)` | `LEDGER_RECORD` (verified live: hidden for the view-only user) |
| `/api/admin/ledger/transactions/[id]` (comment-only edit) | unchanged | unchanged | unchanged; lock verified live (403 on a reimbursement-derived txn) |

None of the gates is missing or on the wrong key. `ledger.approve` no longer gates anything reimbursement-related; the view-only (`ledger.approve` + `ledger.view`) user was refused on pay and reject.

#### Verified fact vs. theory

Everything above marked pass was reproduced (live request or test run). No root-cause claims are made. Not exercised live: a true concurrent interleaving of reject vs pay (not deterministically reproducible by hand; covered by the status-conditioned WHERE assertions, proven by mutation) and the fallback recipient paths (treasurer is the submitter, resolver `none`/`multiple`, treasurer lacks `ledger.record`), which the dev DB cannot reach without edits to Board data; those are covered by the `pickReimbursementNotifyRecipients` table tests and the route test (`console.warn` carries the reason, no address).

### Outputs
- `docs/work-log/2026-10-01-reimbursements-no-board-approval.md` (this section; status table row 5).
- Scratch only (not in repo): `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/905042bc-d0ca-4613-a7e1-15298879f5cb/scratchpad/d106/` (scripts, SQL, screenshots). No source, test, `docs/decisions.md` or `docs/backlog.md` edits; DB left as found apart from `last_login_at`.

### Open questions / handoff notes

Non-blocking findings (none contradicts the Phase 1 intent):
1. **Out-of-range `?page=` renders a nonsense state.** `/admin/ledger/reimbursements?tab=paid&page=99` shows the empty message "No paid reimbursements yet." and "Showing 4901-56 of 56 requests." with a Previous link to page 98. Reachable only by hand-editing the URL; fix is to clamp `page` to the last page (or show "no more pages"). Low severity.
2. **360px: the action buttons are off-screen to the right of the table on the Awaiting tab.** No page overflow, but a treasurer on a phone must scroll the table sideways to find Mark Paid / Reject. The Phase 1 note called this out as a carry-over; the buttons are now 44px tall but not reachable without scrolling. Analyst to decide whether it is acceptable or needs a card layout on small screens. Not a regression.
3. **Test names lack the "— regression for X" suffix** the QA convention asks for. The guards are real (mutation-verified above); a rename at the next touch is enough.
4. Pre-existing, unchanged by this diff, observed only: `members.ts` coverage 36.84% (for the weekly sweep); the dev-only React "1 Issue" indicator is the `eval()` CSP notice, identical on `/admin` and `/admin/ledger`; admin table shows each member's email; `ledger_reimbursements.submitted_by_user_id` is NOT NULL while its FK is `ON DELETE SET NULL` (would conflict if a submitter's user were deleted; not touched here).
5. Production preconditions are already satisfied per the orchestrator pre-flight (Treasurer's user holds `ledger.record`; 3 record holders; 0 submitted / 0 approved rows). The legacy `approved` path therefore has nothing to migrate at deploy, but it is verified working.
6. Release notes (`v1.85.0`) and DECISION-106 are tech-lead / ship-time work; not done by QA. Ordering note in Phase 3 stands (re-read `package.json` at push time; aged-fund is 1.84.1).

**Next agent:** `analyst` for Phase 6 (PASS).

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-10-01

## VERDICT

**SHIP WITH NOTES.** Every Phase 1 intent and every architect requirement (R-1 to R-7) is delivered and verified. I found no red flag. The notes are one treasurer-communication item that must ride with the release notes (N-A), two small UI follow-ups (N-B, N-C), and one pre-push test-naming chore (N-D). None blocks shipping the code.

## ONE-LINE TAKE

> Reimbursements now go submitted -> paid or rejected on the treasurer's say-so alone, only the treasurer is emailed, the board reviews afterward on a Paid tab that shows who paid from which fund, and the two races the old approve step used to hide are closed and tested.

## What's Working

- **The quiet job of the approve step was replaced, not dropped.** Paid transactions are still locked (stamp via `reimbursementTransactionStamp()`; QA got 403 on PATCH and DELETE of a paid reimbursement's transaction live). This was Phase 1 N-3 and is the one place a naive "just remove approval" change would have silently unlocked the books.
- **The member-edit-while-treasurer-pays window (N-6) is closed twice:** stale-token 409 in app code (never-edited row still pays, so no false 409) and a value-pinned atomic UPDATE. A member PATCH/DELETE on a paid row is now a 409 instead of rewriting a paid amount.
- **The treasurer cannot pay or reject their own request** (user id OR member id, null never matches), in the API and in the UI ("Submitted by you — another reviewer must act on it"). Reject moved onto `ledger.record`; a `ledger.approve`-only user gets 403 on both actions, and the 403 now comes before the row read, so there is no 404/403 existence oracle.
- **A board member gets a coherent view:** a view-only user lands on the Paid tab, sees the explanatory sentence, payer and fund, and sees no action buttons and no home-page card.
- **Production is ready for it** (orchestrator pre-flight): the Board-position Treasurer's user holds `ledger.record`, 3 distinct record holders, 0 submitted and 0 approved rows in flight.

## Intent-vs-Shipped Diff

- **Lifecycle.** Phase 1 said submitted -> paid | rejected, `approved` legacy read-only, `approve` action removed (400). Shipped: exactly that; `pay` and `reject` both accept legacy `approved` (architect R-3, accepted); legacy tab hides at count 0. Verdict: matches.
- **`boardMinute`.** Phase 1 said stop collecting it, keep the column, show only when non-null as "Board minute (historical)". Shipped: dialog deleted, label and null-check on both the admin and member pages, new transactions get `boardMinute = null`, legacy rows keep theirs (QA walked a legacy pay via the UI). Verdict: matches.
- **Self-submission rule.** Phase 1 said the submitter may not pay or reject, a second `ledger.record` holder must act, surface it in the UI. Shipped as above, plus the guide says "keep at least two people with that permission." Verdict: matches (stronger: user id OR member id).
- **Notification recipient and fallback.** Phase 1 said the resolved treasurer if they hold `ledger.record` and are not the submitter, else the other `ledger.record` holders; tolerant, submitter's name in the body, no bare `catch {}`. Shipped: `pickReimbursementNotifyRecipients()` pure helper, one `sendBulkMemberEmail()` call, results inspected, warns carry reasons and counts only, empty set logs an error and still returns 201; escaping verified live. Fallback paths proven by table tests, not live (dev data cannot reach them). Verdict: matches.
- **Board awareness.** Phase 1 said Paid tab ordered by paid date with payer, fund, an explanatory sentence, paging, card narrowed to `ledger.record`; monthly report as a follow-up. Shipped: all of it; B-83 filed at normal-next. Paging beyond the last page has a rough edge (N-B). Verdict: matches, with one acceptable drift (paging is `?page=N` links rather than "Load more", which the architect allowed).
- **Decisions reversed.** Phase 1 said write the new rule, amend DECISION-086. Shipped: DECISION-106 filed (numbered 106; Phase 1 had guessed 105, which was the next free number at the time); DECISION-086 amended (five CC sites become four, plus the new recipient consumer); B-84 and B-85 filed beside B-83; B-48 annotated. The minute reference is still "to be supplied by the treasurer". Verdict: matches (see N-E).
- **Copy table.** Phase 1 listed ~17 surfaces. Re-checked in the source: "Awaiting Treasurer" (members page, admin badge), "Awaiting action" tab, member page paragraph, form toast, "Board minute (historical)" on both pages, self-action label, Paid-tab sentence, subtitle, guide section, permissions comment/description (+ migration 0108, byte-identical string, idempotent), `schema.ts` comments, transactions-route coupling comment. A grep of `src/` for "requires board review" returns nothing, and the remaining "board approval" strings are disbursement or transfer copy. Verdict: matches.
- **The two race bugs, with regression tests.** Phase 1 (N-6) and architect R-5/R-7 required fixes. Shipped: reject, pay and member PATCH/DELETE all have status-conditioned atomic writes with 409 on zero rows; the tests assert the serialized WHERE clause. QA proved the guards by mutation (removing either status condition fails a named test). I re-ran the four reimbursement test files: 82 of 82 pass. Verdict: matches (naming convention gap, N-D).
- **Stale-token check.** Phase 1 asked for `amountCents` (ideally `updatedAt`) echoed back; architect required app-code comparison. Shipped: both tokens required (400 if missing), compared via `getTime()`, no `updated_at` in SQL, dialog sends them and handles any 409 with toast, close and refresh. Verdict: matches.
- **Reject has no stale token.** Not requested in Phase 1; Phase 3 ruled it unnecessary. Verdict: acceptable drift.

## Edge Cases

- Empty state: **pass** (per-tab empty copy; the one wrong case is the out-of-range page, N-B).
- Failure microcopy: **pass** (all 403/409 strings are human; dialogs show the server message verbatim and refresh).
- Permission gate: **pass** (`ledger.record` on reject and pay; `ledger.view` on reads; page keeps its own `auth()` + `hasAnyFeature()`, gate test green; card hidden from view-only users; unauthenticated 401).
- Mobile (360px): **pass with note** (no page overflow, buttons 44px, but Mark Paid and Reject sit off-screen until the table is scrolled; N-C).
- Brand and dialogs: **pass** (no native dialogs; Radix dialogs collect required fields; `rounded-lg` / `rounded-2xl`; no `console.log`).
- OAuth vs password / access-pending: **not applicable** (submission gated on `memberId`, unchanged).

## Rulings on QA's four non-blocking findings

1. **`?page=99` shows "Showing 4901–56 of 56" and "No paid reimbursements yet." — follow-up, not a ship blocker.** It is reachable only by hand-editing the URL, it shows no data and performs no write, and the realistic way to land there (paying the last row on page 2 of an Awaiting queue larger than 50) does not exist in production today (0 submitted). Tracked as B-88 below. If anyone reopens the page for another reason, take the three-line clamp then.
2. **360px action buttons off-screen — acceptable for ship, tracked as B-89.** Not a regression (Approve and Reject lived in the same cell and had the same problem, at 32px), no loss of function, and the table scrolls inside its own card. But the notification email now lands the treasurer on this page, and a phone is a plausible place to open it, so this is should-do, not someday.
3. **Test names lack "— regression for X" — not a verdict blocker, but do it before the push.** The qa agent file makes the suffix required, and the tests that commemorate the two race bugs are exactly where a future reader needs it. It is a rename of roughly eight test titles with no logic change; it needs no backlog ID. If it is not done before commit, it becomes a tracked note on the release.
4. **`members.ts` at 36.84% — out of scope.** Not touched by this change; belongs to the 7-day coverage review. No bearing on this verdict.

## Treasurer-facing notes: where they are recorded today

| Note | Recorded where the treasurer will see it? |
|------|------------------------------------------|
| Someone other than the treasurer must hold `ledger.record` to pay the treasurer's own requests | **Yes.** Treasury User's Guide, Reimbursements section ("You cannot pay or reject your own request ... keep at least two people with that permission"), and the admin page label. Production pre-flight confirms 3 holders. Also in DECISION-106 item 3. |
| The $10,000 form ceiling is now the effective single-person limit, while a $300 vendor check still pends for the board | **No.** It exists only in DECISION-106 item 7 (a developer document the treasurer is unlikely to read) and Phase 3's release-note plan, which says "no longer subject to the approval threshold" but never names $10,000 or the vendor-check contrast. The guide says only "outside the approval threshold." `docs/release-notes/v1.85.md` does not exist yet. |

So the second note is **not yet where the treasurer will see it.** That is why this verdict is SHIP WITH NOTES rather than SHIP IT. Close it by putting the wording below into `v1.85.md` (in-app release notes at `/admin/release-notes`) when the release is prepared; the release-notes step is the ship-time vehicle and the work-log is the draft.

**Proposed release-note wording (value first, no file lists; for the tech-lead to place under 1.85.0):**

> **Reimbursements no longer need board approval.** Members still submit with a receipt. The treasurer is emailed, reviews each request, then marks it paid (which posts the expense to the ledger) or rejects it with a reason. The board reviews paid reimbursements afterward on the Paid tab of the Reimbursements page, newest payment first, with who paid each one and from which fund.
>
> **Two things worth knowing:**
> - **There is no longer a second approver.** A reimbursement of any amount up to the $10,000 form limit is paid on the treasurer's review alone, while an ordinary vendor payment over the approval threshold (default $250) still waits for board approval. The board may want to decide whether it wants a dollar ceiling on reimbursements.
> - **You cannot pay or reject your own request.** If the treasurer submits a reimbursement, someone else who holds the Record permission has to pay it, so at least two people need that permission.
>
> Requests the board approved under the old process can still be paid or rejected. If a member edits a request while the treasurer has the Mark Paid form open, the treasurer is asked to reload and review it again.

Also suggested for the treasurer when this ships (not code): please supply the board meeting date and minute reference so DECISION-106 can cite it (currently "September 2026, minute reference to be supplied by the treasurer"), and ask the board whether it wants a ceiling.

## Follow-Ups (SHIP WITH NOTES)

- **N-A (must happen at ship):** carry the release-note wording above into `v1.85.md`, bumping from whatever `main` holds at push time (aged-fund 1.84.1 first, then 1.85.0). Owner: tech-lead at the release-notes step. No backlog ID; it is part of the release.
- **N-B — proposed backlog text, B-88 (priority: low):** "Reimbursements admin page does not clamp an out-of-range `?page=`. `/admin/ledger/reimbursements?tab=paid&page=99` shows 'No paid reimbursements yet.' and 'Showing 4901–56 of 56 requests.' with a Previous link to page 98. Fix: when `total > 0` and `offset >= total`, redirect to the last page (`ceil(total / 50)`). Reachable only by editing the URL, or by paying the last row of a second page on an Awaiting queue larger than 50. (Added 2026-10-01, Phase 6 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106.)"
- **N-C — proposed backlog text, B-89 (priority: should-do):** "Reimbursements admin table: Mark Paid and Reject are off-screen at 360px. The table scrolls horizontally inside its card, so a treasurer who opens the new-request email on a phone must scroll sideways to find the action buttons. Fix shape: below `sm`, stack each row as a card (member, amount, description, then the actions), or move the actions under the description. Related to B-87 (Email Queue tables clip on a phone); consider fixing the Ledger tables together. (Added 2026-10-01, Phase 6 of the reimbursements work-log; DECISION-106.)"
- **N-D (before push, no ID):** rename the regression tests for the two race bugs and the double-pay and stale-token guards with the "— regression for X" suffix: `src/app/api/admin/ledger/reimbursements/[id]/route.test.ts` (reject WHERE, reject race, double-pay race, pay WHERE pin, never-edited row) and `src/app/api/members/reimbursements/[id]/route.test.ts` (PATCH and DELETE status guards). Names only, no logic. Owner: qa or the api-developer.
- **N-E (outside code):** treasurer to supply the board minute reference for DECISION-106; board to say whether it wants a reimbursement ceiling (B-84 consolidates the constant but does not change policy). B-83 (board-visible monthly "Reimbursements paid" list) stays at normal-next, because the board's decision depends on after-the-fact visibility being more than a tab.

## Red Flags (if NEEDS REWORK)

- None.

---

## Production pre-flight (orchestrator, 2026-10-01, read-only)

| Check | Result |
|-------|--------|
| Board-position Treasurer has a linked user | yes |
| That user holds `ledger.record` | yes |
| Distinct `ledger.record` holders | 3 (roles: admin ×2, treasurer ×2, overlapping) |
| Reimbursements in `submitted` | 0 |
| Reimbursements in `approved` (legacy) | 0 |
| Reimbursements in `paid` | 2 |

No in-flight rows, so the legacy `approved` path has nothing to migrate at deploy time. The second-person
requirement for the treasurer's own requests is satisfiable today.
