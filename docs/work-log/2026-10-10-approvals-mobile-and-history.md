# Approvals Page: Mobile Actions, Decision History, Email Deep Link — Work Log

> **Slug:** `2026-10-10-approvals-mobile-and-history`
> **Reserved IDs:** B-155, B-156, B-157, B-158; DECISION-116 — all filed (DECISION-116 as `Proposed`; B-158 filed by the orchestrator 2026-10-10 under Soon). Multi-approver addendum: DECISION-117 filed (Proposed) and B-159 filed 2026-10-10 (Phase 3 addendum); B-160 held (file only if the user answers Q8 that a posted approval needs a way to record dissent); B-161 filed by the orchestrator 2026-10-10 (Later) for the recorder-email item (the pending-approval email goes to the person who recorded the entry); B-162 to B-165 filed by tech-lead at ship (Ship filing section, end of this log). DECISION-116 and DECISION-117 are now Resolved.
> **Surface:** (dashboard) admin — `/admin/ledger/approvals`, the pending-disbursement notification email, the Approve dialog
> **Permission(s):** existing `ledger.approve` covers this (no new key)
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete for Increment 1 and 2a; addendum (multiple approvers, Increment 2b) complete | READY WITH NOTES (original and addendum) | 2026-10-10 |
| 2 — Architectural review | architect | Complete; addendum (multiple approvers) complete: table `ledger_txn_cosigns`, predicate in `ledger-board-decision.ts`, Increment 2 split into 2a/2b | Approved with suggestions (original and addendum) | 2026-10-10 |
| 3 — Technical design | tech-lead | Complete; addendum (2a and 2b) complete. DECISION-116 and DECISION-117 filed as Proposed (analyst Phase 6 recommends Resolved after the wording edits in the Phase 6 section); B-155 to B-159 and B-161 filed; B-160 held for Q8 | Design complete | 2026-10-10 |
| 4 — Implementation | Inc 1: api-developer, ux-developer. 2a and 2b: database-admin, api-developer, ux-developer | Inc 1 complete (v1.89.0, `4730983`). 2a complete (migration 0111). 2b complete (migration 0112). 2a and 2b are in the working tree, uncommitted; push waits for `/pre-push` on the combined tree | Complete | 2026-10-10 |
| 5 — Verification | qa | Inc 1 complete (O-1 closed: stale dev process). 2a complete (54-test spec). 2b complete (70-test spec, five concurrency passes) | Inc 1: PASS. 2a: PASS. 2b: PASS | 2026-10-10 |
| 6 — Shipped vs intent | analyst | Inc 1 complete (shipped). 2a short confirmation complete. Closing Phase 6 for 2a and 2b complete: nothing blocks the push; tracked notes N1 to N10, four backlog drafts, post-deploy checks L2, L4, L9, F4; Q8 still with the user | Inc 1: SHIP WITH NOTES. 2a: CONFIRMED WITH NOTES. 2a + 2b: SHIP WITH NOTES | 2026-10-10 |

---

## Origin (orchestrator, 2026-10-10)

**Trigger.** A board member wrote via the contact form on 2026-10-09: "Able to see Ledger via Admin, but no permission to approve as Board member." Read-only production checks showed the member holds `board_member` (which carries `ledger.approve`), signed in fresh after a password reset, and a $2,275 disbursement recorded by someone else was pending. A dev click-through as a board-only user (`board_member` + `member`, no admin, no `ledger.record`) approved successfully on desktop. On a phone-width viewport (390px) the Approvals table shows only Date / Fund / Amount; the Approve and Reject controls sit off-screen to the right inside an `overflow-x-auto` card with no scroll cue, so the row looks un-actionable. The disbursement was approved the next day by a different board member.

**What the user asked for (2026-10-10, verbatim intent):**
1. "fix the approvals page so the approve button shows on mobile."
2. Only one approver is needed, so "it is awkward for there to be no indication that it was already approved" — the other ~13 notified board members who click the email link see "All expenditures are approved" and nothing else.
3. Does the email link go to the Approvals page only, or to the specific transaction? (Answer: page only — `/admin/ledger/approvals`, no transaction id.)
4. "the approvals page maybe should have a filter to show already approved transaction and show only a history of the last 25."
5. "seeing only one person approved, then i'm guessing there is something ux wise that needs to be done."

**Established facts the analyst can rely on:**
- One approver per transaction: `ledger_transactions.approved_by_user_id` / `approved_at` / `board_minute` (approve) or `rejection_reason` (reject). No approval-history table; no `ledger_audit_log` row is written on approve/reject.
- Notification: `POST /api/admin/ledger/transactions` (E-1) bulk-emails every `ledger.approve` holder "Disbursement pending your approval — $X" with a link to `/admin/ledger/approvals`. Transfer/Sweep pairs share a `transfer_group_id` and are approved/rejected together.
- Approve dialog's Approve button is disabled until a board-minute reference is typed; label says "(required)" but there is no inline hint explaining the disabled state.
- Side finding, out of scope unless the analyst pulls it in: `src/app/reset-password/page.tsx` pushes to `/signin` without the `callbackUrl`, so a member arriving from an email link who resets their password lands on `/members` instead of the Approvals page.

**Orchestrator's proposed scope (analyst to confirm, trim, or extend):**
- A. Approvals rows render as stacked cards below `md`, with Approve / Reject visible; table unchanged at `md+`.
- B. A "Recently decided" view on the same page: last 25 approved or rejected disbursements, newest first, with decision, who, when, and the minute citation or rejection reason. Pending stays the default view.
- C. The notification email links to `/admin/ledger/approvals?txn=<id>`; the page highlights that row if still pending, or shows a banner "This disbursement was approved by <name> on <date>" / "rejected by …" if already decided (and "no longer exists" if deleted).
- D. Inline hint in the Approve dialog explaining why Approve is disabled until the minute reference is entered.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES.** No BLOCKING FACT. One Verify-First block (below) sizes the history query and picks between two branches; Phase 2/3 can start on the recommended branch. The notes below are Phase 3 inputs, and three of them (N1, N2, N3) change the shape of the work, so read them before designing.

## ONE-LINE TAKE

> A board member could not approve on a phone because the Approve button is off-screen, and thirteen other approvers who click the same email link get a page that says "All expenditures are approved" with no hint that a colleague already acted; the fix is a mobile card layout, a "Recently decided" tab, and a deep link, but the history can only be honest if rejection records who rejected, if reimbursement payments are kept out of it, and if the approve route stops letting two approvers both "win".

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin surface, `ledger.approve` holder (board member, admin) | Open the "Disbursement pending your approval" email on a phone and tap the link | per disbursement, ~14 recipients at once |
| Signed-out approver | Land on `/signin` from the email link, sign in with Google or password, expect to arrive at the disbursement | per disbursement; common (JWT sessions expire, and the reporter had just reset a password) |
| Approver | Scan the pending list and read payee, memo, amount, fund, who recorded it | per session |
| Approver | Tap Approve, type a board-minute reference, confirm | per decision |
| Approver | Tap Reject, type a reason, confirm | rare |
| Approver | Open "Recently decided" to see whether a colleague already acted, who, when, and under which minute | per email click, when the pending list is empty or short |
| Approver | Read a "this was already approved by X" banner after clicking a stale email link | per stale click (up to 13 per disbursement) |
| Approver who recorded the item | See the item but be told plainly that someone else must decide it | occasional |
| Member with `ledger.view` only (treasurer, non-board) | Nothing new. Redirected to `/admin/ledger` as today. | n/a |
| Anonymous visitor | Nothing. All of this is behind `/admin` and the proxy. | n/a |

## Flows

**Flow 1 — Approve from a phone (bug A + D).** Email link → `/admin/ledger/approvals` → card for each pending disbursement showing amount, payee, memo, fund (Transfer/Sweep chip with from → to), date, recorded by → tap Approve → dialog (fits 360px, scrolls, keeps context visible when the keyboard opens) → type minute reference with an inline hint explaining why Approve is greyed out → tap Approve → toast "Disbursement approved." → page refreshes, card leaves the Pending tab.
- Failure: someone approved it seconds earlier (409). Today the dialog stays open and shows a red toast "Transaction is no longer pending", and the page does not refresh, so the approver is left staring at a card that is already gone. Required: close the dialog, refresh, and say who decided (same pattern `RejectReimbursementDialog` already uses for its own 409 in `reject-dialog.tsx`).
- Failure: network or 500. Existing toast "Could not approve disbursement. Please try again." is acceptable; the dialog must stay open with the typed minute preserved.

**Flow 2 — Reject.** Same entry and card → tap Reject → dialog with required reason → toast → refresh → card moves to Recently decided as "Rejected".
- Failure: same 409 handling as Flow 1.
- Today the Reject control is shown on rows the viewer recorded, but the API 403s ("You cannot reject a transaction you recorded"). The UI must hide it (or show "Cannot decide your own entry") on those rows so the card and the server agree.

**Flow 3 — Stale email link, signed in (scope C).** Email link `/admin/ledger/approvals?txn=<id>` → page resolves the id → one of the states in the table below → banner names the decider and time; Pending tab still shows anything else that is waiting; banner links to the row in Recently decided.

**Flow 4 — Stale email link, signed out (scope C, prerequisite).** Email link → proxy sees no session → redirects to `/signin?callbackUrl=…` → sign in (Google or password) → lands on the Approvals page with `?txn=<id>` intact → Flow 3.
- Failure today: `src/proxy.ts` line 37 sets `callbackUrl` to `request.nextUrl.pathname`, which drops the query string. The `txn` parameter is lost for every signed-out recipient, which is the common case. Without fixing that, scope C only works for people who happen to already be signed in. See N3.

**Flow 5 — Browse history (scope B).** Approvals page → "Recently decided" tab (`?tab=decided`) → up to 25 rows, newest decision first → read decider, date, minute citation or rejection reason.
- Empty: "No disbursements have been approved or rejected yet." in the standard empty-state card.
- Failure: if the history query fails, the Pending tab must still render, and the history tab shows "Could not load recent decisions. Try again in a moment." Pending is the job; history is context.

**Flow 6 — Empty Pending tab.** Today's copy "All expenditures are approved" is wrong for the person who arrives from a link to a rejected item and will be wrong again for anyone who wonders what happened. Replace with "Nothing is waiting for approval" plus a button-styled link "See recently decided" (`rounded-lg`, secondary style). This is the cheapest single answer to the user's complaint 2 and works even with no `?txn`.

### States the page must handle for `?txn=<id>` (question 3)

Viewer is always a signed-in `ledger.approve` holder here (the page gate runs before any lookup). Wording is a recommendation; copy can be tuned in Phase 3.

| State | Page behavior | Banner wording |
|-------|---------------|----------------|
| Pending, viewer did not record it | Highlight the card/row (`ring-2 ring-lions-gold`), scroll it into view, move focus to it for keyboard and screen-reader users | "This is the disbursement from your email. It is waiting for a board decision." (info tone) |
| Pending, viewer recorded it | Highlight, no Approve control | "You recorded this disbursement, so another board member needs to decide it." |
| Approved by someone else | No highlight on Pending; banner above tabs; link to the Recently decided row | "Already approved. <Name> approved this $2,275.00 disbursement to <Payee> on Oct 10, 2026 at 3:42 PM. Only one approval is needed, so there is nothing more to do." (green/neutral tone, not an error) |
| Approved by the viewer | Same, personalized | "You approved this $2,275.00 disbursement on Oct 10, 2026 at 3:42 PM." (This is also what the approver sees after `router.refresh()` with `txn` still in the URL, a free confirmation.) |
| Rejected | Banner, link to the row | "Rejected. <Name> rejected this $2,275.00 disbursement on <date>. Reason: <reason>." If the rejector is not on file (legacy rows): "This disbursement was rejected on <date>." |
| Transfer or Sweep, either leg id | Resolve to the pair; show the same states with the from → to label | Same wording, with "Transfer" or "Sweep" in place of "disbursement" |
| Posted but not a board decision (reimbursement payment, or a row that posted under the threshold) | No highlight | "This entry did not need board approval, so there is nothing for you to do." |
| Deleted, never existed, or malformed id | No highlight | "We can't find that disbursement. It may have been deleted after it was recorded." Never echo the raw parameter. |
| Viewer lacks `ledger.approve` | Existing redirect to `/admin/ledger`, `txn` dropped | none (acceptable; the email only goes to approvers) |

## Permissions

- **Permission(s):** existing `ledger.approve` covers everything: the page, the Pending tab, the Recently decided tab, the banner, the dialogs and both routes. No new `FEATURES` key, no role-binding migration. The history is a tab on the same route (`?tab=decided`), not a new path, so `ADMIN_NAVIGATION` and the derived proxy rule (DECISION-082) do not change, and the page keeps its own `auth()` + `hasFeature(LEDGER_APPROVE)` check, which `admin-page-feature-gates.test.ts` already enforces.
- **Default roles:** unchanged: `admin` and `board_member` (migration 0047). The treasurer gets it only through Board-group membership (CLAUDE.md, DECISION-115).
- **Does history widen what a `ledger.view`-only holder sees? No, provided one rule holds.** The register and search show a transaction's status badge but, as far as the components show, not the approver's name, the board-minute citation, or the rejection reason. The history tab exposes exactly those three, so it must stay on the `ledger.approve`-gated page and its query must not be exported to the Ledger overview, register, search or reports (all `ledger.view`). Add that as a Phase 3 constraint and a source-scan or unit test if the design adds a shared query. Officer names in a governance context are fine and this is an authenticated admin page; the fallback for a null user name is "a board member", never the email address.

## Answers to the six specific questions

**1. Is scope A–D the right shape?** Keep all four, but re-cut it and add three things the scope silently depends on.
- **A is a bug; treat it as a bug.** Ship it first and on its own. Include, because they are the same mobile card: 44px tap targets (Approve is `min-h-[32px]` today and Reject is a bare text span, both under the 44px rule in CLAUDE.md), Reject restyled as a secondary button on cards, hide Reject on self-recorded rows, and dialogs that fit 360px (the `Dialog.Content` is `w-full max-w-md` with no side margin and no max height, and `autoFocus` opens the keyboard over the context). Table unchanged at `md+`.
- **D is trivial and belongs in the same increment as A** (same dialog). Note the current label already says "(required)" and the helper text below the input explains it; what is missing is the explanation next to the disabled button. A one-line hint ("Add a minute reference to enable Approve") above the buttons is enough.
- **Add A2: the 409 path** (close, refresh, name the decider). Under 30 lines in two dialogs, no schema, absorbed into A.
- **B and C are UX and ship second.** B is not "just a query" because of N1 and N2.
- **Add E: the callback round trip** (proxy keeps the query string, shared same-origin guard at the two consumers). Without it C fails for signed-out recipients. See N3.
- **Add F: make the decision itself race-safe** (N4). Without it, "who approved" is not trustworthy.
- Recommended increments: **Inc 1 = A + A2 + D** (patch-sized, can go out today). **Inc 2 = B + C + E + F** (needs a schema step and the route change).

**2. Recently decided.**
- Per row: decision badge (Approved green, Rejected gray, matching the reimbursements `StatusBadge` shape), decision date and time (America/New_York, explicitly, because Vercel renders in UTC), amount, payee and memo, fund (Transfer/Sweep chip with from → to, same as pending), entity name as small secondary text, recorded by, decided by, and either the minute citation (approved) or the rejection reason (rejected). Long reasons and citations must be fully reachable by touch (wrap or "show more"), not a `title` tooltip.
- Cap: **a fixed 25, no pagination**, matching the request ("only a history of the last 25"). Footnote: "Showing the 25 most recent decisions. For older entries, use the Ledger register or search." with links. (The reimbursements page paginates at 50 because it is a work queue; this is a "did someone already do it" glance.)
- Includes rejected, yes. A rejected item is as relevant to the second board member as an approved one.
- Transfer/Sweep pairs count once (dedup to the expense leg, same rule as pending; both legs are decided atomically so filtering to `flow='expense'` in SQL before the limit is safe).
- Order: by decision time, `coalesce(approved_at, rejected_at, updated_at)`, newest first.
- **No per-entity filter.** The rest of the Ledger is entity-scoped because the two books are separate; this page is deliberately cross-entity (it calls `getPendingApprovals()` with no entity today, because one board decides for both). Show the entity name on each row instead. Revisit only if volume makes 25 rows unmanageable.
- No sub-filter (Approved / Rejected). Twenty-five rows do not need it.

**3. Deep link states.** See the table above. The decisive design points: validate the id as a UUID before querying (a malformed value cast to a `uuid` column throws and would 500 the page); resolve either leg of a pair; keep the banner on the Pending tab so a member with several pending items still sees them; and let the banner survive `router.refresh()` so an approver gets a confirmation.

**4. Name the approver? Yes.** It is the whole point of complaint 5 ("seeing only one person approved"). Name and timestamp in the banner and the history row. Fallback "a board member" for a null name, never an email. Personalize when the viewer is the decider ("You approved…").

**5. Reset-password side finding: OUT of this pipeline, file as B-155.** The real defect is longer than the one line the orchestrator found. The chain is `/signin` (links to `/forgot-password` with no `callbackUrl`) → `/api/auth/forgot-password` (builds the reset link in an email, no `callbackUrl`) → `/reset-password` (pushes plain `/signin`) → `/signin`. Fixing it means changing an auth email and its token flow and adding a server-validated `callbackUrl` to the forgot-password API, which is a different feature with its own security review. It also does not block this one: the board member's failure was the off-screen button, not the redirect. What IS in scope is the cheaper, prerequisite half: preserving the query string in the proxy and guarding the consumers (N3). Draft text for B-155 is below.

**6. Permissions.** Confirmed above: all under `ledger.approve`, no widening for `ledger.view`, no nav or proxy change.

## Gaps the Request Didn't Address

**N1. Rejection records no decider and no time (blocks scope B as written).** `reject/route.ts` sets only `status`, `rejectionReason`, `updatedAt`. There is no `rejected_by_user_id` or `rejected_at`, and `ledger_audit_log` gets no row on approve or reject. Scope B says "decision, who, when" for both; for rejected rows, "who" does not exist anywhere and "when" is only `updated_at`. **Recommended default:** add two nullable columns, `rejected_by_user_id` (FK `users`) and `rejected_at`, stamped on both legs by the reject route; legacy rejected rows display "decider not on file" and use `updated_at` for the date. **Do not reuse `approved_by_user_id` / `approved_at` for rejections:** `approvedAt` is the lock marker that every PATCH/DELETE/split/waive guard and the register's edit buttons key on (see `reimbursementTransactionStamp` in `src/lib/ledger.ts`), and stamping it on a rejected row would conflate two meanings and corrupt every "approved" query. Needs `schema.ts` plus an idempotent migration. Alternative if the club does not care about attribution on rejections: omit "who" for rejected rows and show "Rejected" with a date only; cheaper, but the banner then cannot satisfy the user's own principle for rejected items. The Verify-First block shows how many rejected rows exist.

**N2. The "approved" stamp is not a board approval (blocks a naive history query).** `approvedByUserId` / `approvedAt` are also written on every **reimbursement payment** as "reviewed and paid by the treasurer" (`reimbursementTransactionStamp`; DECISION-106 says reimbursements have no board step). A history query on `approved_at IS NOT NULL` would list every paid reimbursement as "approved by <treasurer>", presenting a treasurer payment as a board decision. This is exactly the shape of the earlier "a flag means two things" defects in this codebase. **Required discriminator:** `status='posted' AND approved_by_user_id IS NOT NULL AND board_minute IS NOT NULL AND NOT paidReimbursementExists(id)` (the one EXISTS helper in `src/lib/ledger-reimbursement-link.ts`; no new marker). Legacy "approved" reimbursements that carry real board provenance are excluded too: this tab is about disbursements; reimbursements have their own Paid tab. The Verify-First block checks whether any non-reimbursement stamped rows lack a minute (if so, drop the `board_minute` clause and show "No minute on file").

**N3. The email link loses `txn` for signed-out users, and the callback is unvalidated.** (a) `src/proxy.ts` line 37 sets `callbackUrl` to `pathname` only. (b) `src/app/signin/page.tsx` does `router.push(callbackUrl)` on the raw query value, and `register/page.tsx` passes it to `signIn("google", …)`. A crafted `/signin?callbackUrl=https://evil.example` (or `//evil.example`) is an open redirect on a sign-in page, aimed at board members who have just been trained to click a link in this exact email. It exists today; this feature makes the callback load-bearing, so it is the moment to close it. **Required:** a single shared helper, e.g. `safeCallbackPath()`, that accepts only a path beginning with a single `/` (reject `//`, `/\`, any scheme, control characters), falls back to `/members`, and is used by the proxy (when building), signin and register. Roughly 15 lines plus tests; absorbed under the size rule. Must work for both the Google and password paths, and the encoded query must survive the Google round trip.

**N4. Approve and reject are not race-safe, and this feature publishes who "won".** Both routes read `status`, check it, then run `UPDATE … WHERE id = ?` with no `AND status = 'pending'`. Fourteen people are emailed at the same instant, so two near-simultaneous approvals both pass the check and the second overwrites `approvedByUserId`, `approvedAt` and `boardMinute` (last writer wins); an approve racing a reject can leave a row `rejected` with an approver stamp still on it. Today that is a quiet inconsistency; once the history names "the approver", it is a wrong statement on a governance record. **Required:** pin the UPDATE on `status = 'pending'` (and on the partner leg for pairs), treat zero affected rows as 409 with a rollback sentinel so a pair cannot half-apply, and return the decider's name in the 409 body so the dialog can say who got there first. This is the same pinned-UPDATE pattern the ledger move/correct routes already use. Not a schema change; a route change, so it goes to Phase 3.

**N5. The email gives no hint that only one approval is needed.** Add one sentence to both E-1 emails: "Only one board approval is needed. If a colleague has already acted, the link will show who." That alone cuts the confusion for the 13 who click second, and costs nothing.

**N6. Email link target and pairs.** The disbursement email has `txn.id`; the Transfer/Sweep email does not return leg ids today (the insert is a multi-row `values([...])` with no `returning`). Phase 3 must have the pair route return the expense-leg id (or the page must accept a `transferGroupId`) so pair emails deep-link too. The page already needs to resolve either leg (table above).

**N7. Unescaped values in the two E-1 email bodies.** `party` and `memo` are interpolated raw into `approvalHtml` (and `memo` in `transferHtml`). They are treasurer-typed, so the risk is low, but the project has a shared `escapeHtml()` in `src/lib/html-escape.ts` precisely because one omitted copy once mailed unescaped text to the board. Since the lines are being edited, use it. Absorbed.

**N8. Timezone.** `approved_at` and `rejected_at` are naive `timestamp` columns written from server `new Date()`. Format with an explicit `timeZone: "America/New_York"`; do not rely on the server locale (project memory documents the naive-timestamp-as-UTC bug on events).

**N9. Empty and failure states for the history tab** are specified in Flows 5 and 6. A failed history query must not blank the Pending tab.

**N10. Page title and tabs.** The `h1` is "Pending Approvals"; with two tabs it should be "Approvals". Tabs read "Pending (n)" and "Recently decided". The yellow "n disbursements awaiting approval" chip stays on the Pending tab. Tab state is in the URL (`?tab=decided`) so a refresh or a shared link keeps it, with a whitelist on the value, matching the reimbursements page.

**N11. Brand and accessibility checks for Phase 3/4.** Cards `rounded-2xl`; buttons `rounded-lg`, never `rounded-full` (the status chips may be `rounded-full` per the chips rule, as the pending table already does); empty-state card `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`; highlighted row uses `lions-gold` ring, not a card border; focus rings on every link and button; the banner is a `role="status"` region. The dev screenshot shows a Next dev "1 Issue" overlay on this page; QA should open it and confirm it is not a hydration warning from this page.

**N12. Out-of-view context for the approver.** The Approve dialog shows only amount and payee; the approver of a $2,275 item never sees memo, fund or who recorded it inside the dialog (the cards will show it, but the dialog covers them on a phone). Cheap to add memo, fund and recorder to the dialog description. Treated as a follow-up (B-156) unless Phase 3 finds it is trivial.

## Adversarial Pass

- **Redirect targets.** `callbackUrl` is user-controlled and unvalidated at signin and register today; proxy drops the query. Findings and required fix in N3. The `txn` and `tab` parameters are never used as redirect targets.
- **State-machine shortcuts.** The routes, not the UI, are the gate and stay so. Direct POSTs by a non-approver 403 today (confirmed in both routes). The one shortcut that exists is the race in N4. The history tab cannot be used to change anything; it has no actions.
- **Enumeration.** The page gate runs before any lookup, so a non-approver learns nothing from `?txn=`. For approvers, "exists" vs "not found" is not sensitive (they can see every transaction). A malformed id must not produce a different, noisier failure than an unknown one (UUID validation, no 500, no echo).
- **Input boundaries.** `txn` is validated as a UUID before the query. `tab` is whitelisted. Minute (500) and reason (1000) limits are enforced client and server; the server truncates silently while the client rejects, which is acceptable. Long text in history must wrap or clamp without breaking the 360px layout. React escapes page output; email HTML needs `escapeHtml()` (N7).
- **Self-targeting.** The server blocks approving or rejecting your own entry (403, both routes). The UI contradicts it for Reject on own rows (Flow 2). History must not offer any action that lets a user alter their own past decision. Adding `rejected_by_user_id` is a stamp, not a grant of anything.
- **Role escalation.** None added: no new key, no binding, nothing near `admin.users` / `admin.roles`.

## Edge Cases the Request Didn't Mention (checklist)

- OAuth vs password: both must reach the deep link (N3). **pass-through requirement.**
- Access-pending: a user with no features is bounced by the proxy before this page; a user with `ledger.view` but not `ledger.approve` is redirected to `/admin/ledger` silently. Unchanged; acceptable.
- Email queue: no new send; two existing E-1 bodies change (a link, a sentence, escaping). Not a durable-claim path (no `sentAt` or success row is written), so DECISION-102/103 do not apply. Dev QA must still not email real approvers: `sendBulkMemberEmail` is deny-by-default outside production; use `EMAIL_DEV_ALLOWLIST` only with the tester's own address.
- Google Group sync: untouched.
- Empty state on a new install: both tabs specified.
- Mobile 360px: cards, dialogs, banner, history cards, tabs row (two short tabs fit without scrolling).
- Deleted approver account: fallback "a board member".

## Out of Scope (confirm with user)

- Reset-password and forgot-password carrying the callback (B-155).
- A "decided" follow-up email to the other approvers, or retracting the original. The banner is the answer; more mail is more noise.
- Showing the receipt image/link, memo and recorder inside the Approve dialog (B-156).
- Any change to the approval threshold, the one-approver rule, or requiring two approvers.
- Approving or rejecting from the history tab or reversing a decision.
- A complete audit of every approval ever made (the register and search remain the book of record; the tab is "last 25").
- Back-filling `rejected_by_user_id` for existing rejected rows (not recoverable; would need a person, not a query).
- Pushing the deep link to the Ledger overview's "pending" chip or the admin sidebar badge.

## Open Questions

Classified per the project rule. None is a BLOCKING FACT.

*Preference (recommended default adopted, proceed):*
1. History cap: fixed 25, no pagination. Default adopted.
2. No per-entity filter; entity name shown on each row. Default adopted.
3. Name the decider; "a board member" if the name is null. Default adopted.
4. Tabs on the same route via `?tab=decided`; `h1` becomes "Approvals". Default adopted.
5. Two increments: Inc 1 (A, A2, D) then Inc 2 (B, C, E, F). Default adopted; the orchestrator may collapse them into one release if timing allows.
6. Banner stays on the Pending tab for decided items (rather than auto-switching to history). Default adopted.

*Fact-dependent (resolved by the Verify-First block, both branches below):* how many rejected rows exist, and whether any stamped non-reimbursement rows lack a minute. Neither changes which feature is built; both choose the rejected-attribution and discriminator details.

*For the user, one line, not blocking:* "Do you want rejections to record who rejected and when going forward (two new columns, no back-fill), or is a date alone enough on rejected items?" Recommended: record who. Without an answer, Phase 3 proceeds with the recommendation.

## Verify-First block (orchestrator runs, read-only, counts only)

Run against the production branch with `branchId` passed explicitly (CLAUDE.md Workflow Rule 10). Paste the result under a heading **"Production facts (orchestrator, 2026-10-10)"** directly below this Phase 1 section. No personal columns.

```sql
SELECT
  count(*) FILTER (WHERE t.status = 'pending')                                   AS pending_rows,
  count(*) FILTER (WHERE t.status = 'rejected')                                  AS rejected_rows,
  count(*) FILTER (WHERE t.status = 'rejected' AND t.flow = 'expense')           AS rejected_expense_legs,
  count(*) FILTER (WHERE t.status = 'posted'
                     AND t.approved_by_user_id IS NOT NULL
                     AND t.board_minute IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM ledger_reimbursements r
                                     WHERE r.ledger_transaction_id = t.id))      AS board_approved_rows,
  count(*) FILTER (WHERE t.status = 'posted'
                     AND t.approved_by_user_id IS NOT NULL
                     AND t.board_minute IS NULL
                     AND NOT EXISTS (SELECT 1 FROM ledger_reimbursements r
                                     WHERE r.ledger_transaction_id = t.id))      AS stamped_no_minute_non_reimb_rows,
  count(*) FILTER (WHERE t.status = 'posted'
                     AND t.approved_by_user_id IS NOT NULL
                     AND EXISTS (SELECT 1 FROM ledger_reimbursements r
                                 WHERE r.ledger_transaction_id = t.id))          AS reimbursement_stamped_rows
FROM ledger_transactions t;
```

Why it matters, and what to do under each outcome:

| Result | Meaning | Recommendation |
|--------|---------|----------------|
| `reimbursement_stamped_rows` > 0 (expected) | Confirms N2 is real: a naive "approved" query would list these as board approvals | Keep the `NOT paidReimbursementExists` clause; add a unit test with a reimbursement-stamped fixture that must not appear in history |
| `stamped_no_minute_non_reimb_rows` = 0 | `board_minute IS NOT NULL` is a safe discriminator | Keep it |
| `stamped_no_minute_non_reimb_rows` > 0 | Some non-reimbursement rows were stamped without a minute (imports or pre-requirement rows) | Drop the `board_minute` clause, keep the other two, and render "No minute on file" in the row; do not label them as board decisions in the banner without a minute |
| `rejected_rows` = 0 or very small | Almost no legacy data lacks a rejector | Add `rejected_by_user_id` / `rejected_at` going forward; legacy rows are a footnote |
| `rejected_rows` larger, and the user does not want to lose who | Legacy rejections would show "decider not on file" | Same columns going forward; the legacy rows are honest, not guessed. Do not guess a rejector from `recorded_by` or `updated_at` |
| `board_approved_rows` = 0 | Unexpected; would mean the stamp convention differs in production | Stop and re-ask; do not build the history tab on an assumption |

## Proposed backlog/DECISION text (drafts only; do not file from here)

**Proposed B-155.** *Password reset drops the sign-in callback.* The chain `/signin` → `/forgot-password` → reset email link → `/reset-password` → `/signin` never carries `callbackUrl`, so a member who followed an email deep link and had to reset their password lands on `/members` instead of the page they were sent to. Fix: `/signin` passes `callbackUrl` to `/forgot-password`; the forgot-password API accepts it, validates it with the shared `safeCallbackPath()` helper (introduced by the approvals pipeline, same-origin path only), and embeds it in the reset link; `/reset-password` forwards it to `/signin`. Must not widen the reset token's scope or log the callback with the token. Needs the auth-email review (the queued reset-link body is a credential and is redacted by `redactQueuedEmailHtml()`). Origin: `docs/work-log/2026-10-10-approvals-mobile-and-history.md`.

**Proposed B-156.** *Approve dialog shows too little context.* The dialog shows amount and payee only; on a phone it covers the card that carries memo, fund and recorder. Show memo, fund (with Transfer/Sweep from → to) and recorder in the dialog description, and link the receipt if the pending row has one. Origin: same work-log.

**B-157:** reserved, release if unused. (If Phase 3 declines the rejection-attribution columns in N1, use B-157 for "record rejector and time on reject".)

**Proposed DECISION-116.** *Board-decision history keys on its own markers, never on the lock stamp.* (1) `approved_by_user_id` / `approved_at` are the immutability lock and also carry "reviewed and paid by the treasurer" on reimbursement-derived rows (DECISION-106); they are therefore not evidence of a board approval by themselves. The Recently decided view treats a row as a board approval only when `status='posted'`, `approved_by_user_id` and `board_minute` are set, and `paidReimbursementExists()` is false. (2) A rejection is stamped on its own columns (`rejected_by_user_id`, `rejected_at`); the approve columns are never reused for a rejection. (3) The approve and reject routes pin their UPDATE on `status='pending'` and 409 on zero rows, so "who decided" is a single, true statement. (4) The decider's name and the board-minute citation are visible only to `ledger.approve` holders and are not exposed on any `ledger.view` surface. Release DECISION-116 if the design departs from this.

## Hand-off notes for Phase 2 and Phase 3

- **Phase 2 (architect):** shared `safeCallbackPath()` home (client-safe, used by `src/proxy.ts`, signin, register); where the history query lives (`ledger-queries.ts`, admin-only, not re-exported to `ledger.view` callers); whether the `?tab=` split stays in `page.tsx` or the cards become a shared component used by Pending and History. Two columns on `ledger_transactions` (N1) need `database-admin`.
- **Phase 3 must name:** the pinned-UPDATE and rollback-sentinel shape for both routes (N4); the 409 body shape the dialogs branch on, in a client-safe carrier module; which id the pair email carries (N6); unit tests for the history discriminator including a reimbursement-stamped fixture, a direct-posted-under-threshold row, a legacy rejected row (null rejector), a Transfer/Sweep pair (counts once), and a deleted id; a proxy test that the query string survives and that `//evil`, `https://evil`, `/\evil` are rejected by the guard.
- **QA (Phase 5):** 360px and 390px click-through as a board-only user (`board_member` + `member`); two browser sessions approving the same row at once; stale-link click signed out and signed in, with both Google and password sign-in; dev email only to the tester's own allowlisted address.


## Phase 1 — Functional Refinement — 2026-10-10

**Owner:** analyst
**Status:** complete

### Summary
Verdict READY WITH NOTES. Scope A-D is right in spirit but needs three additions to be true (callback round trip, race-safe decision, rejection attribution) and one exclusion (reimbursement payments carry the same "approved" stamp and must not appear as board approvals). Recommended as two increments: Inc 1 = A + 409 handling + D; Inc 2 = B + C + callback fix + race-safe routes.

### What I did
- Read the page, both dialogs, both routes, E-1 emails, `getPendingApprovals`, the mobile screenshot, proxy, signin/register/reset-password, the reimbursement stamp helper and the reimbursements page tab precedent.
- Ran the five passes; answered the six questions; wrote a Verify-First block and draft B-155, B-156, DECISION-116 text.

### Outputs
- This work-log (Phase 1 section, Per-Phase Status row). No code, no edits to `docs/backlog.md` or `docs/decisions.md`, no email, no database access.

### Open questions / handoff notes
- Orchestrator: run the Verify-First SQL and paste results under "Production facts (orchestrator, 2026-10-10)" below this section.
- User (one line, not blocking): record who rejected going forward? Recommended yes.


## Production facts (orchestrator, 2026-10-10)

Read-only counts run by the orchestrator against production (`PROD_DATABASE_URL`, psql, the exact Verify-First statement above). No personal columns.

| Column | Value |
|--------|-------|
| `pending_rows` | 0 |
| `rejected_rows` | 0 |
| `rejected_expense_legs` | 0 |
| `board_approved_rows` | 1 |
| `stamped_no_minute_non_reimb_rows` | 0 |
| `reimbursement_stamped_rows` | 2 |

Outcomes per the analyst's table: N2 is confirmed real (2 reimbursement-stamped rows would appear in a naive history query — keep the `NOT paidReimbursementExists` clause and the unit-test fixture); `board_minute IS NOT NULL` is a safe discriminator (keep it); no legacy rejections exist, so adding `rejected_by_user_id` / `rejected_at` going forward has no "decider not on file" rows to display today (keep the legacy fallback in the UI anyway — it costs one branch). `board_approved_rows` = 1 is non-zero, so the stamp convention holds; proceed to Phase 2 on the recommended branch.


## User decisions (orchestrator, 2026-10-10, during Increment 1 Phase 5)

User's words: "yes, record who rejected going forward.  i also think we should allow multiple people approve"

1. **Rejection attribution confirmed.** `rejected_by_user_id` / `rejected_at` ship in Increment 2 as designed (Phase 1 N1, Phase 2 ruling 2).
2. **Multiple approvers — NEW FLOW, routed back to Phase 1 for Increment 2** (CLAUDE.md "Scope is routed at the phase where it appears": a new flow → Phase 1). Orchestrator's recommended default, stated to the user and adopted unless they object: the first approval still posts the transaction (money controls unchanged); subsequent `ledger.approve` holders may add a co-signing approval that is recorded and shown in the history and the `?txn=` banner ("Approved by X; also Y, Z — add your approval"); no quorum. A quorum (N-of-M before posting) is a board governance change and is explicitly out unless the user asks for it.

Increment 1 (Phase 5 in progress) is unaffected: its scope has no approval-history data model.

- **2026-10-10, after the Increment 1 push.** User, in their own words: "ok continue with 2a and then continue with 2b. take it all the way to production." Read as: run 2a and 2b through Phase 4, 5 and 6, then `/pre-push` on the combined tree and commit and push to `main` without a further approval round. The quorum question was asked twice and not answered, so the no-quorum default (first approval posts; later approvals are informational co-signs) is now the recorded decision for 2b. No quorum objection as of this entry. Push still runs only after every pre-push gate is green.

# Phase 1 addendum — multiple approvers (Increment 2) — 2026-10-10

**Owner:** analyst
**Status:** complete
**Trigger:** User decision 2 above ("allow multiple people approve"), routed back to Phase 1 because it is a new flow (CLAUDE.md "Scope is routed at the phase where it appears"). Increment 1 (Phase 5 in progress) is not touched and not affected; nothing below changes its scope. Read-only review: no code, no database, no email, no edits outside this work-log.

## VERDICT

**READY WITH NOTES.** The orchestrator's adopted default (the first approval posts exactly as today; later `ledger.approve` holders may add a recorded, informational co-signing approval; no quorum) is sound and I treat it as the requirement. No BLOCKING FACT, and no production count changes the design (see Verify-First, below). **This addendum changes the data model, so Increment 2 must go back through Phase 2** (new table, new route, new importer-restricted surface), then a Phase 3 addendum. Increment 1 and the rest of Increment 2 (rejection columns, History tab, deep link, `safeCallbackPath()`) are unaffected and do not wait. Four notes change the shape of the work and are listed under "Notes that change the work" (C1 to C4).

## ONE-LINE TAKE

> A board member who arrives second can add their name to an approval that has already posted, and everyone who opens the link can see who has approved; it must stay an informational record, not a second control, so it should live in its own append-only table keyed on the expense leg, be one tap with no free text, and be impossible to read as "a vote" (no "2 of 14", no effect on the books).

## Is the default sound? (the check the orchestrator asked for)

Yes, with two things said out loud so nobody builds more than was agreed:

1. **A co-sign is an endorsement, not an authorization.** The entry is already posted, locked, and reconcilable on the first approval. A co-sign changes nothing about money, the `approvedAt` lock, reconciliation, the 990, acknowledgment letters, or any report. It must stay that way: no code path may ever treat "more than one approval row" as stronger authority (that is the "a flag means two things" defect this codebase keeps paying for). That goes into the proposed DECISION below and into a source-scan test.
2. **It is one-directional.** A board member who disagrees with a posted approval has no way to record dissent, and a list that only shows who clicked can be misread as the whole board's view. Wording must never imply completeness ("Approved by 3", "2 of 14"). Dissent/objection is out of scope; flagged as a question so the user knows the asymmetry exists.

If the user's real intent is **a quorum** (N approvals before it posts), this is the wrong feature. The orchestrator already stated the default to the user, so I do not mark it BLOCKING, but the co-sign slice should not enter Phase 4 until the user has had the chance to say "no, I meant quorum" (see Open Questions, Q1). The design below is quorum-neutral: the new table is generic enough that a later quorum would add rows to it while pending.

## Pass 1 — User verbs

All on the **admin surface, `ledger.approve` holder** (board member, admin; the treasurer only via Board-group membership). No new surface for anonymous visitors, no-role members, or `ledger.view`-only holders.

| Verb | Where | Notes |
|------|-------|-------|
| Open the email link and learn the entry is already approved, by whom, and who else | `?txn=` banner | per stale click, up to 13 per entry |
| Add my approval to an entry that is already approved | Banner button, and a button on each approved card in Recently decided | one tap plus one confirm; 44px target |
| See the list of everyone who has approved, with dates | History card (full list), banner (first three names plus "and N others") | |
| See that I already approved, and when | Banner / card | no button shown |
| See "you recorded this, so you cannot approve it" | Banner / card | recorder of either leg |
| Lose the approve race (409 "X already approved") and be offered to add mine instead | Approve dialog's 409 handling | see C3 |
| Withdraw my approval | **does not exist** (Q5) | |
| `ledger.view`-only holder, treasurer without Board membership, anonymous, no-role member | nothing new | cannot see signer names |

## Pass 2 — Flow audit

**Flow C1 — Add my approval from the email link.** Entry: email link `/admin/ledger/approvals?txn=<id>` (signed-out goes through the existing callback round trip). Step: banner reads "Approved by {P} on {date}. {Also approved by {A} and {B}.}" with an **Add your approval** button. Step: dialog (on `LedgerDialogShell`) shows amount, payee, fund (Transfer/Sweep from to), memo, recorded by, and the board minute on file **read-only**; buttons Cancel / **Add my approval**. Step: server records it. Outcome: toast "Your approval was added.", `router.refresh()`, banner now reads "You added your approval on {date}. Approved by {P} on {date}. ..." with no button.
- Failure (all branch on a typed `code`, never English; dialog closes and refreshes except on network):
  - already added by me (double-tap, second device): `already_cosigned`, info toast "You already added your approval on {date}." Treated as success-shaped; closes.
  - I am the posting approver: `already_approved`, "You approved this on {date}." closes.
  - entry is still pending (should be unreachable from the UI, reachable by a stale tab or a direct POST): `not_approved`, "This entry is still waiting for its first approval." closes, refresh shows it on Pending.
  - rejected: `rejected`, "{Name} rejected this {noun} on {date}, so it cannot take more approvals."
  - posted without a board decision (reimbursement payment, under-threshold Sweep): `not_board_decision`, "This entry did not need board approval."
  - I recorded either leg: 403, "You recorded this entry, so another board member needs to approve it." (UI hides the button; server is authoritative).
  - deleted or unknown id: 404 `not_found`, "We can't find that entry. It may have been deleted." closes.
  - network or 500: "Could not add your approval. Please try again." dialog stays open.

**Flow C2 — Add my approval from Recently decided.** Entry: `?tab=decided`. Each **approved** card shows "Approved by {P} · {date}" and, when any exist, "Also approved by: {A} ({date}), {B} ({date})" (wrapped list, fully reachable by touch), plus the button when I am eligible. Same dialog and outcomes as C1. Rejected cards: no approvals line, no button.

**Flow C3 — Lose the approve race.** Entry: Approve dialog on a pending card; a colleague's approval lands first; the 409 from `decideTransaction()` says `decision: "approved"`, `decidedByViewer: false`. Today (Increment 1) the dialog closes, refreshes, and toasts "{Name} already approved this ... Only one approval is needed." With co-sign that sentence is now misleading (it implies there is nothing more to do). Required in Increment 2: close, then `router.replace` to `/admin/ledger/approvals?txn=<id>` so the person lands on the C1 banner with the button, and the toast reads "{Name} already approved this {noun}. You can add your approval too." The minute they typed is discarded (they never cited a different motion; the minute on file is shown). This changes two Increment 1 strings and one branch in `approvalFailureAction`, **in Increment 2, after Increment 1 ships**.

**Flow C4 — Pair.** A Transfer or Sweep is one entry to the person (expense leg is the displayed leg). One approval row covers the pair; either leg's id in `?txn=` resolves to it. Eligibility checks the recorder of **both** legs, as the shipped self-rule does.

**Flow C5 — The posting approver and recorder look at the entry.** Posting approver: "You approved this ... on {date}." plus others, no button. Recorder: "You recorded this {noun}, so you cannot approve it. {P} approved it on {date}." no button.

## Pass 3 — Permissions

- **Permission:** existing `ledger.approve` covers adding an approval and reading the list. **No new `FEATURES` key, no role-binding migration, no nav or proxy-rule change** (same page, same required feature, so DECISION-082 derivation is untouched). The new route is `POST /api/admin/ledger/transactions/[id]/cosign`, gated by `auth()` + `hasFeature(LEDGER_APPROVE)` as its first statements, like approve and reject.
- **Default roles:** unchanged: `admin`, `board_member`.
- **Can the treasurer co-sign? Yes, exactly when they already hold `ledger.approve` (Board-group membership) and did not record either leg.** A treasurer without Board membership does not hold the key and cannot, which is the intended separation (the treasurer records, the board approves). Recommend **not** binding `ledger.approve` to the `treasurer` role to make this work; that is a governance decision, not a side effect of this feature, and DECISION-115 deliberately kept approvals with the Board.
- **Confirmed no `ledger.view` exposure.** I grepped for transaction-approver display: `ledger_transactions.approved_by_user_id` is read only by the approve route, the reimbursement route, the correction queries, `ledger.ts` helpers and `getPendingApprovals`; the only "Approved by {name}" component (`budget-approval-panel.tsx`) belongs to a **different table** (`ledger_budget_approvals`). So no register, search, report or overview surface shows a transaction approver today, and none may start showing co-signer names. Name collision to avoid: the new table must not be called anything like `ledger_approvals`; use a name that says "co-sign" (suggested `ledger_transaction_cosigns`).
- **Role-escalation check:** a co-sign confers nothing and nothing reads it as a grant. Nothing near `admin.users` / `admin.roles`; `treasurer` gains nothing.

## Pass 4 — Edge cases the addendum must address

- **OAuth vs password:** identical; the flow needs only a session with `ledger.approve`.
- **Access-pending:** a user with no features never reaches the page (proxy), unchanged.
- **Email queue:** **no email on a co-sign** (deliberate: 13 more emails per decision is the noise the user complained about in reverse). The pending-approval email sentence is reworded (item 6 below). Not a durable-claim path (no `sentAt`, no success row, no "sent" history), so DECISION-102/103 do not apply; the existing deny-by-default and `sendBulkMemberEmail()` rules are unchanged.
- **Google Group sync:** untouched.
- **Empty state:** no co-signs means no "Also approved by" line at all (never "Also approved by: none"). A new install with no decisions is the existing Recently decided empty state.
- **Failure microcopy:** Flow C1 table. Network failure keeps the dialog open.
- **Mobile 360px:** banner with a full-width 44px button below the text, wrapped names, dialog on `LedgerDialogShell` (same fit as the Approve dialog), history card name list wraps (up to ~13 names fits without horizontal scroll).
- **Brand:** Add-your-approval button is a secondary `rounded-lg` button (`border-2 border-lions-blue text-lions-blue`, 44px), because Approve stays the primary action; the banner is `role="status"`, success tone; cards `rounded-2xl`; destructive styling not used (nothing here is destructive); the dialog is a Radix `Dialog` via `LedgerDialogShell`, never a native confirm.
- **Timezone:** the co-sign time is a naive `timestamp` written from server `new Date()`, like `approved_at`; format with explicit `America/New_York` through the shared `formatDecisionDateTime()`.
- **Volume:** at most ~13 co-signs per entry (every other approver). The banner shows the first three by name then "and N others"; the history card shows all.

## Pass 5 — Adversarial

| Probe | Finding |
|-------|---------|
| Two co-signs racing | **Same user twice** (double-tap, two devices): unique `(transaction_id, user_id)` plus `INSERT ... ON CONFLICT DO NOTHING RETURNING`; zero rows becomes 409 `already_cosigned`. **Two different users:** both succeed; there is no "winner", unlike approve. Order is `approved_at ASC, id ASC` for display. |
| Posting approver co-signing their own approval | Under the recommended model (the posting approval stays on the transaction columns) the unique constraint does **not** cover this, so the helper must compare against `approved_by_user_id` and return `already_approved`; needs its own test (see Data model, consequence 4). |
| Co-sign after a Delete | **Not reachable through the app.** `DELETE` refuses any row with `approvedAt` (403; both legs of a pair), and a co-sign requires `approvedAt`. A pending row can be deleted, but a pending row has nothing to co-sign (409 `not_approved`, or 404 if already gone). Only an entity or fund cascade removes an approved row; the FK `ON DELETE CASCADE` removes its co-signs with it, and a late POST gets 404. The "sent acknowledgment" guard is irrelevant (it protects income rows). No new guard needed; pin the existing 403 with a note, do not add code. |
| Co-sign on a row moved cross-entity (DECISION-112/113) | **Not reachable.** `moveBlockKind()` refuses any row with `approvedAt` (`approved`), any pending or rejected row, and any Transfer/Sweep leg (`transfer_leg`). The two move cells are income-only anyway. An approved entry therefore never changes entity, fund or bank account after approval. The co-sign table stores **no** denormalized entity, fund, or amount, so there is nothing to go stale; the dialog reads the live (immutable) row. |
| Co-sign shows a different figure than the approver saw | Cannot happen: approved rows are immutable (PATCH 403 on `approvedAt`), so a co-signer always sees final money fields. This is a point in favor of co-sign over the open B-158 gap (which only affects the first, pre-approval decision). |
| Co-sign on a rejected row | Refuse, 409 `rejected`. |
| Co-sign on a reimbursement-stamped row | Refuse, 409 `not_board_decision`, via the same `boardDecisionPredicate` the history uses (`NOT paidReimbursementExists`). The two production rows are exactly this case. |
| Co-sign on an under-threshold Sweep | Posts at once with a creation-time minute and no `approved_at`; not a board decision; refuse `not_board_decision`. |
| Posting approver later deleted | `approved_by_user_id` goes NULL (`ON DELETE SET NULL`, already ruled); entry stays a board decision via `approved_at`; shown as "a board member". Co-signer user deleted: `user_id` NULL (same rule), row survives, shown as "a board member" (collapse several unnamed into "N other board members"). **No logic may key on a non-null user id** (the same trap Phase 2 R3 caught for the history discriminator). |
| One person, two accounts | The unique key is the account, not the person (the roster supports two household members sharing one email with distinct logins). A person could add their approval twice from two accounts. Accepted residual: a co-sign is informational with no control weight. If a quorum is ever built this must be revisited. Record it in the DECISION. |
| Impersonation | The acting user id comes only from the session; the route accepts **no body fields at all**, so there is no client-supplied user id, minute, or text to validate. |
| Enumeration | Approvers can already see every transaction; 404 for unknown or malformed ids is fine. Unknown vs malformed are the same 404. |
| Self-targeting | Recorder of either leg is refused server-side (403) and hidden in the UI from one shared pure `cosignEligibility()` function (so the page and the route cannot drift, as `rowActions` already does for approve and reject). A co-sign grants nothing. |
| Open redirect | Nothing new. The post-lost-race `router.replace` target is built from a validated UUID in code, never from user input. |
| Reuse the pinned-UPDATE helper? | **No: a sibling path.** `decideTransaction()` is a state transition (pending to posted or rejected) pinned on `status = 'pending'`; its step 2 turns "not pending" into a 409, which is the exact opposite of a co-sign's precondition (must be posted with a board decision). A co-sign is an INSERT with no transition, so there is nothing to pin an UPDATE on. Add a sibling server-only function (suggested `cosignTransaction()` in its own module) that reuses the existing building blocks rather than copying them: the single-statement `ORDER BY id FOR UPDATE` lock of the pair, the either-leg recorder rule, and `displayDeciderName()`. If extracting those from `ledger-approval-decision.ts` costs under ~30 lines, extract; otherwise this is copy number two of two and Phase 3 should say so. Approve and reject are mutually exclusive with co-sign by state (co-sign needs approved; approve and reject need pending), so a lock is belt and braces against a future un-approve path, not a live race. |

## Answers to the nine items

**1. Data model direction (Phase 2/3 rule; I do not decide).** Two shapes, and the user-visible consequences of each:

| | **A. Co-signs only in the new table; the posting approval stays on `ledger_transactions` columns (my recommendation)** | **B. Every approval, including the posting one, is a row; the transaction columns are kept as the lock/provenance and the first approval is also copied into the table** |
|---|---|---|
| Posting approver in the same list? | Not in the table. UI assembles "Approved by {P}" plus "Also approved by ..." from two sources through one pure function. Wording distinguishes the act that posted it from the endorsements. | Yes, one uniform list; the poster is the earliest row (or a flag column, which is the "flag means two things" shape). |
| Source of truth | One per fact: columns say who posted it, the table says who endorsed it. | Two for the poster (columns and a row) that can drift unless written in one transaction and tested. |
| Backfill | None. | Required for production's 1 board-approved row and any dev rows, using the history discriminator so the 2 reimbursement-stamped rows are **not** backfilled. |
| Touches shipped Increment 1 helper | No (Increment 2 already edits it for the reject stamps). | Yes, dual write inside `decideTransaction()` again. |
| History ordering | By the posting decision time, unchanged; a late co-sign never bumps an old entry up or reorders the list. | Would invite "latest signature" ordering; must be pinned to the earliest row to stay stable. |
| Deleted user | Poster NULL on the transaction, co-signers NULL on rows; both "a board member". | Poster NULL in two places. |
| "Already signed" rule | Unique `(transaction_id, user_id)` for co-signers **plus** an explicit compare to `approved_by_user_id` (a test). | One unique constraint covers everyone. |
| Quorum later | Needs a data change to fold the poster into the list. | Closest to quorum-ready. |

Recommendation A: it keeps `approved_*` meaning exactly what DECISION-116 says (the lock and the posting approval), adds no dual write and no backfill, and keeps the table's meaning single ("an endorsement after posting"). Either way: keyed on the **expense leg id** (one row covers a Transfer/Sweep pair; either leg in `?txn=` resolves to it), `transaction_id` FK `ON DELETE CASCADE`, `user_id` FK `ON DELETE SET NULL`, a server-set naive `approved_at`, unique `(transaction_id, user_id)`, no denormalized amount/entity/fund, and no `board_minute` column (item 4). Not named `ledger_approvals` (collision with `ledger_budget_approvals`).

**Query-shape constraint for Phase 3 (a real trap):** the History query's `LIMIT 25` must stay on `ledger_transactions`. Do **not** join the co-sign table into that statement (fan-out would make the cap 25 rows of signatures, not 25 decisions). Fetch co-signs for the returned ids in one second query (`WHERE transaction_id IN (...) ORDER BY approved_at, id`), or an aggregated subselect. The deep-link resolver does the same for its single row.

**2. Who may co-sign.** Any `ledger.approve` holder except (a) the recorder of **either** leg, (b) anyone who already co-signed, (c) the posting approver. Treasurer: yes if they hold `ledger.approve` via Board membership and did not record the entry; no otherwise; do not bind the key to `treasurer`. Eligibility is one pure function in the client-safe carrier, used by the route and the UI.

**3. Refusals.** Rejected: refuse (`rejected`). Reimbursement-stamped, under-threshold Sweep, or any posted row without a board decision: refuse (`not_board_decision`) using the one `boardDecisionPredicate`, so the resolver, the History list, and the co-sign route can never disagree about what a "board decision" is. Pending: refuse (`not_approved`). Transfer/Sweep: one co-sign covers the pair; the row is keyed on the expense leg and the recorder rule reads both legs.

**4. Minute.** **Recommend: no minute on a co-sign.** The minute is the motion, and the motion is already on the entry; it is shown read-only in the dialog. Even an optional, prefilled field would put free text on a one-tap phone action, invite 13 people to retype it, and allow two different citations on one record, which is worse for an audit than one. It also removes the entire input-validation surface (the route takes no body). If the board ever wants a co-signer to record a ratification minute at a later meeting, that is a separate, additive, nullable column and a follow-up, not a reason to build it now.

**5. Withdraw / un-approve.** **No. Append-only,** like proposal decisions (DECISION-084) and for the same reason: a record that can be quietly removed is not a record. The cost is that a mistaken tap stays on the entry; mitigated by the confirm dialog and by the fact that a co-sign carries no money effect. There is no in-app removal and hand SQL is barred (Workflow Rule 10), so file a Later backlog item for an audited, `ledger.manage`-gated removal that writes a `ledger_audit_log` row, to be built only if it is ever needed (proposed text below).

**6. Banner, history, tabs, email wording.** `{P}` = posting approver, `{A}, {B}` = co-signers in time order, names via `displayDeciderName()` (never an email; "a board member" for null). The banner applies to the approved states only; every other state in the Phase 3 table stands. **This replaces the Phase 3 rows "approved by someone else" and "approved by viewer"**, because "there is nothing more to do" is no longer true.

| Viewer / state | Banner (tone success unless noted) | Button |
|---|---|---|
| Approved, I am eligible, no co-signs | "Approved by {P} on {date}. It has been posted. You can add your approval too." | Add your approval |
| Approved, I am eligible, with co-signs | "Approved by {P} on {date}. Also approved by {A} and {B}. You can add your approval too." (more than three: "{A}, {B}, {C} and 4 others"; link "See everyone under Recently decided") | Add your approval |
| I am the posting approver | "You approved this {amount} {noun}{to} on {date}. {Also approved by {A} and {B}.}" | none |
| I added my approval | "You added your approval on {date}. Approved by {P} on {date}. {Also approved by ...}" (others excluding me) | none |
| I recorded it | "You recorded this {noun}, so another board member decides it. Approved by {P} on {date}. {Also approved by ...}" (neutral tone) | none |
| Pending, rejected, not a board decision, not found | unchanged from the Phase 3 table | none |

History card, approved: line 1 "Approved by {P} · {date time}"; line 2, only when any exist, "Also approved by: {A} ({date}), {B} ({date})" as a wrapped list; the button only when eligible. The count is never shown as a fraction of the board and never labelled "votes". **Tabs:** Pending is exactly `status = 'pending'` (unchanged); an approved entry never returns to Pending and there is **no "needs your approval too" queue and no badge** (a co-sign is optional, not a work item; do not add it to the Pending count, the layout badge or the sidebar). A co-signable entry is reachable from Recently decided (if in the 25) or from the `?txn=` banner (for older ones). The Recently decided header gains one line of help: "These are already posted. You can add your approval to any entry you did not record." Ordering stays on the posting decision time. **Email:** replace the Phase 3 sentence with "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too." It ships in the same builder, unconditionally, so it must ship in the **same delivery** as the co-sign UI (C2 below).

**7. Permissions.** Unchanged `ledger.approve`; confirmed above that no `ledger.view` surface shows signer names; the new table is read only by the approver-only module(s). Extend the Phase 2 R3 importer scan: the table's schema identifier may be referenced only by the co-sign module, `ledger-approval-queries.ts`, `schema.ts` and their tests (a schema export is importable by anything, so the scan must be on the table identifier, not the module).

**8. Adversarial.** See Pass 5. Summary: same-user race handled by the unique constraint; different-user race is a non-event; delete and cross-entity move are closed by the existing `approvedAt` locks (so no new guard, one test that pins the dependency); deleted approver handled by `ON DELETE SET NULL` and "never key on a non-null user id"; **sibling path, not the pinned-UPDATE helper.**

**9. Verify-First.** None needed. The only count that would differ between data models is the backfill size under shape B, and it is already known (1 board-approved row; the 2 reimbursement-stamped rows must be excluded). No production fact changes which feature is built or which shape is recommended. If Phase 2 picks B, the backfill reuses the History discriminator and its dry-run count is the existing `board_approved_rows = 1`. (I considered counting role holders to size the name list; it does not change the design, the 13-name wrap is handled in the UI.)

## Notes that change the work

- **C1. The new flow adds a table, a route, a dialog, and a banner action** (not a tweak). It needs Phase 2, then a Phase 3 addendum: carrier additions (`cosignEligibility()`, `CosignConflictBody` with typed `code`, banner builder extension), the sibling server function, the second-query rule, the importer scan, and a combined migration decision.
- **C2. Ship it with the rest of Increment 2, ordered last.** The email sentence ships unconditionally in the builder, so the co-sign UI and the sentence must be the same delivery. Recommended: one migration file for the two reject columns **and** the co-sign table (one dev-server restart, one worktree), co-sign implemented as the last, separable step of Phase 4 so it can be dropped cleanly if the user answers Q1 with "quorum".
- **C3. One shipped string, one design row and one branch become wrong the moment co-sign exists** ("Only one approval is needed" in `describeApprovalConflict`; the Phase 3 banner row "nothing more to do"; `approvalFailureAction` for `approved` by someone else). Change them in Increment 2 only; do not touch Increment 1.
- **C4. The co-sign dialog shows final, immutable figures,** so it is not exposed to the B-158 "approved a number that changed" gap; B-158 stays scoped to the first decision.

## Edge-case checklist results (carried forward)

OAuth and password: pass-through. Access-pending: unchanged. Email: no new send, sentence reworded. Google Group sync: n/a. Empty state: no co-signs renders nothing extra. Failure copy: specified. Mobile 360px: specified. Brand: secondary `rounded-lg` button, `rounded-2xl` cards, `role="status"` banner, `LedgerDialogShell`, no native dialogs.

## Out of scope (confirm with user)

- A quorum or any second approval required before posting (governance change).
- Recording dissent or an objection; multiple rejectors.
- Withdrawing or editing a co-sign (backlog item below if ever needed).
- A co-sign email, a "needs your approval" queue, badge, or count.
- A ratification minute on a co-sign.
- Showing co-signers anywhere outside the Approvals page (register, search, reports, overview, 990).
- Giving the treasurer role `ledger.approve`.

## Open questions

*BLOCKING FACT:* none.

*Confirm before the co-sign slice enters Phase 4 (not before Phase 2/3), one line to the user:* **Q1.** "When you said allow multiple people to approve, do you mean (a) the first approval posts it and others can add their name afterward, which is what we are building, or (b) the board wants two or more approvals before it posts?" The orchestrator has already shown the user default (a) and the data model is quorum-neutral, so this is a confirmation, not a block. If (b), stop the co-sign slice and re-open Phase 1 for a quorum (that changes pending state, the email, the threshold semantics and the lock rules).

*Preference, default adopted:*
- Q2. UI label "Add your approval" / "Also approved by" (not "co-sign" or "vote"). Adopted.
- Q3. No minute on a co-sign; minute shown read-only. Adopted (item 4).
- Q4. Names: first three in the banner, all in the history card. Adopted.
- Q5. No withdrawal; audited removal only as a Later backlog item. Adopted (item 5).
- Q6. Treasurer gains nothing new; no binding change. Adopted.
- Q7. No email on co-sign; no badge. Adopted.
- Q8. For the user, not blocking: a posted approval has no way to record disagreement. Is that acceptable? Default: yes, out of scope.

## Proposed DECISION/backlog text (drafts only; ID: to be reserved; do not file from here)

**Proposed DECISION (ID: to be reserved; or an amendment to DECISION-116 items 1 and 4).** *A second approval is an informational co-signature, never a control.* (1) The approval that posts a disbursement stays on `ledger_transactions.approved_*`/`board_minute` and remains the immutability lock and the only approval that changes money state. (2) Later `ledger.approve` holders may add a co-signature, stored append-only in its own table keyed on the expense leg (one row covers a Transfer/Sweep pair), unique per user, `user_id` `ON DELETE SET NULL`, no minute, no withdrawal. (3) A co-signature has **no effect** on the books, the lock, reconciliation, reports, the 990, or any gate: no code path may read the number or presence of co-signatures as authorization (source-scan tested). (4) It is allowed only on a row that is a board decision under `boardDecisionPredicate()` (approved, minute present, not reimbursement-derived, not rejected, not pending), never by the recorder of either leg, the posting approver, or someone who already signed. (5) Co-signer names are approver-only data under the same rule as DECISION-116 item 4; the table identifier is referenced only by the approver-only modules. (6) Accepted residual: uniqueness is per account, not per person. (7) Not a quorum; a quorum is a board governance change and needs its own Phase 1.

**Proposed backlog (ID: to be reserved).** *Audited removal of a wrongly added co-signature.* Co-signatures are append-only with no in-app removal. If a mistaken or unauthorized one ever needs to come off, add a `ledger.manage`-gated removal that requires a reason and writes a `ledger_audit_log` row (never hand SQL, Workflow Rule 10). Later; build only on demand. Origin: this work-log.

**Proposed backlog (ID: to be reserved), only if the user answers Q8 "no".** *Record dissent on a posted approval.* A board member who disagrees with a posted approval has no in-app way to say so; consider an append-only objection record shown alongside "Also approved by". Needs its own Phase 1 (what an objection does, who sees it).

## Verdict and routing summary (for the orchestrator)

**READY WITH NOTES.** The adopted default is sound and I treat it as the requirement: the first approval posts exactly as today, and later `ledger.approve` holders may add an informational, append-only co-signature that is shown in Recently decided and in the `?txn=` banner (and offered to the person who loses the approve race). Recommended data model (for Phase 2 to rule on): a new table keyed on the expense leg, unique per user, `user_id` `ON DELETE SET NULL`, no minute, no withdrawal, with the posting approval left on the transaction columns (shape A); the alternative of copying every approval into the table is quorum-friendlier but adds a dual write, a backfill and two sources of truth for the poster. Who may co-sign: any `ledger.approve` holder except the recorder of either leg, the posting approver, and anyone who already signed; the treasurer qualifies only through Board membership and nothing is bound to the `treasurer` role. Refused on rejected, pending, reimbursement-stamped and under-threshold-Sweep rows, all via the one `boardDecisionPredicate`. Delete and cross-entity move cannot happen to an approved row (existing `approvedAt` locks), so no new guard is needed; use a sibling `cosignTransaction()` path, not the pinned-UPDATE helper, because a co-sign is an INSERT with no state transition. **Yes, Increment 2 goes back through Phase 2** (new table, new route, new importer-restricted surface), then a Phase 3 addendum; Increment 1 is untouched and the rest of Increment 2 is unaffected. Ship co-sign in the same delivery as the email sentence, as the last separable step of Phase 4, in a single combined migration with the reject columns. No Verify-First needed. One non-blocking confirmation for the user before the co-sign slice enters Phase 4: that "allow multiple people approve" means others can add their name after it posts, not a quorum before it posts. One shipped Increment 1 string (`describeApprovalConflict`, "Only one approval is needed"), one Phase 3 banner row ("nothing more to do") and one failure branch (`approvalFailureAction`) go stale when this lands; change them in Increment 2 only.

## Phase 1 addendum (multiple approvers) — 2026-10-10 (standard handoff)

**Owner:** analyst
**Status:** complete

### Summary
READY WITH NOTES. Co-signing as an informational, append-only endorsement is sound; recommend its own table keyed on the expense leg with the posting approval left on the transaction columns. Increment 2 must re-enter Phase 2 because the data model changes.

### What I did
- Read the whole work-log (Origin, Phase 1, Production facts, User decisions, Phase 2, Phase 3, both Phase 4 Increment 1 handoffs) and `src/lib/ledger-approval-decision.ts`; checked the Delete route, `moveBlockKind()`, the move policy, the `ledger_transactions` schema and every non-test reader of `approvedByUserId` to confirm what locks an approved row and which surfaces name approvers.
- Ran the five passes on the addition and answered the nine items.

### Outputs
- This work-log only (this section and the Phase 1 row note). No code, no database, no email, no edits to `docs/backlog.md` or `docs/decisions.md`.

### Open questions / handoff notes
- Phase 2 (architect): rule on data model A vs B, table home, the second-query rule for the History cap, the sibling `cosignTransaction()` and what to extract from `ledger-approval-decision.ts`, and the importer scan on the table identifier.
- Phase 3: carrier additions, banner/copy changes (replace the "nothing more to do" rows), the Increment 1 string and branch changes (C3), the combined migration, the email sentence in the same delivery.
- Orchestrator: send the user the one-line Q1 confirmation; reserve IDs for the DECISION and backlog drafts above.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature fits the existing shape: no new key, no nav or proxy-rule change, no new dependency, no new top-level module. Rulings R1 to R7 below are binding on Phase 3 (they correct or sharpen the analyst's recommendations in four places: F lands in Increment 1, the discriminator keys on `approved_at` not `approved_by_user_id`, the history query gets its own approver-only module, and the deep-link highlight reuses `RowHighlighter` rather than a new island). Suggestions S1 to S3 are optional.

## Rulings

### R1. One pipeline, two Phase 4 deliveries; F lands in Increment 1

One work-log, two deliveries. The two increments touch the same files (`approvals/page.tsx`, both dialogs, both routes) and share one design; a second work-log would force a second Phase 1/2 over code the first one is still reshaping. Phase 3 writes one design with two ordered delivery sections.

- **Increment 1 (bug-fix variant, no schema, no migration, no dev-server restart):** A (cards below `md`, 44px targets, Reject hidden on own rows), D (disabled-state hint), A2 (409 handling in both dialogs), **F (race-safe approve and reject, both routes)**, and N7 (escape `party`/`memo` with `escapeHtml()` in both E-1 bodies, because it is independent of everything else and is the only item here that fixes a latent injection-shaped defect).
- **Increment 2 (full):** N1 schema + reject stamp, B (Recently decided), C (deep link + banner), E (proxy callback + `safeCallbackPath()`), N5 sentence + the deep link in the two E-1 emails, N6 (Transfer/Sweep route returns the expense-leg id).
- **Why F is Increment 1, not 2.** The analyst framed F as Increment 2, but the 409 handling in A2 consumes F's response body, and F is a correctness fix with live exposure today: ~14 approvers are emailed at once, and A makes tapping Approve on a phone *easier*, which raises the odds of a near-simultaneous double approve. F is schema-free for both routes (pinning an UPDATE on `status = 'pending'` needs no new column). So Increment 1 ships F fully; the 409 body carries `decision` and `deciderName` for an approve-won race (the approver is on the row). For a reject-won race `deciderName` is `null` until Increment 2 adds the stamp, and the dialog copy must handle null ("rejected by a board member"). Increment 2's reject-route change is then a one-line addition to the `.set()` (rejectedByUserId, rejectedAt) plus the name in the 409 body; no second rewrite.
- **N5 (the "only one approval is needed ... the link will show who" sentence) must NOT ship in Increment 1.** It promises a feature (the banner) that does not exist until Increment 2. It ships with the link, in Increment 2.
- **Gates per increment.** Increment 1 gets its own Phase 5 PASS and a short analyst confirmation (bug-fix variant of Phase 6) before the orchestrator pushes; Increment 2 gets full Phase 5 and the closing Phase 6 SHIP IT. The pipeline is not closed until the second.
- **Concurrent-pipeline note.** Another work-log is open in the tree (`2026-10-09-september-admin-session-closing-balance`). Increment 2 adds a migration, so under Concurrent Pipelines rule 5 its Phase 4/5 run in a worktree with its own Neon branch if that pipeline is still in Phase 4/5 then. The migration number is a placeholder (see R2); `src/lib/db/schema.ts` is the shared hot file.

### R2. Schema: new columns on `ledger_transactions`, not `approved_*`, not an audit row

Approved: add `rejected_by_user_id uuid` (FK `users`, `ON DELETE SET NULL`, matching `approved_by_user_id`) and `rejected_at timestamp`, both nullable, stamped on **both legs** of a pair by the reject route, in the same pinned UPDATE.

- **Not (a), reusing `approved_*`.** Confirmed with the analyst: `approvedAt` is the lock marker that PATCH/DELETE/split/waive guards, the register's edit buttons and `reimbursementTransactionStamp` key on. A rejected row stamped `approvedAt` would be both locked-as-approved and rejected. Never.
- **Not (b), an audit-log row, as the primary store.** `recordLedgerAudit()` is a corrections vocabulary (`move`, `delete`, `correct`, fund-edit, settings) read only by `/admin/ledger/compliance` "Recent corrections", with a JSON payload that cannot be sorted, joined to `users`, or paged in the history query. Writing approve/reject rows would pollute a "what was corrected" reader with ordinary governance flow, and approval is not a correction. The decision already lives on the row; the row is the record. (The honest gap, that a lost race or a later Delete leaves no trace of a decision, is B-157 below, deliberately not in scope.)
- **Both columns together is not needed** and is not recommended: two sources of truth for one fact is the "flag means two things" shape this project keeps paying for.
- **No index.** `ix_ledger_txns_status` already narrows the history query; the table is small (production had 1 board-approved and 0 rejected rows on 2026-10-10). Revisit past ~50k rows.
- **No back-fill.** Production has 0 rejected rows; legacy rows (none today) render "decider not on file" and use `updated_at` for the date.
- **Rejected rows are immutable** (PATCH returns 403 for `status = 'rejected'`, route.ts ~line 198), so the new columns never need clearing and there is no un-reject path.
- **Migration (database-admin, Increment 2).** `schema.ts` first, then the SQL, using the 0109 idiom exactly: `ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid; ... rejected_at timestamp;` plus a `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)` guard for the FK. Name the constraint exactly as drizzle-kit derives it, `ledger_transactions_rejected_by_user_id_users_id_fk` (51 chars, under the 63 limit), so `drizzle-kit push --force` finds nothing to "fix". **The filename number is a placeholder:** the newest migration today is `0110_treasurer_permission_baseline.sql`, so `0111` is only a guess; database-admin re-derives the real next-free number with `ls drizzle/migrations/*.sql | sort | tail -3` at the start of Phase 4, and the migration file is not added to the shared tree until the schema step is complete (Concurrent Pipelines rule 2).
- **Type fallout to expect.** Adding columns widens `LedgerTransaction`; `getPendingApprovals` enumerates its select list by hand and typed fixtures in tests will stop compiling until the two fields are added. That is `tsc` doing its job, not scope creep. Separately, any full-row `db.select().from(ledgerTransactions)` result passed as a prop to a client component now also serializes `rejectedByUserId` (a uuid, same exposure class as the existing `approvedByUserId`); Phase 4 should glance at the register and search select lists but this is not a blocker.

### R3. Recently-decided query: separate approver-only module, `approved_at` not `approved_by_user_id`

**Placement ruling (differs from the analyst's suggestion of `ledger-queries.ts`).** Put the history query and the deep-link resolver in a new sibling `src/lib/ledger-approval-queries.ts`, not in `src/lib/ledger-queries.ts`. Reasons: `ledger-queries.ts` is a ~3.9k-line grab bag imported by many `ledger.view` surfaces, so a decider-name/minute query living there is one autocomplete away from leaking onto them; the project already splits newer admin-only query sets into sibling `*-queries.ts` modules (`ledger-fund-move-queries.ts`, `ledger-reimbursement-correction-queries.ts`, `ledger-acknowledgment-letter-queries.ts`); and a separate file lets a source-scan test state the rule as an importer allow-list. `getPendingApprovals` stays where it is (the Ledger overview uses it, with its own tests).

**Discriminator ruling (corrects N2 in one clause).** Keep the analyst's structure and the `paidReimbursementExists()` helper (no marker column, consistent with the "derived, never marked" rule in `ledger-reimbursement-link.ts`). But key the stamp test on **`approved_at IS NOT NULL`**, not `approved_by_user_id IS NOT NULL`:

```
flow = 'expense' AND (
  status = 'rejected'
  OR ( status = 'posted'
       AND approved_at IS NOT NULL
       AND board_minute IS NOT NULL
       AND NOT paidReimbursementExists(id) )
)
```

Why: `approved_by_user_id` is `ON DELETE SET NULL`. If an approver's account is ever deleted, the `approved_by_user_id IS NOT NULL` form silently drops a genuine board approval from history, and the deep-link banner would then tell a later board member "this entry did not need board approval", which is false. `approved_at` survives the user delete; the decider name is a LEFT JOIN with the "a board member" fallback (never the email). An under-threshold Sweep, which posts at once carrying a creation-time `board_minute` but no `approved_at`, is still correctly excluded by the `approved_at` clause. The two production reimbursement-stamped rows are excluded by the EXISTS clause (the analyst's unit-test fixture requirement stands).

Query shape requirements for Phase 3:
- Filter `flow = 'expense'` **before** `LIMIT 25` so a Transfer/Sweep pair counts once and the cap is 25 decisions, not 25 legs; LEFT JOIN the income leg on `transfer_group_id` for the "from to" label (self-join with an alias; the pending path does this in JS, history can do it in SQL because of the limit).
- Order `coalesce(approved_at, rejected_at, updated_at) DESC, id DESC` (stable tie-break).
- No entity filter; join the entity name for display. Fixed 25, no pagination.
- Joins: decider via `approved_by_user_id` / `rejected_by_user_id` (alias), recorder, fund, entity. All LEFT.
- The deep-link resolver (`?txn=`) lives in the same module and returns a discriminated union (the states in the Phase 1 table). It validates with the existing `isUuid()` from `src/lib/utils.ts` before the query (a malformed value cast to a `uuid` column throws), resolves either leg of a pair, and a deleted/unknown/malformed id all return the same `not_found` state.
- **Visibility rule.** Decider name, board-minute citation and `rejected_at` are approver-only. Note a correction to the Phase 1 premise: the register ([fundSlug]/page.tsx ~line 563) **already** shows `rejectionReason` (truncated) to `ledger.view` holders. So the rejection reason is not newly exposed; what must stay behind `ledger.approve` is who decided, when, and the minute. The module's header comment states that, and a source-scan test (precedent: the member-surface firewall test in `ledger-audit.test.ts`) asserts the module is imported only by `approvals/page.tsx` (and its own tests). It must not be imported from the Ledger overview, register, search, reports or anything under `src/app/members/**`.
- It also must not export anything the 409 body needs; see R5 for that carrier.

### R4. Deep link, proxy, and the callback guard

- **`?txn=<uuid>` and `?tab=`** are read on the `ledger.approve`-gated page, after `auth()` + `hasFeature(LEDGER_APPROVE)`. `tab` is whitelisted (`pending` | `decided`, default `pending`); `txn` is `isUuid()`-checked before any query and never echoed. Neither is ever used as a redirect target. Nav and `getAdminProtectionRules()` are untouched (same path, same required feature), so DECISION-082 derivation is unaffected and `admin-page-feature-gates.test.ts` still applies to the page unchanged.
- **Highlight and scroll: no new primitive.** The register already deep-links via `?highlight=<id>` handled by `src/components/admin/ledger/row-highlighter.tsx` (DOM id `txn-<id>`, scroll + flash). Reuse the DOM-id convention and that component, but note it strips its param with `router.replace`, which would also re-fetch the server render and drop the `?txn=` banner. So: the server renders the persistent gold ring, `id="txn-<id>"` and `tabIndex={-1}` on the card/row (no JS needed for the highlight), and `RowHighlighter` gets one small backward-compatible extension, an opt-in `keepInUrl` (and, for the keyboard/screen-reader requirement, an opt-in `focus`) prop, both defaulting to today's behavior so its two existing call sites and tests are unchanged. If the extension proves awkward in Phase 3, a ~15-line client effect is acceptable, but a second near-copy of the scroll logic is the thing to avoid.
- **`safeCallbackPath()` home: `src/lib/safe-callback-path.ts`**, flat in `src/lib/`, **no imports at all** (the `src/lib/html-escape.ts` and `club-contacts.ts` "stay pure" precedent), so the proxy, the two client pages and server code can all import it. Not under `src/lib/auth/`: that directory holds the server-only NextAuth config, and a client page importing from it invites an accidental server import. Signature: takes `string | null | undefined`, returns a same-origin path or the fallback `/members`.
- **Rules for the guard** (Phase 3 to fix the exact tests): must start with a single `/`; reject a leading `//` and `/\`; reject any backslash anywhere and any control or whitespace character (browsers strip tab and newline from URLs, so `/<TAB>/evil.example` collapses to `//evil.example`); reject anything with a scheme; length cap (2048); and as a belt-and-braces final check, resolve it against a dummy origin and require the origin to be unchanged before returning `pathname + search` (+ hash). Keep percent-encoded input as a plain path (`/%2F%2Fevil` is a path, not a host).
- **Consumers (exactly three, no fourth copy):** `src/proxy.ts` (build the value as `safeCallbackPath(pathname + request.nextUrl.search)`; this is defense in depth, the proxy's own input is a real request path), `src/app/signin/page.tsx` (both the credentials `router.push` and the Google `signIn`), `src/app/register/page.tsx` (the Google `signIn`).
- **A correction to N3 for the record.** There is no custom `redirect` callback in `src/lib/auth/index.ts`, so Auth.js's default same-origin redirect check already covers the Google path. The live open redirect is the credentials path, `router.push(callbackUrl)` on the raw query value in `signin/page.tsx`. Guarding all three consumers is still right (one rule, one place), and QA should still verify the encoded query survives the Google round trip.
- **Invariants touched: none.** The proxy keeps deriving protection from `ADMIN_NAVIGATION`; changing what the proxy puts in `callbackUrl` does not touch the rule table, the auth-then-feature order, or the "proxy is a coarse outer gate" rule. `register/page.tsx`'s later `router.push("/signin")` (which also drops the callback) belongs to B-155, not here.

### R5. Emails: confirmed, with one reuse suggestion; no durable claim

- The two E-1 notifications (`POST /api/admin/ledger/transactions` ~370-400 and the Transfer/Sweep branch ~690-720) use `sendBulkMemberEmail()` and write **no** `sentAt`, no success row, no append-only "sent" history. This is not a durable-claim path, so the Durable-claim exception to the Phase 2 skip does not apply and `sendEmailForDurableClaim()` is not required. Stated explicitly so Phase 3 does not carry that obligation. (Both stay inside a `try/catch` that must keep swallowing failures; adding the link and the sentence must not be able to throw before `sendBulkMemberEmail` is reached.)
- **Escape `party` and `memo`** with `escapeHtml()` (`src/lib/html-escape.ts`, the single source) in both bodies; `memo` only in the transfer body. Do not escape `amountDollars`, `txnDate` or the enum label (generated by this codebase; escaping would only risk double-encoding). Ships in Increment 1 (R1).
- **Deep link:** `${getAppUrl()}/admin/ledger/approvals?txn=${id}`, always via `getAppUrl()` (absolute fallback, never `?? ""`). The ordinary route already has `txn.id`. The Transfer/Sweep route needs the expense-leg id: the multi-row `tx.insert(...).values([...])` gets `.returning({ id, flow })`, and the response gains an additive `id` field (the expense leg's id) next to the existing `transferGroupId`; nothing else in the 201 body changes. The page resolves either leg of a pair to the pair, so one `txn` parameter is enough and no `transferGroupId` URL parameter is introduced.
- **The sentence** ("Only one board approval is needed. If a colleague has already acted, the link will show who.") ships in Increment 2 with the link, not before.
- **Suggestion S1.** The two bodies are two near-copies of the same notification (amount, date, party/memo, the CTA link, and now the shared sentence). Since both are being edited twice, extract one pure builder into `src/lib/email-compose.ts` (already the home for `buildPasswordResetEmailHtml` and friends, which exists so the sender and tests share one source) and unit-test escaping there. This is the "same decision in two places" rule applied before it becomes three. Optional; if the tech-lead declines, say so in the design.
- **Redactor check.** `redactQueuedEmailHtml()` hides 32+-character hex runs. A hyphenated UUID is broken into 8-4-4-4-12 and should not match, but Phase 3 should add one test that the redactor leaves `?txn=<uuid>` readable in the queue view (a transaction id is not a credential).
- **Dev safety (unchanged).** `sendBulkMemberEmail` is deny-by-default outside production; QA allowlists only the tester's own address.

### R6. Server/client split and components

- **`approvals/page.tsx` stays a Server Component.** It reads `searchParams` (async, `Promise<{ tab?, txn? }>` as the reimbursements page does), runs `auth()` + `hasFeature()` first, then fetches. The history fetch is wrapped so a failure renders the "Could not load recent decisions" card on the decided tab and never blanks Pending (analyst N9). Tabs are `<Link>`s to `?tab=` (precedent: the reimbursements page), no client state.
- **Client islands remain only the two dialogs** (plus the optional `RowHighlighter`). Cards, table, banner, history list and tabs are presentational Server Components. No `'use client'` added to any of them.
- **Dialogs adopt the existing shell.** `src/components/admin/ledger/ledger-dialog-shell.tsx` already provides a `w-[calc(100vw-1.5rem)] max-w-lg`, `max-h-[90vh] overflow-y-auto` rounded-2xl dialog with a 44px close button (built for the Move/Delete dialogs). Move `ApproveDialog` and `RejectTransactionDialog` onto it for the 360px fit rather than re-patching two copies of `Dialog.Content` classes. Drop `autoFocus` on the text field on small viewports (the keyboard covering the context is the reported pain). Leave `RejectReimbursementDialog` alone (different surface) unless trivially shared.
- **Avoid duplicating the row logic between the table and the cards.** Rendering a table at `md+` and cards below is two presentations of one decision (who may Approve/Reject, what the self marker says, how a Transfer/Sweep fund label reads). Extract that once as presentational Server Components in `src/components/admin/ledger/`: an actions block (Approve, Reject, or the "You recorded this" marker, hiding Reject on own rows to match the server's 403) and a fund label (the Sweep/Transfer chip with from-to). Both the table row and the card render them. The resulting `hidden md:block` / `md:hidden` pair puts two Approve triggers in the DOM; the hidden one is `display: none` so it is out of the tab order and the accessibility tree, but e2e selectors and QA must scope to the visible variant.
- **New files (flat in `src/components/admin/ledger/`, matching the existing layout; no new subdirectory):** `approval-actions.tsx`, `approval-fund-label.tsx`, `approval-card.tsx`, `approval-history.tsx`, `approval-banner.tsx` (names are suggestions; Phase 3 owns them).
- **Carrier module (client-safe, no DB import): `src/lib/ledger-approval.ts`** (precedent: `ledger-correction.ts`). Exports the 409 response type the dialogs branch on, the banner-state union, `RECENT_DECISIONS_LIMIT = 25`, the tab whitelist, and the banner copy builder. The dialogs import the 409 type from here so a removed or widened member breaks `tsc`. Required shape (exact names Phase 3's): a machine `code` (the dialogs branch on it, never on the English string), `decision: "approved" | "rejected" | null`, `deciderName: string | null`, `decidedAt: string | null` (ISO). Not exported from `ledger-approval-queries.ts` (which is DB-importing and approver-only).
- **Date formatting.** `approved_at`/`rejected_at` are naive `timestamp` columns written from server `new Date()`. Format with explicit `timeZone: "America/New_York"` (existing precedents: `recent-corrections.tsx`, `ledger-correction.ts`). Do not add a 42nd local `formatDollars` if an exported one fits; a repo-wide consolidation is already known and out of scope.

### R7. Race-safe approve and reject (F), shape

Both routes:
1. Inside `db.transaction`, re-read the target and its partner leg `FOR UPDATE` in **deterministic order (`ORDER BY id`)** so two concurrent pair decisions cannot deadlock (precedent: the move/correct routes lock before they decide).
2. Re-check the self-record rule on the locked row, as today.
3. `UPDATE ... SET status = ..., <stamps>, updated_at = ... WHERE id IN (...) AND status = 'pending' RETURNING id`; if the number of returned rows is not the expected 1 or 2, `throw` a private sentinel error so the transaction **rolls back**. A plain `return` from `db.transaction` commits, and a half-applied pair is the failure to prevent (precedent: `StaleMoveRollback` in `ledger-fund-move-queries.ts`, `ReimbursementConflictError` in the reimbursements route).
4. Catch the sentinel outside the transaction, re-read once, and answer 409 with the carrier-typed body (R6): `code`, `decision`, `deciderName`, `decidedAt`. A row deleted meanwhile is a 404, and the dialogs should close, refresh and say so rather than keep a dead form open.
5. The existing pre-check 409s remain as the fast path and also use the carrier body.

## Placement

- **Directory placement:**
  - `src/app/(dashboard)/admin/ledger/approvals/page.tsx` (modified, stays here; no new route, no new `ADMIN_NAVIGATION` entry).
  - `src/components/admin/ledger/` (flat, existing convention): the five presentational components in R6; the two dialogs modified; `row-highlighter.tsx` extended with opt-in props.
  - `src/lib/ledger-approval.ts` (new, client-safe carrier), `src/lib/ledger-approval-queries.ts` (new, DB, approver-only), `src/lib/safe-callback-path.ts` (new, pure, no imports); `src/lib/email-compose.ts` (S1, optional builder).
  - `src/app/api/admin/ledger/transactions/[id]/approve/route.ts`, `.../reject/route.ts`, `src/app/api/admin/ledger/transactions/route.ts` (modified); `src/proxy.ts`, `src/app/signin/page.tsx`, `src/app/register/page.tsx` (modified, guard consumers).
  - `src/lib/db/schema.ts` + one new idempotent migration (Increment 2).
- **Server vs Client split:** Server Component page and presentational components; client islands only `ApproveDialog`, `RejectTransactionDialog`, and (opt-in) `RowHighlighter`. `ledger-approval.ts` and `safe-callback-path.ts` are client-safe; `ledger-approval-queries.ts` is server-only.
- **Dependencies:** none new. `escapeHtml`, `isUuid`, Radix Dialog, `getAppUrl`, `paidReimbursementExists`, `LedgerDialogShell` and `RowHighlighter` all exist. No Zod or URL-parsing package needed for the guard (the platform `URL` class suffices).

## Invariants Touched

- **Permissions are the only gating mechanism / Admin-Area Protection Is Derived:** respected. Everything stays under `ledger.approve`; no new key, no binding migration, no nav entry, and `src/proxy.ts` rule derivation is untouched (only the `callbackUrl` it writes changes). The page keeps its own `auth()` + `hasFeature(LEDGER_APPROVE)`, which `admin-page-feature-gates.test.ts` enforces. Widening check: no nav entry's permission is broadened.
- **Schema is the source of truth / Migrations re-run on every deploy:** respected by R2 (schema.ts first, `ADD COLUMN IF NOT EXISTS`, guarded FK, drizzle-derived constraint name). Migration number is a placeholder.
- **`approvedAt` lock-marker semantics (Ledger corrections paragraph):** respected and reinforced: rejection gets its own columns; the history never treats the lock stamp as evidence of a board decision; the unconditional `approvedAt` guards on PATCH/DELETE/split are not touched.
- **Durable-claim rule (DECISION-102/103):** not triggered; the E-1 emails are plain bulk notifications with no sent-claim. Stated in R5.
- **Outbound email deny-by-default / bulk through `sendBulkMemberEmail()`:** unchanged.
- **No native dialogs; brand rules:** dialogs stay Radix `Dialog`; cards `rounded-2xl`, buttons `rounded-lg` (Reject on cards becomes a real secondary button, 44px), chips may be `rounded-full`, empty state `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, highlight via `lions-gold` ring not a card border, focus rings on every control.
- **Member-surface firewall (analogous to `ledger-audit` / `ledger-correction`):** the new approver-only query module follows the same discipline and gets the same style of importer-scan test.
- **No Personal Data in the Repository:** no fixtures with real names or addresses; use `example.com` and synthetic names in tests.
- **No CLAUDE.md invariant changes.** One doc follow-up for tech-lead at release: a short note under Key Patterns that any new `callbackUrl` consumer must go through `safeCallbackPath()`, and a line in the Expense Reimbursements/approvals area that the Approvals page now has a decided-history tab keyed on its own markers (DECISION-116).

## Notes

**Tests Phase 3 must name (additions to the analyst's list):**
- `safe-callback-path.test.ts`: accepts `/admin/ledger/approvals?txn=<uuid>`; rejects `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:`, a leading tab/newline, empty/null/overlong; `/%2F%2Fevil` stays a path; fallback is `/members`.
- A source-scan test that no page passes a raw `callbackUrl` search param to `router.push` or `signIn` (the three consumers use the helper).
- History discriminator against a fixture set: reimbursement-stamped (excluded), direct-posted-under-threshold (excluded), under-threshold Sweep with a creation-time minute but no `approved_at` (excluded), approved row whose approver user was deleted (included, name "a board member"), legacy rejected row with null rejector (included, "decider not on file"), Transfer/Sweep pair (one row), 26 decisions (capped at 25, newest first, ties stable), deleted id (`not_found`).
- Race tests for both routes: two concurrent approvals (one 200, one 409 naming the first decider), approve racing reject, and a pair where one leg is already non-pending (nothing half-applied, both legs unchanged).
- The importer-allow-list scan for `ledger-approval-queries.ts` (R3).
- A route test that the Transfer/Sweep 201 body carries `id` (additive) and `transferGroupId` still.

**Implementer split to consider (Phase 3 names the final one):**
- Increment 1: **api-developer** (F on both routes, the `ledger-approval.ts` carrier and its 409 body, N7 escaping, route tests) then **ux-developer** (cards and the shared actions/fund-label components, 44px targets, Reject hidden on own rows, dialogs onto `LedgerDialogShell`, D hint, A2 handling, empty-state copy). Too large for full-stack (> 150 lines across API + UI).
- Increment 2: **database-admin** (columns + migration, in a worktree if another pipeline is mid-Phase-4) then **api-developer** (reject stamp, `ledger-approval-queries.ts`, the transactions route id + email link/sentence, `safe-callback-path.ts` + proxy/signin/register consumers, tests) then **ux-developer** (tabs, history list, banner, `RowHighlighter` extension, failure/empty states).

**Suggestions (optional):**
- S1: single email-body builder in `email-compose.ts` (R5).
- S2: Increment 1 can keep the page's "All expenditures are approved" copy change (Flow 6, "Nothing is waiting for approval" plus a link) out until the History tab exists, since the link would point at nothing; ship the copy change with Increment 2.
- S3: B-156 (memo, fund and recorder inside the Approve dialog) is cheap once the shared fund label exists; Phase 3 may pull it into Increment 1 if it is under ~30 lines, otherwise it stays B-156.

## Proposed DECISION text (draft only; tech-lead files)

**Proposed DECISION-116 (revised from the Phase 1 draft).** *Board-decision history keys on its own markers, never on the lock stamp; the sign-in callback has one guard.*
1. `approved_by_user_id` / `approved_at` are the immutability lock and also carry "reviewed and paid by the treasurer" on reimbursement-derived rows (DECISION-106); they are not, by themselves, evidence of a board approval. The Recently decided view treats a row as a board approval only when `status = 'posted'`, `approved_at` and `board_minute` are set, and `paidReimbursementExists()` is false. The stamp test uses `approved_at`, not `approved_by_user_id`, because the latter is `ON DELETE SET NULL` and a deleted approver must not erase a genuine decision. Derived, never marked: no discriminator column.
2. A rejection is stamped on its own columns (`rejected_by_user_id`, `rejected_at`) on both legs; the approve columns are never reused for a rejection. Approve and reject are not written to `ledger_audit_log` (that log is the corrections vocabulary).
3. The approve and reject routes lock the target and its partner `FOR UPDATE` in id order and pin their UPDATE on `status = 'pending'`, throwing a rollback sentinel on a short row count and answering 409 with a typed body naming the decider, so "who decided" is a single, true statement and a pair cannot half-apply.
4. The decider's name, the board-minute citation and the decision time are visible only to `ledger.approve` holders: the history and deep-link resolver live in `src/lib/ledger-approval-queries.ts`, imported only by the Approvals page (enforced by a source-scan test). The rejection reason is already visible on the register and stays so.
5. Every post-sign-in redirect target (`callbackUrl`) passes through `safeCallbackPath()` (`src/lib/safe-callback-path.ts`, pure, same-origin path only); the proxy preserves `pathname + search`. No consumer reads `callbackUrl` raw.
Release DECISION-116 if the design departs from this.

## Proposed backlog text (reserved IDs only; orchestrator or tech-lead files)

**B-155 (amend the Phase 1 draft).** Add: `/register` also drops the callback after account creation (`router.push("/signin")`), and `reset-password` pushes plain `/signin`; both belong to this item. The prerequisite `safeCallbackPath()` helper ships with the approvals pipeline; this item only needs to thread the value through `/forgot-password`, its API and the reset link (validate server-side with the helper, never log the callback with the token).

**B-156 (amend the Phase 1 draft).** Note: Increment 1 already moves the dialogs onto `LedgerDialogShell` and extracts a shared fund label, so this item reduces to rendering memo, fund (with from-to) and recorder in the dialog description and linking the receipt. Fold into Increment 1 if under ~30 lines.

**B-157 (use it; the Phase 1 condition for releasing it, declining the rejection columns, did not occur).** *Approve and reject leave no audit row.* The decision columns hold only the latest state: a lost race (now a 409), a later Delete of an approved row, or a corrected minute leaves no record that a decision happened. Consider a decision row in `ledger_audit_log` (new action types, an `id`/pair snapshot, no free text beyond the existing minute/reason) once the compliance reader can show them (see B-132, which tracks that the log has no general reader). Low priority; deliberately not in the approvals pipeline. Origin: `docs/work-log/2026-10-10-approvals-mobile-and-history.md`.

---

## Phase 2 — Architectural Review — 2026-10-10

**Owner:** architect
**Status:** complete

### Summary
Verdict **Approved with suggestions**. One pipeline with two Phase 4 deliveries; Increment 1 (A, D, A2, F, N7, no schema) can ship first and F belongs in it because the dialogs' 409 handling consumes its body and the race has live exposure; Increment 2 (columns, History tab, deep link, `safeCallbackPath()`, email link and sentence) follows. Four of the analyst's recommendations are sharpened: the history discriminator keys on `approved_at` (the `approved_by_user_id` form drops decisions by a later-deleted approver), the history query gets its own approver-only module rather than joining the 3.9k-line `ledger-queries.ts`, the deep-link highlight reuses `RowHighlighter` instead of a new island, and the Google path was already same-origin-guarded so the live open redirect is the credentials `router.push`.

### What I did
- Read the whole work-log (Origin, Phase 1, production facts) and the approvals page, both dialogs, both routes, both E-1 email blocks, `getPendingApprovals`, `ledger-reimbursement-link.ts`, `reimbursementTransactionStamp`, `proxy.ts`, signin and register callback handling, the `ledgerTransactions` schema, the 0109 migration idiom, `html-escape.ts`, `email-compose.ts`, `ledger-dialog-shell.tsx`, `row-highlighter.tsx`, and the move/reimbursement rollback-sentinel precedents.
- Confirmed rejected rows are immutable, the register already exposes `rejectionReason` to `ledger.view`, and no custom Auth.js `redirect` callback exists.

### Outputs
- This work-log (Phase 2 section, Per-Phase Status row). No code, no edits to `docs/decisions.md` or `docs/backlog.md`, no email, no database access.
- Proposed (not filed) DECISION-116 revision and B-155/B-156/B-157 text above. No new architectural decision filed by me (Concurrent Pipelines rule 4: architects draft, tech-lead files).

### Open questions / handoff notes
- Tech-lead: confirm the Increment 1 / Increment 2 split and that N5's sentence waits for Increment 2; decide S1 (email builder) and S3 (pull B-156 into Increment 1 if tiny).
- Migration number is a placeholder (`0111` is a guess); database-admin re-derives it at Phase 4 start. Use a worktree + own Neon branch for Increment 2 if another pipeline is in Phase 4/5.
- QA: scope selectors to the visible variant (table vs cards both mount); test 360px and 390px; two sessions approving at once; stale link signed out and signed in with both Google and password sign-in; verify `?txn=` survives the Google round trip; dev email only to the tester's own allowlisted address.

---

# Phase 2 addendum — multiple approvers (Increment 2) — 2026-10-10

Owner: architect. Read-only review of the tree (Increment 1 is in Phase 5; nothing under `src/` touched). Inputs: the whole work-log, `src/lib/ledger-approval-decision.ts`, `src/lib/ledger-approval.ts`, the `ledgerTransactions` schema, the Delete route's `approvedAt` guards, `proxy.ts`. Rulings continue the numbering of Phase 2 (R1 to R7); R8 to R15 answer the orchestrator's eight questions in order. Binding on the Phase 3 addendum.

## Verdict

**Approved with suggestions.** The analyst's shape A (posting approval stays on `approved_*`, co-signs in their own append-only table, sibling INSERT path, no minute, no withdrawal, no quorum) is right and I adopt it. I change five things: the table is named `ledger_txn_cosigns`, not `ledger_transaction_cosigns` (the derived foreign-key name would be 67 characters and Postgres truncates at 63, R8); a `kind` column is refused (R8); `boardDecisionPredicate` moves out of the approver-only queries module into a neutral module, because the co-sign path must import it and the queries module is importer-restricted to the page (R9, corrects Phase 3); the pair lock becomes a shared helper taking `FOR SHARE` for co-sign (R10); and Increment 2 splits into 2a and 2b (R15). No new dependency, no new `FEATURES` key, no nav or proxy change, no CLAUDE.md invariant change.

## Rulings

### R8. Table shape, name, key, unique constraint (question 1)

```ts
// src/lib/db/schema.ts, directly after ledgerTransactions (schema.ts first, then the migration)
export const ledgerTxnCosigns = pgTable(
  "ledger_txn_cosigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The EXPENSE leg of the entry (one row covers a Transfer/Sweep pair).
    txnId: uuid("txn_id").notNull()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    // SET NULL, never cascade: a deleted account must not erase the endorsement.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Naive timestamp written from server `new Date()`, same convention as approved_at.
    cosignedAt: timestamp("cosigned_at").notNull().defaultNow(),
  },
  (t) => [unique("ledger_txn_cosigns_txn_user_key").on(t.txnId, t.userId)],
);
export type LedgerTxnCosign = typeof ledgerTxnCosigns.$inferSelect;
```

- **Name: `ledger_txn_cosigns`, column `txn_id`.** The analyst's `ledger_transaction_cosigns` with `transaction_id` derives the FK name `ledger_transaction_cosigns_transaction_id_ledger_transactions_id_fk`, 67 characters. Postgres silently truncates identifiers to 63, so the live constraint name would never equal the name drizzle-kit derives and `drizzle-kit push --force` would see permanent drift on every deploy (the exact thing 0109 and the Phase 2 R2 note take care to avoid). `ledger_txn_cosigns_txn_id_ledger_transactions_id_fk` is 51; `..._user_id_users_id_fk` is 38; the unique name is 31. "txn" is already the repo's abbreviation (`ix_ledger_txns_status`, `donation_txn_id`, `ux_ledger_acks_txn`). The name still says "cosign" and cannot be mistaken for `ledger_budget_approvals`. If Phase 3 prefers the longer name it must name the FK explicitly with `foreignKey({ name })` in schema.ts **and** the SQL; the default is the short name.
- **Keyed on the expense leg, not `transfer_group_id`.** `transfer_group_id` has no referent table (schema.ts calls it a "self-join key", no FK), so a row keyed on it could not cascade, could not be a real FK, and could dangle. The expense leg is the leg the page already displays, the leg `getRecentDecisions()` keys its rows on (Phase 3), and the leg `?txn=` resolves to. **Trap the analyst did not name:** the route accepts either leg's id in the URL. If `cosignTransaction()` inserted the id it was given, the same person could co-sign once via the income leg and once via the expense leg, and the unique constraint would not stop it. So the function **must normalise to the pair's expense leg inside the lock before inserting** (a non-pair expense row is its own key; a lone income row is `not_board_decision` because the predicate requires `flow = 'expense'`). A database CHECK cannot express "points at an expense leg" (it would need a cross-row lookup), so this is an application invariant, pinned by a test (below). The read side queries expense-leg ids only.
- **Unique `(txn_id, user_id)`.** Chosen as a named `unique(...)` to match `ledger_budget_approvals_entity_year_key` and `ledger_budget_lines_budget_cause_label_key`. It also serves as the lookup index for the History second query (`WHERE txn_id IN (...)` uses the leading column), so **no other index**. Postgres treats NULLs as distinct, so two deleted-account co-signers on one entry both survive, which is what we want; the constraint only needs to bite for live users. The posting approver is deliberately **not** covered by the constraint (shape A); `cosignTransaction()` compares against `approved_by_user_id` (R10).
- **No minute column.** Agreed with the analyst: the motion is already on the entry, shown read-only in the dialog; a column would put free text on a one-tap action and allow two citations for one record. If the board ever wants a ratification minute it is an additive nullable column plus its own Phase 1.
- **No `kind` ("posting" | "cosign") column: refused as speculative generality.** The argument for it is quorum readiness, and it does not deliver it. Adding `kind` means copying the posting approval in (a dual write inside `decideTransaction()` plus a backfill of production's one board-approved row that must exclude the two reimbursement-stamped rows) and creates two sources of truth for the poster that can drift. And a real quorum needs rows against **pending** entries and a different gate, which this table's refusal semantics (`not_approved`) deliberately forbid; the table would be reshaped anyway. If a quorum is ever requested, it gets its own Phase 1, and the migration then is written against the real requirement. Single-valued meaning ("an endorsement after posting") is worth more than a column with one value.
- **Also not added:** `updated_at`, `deleted_at` or any withdrawal marker (soft withdrawal is Q5, declined); a denormalised amount, fund or entity (approved rows are immutable and cannot move, so there is nothing to go stale, and nothing to leak); a `ledger_audit_log` row on co-sign (approval is not a correction; same reasoning as R2 and B-157).
- Cascade chain, for the record: entity or fund delete cascades to the transaction (existing), which cascades to its co-signs. A late POST after such a delete gets 404.

### R9. `boardDecisionPredicate`: one home, three consumers (question 2)

**It moves out of `ledger-approval-queries.ts`.** Phase 3 exported the predicate from the queries module and fixed an importer allow-list that lets only `approvals/page.tsx` import that module. The co-sign path must use the same predicate, and a route helper importing the approver-only queries module would break the very rule that module's header states. The predicate carries no approver data (it tests `board_minute IS NOT NULL`, it never returns the minute, a name or a time), so it does not need the restriction.

- **Home: `src/lib/ledger-board-decision.ts` (new, flat in `src/lib/`).** Server-side (imports `drizzle-orm` `sql`, the `ledgerTransactions` schema and `paidReimbursementExists` from `ledger-reimbursement-link.ts`), no `db` import, **not** importer-restricted. It exports the one definition from Phase 3 unchanged (`flow = 'expense' AND (status = 'rejected' OR (status = 'posted' AND approved_at IS NOT NULL AND board_minute IS NOT NULL AND NOT paidReimbursementExists(id)))`) as a function of the table. The co-sign path needs the *approved* half (it handles `pending` and `rejected` as separate typed codes first), so export two named fragments from the same file, `boardApprovalPredicate` (the posted half) and `boardDecisionPredicate` (approved OR rejected), the latter composed from the former. Still one definition of "approved board decision".
- **Three consumers, two files:** `getRecentDecisions()` and `resolveApprovalTarget()` in `ledger-approval-queries.ts` (Phase 3 already makes the resolver select the predicate as a boolean), and `cosignTransaction()` in `ledger-cosign.ts` (evaluates `boardApprovalPredicate` as a selected boolean on the locked expense row inside its transaction, never re-implemented in JS).
- **Move in 2a, not 2b.** The predicate is born in the right file in Increment 2a, so 2b does not relocate it. The Phase 3 `PgDialect` shape test for the predicate moves with it to `ledger-board-decision.test.ts`.
- **Enforced by a source scan** (Duplication rule: an allow-list, not a convention): outside `ledger-board-decision.ts` and its test, `paidReimbursementExists(` must not appear in `ledger-cosign.ts` or `ledger-approval-queries.ts` (it is called from `ledger-board-decision.ts` and the pre-existing reimbursement code only); both of those files must contain `boardApprovalPredicate(` or `boardDecisionPredicate(`. A fourth hand-written copy of the stamp test is then a failing test, not a review comment.

### R10. `cosignTransaction()`: own file, shared lock helper, lock mode, races (question 3)

- **Own file: `src/lib/ledger-cosign.ts`** (server-only, imports `db`), not a sibling export in `ledger-approval-decision.ts`. Reasons: the two functions have opposite preconditions (decide requires `pending`; co-sign requires posted-with-board-decision) and different result vocabularies; the decision module is already ~280 lines and 2a edits it again for the reject stamp; a dedicated file lets the table-identifier scan (R12) name one writer; and 2b can be dropped cleanly (delete the file, the route, one test) if the user answers Q1 "quorum".
- **Extract, do not copy: `lockDecisionPair(tx, id, mode)` in `ledger-board-decision.ts`.** It is the single-statement `WHERE id = $id OR transfer_group_id = (select transfer_group_id ... where id = $id) ORDER BY id` lock (the subtle NULL-subselect shape from Phase 3 ruling 4), parameterised on `"update" | "share"`. `decideTransaction()` is refactored to call it with `"update"` in 2b (its existing tests, which assert `.for("update")` and the `ORDER BY`, keep passing). That is two callers of a subtle statement, extracted at the moment the second caller appears, ~15 lines moved. The either-leg recorder rule is one `.some()` and is expressed once for co-sign, in the pure `cosignEligibility()` that takes the **list** of recorder ids (R11); the server passes the locked rows' recorder ids, the page passes the ids it computed server-side (see R12).
- **Locking: yes, take the lock, but `FOR SHARE`, not `FOR UPDATE`.** The analyst is right that nothing in the app can change an approved row today: Delete 403s on `approvedAt` (single row at line ~823 and either leg of a pair at ~847), PATCH/split/waive 403 on `approvedAt`, and `moveBlockKind()` refuses approved rows and Transfer/Sweep legs. Postgres also takes an implicit `FOR KEY SHARE` on the referenced row for the FK check, which already serialises the INSERT against a concurrent hard DELETE. I still lock, because the preconditions are read-then-act (state, board decision, recorders) and "the row cannot change under me" is better true by construction than by a chain of other routes' guards (DECISION-099's lesson is that those guards must never be carved, and a future audited un-approve or correction path, B-159, is exactly what would otherwise reopen this). `FOR SHARE` is the precise mode: it blocks any writer to the pair (so it conflicts with `decideTransaction()`'s `FOR UPDATE`, which is correct) but **does not serialise co-signers against each other**, so thirteen people tapping at once do not queue. Both take the pair in `ORDER BY id`, the same order as decide, so there is no deadlock. If the test harness cannot mock `.for("share")`, `"update"` is an acceptable fallback; log it as a deviation.
- **Procedure** (Phase 3 fixes the exact result type; the order is binding):
  1. Malformed id: 404 without touching the database (`isUuid()`).
  2. `db.transaction`: `lockDecisionPair(tx, id, "share")`. No rows, or the requested id absent: 404. Resolve the **expense leg** (pair: the `flow = 'expense'` row; non-pair: the row itself). No expense row: `not_board_decision`.
  3. State order: `pending` -> 409 `not_approved`; `rejected` -> 409 `rejected` (carries decider name and time if on file); then evaluate `boardApprovalPredicate` on the expense row id in SQL -> false -> 409 `not_board_decision` (covers reimbursement-stamped, under-threshold Sweep, any posted-without-`approved_at` row).
  4. Eligibility through the shared pure `cosignEligibility()`: actor recorded **either** leg -> 403 `recorded_by_you`; actor equals `approved_by_user_id` -> 409 `already_approved` (needs its own test, because the unique constraint does not cover the poster); a NULL `approved_by_user_id` (deleted approver) never equals the actor.
  5. `INSERT INTO ledger_txn_cosigns (txn_id, user_id, cosigned_at) VALUES (expenseId, actor, now) ON CONFLICT (txn_id, user_id) DO NOTHING RETURNING id, cosigned_at`. Zero rows -> 409 `already_cosigned`, with that user's existing `cosigned_at` re-read in the same transaction for the toast date. No `ledger_audit_log` write.
  6. No rollback sentinel is needed (a single idempotent INSERT; nothing half-applies), and no `UPDATE` of `ledger_transactions` anywhere in the file.
- **Race between two co-signers.** Different users: both INSERTs proceed under shared locks and both succeed (201 / 201); there is no winner and display order is `cosigned_at ASC, id ASC`. Same user (double tap, two devices): the unique constraint admits one; the other returns zero rows -> 409 `already_cosigned`, which the UI treats as success-shaped (closes, info toast with the date). Co-sign racing Approve or Reject cannot occur by state (approve/reject need `pending`, co-sign needs posted); the lock conflict would serialise them anyway. Co-sign racing Delete: Delete refuses approved rows; for a pending row there is nothing to co-sign. A row deleted before the lock gives 404.
- **Allowed on reconciled, prior-year and closed-month rows.** A co-sign is informational and changes no figure, so it carries no reconciliation or fiscal-year guard. Adding one would quietly make co-sign "a thing that touches the books", the exact "a flag means two things" shape this pipeline exists to avoid. State this in the DECISION.

### R11. Route shape (question 4)

`POST /api/admin/ledger/transactions/[id]/cosign`, folder `src/app/api/admin/ledger/transactions/[id]/cosign/route.ts`. Approved as the analyst specified, with these specifics:

- `auth()` then `hasFeature(session.user.features, FEATURES.LEDGER_APPROVE)` are the first two statements (401 / 403, same wording as approve and reject). **No body is read or parsed**; any body is ignored. Everything the helper needs is the session user id and the path id, so there is no input-validation surface and nothing a client can forge.
- **Responses:** `201 { id, cosignedAt }` (`id` = the expense leg's id, `cosignedAt` ISO); `403 { error, code: "recorded_by_you" }` for self (the permission 403 above has no `code`, so the UI can tell them apart); `404 { error, code: "not_found" }`; `409 { error, code, at, deciderName }` with `code` one of `not_approved | rejected | not_board_decision | already_approved | already_cosigned` (`at`: ISO or null; `deciderName`: via `displayDeciderName()`, never an email, only meaningful for `rejected`). The union and a type guard live in the client-safe carrier `ledger-approval.ts` next to `ApprovalConflictBody`, so the dialog imports the type and a removed code breaks `tsc`. The UI branches on `code`, never on the English string.
- **Carrier additions (`ledger-approval.ts`, 2b):** `cosignEligibility({ viewerId, recorderIds, approvedByUserId, cosignerUserIds })` returning `{ ok: true } | { ok: false, reason }`; `CosignConflictBody` and `isCosignConflict`; the banner-builder extension. `cosignEligibility` is the one rule shared by the route and the page. It takes recorder ids as a list so the server passes both legs and the page passes what the queries module computed.
- Not a durable-claim path (no email, no `sentAt`, no success row); no rate limit needed beyond the session (authenticated approver, idempotent). `/api/*` is excluded from the proxy's page gating (`proxy.ts` line 16), so the handler's own gate is the gate, as for approve and reject; no existing source-scan gate test needs a new entry, but if Phase 3 finds an API-route gate scan it applies unchanged.

### R12. Admin-area derivation and signer-name visibility (question 5)

**Confirmed: no nav change, no proxy change, no `FEATURES` key, no role-binding migration.** The page is the same page under the same required feature, so `getAdminProtectionRules()` output is unchanged (DECISION-082) and `admin-page-feature-gates.test.ts` still applies to the page as is. No nav entry's permission is widened.

**`ledger.view` never sees signer names; the surfaces, confirmed against the tree:** the only transaction-approver display in the repo today is on the Approvals page (the register, search, overview, reports and 990 never select `approved_by_user_id` for display, per the analyst's grep; `budget-approval-panel.tsx` belongs to a different table). The new table is a **separate table**, not columns on `ledger_transactions`, so none of the many full-row `select().from(ledgerTransactions)` results that reach client props can carry a signer id (contrast Phase 2 R2's `rejectedByUserId` note). The remaining leak path is somebody importing the schema export, so the scan is on the identifier, not the module:

- **Source scan (precedent: the member-surface firewall in `ledger-audit.test.ts`):** the identifier `ledgerTxnCosigns` and the SQL name `ledger_txn_cosigns` may appear only in `src/lib/db/schema.ts`, `src/lib/ledger-cosign.ts`, `src/lib/ledger-approval-queries.ts`, the migration, `e2e/**` seed helpers, and `*.test.ts`. Never under `src/app/members/**` or `src/app/api/members/**`, never in `ledger-queries.ts`, the overview, register, search or report code.
- `ledger-cosign.ts` is imported only by the cosign route (and its tests). `ledger-approval-queries.ts` stays imported only by `approvals/page.tsx`; `ledger-cosign.ts` must not import it.
- The queries module computes `canCosign` and `viewerHasCosigned` **server-side** (it already has both legs' recorder ids from the `dest` self-join, plus the cosigner ids) and passes booleans and display names to the components; the page never ships recorder user ids to the client for this purpose.
- **Second-query rule (binding, from the analyst):** the History `LIMIT 25` statement must not join the co-sign table. Co-signs for the returned expense-leg ids come from a second statement: `SELECT c.txn_id, c.cosigned_at, c.user_id, u.name FROM ledger_txn_cosigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.txn_id IN (...) ORDER BY c.cosigned_at, c.id`. Skip it when the id list is empty. `resolveApprovalTarget()` does the same for its one row. If this second query fails, `getRecentDecisions()` throws and the decided tab shows the existing "Could not load recent decisions" card; never render an approved card with a signer list that is silently incomplete (an incomplete list reads as the whole list). Unnamed (deleted-account) co-signers collapse to "N other board members".

### R13. Migrations (question 6)

`schema.ts` first, then SQL, idiom as 0109 and 0063/0064. **Two** migrations, not one combined file, because of R15: 2a carries the reject columns exactly as Phase 3 specified; 2b carries the table:

```sql
-- Migration NNNN: ledger_txn_cosigns (DECISION-117). Informational, append-only co-approvals.
-- Idempotent: safe to replay on every deploy.
CREATE TABLE IF NOT EXISTS ledger_txn_cosigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL,
  user_id uuid,
  cosigned_at timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_txn_cosigns_txn_id_ledger_transactions_id_fk'
                   AND conrelid = 'ledger_txn_cosigns'::regclass) THEN
    ALTER TABLE ledger_txn_cosigns ADD CONSTRAINT ledger_txn_cosigns_txn_id_ledger_transactions_id_fk
      FOREIGN KEY (txn_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE;
  END IF;
  -- same guarded shape for ..._user_id_users_id_fk (ON DELETE SET NULL)
  -- and for the UNIQUE constraint ledger_txn_cosigns_txn_user_key (txn_id, user_id), guarded via pg_constraint
END $$;
```

The unique key is added as a **constraint** (`ADD CONSTRAINT ... UNIQUE`, guarded via `pg_constraint`, the 0063 style) rather than `CREATE UNIQUE INDEX IF NOT EXISTS`, so drizzle's `unique(...)` finds a constraint of that name and push does not try to "fix" it. Constraint names are exactly the drizzle-derived ones (R8). `ON CONFLICT DO NOTHING` seeds do not apply (no seed data, no backfill, no role binding). Verify the first replay and the second replay both succeed (`pnpm db:migrate` twice) and that `drizzle-kit push` reports no diff.

**The numbers are placeholders.** `0110_treasurer_permission_baseline.sql` is newest today, so `0111` (2a) and `0112` (2b) are only guesses; a parallel increment may claim them. database-admin re-derives each at the start of its schema step (`ls drizzle/migrations/*.sql | sort | tail -3`), and the file is not added to the shared tree until that step is complete (Concurrent Pipelines rule 2). Each migration is a schema change: the orchestrator announces the dev-server restart; if the closing-balance pipeline is in Phase 4/5 at the time, the implementers and qa run in an `isolation: "worktree"` with its own Neon branch and `.env.local` copy (rule 5). `schema.ts` is the shared hot file.

### R14. Invariants (question 7)

None violated; each named invariant checked:

- **Durable-claim (DECISION-102/103): not triggered.** Co-sign sends no email, writes no `sentAt`, no partial-unique success row, no "this was sent" history. The co-sign row records an endorsement, not a delivery. The only email change is a sentence in the existing pending-approval builder, which is a plain bulk notification via `sendBulkMemberEmail()` (unchanged; deny-by-default unchanged). Stated so Phase 3 does not carry that obligation.
- **`approvedAt` lock marker: untouched.** `cosignTransaction()` never writes `ledger_transactions` (a source-scan test asserts no `update(ledgerTransactions` or `delete(ledgerTransactions` in the file). The unconditional `approvedAt` guards on PATCH / DELETE / split / waive are not carved. **Corollary the DECISION must state:** no code path may read the existence or count of co-sign rows as authorization, and the table identifier scan (R12) is what makes that checkable.
- **Two-fund firewall / move policy / reconciliation: untouched.** No fund, entity or bank-account write; co-sign is allowed on reconciled and closed-month rows precisely because it affects no figure (R10).
- **Permissions are the only gating mechanism / Admin-Area Protection Is Derived:** respected (R12).
- **Schema is the source of truth / migrations re-run every deploy:** respected (R13).
- **Outbound email deny-by-default / no personal data in the repo:** untouched; fixtures use synthetic names and `example.com`.
- **Brand / no native dialogs:** the Add-your-approval dialog is a Radix `Dialog` on `LedgerDialogShell`; secondary `rounded-lg` 44px button; not destructive.
- **Accepted residual, to be recorded in the DECISION:** uniqueness is per account, not per person (the roster supports two household members sharing an email with distinct logins). Acceptable because a co-sign carries no control weight; it must be revisited before any quorum.

### R15. Split Increment 2 into 2a and 2b (question 8)

**Decision: split. Same pipeline and work-log, two ordered Phase 4 deliveries, two Phase 5 PASSes, one closing Phase 6.** The analyst's single-delivery recommendation rested on two constraints, and neither holds:

1. *"One migration, one dev-server restart."* Real but small: two idempotent migrations cost one more announced restart and one more schema step. Against that, **Q1 is still unconfirmed** ("others add their name after it posts" versus "two approvals before it posts"). If the answer is quorum, the co-sign slice stops and Phase 1 reopens; with a single delivery that outcome would hold the user's five original asks (reject attribution, History tab, deep link, safe callback, email link) hostage to a governance conversation. Split, and 2a is unblocked regardless.
2. *"The email sentence must ship in the same delivery as the co-sign UI."* That was true of the analyst's replacement sentence, which promises co-sign. It is not true of Phase 3's sentence ("Only one board approval is needed. If a colleague has already acted, the link will show who."), which is accurate for exactly the feature set 2a ships. 2b then changes one sentence in the builder plus its test, and the Increment 1 string and branch (C3) in the same delivery as the feature that makes them stale.

**2a (as Phase 3 designed it, with R9's relocation):** reject columns + migration; stamp in `decideTransaction()`; `ledger-board-decision.ts` (the predicate, born here); `ledger-approval-queries.ts` (History, resolver); tabs, banner (Phase 3's table of states, including "nothing more to do"), `RowHighlighter` `persistent`; `safe-callback-path.ts` and its three consumers; Transfer/Sweep `id` in the 201; email deep link and the Phase 3 sentence.

**2b (additive on 2a; starts only after the user's Q1 answer is recorded in the work-log):** `ledger_txn_cosigns` + migration; `lockDecisionPair()` extraction and the `decideTransaction()` refactor to call it; `ledger-cosign.ts`; the cosign route; carrier additions (`cosignEligibility`, `CosignConflictBody`, banner-builder extension); queries-module second query and the `cosigners` / `canCosign` / `viewerHasCosigned` fields on `DecidedApprovalRow` and the `decided/approved` target state; the Add-your-approval dialog and button; the "Also approved by" line; banner states replacing the Phase 3 rows "approved by someone else" and "approved by viewer"; the Inc 1 string (`describeApprovalConflict`, drop "Only one approval is needed.", add "You can add your approval too.") and the `approvalFailureAction` branch (approve-race loss on `approved` by someone else closes, then `router.replace` to `?txn=<id>`); the email sentence replacement; the Recently decided help line.

**Types in 2a must be extensible, not dead:** 2a ships `DecidedApprovalRow` and the `decided` target state without co-sign fields; 2b adds them as required fields. Do not add `cosigners: []` placeholders in 2a (dead code and a lie about what the page can do).

**Implementer sequence.**
- 2a: database-admin (reject columns, migration; worktree if concurrent) -> api-developer -> ux-developer -> qa (full Phase 5) -> analyst short confirmation (not the pipeline-closing Phase 6).
- 2b: **gate: Q1 answer recorded** -> database-admin (table, constraints, migration; worktree if concurrent) -> api-developer (predicate module gains the lock helper; decide refactor; `ledger-cosign.ts`; route; carrier; queries second query; email sentence; tests) -> ux-developer (dialog, button, banner states, history line, help line) -> qa (full Phase 5, including the concurrency checks below) -> analyst Phase 6 SHIP IT closes the pipeline.
- If the user answers Q1 "quorum": 2b is abandoned, 2a's Phase 6 closes the pipeline, and a new Phase 1 opens for the quorum.
- Not `full-stack-developer` for either.

## Changes to Phase 3 (the Phase 3 addendum must carry these)

1. `boardDecisionPredicate` is exported from `src/lib/ledger-board-decision.ts`, not `ledger-approval-queries.ts` (R9). The importer allow-list for the queries module is otherwise unchanged (page only).
2. Increment 2 becomes 2a and 2b (R15); the Phase 3 "Increment 2" implementation order and test list are re-cut accordingly.
3. 2b replaces the Phase 3 banner rows "approved by someone else" and "approved by viewer" with the analyst's co-sign rows, and changes the Increment 1 string and `approvalFailureAction` branch (C3).
4. `DecidedApprovalRow` and the `decided/approved` target state gain, in 2b only, `cosigners` (name or null, `cosignedAt`), `canCosign` and `viewerHasCosigned` (computed server-side; no recorder ids to the client).
5. The Phase 3 sentence ships in 2a; 2b replaces it.

## Placement

- `src/lib/db/schema.ts` (2b: `ledgerTxnCosigns`); `drizzle/migrations/NNNN_*.sql` x2 (placeholders).
- `src/lib/ledger-board-decision.ts` (+ `.test.ts`): new, flat; predicate (2a), `lockDecisionPair()` (2b). Server-side, no `db` import for the predicate; the lock helper takes `tx`/`db` as an argument. Not importer-restricted.
- `src/lib/ledger-cosign.ts` (+ `.test.ts`): new, server-only (`db`), importer-restricted to the cosign route.
- `src/lib/ledger-approval.ts`: extended (client-safe; no `db`).
- `src/lib/ledger-approval-queries.ts`: extended (second query, new fields); still page-only.
- `src/lib/ledger-approval-decision.ts`: refactored to call `lockDecisionPair()` (2b).
- `src/app/api/admin/ledger/transactions/[id]/cosign/route.ts` (+ `route.test.ts`): new.
- `src/components/admin/ledger/`: `cosign-dialog.tsx` (client island on `LedgerDialogShell`; owns its trigger like Approve and Reject), banner and history card extended; all other components remain Server Components. No new subdirectory. No new dependency.

## Tests Phase 3 must name (additions)

`ledger-cosign.test.ts` (mocked `db`): 201 on an ordinary approved expense; co-sign via the **income-leg** id inserts the **expense-leg** id; the same user via income leg then expense leg gets `already_cosigned` on the second (zero rows returned); recorder of only the income leg gets 403 `recorded_by_you` and no INSERT; the posting approver gets `already_approved` and no INSERT; posting approver account deleted (`approved_by_user_id` NULL, `approved_at` set) is still co-signable and a different actor is not blocked; pending -> `not_approved`; rejected -> `rejected` with name or null; reimbursement-stamped, under-threshold Sweep (minute, no `approved_at`) and a lone income row -> `not_board_decision`; unknown id 404; malformed id 404 with the database never called; the lock is taken with `.for("share")` and an `ORDER BY id`; two different users both succeed; the INSERT carries `ON CONFLICT DO NOTHING` on `(txn_id, user_id)`; **source scans:** no write to `ledgerTransactions` in the file, `boardApprovalPredicate(` present, `paidReimbursementExists(` absent.
`cosign/route.test.ts`: 401; 403 without `ledger.approve` (no `code`); a request body is ignored; each result maps to 201/403/404/409 with the body passed through; `recorded_by_you` is distinguishable from the permission 403.
`ledger-approval.test.ts`: `cosignEligibility` table (recorder either leg, poster, already signed, eligible, null poster); `isCosignConflict`; banner rows for the new states; no output contains "@" or a fraction of the board ("of 14", "votes").
`ledger-board-decision.test.ts`: the Phase 3 predicate shape test (moved), plus the approved-half fragment; `lockDecisionPair` orders by id and honours both modes.
`ledger-approval-queries.test.ts`: the History `LIMIT` statement does not reference the co-sign table; the second statement uses `IN`, orders `cosigned_at, id`, is skipped for an empty id list; a failing second query makes `getRecentDecisions()` throw; deleted-account co-signers collapse to "N other board members"; `canCosign` is false for a recorder of either leg, the poster and an existing co-signer.
Importer scans: the table identifier allow-list (R12); `ledger-cosign.ts` imported only by the route; `ledger-approval-queries.ts` still page-only and not imported by `ledger-cosign.ts`.
`ledger-approval-decision.test.ts`: existing assertions unchanged after the `lockDecisionPair` refactor.
E2E (qa, 2b, real Postgres, serial): two sessions co-sign the same entry concurrently, `n/n` runs of two 201 and two rows; one user double-POST, `n/n` runs of one 201 and one 409 and exactly one row; co-sign a Sweep through each leg id, one row total; a DELETE of a co-signed approved entry still 403s (pins the lock dependency); the co-sign list is absent from every `ledger.view` surface and the `ledger.view`-only user gets 403 from the route.

## Proposed DECISION/backlog text (drafts only; tech-lead files)

**Reserved IDs usage:** DECISION-117 used. B-159 used. B-160 held (conditional on Q8: file only if the user says a posted approval needs a way to record dissent; otherwise release at ship). **B-161 released** (no further follow-up warranted from this review).

**Proposed DECISION-117.** *A second approval is an informational co-signature, never a control.* (1) The approval that posts a disbursement stays on `ledger_transactions.approved_*` / `board_minute`; it remains the immutability lock and the only approval that changes money state (DECISION-116 item 1). (2) Later `ledger.approve` holders may add a co-signature, stored append-only in `ledger_txn_cosigns`: keyed on the **expense leg** (one row covers a Transfer/Sweep pair; the writer normalises either leg's id to it), unique per `(txn_id, user_id)`, `user_id` `ON DELETE SET NULL`, no minute, no withdrawal, no `kind` column (the poster is not copied in: one source of truth per fact; a quorum, if ever asked for, is a new Phase 1, not a column). (3) A co-signature has **no effect** on the books, the lock, reconciliation, reports, the 990, or any gate, and is allowed on reconciled and closed-month rows for that reason; no code path may read the presence or count of co-signatures as authorization (enforced by an identifier importer scan and a no-write-to-`ledger_transactions` scan). (4) Allowed only on an approved board decision under the single `boardApprovalPredicate`/`boardDecisionPredicate` in `src/lib/ledger-board-decision.ts` (shared by the history query, the `?txn=` resolver and the co-sign path, so they cannot disagree); never by the recorder of either leg, the posting approver, or someone who already co-signed. (5) The writer takes the pair lock `FOR SHARE` in id order (a shared `lockDecisionPair()`), so decide, co-sign and the other pair writers cannot interleave, while co-signers do not serialise each other. (6) Co-signer names are approver-only, read only by `ledger-cosign.ts` and `ledger-approval-queries.ts`; the table name is at most 22 characters so its derived foreign-key names stay under Postgres's 63-character limit (drizzle-kit push would otherwise report permanent drift). (7) Accepted residual: uniqueness is per account, not per person. (8) Not a quorum; no email on co-sign; no Pending-count, badge or queue. Amends nothing in DECISION-116 but depends on its items 1 and 4.

**Proposed B-159 (Later).** *Audited removal of a wrongly added co-signature.* Co-signatures are append-only with no in-app removal. If a mistaken or unauthorized one ever needs to come off, add a `ledger.manage`-gated removal that requires a reason and writes a `ledger_audit_log` row (never hand SQL, Workflow Rule 10). Build only on demand. Origin: this work-log.

**Proposed B-160 (conditional; file only if the user answers Q8 "no, we need to record dissent").** *Record dissent on a posted approval.* A board member who disagrees with a posted approval has no in-app way to say so; consider an append-only objection record shown alongside "Also approved by". Needs its own Phase 1 (what an objection does, who sees it). Otherwise release.

**B-161: released, unused.**

## Phase 2 addendum — Architectural Review (multiple approvers) — 2026-10-10

**Owner:** architect
**Status:** complete

### Summary
Verdict **Approved with suggestions**. Adopt shape A: a new append-only table keyed on the expense leg, unique per user, `user_id` `ON DELETE SET NULL`, no minute, no `kind` column (refused as speculative), the posting approval left on `approved_*`. Five changes to the proposal: the table is `ledger_txn_cosigns` (the longer name's derived FK name is 67 characters and Postgres truncates at 63, which would cause permanent drizzle-kit drift); `boardDecisionPredicate` moves to a neutral `src/lib/ledger-board-decision.ts` so the co-sign path can share it without breaking the page-only importer rule on the queries module; `cosignTransaction()` is its own file taking a shared pair lock `FOR SHARE`; the writer must normalise either leg's id to the expense leg (otherwise one person could sign twice); Increment 2 splits into 2a and 2b.

### What I did
- Read the whole work-log, `ledger-approval-decision.ts`, `ledger-approval.ts`, the `ledgerTransactions` schema and the existing unique-constraint idiom, the Delete route's `approvedAt` guards (single row and either pair leg), `proxy.ts` API handling, and checked derived FK-name lengths for the proposed table names.
- Ruled on all eight questions (R8 to R15), listed the five corrections the Phase 3 addendum must carry, named the tests, and drafted DECISION-117 and B-159 (B-160 conditional, B-161 released).

### Outputs
- This work-log (this section; Per-Phase Status rows 2 and 4). No code, no database, no email. `docs/decisions.md` and `docs/backlog.md` not edited (tech-lead files); proposed text above.

### Open questions / handoff notes
- **Orchestrator:** the one-line Q1 confirmation to the user still gates 2b's Phase 4 (not 2a, not Phase 3). Q8 (no way to record dissent on a posted approval) decides whether B-160 is filed.
- **Tech-lead (Phase 3 addendum):** apply the five changes above; re-cut Increment 2 into 2a and 2b; fix the exact `CosignConflictBody` and `cosignEligibility` signatures; decide whether to keep the short table name (default) or use the long name with explicit `foreignKey({ name })`.
- **Migration numbers are placeholders** (`0111` / `0112` guesses; newest today is `0110`); database-admin re-derives at each schema step. Worktree plus own Neon branch if the closing-balance pipeline is in Phase 4/5; orchestrator announces each dev-server restart.
- **qa:** concurrency checks recorded as `n/n`; scope selectors to the visible card or table variant; the co-sign button must be absent for the recorder of either leg and for the posting approver.

---

# Phase 3 — Technical Design (tech-lead)

## Rulings that differ from Phase 1/2 (read first)

These are binding on Phase 4. Each one is either a correction found while reading the code or a sharpening that avoids a defect the Phase 2 shape would have produced.

1. **The card/table breakpoint is `xl`, not `md`.** `src/app/(dashboard)/admin/layout.tsx` offsets the content by `lg:pl-64` and pads it `p-6`, so the content column is ~720px at 768px *and* at 1024px wide (1024 - 256 - 48), and only reaches ~976px at 1280px. The six-column table (date, fund up to 220, amount, payee up to 200, recorder, 44px-button actions) needs roughly 930 to 970px. Cards at `md` would have left the same clipped-actions defect at every laptop-with-sidebar width from 1024 to 1279. So: cards below `xl` (one column below `md`, a two-column grid from `md`), table at `xl` and up. Phase 1/2 said "table unchanged at `md+`"; that was written without the sidebar offset in view. `overflow-x-auto` stays on the table as a last-resort fallback only. (Same defect class as B-87, B-89, B-91; the shared components below are the template for B-89, which this pipeline does not touch.)
2. **No `id="txn-<id>"` on the card/row; use `data-row-id` and a visible-match lookup.** Phase 2 R4 said the server renders `id="txn-<id>"` for `RowHighlighter`. The table row and the card both mount (CSS hides one), so that would be a duplicate DOM id, and `getElementById` would return the first one, which is the `display:none` table row below `xl`. Fix: both variants carry `data-row-id="<expense-leg id>"` and no `id`; the History list is a single tree and carries the same attribute. `RowHighlighter` gets one opt-in prop, `persistent`, which (a) resolves the target as the first `[data-row-id="<targetId>"]` element that is actually visible (`getClientRects().length > 0`), (b) only scrolls and focuses it, and (c) does **not** add or remove ring classes and does **not** call `router.replace`. The flash/strip behavior of the two existing call sites is unchanged (default `persistent={false}`), so their tests stand. The server renders the persistent gold ring (`ring-2 ring-lions-gold bg-lions-gold/10`) itself, which is why (b) matters: the component's 2.5-second cleanup would otherwise strip the server-rendered ring.
3. **One shared decision helper instead of two route-local copies.** Phase 2 R7 specified the lock, pinned UPDATE and sentinel "in both routes". That is the same decision in two places. Design: `src/lib/ledger-approval-decision.ts` (server-only, imports `db`) exports `decideTransaction()`; both routes become thin (auth, `LEDGER_APPROVE` gate, parse body, call, map result to `NextResponse`). Not part of the approver-only query module (R3) and not importer-restricted: it writes, and both routes are gated.
4. **Lock shape is one statement.** `SELECT ... FROM ledger_transactions WHERE id = $id OR transfer_group_id = (SELECT transfer_group_id FROM ledger_transactions WHERE id = $id) ORDER BY id FOR UPDATE`. For a non-pair row the subselect is NULL and `transfer_group_id = NULL` matches nothing, so the set is just the target. The expected affected-row count is `locked.length` (1 for an ordinary row, 2 for a pair; any other pair size is treated as a data fault and answered 409 without writing). This replaces the route's current two reads.
5. **Self-block covers either leg.** Today the check is `actor === target.recordedByUserId`. The design blocks when the actor recorded *any* locked row. Both legs are created by one call so this is identical in practice, and it closes the pair where someone recorded only the other leg. The page's own-row marker keys on the displayed (expense) leg, unchanged.
6. **S1 accepted: one pure email builder, ships in Increment 1.** `buildPendingApprovalEmailHtml()` in `src/lib/email-compose.ts` replaces the two inline bodies, with `escapeHtml()` on `party` and `memo`. Increment 1 passes the plain Approvals URL; Increment 2 passes the `?txn=` URL and adds the "only one approval is needed" sentence **inside the builder, unconditionally** (no flag), so the sentence cannot ship ahead of the banner.
7. **S3 accepted in part: memo, fund and recorder join Increment 1; the receipt link stays out.** The dialogs are being moved onto `LedgerDialogShell` and the fund description is a pure function the card already needs, so showing memo, fund (with from to) and recorder inside both dialogs is about 25 lines and no new API. If the implementer finds it exceeds ~30 lines, it reverts to B-156 in full. B-156 is filed as the residual (receipt link in the dialog).
8. **S2 declined in part.** "All expenditures are approved" is a false statement for a rejected item today, and replacing it with "Nothing is waiting for approval" is a one-string accuracy fix with no dependency. That string ships in Increment 1. The "See recently decided" button waits for Increment 2, when the tab exists.
9. **Dialogs own their trigger button.** `RejectTransactionDialog` currently renders `<button onClick>{children}</button>` and the page passes a `<span>` inside it (a styled span in a button, no 44px target); `ApproveDialog` uses `Dialog.Trigger asChild`. `LedgerDialogShell` is controlled and has no trigger slot. Both dialogs now take `triggerClassName: string` plus `children` (the label) and render their own `<button type="button">`. `RejectReimbursementDialog` (same file, other page) is not touched.
10. **`safeCallbackPath()` also accepts a same-origin absolute URL** when the caller passes `origin` (Phase 2 said to reject "any scheme"). Reason: Auth.js appends an *absolute* `callbackUrl` when it redirects to the sign-in page after an OAuth error, and rejecting that would silently drop the deep link in exactly the failure path where a person retries with a password. Cross-origin absolute URLs, `//host`, `javascript:` and everything else still fall back to `/members`.
11. **The history discriminator is tested two ways, because Vitest here mocks `db`.** A unit test renders the one shared SQL predicate through `PgDialect` (precedent: `ledger-audit.test.ts`) and asserts each clause; the fixture-driven behavior test Phase 2 asked for (reimbursement-stamped row, under-threshold Sweep, deleted approver, legacy rejection, pair-once, 26-row cap) runs against real Postgres as a Playwright spec that qa writes in Phase 5 (precedent: `ledger-reimbursement-correct.spec.ts` seeds by DB). Both the history and the deep-link resolver use the **same** exported predicate, so the rule exists once.
12. **A reject-won 409 in Increment 1 carries `decidedAt = updated_at` and `deciderName = null`.** The route's own `updated_at` is the only timestamp that exists before Increment 2's `rejected_at`; the dialog copy handles the null name. Increment 2 changes two lines in the helper (stamp, and read the stamp for the 409 body).
13. **Malformed JSON body is a 400, not a 500.** Both routes today `await request.json()` unguarded, so a bad body surfaces as "Failed to approve transaction" (500). The thin route passes `body?.boardMinute` / `body?.reason` from `await request.json().catch(() => null)` and the helper's existing 400s apply. Under the 30-line absorb rule, noted in Deviations.

## Root cause (bug half, scope A)

On a 390px screen the pending list renders a six-column `<table>` inside `<div class="overflow-x-auto">` (approvals `page.tsx`). Date, Fund and Amount fit; Payee/Memo, Recorded by and Actions sit to the right of the fold. The card has no horizontal scroll cue, so the Approve and Reject controls are unreachable by anyone who does not think to swipe a table sideways. The reporting board member saw a row with no button and concluded they had no permission, although `board_member` carries `ledger.approve` and the same account approved normally on desktop. The controls themselves were also under the 44px touch rule (`min-h-[32px]` Approve; Reject a bare text span).

## Summary

Two ordered deliveries on one design. **Increment 1** (bug-fix variant, no schema, no migration, no dev-server restart) makes the Approvals page usable on a phone and makes the decision itself trustworthy: cards below `xl` with 44px Approve/Reject, Reject hidden on rows the viewer recorded, dialogs moved onto `LedgerDialogShell` with memo/fund/recorder context and an explanation next to the disabled Approve, a shared race-safe decide helper behind both routes that 409s with a typed body naming the decider, the dialogs closing/refreshing/naming the decider on that 409, and the notification emails built by one escaping builder. **Increment 2** adds the record that makes "who decided" displayable (two nullable columns stamped on reject), a "Recently decided" tab (last 25, approver-only module), the `?txn=` deep link with a per-state banner, the email link and sentence, and a single `safeCallbackPath()` guard so the deep link survives sign-in without opening a redirect.

## Permissions

- No new `FEATURES` key, no role-binding migration, no change to `ADMIN_NAVIGATION`, so the DECISION-082 derived proxy rule is unchanged. Everything stays under existing **`ledger.approve`** (bound to `admin` and `board_member`, migration 0047; the treasurer holds it only via Board-group membership, DECISION-115).
- The page keeps its own `auth()` + `hasFeature(FEATURES.LEDGER_APPROVE)` before any lookup (`admin-page-feature-gates.test.ts` already enforces it). The `?tab=` and `?txn=` parameters are read **after** that gate, so a non-approver learns nothing from them.
- **Nothing widens `ledger.view`.** Decider name, board-minute citation and decision time are exposed only by `src/lib/ledger-approval-queries.ts`, imported only by the Approvals page (source-scan test below). The rejection reason is already shown on the register to `ledger.view` holders (Phase 2 R3), so it is not newly exposed. The carrier module `ledger-approval.ts` holds types and pure copy only; it contains no decider data of its own.
- **Role-escalation check:** nothing near `admin.users` / `admin.roles`; `treasurer` gains nothing.

## API Contract

### Carrier (both increments): `src/lib/ledger-approval.ts`

Client-safe, **no DB import, no server-only import** (precedent: `ledger-correction.ts`). The dialogs, the page and the route helper import types from it, so a removed or widened member breaks `tsc`.

```ts
export const RECENT_DECISIONS_LIMIT = 25;
export type ApprovalDecision = "approved" | "rejected";
export type ApprovalKind = "disbursement" | "transfer" | "sweep";

/** Increment 1 */
export interface ApprovalConflictBody {
  error: string;                       // English, a toast fallback only; the UI branches on `code`
  code: "not_pending";
  decision: ApprovalDecision | null;   // null: posted with no board decision, or an unreadable state
  deciderName: string | null;          // display name or null; NEVER an email address
  decidedAt: string | null;            // ISO-8601
  decidedByViewer: boolean;            // true on a double-click (the 409 is the viewer's own earlier success)
}
export interface ApprovalNotFoundBody { error: string; code: "not_found" }
export function isApprovalConflict(body: unknown): body is ApprovalConflictBody;
export function displayDeciderName(name: string | null | undefined): string | null; // null for empty/blank OR any value containing "@"
export function describeApprovalFund(input: {
  fundName: string | null; partnerFundName: string | null;
  entityId: string; partnerEntityId: string | null;
}): { kind: ApprovalKind | "plain"; text: string };   // "Admin Fund → Activity Fund"; "plain" = single fund
export function describeApprovalConflict(body: ApprovalConflictBody, noun: ApprovalKind): string;

/** Increment 2 additions */
export function formatDecisionDateTime(when: Date | string): string; // "Oct 10, 2026 at 3:42 PM", timeZone "America/New_York"
export const APPROVAL_TABS = ["pending", "decided"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];
export function parseApprovalTab(raw: string | undefined): ApprovalTab; // whitelist, default "pending"
export type ApprovalTargetState = /* union below */;
export interface ApprovalBannerModel { tone: "info" | "success" | "neutral"; text: string; linkHref?: string; linkLabel?: string }
export function buildApprovalBanner(state: ApprovalTargetState, ctx: { amountText: string }): ApprovalBannerModel;
```

`describeApprovalConflict` copy (a name of `null` becomes "A board member"; `decidedByViewer` becomes "You"):

| `decision` | `decidedByViewer` | Toast text (`toast.info`) |
|---|---|---|
| approved | true | "You already approved this {noun}." |
| approved | false | "{Name} already approved this {noun}. Only one approval is needed." |
| rejected | any | "{Name} already rejected this {noun}." |
| null | any | "This {noun} is no longer waiting for approval." |

`isApprovalConflict` is true only for an object with `code === "not_pending"` and a string `error`; anything else at 409 (a proxy or an older deploy) falls to the generic line "This entry is no longer waiting for approval." and still closes and refreshes.

### Approve and reject routes (Increment 1)

Both are thin wrappers over `decideTransaction()`:

```ts
// src/lib/ledger-approval-decision.ts (server-only)
export type DecideInput =
  | { kind: "approve"; boardMinute: unknown }   // trimmed, sliced to 500; required only if the locked row has none
  | { kind: "reject";  reason: unknown };       // trimmed, sliced to 1000; required

export type DecideResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 403 | 404 | 409; body: { error: string; code?: string } | ApprovalConflictBody };

export async function decideTransaction(args: {
  id: string; actorUserId: string; input: DecideInput; now?: Date;
}): Promise<DecideResult>;
```

Procedure (the route has already done `auth()` + `hasFeature(LEDGER_APPROVE)` → 401 / 403):

1. `db.transaction(async (tx) => ...)`. First statement: the single-statement lock described in ruling 4 (`.for("update")`, `ORDER BY id`). Zero rows, or the requested `id` absent from the set → return `404 { error: "Transaction not found", code: "not_found" }`.
2. If the target is not `pending` → `409` `ApprovalConflictBody`, error "Transaction is no longer pending". If the target is pending but a partner is not → same body, error "The paired transaction is no longer pending". (Both strings are what the current routes and their tests use.) The body is built by the exported pure function `conflictFromRow(row, deciderName, viewerId)`: `decision = "approved"` iff `status = 'posted' AND approvedAt IS NOT NULL`; `"rejected"` iff `status = 'rejected'`; else `null`. `decidedAt` is `approvedAt`, or (rejected) `rejectedAt ?? updatedAt` (Increment 1: `updatedAt`). `deciderName` is a LEFT JOIN on `users` through `displayDeciderName()`; `decidedByViewer` compares the stamping user id with the actor.
3. Self rule: any locked row with `recordedByUserId === actorUserId` → `403` ("You cannot approve a transaction you recorded" / "You cannot reject a transaction you recorded"; unchanged strings).
4. Input: approve: `boardMinute = provided.trim().slice(0,500) || lockedTarget.boardMinute`, none → `400 "boardMinute is required"`. Reject: empty/blank/non-string → `400 "reason is required"`. (Validation now happens after the lock because "required only when the row has none" needs the locked row; no write has happened, so returning from the transaction commits nothing.)
5. The write: one pinned UPDATE across the locked ids: `UPDATE ledger_transactions SET <stamps> WHERE id IN (<locked ids>) AND status = 'pending' RETURNING id`. Approve sets `status='posted'`, `approvedByUserId`, `approvedAt`, `boardMinute`, `updatedAt`. Reject sets `status='rejected'`, `rejectionReason`, `updatedAt` (Increment 2 adds `rejectedByUserId`, `rejectedAt` here, same statement, both legs). If `returned.length !== locked.length`, **`throw new StaleDecisionRollback()`** so the transaction rolls back (a plain `return` commits; precedent `StaleMoveRollback` in `ledger-fund-move-queries.ts`, `ReimbursementConflictError`).
6. Outside the transaction, catch `StaleDecisionRollback`, re-read once (outside any lock, LEFT JOIN the decider) and answer the same 409 body. The row lock already serializes the two deciders, so under it the in-transaction check in step 2 is what answers a lost race; steps 5/6 are the structural backstop for a future change that weakens the lock (believed unreachable today; pinned by a mock test, not measurable live).

Responses (additive only; success body unchanged):

| Status | Body | When |
|---|---|---|
| 200 | `{ id }` | decided (both legs if a pair) |
| 400 | `{ error }` | missing minute / reason; malformed JSON |
| 401 / 403 | `{ error }` | unauthenticated / missing `ledger.approve` / self-decision |
| 404 | `{ error, code: "not_found" }` | no such row |
| 409 | `ApprovalConflictBody` | row or partner no longer pending, or lost race |

### Transfer / Sweep create returns the expense-leg id (Increment 2)

`POST /api/admin/ledger/transactions` (the Transfer/Sweep branch, near line 640): the two-row insert becomes `const inserted = await db.transaction(async (tx) => tx.insert(ledgerTransactions).values([...]).returning({ id: ledgerTransactions.id, flow: ledgerTransactions.flow }))`. The 201 body gains one additive field, `id` = the `flow='expense'` leg's id: `{ id, transferGroupId, derivedFiscalYear, status }`. The ordinary-expense 201 already returns `{ id, derivedFiscalYear, status }`. If `id` is somehow absent the email falls back to the plain Approvals URL (the link is a courtesy; its absence must never throw before `sendBulkMemberEmail`).

### Email builder (`src/lib/email-compose.ts`)

```ts
export function buildPendingApprovalEmailHtml(input: {
  noun: "disbursement" | "transfer" | "sweep";
  amountDollars: string;   // generated: (cents/100).toFixed(2)
  txnDate: string;         // generated: validated YYYY-MM-DD by parseDate()
  party?: string | null;   // user-typed: escapeHtml()
  memo?: string | null;    // user-typed: escapeHtml()
  reviewUrl: string;       // getAppUrl() + "/admin/ledger/approvals"; Increment 2: + "?txn=" + id
}): string;
```
Keeps today's markup (`<ul>` of Amount, Date, Payee only if present, Memo only if present, then the "Approvals screen" link). The transfer body passes `party: null`. `amountDollars`, `txnDate`, the noun and `reviewUrl` are not escaped (generated here; escaping a date is a no-op and escaping the URL would corrupt `&`). Increment 2 appends: "Only one board approval is needed. If a colleague has already acted, the link will show who." Both call sites stay inside their existing `try/catch` and call the builder as the first statement in the `try` after the recipient lookup so nothing new can throw ahead of `sendBulkMemberEmail`. **Not a durable-claim path** (no `sentAt`, no success row, no append-only "sent" history; DECISION-102/103 do not apply; `sendBulkMemberEmail()` is kept). The deny-by-default guard is unchanged.

### Recently decided and the deep link (Increment 2): `src/lib/ledger-approval-queries.ts`

DB-importing, **approver-only**. The module header states the visibility rule. Exports:

```ts
export const boardDecisionPredicate: (t: typeof ledgerTransactions) => SQL; // the ONE definition
export interface DecidedApprovalRow {
  id: string;                         // expense-leg id: row key and deep-link target
  decision: ApprovalDecision;
  decidedAt: Date;                    // coalesce(approved_at, rejected_at, updated_at)
  deciderUserId: string | null;
  deciderName: string | null;         // displayDeciderName(users.name)
  deciderOnFile: boolean;             // approved: true; rejected: rejected_at IS NOT NULL
  amountCents: number; txnDate: string; party: string | null; memo: string | null;
  fundName: string | null; partnerFundName: string | null;
  entityId: string; partnerEntityId: string | null; entityName: string | null;
  recorderName: string | null;
  boardMinute: string | null;         // approved only
  rejectionReason: string | null;     // rejected only
}
export async function getRecentDecisions(): Promise<DecidedApprovalRow[]>;
export async function resolveApprovalTarget(rawTxn: string, viewerUserId: string): Promise<ApprovalTargetState>;
```

**Discriminator** (`boardDecisionPredicate`, implementing DECISION-116 item 1), applied with `flow = 'expense'` **before** `LIMIT`:

```
t.flow = 'expense' AND (
  t.status = 'rejected'
  OR ( t.status = 'posted' AND t.approved_at IS NOT NULL AND t.board_minute IS NOT NULL
       AND NOT paidReimbursementExists(t.id) )
)
```
Keyed on `approved_at`, not `approved_by_user_id` (Phase 2 R3): `schema.ts` makes `approved_by_user_id` `ON DELETE SET NULL` while `approved_at` has no FK, so a deleted approver account cannot erase a genuine decision. `paidReimbursementExists()` is the existing helper in `ledger-reimbursement-link.ts`; no marker column. An under-threshold Sweep posts immediately carrying a creation-time `board_minute` and no `approved_at` (transfer branch of the transactions route), so it is correctly excluded.

**History query.** `FROM ledger_transactions t` LEFT JOIN `users` (aliases `recorder`, `decider` for `approved_by_user_id` / `rejected_by_user_id`, selecting by decision with a `CASE`), `ledger_funds f`, `ledger_entities e`, and a self-join alias `dest` on `dest.transfer_group_id = t.transfer_group_id AND dest.flow = 'income'` with its fund alias `dest_fund`. `WHERE <predicate>`, `ORDER BY coalesce(t.approved_at, t.rejected_at, t.updated_at) DESC, t.id DESC`, `LIMIT RECENT_DECISIONS_LIMIT`. No entity filter (the page is deliberately cross-entity), no pagination.

**Deep link: `resolveApprovalTarget(rawTxn, viewerUserId)`.** Returns, never throws for bad input, never echoes input:

```ts
type ApprovalTargetState =
  | { state: "not_found" }                                     // malformed, unknown, deleted, or not a UUID
  | { state: "pending"; rowId: string; kind: ApprovalKind; isOwn: boolean }
  | { state: "decided"; decision: ApprovalDecision; rowId: string; kind: ApprovalKind;
      amountCents: number; party: string | null; decidedAt: string;
      deciderName: string | null; deciderOnFile: boolean; byViewer: boolean; reason: string | null }
  | { state: "not_board_decision"; kind: ApprovalKind };       // posted without a board decision
```
`isUuid()` (from `src/lib/utils.ts`) runs first; a failure returns `not_found` without touching the database (a malformed value cast to a `uuid` column throws). One query: the row whose `id = $x`, or the `flow='expense'` row sharing `transfer_group_id` with the row whose `id = $x`, preferring the expense leg (`ORDER BY t.flow = 'expense' DESC LIMIT 1`), so either leg's id resolves to the pair. Classification: `status='pending'` → `pending` (`isOwn = recordedByUserId === viewer`); `status='rejected'` → `decided/rejected`; `boardDecisionPredicate` true → `decided/approved`; otherwise `not_board_decision`. `kind` is `sweep` when the partner leg's entity differs, `transfer` when a partner exists in the same entity, else `disbursement`. The predicate is evaluated in SQL as a selected boolean, so the resolver and the history list can never disagree.

### Banner wording per state (`buildApprovalBanner`, Increment 2)

`{Name}` = `deciderName ?? "A board member"` (legacy rejection with `deciderOnFile=false`: the "who" clause is omitted). `{noun}` = disbursement / transfer / sweep. `{to}` = ` to {party}` only for a disbursement with a payee. Dates via `formatDecisionDateTime()`. `party`, `reason` and `deciderName` are user-typed or user-derived and are rendered as React text, never as HTML.

| State | Tone | Text | Link |
|---|---|---|---|
| pending, not own | info | "This is the {noun} from your email. It is waiting for a board decision." | none; row highlighted, scrolled, focused |
| pending, own | info | "You recorded this {noun}, so another board member needs to decide it." | none; row highlighted, no Approve |
| approved by someone else | success | "Already approved. {Name} approved this {amount} {noun}{to} on {date}. Only one approval is needed, so there is nothing more to do." | "See it under Recently decided" (`?tab=decided&txn=<rowId>`) |
| approved by viewer | success | "You approved this {amount} {noun}{to} on {date}." | same |
| rejected by someone else | neutral | "Rejected. {Name} rejected this {amount} {noun} on {date}. Reason: {reason}." Legacy: "This {noun} was rejected on {date}. Reason: {reason}." | same |
| rejected by viewer | neutral | "You rejected this {amount} {noun} on {date}. Reason: {reason}." | same |
| posted, no board decision | neutral | "This entry did not need board approval, so there is nothing for you to do." | none |
| not found | neutral | "We can't find that disbursement. It may have been deleted after it was recorded." | none |

The banner is a `role="status"` region above the tabs on **both** tabs, so it survives the `router.refresh()` that follows an approve (the approver sees "You approved this ..." as a free confirmation). Tab links drop `txn`, which is how a person dismisses it.

### `safeCallbackPath()` contract (Increment 2)

`src/lib/safe-callback-path.ts`, flat in `src/lib/`, **zero imports** (the `html-escape.ts` / `club-contacts.ts` precedent), client-safe.

```ts
export const DEFAULT_CALLBACK_PATH = "/members";
export function safeCallbackPath(
  raw: string | null | undefined,
  opts?: { origin?: string; fallback?: string },
): string;
```
Algorithm, in order; any failure returns `opts.fallback ?? "/members"`:
1. `typeof raw === "string"`, length 1 to 2048.
2. If `raw` starts with `http://` or `https://`: accept only when `opts.origin` is given and `new URL(raw).origin === opts.origin` (exact string compare, so `https://westervillelions.org.evil.example` fails); then continue with `pathname + search + hash` of that URL. Any other scheme-looking input (`javascript:`, `data:`) never starts with `/` and fails step 3.
3. Must start with `/`; second character must not be `/` or `\`.
4. Reject any backslash and any control or whitespace character (`/[\u0000-\u001f\u007f\s\\]/`) anywhere: browsers strip tab and newline from URLs, so `/<TAB>/evil.example` would otherwise collapse to `//evil.example`.
5. Belt and braces: `const u = new URL(candidate, "http://callback.invalid")`; require `u.origin === "http://callback.invalid"`, then return `u.pathname + u.search + u.hash`, and **re-check the normalized result still starts with a single `/`** (`/..//evil.example` and `/.//evil.example` normalize to `//evil.example`; reject). Percent-encoded input stays a path (`/%2F%2Fevil` is returned unchanged).

**Three call sites, no fourth:**

| Site | Change |
|---|---|
| `src/proxy.ts` line 37 | `signInUrl.searchParams.set("callbackUrl", safeCallbackPath(request.nextUrl.pathname + request.nextUrl.search, { origin: request.nextUrl.origin }))`. `searchParams.set` percent-encodes the whole value, so `?txn=` survives the redirect. Defense in depth: the proxy's own input is a real request path. |
| `src/app/signin/page.tsx` | The raw `searchParams.get("callbackUrl") \|\| "/members"` at render (line 28) is replaced by a small `getCallback()` called **inside** the credentials submit handler (replacing `router.push(callbackUrl)`, line 47) and the Google click handler (replacing `signIn("google", { callbackUrl })`, line 61). It passes `{ origin: window.location.origin }`. Computed at event time, never at render, so SSR (no `window`) and hydration cannot differ. |
| `src/app/register/page.tsx` | Same `getCallback()` for the Google `signIn` (line 114) and the post-register `router.push` (it pushes `/members` and `/signin` today and drops the callback; the `/signin` push belongs to B-155, not here). |

Source-scan test: no non-test file under `src/app` or `src/proxy.ts` reads `searchParams.get("callbackUrl")` or passes `callbackUrl` to `router.push` / `signIn` without calling `safeCallbackPath`.

## Data Model

**Increment 1: no schema changes required.**

**Increment 2:** two nullable columns on `ledger_transactions`. No index (`ix_ledger_txns_status` already narrows; ~1 board-approved and 0 rejected rows in production on 2026-10-10), no back-fill (0 rejected rows), no `NOT NULL`, no default.

`src/lib/db/schema.ts`, after `rejectionReason`:
```ts
rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
rejectedAt: timestamp("rejected_at"),
```

Migration: **`drizzle/migrations/NNNN_ledger_rejection_attribution.sql`**. The number is a placeholder: the newest file today is `0110_treasurer_permission_baseline.sql`, so database-admin re-derives it with `ls drizzle/migrations | sort | tail -3` at the start of Increment 2's Phase 4, and the file is not added to the shared tree until the schema step is complete (Concurrent Pipelines rule 2). Idiom is 0109, exactly:
```sql
-- Migration NNNN: ledger_transactions.rejected_by_user_id / rejected_at (DECISION-116)
-- Who rejected a pending disbursement and when. Nullable; no back-fill (production had 0 rejected rows on 2026-10-10).
-- Idempotent: safe to replay on every deploy.
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_at timestamp;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_transactions_rejected_by_user_id_users_id_fk'
       AND conrelid = 'ledger_transactions'::regclass
  ) THEN
    ALTER TABLE ledger_transactions
      ADD CONSTRAINT ledger_transactions_rejected_by_user_id_users_id_fk
      FOREIGN KEY (rejected_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
```
The constraint is named exactly as drizzle-kit derives it (51 characters) so `drizzle-kit push --force` finds nothing to "fix". Rejected rows are immutable (the PATCH route 403s `status = 'rejected'`, `[id]/route.ts` line ~199), so the columns never need clearing and no un-reject path exists. `approvedAt` is **never** reused for a rejection (it is the lock marker every PATCH/DELETE/split/waive guard keys on). **Type fallout (expected, not scope creep):** `LedgerTransaction` widens; `getPendingApprovals()` enumerates its select list by hand and must gain the two fields; typed fixtures in tests stop compiling until updated. Full-row `select()` results passed to client props now also serialize `rejectedByUserId` (same exposure class as the existing `approvedByUserId`); the implementer glances at the register and search select lists but this is not a blocker.

## Component / Page Plan

### Increment 1

Files to create (flat in `src/components/admin/ledger/`, no new subdirectory):

| File | Kind | Purpose |
|---|---|---|
| `approval-fund-label.tsx` | Server, presentational | The fund cell/line: Sweep (purple) or Transfer (blue) chip plus "From → To", or the single fund name; built from `describeApprovalFund()`. Used by the table cell and the card. |
| `approval-actions.tsx` | Server, presentational | Approve (primary, `min-h-[44px]`), Reject (secondary outlined, `min-h-[44px]`), or, for the viewer's own row, an amber "You recorded this, so another board member must decide it." line with **no Reject**. Used by the table cell and the card; the row's `isSelf` comes from `rowActions(isSelf)` in the logic file. |
| `approval-card.tsx` | Server, presentational | One pending item below `xl`: amount (large) and date, payee, memo (wraps, not truncated), fund label, "Recorded by", actions. `rounded-2xl bg-white shadow-sm`, `data-row-id`. |
| `approval-dialog-context.tsx` | Presentational (no hooks) | A small `<dl>` inside both dialogs: Fund (from → to), Memo, Recorded by. About 20 lines. |
| `approval-dialog-logic.ts` + `.test.ts` | Pure | `approvalFailureAction(status, body, verb)`, `approveHint(...)`, `rowActions(isSelf)`. Precedent: `correction-dialog-logic.ts`, `paid-reimbursement-logic.ts`. |
| `src/lib/ledger-approval.ts` (+ `.test.ts`) | Carrier | See API Contract. |
| `src/lib/ledger-approval-decision.ts` (+ `.test.ts`) | Server | `decideTransaction()`. |

Files to modify:
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx`: stays a Server Component. Renders `<ul class="grid gap-4 md:grid-cols-2 xl:hidden">` of `ApprovalCard` and, inside `<div class="hidden xl:block">`, the existing table whose Fund, Recorded-by and Actions cells now use `ApprovalFundLabel` and `ApprovalActions`. Payee/Memo cells wrap (`break-words`) instead of `truncate`. Empty-state copy becomes "Nothing is waiting for approval" with the existing sub-line. The `h1` stays "Pending Approvals" until Increment 2.
- `src/components/admin/ledger/approve-dialog.tsx`: moves onto `LedgerDialogShell`; props `{ transactionId, amount, party, existingBoardMinute, context, triggerClassName, children }`; owns its trigger button; hint (below); 409/404 handling (below); `autoFocus` removed (see below).
- `src/components/admin/ledger/reject-dialog.tsx`: **only** `RejectTransactionDialog` changes, same pattern. `RejectReimbursementDialog` is untouched.
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` and `.../reject/route.ts`: thin wrappers (keep the doc comments' response tables, updated for the 409 body).
- `src/app/api/admin/ledger/transactions/route.ts`: both E-1 bodies replaced by `buildPendingApprovalEmailHtml()`.
- `src/lib/email-compose.ts` (+ `email-compose.test.ts`).

**Dialog behavior (both):**
- Controlled by `LedgerDialogShell` (`w-[calc(100vw-1.5rem)] max-w-lg`, `max-h-[90vh] overflow-y-auto`, 44px close button), which already fits 360px. Footer: `flex flex-col-reverse gap-3 sm:flex-row sm:justify-end`, both buttons `min-h-[44px]`, `rounded-lg`.
- **Keyboard / focus:** the field is focused on open **only** when the device has a fine pointer (`window.matchMedia("(hover: hover) and (pointer: fine)").matches`), via a ref effect on `open`; on touch the keyboard stays down until the person taps the field, so the context above it remains visible. With `autoFocus` gone, Radix focuses the first focusable element (the shell's close button), which is keyboard-safe.
- **Approve hint (D):** when Approve is disabled for lack of a minute (`!boardMinute.trim() && !existingBoardMinute`) render `<p id="approve-hint" role="status" class="text-xs text-gray-500">Add a minute reference to enable Approve.</p>` directly above the buttons and put `aria-describedby="approve-hint"` on the disabled button; remove both when enabled. The existing "(required)" label and helper text stay.
- **Failure handling (A2):** `if (!res.ok)` reads the JSON body (`.catch(() => null)`) and calls `approvalFailureAction(res.status, body, "approve" | "reject")`:
  - `409`: `toast.info(describeApprovalConflict(...))` (or the generic line when the body is not an `ApprovalConflictBody`), close the dialog, `router.refresh()`. Typed text is discarded (the decision is already made).
  - `404`: `toast.error("This entry no longer exists.")`, close, refresh.
  - `400` / `403` / `5xx`: `toast.error(body.error ?? generic)`, dialog **stays open** with the typed minute or reason preserved.
  - Network failure (`fetch` throws): generic "Could not approve disbursement. Please try again." Today the raw `TypeError` text ("Failed to fetch") is shown; only server-provided `error` strings are surfaced now.
- **Double-click / double-tap:** the submit button is `disabled` while `submitting`, so a second request does not normally fire; if one does, it 409s with `decidedByViewer: true` and reads "You already approved this disbursement."

### Increment 2

Files to create: `src/lib/ledger-approval-queries.ts` (+ `.test.ts`), `src/lib/safe-callback-path.ts` (+ `.test.ts`), `src/proxy.test.ts`, `src/components/admin/ledger/approval-history.tsx`, `approval-banner.tsx`, `approval-tabs.tsx`, migration (database-admin), and qa's `e2e/ledger-approvals-history.spec.ts`.

Files to modify: `schema.ts`; `approvals/page.tsx`; `reject` path in `ledger-approval-decision.ts` (two stamp keys + reading the stamp for the 409 body); `getPendingApprovals()` select list; `transactions/route.ts` (Transfer/Sweep `returning`, `id` in the 201 body, `reviewUrl` with `?txn=`); `email-compose.ts` (the sentence); `src/proxy.ts`; `signin/page.tsx`; `register/page.tsx`; `row-highlighter.tsx` (`persistent`).

**Page (Server Component).** `searchParams: Promise<{ tab?: string; txn?: string }>`. Order: `auth()` → `hasFeature(LEDGER_APPROVE)` (else the existing redirect) → `parseApprovalTab(tab)` → `Promise.all([getPendingApprovals(), getSettings()])` → if `txn` present, `resolveApprovalTarget(txn, userId)` inside its own `try/catch` (a failure logs and renders no banner) → if `tab === "decided"`, `getRecentDecisions()` inside its own `try/catch` that sets `historyFailed`. **The history fetch only runs on the decided tab**, and neither failure can blank Pending. `h1` becomes "Approvals"; tabs are `<Link>`s (`/admin/ledger/approvals`, `/admin/ledger/approvals?tab=decided`), styled like the reimbursements page's, labelled "Pending ({n})" and "Recently decided", with focus rings; no client state.

**History list (`approval-history.tsx`, single tree, no table).** One `rounded-2xl bg-white shadow-sm` card per row, `data-row-id`, stacked at every width: decision badge (Approved green, Rejected gray, `rounded-lg` like the reimbursements `StatusBadge`), decision date/time (America/New_York), amount, payee and memo, fund label (reused), entity name as small secondary text, "Recorded by", "Decided by" (`"You"` when `deciderUserId` is the viewer; `{name}`; `"a board member"` for an approved row with no name or a rejection with `deciderOnFile`; `"decider not on file"` for a legacy rejection), and the minute citation (approved) or rejection reason (rejected) in full (`break-words whitespace-pre-wrap`; never a `title` tooltip). Footnote: "Showing the 25 most recent decisions. For older entries, use the Ledger register or search." (links to `/admin/ledger` and the ledger search). Empty: "No disbursements have been approved or rejected yet." in `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`. Failure: "Could not load recent decisions. Try again in a moment." in the same card with a `?tab=decided` reload link. Pending empty state gains the secondary-style link-button "See recently decided" (`rounded-lg`, `border-2 border-lions-blue`).

**Highlight.** The page passes `highlightId` (the resolver's `rowId`) to the list that is showing: the pending cards/table when `state: "pending"` and tab is pending; the history list when `state: "decided"` and the tab is decided and the row is among the 25. The target gets `ring-2 ring-lions-gold bg-lions-gold/10 scroll-mt-24 focus:outline-none` and `tabIndex={-1}` server-rendered. `<Suspense fallback={null}><RowHighlighter targetId={highlightId} idPrefix="txn-" persistent /></Suspense>` (the Suspense wrapper matches the existing call sites; `useSearchParams` needs it) only scrolls and focuses.

## Implementation Order and Implementers

### Increment 1 (patch-sized; ships first; no schema, no migration, no dev-server restart)

1. **api-developer.** (a) `ledger-approval.ts` Increment 1 members + test. (b) `ledger-approval-decision.ts` + test, then rewrite the two routes as thin wrappers; rewrite the two route test files. (c) `buildPendingApprovalEmailHtml()` in `email-compose.ts` + tests; swap both E-1 bodies. Gate: `pnpm exec tsc --noEmit`, `pnpm test` green, no `console.log`, auth + `hasFeature` still the first statements in both routes.
2. **ux-developer** (after the carrier exists). Shared components, dialogs (shell, trigger, hint, 409/404 handling, focus), page cards and table, empty-state copy, `approval-dialog-logic.ts` + test. Gate: tsc, `pnpm test`, `pnpm build:only`, no native dialogs, brand rules (`rounded-2xl` cards, `rounded-lg` buttons, `lions-gold` ring not border, focus ring on every control).

Not `full-stack-developer`: well over 150 lines across API + UI. **Phase 5** (qa) gets its own PASS; then a short analyst confirmation (bug-fix variant of Phase 6); the orchestrator pushes. Increment 2 follows.

### Increment 2 (full; adds a migration)

1. **database-admin.** `schema.ts` columns + the idempotent migration, number re-derived at the start. Because this adds a migration and another work-log (`2026-10-09-september-admin-session-closing-balance`) is open, if that pipeline is in Phase 4/5 when this starts, run Increment 2's Phase 4/5 in an `isolation: "worktree"` with its own Neon branch and `.env.local` copy (rule 5). A schema change requires an orchestrator-announced dev-server restart before any other pipeline's live checks (rule 2).
2. **api-developer.** Reject stamp (two keys) and the reject 409 reading it; `getPendingApprovals()` select list; `ledger-approval-queries.ts` + tests; `ledger-approval.ts` Increment 2 members (tabs, state union, banner builder) + tests; `safe-callback-path.ts` + tests + `src/proxy.test.ts`; the three consumers; the Transfer/Sweep `returning` and 201 `id`; `reviewUrl` with `?txn=` and the sentence in the builder; route and email tests. 
3. **ux-developer.** Page tabs, banner, history list, empty and failure states, `RowHighlighter` `persistent`, `h1`.

Then Phase 5 (full), Phase 6 SHIP IT closes the pipeline.

## Unit tests, by name and file (the implementer delivers these; qa does not)

**Increment 1**

`src/lib/ledger-approval.test.ts`
- `describeApprovalFund`: same-entity pair is Transfer; cross-entity pair is Sweep; no partner is plain; a null fund name reads "Unknown Fund".
- `displayDeciderName`: null, empty and blank return null; a value containing "@" returns null; an ordinary name is returned trimmed.
- `describeApprovalConflict`: one case per row of the toast table; a null name reads "A board member"; no output contains "@".
- `isApprovalConflict`: accepts a full body; rejects a body with no `code`, a different `code`, or a non-object.

`src/lib/ledger-approval-decision.test.ts` (hermetic: mocks `@/lib/db`, supports `.for("update")`, `.orderBy`, `.update().set().where().returning()`)
- approve, ordinary row: the single UPDATE sets `posted`, approver, `approvedAt`, `boardMinute`, `updatedAt`; its WHERE renders (via `PgDialect`) `"status" = 'pending'` and the locked id; the lock select is called with `.for("update")` and an `ORDER BY id`.
- approve, pair: one UPDATE covers both ids with identical stamps; 200.
- approve, blank minute: ordinary row with no minute returns 400 and no UPDATE; a Sweep that already has a minute keeps it; 500-character truncation.
- self rule: 403 when the actor recorded the target; **403 when the actor recorded only the destination leg of a pair**; no UPDATE in either case.
- target not pending: 409 body for (approved by a named user), (approved, approver account deleted: `approvedAt` set, `approvedByUserId` null, so `decision: "approved"`, `deciderName: null`), (rejected: `decision: "rejected"`, `deciderName: null`, `decidedAt` = `updatedAt`), (posted with no `approvedAt`: `decision: null`), (the actor is the decider: `decidedByViewer: true`). Error string is "Transaction is no longer pending".
- partner not pending (target pending): 409 with the string "The paired transaction is no longer pending"; no UPDATE; both legs unchanged.
- **sentinel:** the pinned UPDATE returns fewer ids than locked rows (1 of 2): the transaction callback throws, the mock `db.transaction` rejects (rolls back), the helper re-reads once and returns the 409 body; no stamp survives.
- two sequential decisions simulating a race: first returns 200; second sees `posted` and returns 409 naming the first approver.
- approve then reject (and reject then approve) simulating approve racing reject: the loser gets 409 with the winner's `decision`; the loser's `.set` is never called, so no approver stamp can land on a `rejected` row.
- unknown id: 404 with `code: "not_found"`.
- reject: requires a non-blank reason (400), trims and slices to 1000, stamps both legs of a pair, self rule as above. (Increment 2 adds: both legs get `rejectedByUserId` and `rejectedAt`.)
- `conflictFromRow`: the pure classification table, including a name that is an email address (returns `deciderName: null`).

`src/app/api/admin/ledger/transactions/[id]/approve/route.test.ts` and `.../reject/route.test.ts` (rewritten, the helper mocked)
- 401 unauthenticated; 403 without `ledger.approve`; helper results map to the right status with the body passed through unchanged; malformed JSON becomes 400, not 500; 200 returns `{ id }`.

`src/app/api/admin/ledger/transactions/route.test.ts` (extended)
- ordinary over-threshold: the html passed to `sendBulkMemberEmail` escapes a payee `<img src=x onerror=1>` and a memo `<script>`; Sweep over-threshold: memo escaped, no Payee line.

`src/lib/email-compose.test.ts` (extended)
- `buildPendingApprovalEmailHtml`: escapes `party` and `memo`; omits the Payee/Memo `<li>` when absent; uses the given `reviewUrl` verbatim as the link `href`; for noun `sweep` reads "A sweep requires board approval"; does not escape `amountDollars`/`txnDate`.

`src/components/admin/ledger/approval-dialog-logic.test.ts`
- `rowActions(true)`: no Approve, no Reject, self message; `rowActions(false)`: both.
- `approvalFailureAction`: 409 with a valid body returns `close + refresh + info message naming the decider`; 409 with an unrecognized body still closes and refreshes with the generic line; 404 closes and refreshes; 400/403/500 keep the dialog open and carry the server's `error`; a network failure keeps it open with the fixed generic message.
- `approveHint`: shown when no minute and none pre-filled; hidden when typed; hidden when the row already cites a minute.

**Increment 2**

`src/lib/safe-callback-path.test.ts` (table test)
- Passes unchanged: `/admin/ledger/approvals?txn=00000000-0000-4000-8000-000000000001`, `/members`, `/admin/ledger/approvals?tab=decided&txn=...`, `/%2F%2Fevil` (stays a path).
- Falls back to `/members`: `//evil.example`, `/\evil.example`, `/\\evil.example`, `/<TAB>/evil.example`, `/<LF>/evil.example`, `/..//evil.example`, `/.//evil.example`, `https://evil.example/x`, `HTTPS://evil.example`, `javascript:alert(1)`, `data:text/html,x`, an empty string, `null`, `undefined`, a 2049-character path, a path containing a space or a backslash.
- With `origin: "https://westervillelions.org"`: `https://westervillelions.org/admin/ledger/approvals?txn=x` reduces to the path; `https://westervillelions.org.evil.example/` and `https://evil.example/` fall back; `http://westervillelions.org/` (scheme differs) falls back.
- `opts.fallback` is honored.
- **Source scan:** no non-test file under `src/app` or `src/proxy.ts` reads `searchParams.get("callbackUrl")` or passes `callbackUrl` to `router.push` / `signIn` without `safeCallbackPath(` in the same file.

`src/proxy.test.ts` (new; mocks `@/lib/auth`)
- signed-out request to `/admin/ledger/approvals?txn=<uuid>` redirects to `/signin` whose `callbackUrl` parameter decodes to exactly `/admin/ledger/approvals?txn=<uuid>` (query string preserved); signed-out `/admin/ledger/approvals` carries no stray `?`; the other redirects (`isActive === false`, access-pending) are unchanged.

`src/lib/ledger-approval-queries.test.ts`
- **importer allow-list (source scan):** the only non-test importer of `ledger-approval-queries` under `src` is `src/app/(dashboard)/admin/ledger/approvals/page.tsx`; nothing under `src/app/members/**`, `src/app/api/members/**`, the Ledger overview, register, search or reports imports it (precedent: the member-surface guard in `ledger-audit.test.ts`).
- **predicate SQL shape (via `PgDialect`):** contains `flow = 'expense'`, the rejected branch, `status = 'posted'`, `"approved_at" is not null`, `"board_minute" is not null`, and a `not exists` over `ledger_reimbursements` with `status = 'paid'`; and does **not** contain `approved_by_user_id`.
- history query: ordered by the coalesce expression then `id` descending, limited to `RECENT_DECISIONS_LIMIT`, `flow = 'expense'` appears in the WHERE (so the limit counts decisions not legs); no entity filter.
- row mapping: approved row with a null decider name is "named: null, onFile: true"; rejected row with null `rejected_at` is `deciderOnFile: false` and falls back to `updated_at`; a name containing "@" is dropped.
- `resolveApprovalTarget`: a non-UUID (`"not-a-uuid"`, `"1; drop table x"`, a 5,000-character string) returns `not_found` **without calling the database**; the result never contains the raw input; each state is produced from a mocked row (pending, pending-own, approved by other, approved by viewer, rejected by other, rejected by viewer, legacy rejected, posted-no-decision, unknown id).

`src/lib/ledger-approval.test.ts` (extended): `formatDecisionDateTime` (a UTC instant that is the previous evening in New York renders the Eastern date, pinning the explicit `timeZone`; one case on each side of a DST change); `parseApprovalTab` (`"decided"`, `"pending"`, `"bogus"`, `undefined`, `["decided"]`-style arrays); `buildApprovalBanner` for every row of the banner table, including the "You" variants and the wording for a transfer and a sweep.

`src/lib/email-queue-view.test.ts` (extended): `redactQueuedEmailHtml('<a href="https://x/admin/ledger/approvals?txn=00000000-0000-4000-8000-000000000001">')` leaves the `txn` UUID readable (a transaction id is not a credential). Basis for the claim: `LONG_HEX_RUN` needs 32 contiguous hex characters and the UUID is hyphen-broken, and `CREDENTIAL_QUERY_VALUE` matches only parameter names containing token, key, secret, code, pass, pwd, auth, sig or session; `txn` contains none. Pinned by this test rather than assumed.

`src/app/api/admin/ledger/transactions/route.test.ts` (extended): the Transfer/Sweep 201 body carries `id` (the expense leg's id) **and** still `transferGroupId`, `derivedFiscalYear`, `status`; the pending e-mail's `href` ends `?txn=<that id>`; the e-mail contains the one-approval sentence; if the insert returns no expense row the link is the plain Approvals URL and the send still happens.

`src/components/admin/ledger/row-highlighter` (extend the existing test, or add one if none exists): default mode still adds then removes the ring classes and strips `highlight`; `persistent` mode calls neither `classList` mutation nor `router.replace`, and selects the visible match when two `[data-row-id]` elements exist.

## Phase 5 click-throughs (qa)

**Environment:** dev server owned by the orchestrator; dev email only to the tester's own address in `EMAIL_DEV_ALLOWLIST` (deny-by-default stays on; verify queued rows are `blocked_non_production` for anyone else). Fixtures are two users: a **board-only** user (`board_member` + `member`; no admin, no `ledger.record`) and a recorder (the e2e admin). Seed one pending disbursement recorded by the admin, one recorded by the board user, one pending Sweep and one Transfer. The ledger e2e suite is serial (single worker); every spec tags its rows and cleans up.

*Increment 1* (`e2e/ledger-approvals-mobile.spec.ts` for the scripted parts):
1. **390px and 360px, signed in as the board-only user:** the card list is visible and the table is not (`xl:hidden` / `hidden xl:block`); Approve and Reject are visible with no horizontal swipe (`document.documentElement.scrollWidth <= window.innerWidth`) and each has a bounding-box height of at least 44px; a Sweep card shows the chip and "From → To". Scope every selector to the **visible** variant: both trees mount (CSS hides one), so a bare `getByRole("button", { name: "Approve" })` matches two.
2. Open Approve at 360px: the dialog fits (`getBoundingClientRect()` inside the viewport, scrolls inside at 90vh), shows Fund/Memo/Recorded-by, the disabled Approve has a visible "Add a minute reference to enable Approve." hint and `aria-describedby`; typing a minute removes the hint and enables the button; on a touch-emulated context the field is **not** auto-focused, on a fine-pointer desktop context it is.
3. Approve to completion: toast "Disbursement approved.", card leaves Pending, and the row's DB stamp is the board user.
4. The row recorded by the viewer: amber "You recorded this" line, **no Reject** in the DOM; a direct POST to the reject route still 403s.
5. **Two sessions on one row:** session B opens Approve and types a minute; session A approves; B clicks Approve. Expected: B's dialog closes, the list refreshes, a toast names A (or "A board member"), and the DB shows exactly one `approved_by_user_id`. Repeat approve-vs-reject. Also an API-level race (two simultaneous POSTs): record the observed outcome count as `n/n` runs of one 200 plus one 409 (Phase 5 live check L1; the accepted residual is that a lost race and a later Delete leave no audit row, B-157).
6. Widths 1024, 1279 (cards, 2-column grid at `md`+), 1280 and 1440 (table, no clipped Actions column).
7. Email: create an over-threshold disbursement with payee `<b>x</b>`; the queued row at `/admin/email-queue` shows `&lt;b&gt;` (escaped), the link, and (Increment 1) **no** "only one approval" sentence.
8. Open the Next dev "1 Issue" overlay on this page and confirm it is not a hydration warning from this page.

*Increment 2* (`e2e/ledger-approvals-history.spec.ts`; also the fixture-driven discriminator test of ruling 11):
1. **Discriminator fixtures, real Postgres:** seed a paid-reimbursement-linked posted row stamped by the treasurer (must **not** appear), an under-threshold Sweep with a creation-time minute and no `approved_at` (must not appear), an approved row whose approver user row is deleted (appears, "a board member"), a legacy rejected row with null `rejected_by_user_id`/`rejected_at` (appears, "decider not on file", dated by `updated_at`), a Transfer pair (one row), and 26 decisions (exactly 25, newest first, equal timestamps in stable `id` order).
2. Tabs: `?tab=bogus` falls to Pending; the decided tab shows decision, who, when (Eastern), the full minute or reason; the Pending tab still renders when the history query is forced to fail (stub); the Pending empty state offers "See recently decided".
3. **`?txn=` states,** one fixture each: pending not-own (highlight, scrolled, focused), pending own, approved by other, approved by viewer (also seen after approving from the card, banner survives `router.refresh()`), rejected by other, rejected by viewer, either leg of a Transfer and of a Sweep, a reimbursement-paid row, a deleted id, `?txn=not-a-uuid`, `?txn='; select 1`, a 5,000-character `txn`: no 500, nothing echoed, and `ledger.approve`-less users still redirect to `/admin/ledger` with no information.
4. **Signed-out deep link, password:** GET `/admin/ledger/approvals?txn=<id>` signed out; the `/signin` URL carries `callbackUrl=%2Fadmin%2Fledger%2Fapprovals%3Ftxn%3D<id>`; sign in; land on the page with the banner. **Google:** manual with the real test Google account (not scriptable); confirm the encoded query survives the round trip (Phase 5 live check L4). Open-redirect checks: `/signin?callbackUrl=https://evil.example`, `//evil.example`, `/\evil.example` each land on `/members` after a password sign-in; the same values on `/register`.
5. Reject end to end: both legs of a Sweep get `rejected_by_user_id` and `rejected_at` (DB assert), the history shows one "Rejected" row with the rejector's name, and the reason is shown in full.
6. Email: the queued Transfer/Sweep and disbursement rows contain `?txn=<expense-leg id>` and the one-approval sentence, and the queue view shows the UUID un-redacted (Phase 5 live check L3).
7. After deploy (Phase 6, orchestrator reads only, counts): the Recently decided row count equals the Verify-First `board_approved_rows + rejected_expense_legs` figures at that time (1 + 0 on 2026-10-10). This records the observed fit of the discriminator against production (live check L2).

## Edge cases and risks

- **Double-click / double-tap:** the button disables while submitting; a duplicate that gets through 409s with `decidedByViewer: true` and reads "You already approved this ...".
- **Two approvers racing:** the `FOR UPDATE` lock serializes them; the loser sees `status <> 'pending'` in step 2 and gets a 409 naming the winner. The lock is taken in `ORDER BY id` order so two concurrent pair decisions cannot deadlock. The pinned UPDATE plus rollback sentinel is the structural backstop (believed unreachable while the lock holds; pinned by a mock test only, so it is not measured live).
- **Approve racing reject:** the loser's `.set` never runs, so an approver stamp cannot land on a `rejected` row (the failure Phase 1 N4 described).
- **Deleted approver account:** `approved_by_user_id` becomes NULL (`ON DELETE SET NULL`); `approved_at` remains, so the row stays in history and in the banner as "A board member". Same for a deleted rejector.
- **Legacy rejected rows:** none in production (0 on 2026-10-10, measured). The `deciderOnFile: false` branch costs one conditional and stays.
- **Malformed or hostile `txn`:** `isUuid()` first, then a parameterized query; never echoed; same `not_found` banner as an unknown id so there is no oracle between "malformed" and "unknown". `tab` is whitelisted.
- **A pair where the viewer recorded one leg:** the server blocks the decision (ruling 5); the page keys the own-row marker on the expense leg. A `?txn=` for the income leg of the viewer's own pair resolves to the pair and shows the "You recorded this" banner.
- **Long text:** payee, memo, reason and minute wrap (`break-words`); nothing relies on `truncate` or a tooltip for content a phone user needs; banner and cards are checked at 360px.
- **`updated_at` is not a decision time for approved rows:** approved rows use `approved_at`; only a legacy rejection falls back to `updated_at`, and the UI says "decider not on file" beside it.
- **Naive timestamps:** `approved_at`, `rejected_at` and `updated_at` are `timestamp without time zone` written from server `new Date()`; Drizzle reads them as UTC, so formatting with an explicit `America/New_York` is correct. Do not rely on the server locale.
- **Email failure must not block the transaction insert:** both blocks keep their `try/catch` that swallows failures; the builder call is inside it.
- **Redactor:** pinned by a test, not assumed (see above).
- **`router.refresh()` and the banner:** `txn` stays in the URL after an approve, so the banner re-renders as "You approved this ...". Intended.
- **Migration replay:** every statement is idempotent; replaying on every deploy and every `pnpm dev` start is safe. A half-written migration in the shared tree would be applied by every pipeline's server start, hence the rule 2 hold.
- **Concurrent pipelines:** `schema.ts` is the shared hot file; the other open work-log is `2026-10-09-september-admin-session-closing-balance`. Gate failures in files this diff does not touch are recorded as "concurrent, not this diff" (rule 3).
- **Adjacent gap, not designed here (flagged, see Proposed backlog below):** a pending row's amount and payee are editable by `ledger.record` holders until it is approved (`[id]/route.ts` PATCH accepts `amountCents` on non-rejected, non-approved rows), and the approve request does not carry what the approver saw. An approver can therefore approve a figure that changed after they opened the dialog. Reimbursement Mark Paid already carries the amount and `updatedAt` and 409s on change.

## Out of scope (non-goals; confirm)

- Reset-password / forgot-password carrying the callback (B-155). The register page's own `router.push("/signin")` after account creation is part of B-155.
- Any "decided" follow-up email, or retracting the original email. The banner is the answer.
- Showing the receipt in the Approve dialog (B-156, residual).
- Any change to the approval threshold, the one-approver rule, or requiring two approvers.
- Approving, rejecting or reversing a decision from the history tab; any history action at all.
- A complete, filterable audit of every decision ever made (the register and search remain the book of record; the audit-row gap is B-157).
- Back-filling `rejected_by_user_id` for existing rejected rows (there are none).
- Fixing the same clipped-table defect on Reimbursements, Email Queue and Reconciliation (B-89, B-87, B-91); the new shared components are the template.
- A deep link from the Ledger overview's "pending" chip or the sidebar badge.
- Pagination, a per-entity filter, or an Approved/Rejected sub-filter on the history.

## Release-notes draft (no version number; `/release-notes` assigns it at ship time)

*Increment 1.* **Approving from a phone now works.** On a phone the Approvals page shows each pending disbursement as a card with large Approve and Reject buttons; before, the buttons sat off-screen to the right of a table. The Approve and Reject windows now fit a small screen, show the memo, fund and who recorded the entry, and explain why Approve is greyed out until you add a minute reference. If another board member decides an entry first, you now see who did, instead of an error. Reject no longer appears on entries you recorded yourself. Notification emails now display payee and memo text safely.
*Increment 2.* **See what the board has decided.** The Approvals page has a "Recently decided" tab with the last 25 approvals and rejections, who decided, when, and the minute reference or reason. The link in the approval email now opens the exact entry: if it is waiting, it is highlighted; if a colleague already acted, a note says who and when, so no one has to guess. Only one approval is needed, and the email now says so. Signing in from an email link now keeps you on the exact entry you were sent to, and sign-in links can only ever return you to this site.

## Proposed backlog text (ID to be reserved by the orchestrator; not filed)

**Proposed B-158.** *Approve and reject do not check what the approver saw.* A pending entry's amount, payee and memo can be edited by a `ledger.record` holder (`PATCH /api/admin/ledger/transactions/[id]`) until it is approved, and the approve/reject request carries only the minute or reason. An approver can approve a different figure than the one on screen when they opened the dialog. Mirror reimbursement Mark Paid (DECISION-106): the dialog sends the `amountCents` and `updatedAt` it displayed, and `decideTransaction()` 409s with a typed `changed` code when either differs, naming "was edited". Small once the shared helper exists. Priority: should-do, medium (money governance). Origin: this work-log, Phase 3.

## Filing record (tech-lead, 2026-10-10)

Filed per Concurrent Pipelines rule 4, using the Phase 2 drafts:
- `docs/decisions.md`: **DECISION-116**, `Status: Proposed` (Phase 3), revised for this design (shared helper; either-leg self rule; single-statement lock; `safeCallbackPath()` same-origin absolute rule). Promotes to `Resolved` at Phase 6 after each factual sentence is re-read against QA's "Established" list.
- `docs/backlog.md`: **B-155** (Soon), **B-156** (Later; reduced to the receipt link because memo/fund/recorder joined Increment 1), **B-157** (Later). Entries added to the Table of Contents and to the body of their tiers.
- Not touched: `package.json`, `docs/release-notes/`, `CLAUDE.md`. Release-time doc follow-ups for tech-lead: a Key Patterns note that any new `callbackUrl` consumer goes through `safeCallbackPath()`, and a line in the Expense Reimbursements/approvals area on the decided-history tab (DECISION-116).

## Phase 3 — Technical Design — 2026-10-10

**Owner:** tech-lead
**Status:** complete

### Summary
Two ordered deliveries on one design. Increment 1 (no schema) fixes the phone bug and makes the decision race-safe: cards below `xl` (the admin sidebar offset, not `md`, is what clips the table), 44px Approve/Reject, Reject hidden on own rows, dialogs on `LedgerDialogShell` with context and a disabled-state hint, one shared `decideTransaction()` helper behind both routes that locks the pair in id order, pins the UPDATE on `status = 'pending'`, rolls back on a short count and 409s with a typed body naming the decider, and one escaping email builder. Increment 2 adds `rejected_by_user_id`/`rejected_at`, the approver-only `ledger-approval-queries.ts` (History tab, `?txn=` resolver), the banner, the email deep link, and `safeCallbackPath()` with three consumers.

### What I did
- Read the whole work-log and the approvals page, both dialogs, `LedgerDialogShell`, `RowHighlighter`, both routes, both E-1 email blocks and the Transfer/Sweep insert, `getPendingApprovals`, `ledger-reimbursement-link.ts`, `proxy.ts`, signin/register, the `ledgerTransactions` schema, migration 0109, `email-compose.ts`, the admin layout and the move-route sentinel precedent.
- Found and ruled on thirteen departures from Phase 1/2 (top of this section), most importantly the `xl` breakpoint, the duplicate-DOM-id hazard in the Phase 2 highlight design, and the shared decide helper.
- Filed DECISION-116 (Proposed) and B-155/B-156/B-157; drafted B-158 for the orchestrator.

### Outputs
- This work-log (Phase 3 section, Per-Phase Status). `docs/decisions.md` (DECISION-116). `docs/backlog.md` (B-155, B-156, B-157; table of contents). No application code, no `package.json`, no release notes, no email, no database access.

### Open questions / handoff notes
- **Implementers.** Increment 1: **api-developer** (carrier, `ledger-approval-decision.ts`, routes, email builder, tests), then **ux-developer** (components, dialogs, page, dialog logic and its test). Increment 2: **database-admin** (columns + migration; worktree + own Neon branch if the closing-balance pipeline is still in Phase 4/5), then **api-developer**, then **ux-developer**. Not full-stack-developer.
- **Orchestrator:** (1) decide whether to reserve B-158 for the approve-what-you-saw gap; (2) announce the dev-server restart after Increment 2's schema step; (3) the Increment 1 push waits on qa PASS plus the analyst's short confirmation.
- **Phase 5 live checks that record a rate (rule a):** L1 two-session race, record `n/n` of one 200 and one 409 and the single approver stamp; L2 post-ship production count fit of the history against the Verify-First figures; L3 the redactor leaves `?txn=<uuid>` readable in the queue view; L4 the encoded query survives the Google round trip.
- **Deviations the implementers must log** (size rule): malformed JSON becomes 400; any move of the dialog-context work back to B-156 if it exceeds ~30 lines.
- **For qa:** every selector must be scoped to the visible variant (table vs cards both mount); test 360px, 390px, 1024, 1279, 1280.

---

# Phase 3 addendum — Increment 2a and 2b (tech-lead)

> Read after the original Phase 3 and before Phase 4. It re-cuts the original "Increment 2" (API contract items marked "Increment 2", the Increment 2 half of the Component Plan, Implementation Order, unit-test list and click-throughs) into two ordered deliveries, carries the Phase 2 addendum (R8 to R15), and folds in the Increment 1 Phase 6 hand-offs (F1 to F3, F5). Where this addendum and the original Phase 3 disagree on an Increment 2 item, **this addendum wins**; everything in the original Phase 3 not named here stands.

## Rulings that differ from Phase 1/2 addenda (read first)

### Carried from the Phase 2 addendum (binding; I do not change them)

1. **Predicate home (R9).** `boardApprovalPredicate` (the posted half) and `boardDecisionPredicate` (approved OR rejected) are exported from the new flat module `src/lib/ledger-board-decision.ts`, **born in 2a**, not from `ledger-approval-queries.ts`. The original Phase 3 `PgDialect` shape test moves with it. The importer allow-list for `ledger-approval-queries.ts` is otherwise unchanged (the Approvals page only).
2. **Increment 2 is 2a and 2b (R15).** Same pipeline and work-log, two ordered Phase 4 deliveries, two Phase 5 PASSes. 2a ends with a short analyst confirmation; 2b ends with the closing Phase 6.
3. **2b replaces two Phase 3 banner rows and two Increment 1 behaviours (R15, analyst C3/F5).** The Phase 3 rows "approved by someone else" ("nothing more to do") and "approved by viewer" are replaced; the Increment 1 toast sentence "Only one approval is needed." is replaced; the `approvalFailureAction` branch for an approve-race lost to someone else's approval lands the person on `?txn=<id>`. All four change in **2b only**.
4. **Co-sign fields exist in 2b only.** `DecidedApprovalRow` (approved members) gains `cosigners`, `canCosign`, `viewerHasCosigned` in 2b, as required fields, with no placeholders in 2a. Server-computed; no recorder ids reach the client.
5. **Email sentence.** 2a ships the Phase 3 sentence ("Only one board approval is needed. If a colleague has already acted, the link will show who."); 2b replaces it.

Also carried, restated where used below: table `ledger_txn_cosigns` keyed on the **expense leg** with column `txn_id`, `UNIQUE (txn_id, user_id)`, `user_id` FK `ON DELETE SET NULL`, `txn_id` FK `ON DELETE CASCADE`, **no `kind`, no minute, no withdrawal** (R8); the writer normalises either leg to the expense leg inside the lock (R8); `cosignTransaction()` in its own file `src/lib/ledger-cosign.ts`, with `lockDecisionPair()` extracted to `ledger-board-decision.ts` and taken `FOR SHARE` in id order (R10); `POST /api/admin/ledger/transactions/[id]/cosign`, no body (R11); the importer scan is on the table **identifier** (R12); two migrations (R13).

### Rulings of mine that differ from the Phase 2 addendum or the original Phase 3 (binding on Phase 4)

Each is either a correction found while reading the code or the Increment 1 Phase 6 hand-off. All are inside the absorb rule (no new schema, API or flow beyond what the addenda already authorize) except where noted.

T1. **Increment 1 Phase 6 hand-offs are scheduled, not dropped.** F1 (noun-correct copy), F2 (entity names on pending cards), F3 (thousands separator) and F5.3 / F5.4 / F5.5-link go in **2a**, because 2a already edits `getPendingApprovals()`'s select list, the dialog strings and the page. F5.1 / F5.2 / F5.5-sentence go in **2b**. The analyst's proposed backlog item "the pending-approval email goes to the person who recorded the entry" is **not** in scope (it needs an ID from the orchestrator and its own decision about recipients); nothing in this addendum touches `getEmailsForFeature()`.

T2. **`getRecentDecisions(viewerUserId)` and `deciderIsViewer: boolean`, not `deciderUserId`.** The original Phase 3 gave the row a `deciderUserId` and `getRecentDecisions()` no argument. 2b needs the viewer inside the query (to compute `canCosign` and to mark the viewer's own co-sign), so the argument is introduced in 2a, where it also drives the "You" label. User ids then never appear on any returned object (pinned by a test), which is the Phase 2 R12 rule applied to the History rows from the start, and 2b does not change a signature that 2a shipped.

T3. **One mapper for the History rows and the `?txn=` banner.** The original Phase 3 gave `ApprovalTargetState.decided` a flat copy of the fields. 2b's dialog needs fund, memo, recorder and the minute in the banner too, so the flat copy would have grown into a second mapper. Instead the `decided` state embeds the `DecidedApprovalRow` produced by the **same** private `selectDecided()` the History uses. `DecidedApprovalRow` and `ApprovalTargetState` are **types in the carrier** (`ledger-approval.ts`; types only, no data, no DB import), so the carrier's `buildApprovalBanner` does not import the importer-restricted queries module. `DecidedApprovalRow` is a union on `decision` from 2a (`approved` carries `boardMinute: string`; `rejected` carries `deciderOnFile` and `rejectionReason`), so 2b adds fields to the approved member without reshaping what 2a shipped.

T4. **2b adds `viewerRecorded: boolean`** beside the architect's `canCosign` / `viewerHasCosigned`. The banner row "I recorded it" needs it and the decided state has no other source for it. All three booleans are derived from the **one** `cosignEligibility()` result in the mapper (`canCosign` = ok; `viewerHasCosigned` = reason `already_cosigned`; `viewerRecorded` = reason `recorded_by_you`), never recomputed. The poster is `deciderIsViewer`.

T5. **`describeApprovalConflict(body, noun, verb = "approve")`.** In 2a a row is added for a **rejected-by-the-viewer** 409 ("You already rejected this {noun}."), because the rejector stamp makes `decidedByViewer` real for rejections (Increment 1 always sent `false`). In 2b the suffix "You can add your approval too." is added **only when `verb === "approve"`**; a reject attempt that loses to an approval reads "{Name} already approved this {noun}." and does not navigate (nudging a person who meant to reject toward "approve" is the wrong prompt).

T6. **Card labels are decision-specific from 2a.** Approved cards read "Approved by {P}", rejected cards read "Rejected by {R}" (legacy: "Rejected, decider not on file"), not the original Phase 3's neutral "Decided by". This removes a 2b relabel and matches the analyst's co-sign wording ("Approved by {P} · {date time}", then "Also approved by: ..." in 2b).

T7. **`formatApprovalDollars(cents)` lives in the carrier** (F3). The page-local `formatDollars()` cannot be exported from a Next page file, and the pending cards and History cards must share one formatter. `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`; negative renders `-$2.50`.

T8. **`buildApprovalBanner(state)` takes no `ctx`.** The original Phase 3 signature took `{ amountText }`; with `formatApprovalDollars` in the carrier and the amount on the embedded row, the argument is dead.

T9. **Co-sign uses the explicit server `now`, not the column default.** `cosigned_at` is a naive `timestamp` written from server `new Date()` (like `approved_at`), passed explicitly in the INSERT; the schema keeps `defaultNow()` only as a backstop.

T10. **`lockDecisionPair()` imports `db` as a type only** (`import type { db } from "@/lib/db"` to type the executor, same idiom as `LinkExec` in `ledger-reimbursement-link.ts`). `ledger-board-decision.ts` therefore has **no runtime `db` import**, which keeps the claim in R9 true and is pinned by a source scan.

T11. **Sequencing, not a design change.** 2a's Phase 4 starts **after Increment 1 is committed** by the orchestrator: 2a edits the same uncommitted files (`approvals/page.tsx`, both dialogs, `ledger-approval.ts`, `ledger-approval-decision.ts`, `transactions/route.ts`, `email-compose.ts`), and Concurrent Pipelines rule 6 wants commits split by increment. 2b's api-developer step starts **after 2a's Phase 5 PASS** (shared files: the carrier, the queries module, the page, the dialogs). No second code pipeline is in flight (`2026-10-09-september-admin-session-closing-balance` is a recorded production data correction with no pipeline phases), so the worktree rule (5) is not triggered; if one appears, the implementers run in `isolation: "worktree"` with their own Neon branch and `.env.local` copy.

## Gating (recorded 2026-10-10)

- **2a is not gated.** It contains no multi-approver work and no co-sign data.
- **The no-quorum default.** The orchestrator stated the default to the user on 2026-10-10: the first approval posts the transaction; later approvals are informational co-signs; no quorum. The user has **not objected**. **2b's Phase 4 starts under that default unless the user says "quorum" first.** If the user says "quorum" at any point before 2b ships, **2b reopens at Phase 1** (a quorum changes the pending state, the email, the threshold semantics and the lock rules, Phase 1 addendum). Practical consequence recorded here because migrations replay on every deploy with no tracking table: **the 2b migration file is not pushed until 2b passes Phase 5**, so a "quorum" answer arriving before then is handled by deleting unpushed files (the schema block, the migration, `ledger-cosign.ts`, the route, the dialog), not by a compensating migration.
- At the start of 2b's database-admin step the orchestrator re-reads "User decisions" for any later entry and records "no quorum objection as of <time>" there.
- **Q8 (no way to record dissent on a posted approval)** is still with the user. **B-160 stays unfiled (held).** B-161 is released.

## What this addendum supersedes in the original Phase 3

| Original Phase 3 section | Disposition |
|---|---|
| API Contract: "Transfer / Sweep create returns the expense-leg id (Increment 2)", "Email builder" Increment 2 sentence | **2a**, unchanged except the 2b sentence replacement |
| API Contract: "Recently decided and the deep link (Increment 2)" | **2a**, re-cut by T2/T3 and R9 (predicate relocated); 2b adds the second query and fields |
| "Banner wording per state" | **2a** as written; **2b replaces** the two approved rows |
| "`safeCallbackPath()` contract" | **2a**, unchanged |
| Data Model: Increment 2 columns | **2a**, unchanged (migration number re-derived) |
| Component Plan: Increment 2 | **2a** (below) plus **2b** (below) |
| Implementation Order: Increment 2 | replaced by the two orders below |
| Unit tests: Increment 2 | re-cut into the two lists below |
| Phase 5 click-throughs: Increment 2 | re-cut into the two lists below |
| Edge cases, Out of scope | stand; additions below |
| Release-notes draft, Increment 2 | replaced by the two drafts below |

## Permissions (both increments)

- **No new `FEATURES` key, no role-binding migration, no `ADMIN_NAVIGATION` change**, so the DECISION-082 derived proxy rule is unchanged and no nav entry's permission widens. Everything stays under existing **`ledger.approve`** (`admin`, `board_member`; the treasurer only through Board-group membership, DECISION-115). **Do not bind `ledger.approve` to `treasurer`** (governance, not a side effect).
- The page keeps `auth()` + `hasFeature(LEDGER_APPROVE)` before any lookup; `?tab=` and `?txn=` are read **after** that gate; the History and co-sign queries run only after it. `admin-page-feature-gates.test.ts` is unchanged.
- **2b route:** `POST /api/admin/ledger/transactions/[id]/cosign` gates on `auth()` (401) then `hasFeature(session.user.features, FEATURES.LEDGER_APPROVE)` (403, **no `code`**), as the first two statements, exactly like approve and reject. `/api/*` is outside the proxy's page gating, so the handler's gate is the gate.
- **Nothing widens `ledger.view`.** Decider names, minutes, decision times and co-signer names come only from `ledger-approval-queries.ts` (page-only importer) and `ledger-cosign.ts` (route-only importer); the table identifier is scanned (2b). The rejection reason was already on the register for `ledger.view` (Phase 2 R3).
- **Role-escalation check:** nothing near `admin.users` / `admin.roles`; `treasurer` gains nothing; a co-sign confers nothing and nothing reads it as a grant.

---

## Increment 2a: reject attribution, Recently decided, deep link, callback guard, email link

### 2a API contract

#### A1. Reject stamps both legs; the reject 409 names the rejector (`src/lib/ledger-approval-decision.ts`)

Edits to the shipped helper (F5.3):

- Reject `stamps` become `{ status: "rejected", rejectionReason, rejectedByUserId: actorUserId, rejectedAt: now, updatedAt: now }`, in the **same** pinned UPDATE across both locked ids. `approvedAt` and `approvedByUserId` are never written for a rejection.
- `DecisionRow` (the `Pick`) gains `rejectedByUserId | rejectedAt`.
- `conflictFromRow()`: in the rejected branch `decidedAt = toIso(row.rejectedAt ?? row.updatedAt)` and `decidedByViewer = row.rejectedByUserId !== null && row.rejectedByUserId === viewerId`. The approved branch is unchanged.
- `lookupApproverName()` becomes `lookupDeciderName()`: for `posted` + `approvedAt`, the `approvedByUserId`; for `rejected`, the `rejectedByUserId`; anything else (or a null id) returns `null`. Still a separate `users` select, **not** a LEFT JOIN (Postgres rejects `FOR UPDATE` on the nullable side of an outer join, Increment 1 api-developer deviation 1). Still passed through `displayDeciderName()`.
- The reject-409 error strings and `code: "not_pending"` are unchanged. `ApprovalConflictBody` is unchanged (no widening, so the carrier contract and `tsc` consumers are untouched).

#### A2. Carrier additions (`src/lib/ledger-approval.ts`, still client-safe, no imports beyond types)

```ts
export const RECENT_DECISIONS_LIMIT = 25;
export const APPROVAL_TABS = ["pending", "decided"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];
export function parseApprovalTab(raw: string | string[] | undefined): ApprovalTab;   // whitelist; arrays and unknowns -> "pending"
export function formatDecisionDateTime(when: Date | string): string;                // "Oct 10, 2026 at 3:42 PM", timeZone "America/New_York"
export function formatApprovalDollars(cents: number): string;                        // T7
export function approvalNounLabel(kind: ApprovalKind): "Disbursement" | "Transfer" | "Sweep";   // F1
export function describePendingCount(count: number): string;                         // F1: "1 item awaiting approval" / "3 items awaiting approval"
// describeApprovalFund gains two OPTIONAL inputs (F2): entityName?: string | null; partnerEntityName?: string | null.
//   sweep text becomes "Charitable Fund (Foundation) → Activity Fund (Club)" when both names are present, unchanged when absent.

interface DecidedBase {
  id: string;                    // EXPENSE-leg id: row key, data-row-id, deep-link target
  kind: ApprovalKind;
  decidedAt: string;             // ISO; coalesce(approved_at, rejected_at, updated_at)
  deciderName: string | null;    // displayDeciderName(); null = unnamed
  deciderIsViewer: boolean;
  amountCents: number; txnDate: string; party: string | null; memo: string | null;
  fundName: string | null; partnerFundName: string | null;
  entityId: string; partnerEntityId: string | null;
  entityName: string | null; partnerEntityName: string | null;
  recorderName: string | null;
}
export type DecidedApprovalRow =
  | (DecidedBase & { decision: "approved"; boardMinute: string })
  | (DecidedBase & { decision: "rejected"; deciderOnFile: boolean; rejectionReason: string | null });

export type ApprovalTargetState =
  | { state: "not_found" }
  | { state: "pending"; rowId: string; kind: ApprovalKind; isOwn: boolean }
  | { state: "decided"; row: DecidedApprovalRow }
  | { state: "not_board_decision"; kind: ApprovalKind };

export interface ApprovalBannerModel { tone: "info" | "success" | "neutral"; text: string; linkHref?: string; linkLabel?: string }
export function buildApprovalBanner(state: ApprovalTargetState): ApprovalBannerModel;   // T8
```
- `describeApprovalConflict` gains the T5 row: `rejected` + `decidedByViewer` -> "You already rejected this {noun}." (the 2a toast table is otherwise the Increment 1 table, **including** "Only one approval is needed." which 2b removes).
- `decidedAt`/`txnDate` are strings, so the carrier stays free of `Date` handling surprises across the server/client line.
- `buildApprovalBanner` is exhaustive over `state` and, inside `decided`, over `row.decision` (a `never` check; a new member breaks `tsc`).

#### A3. `src/lib/ledger-board-decision.ts` (new, flat, server-side, no runtime `db` import, not importer-restricted)

```ts
export function boardApprovalPredicate(t?: typeof ledgerTransactions): SQL;  // flow = 'expense' AND <posted half>
export function boardDecisionPredicate(t?: typeof ledgerTransactions): SQL;  // flow = 'expense' AND (status = 'rejected' OR <posted half>)
// private: postedBoardHalf(t) = status = 'posted' AND approved_at IS NOT NULL AND board_minute IS NOT NULL AND NOT paidReimbursementExists(t.id)
```
- **One definition of the stamp test.** Both exports are built from the single private `postedBoardHalf()`, so `approved_at`, `board_minute` and the `paidReimbursementExists(` call each appear **once** in the file. The semantics are DECISION-116 item 1 unchanged: keyed on `approved_at`, never on `approved_by_user_id`; an under-threshold Sweep (creation-time minute, no `approved_at`) is excluded.
- `paidReimbursementExists(txnId: AnyColumn | SQL)` is imported from `ledger-reimbursement-link.ts` (existing).
- `lockDecisionPair` is **2b** (below). 2a ships only the two predicates.

#### A4. `src/lib/ledger-approval-queries.ts` (new; DB-importing; **approver-only**; imported only by `approvals/page.tsx`)

```ts
export async function getRecentDecisions(viewerUserId: string): Promise<DecidedApprovalRow[]>;
export async function resolveApprovalTarget(rawTxn: string, viewerUserId: string): Promise<ApprovalTargetState>;
// private, shared by both: selectDecided({ where, viewerUserId, orderLimit })
```
- **`selectDecided`** is the one SELECT and the one row mapper. `FROM ledger_transactions t` LEFT JOIN `ledger_funds f`, `ledger_entities e`, a self-join `dest` on `dest.transfer_group_id = t.transfer_group_id AND dest.flow = 'income'` with `dest_fund` and `partner_entity` (for `partnerEntityName`), `recorder` (users on `t.recorded_by_user_id`), and `decider` (users on `CASE WHEN t.status = 'rejected' THEN t.rejected_by_user_id ELSE t.approved_by_user_id END`). LEFT JOINs are fine here: nothing is locked. `deciderOnFile` for a rejection is `t.rejected_at IS NOT NULL`. `decidedAt` is `coalesce(t.approved_at, t.rejected_at, t.updated_at)`. Names pass through `displayDeciderName()` (an email-shaped name becomes `null`).
- **History:** `where = boardDecisionPredicate(ledgerTransactions)` (the `flow = 'expense'` clause is inside it, so `LIMIT` counts decisions, not legs), `ORDER BY coalesce(...) DESC, t.id DESC`, `LIMIT RECENT_DECISIONS_LIMIT`. No entity filter, no pagination. Failure **throws** (the page catches it and shows the existing-style "Could not load recent decisions" card; Pending is never blanked).
- **Resolver (`rawTxn`):** `isUuid()` first; a failure returns `{ state: "not_found" }` **without touching the database** and never echoes the input. Step 1, one classification query: the row whose `id = $x`, or the row sharing `transfer_group_id` with it, `ORDER BY t.flow = 'expense' DESC LIMIT 1`, selecting `id`, `flow`, `status`, `boardDecisionPredicate(t)` **as a boolean**, and `viewer_recorded` = EXISTS over either leg with `recorded_by_user_id = viewer`. No row -> `not_found`. A chosen row with `flow <> 'expense'` -> `not_board_decision`. `status = 'pending'` -> `pending` (`isOwn = viewer_recorded`). Predicate true -> step 2: `selectDecided` for that one id -> `decided`. Otherwise (posted without a board decision) -> `not_board_decision`. The predicate is evaluated in SQL as a selected boolean so the resolver, the History and (2b) the co-sign can never disagree.
- `kind` is derived by `describeApprovalFund()` (sweep when the partner's entity differs; transfer when a partner exists in the same entity; else disbursement).
- **Module header** states the visibility rule (approver-only; not importable from member surfaces, the register, search, overview or reports) and that user ids never leave the module.
- **No user id on any returned object** (pinned by a test that walks the returned keys).

#### A5. Banner wording (2a)

The Phase 3 table "Banner wording per state" **stands verbatim**, with these precisions only:
- Rows are produced by `buildApprovalBanner(state)`; the amount is `formatApprovalDollars(row.amountCents)`; dates are `formatDecisionDateTime(row.decidedAt)`; "You" replaces `{Name}` when `row.deciderIsViewer`; a rejection with `deciderOnFile === false` omits the "who" clause.
- `linkHref` for `decided` is `/admin/ledger/approvals?tab=decided&txn=<row.id>`, `linkLabel` "See it under Recently decided". Tab links drop `txn` (that is how a person dismisses the banner).
- `{noun}` is `row.kind`; `{to}` is " to {party}" only for a disbursement with a payee. `party`, `reason` and `deciderName` render as React text, never HTML.
- **The two approved rows keep the 2a wording** ("Already approved. {Name} approved this ... Only one approval is needed, so there is nothing more to do." and "You approved this ...") and are replaced in 2b.

#### A6. `safeCallbackPath()` and its three consumers

Contract, algorithm and call-site table: **the original Phase 3 section "`safeCallbackPath()` contract (Increment 2)" stands unchanged** (zero imports; same-origin absolute accepted only when the caller passes `origin`; `new URL` normalisation re-checked for a single leading `/`; the `/..//evil.example` and `/.//evil.example` cases). Summary of edits:
- `src/proxy.ts` line 37: `signInUrl.searchParams.set("callbackUrl", safeCallbackPath(request.nextUrl.pathname + request.nextUrl.search, { origin: request.nextUrl.origin }))`. **`pathname + search`**, so `?txn=` survives.
- `src/app/signin/page.tsx`: remove the render-time `searchParams.get("callbackUrl") || "/members"` (line 28); add `getCallback()` called **inside** the credentials submit handler (replacing `router.push(callbackUrl)`, line 47) and the Google click handler (replacing `signIn("google", { callbackUrl })`, line 61), passing `{ origin: window.location.origin }`. Event-time, never render-time.
- `src/app/register/page.tsx`: same `getCallback()` for the Google `signIn` (line 114). The page's `router.push("/signin")` that drops the callback is B-155, not this increment.
- **No fourth consumer.** The source-scan test fails the build if one appears.

#### A7. Transfer / Sweep create returns the expense-leg id

Carried from the original Phase 3 unchanged: the two-row insert gains `.returning({ id, flow })`; the 201 body gains `id` = the `flow = 'expense'` leg's id (`{ id, transferGroupId, derivedFiscalYear, status }`). If `id` is absent the email falls back to the plain Approvals URL and the send still happens.

#### A8. Email link and sentence (`src/lib/email-compose.ts`, `transactions/route.ts`)

- Both E-1 call sites pass ``reviewUrl: `${getAppUrl()}/admin/ledger/approvals?txn=${id}` `` (ordinary expense: the inserted row's `id`; Transfer/Sweep: the expense leg's `id`). `reviewUrl` is **not** HTML-escaped (escaping `&` would corrupt it; it contains only a UUID and fixed text).
- `buildPendingApprovalEmailHtml()` appends, **unconditionally**, the Phase 3 sentence: "Only one board approval is needed. If a colleague has already acted, the link will show who." (no flag; it cannot ship ahead of the banner because both are 2a).
- Both blocks keep their `try/catch` (with the orchestrator's `console.error`) and the builder call stays the first statement in the `try` after the recipient lookup. Not a durable-claim path (no `sentAt`, no success row, no append-only "sent" history; DECISION-102/103 do not apply). `sendBulkMemberEmail()` is kept; the deny-by-default guard is unchanged.
- Queue view: `redactQueuedEmailHtml()` leaves `?txn=<uuid>` readable. Basis (cited, as in DECISION-116): `LONG_HEX_RUN` needs 32 contiguous hex characters and a UUID is hyphen-broken; `CREDENTIAL_QUERY_VALUE` matches only parameter names containing token, key, secret, code, pass, pwd, auth, sig or session, and `txn` contains none. Pinned by a test, observed by L3.

#### A9. Increment 1 Phase 6 copy and formatting (F1 to F3, F5.4)

All under the absorb rule (wording and one select-list field; no new API):
- **F1 noun-correct copy.** New pure helpers in `approval-dialog-logic.ts`: `approvalDialogTitle(verb, noun)` ("Approve Sweep"), `approvalSuccessMessage(verb, noun)` ("Sweep approved."), `rejectPlaceholder(noun)`, `minuteHelper(noun)` ("...that authorized this transfer."), plus the existing `Could not {verb} {noun}` fallback and the `toast.error("A board-minute reference is required to approve a {noun}.")` in `approve-dialog.tsx`. Both dialogs call them with their existing `noun` prop. The count line uses `describePendingCount(n)` ("3 items awaiting approval": the list mixes kinds). The page's description and empty-state sub-line keep the word "disbursement" where it is accurate for the threshold rule; only the strings F1 names change.
- **F2 entity names.** `getPendingApprovals()` (`ledger-queries.ts`) gains `entityName` and `partnerEntityName` on `PendingApprovalRow`, resolved from one small `ledger_entities` select into a `Map` (two entities; no extra join per row), and **also** gains `rejectedByUserId`, `rejectedAt` in its hand-enumerated select list (type fallout from the new columns). `ApprovalFundLabel` passes the names to `describeApprovalFund` and shows the entity name as small secondary text for non-sweep kinds (a cross-entity money movement approved on a phone is where "which book" matters most).
- **F3.** The page-local `formatDollars()` is deleted; the page, cards and History use `formatApprovalDollars`.
- **F5.4.** `h1` becomes "Approvals"; the Pending empty state gains the secondary-style link-button "See recently decided" (`?tab=decided`, `rounded-lg border-2 border-lions-blue`). The footer line ("Once approved, they are locked") and the pending-tab description stay.

### 2a Data model

`src/lib/db/schema.ts` first, after `rejectionReason` on `ledgerTransactions`:
```ts
rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
rejectedAt: timestamp("rejected_at"),
```
Migration: **`drizzle/migrations/NNNN_ledger_rejection_attribution.sql`**, body exactly as the original Phase 3 "Data Model" block (two `ADD COLUMN IF NOT EXISTS`, then the guarded `DO $$` adding `ledger_transactions_rejected_by_user_id_users_id_fk`, `ON DELETE SET NULL`). **`NNNN` is a placeholder** (`0111` is a guess; newest today is `0110_treasurer_permission_baseline.sql`): database-admin re-derives it with `ls drizzle/migrations | sort | tail -3` at the start of its step, and the file is not added to the shared tree until the schema step is complete (Concurrent Pipelines rule 2). No index, no back-fill (0 rejected rows in production on 2026-10-10), no `NOT NULL`, no default. Rejected rows are immutable (PATCH 403s `status = 'rejected'`), so the columns never need clearing. database-admin runs `pnpm db:migrate` **twice** and confirms `drizzle-kit push` reports no diff, and records both in the work-log. The orchestrator announces the dev-server restart.

### 2a Component / page plan

Create (flat in `src/components/admin/ledger/`, no new subdirectory): `approval-history.tsx` (Server), `approval-banner.tsx` (Server; renders `ApprovalBannerModel`), `approval-tabs.tsx` (Server, `<Link>`s). Create in `src/lib/`: `ledger-board-decision.ts`, `ledger-approval-queries.ts`, `safe-callback-path.ts`. Create `src/proxy.test.ts`.

Modify: `schema.ts`; `ledger-approval.ts`; `ledger-approval-decision.ts`; `ledger-queries.ts` (`getPendingApprovals`); `approvals/page.tsx`; `approve-dialog.tsx`, `reject-dialog.tsx` (`RejectTransactionDialog` only), `approval-dialog-logic.ts` (F1 helpers); `approval-fund-label.tsx` (F2); `row-highlighter.tsx` (`persistent`); `transactions/route.ts`; `email-compose.ts`; `src/proxy.ts`; `signin/page.tsx`; `register/page.tsx`.

**Page (Server Component).** Carried from the original Phase 3 "Page" paragraph with T2: `searchParams: Promise<{ tab?: string; txn?: string }>`; order `auth()` -> `hasFeature(LEDGER_APPROVE)` (else the existing redirect) -> `parseApprovalTab` -> `Promise.all([getPendingApprovals(), getSettings()])` -> if `txn` present, `resolveApprovalTarget(txn, userId)` in its own `try/catch` (failure logs, renders no banner) -> if `tab === "decided"`, `getRecentDecisions(userId)` in its own `try/catch` setting `historyFailed`. The History fetch runs **only on the decided tab**; neither failure can blank Pending. Tabs "Pending ({n})" / "Recently decided", `<Link>`s with focus rings, no client state. The banner is a `role="status"` region above the tabs on both tabs.

**History list (`approval-history.tsx`, one tree, no table).** One `rounded-2xl bg-white shadow-sm` card per row with `data-row-id={row.id}`, stacked at every width: decision badge (Approved green, Rejected gray, `rounded-lg`), decision date/time (America/New_York), amount (`formatApprovalDollars`), payee and memo, `ApprovalFundLabel` (entity names included), "Recorded by", the T6 label ("Approved by {P}" / "Rejected by {R}"; `"You"` when `deciderIsViewer`; "a board member" for an approved row with no name or a rejection with `deciderOnFile`; "Rejected, decider not on file" for a legacy rejection), then the full minute citation (approved) or rejection reason (rejected) in `break-words whitespace-pre-wrap`, never a `title` tooltip. Footnote "Showing the 25 most recent decisions. For older entries, use the Ledger register or search." (links to `/admin/ledger` and the ledger search). Empty: "No disbursements have been approved or rejected yet." in `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`. Failure: "Could not load recent decisions. Try again in a moment." in the same card with a `?tab=decided` link.

**Highlight.** The page passes `highlightId` (resolver `rowId` for pending; `row.id` for decided) to the list that is showing it (pending cards/table on the pending tab; History on the decided tab when the row is among the 25). The target is server-rendered `ring-2 ring-lions-gold bg-lions-gold/10 scroll-mt-24 focus:outline-none` with `tabIndex={-1}`. `<Suspense fallback={null}><RowHighlighter targetId={highlightId} idPrefix="txn-" persistent /></Suspense>`: with `persistent` the component resolves the **first visible** `[data-row-id="<id>"]` (`getClientRects().length > 0`), only scrolls and focuses, and does **not** add or remove ring classes and does **not** `router.replace` (the original Phase 3 ruling 2; default mode and its two existing call sites are unchanged).

### 2a Implementation order and implementers

0. **Orchestrator:** commit Increment 1 first (T11). Re-derive migration numbers at the start of the schema step.
1. **database-admin.** `schema.ts` columns + the idempotent migration + `src/lib/ledger-approval-schema.test.ts` (below). Both replays recorded. Orchestrator announces the dev-server restart.
2. **api-developer**, in this order (each ends with `pnpm exec tsc --noEmit` and the named tests green): (a) carrier additions + tests (A2, T5, T7, A9 helpers); (b) `ledger-board-decision.ts` + tests; (c) the reject stamp, `conflictFromRow`, `lookupDeciderName` + tests; (d) `getPendingApprovals()` select list and entity names + tests; (e) `ledger-approval-queries.ts` + tests; (f) `safe-callback-path.ts`, `src/proxy.ts`, `src/proxy.test.ts`, the signin/register consumers + the scan; (g) `transactions/route.ts` (`id`, `reviewUrl`), the builder sentence, route and email tests, the redactor test. Gate: tsc clean, `pnpm test` green, no `console.log`, auth + `hasFeature` still first in every touched route.
3. **ux-developer.** Page (tabs, banner, History, empty states, `h1`), `RowHighlighter` `persistent` + its test, F1 string wiring through the new dialog-logic helpers, `ApprovalFundLabel` entity names, `approval-history.test.tsx`. Gate: tsc, `pnpm test`, `pnpm build:only`, no native dialogs, brand rules (`rounded-2xl` cards, `rounded-lg` buttons, `lions-gold` ring not border, focus ring on every control, 44px targets).
4. **qa** (full Phase 5, its own PASS).
5. **analyst:** short confirmation (not the pipeline-closing Phase 6).

Not `full-stack-developer`: well over 150 lines across schema, API and UI.

### 2a Unit tests, by name and file (the implementers deliver these; qa does not)

`src/lib/ledger-approval-schema.test.ts` (new; model: `ledger-ack-donee-migration.test.ts`, which uses `getTableConfig`)
- the rejection migration adds both columns with `ADD COLUMN IF NOT EXISTS` and adds the FK only inside a `pg_constraint` guard;
- the FK name in the SQL equals the name drizzle derives for `rejected_by_user_id` (`getTableConfig(ledgerTransactions).foreignKeys`), is `ON DELETE SET NULL`, and the column is nullable; the SQL has no `NOT NULL`, no `DEFAULT`, no `UPDATE`.

`src/lib/ledger-board-decision.test.ts` (new)
- `boardDecisionPredicate` rendered through `PgDialect` contains `flow = 'expense'`, the rejected branch, `status = 'posted'`, `"approved_at" is not null`, `"board_minute" is not null`, and a `not exists` over `ledger_reimbursements` with `status = 'paid'`, and does **not** contain `approved_by_user_id`;
- `boardApprovalPredicate` contains the same posted half plus `flow = 'expense'` and does **not** contain the rejected branch;
- single definition: in the file text `approved_at`, `board_minute` and `paidReimbursementExists(` each appear once outside comments;
- **source scan (R9):** `paidReimbursementExists(` is absent from `ledger-approval-queries.ts`; `ledger-approval-queries.ts` contains `boardDecisionPredicate(`; (2b adds the `ledger-cosign.ts` assertions);
- no runtime `@/lib/db` import in the file (a `import type` is allowed) (T10).

`src/lib/ledger-approval-decision.test.ts` (extended)
- reject: the single UPDATE `.set` carries `rejectedByUserId` = actor and `rejectedAt` = `now` for **both** legs of a pair and never `approvedAt` / `approvedByUserId`;
- `conflictFromRow`, rejected with stamp: `decidedAt` is `rejectedAt`, `decidedByViewer` is true for the rejector, false for another; rejected with null stamp falls back to `updatedAt` with a null name; an email-shaped rejector name returns `deciderName: null`;
- `lookupDeciderName` selects the rejector's id for a rejected row and the approver's for a posted row, and issues no select for a pending row or a null id;
- reject-vs-approve race: the loser (an approver) gets a 409 whose `deciderName` is the rejector, no longer `null`. **The Increment 1 assertion `rejected: deciderName null / decidedAt = updatedAt` changes** to the stamped expectation (expected, listed so the implementer does not treat it as a regression).

`src/lib/ledger-approval.test.ts` (extended): `formatDecisionDateTime` (a UTC instant that is the previous evening in New York renders the Eastern date; one case each side of a DST change); `parseApprovalTab` (`"decided"`, `"pending"`, `"bogus"`, `undefined`, `["decided"]`); `formatApprovalDollars` (2275 -> "$22.75" and 227500 -> "$2,275.00", 123456700 -> "$1,234,567.00", 0 -> "$0.00", 5 -> "$0.05", -250 -> "-$2.50"); `approvalNounLabel`; `describePendingCount` (1 and 3); `describeApprovalFund` with and without entity names (sweep text carries both entity names; absent names leave the Increment 1 text byte-identical); `describeApprovalConflict` rejected + `decidedByViewer` -> "You already rejected ..."; `buildApprovalBanner` for **every** row of the Phase 3 banner table (pending own / not own, approved by other / by viewer, rejected by other / by viewer / legacy, not a board decision, not found) including transfer and sweep wording and the `linkHref`; no output contains "@".

`src/lib/ledger-approval-queries.test.ts` (new)
- **importer allow-list (source scan):** the only non-test importer of `ledger-approval-queries` under `src` is `src/app/(dashboard)/admin/ledger/approvals/page.tsx`; nothing under `src/app/members/**`, `src/app/api/members/**`, the Ledger overview, register, search or reports imports it (precedent: the member-surface guard in `ledger-audit.test.ts`);
- history query: `boardDecisionPredicate` in the WHERE, ordered by the coalesce expression then `id` descending, limited to `RECENT_DECISIONS_LIMIT`, no entity filter;
- row mapping: approved with a null decider name is `deciderName: null`; rejected with null `rejected_at` is `deciderOnFile: false` and falls back to `updated_at`; a name containing "@" is dropped; `deciderIsViewer` true only for the viewer; the walked keys of every returned row contain no `*UserId`; Transfer/Sweep is one row;
- `resolveApprovalTarget`: a non-UUID (`"not-a-uuid"`, `"1; drop table x"`, a 5,000-character string) returns `not_found` **without calling the database** and never echoes the input; each state is produced from a mocked row (pending, pending-own including a viewer who recorded only the income leg, decided approved by other / by viewer, rejected by other / by viewer / legacy, income-leg id resolving to its pair, lone income row -> `not_board_decision`, posted-no-decision, unknown id); the `decided` state's row is the same shape `getRecentDecisions` returns;
- a failing history query rejects (throws).

`src/lib/ledger-queries.test.ts` (extended, `getPendingApprovals`): rows carry `entityName` and `partnerEntityName`; a Sweep resolves the partner entity's name; the select list includes `rejectedByUserId` and `rejectedAt`.

`src/lib/safe-callback-path.test.ts` (new, table test): carried verbatim from the original Phase 3 (passes unchanged; falls back to `/members`; `origin` cases; `fallback` honoured; the source scan for raw `callbackUrl` consumers).

`src/proxy.test.ts` (new; mocks `@/lib/auth`): carried verbatim (signed-out `/admin/ledger/approvals?txn=<uuid>` redirects to `/signin` whose `callbackUrl` decodes to exactly the path with its query; no stray `?`; the other redirects unchanged).

`src/app/api/admin/ledger/transactions/route.test.ts` (extended): the Transfer/Sweep 201 carries `id` (the expense leg) **and** still `transferGroupId`, `derivedFiscalYear`, `status`; the ordinary and Transfer/Sweep emails' `href` ends `?txn=<id>`; the email contains the 2a sentence; if the insert returns no expense row the link is the plain Approvals URL and the send still happens.

`src/lib/email-compose.test.ts` (extended): the builder appends the 2a sentence unconditionally and uses `reviewUrl` verbatim as the `href`.

`src/lib/email-queue-view.test.ts` (extended): `redactQueuedEmailHtml('<a href="https://x/admin/ledger/approvals?txn=00000000-0000-4000-8000-000000000001">')` leaves the UUID readable.

`src/components/admin/ledger/approval-dialog-logic.test.ts` (extended): `approvalDialogTitle`, `approvalSuccessMessage`, `rejectPlaceholder`, `minuteHelper` for each of the three nouns and both verbs, none containing the word "disbursement" for a transfer or sweep.

`src/components/admin/ledger/row-highlighter.test.tsx` (extend or add): default mode still adds then removes the ring classes and strips `highlight`; `persistent` mode calls neither a `classList` mutation nor `router.replace`, and selects the visible match when two `[data-row-id]` elements exist.

`src/components/admin/ledger/approval-history.test.tsx` (new, server render): badge and T6 label per decision; "You" for the viewer; legacy rejection reads "decider not on file"; the minute and reason render in full; entity names appear; empty and failure states; every card carries `data-row-id` and no `id`.

### 2a qa click-throughs (Phase 5)

Environment: dev server owned by the orchestrator; dev email only to the tester's own address in `EMAIL_DEV_ALLOWLIST` (verify queued rows are `blocked_non_production` for anyone else); a **board-only** user and a recorder (the e2e admin); seeds tagged and cleaned; the ledger e2e suite is serial. `e2e/ledger-approvals-history.spec.ts`.
1. **Discriminator fixtures, real Postgres:** a paid-reimbursement-linked posted row stamped by the treasurer (must **not** appear), an under-threshold Sweep with a creation-time minute and no `approved_at` (must not appear), an approved row whose approver account is deleted (appears, "a board member"), a legacy rejected row with null stamp (appears, "decider not on file", dated by `updated_at`), a Transfer pair (one row), and 26 decisions (exactly 25, newest first, equal timestamps in stable `id` order).
2. **Tabs:** `?tab=bogus` falls to Pending; the decided tab shows decision, who, when (Eastern), the full minute or reason; Pending still renders when the history query is forced to fail; the Pending empty state offers "See recently decided"; `h1` reads "Approvals".
3. **`?txn=` states,** one fixture each: pending not-own (highlight, scrolled, focused, **ring survives past 3 seconds**), pending own, approved by other, approved by viewer (also after approving from the card: the banner survives `router.refresh()`), rejected by other, rejected by viewer, either leg of a Transfer and of a Sweep, a reimbursement-paid row, a deleted id, `?txn=not-a-uuid`, `?txn='; select 1`, a 5,000-character `txn`: no 500, nothing echoed; `ledger.approve`-less users still redirect to `/admin/ledger` with no information.
4. **Signed-out deep link, password:** GET `/admin/ledger/approvals?txn=<id>` signed out; the `/signin` URL carries `callbackUrl=%2Fadmin%2Fledger%2Fapprovals%3Ftxn%3D<id>`; sign in; land on the page with the banner. **Google:** manual with the real test Google account (L4). Open-redirect checks: `/signin?callbackUrl=https://evil.example`, `//evil.example`, `/\evil.example` each land on `/members` after a password sign-in; the same on `/register`.
5. **Reject end to end (L5):** both legs of a Sweep get `rejected_by_user_id` and `rejected_at` (DB assert), the History shows one "Rejected by {name}" row with the reason in full; a second reject attempt by the same user (double-click) answers 409 whose toast reads "You already rejected this sweep."; record `n/n`.
6. **Email:** the queued ordinary, Transfer and Sweep rows contain `?txn=<expense-leg id>` and the 2a sentence; the queue view shows the UUID un-redacted (L3).
7. **F1 to F3:** a Transfer and a Sweep dialog show "Approve Transfer" / "Approve Sweep", the success toast and placeholder use the right noun; a Sweep card shows both entity names; a $2,275.00 disbursement shows "$2,275.00" on the card, the table and the History.
8. **Post-deploy (Phase 6 of the pipeline, orchestrator reads only, counts):** the Recently decided row count equals the Verify-First `board_approved_rows + rejected_expense_legs` at that time (1 + 0 on 2026-10-10) (L2).
9. 360px, 390px, 1024, 1279, 1280: banner and History cards fit with no horizontal scroll; selectors scoped to the visible variant; the Next dev "1 Issue" panel is not a hydration warning from this page.

---

## Increment 2b: add your approval (informational co-sign)

*Starts only under the gating note above. Additive on 2a: nothing here reshapes a 2a type.*

### 2b API contract

#### B1. Carrier additions (`src/lib/ledger-approval.ts`)

```ts
export type CosignIneligibleReason = "recorded_by_you" | "already_approved" | "already_cosigned";

/** THE eligibility rule; the route (cosign-eligibility inside cosignTransaction) and the queries module both call it. */
export function cosignEligibility(input: {
  viewerId: string;
  recorderIds: readonly (string | null)[];     // recorded_by_user_id of BOTH legs (one entry for a non-pair row)
  approvedByUserId: string | null;             // null = the posting approver's account was deleted
  cosignerUserIds: readonly (string | null)[]; // existing co-signers (null = deleted account)
}): { ok: true } | { ok: false; reason: CosignIneligibleReason };
// Order of checks: recorded_by_you, then already_approved, then already_cosigned. A null id NEVER equals the viewer.

export type CosignConflictCode =
  | "not_approved" | "rejected" | "not_board_decision" | "already_approved" | "already_cosigned";
export interface CosignConflictBody {
  error: string;                 // English, a toast fallback only; the UI branches on `code`
  code: CosignConflictCode;
  at: string | null;             // ISO: rejected -> rejection time (rejected_at ?? updated_at); already_approved -> approved_at;
                                 //      already_cosigned -> the viewer's existing cosigned_at; otherwise null
  deciderName: string | null;    // rejected only: the rejector via displayDeciderName(); otherwise null. NEVER an email.
}
export interface CosignForbiddenBody { error: string; code: "recorded_by_you" }   // the permission 403 has NO code
export interface CosignCreatedBody { id: string; cosignedAt: string }              // 201; id = the EXPENSE leg's id
export function isCosignConflict(body: unknown): body is CosignConflictBody;       // code in the five-member set AND string error
export function isCosignForbidden(body: unknown): body is CosignForbiddenBody;     // code === "recorded_by_you"

export interface CosignerView { name: string | null; cosignedAt: string; isViewer: boolean }
export function formatApproverList(
  entries: readonly { name: string | null; isViewer: boolean }[],
  opts?: { max?: number },                       // banner passes 3; the History card passes nothing (all)
): { text: string; hiddenCount: number };

// DecidedApprovalRow, approved member only, REQUIRED fields (no 2a placeholders):
//   cosigners: CosignerView[];  canCosign: boolean;  viewerHasCosigned: boolean;  viewerRecorded: boolean;   // T4
// ApprovalBannerModel gains:   action?: "cosign"
// describeApprovalConflict gains:  verb: "approve" | "reject" = "approve"                                    // T5
```
`formatApproverList` rule (pinned by tests): take the first `max` **persons** in time order; named persons render by name, the viewer as "You"; unnamed persons collapse to one trailing item, "a board member" (1) or "N other board members" (N>1; "N board members" when no one is named); join as "A", "A and B", "A, B and C" (no Oxford comma); persons beyond `max` become `hiddenCount` and the banner appends "and {hiddenCount} others". The text never contains an email address, a fraction of the board ("of 14") or the word "votes".

#### B2. `lockDecisionPair()` (`src/lib/ledger-board-decision.ts`), extracted from `decideTransaction()` **without changing its behaviour**

```ts
export type PairLockMode = "update" | "share";
type LockExecutor = Pick<typeof db, "select">;                // `import type { db }` only (T10)
export async function lockDecisionPair(tx: LockExecutor, id: string, mode: PairLockMode): Promise<LedgerTransaction[]>;
```
It is the existing single statement, moved verbatim: `SELECT * FROM ledger_transactions WHERE id = $id OR transfer_group_id = (SELECT transfer_group_id FROM ledger_transactions WHERE id = $id) ORDER BY id FOR UPDATE|SHARE` (for a non-pair row the subselect is NULL and `transfer_group_id = NULL` matches nothing, so the set is just the target). `decideTransaction()` calls it with `"update"` in place of its inline statement; **nothing else in that file changes in 2b.** Proof of "no behaviour change": every assertion in `ledger-approval-decision.test.ts` (which already asserts `.for("update")` and the `ORDER BY`) passes **unedited**. If one must be edited, that is a behaviour change and goes back to me. (Two callers of a subtle statement, extracted at the moment the second caller appears; about 15 lines move.)

#### B3. `cosignTransaction()` (`src/lib/ledger-cosign.ts`, new, server-only, imports `db`; imported only by the cosign route)

```ts
export type CosignResult =
  | { ok: true; id: string; cosignedAt: Date }
  | { ok: false; status: 403; body: CosignForbiddenBody }
  | { ok: false; status: 404; body: ApprovalNotFoundBody }
  | { ok: false; status: 409; body: CosignConflictBody };
export async function cosignTransaction(args: { id: string; actorUserId: string; now?: Date }): Promise<CosignResult>;
```
Procedure (the order is binding; R10):
1. `isUuid(id)` false -> 404 `not_found` **without touching the database**.
2. `db.transaction`: `lockDecisionPair(tx, id, "share")`. Empty set or the requested id absent -> 404. A pair whose locked set is not exactly 2 rows (or a non-pair whose set is not exactly 1) is a data fault -> 409 `not_board_decision`, no INSERT.
3. **Normalise to the expense leg:** the locked row with `flow = 'expense'` (a non-pair expense row is its own key). No expense row (a lone income row) -> 409 `not_board_decision`. **Everything below uses the expense row's id, never the id the caller passed** (otherwise one person could sign once per leg and the unique constraint would not stop it; this is an application invariant, a CHECK cannot express it).
4. State, in this order: `pending` -> 409 `not_approved`; `rejected` -> 409 `rejected` (`deciderName` from the rejector via a separate `users` select, **not** a LEFT JOIN, because Postgres rejects row locks on the nullable side of an outer join; `at` = `rejectedAt ?? updatedAt`); then `SELECT <boardApprovalPredicate(ledgerTransactions)> AS ok FROM ledger_transactions WHERE id = <expense id>` inside the same transaction -> false -> 409 `not_board_decision` (reimbursement-stamped, under-threshold Sweep, anything posted without `approved_at`). Never re-implemented in JS.
5. Eligibility: `cosignEligibility({ viewerId: actor, recorderIds: <both legs' recordedByUserId>, approvedByUserId: <expense row>, cosignerUserIds: [] })` (existing co-signers are handled by the unique constraint in step 6, not pre-read). `recorded_by_you` -> 403 `CosignForbiddenBody`; `already_approved` -> 409 with `at` = `approvedAt`.
6. `INSERT INTO ledger_txn_cosigns (txn_id, user_id, cosigned_at) VALUES (<expense id>, <actor>, <now>) ON CONFLICT (txn_id, user_id) DO NOTHING RETURNING id, cosigned_at` (Drizzle `.onConflictDoNothing({ target: [txnId, userId] })`). **Zero rows -> 409 `already_cosigned`**, with that user's existing `cosigned_at` re-read in the same transaction for `at`. `now` is the explicit server `new Date()` (T9).
7. No rollback sentinel (a single idempotent INSERT; nothing half-applies). **No write to `ledger_transactions` anywhere in the file** (scan-tested), no `ledger_audit_log` row (approval is not a correction; same reasoning as B-157), no email.

Race behaviour (documented, then measured): two different users both INSERT under shared row locks and both succeed (Postgres row-level `FOR SHARE` locks do not conflict with each other); the same user twice (double-tap, two devices) gets one 201 and one 409 `already_cosigned`; a co-sign racing Approve or Reject cannot occur by state (approve/reject need `pending`, co-sign needs posted) and the lock would serialise them anyway (`FOR SHARE` conflicts with `decideTransaction()`'s `FOR UPDATE`); a co-sign racing a Delete is closed by the existing unconditional `approvedAt` Delete guards (single row and either pair leg), and a row deleted before the lock gives 404. **Allowed on reconciled, prior-year and closed-month rows** because it changes no figure; adding a fiscal-year or reconciliation guard would make a co-sign "a thing that touches the books". If the test harness cannot mock `.for("share")`, `"update"` is an acceptable fallback; log it as a deviation.

#### B4. The route (`src/app/api/admin/ledger/transactions/[id]/cosign/route.ts`)

`POST` only. `auth()` (401) then `hasFeature(session.user.features, FEATURES.LEDGER_APPROVE)` (403 with **no** `code`) are the first two statements. **No body is read or parsed; any body is ignored.** It calls `cosignTransaction({ id, actorUserId: session.user.id })` and maps the result:

| Status | Body | When |
|---|---|---|
| 201 | `CosignCreatedBody` `{ id, cosignedAt }` | recorded (`id` = expense leg) |
| 401 / 403 | `{ error }` (no `code`) | unauthenticated / missing `ledger.approve` |
| 403 | `CosignForbiddenBody` `{ error, code: "recorded_by_you" }` | the actor recorded either leg |
| 404 | `ApprovalNotFoundBody` `{ error, code: "not_found" }` | malformed, unknown or deleted id |
| 409 | `CosignConflictBody` | `not_approved`, `rejected`, `not_board_decision`, `already_approved`, `already_cosigned` |

English `error` strings (fallback only): "This entry is still waiting for its first approval", "This entry was rejected", "This entry did not need board approval", "You already approved this entry", "You already added your approval", "You recorded this entry, so another board member needs to approve it". Not a durable-claim path (no email, no `sentAt`, no success row); no rate limit beyond the session (authenticated approver, idempotent).

#### B5. Queries module extension (`ledger-approval-queries.ts`)

- **Second query, binding (analyst + R12):** the History `LIMIT 25` statement must **not** reference the co-sign table (a join would fan out and cap 25 signatures, not 25 decisions). For the returned **approved** expense-leg ids, one second statement: `SELECT c.txn_id, c.cosigned_at, c.user_id, u.name FROM ledger_txn_cosigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.txn_id IN (...) ORDER BY c.cosigned_at, c.id` (no row lock here, so the LEFT JOIN is fine). Skipped when the id list is empty. `resolveApprovalTarget()` runs the same statement for its one row (through the shared `selectDecided`).
- **If the second query fails, `getRecentDecisions()` throws** and the tab shows the existing "Could not load recent decisions" card. Never render an approved card with a silently incomplete signer list (an incomplete list reads as the whole list).
- The SELECT also reads `t.recorded_by_user_id` and `dest.recorded_by_user_id` (the `dest` self-join already exists) and `t.approved_by_user_id` **inside the module only**. The mapper builds `cosigners` (time order, each `isViewer`), calls `cosignEligibility()` **once** and derives `canCosign`, `viewerHasCosigned`, `viewerRecorded` from that single result (T4). No user id appears on a returned object (the 2a key-walk test still passes).
- Ordering stays on the posting decision time (`coalesce(approved_at, rejected_at, updated_at)`); a late co-sign never bumps an old entry or reorders the list.

#### B6. Banner states (2b) — replaces the Phase 3 rows "approved by someone else" and "approved by viewer"

`{P}` = `row.deciderName` ("A board member" when null; "You" when `deciderIsViewer`), `{list}` = `formatApproverList(...)`. The banner is `role="status"`. Precedence when more than one applies (defensive; the rules make most combinations impossible): **recorded > poster > cosigned > eligible**. Every other state in the Phase 3 table (pending, rejected, not a board decision, not found) is unchanged.

| Viewer / state | Tone | Text | Button / link |
|---|---|---|---|
| Approved, eligible, no co-signs | success | "Approved by {P} on {date}. It has been posted. You can add your approval too." | **Add your approval** (`action: "cosign"`) |
| Approved, eligible, with co-signs | success | "Approved by {P} on {date}. Also approved by {list}. You can add your approval too." | **Add your approval**; if `hiddenCount > 0`: "{A}, {B}, {C} and 4 others" plus link "See everyone under Recently decided" |
| I am the posting approver | success | "You approved this {amount} {noun}{to} on {date}. Also approved by {list}." (second sentence omitted when none) | none |
| I added my approval | success | "You added your approval on {date}. Approved by {P} on {date}. Also approved by {others}." (others exclude me; sentence omitted when none) | none |
| I recorded it | neutral | "You recorded this {noun}, so another board member decides it. Approved by {P} on {date}. Also approved by {list}." | none |

Never rendered: "Approved by 3", "2 of 14", "votes". `linkHref` for the "See everyone" link is `/admin/ledger/approvals?tab=decided&txn=<row.id>`.

**History card (approved), 2b:** line 1 "Approved by {P} · {date time}" (T6); line 2, only when any exist, "Also approved by: {A} ({date}), {B} ({date})" as a wrapped list showing **all** names (unnamed collapse per `formatApproverList`; the viewer as "You"); the secondary **Add your approval** button only when `canCosign`. Rejected cards: no approvals line, no button. **Tabs:** Pending is exactly `status = 'pending'` (unchanged); an approved entry never returns to Pending; **no "needs your approval too" queue, no badge, no count anywhere** (the Pending count, the layout badge and the sidebar are untouched). The Recently decided header gains one help line: "These are already posted. You can add your approval to any entry you did not record."

#### B7. Increment 1 strings and branches that change (F5.1, F5.2; C3)

- `describeApprovalConflict(body, noun, verb = "approve")`: the approved-by-someone-else line "…already approved this {noun}. Only one approval is needed." becomes "{Name} already approved this {noun}. You can add your approval too." **for `verb === "approve"`**; for `verb === "reject"` it is "{Name} already approved this {noun}." (T5). Both dialogs pass their verb. The "You already approved this {noun}." (`decidedByViewer`) and the rejected rows are unchanged.
- `approvalFailureAction`: for status 409 with a valid body, `decision === "approved"`, `!decidedByViewer` **and** `verb === "approve"`, the action carries `showEntry: true`. `ApprovalFailureAction` gains `showEntry: boolean` (false everywhere else); the existing fields keep their meaning (`refresh` stays true; `showEntry` supersedes it at the call site). The approve dialog then does `router.replace(approvalEntryHref(transactionId))` instead of `router.refresh()`. The new pure `approvalEntryHref(id)` returns `/admin/ledger/approvals?txn=<encodeURIComponent(id)>` and is built from the dialog's own `transactionId` prop (the expense leg the card was rendered from), **never from the response**. The person lands on the banner with the Add your approval button; the minute they typed is discarded (they cited no different motion; the minute on file is shown read-only).
- The reject dialog is unchanged except passing `verb: "reject"`.
- `buildPendingApprovalEmailHtml()`: the 2a sentence is **replaced** by "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too." (unconditional, same builder).

### 2b Data model

`src/lib/db/schema.ts` first, directly after `ledgerTransactions` (R8; the exact `unique(...)` syntax follows the repo's `ledger_budget_approvals_entity_year_key` precedent):
```ts
export const ledgerTxnCosigns = pgTable("ledger_txn_cosigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  txnId: uuid("txn_id").notNull().references(() => ledgerTransactions.id, { onDelete: "cascade" }),   // the EXPENSE leg
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),                       // SET NULL, never cascade
  cosignedAt: timestamp("cosigned_at").notNull().defaultNow(),                                         // naive; written from server `new Date()` (T9)
}, (t) => [unique("ledger_txn_cosigns_txn_user_key").on(t.txnId, t.userId)]);
export type LedgerTxnCosign = typeof ledgerTxnCosigns.$inferSelect;
```
**Short table name kept** (the longer `ledger_transaction_cosigns` derives a 67-character FK name; Postgres truncates at 63, so `drizzle-kit push --force` would report permanent drift). Derived names: `ledger_txn_cosigns_txn_id_ledger_transactions_id_fk` (51), `ledger_txn_cosigns_user_id_users_id_fk` (38), `ledger_txn_cosigns_txn_user_key` (31). No other index (the unique key's leading column serves the `WHERE txn_id IN (...)` lookup). No `kind`, minute, `updated_at`, `deleted_at`, denormalised amount/fund/entity, or audit row.

Migration **`drizzle/migrations/NNNN_ledger_txn_cosigns.sql`** (placeholder number; `0112` is a guess; re-derived at the start of database-admin's 2b step; not added to the shared tree until the schema step is complete; **not pushed until 2b passes Phase 5**, see Gating):
```sql
-- Migration NNNN: ledger_txn_cosigns (DECISION-117). Informational, append-only co-approvals.
-- Idempotent: safe to replay on every deploy. No seed data, no back-fill, no role binding.
CREATE TABLE IF NOT EXISTS ledger_txn_cosigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id uuid NOT NULL,
  user_id uuid,
  cosigned_at timestamp NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ledger_txn_cosigns_txn_id_ledger_transactions_id_fk'
                    AND conrelid = 'ledger_txn_cosigns'::regclass) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_txn_id_ledger_transactions_id_fk
      FOREIGN KEY (txn_id) REFERENCES ledger_transactions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ledger_txn_cosigns_user_id_users_id_fk'
                    AND conrelid = 'ledger_txn_cosigns'::regclass) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ledger_txn_cosigns_txn_user_key'
                    AND conrelid = 'ledger_txn_cosigns'::regclass) THEN
    ALTER TABLE ledger_txn_cosigns
      ADD CONSTRAINT ledger_txn_cosigns_txn_user_key UNIQUE (txn_id, user_id);
  END IF;
END $$;
```
The unique key is a **constraint** (guarded via `pg_constraint`, the 0063 style), not `CREATE UNIQUE INDEX IF NOT EXISTS`, so drizzle's `unique(...)` finds a constraint of that name and push does not try to "fix" it. Postgres treats NULLs as distinct in a unique constraint by default, so two deleted-account co-signers on one entry both survive (intended; the constraint bites only for live users). The `gen_random_uuid()` default and the `CREATE TABLE` shape follow the repo's most recent `CREATE TABLE IF NOT EXISTS` migration; database-admin copies that idiom rather than this snippet if they differ. database-admin runs `pnpm db:migrate` **twice**, confirms `drizzle-kit push` reports no diff, and records both in the work-log. The orchestrator announces the dev-server restart.

Cascade chain, for the record: an entity or fund delete cascades to the transaction (existing), which cascades to its co-signs; a late POST then gets 404.

### 2b Component / page plan

Create: `src/lib/ledger-cosign.ts`; `src/app/api/admin/ledger/transactions/[id]/cosign/route.ts` (+ `route.test.ts`); `src/components/admin/ledger/cosign-dialog.tsx` (client island on `LedgerDialogShell`, owns its trigger like Approve and Reject); `e2e/ledger-approvals-cosign.spec.ts` (qa).

Modify: `schema.ts`; `ledger-board-decision.ts` (`lockDecisionPair`); `ledger-approval-decision.ts` (call the helper, nothing else); `ledger-approval.ts`; `ledger-approval-queries.ts`; `approval-banner.tsx` (renders the button when `action === "cosign"`); `approval-history.tsx` (the "Also approved by" line and the button); `approvals/page.tsx` (help line; passes dialog props); `approval-dialog-logic.ts`; `approve-dialog.tsx` (`router.replace` branch, passes `verb`); `reject-dialog.tsx` (`RejectTransactionDialog` passes `verb`); `email-compose.ts`.

**`cosign-dialog.tsx`** (Radix `Dialog` via `LedgerDialogShell`, never a native confirm). Props: `{ transactionId, amountText, party, noun, fundText, memo, recorderName, boardMinute, triggerClassName, children }` (the strings come from the embedded `DecidedApprovalRow`; no user ids). Trigger: a secondary `rounded-lg` button, `border-2 border-lions-blue text-lions-blue`, `min-h-[44px]`, label "Add your approval" (Approve remains the primary action elsewhere). Body: amount, payee, fund (from → to for Transfer/Sweep), memo, recorded by, and "Board minute on file: {boardMinute}" **read-only**, plus "Your name will be added to this entry. This does not change the books." Footer `flex flex-col-reverse gap-3 sm:flex-row sm:justify-end`, Cancel and **Add my approval**, both 44px. The request comes from the pure `cosignRequest(transactionId)` (POST, **no body, no Content-Type**). Outcomes branch through `cosignFailureAction(status, body, noun)`:

| Response | Dialog | Toast |
|---|---|---|
| 201 | close, `router.refresh()` | success: "Your approval was added." |
| 409 `already_cosigned` | close, refresh | info: "You already added your approval on {date}." (no date -> "You already added your approval.") — success-shaped |
| 409 `already_approved` | close, refresh | info: "You approved this on {date}." |
| 409 `not_approved` | close, refresh | info: "This entry is still waiting for its first approval." |
| 409 `rejected` | close, refresh | info: "{Name} rejected this {noun} on {date}, so it cannot take more approvals." (null name -> "A board member"; null date -> omit the date) |
| 409 `not_board_decision` | close, refresh | info: "This entry did not need board approval." |
| 403 `recorded_by_you` | close, refresh | info: "You recorded this entry, so another board member needs to approve it." |
| 403 without `code`, 400, 5xx | stays open | error: the server's `error`, else "Could not add your approval. Please try again." |
| 404 | close, refresh | error: "We can't find that entry. It may have been deleted." |
| network failure | stays open | error: "Could not add your approval. Please try again." |

Dates through `formatDecisionDateTime()`. The button is hidden (not disabled) when `canCosign` is false, so the page and the route share `cosignEligibility()` and cannot drift (as `rowActions` already does for approve and reject).

Brand/UX: banner button full-width 44px below the text on a phone; names wrap (about 13 fit with no horizontal scroll at 360px); `rounded-2xl` cards; `lions-gold` ring only for the highlighted row; focus ring on every control; no destructive styling (nothing here is destructive).

### 2b Implementation order and implementers

1. **Gate:** the orchestrator records "no quorum objection as of <time>" under User decisions; 2a is Phase 5 PASS; migration numbers re-derived.
2. **database-admin.** `schema.ts` table, the migration, extend `ledger-approval-schema.test.ts`; both replays and the push no-diff recorded. Orchestrator announces the dev-server restart.
3. **api-developer**, in order (tsc + named tests green after each): (a) `lockDecisionPair()` + tests, then refactor `decideTransaction()` to call it with **zero** edits to `ledger-approval-decision.test.ts`; (b) carrier additions + `describeApprovalConflict` verb param + tests; (c) `ledger-cosign.ts` + tests; (d) the route + tests; (e) queries second query, new fields, mapper + tests; (f) the email sentence replacement + test. Gate: tsc, `pnpm test`, no `console.log`, `auth()` and `hasFeature(LEDGER_APPROVE)` the first two statements in the route.
4. **ux-developer.** `cosign-dialog.tsx`; `approval-dialog-logic.ts` (`showEntry`, `approvalEntryHref`, `cosignRequest`, `cosignFailureAction`); the approve dialog's `router.replace` branch; banner and History card extensions; the help line. Gate: tsc, `pnpm test`, `pnpm build:only`, no native dialogs, brand rules.
5. **qa** (full Phase 5, including the concurrency checks, recorded as `n/n`).
6. **analyst** Phase 6: **SHIP IT closes the pipeline.** If the user answers "quorum": 2b is abandoned and 2a's confirmation closes the pipeline; a new Phase 1 opens for the quorum.

Not `full-stack-developer`.

### 2b Unit tests, by name and file (the implementers deliver these; qa does not)

`src/lib/ledger-approval-schema.test.ts` (extended)
- the cosign table's FK names equal the names drizzle derives from `schema.ts` (`getTableConfig(ledgerTxnCosigns).foreignKeys` / `.uniqueConstraints`) **and** appear in the SQL's `pg_constraint` guards; each name is at most 63 characters (regression for the 67-character name that would cause permanent `push` drift);
- the unique constraint is exactly `(txn_id, user_id)`; `txn_id` FK is `ON DELETE CASCADE`, `user_id` FK is `ON DELETE SET NULL` and the column is nullable;
- the table's columns are exactly `id, txn_id, user_id, cosigned_at` (no `kind`, minute, `updated_at`, `deleted_at`, amount, fund or entity);
- the SQL is `CREATE TABLE IF NOT EXISTS` with all three constraints inside guarded `DO` blocks and contains no `INSERT`, `UPDATE` or `DELETE` (no back-fill).

`src/lib/ledger-board-decision.test.ts` (extended)
- `lockDecisionPair`: `"update"` calls `.for("update")`, `"share"` calls `.for("share")`; both order by `id`; the WHERE renders `id = ... OR transfer_group_id = (select transfer_group_id ...)` (the NULL-subselect shape); returns the rows in order;
- **source scan (R9):** `ledger-cosign.ts` contains `boardApprovalPredicate(` and does **not** contain `paidReimbursementExists(`; `ledger-approval-queries.ts` still contains `boardDecisionPredicate(` and not `paidReimbursementExists(`; the file still has no runtime `db` import.

`src/lib/ledger-approval-decision.test.ts` (existing assertions unchanged)
- every Increment 1 / 2a assertion passes unedited after the refactor;
- source scan: `ledger-approval-decision.ts` imports `lockDecisionPair` and no longer contains an inline `.for("update")`.

`src/lib/ledger-cosign.test.ts` (new; mocked `db` supporting `.for("share")`, `.orderBy`, `.insert().values().onConflictDoNothing().returning()`)
- returns `{ ok: true }` on an ordinary approved expense; the INSERT values are `{ txnId: <expense id>, userId: actor, cosignedAt: now }`;
- **co-sign via the income-leg id inserts the expense-leg id**;
- **same user via the income leg, then via the expense leg:** the second gets 409 `already_cosigned` (zero rows returned), and **both INSERTs carried the same `txnId`** (leg normalisation, the test that keeps the unique key meaningful);
- **same user twice (double-tap):** second call 409 `already_cosigned` with `at` = the first row's `cosigned_at`; exactly one row survives in the mock;
- recorder of only the income leg -> 403 `recorded_by_you`, no INSERT; recorder of only the expense leg -> same;
- the posting approver -> 409 `already_approved`, `at` = `approvedAt`, no INSERT;
- posting approver account deleted (`approvedByUserId` null, `approvedAt` set) is still co-signable, and a different actor is not blocked;
- pending (single and pair) -> 409 `not_approved`; rejected -> 409 `rejected` with the rejector's `deciderName` or `null`, `at` = `rejectedAt` or `updatedAt` for a legacy row;
- reimbursement-stamped (predicate boolean false), under-threshold Sweep (minute, no `approved_at`), and a lone income row -> 409 `not_board_decision`, no INSERT; a locked set of the wrong size -> 409 `not_board_decision`, no INSERT;
- call order is lock -> predicate select on the **expense id** -> INSERT, all inside one `db.transaction`;
- unknown id -> 404; malformed id -> 404 with the mocked `db` never called;
- the lock is `.for("share")` with an `ORDER BY id`, never `.for("update")`;
- **two different users:** both succeed; neither call reads the other's row;
- the INSERT carries `ON CONFLICT DO NOTHING` on `(txn_id, user_id)`;
- an email-shaped name returns `deciderName: null`;
- **source scans:** no `update(ledgerTransactions` or `delete(ledgerTransactions` in the file; `boardApprovalPredicate(` present; `paidReimbursementExists(` absent; no import of `ledger-approval-queries`; **table-identifier allow-list (R12):** `ledgerTxnCosigns` and `ledger_txn_cosigns` appear only in `src/lib/db/schema.ts`, `src/lib/ledger-cosign.ts`, `src/lib/ledger-approval-queries.ts`, the migration, `e2e/**`, and `*.test.ts` — never under `src/app/members/**`, `src/app/api/members/**`, `ledger-queries.ts`, or the overview, register, search and report code; `ledger-cosign.ts` is imported only by the cosign route; `ledger-approval-queries.ts` is still imported only by `approvals/page.tsx`.

`src/app/api/admin/ledger/transactions/[id]/cosign/route.test.ts` (new, helper mocked)
- 401 unauthenticated; 403 without `ledger.approve` and the body has **no `code`**; a request body (`{ userId: "someone-else" }`) is ignored and the helper receives the **session** user id; each helper result maps to 201/403/404/409 with the body passed through; `recorded_by_you` is distinguishable from the permission 403 (`isCosignForbidden` true only for the former); `auth()` and `hasFeature` are called before the helper.

`src/lib/ledger-approval.test.ts` (extended)
- `cosignEligibility` table: eligible; recorder of the income leg only; recorder of the expense leg only; poster; already co-signed; poster `null` (deleted) -> eligible for any viewer; `null` entries in `recorderIds` / `cosignerUserIds` never match; precedence (a viewer who is both recorder and poster gets `recorded_by_you`);
- `isCosignConflict` accepts each of the five codes, rejects `not_pending`, a missing `code`, a non-object; `isCosignForbidden` accepts only `recorded_by_you`;
- `describeApprovalConflict`: approve verb -> "...You can add your approval too." and **never** "Only one approval is needed."; reject verb -> "{Name} already approved this {noun}." with no suffix; `decidedByViewer` unchanged;
- `formatApproverList`: one, two, three, four+ (`max: 3` -> `hiddenCount`), a viewer entry reads "You", one unnamed -> "a board member", three unnamed -> "3 board members", mixed named + unnamed;
- `buildApprovalBanner`: every row of the 2b table, the precedence rule, others-exclude-me for "I added my approval", `action: "cosign"` only on the two eligible rows; **no output contains "@", a fraction of the board ("of 14"), or "votes"**.

`src/lib/ledger-approval-queries.test.ts` (extended)
- the History statement does **not** reference the co-sign table; the second statement uses `IN`, orders `cosigned_at, id`, and is skipped for an empty id list; it is issued once for the 25 rows, not once per row;
- a failing second query makes `getRecentDecisions()` throw;
- deleted-account co-signers (`name: null`) are present in `cosigners` with `name: null`;
- `canCosign` is false for the recorder of either leg, the poster and an existing co-signer, true otherwise; `viewerHasCosigned`, `viewerRecorded` and `isViewer` flags are derived from the single `cosignEligibility()` result (mock it and assert one call per row);
- ordering does not reference the co-sign table (a late co-sign cannot reorder); no `*UserId` key on any returned object; the resolver's `decided` approved row carries `cosigners` through the same mapper.

`src/components/admin/ledger/approval-dialog-logic.test.ts` (extended)
- `approvalFailureAction`: 409 approved-by-other with verb `approve` -> `showEntry: true`, message ends "You can add your approval too."; with verb `reject` -> `showEntry: false`, no suffix; `decidedByViewer` -> `showEntry: false`; every other Increment 1 branch unchanged;
- `approvalEntryHref("0000...0001")` -> `/admin/ledger/approvals?txn=0000...0001`; an id with `&` or `/` is encoded;
- `cosignRequest(id)`: URL `/api/admin/ledger/transactions/<id>/cosign`, method `POST`, **no `body`, no `Content-Type`**;
- `cosignFailureAction`: one case per row of the outcome table above, including success-shaped `already_cosigned` and the "stays open" rows.

`src/lib/email-compose.test.ts` (extended): the builder contains the 2b sentence and **not** the 2a sentence.

`src/components/admin/ledger/approval-history.test.tsx` (extended): the "Also approved by" line renders only when co-signers exist (never "none"); all names render; the viewer reads "You"; the button renders only when `canCosign`; rejected cards have neither; no fraction or "votes".

### 2b qa click-throughs (Phase 5; `e2e/ledger-approvals-cosign.spec.ts`, real Postgres, serial)

Fixtures: five approvers on `board_member` (poster A, B, C, and a recorder who is an admin), a `ledger.view`-only user, a treasurer without Board membership; an approved disbursement, an approved Transfer, an approved Sweep, a pending entry, a rejected entry, a reimbursement-paid row, an under-threshold Sweep. A co-signer with a distinctive name.
1. **Banner states at 360 and 390:** each viewer sees the right row of the 2b table; Add your approval is present for B and C only, 44px, full width on a phone, and **absent** for the poster, the recorder of **either** leg of the Transfer and the Sweep, and a viewer who already co-signed.
2. **Add from the banner:** toast "Your approval was added.", the banner re-renders as "You added your approval ...", no button; **add from a Recently decided card:** same, and the card gains "Also approved by". The Pending count, layout badge and sidebar are unchanged (no new queue or badge anywhere).
3. **Concurrency (L6, L7, L8), `n/n`:** (L6) two different users POST simultaneously, `n/n` runs of two 201 and two rows, zero deadlock or lock-timeout errors; (L7) one user double-POSTs, `n/n` runs of one 201, one 409 `already_cosigned`, one row; (L8) one user co-signs a Sweep through the income leg then the expense leg, `n/n` runs of 201 then 409 and **one row**, and two users via different legs give two rows.
4. **Lose the approve race:** open Approve on a pending card, let a colleague approve, click Approve: the dialog closes, the URL becomes `?txn=<id>`, the banner offers Add your approval, the toast reads "{Name} already approved this {noun}. You can add your approval too."; the **reject** variant closes and refreshes with no suffix and no navigation.
5. **Refusals (L10), `n/n`:** POST cosign on the pending, rejected, reimbursement-paid and under-threshold-Sweep fixtures answers 409 `not_approved` / `rejected` / `not_board_decision` / `not_board_decision`, **zero rows written**; as the recorder 403 `recorded_by_you`; as the poster 409 `already_approved`; malformed and unknown ids 404; a `ledger.view`-only user and a signed-out caller get 403 / 401.
6. **The lock dependency:** a `DELETE` of a co-signed approved entry (single row and both legs of a pair) still answers 403, and `PATCH` still 403s (pins that the co-sign relies on the unconditional `approvedAt` guards).
7. **Visibility:** the co-signer's distinctive name appears nowhere in the rendered HTML of the register, search, Ledger overview, reports or any member page; it appears only on the Approvals page.
8. **Email:** the queued pending-approval rows carry the 2b sentence and not the 2a sentence.
9. 13 names at 360px wrap with no horizontal scroll; the Next dev "1 Issue" panel is not a hydration warning; selectors scoped to the visible variant.
10. Database-admin's replay evidence re-checked quickly: `pnpm db:migrate` twice, `drizzle-kit push` no diff.
11. **Post-deploy (orchestrator reads only, counts) (L9):** the number of `ledger.approve` holder accounts whose normalised display name duplicates another holder's. This records the observed size of the accepted per-account-not-per-person residual. Counts only; no names, no ids into the repo or work-log.

---

## Edge cases and risks (additions to the original Phase 3 list)

- **Leg normalisation is an application invariant.** A DB CHECK cannot express "points at an expense leg". It is pinned by the same-user-income-then-expense test and by L8; without the normalisation the same person could sign once per leg of a pair (believed, from the unique key covering only `(txn_id, user_id)`; the test makes it checked).
- **A co-sign changes nothing about money.** `cosignTransaction()` writes only `ledger_txn_cosigns` (source-scanned), so reconciliation, the 990, acknowledgment letters, reports and the `approvedAt` guards are untouched. The identifier scan limits who can *reference* the table; inside the two allowed modules, co-sign rows are used for display and for the unique-conflict path only. That "display only" part is a review rule, **believed, not mechanically enforced**; Phase 6 re-reads both modules for it.
- **Posting approver deleted.** `approved_by_user_id` is NULL, `approved_at` remains, the entry stays a board decision and shows "A board member"; `cosignEligibility` never matches a null id, so any other approver can sign. Co-signer deleted: `user_id` NULL, row survives, collapses into "N other board members". **No logic may key on a non-null user id.**
- **Accepted residual: uniqueness is per account, not per person.** The roster supports two household members on one email with distinct logins, and a person could hold two accounts. Acceptable because a co-sign carries no control weight; **must be revisited before any quorum**. Live check L9 records the observed size.
- **A mistaken co-sign cannot be removed in-app** (append-only, no withdrawal). The cost is a cosmetic extra name; mitigated by the confirm dialog; audited removal is B-159 (build on demand). There is no rate to record for this one.
- **No way to record dissent** on a posted approval (Q8). A list that only shows who clicked can be misread as the board's whole view, which is why no copy ever shows a count or fraction. B-160 is held for the user's answer.
- **Second query failure** shows the existing failure card, never a partial signer list.
- **Stale tab / revoked permission.** A viewer whose `ledger.approve` was revoked keeps the cached JWT features until sign-in and the ~60 s server permission cache (CLAUDE.md, B-131), exactly as for approve and reject today.
- **Co-sign after the entry was deleted** is unreachable through the app (Delete refuses any row with `approvedAt`); a cascade (entity or fund delete) removes the co-signs and a late POST gets 404.
- **Co-sign on a row moved cross-entity** is unreachable (`moveBlockKind()` refuses approved rows and Transfer/Sweep legs); the table stores no entity, fund or amount, so there is nothing to go stale.
- **Migration replay.** Every statement is idempotent; replayed on every deploy and every `pnpm dev` start. Hence the hold on the file until the schema step is complete, and the no-push-until-Phase-5 rule for 2b.
- **Concurrent pipelines.** `schema.ts` is the shared hot file. Gate failures in files this diff does not touch are recorded as "concurrent, not this diff" (rule 3).
- **`FOR SHARE` mock.** If the harness cannot express `.for("share")`, `"update"` is an acceptable fallback; log it as a deviation (it would serialise co-signers, which L6 would then show).
- **The F-items are wording and one select-list field**; if the F1 string pass exceeds about 30 lines of non-test change, it is still wording only (no schema, no API) and stays in 2a; if it needs a new API or schema it comes back to me.

## Out of scope (non-goals; confirm)

- A quorum or any second approval required before posting (a board governance change; reopens Phase 1).
- Recording dissent, or multiple rejectors (B-160, held).
- Withdrawing or editing a co-sign (B-159).
- A co-sign email, a "needs your approval too" queue, a badge or a count; showing co-signers anywhere outside the Approvals page (register, search, overview, reports, 990).
- A ratification minute on a co-sign (an additive nullable column and its own Phase 1 if ever asked).
- Binding `ledger.approve` to the `treasurer` role.
- Excluding the recorder from their own pending-approval email (the analyst's proposed item; needs an ID and a recipients decision).
- Everything the original Phase 3 lists as out of scope still stands (reset-password callback B-155, receipt link B-156, decision audit rows B-157, approve-what-you-saw B-158, the other clipped tables).

## Release-notes draft (no version number; `/release-notes` assigns it at ship time)

*Increment 2a.* **See what the board has decided, and follow the email to the exact entry.** The Approvals page has a "Recently decided" tab with the last 25 approvals and rejections: who decided, when, and the minute reference or the reason. Rejections now record who rejected them. The link in the approval email opens the exact entry: if it is waiting, it is highlighted; if a colleague already acted, a note says who and when, so no one has to guess. Only one approval is needed, and the email says so. Signing in from an email link keeps you on the exact entry you were sent to, and sign-in links can only ever return you to this site. Transfers and sweeps now say so on their buttons and messages, sweeps show which book each side belongs to, and dollar amounts show thousands separators.
*Increment 2b.* **Add your approval.** After one board member approves an entry and it posts, other board members can add their approval to it. It is a record only: it does not change the books, and one approval is still all that is needed to post. The Approvals page and the email link show who has approved. If you click Approve just after a colleague does, you are taken to the entry so you can add yours instead.

## Live checks that record a rate (rule a), index

| ID | Increment | What it records | Who |
|---|---|---|---|
| L1 | Inc 1 (done, 6/6) | two-session approve/reject race: one 200, one 409, one stamp | qa |
| L2 | 2a, post-deploy | History row count equals Verify-First `board_approved_rows + rejected_expense_legs` | orchestrator, reads only |
| L3 | 2a | `?txn=<uuid>` readable in the queue view | qa |
| L4 | 2a | encoded `?txn=` survives the Google round trip | qa, manual |
| L5 | 2a | reject stamps both legs and the double-click 409 names the rejector, `n/n` | qa |
| L6 | 2b | two users co-sign simultaneously: two 201, two rows, no deadlock, `n/n` | qa |
| L7 | 2b | same user double-POST: one 201, one 409, one row, `n/n` | qa |
| L8 | 2b | Sweep co-signed through both legs: second 409, one row, `n/n`; different users via different legs: two rows | qa |
| L9 | 2b, post-deploy | `ledger.approve` holder accounts whose normalised display name duplicates another's (the per-account residual), counts only | orchestrator, reads only |
| L10 | 2b | co-sign on pending / rejected / reimbursement / under-threshold-Sweep: 409, zero rows, `n/n` | qa |

## Filing record (tech-lead, 2026-10-10)

- `docs/decisions.md`: **DECISION-117** filed, `Status: Proposed` (promotes to `Resolved` at Phase 6 of 2b after each factual sentence is re-read against QA's "Established" list). **DECISION-116's Status line gains "(item 1 amended by DECISION-117)"** in the same edit, because item 1 said the predicate is "used by both consumers" and its Impact list omitted the new module; the predicate now lives in `ledger-board-decision.ts` with three consumers (rule b).
- `docs/backlog.md`: **B-159** filed (Later; ToC entry and body). **B-160 not filed (held** pending the user's answer to Q8). **B-161 released** unused.
- **Correction (tech-lead, ship filing 2026-10-10):** the statement above that B-161 was released is wrong. B-161 was filed by the orchestrator (Later) for the recorder-email item and is in use; B-160 alone stays held.
- Not touched: `package.json`, `docs/release-notes/`, `CLAUDE.md`, any code, any database, any email.
- Release-time doc follow-ups for tech-lead (unchanged from the original filing record, plus one): a Key Patterns note that any new `callbackUrl` consumer goes through `safeCallbackPath()`; a line in the Approvals area on the decided-history tab and the informational co-sign (DECISION-116/117).

## Phase 3 addendum — Increment 2a and 2b — 2026-10-10

**Owner:** tech-lead
**Status:** complete

### Summary
Increment 2 is cut into two ordered deliveries. **2a** (not gated): `rejected_by_user_id` / `rejected_at` stamped on both legs, the single-definition predicate in `ledger-board-decision.ts`, the approver-only `ledger-approval-queries.ts` (Recently decided, `?txn=` resolver), tabs/banner/highlight, `safeCallbackPath()` with the proxy preserving `pathname + search` and three consumers, the Transfer/Sweep expense-leg id, the email link and sentence, and the Increment 1 Phase 6 wording fixes (F1 to F3). **2b** (starts under the no-quorum default unless the user says "quorum"): the `ledger_txn_cosigns` table, `lockDecisionPair()` extracted without changing `decideTransaction()`, `cosignTransaction()` and its no-body route, the second history query, the five banner states with "Also approved by" / "Add your approval", and the Increment 1 strings and branch that go stale.

### What I did
- Read the whole work-log (including the Increment 1 Phase 6 and its F1 to F5 hand-offs, which arrived while I was working) and the shipped `ledger-approval-decision.ts`, `approval-dialog-logic.ts` and `ledger-approval.ts`.
- Carried the five Phase 2 addendum changes and wrote eleven rulings of my own (T1 to T11), the main ones: History rows and the banner share one mapper and the row types live in the carrier (T3); `getRecentDecisions(viewerUserId)` keeps user ids server-side from 2a (T2); `viewerRecorded` is added (T4); the "add your approval" suffix applies to approve-race losers only (T5).
- Specified, for each increment, the API contract, data model, component plan, implementer order, every unit test by file, the qa click-throughs and the live checks (L5 to L10 are new).
- Filed DECISION-117 (Proposed) and B-159; marked DECISION-116 item 1 amended.

### Outputs
- This work-log (this addendum, header Reserved-IDs line, Per-Phase Status row 3). `docs/decisions.md` (DECISION-117; DECISION-116 Status line and item 1). `docs/backlog.md` (B-159, ToC and body). No application code, no `package.json`, no release notes, no email, no database.

### Open questions / handoff notes
- **Implementers.** 2a: database-admin -> api-developer -> ux-developer -> qa -> analyst short confirmation. 2b (after the gating note is satisfied and 2a's Phase 5 PASS): database-admin -> api-developer -> ux-developer -> qa -> analyst Phase 6 (closes the pipeline). Not full-stack-developer for either.
- **Orchestrator:** (1) commit Increment 1 before 2a's Phase 4 starts (T11); (2) announce the dev-server restart after each schema step; (3) record "no quorum objection as of <time>" under User decisions before 2b's database-admin step, and do not push the 2b migration until 2b passes Phase 5; (4) the analyst's proposed backlog item (the pending-approval email goes to its own recorder) still needs an ID; (5) B-158 sits in the backlog ToC's Later list but its body is in the Soon tier, a filing inconsistency from the earlier pass; (6) Per-Phase Status row 5 still says "O-1 open" although O-1 is closed.
- **For qa:** scope every selector to the visible variant; record every concurrency check as `n/n`; the co-sign button must be absent for the recorder of either leg and for the poster; the F4 human glance (fine-pointer autofocus, a real phone) is still outstanding from Increment 1.
- **User (one line, not blocking 2a):** Q1 default stands (first approval posts, others add their name); Q8 (no way to record disagreement with a posted approval) decides B-160.


## Phase 4 — Increment 1 (api-developer) — 2026-10-10

**Owner:** api-developer
**Status:** complete (server half of Increment 1). Next: ux-developer.

### Summary
The approve and reject routes are now thin wrappers over one shared `decideTransaction()` helper that locks the row and its Transfer/Sweep partner in a single `ORDER BY id FOR UPDATE` statement, blocks a self-decision on either leg, pins the write on `status = 'pending'` across both legs, rolls back via a sentinel on a short count, and 409s with a typed body naming the decider. Both E-1 notification bodies now come from one escaping builder. No schema, no migration, nothing from Increment 2.

### What I did
- `src/lib/ledger-approval.ts`: client-safe carrier (409/404 body types, `isApprovalConflict`, `displayDeciderName`, `describeApprovalFund`, `describeApprovalConflict`). `RECENT_DECISIONS_LIMIT` and the other Increment 2 members are NOT added.
- `src/lib/ledger-approval-decision.ts`: `decideTransaction()`, exported pure `conflictFromRow()`, private `StaleDecisionRollback`.
- `approve/route.ts` and `reject/route.ts`: `auth()` then `hasFeature(LEDGER_APPROVE)` remain the first statements; body via `request.json().catch(() => null)`.
- `buildPendingApprovalEmailHtml()` in `email-compose.ts`; both E-1 blocks in `transactions/route.ts` use it (no `?txn=` link, no "only one approval" sentence; plain Approvals URL). Still plain `sendBulkMemberEmail()`, still inside the existing `try/catch`, not a durable-claim path.

### 409 / 404 contract for ux-developer (import types from `@/lib/ledger-approval`)
```ts
// 409 (approve and reject)
interface ApprovalConflictBody {
  error: string;                         // "Transaction is no longer pending" | "The paired transaction is no longer pending"; toast fallback only
  code: "not_pending";                   // branch on this
  decision: "approved" | "rejected" | null;
  deciderName: string | null;            // display name; null for no name, deleted account, any rejection (Inc 1), or an email-shaped name
  decidedAt: string | null;              // ISO-8601; approvedAt, or updatedAt for a rejection (Inc 1)
  decidedByViewer: boolean;              // true on a double-click
}
// 404: { error: "Transaction not found", code: "not_found" }   (also returned for a malformed id)
// 400 / 403: { error: string }           // dialog stays open
```
Use `isApprovalConflict(body)` then `describeApprovalConflict(body, noun)`. Success 200 `{ id }` is unchanged. Other 409 bodies (proxy, older deploy) fall to the generic line per the design.

### Tests (all written and passing)
- `src/lib/ledger-approval.test.ts`: 14 tests.
- `src/lib/ledger-approval-decision.test.ts`: 28 tests (pinned UPDATE WHERE rendered through `PgDialect`, `.for("update")` + `ORDER BY`, pair single UPDATE, blank minute, Sweep minute preserved, truncation, self rule incl. destination-leg-only, every 409 variant, partner not pending, sentinel rollback with no surviving stamp, sequential race, approve/reject races, unknown/malformed id, reject rules, `conflictFromRow`).
- `approve/route.test.ts` and `reject/route.test.ts` rewritten (helper mocked): 7 + 8 tests incl. 401, 403, 409 passthrough, 400 malformed JSON.
- `transactions/route.test.ts`: +2 (payee/memo escaped on a disbursement; Sweep memo escaped, no Payee line). `email-compose.test.ts`: +5 for the builder.
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm test` 190 files, 3349 tests passed; eslint clean on all touched files; no `console.log` added (the routes keep their existing `console.error`); no native dialogs.

### Outputs (files)
Created: `src/lib/ledger-approval.ts`, `src/lib/ledger-approval.test.ts`, `src/lib/ledger-approval-decision.ts`, `src/lib/ledger-approval-decision.test.ts`.
Modified: `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` and `route.test.ts`, `.../reject/route.ts` and `route.test.ts`, `src/app/api/admin/ledger/transactions/route.ts` and `route.test.ts`, `src/lib/email-compose.ts` and `email-compose.test.ts`.
Client consumers of these routes (grepped `/approve`, `/reject`): `src/components/admin/ledger/approve-dialog.tsx`, `reject-dialog.tsx` only. Both still compile unchanged (the 409 body is additive and keeps `error`); ux-developer rewrites them per the design. No union was widened, so no ternary-to-switch conversion was needed.

### Deviations from the design
- None beyond the two the design pre-authorized (malformed JSON is 400; ruling 13).
- Implementation choices within the design, flagged for review: (1) the decider's name is looked up by a separate `users` select, not a LEFT JOIN, because Postgres rejects `FOR UPDATE` on the nullable side of an outer join; (2) a malformed (non-UUID) id returns 404 `not_found` before any query, since a uuid-cast would 500; (3) a pair whose locked set is not exactly 2 rows is refused with a 409 and no write; (4) in the E-1 blocks `party`/`memo` are passed trimmed-and-type-checked (and the transfer block uses the already-validated `cleanMemo`) so `escapeHtml()` can never receive a non-string and silently suppress the send; (5) the rejected-409 `decidedByViewer` is always false in Increment 1 (no rejector stamp exists yet).

### Open questions / handoff notes
- Next agent: **ux-developer** (components, dialogs, page, `approval-dialog-logic.ts` + test). Branch on `code`, never the English string.
- Increment 2 touch points in the helper: add `rejectedByUserId`/`rejectedAt` to the reject `stamps`, and read them in `conflictFromRow()` (rejected branch: name lookup and `decidedAt`, `decidedByViewer`). `lookupApproverName()` is approved-only today.
- The sentinel/short-count path is pinned by mock tests only; the row lock makes it believed-unreachable live (L1 in the design covers the live race).

---

## Phase 4 — Increment 1 (ux-developer) — 2026-10-10

**Owner:** ux-developer
**Status:** complete (client half of Increment 1). Next: qa (Phase 5, Increment 1).

### Summary
The Approvals page now renders each pending item as a stacked card below `xl` (one column, two from `md`) and keeps the table at `xl+`; both use one shared actions block and one shared fund label. Approve and Reject are 44px, Reject is hidden on rows the viewer recorded, and both dialogs sit on `LedgerDialogShell` with fund, memo and recorder shown, an inline hint explaining the disabled Approve, and 409/404 handling that closes, refreshes and toasts the decider. No Increment 2 work was added.

### What I did
- New presentational components (flat in `src/components/admin/ledger/`): `approval-fund-label.tsx`, `approval-actions.tsx`, `approval-card.tsx`, `approval-dialog-context.tsx`. Pure rules in `approval-dialog-logic.ts` (`rowActions`, `approvalFailureAction`, `approveHint`).
- `approvals/page.tsx` stays a Server Component: `<ul class="grid gap-4 md:grid-cols-2 xl:hidden">` of cards plus `<div class="hidden ... xl:block">` table. Rows carry `data-row-id`, never `id`. Payee/memo wrap (`break-words`) instead of truncating. Empty-state heading is now "Nothing is waiting for approval" (no link to Recently decided; Increment 2). `h1` stays "Pending Approvals".
- `approve-dialog.tsx` and `RejectTransactionDialog` (in `reject-dialog.tsx`; `RejectReimbursementDialog` untouched) now render their own trigger button (`triggerClassName` + label children, plus `context` and optional `noun` props), use `LedgerDialogShell`, footers are `flex-col-reverse sm:flex-row` with 44px buttons, inputs are `text-base` on mobile (no iOS zoom). `autoFocus` removed; the field is focused on open only for a fine pointer (`matchMedia`). Approve hint (`#approve-hint`, `role="status"`, `aria-describedby` on the disabled button) appears only while the button is disabled for lack of a minute.
- Failure handling branches on status/`code` through `approvalFailureAction`: 409 closes, refreshes, `toast.info` with `describeApprovalConflict` (generic line when the body is not the typed carrier); 404 closes, refreshes, `toast.error("This entry no longer exists.")`; 400/403/5xx and network failure keep the dialog open with the typed text; only server-provided `error` strings are surfaced.
- The table's "Recorded by" cell shows "You" on own rows and the actions cell carries the amber "You recorded this, so another board member must decide it." line (replaces the old "Cannot self-approve" marker and the chip).

### Outputs
Created: `src/components/admin/ledger/approval-fund-label.tsx`, `approval-actions.tsx`, `approval-card.tsx`, `approval-dialog-context.tsx`, `approval-dialog-logic.ts`, `approval-dialog-logic.test.ts`, `approval-actions.test.tsx`.
Modified: `src/app/(dashboard)/admin/ledger/approvals/page.tsx`, `src/components/admin/ledger/approve-dialog.tsx`, `src/components/admin/ledger/reject-dialog.tsx`.
Not touched: `ledger-approval-decision.ts`, the two routes, `email-compose.ts`, `ledger-approval.ts`.

### Tests and gates
- New: `approval-dialog-logic.test.ts` (13 tests: rowActions, every approvalFailureAction branch incl. unrecognized 409 body, 404, 400/403/500, network, approveHint) and `approval-actions.test.tsx` (4 tests: Approve/Reject with 44px classes, own row has no buttons and no Reject, card has `data-row-id` and no `id`, Transfer chip). No dialog-level 409 test was named in the design; the 409 branch is covered through `approvalFailureAction` and the live check below.
- `pnpm exec tsc --noEmit` clean. `pnpm test`: 192 files, 3366 tests passed (was 190 / 3349 after the api half). `eslint` clean on all touched files. No `console.log`, no `window.confirm/alert/prompt`. `pnpm build:only` not run (qa).

### Browser verification (dev server on :3000, signed in with the e2e admin; one pending expense recorded by another local user, inserted into the LOCAL dev DB and deleted afterward, 0 UXTEST rows remain)
- Widths 390, 1024, 1279: cards visible, table hidden; at 1280 table visible, cards hidden. Approve and Reject are 44px high and fully on screen in all four; no horizontal page overflow; no duplicate DOM ids; exactly one visible `data-row-id` variant per width.
- 360 and 390 dialogs: dialog spans `left 12px` to `viewport - 12px`; Approve disabled with the hint showing; on a touch-less headless run focus lands on the Close button (fine-pointer auto-focus is untested in a real desktop browser, see handoff).
- Live 409: opened Approve, typed a minute, a second user's approval was written to the DB, clicked Approve: dialog closed, page refreshed to the empty state, toast read "<Name> already approved this disbursement. Only one approval is needed."
- Console: only the dev-mode `eval()`/CSP error and the footer logo aspect-ratio warning (neither from this diff), plus the expected 409 network line.
- Screenshots in `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/approvals-inc1/`: `approvals-390.png`, `approvals-1024.png`, `approvals-1279.png`, `approvals-1280.png`, `approve-dialog-360.png`, `approve-dialog-390.png`, `reject-dialog-360.png`, `reject-dialog-390.png`, `after-409-390.png`.

### Deviations from the design
- None of substance. Small choices inside the design: the self-row "Recorded by" cell on the table says "You" (the amber message lives in the actions block, once); the dialog also repeats amount and payee as a visible first line because `LedgerDialogShell`'s description is `sr-only`; context memo/fund/recorder was about 25 lines, under the 30-line cap, so B-156 stays receipt-link only.

### Open questions / handoff notes
- **Next agent: qa (Phase 5, Increment 1).** Scope selectors to the visible variant (table and cards both mount). Click through at 360, 390, 1024, 1279, 1280 as a board-only user (`board_member` + `member`): Approve with a minute, Reject with a reason, own-row marker (no Reject), 409 from a second session, deleted row (404 path). Open the Next dev "1 Issue" badge and confirm it is the pre-existing eval/CSP item rather than a hydration warning.
- Not verified: desktop fine-pointer auto-focus of the minute/reason field (headless Chromium reports no hover); a real iPhone keyboard.
- Copy the club may want to tune: "You recorded this, so another board member must decide it." and "Add a minute reference to enable Approve." and "Nothing is waiting for approval".
- Pre-existing, untouched: `formatDollars` renders "$2275.00" with no thousands separator on this page.
- Increment 2 will add the history link to the empty state, the tabs, banner and `h1` rename.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — Increment 1 — 2026-10-10

**Owner:** qa
**Status:** complete (Increment 1). Increment 2 is not in this tree and was not verified.
**Scope:** Increment 1 only (cards below `xl`, shared actions, 44px targets, dialogs on `LedgerDialogShell`, `decideTransaction()` behind both routes, typed 409/404, `buildPendingApprovalEmailHtml()`).
**Tree measured:** `main` at `a585145` plus the uncommitted working tree (13 modified files, 13 untracked files before qa; `git status --short` was byte-identical before and after `pnpm build:only`). qa added one untracked file, `e2e/ledger-approvals-mobile.spec.ts`. The Increment 1 diff is the only thing in the tree touching these files; no concurrent pipeline collided with it during the run (the other open work-log, `2026-10-09-september-admin-session-closing-balance`, owns `docs/backlog.md` / `docs/decisions.md` edits only).

### Summary

**Verdict: PASS** for Increment 1. At 390px a board-only user now sees a card for every pending row with Approve and Reject on screen at 44px (the pre-fix state, `board-approve-repro/09-mobile-approvals.png`, showed only Date / Fund / Amount); the lost-race path, the pair-atomicity path, the self-decision refusal and the empty-state copy all behave as designed on the live dev server. **One open observation travels with the PASS and must be resolved before push** (it is not attributable to this diff on current evidence): see "Open item O-1", the live dev server queued no approver-notification emails for a new over-threshold disbursement, while the same route code run in a fresh process queued 16.

### What I did

**Gates (measured on the tree above)**

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS (exit 0, no output) |
| `pnpm lint` | PASS: 0 errors, 1 warning, `src/components/admin/ledger/budget-context-panel.tsx:114` "unused eslint-disable directive". That file is not in `git status`, so it is not this diff. |
| `pnpm test` | PASS: 192 files, **3366 tests passed, 0 failed**, 4.0s (the ux-developer's count, reproduced). `admin-page-feature-gates.test.ts` 172/172. |
| `pnpm build:only` | PASS: compiled successfully, 125/125 static pages generated, 272 route lines, no warnings. Ran with the dev server up; Next 16 keeps dev output in `.next/dev`, and :3000 stayed 200 throughout. |
| New-module coverage (`pnpm exec vitest run --coverage` on the three new test files) | `ledger-approval-decision.ts` 97.3% stmts / 91.8% branch; `ledger-approval.ts` 92% / 94%; combined 96.4% / 94.0%. |
| `e2e/ledger-approvals-mobile.spec.ts` (the only spec the design names; whole suite NOT run) | PASS: 12/12 in 41s, single worker. See "Regression tests added". |

**Bug reproduction (scope A, bug-fix variant).** Pre-fix state is the cited screenshot `.../scratchpad/board-approve-repro/09-mobile-approvals.png`: a table clipped to Date / Fund / Amount, no Approve or Reject on screen. Post-fix, `approvals-inc1-qa/approvals-390-top.png` shows the same page as cards, each with Approve and Reject on screen. Measured at 390: Approve box 44px high, x 40-137; Reject 44px, x 149-234; page `scrollWidth` 390 = viewport. I did not check out old code, per instruction.

**Manual click-through, dev server :3000 (not restarted; no kill), local dev DB.** Fixture users `qaboard@example.com` (`board_member` + `member` only) and `qaviewonly@example.com` (`budget_committee` + `member`, which carries `ledger.view` but neither `ledger.approve` nor `admin.dashboard`); fixture rows recorded by the E2E admin and one by qaboard, all above the $100.00 threshold. Driven with Playwright (touch + mobile emulation for the phone widths), 67 + 33 + 2 scripted checks, screenshots in `.../scratchpad/approvals-inc1-qa/`.

| Flow | Result | Notes |
|---|---|---|
| 390 and 360, cards | pass | Card list visible, table hidden; no horizontal overflow; one-column grid; exactly one visible variant per `data-row-id`; no duplicate DOM ids; Approve and Reject 44px, fully on screen for every non-own row |
| Row recorded by the signed-in user | pass | Amber "You recorded this, so another board member must decide it." in place of the buttons; no Approve and no Reject in the DOM; table cell reads "You". Forced `POST .../approve` and `.../reject` return **403** ("You cannot approve/reject a transaction you recorded"); row stays pending. (Wording differs from the older "Cannot self-approve" in the QA brief; the design replaced it.) |
| Transfer and Sweep cards | pass | Transfer chip + "Administrative Fund → Activity Fund"; Sweep chip + "Charitable Fund → Activity Fund"; income legs not listed (one row per pair). Sweep Approve dialog pre-fills the original motion, no hint, Approve enabled. |
| Approve dialog at 360 | pass | Dialog spans x 12 to 348 of 360; fund, memo (long unbroken token wraps), recorder shown; `#approve-hint` "Add a minute reference to enable Approve." visible, Approve disabled with `aria-describedby="approve-hint"`; typing a minute removes the hint and enables Approve; button 44px; on a touch context the minute field is **not** auto-focused (focus lands on Close). Cancel closes; DB row still pending. |
| Reject dialog at 360 | pass | Fits x 12 to 348; shows fund, memo, recorder; Cancel closes; row still pending. |
| Race (UI): dialog open, another approver wins in the DB, then Approve | pass | Dialog closes, list refreshes, toast "E2E Test Admin already approved this disbursement. Only one approval is needed."; the loser wrote nothing (DB still carries the other approver's stamp and minute). |
| Reject lost to approve on a Transfer | pass | Toast "... already approved this transfer ..."; both legs still `posted`, no rejection written. |
| Approve for real | pass | Toast "Disbursement approved."; DB: `posted`, `approved_by_user_id` = qaboard, typed minute; card leaves the list. |
| Transfer pair, atomicity (regression item 4) | pass | Partner leg set `posted` out-of-band, then Approve on the pending leg: **409** "The paired transaction is no longer pending", the pending leg stays `pending|-` (neither posts). Reset, then approve via UI: **both legs** `posted`, both stamped qaboard with the minute. Sweep reject via UI: both legs `rejected` with the reason. |
| Status codes | pass | Malformed JSON on a pending row: **400** (approve and reject); malformed id and unknown id: **404** `not_found`; blank minute / blank reason: 400, row untouched; re-approve of own approval: 409 with `decision: "approved"`, `deciderName`, `decidedByViewer: true`; reject of an approved row: 409. No 409 body carries an email address. (Note: malformed JSON on an already-decided row returns 409, because validation runs after the lock by design; I first mis-tested that and retested on a pending row.) |
| Double-click (same user, 2 parallel POSTs) | pass | 5/5 runs: one 200 + one 409 with `decidedByViewer: true` |
| Two sessions racing (board user vs E2E admin, simultaneous POSTs; approve-vs-approve x3, reject-vs-approve x3) | pass | 6/6 runs: exactly one 200 + one typed 409, exactly one stamp, **no approver stamp ever on a rejected row**, loser body names the winner (null name for a rejection, as Increment 1 specifies). This is the live check L1 in the design: `n/n = 6/6`. |
| Layout at 1024 / 1279 (cards, two-column grid) and 1280 / 1440 (table) | pass | No overflow; one visible variant per row; no duplicate ids; table Actions column not clipped (no inner scroll) at 1280 and 1440; 44px Approve/Reject on screen at every width |
| Empty state | pass | At 390 and 1280: "Nothing is waiting for approval" + "No pending disbursements. The approval threshold is $100.00."; the old "All expenditures are approved" is gone |
| `ledger.view`-only user | pass | `/admin/ledger/approvals` redirects to `/admin/ledger`; `POST .../approve` returns 403; signed-out `POST` returns 401. Existing gate unchanged. |
| Next dev "1 Issue" badge | pass | Opened the panel: it is the dev-mode `eval() is not supported ... Content-Security-Policy` console error (also present in the pre-fix screenshot, and in the ux-developer's note), not a hydration mismatch; zero `hydrat*` console messages across the run. |
| Email safety | pass | `EMAIL_DEV_ALLOWLIST` is unset in `.env.local` and in the dev server's process environment. The approve/reject paths send no email. Every email row created during qa (2 sign-in "New portal user" notices, plus the probe rows below) was `blocked_non_production`; none was `sent`. |
| Native dialogs / console.log | pass | None in any new or changed Increment 1 file (grep) |

**Observations (not failures, none blocking):** (1) The success toast is hard-coded "Disbursement approved." / "Disbursement rejected." even for a Transfer or Sweep, while the 409 toast uses the right noun; the `noun` prop is already in scope. (2) A Sweep card reads "Charitable Fund → Activity Fund" with no entity name, so the two "Activity Fund"-style names are ambiguous across entities; pre-existing design of `describeApprovalFund`. (3) `formatDollars` still renders "$2275.00" with no thousands separator (the ux-developer already noted it). (4) Fine-pointer desktop auto-focus of the minute field is **still unverified in a real desktop browser** (headless Chromium reports no hover); the logic is a one-line `matchMedia` guard, so the user should glance at it once on a laptop.

### Open item O-1 (unexplained; resolve before push)

**Established (reproduced 4x, by two methods):**
- With the dev server on :3000, `POST /api/admin/ledger/transactions` as the E2E admin with an over-threshold expense returns 201 `status: "pending"`, and **no `email_queue` row is created** (delta 0 each time; no `[Email] BLOCKED` line in `board-approve-repro/dev.log` either). The same holds with and without party/memo.
- Running that exact route handler (`POST` imported from `src/app/api/admin/ledger/transactions/route.ts`, `auth` mocked to the E2E admin, real DB, real `sendBulkMemberEmail`/`sendEmail`) in a fresh Vitest process against the same working tree: 201, `sendBulkMemberEmail` called once with **16 recipients**, subject "Disbursement pending your approval — $330.00", body with payee `QA &lt;b&gt;x&lt;/b&gt; &amp; Co`, the plain `/admin/ledger/approvals` link, no `?txn=` and no "only one approval" sentence; 16 rows queued as `blocked_non_production`. Each building block (`getEmailsForFeature` = 16 approvers, `resolveTreasurer` ok, `buildPendingApprovalEmailHtml`) also works in a plain `tsx` process. The compiled Turbopack chunk contains the new builder call.
- The two E-1 blocks sit inside a `try { ... } catch { /* best-effort */ }` that swallows every error silently.

**Believed (not established):** something throws inside that try block in the live Next runtime and is swallowed, or the approver list is empty there. I could not find out which: I cannot edit app code, and a second dev server on a HEAD copy would not boot a client bundle (sign-in form never hydrated), so I could not tell whether the pre-diff code behaves the same on :3000. It is therefore **not known whether this predates Increment 1**. It does not affect the approve/reject behavior verified above; it affects whether the board is told a disbursement is waiting (the very flow that started this work).
- Next step for the orchestrator or api-developer: add a temporary `console.error` to the E-1 catch (or log `approverEmails.length`), restart :3000 with an announcement, POST one over-threshold expense, read the line. If the pre-diff code also stays silent live, file it as its own defect; if only the working tree does, it returns to api-developer.
- Design check #7 (the queued row showing `&lt;b&gt;` at `/admin/email-queue`) is therefore verified through the fresh-process run, **not** through the live queue page.

### Regression tests added

- `e2e/ledger-approvals-mobile.spec.ts` (new, qa-owned, 12 tests, seeds and cleans its own fixtures, example.invalid users): `should show Approve and Reject on screen as 44px targets at 390px / 360px — regression for the off-screen Approve button on phones` (lines 239-270, guards the reported bug), `should close the dialog and name the other approver when someone else decides first — regression for the silent lost race`, `should approve a pending disbursement and post BOTH legs of a Transfer`, four width tests (1024 / 1279 cards, 1280 / 1440 table, no clipping), the Approve-dialog-at-360 test, the forced self-decision 403, the `ledger.view`-only gate, and the empty state. It was green on its first run and was not run against pre-fix code (instructed); its core assertions (card list visible, table hidden at 390) are structurally false on the pre-fix page.
- Unit tests named in the design were delivered by the implementers (3366 total, green); qa wrote no additional Vitest.

### Coverage on critical modules

`events.ts`, `permissions.ts`, `members.ts` are untouched by this diff and were not re-measured (the 7-day coverage sweep owns them). New modules: see the gates table (96.4% statements combined).

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/admin/ledger/transactions/[id]/approve` | yes, first statement, 401 | yes, 403 | `FEATURES.LEDGER_APPROVE` (mutation) |
| `POST /api/admin/ledger/transactions/[id]/reject` | yes, first statement, 401 | yes, 403 | `FEATURES.LEDGER_APPROVE` (mutation) |
| `POST /api/admin/ledger/transactions` (E-1 body only; gate unchanged) | yes, 401 | yes, 403 | `FEATURES.LEDGER_RECORD` |
| Page `/admin/ledger/approvals` | yes (`redirect("/signin")`) | yes (`redirect("/admin/ledger")`) | `FEATURES.LEDGER_APPROVE`; no widening, no new key, no nav change |
| `decideTransaction()` (`src/lib/ledger-approval-decision.ts`) | n/a, not a route | n/a, called only after both gates | server-only (imports `db`); the client-imported carrier `ledger-approval.ts` has no imports |

Verified by reading the files, then by behavior: a `ledger.view`-only user is redirected and gets 403 from the route; signed out gets 401. No bulk PII is returned by either route (the 409 body carries a display name only, never an email).

### Cleanup (local dev DB; production untouched, `PROD_DATABASE_URL` never read)

Deleted: 23 `ledger_transactions` rows (22 fixture/probe rows + 1 stray row from a no-party POST), 0 audit rows existed; 2 users + 4 `user_roles` rows (`qaboard`, `qaviewonly`; the spec's own two users were removed by its `afterAll`); 21 `email_queue` rows (2 + 2 sign-in notices, 16 + 1 blocked probe rows). Final measured state: `ledger_transactions` 283 (as at start), 0 pending; `email_queue` 1202 (pre-run baseline); 0 qa users (the one remaining `qa-reset-target-...@example.invalid` pre-dates this run). The probe rows were created only by qa's own fresh-process Vitest/`tsx` probes (their recipients include real-looking dev-DB approver addresses and a real treasurer CC; every row was `blocked_non_production`, verified, and deleted). I started one extra `next dev` on :3101 from a HEAD copy to compare; it was killed and its directory removed; :3000 was never touched.

### Outputs

- `e2e/ledger-approvals-mobile.spec.ts` (new)
- Screenshots and scripts: `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/approvals-inc1-qa/` (`approvals-{360,390,390-top,1024,1279,1280,1440}.png`, `approve-dialog-{360,360-typed,390}.png`, `reject-dialog-360.png`, `race-after-409-390.png`, `empty-state-390.png`, `dev-issues-panel.png`)
- No application code edited, nothing committed.

### Open questions / handoff notes

- **Resolve O-1 before push** (orchestrator owns :3000): instrument-and-retest as described, then record whether it is pre-existing.
- Copy the club may want to tune (also in the ux handoff): "You recorded this, so another board member must decide it.", "Add a minute reference to enable Approve.", "Nothing is waiting for approval". Success-toast noun for Transfer/Sweep is a small follow-up.
- One human glance wanted: the minute field auto-focus on a real laptop browser (fine pointer), and the Approvals page on a real phone.
- Next agent: **analyst** for the bug-fix-variant Phase 6 confirmation of Increment 1 (after O-1 is settled); Increment 2 then proceeds to database-admin.

**Verdict (Increment 1): PASS**, with O-1 open.


### Orchestrator action on O-1 (2026-10-10)

- **Absorbed deviation (under 30 lines, no schema, no API):** both E-1 `catch {}` blocks in `src/app/api/admin/ledger/transactions/route.ts` now `console.error("[Ledger email] Approver notification failed…", error)` instead of swallowing silently. A silent catch is what made O-1 undiagnosable on the live server. `tsc` clean after the edit.
- **Dev server restarted** (orchestrator-owned, Concurrent Pipelines rule 2): the `:3000` process started by the 2026-10-10 click-through was killed and `pnpm dev` restarted at this point; new log at `<scratchpad>/dev-restart-2026-10-10.log`. Any live check before this line was measured on the old process.
- Reproduction of O-1 on the fresh process delegated to a qa agent; result recorded below.

#### O-1 resolution (qa, 2026-10-10)

**Outcome (a): notifications queue on the fresh process; the old :3000 server was stale. O-1 is closed and is not a code defect.**

- **Safety preconditions (checked before the POST):** `EMAIL_DEV_ALLOWLIST` absent from `.env.local`, from the shell, and from the new server process environment; `RESEND_API_KEY=` blank in `.env.local`. Local dev DB only (`DATABASE_URL`); `PROD_DATABASE_URL` never read; no `scripts/*` run.
- **Probe:** server restarted at 2026-10-10 (pid 91199, answered 200). Signed in as the E2E admin through `/api/auth/callback/credentials` and POSTed one expense of $330.00 (threshold is 10000 cents = $100) to `POST /api/admin/ledger/transactions` with payee `O1 PROBE <b>x</b>`, memo `o1 probe`, Administrative fund. Response: **201, `status: "pending"`**.
- **Dev log:** no `[Ledger email]` line (neither the new `console.error` nor the treasurer-CC warning). 15 `[Email] BLOCKED` lines, then `POST /api/admin/ledger/transactions 201 in 4.0s`.
- **Queue:** `email_queue` 1202 -> 1217 (+15). All 15 rows `blocked_non_production`; none `sent`. All 15 bodies contain `&lt;b&gt;` (escaped) and none contain the raw `<b>x</b>`. (Recipient addresses were not selected from the DB; note the dev log itself prints recipient addresses on `[Email] BLOCKED` lines, which is existing behavior.)
- **Established:** the same route, on a freshly started dev server with the current tree, queues the approver notifications; the E-1 block does not throw. **Believed (not established):** the earlier silence came from the long-running server holding a stale module or approver state (it had been up across several edits); I did not reproduce the stale server, so the cause of that earlier state is unexplained beyond "does not recur on a fresh process".
- **Two small observations, neither a defect:** (1) 15 rows now versus 16 recipients in the earlier fresh-Vitest run; the 15 blocked sends match the 15 log lines, so nothing was dropped between route and queue, and the approver set can differ with dev-DB role data between runs. I did not chase it. (2) The queued body check was the escaped-payee boolean only; this probe did not assert the `?txn=` link or the one-approval sentence (the `with_txn_link` count was 0 and that is the Increment-2 design item, not part of Increment 1), consistent with the earlier fresh-process finding that the Increment 1 body has the plain `/admin/ledger/approvals` link.
- **Design check #7 is now verified through the live route** (escaped `&lt;b&gt;` in the queued row), not only through the fresh-Vitest run.
- **Cleanup (local dev DB):** deleted 15 probe `email_queue` rows and the 1 probe `ledger_transactions` row. `email_queue` 1202 before and 1202 after; `ledger_transactions` 283 before the probe (284 after the POST) and 283 after cleanup; 0 pending; 0 rows matching `O1 PROBE%`. No application code edited, nothing committed, :3000 not restarted or killed.
- **Residual for the orchestrator:** the temporary `console.error` is the orchestrator's absorbed deviation and can stay (a silent catch is worth removing regardless). Status table row 5 can drop "O-1 open".


### Pre-push gates for Increment 1 (orchestrator, 2026-10-10)

Tree measured: `main` at `a585145` plus the uncommitted Increment 1 changes, after the dependency override change below.

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Lint | PASS (0 errors; 1 pre-existing warning in `budget-context-panel.tsx`, not this diff) |
| Unit tests | PASS — 192 files, 3366 tests |
| Production build | PASS — 125/125 pages, re-run clean after the dependency change |
| E2E | PASS — 232 passed, 1 skipped (13.4 min, serial, against the restarted :3000) |
| Schema / migrations | No change vs main (Increment 1 has no schema) |
| CVE audit | FAIL → fixed: `sharp` (GHSA-wq5f-xc86-pv6w) and `source-map-js` (GHSA-68fv-2mgg-jv7q) high advisories, both transitive under `next`; overrides tightened to `sharp@<0.35.5 → >=0.35.5` and `source-map-js@<1.2.2 → >=1.2.2`; audit exits 0; tsc/unit/build re-run green; dev server and `/_next/image` still 200 |
| Personal data sweep | Clean (git grep ran: email pattern matched only `example.*` fixtures; phone/address patterns matched only the published drop-off directory migration) |
| Env files tracked | None |
| Release notes / version | `docs/release-notes/v1.89.md` written, linked from v1.88; `package.json` 1.88.0 → 1.89.0 |
| CLAUDE.md | Key Features bullet "Disbursement approvals (v1.89, DECISION-116)" added. Treasury User's Guide: no applicable change (it says "review the Approvals queue", still true). |
| Housekeeping | `console.log` hits are the two pre-existing dev-mode email lines; no native dialogs |

Ready to push: **yes** — pending the user's approval to commit and push (Workflow Rule 1). Increment 2a's Phase 4 starts only after this commit lands (it edits the same files).

---

# Phase 6 — Shipped vs Intent (analyst) — Increment 1

## VERDICT

**SHIP WITH NOTES** (Increment 1 only). Nothing is a fix-before-push. The notes are polish and one hand-off list for Increment 2; they do not block the push. This verdict does not close the pipeline: Increment 2 (history, deep link, callback guard, rejection attribution, multiple approvers) still has to go through Phases 2 to 6, and its Phase 6 closes the entry.

## ONE-LINE TAKE

> A board-only member on a 390px phone now opens Approvals and sees a card per pending item with 44px Approve and Reject on screen, the dialog tells them what they are approving and why Approve is greyed out, and losing a race to a colleague closes the dialog and says who got there first; the decision itself is now race-safe, though a Transfer or Sweep still reads "Disbursement" in a few places.

## Original reporter's situation: resolved

The report was "Able to see Ledger via Admin, but no permission to approve as Board member." The cause was never permission: `board_member` carries `ledger.approve`, and the same account approved on desktop. The cause was an off-screen button. Evidence that it is gone:
- Before: `board-approve-repro/09-mobile-approvals.png` (390px, board-only user): a table clipped to Date / Fund / Amount, no Approve, no Reject, no scroll cue.
- After: `approvals-inc1-qa/approvals-390-top.png`: a card per item with amount, payee, memo (a long unbroken token wraps), fund, recorder, and Approve (filled) and Reject (outlined) both fully on screen. QA measured 44px height for both at 360 and 390, `scrollWidth` equal to the viewport, one visible variant per row, and the same result as the board-only fixture user (`board_member` + `member`, no admin, no `ledger.record`).
- The real email path also holds: Increment 1 keeps the plain `/admin/ledger/approvals` link, and the proxy already preserves the pathname in `callbackUrl`, so a signed-out approver lands on the page after sign-in without needing the Increment 2 query-string fix.
- I read the page, `approval-actions.tsx`, `approval-card.tsx`, both dialogs, `decideTransaction()`, both routes, the carrier and the E-1 diff. They match what QA exercised.

## What's Working

- **The bug fix, for the right reason.** The breakpoint is `xl`, not `md` (Phase 3 ruling 1: the admin sidebar offset leaves the table about 720px wide at 1024px). QA confirmed cards at 1024 and 1279 and the table, with an unclipped Actions column, at 1280 and 1440. A `md` cut would have left the same defect on every laptop with the sidebar open.
- **One source of truth for who may do what.** `rowActions(isSelf)` hides Reject (and Approve) on rows the viewer recorded, replacing them with a plain amber sentence; the route 403s the same case (QA forced the POSTs). Phase 1 Flow 2's contradiction between card and server is gone, and the self rule now covers either leg of a pair.
- **The race is closed and the loser is told.** QA ran 6/6 live simultaneous approve-vs-approve and reject-vs-approve runs: one 200, one typed 409, one stamp, never an approver stamp on a rejected row. The dialog closes, the list refreshes, and the toast reads "<Name> already approved this disbursement." This is the Phase 1 Flow 1 failure path as written, and it is the direct fix for the thirteen colleagues who click second.
- **Approver context in the dialog.** Fund (with from to), memo and recorder sit above the field, so a phone user is not approving $2,275 from an amount and a payee alone (Phase 1 N12, pulled into Increment 1 under the 30-line rule).
- **The disabled Approve is explained** ("Add a minute reference to enable Approve.", `role="status"`, `aria-describedby` on the button), and the touch keyboard no longer opens over the context.
- **The notification email can no longer inject.** One builder, `escapeHtml()` on payee and memo (QA saw `&lt;b&gt;` in the live queue). The orchestrator's absorbed `console.error` in both E-1 catches is exactly right: a silent catch made O-1 undiagnosable, and O-1 is closed as a stale dev process.

## Intent-vs-Shipped Diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| A: Approve and Reject visible on a phone; table unchanged on wide screens | Cards below `xl` (one column, two from `md`), table from `xl`; both buttons 44px | matches (breakpoint moved from `md` to `xl` by Phase 3 with a measured reason) |
| A: Reject hidden or explained on self-recorded rows | Both controls replaced by the amber "You recorded this, so another board member must decide it." line; table cell reads "You" | matches |
| A: dialogs fit 360px and keep context when the keyboard opens | `LedgerDialogShell`, x 12 to 348 at 360; no touch autofocus; text inputs `text-base` on mobile | matches (fine-pointer autofocus not verified on a real desktop, see F4) |
| D: one-line hint explaining the disabled Approve | Shipped above the buttons, tied to the button by `aria-describedby` | matches |
| A2: on 409 close, refresh, name the decider | Typed carrier, branch on `code`; toast names the decider or "A board member"; never an email; 404 closes and refreshes; 400/403/5xx and network keep the dialog with typed text | matches |
| 409 wording "<Name> approved..." | Reads "...Only one approval is needed." | acceptable drift for now; goes stale in Increment 2 (F5) |
| N4 / F: pin the decision, 409 on zero rows, rollback so a pair cannot half-apply | `decideTransaction()` locks target and partner, pinned UPDATE, sentinel rollback; QA saw pair atomicity (partner already posted: 409, neither leg posts) | matches |
| N7: escape payee and memo in both E-1 emails | One builder with `escapeHtml()`; both call sites use it | matches |
| N5: "only one approval is needed" sentence in the emails | Deferred by Phase 3 ruling 6 so it ships with the banner and the co-sign UI | acceptable drift (correct call: the sentence would be wrong once co-signing exists, and the user has now asked for co-signing) |
| Flow 6: empty state "Nothing is waiting for approval" plus a "See recently decided" button | Heading and sub-line shipped; button deferred until the tab exists | acceptable drift (Phase 3 ruling 8) |
| N10: `h1` becomes "Approvals" | Stays "Pending Approvals" until the tabs exist | acceptable drift |
| Success toast "Disbursement approved." (Phase 1 Flow 1) | Hard-coded for every kind, including Transfer and Sweep | matches Phase 1's literal text, but see F1 |
| Flow 4 / N3: callback round trip and open-redirect guard | Not in Increment 1 (Increment 2 by design) | not applicable here |

## Edge Cases

- **Empty state:** pass. "Nothing is waiting for approval" is true for the person arriving from a rejected item, and the wrong "All expenditures are approved" is gone (`empty-state-390.png`).
- **Failure microcopy:** pass. 409 and 404 are human and specific; server-provided `error` strings only, so a raw "Failed to fetch" no longer reaches the user; the typed minute or reason survives a 400, 403, 500 or network failure.
- **Permission gate:** pass. `auth()` then `hasFeature(LEDGER_APPROVE)` are the first statements in both routes and the page; a `ledger.view`-only user redirects to `/admin/ledger` and gets 403 from the routes; signed-out gets 401; no new key, no nav or proxy change.
- **Mobile (360px):** pass. Cards, both dialogs and the empty state fit without horizontal scroll; the amber line wraps.
- **Brand:** pass. Cards `rounded-2xl`, buttons `rounded-lg`, the chips (`rounded-full`) are chips, focus rings present, no native dialogs, no `window.confirm`. The empty state matches the house class.

## Decisions on QA's four observations and the recipient count

| Item | Defect against Phase 1 intent? | Decision |
|---|---|---|
| **F1.** Toast says "Disbursement approved." / "...rejected." for a Transfer or Sweep (also the dialog titles "Approve Disbursement" / "Reject Disbursement", the reject placeholder "Explain why this disbursement is being rejected", the helper "authorized this disbursement", and the yellow "n disbursements awaiting approval" chip) | No. Phase 1 wrote "Disbursement approved." and the 409 toast already uses the right noun. It is a wording inconsistency, not a failure, and the `noun` prop is already in both dialogs. | **Fold into Increment 2.** Increment 2 rewrites the same strings (F5), so one pass is cheaper than a patch now and a second edit then. It is under the absorb threshold, so the Phase 3 addendum should list it rather than re-open design. |
| **F2.** Sweep cards omit entity names ("Charitable Fund → Activity Fund") | No. Phase 1 asked for the chip and from to; entity name was specified for the history rows only. | **Fold into Increment 2.** The history cards add entity names anyway, and `getPendingApprovals()` has its select list edited in Increment 2 (rejected stamp), so the pending cards can take the same field with no extra pass. A cross-entity money movement approved on a phone is the place where "which book is this" matters most. |
| **F3.** No thousands separator ("$2275.00") | No. Pre-existing, never in Phase 1. | **Fold into Increment 2.** The page-local `formatDollars()` is the one function both the pending cards and the new history cards will use; fix it once there, with a test. The reported item was $2,275, so this is visible to the reporter. If Increment 2 slips, it is a one-line backlog item. |
| **F4.** Fine-pointer autofocus unverified | No defect shown. The logic is one `matchMedia` guard and an effect that runs after Radix's own first focus, so it should win; headless Chromium cannot prove it. | **Not a gate; one human glance.** Before or just after the push, open Approve on a laptop: the minute field should have the cursor. If it does not, that is a regression against the old `autoFocus` and becomes a same-day fix; no tracked item unless it fails. |
| **15 vs 16 recipients** | No. Increment 1 did not touch `getEmailsForFeature()`; both E-1 blocks use the same approver list as before. | **No action.** Believed (not established): the 16-recipient run included the `qaboard` fixture user (a `board_member`), which QA's cleanup deleted before the 15-recipient run. QA found 15 sends, 15 log lines and 15 queued rows, so nothing was dropped between route and queue. Not worth chasing. |

## Follow-ups (SHIP WITH NOTES)

Each becomes a line in the Increment 2 Phase 1/3 hand-off or its own backlog entry; none blocks pushing Increment 1.

- **F1 to F3 (fold into Increment 2):** noun-correct copy for Transfer and Sweep everywhere the dialogs, toasts, helper text and the count chip say "disbursement"; entity name on pending cards; thousands separator in the page's money formatter. Tests: `approvalFailureAction` and the toast noun for each kind; a formatter test for 2275 and 1234567.
- **F4 (human check):** fine-pointer autofocus on a real laptop, plus one look at the page on a real phone. These are the two things headless QA cannot see.
- **F5 (Increment 2 string and branch changes, already in my multiple-approver addendum C3, repeated here so it is not lost):**
  1. `describeApprovalConflict` "approved by someone else" line: "Only one approval is needed." must go (it is false once co-signing exists); the Increment 2 text is "<Name> already approved this <noun>. You can add your approval too."
  2. `approvalFailureAction` 409 branch for `decision: "approved"` and not `decidedByViewer`: today close, refresh, toast; Increment 2 also `router.replace`s to `/admin/ledger/approvals?txn=<id>` so the person lands on the banner with the Add your approval button.
  3. `ApprovalConflictBody` for a rejection: `deciderName` is always null and `decidedByViewer` always false in Increment 1; Increment 2 reads `rejected_by_user_id` / `rejected_at` in `conflictFromRow()` and `lookupApproverName()` becomes decider-generic.
  4. The empty-state sub-line, the `h1`, the "Pending Approvals" description and the footer line ("Once approved, they are locked") are Increment 1 wording; Increment 2 renames the `h1` to "Approvals" and adds the "See recently decided" button.
  5. `buildPendingApprovalEmailHtml()` gains the `?txn=<expense-leg id>` link and the one-approval sentence (reworded for co-signing) in the same delivery as the co-sign UI, never before.
- **Copy the club may want to tune:** "You recorded this, so another board member must decide it.", "Add a minute reference to enable Approve.", "Nothing is waiting for approval".
- **Proposed backlog — filed as B-161 by the orchestrator 2026-10-10 (Later).** *The pending-approval email goes to the person who recorded the entry.* `getEmailsForFeature(LEDGER_APPROVE)` has no recorder exclusion, so a recorder who also holds `ledger.approve` (an admin, or the treasurer through Board membership) is told something is "pending your approval" that they are not allowed to decide. Exclude the recorder (and keep the treasurer CC rule unchanged), or word the email for that case. Origin: this work-log, Phase 6 review of the E-1 recipient list.

## Red Flags (if NEEDS REWORK)

None. No flow regressed, no gate weakened, no brand rule broken, no raw error text reaches the user, and nothing in the diff widens `ledger.view`.

## Phase 6 — Shipped vs Intent — Increment 1 — 2026-10-10

**Owner:** analyst
**Status:** complete (Increment 1). Pipeline stays open for Increment 2.

### Summary
SHIP WITH NOTES. The reporter's situation is resolved: at 390px a board-only member sees and can use Approve and Reject, the lost-race path names the colleague, and the decision is race-safe. No fix-before-push items; F1 to F3 fold into Increment 2, F4 is a one-minute human check, F5 is the stale-string hand-off for Increment 2.

### What I did
- Re-read the whole work-log (Origin, Phase 1 and addendum, production facts, user decisions, Phase 2 and 3 rulings, both Phase 4 Increment 1 handoffs, Phase 5 and the O-1 resolution).
- Read the page, the card, actions, fund label and dialog-context components, both dialogs, `approval-dialog-logic.ts`, the carrier, `decideTransaction()`, both routes and the E-1 and email-builder diffs; viewed the before and after phone screenshots, the 360 dialog, the 1280 table, the 409 result and the empty state.
- Decided each QA observation and the recipient-count difference.

### Outputs
- This work-log only (Phase 6 section replaces the template stub; status row 6 updated). No code, no database, no email, no edits to release notes, `package.json`, `docs/decisions.md` or `docs/backlog.md`.

### Open questions / handoff notes
- Orchestrator: push Increment 1 (via `/pre-push`) after the user has had a chance to glance at the autofocus (F4); use the release-notes blurb below. Status row 5 still reads "O-1 open"; it can drop that text now.
- Increment 2: carry F1 to F3 and F5 into the Phase 3 addendum; the multiple-approver Q1 confirmation to the user is still outstanding.
- Proposed backlog text above (recorder receives their own pending email): ID to be reserved by the orchestrator.

### Release-notes blurb (for the orchestrator; user-facing only)
The Approvals page now works on a phone. Board members opening a pending disbursement from the email link see each item as a card with large Approve and Reject buttons, instead of a table that hid them off the edge of the screen. The Approve and Reject windows now show the fund, memo and who recorded the entry, and Approve explains why it is greyed out until a board-minute reference is entered. If a colleague approves or rejects an item while you are looking at it, the window closes, the list refreshes and a message says who acted, and two board members can no longer both record an approval for the same item. If you recorded an entry yourself, the page says another board member must decide it instead of offering buttons that would not work. Notification emails for pending disbursements also now display payee and memo text safely.

## Increment 1 shipped (orchestrator, 2026-10-10)

User approved commit and push in their own words ("commit and push"). Commit `4730983` on `main` (v1.89.0), pushed to origin. The 2026-10-09 closing-balance work-log rode along as announced. User did not answer the quorum question in the same message; the no-quorum default from "Gating" stands and 2b stays unstarted. Increment 2a Phase 4 opens now with database-admin (T11 satisfied). Migration numbers re-derived at the schema step: newest on disk is `0110_treasurer_permission_baseline.sql`.

## Phase 4 — Increment 2a (database-admin) — 2026-10-10

**Owner:** database-admin
**Status:** complete (schema step); see the tsc note under Tests and gates

### Summary
Added the two nullable rejection-attribution columns to `ledger_transactions` and the idempotent migration that matches them. Both migration replays against the local dev database succeeded, the live columns and FK match `schema.ts`, and the new static test is green. Typecheck now fails in two places that are the expected type fallout the design predicted; they belong to api-developer's step (d).

### What I did
- Re-derived the migration number: newest on disk was `0110_treasurer_permission_baseline.sql`, so the new file is **`0111`**.
- `src/lib/db/schema.ts`: added `rejectedByUserId` (uuid, FK `users.id`, `ON DELETE SET NULL`) and `rejectedAt` (`timestamp`, no timezone, like `approvedAt`) directly after `rejectionReason`.
- Created `drizzle/migrations/0111_ledger_rejection_attribution.sql`: two `ADD COLUMN IF NOT EXISTS`, then a `DO $$` block adding `ledger_transactions_rejected_by_user_id_users_id_fk` only when absent from `pg_constraint`, `ON DELETE SET NULL`. No index, no back-fill, no NOT NULL, no default.
- Created `src/lib/ledger-approval-schema.test.ts` (5 tests; model `ledger-ack-donee-migration.test.ts`).
- Applied to the local dev DB (`DATABASE_URL` from `.env.local` only; PROD_DATABASE_URL not touched; nothing under `scripts/` run).

### Outputs
- `src/lib/db/schema.ts` (two columns on `ledgerTransactions`)
- `drizzle/migrations/0111_ledger_rejection_attribution.sql` (every statement idempotent; the repo grep for unguarded CREATE TABLE / ADD COLUMN / INSERT INTO / CREATE INDEX returns nothing)
- `src/lib/ledger-approval-schema.test.ts`
- Tables affected: `ledger_transactions`. No role bindings or seed rows.
- Local apply: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`

### Tests and gates
- `pnpm db:migrate` run 1: succeeded; `0111_ledger_rejection_attribution.sql` applied (columns created).
- `pnpm db:migrate` run 2: succeeded; NOTICE "column rejected_at ... already exists, skipping" (idempotence proven).
- Live check after replay: `rejected_by_user_id uuid NULL`, `rejected_at timestamp NULL`, no defaults; constraint `ledger_transactions_rejected_by_user_id_users_id_fk` present with `confdeltype = 'n'` (SET NULL).
- `pnpm db:push` (no `--force`, non-TTY): did NOT reach a clean "no changes". It stopped on an interactive prompt about an unrelated, pre-existing drift: schema.ts wants `ledger_entities_slug_unique` but the dev DB has `ledger_entities_slug_key` (2 rows). Nothing in the diff output concerned `rejected_by_user_id` / `rejected_at`, and the live column and FK check above matches schema.ts. I did not run `--force` (it would auto-approve that unrelated change on dev). The orchestrator may want to look at that drift before the deploy build runs `push --force`; it is not caused by this increment (it exists on `main`).
- `pnpm exec vitest run src/lib/ledger-approval-schema.test.ts`: 5/5 pass.
- `pnpm exec tsc --noEmit`: **2 errors, both expected type fallout** (Phase 3 Data Model: "`getPendingApprovals()` ... must gain the two fields; typed fixtures stop compiling"): `src/lib/ledger-queries.ts` line ~3725 (`getPendingApprovals` return lacks `rejectedByUserId`, `rejectedAt`) and `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.test.tsx` line 49 (fixture lacks the same two fields). Left untouched: the first is api-developer step (d); the second is a fixture api-developer/ux-developer adds `rejectedByUserId: null, rejectedAt: null` to.
- Migration grep gate: empty.

### Deviations from the design
- None to the schema or SQL. The "tsc clean" gate and the "push reports no diff" check are not literally met for the two reasons above (expected fallout; unrelated pre-existing slug-constraint drift).

### Open questions / handoff notes
- **Migration filename for api-developer: `drizzle/migrations/0111_ledger_rejection_attribution.sql`.**
- New columns on `ledger_transactions`: `rejectedByUserId` (uuid, nullable, FK users, set null) and `rejectedAt` (naive timestamp, nullable). Stamp both legs of a pair in the reject UPDATE; never reuse `approvedAt`.
- api-developer must: add the two fields to `getPendingApprovals()` select list (clears the tsc error there) and to the donor-detail test fixture (clears the other).
- Orchestrator: announce the dev-server restart (schema changed). Next agent: api-developer, step 2(a).

### Orchestrator: dev-server restart after the 2a schema step (2026-10-10)

The `:3000` dev server was stopped and restarted after migration `0111_ledger_rejection_attribution.sql` landed (log: scratchpad `dev-restart-2a.log`; replayed the migration a third time at start, 200 on `/`). Every live check from here runs against the restarted server.

The `drizzle-kit push` prompt database-admin hit (`ledger_entities_slug_unique` expected, `ledger_entities_slug_key` live) is **pre-existing and not this diff**: `ledgerEntities.slug` has carried an unnamed `.unique()` since the Ledger landed, while its migration named the constraint `_key`. Every deploy since has run `push --force` over it without incident, so it is not a gate for this pipeline. Logged for the next code review rather than fixed here (a rename inside a feature pipeline is unrelated scope).

## Phase 4 — Increment 2a (api-developer) — 2026-10-10

**Owner:** api-developer
**Status:** complete (step 2, items a to g plus the A9 helpers). ux-developer is next.

### Summary
Delivered the whole 2a server side: carrier additions, the board-decision predicates, reject attribution (both legs, 409 names the rejector), pending-row entity names, the approver-only History and deep-link queries, the callback guard with its three consumers, the expense-leg id on Transfer/Sweep create, and the email link plus sentence. tsc is clean, `pnpm test` is green (197 files, 3470 tests), lint shows only the one pre-existing warning (`budget-context-panel.tsx`, not touched). No page, dialog, `RowHighlighter` or component file was edited; the dialog-copy helpers exist but are not yet wired.

### What I did
- (a) `src/lib/ledger-approval.ts` (client-safe, no imports): `RECENT_DECISIONS_LIMIT`, `APPROVAL_TABS`/`ApprovalTab`/`parseApprovalTab`, `formatDecisionDateTime`, `formatApprovalDollars`, `approvalNounLabel`, `describePendingCount`, `DecidedApprovalRow`, `ApprovalTargetState`, `ApprovalBannerModel`, `buildApprovalBanner`; `describeApprovalFund` gained optional `entityName`/`partnerEntityName`; `describeApprovalConflict` gained the rejected-by-viewer row.
- (b) `src/lib/ledger-board-decision.ts`: `boardApprovalPredicate`, `boardDecisionPredicate`, one private `postedBoardHalf()`; no runtime `db` import.
- (c) `ledger-approval-decision.ts`: reject UPDATE stamps `rejectedByUserId` + `rejectedAt` (same `now` as `updatedAt`) on both legs, never `approvedAt`/`approvedByUserId`; `conflictFromRow` reads `rejectedAt ?? updatedAt` and `decidedByViewer` for the rejector; `lookupApproverName` became exported `lookupDeciderName` (separate select, no join). 409 strings and `ApprovalConflictBody` unchanged.
- (d) `getPendingApprovals()` select list gained `rejectedByUserId`, `rejectedAt`; `PendingApprovalRow` gained `entityName`, `partnerEntityName` from one `ledger_entities` select into a Map. Fixed the two tsc errors database-admin left (the query and the donor-detail fixture).
- (e) `src/lib/ledger-approval-queries.ts` (approver-only): `getRecentDecisions(viewerUserId)`, `resolveApprovalTarget(rawTxn, viewerUserId)`, one private `selectDecided`.
- (f) `src/lib/safe-callback-path.ts`; `src/proxy.ts` now sets `callbackUrl` from `pathname + search`; signin and register compute `getCallback()` at event time.
- (g) `transactions/route.ts`: Transfer/Sweep insert `.returning({ id, flow })`, 201 carries `id` (expense leg); both E-1 blocks use new `buildApprovalReviewUrl(id)`; `buildPendingApprovalEmailHtml` appends the 2a sentence unconditionally. Both `console.error` catches untouched; `auth()` + `hasFeature()` still first.
- A9: dialog-copy helpers in `approval-dialog-logic.ts` (F1); F2 data, F3 formatter and `describePendingCount` are in the carrier and query (see above). F5.4 (h1 "Approvals", empty-state link) is page work and stays with ux-developer.

### Contracts ux-developer consumes
Import everything client-side from `@/lib/ledger-approval` (types and pure helpers) and `@/components/admin/ledger/approval-dialog-logic`.

- **Banner:** `buildApprovalBanner(state: ApprovalTargetState): ApprovalBannerModel` where `ApprovalBannerModel = { tone: "info" | "success" | "neutral"; text: string; linkHref?: string; linkLabel?: string }`. `linkHref` is `/admin/ledger/approvals?tab=decided&txn=<row.id>` and `linkLabel` "See it under Recently decided" for `decided` states only. Plain text only; render as React text.
- **`ApprovalTargetState`:** `{state:"not_found"} | {state:"pending"; rowId; kind; isOwn} | {state:"decided"; row: DecidedApprovalRow} | {state:"not_board_decision"; kind}`. Highlight id: `rowId` for pending, `row.id` for decided.
- **`getRecentDecisions(viewerUserId): Promise<DecidedApprovalRow[]>`** (throws on DB failure; page must catch). `DecidedApprovalRow` = base `{ id, kind, decidedAt (ISO string), deciderName | null, deciderIsViewer, amountCents, txnDate, party, memo, fundName, partnerFundName, entityId, partnerEntityId, entityName, partnerEntityName, recorderName }` plus `{decision:"approved"; boardMinute: string}` or `{decision:"rejected"; deciderOnFile: boolean; rejectionReason: string | null}`. `entityName`/`partnerEntityName` are short names ("Club", "Foundation", falling back to the full name). No user id appears anywhere (test walks the keys).
- **`resolveApprovalTarget(rawTxn: string, viewerUserId: string): Promise<ApprovalTargetState>`**: non-UUID returns `not_found` with no DB call; a DB failure throws (page wraps in its own try/catch).
- **Page-only importer:** `ledger-approval-queries` must be imported only by `approvals/page.tsx` (scan test enforces).
- **Pending rows:** `PendingApprovalRow` now has `entityName`, `partnerEntityName` (string | null) and `rejectedByUserId`/`rejectedAt`. Pass them to `describeApprovalFund({... entityName, partnerEntityName})`; a Sweep then reads "Charitable Fund (Foundation) → Activity Fund (Club)". For non-sweep kinds show `entityName` as secondary text yourself.
- **Helpers:** `RECENT_DECISIONS_LIMIT`, `APPROVAL_TABS`, `ApprovalTab`, `parseApprovalTab(raw: string | string[] | undefined)`, `formatDecisionDateTime`, `formatApprovalDollars`, `approvalNounLabel`, `describePendingCount`; in dialog-logic: `approvalDialogTitle(verb, noun)`, `approvalSuccessMessage(verb, noun)`, `rejectPlaceholder(noun)`, `minuteHelper(noun)`, and one I added, `minuteRequiredMessage(noun)` (the `toast.error` string in `approve-dialog.tsx`). The dialogs still use their old strings until wired.
- **Routes:** `POST /api/admin/ledger/transactions` Transfer/Sweep 201 is `{ id, transferGroupId, derivedFiscalYear, status }` (`id` = expense leg; omitted only if the insert returned no expense row). Approve/reject routes unchanged; a reject 409 now carries the rejector's name, and `decidedByViewer` is true for a rejector's double-click ("You already rejected this sweep.").

### Tests (all passing)
New files: `ledger-board-decision.test.ts` 7, `ledger-approval-queries.test.ts` 21, `safe-callback-path.test.ts` 25, `src/proxy.test.ts` 5. Extended: `ledger-approval.test.ts` 36, `ledger-approval-decision.test.ts` 36, `ledger-queries.test.ts` 107 (+2 for `getPendingApprovals`), `email-compose.test.ts` 21, `email-queue-view.test.ts` 11 (UUID `?txn=` left readable), `transactions/route.test.ts` 35 (+4: ordinary link, Sweep 201 id and link, under-threshold Transfer id, no-expense-row fallback), `approval-dialog-logic.test.ts` 16. Database-admin's `ledger-approval-schema.test.ts` 5 untouched. Full suite: 197 files, 3470 tests, 0 failures. Not mine (ux-developer): `row-highlighter.test.tsx`, `approval-history.test.tsx`.

### Outputs (files)
Created: `src/lib/ledger-board-decision.ts`, `src/lib/ledger-approval-queries.ts`, `src/lib/safe-callback-path.ts`, and their tests plus `src/proxy.test.ts`.
Modified: `src/lib/ledger-approval.ts`, `src/lib/ledger-approval-decision.ts`, `src/lib/ledger-queries.ts`, `src/lib/email-compose.ts` (new `buildApprovalReviewUrl`), `src/app/api/admin/ledger/transactions/route.ts`, `src/proxy.ts`, `src/app/signin/page.tsx`, `src/app/register/page.tsx`, `src/components/admin/ledger/approval-dialog-logic.ts`, the test files above, and the donor-detail fixture. No migration added (0111 is database-admin's).

### Deviations from the design
1. **`buildApprovalReviewUrl()` added to `email-compose.ts`** (about 5 lines) so the two E-1 call sites do not repeat the app-URL plus path plus `?txn=` composition (the duplication rule). Under the absorb limit.
2. **`minuteRequiredMessage(noun)`** added beside the four named dialog helpers, for the one remaining hard-coded "disbursement" toast. Under the absorb limit.
3. **`describeApprovalConflict` has no `verb` parameter yet**: T5's verb argument is a 2b change and unused code in 2a.
4. **Entity names use short names** (`shortName ?? name`) in both `getPendingApprovals()` and the History, so the Sweep text matches the design's "(Foundation)/(Club)" example.
5. Register page: only the Google `signIn` uses the guard, per A6's summary (the post-register pushes are B-155).
6. The importer scan in `ledger-approval-queries.test.ts` and the R9 assertion pass vacuously until `approvals/page.tsx` exists; they become strict when ux-developer adds the import.

### Open questions / handoff notes
- Next agent: **ux-developer** (page, tabs, banner, History, `RowHighlighter` `persistent`, F1 wiring through the new helpers, `ApprovalFundLabel` names, F5.4, `approval-history.test.tsx`).
- Queue view: `redactQueuedEmailHtml` leaves `?txn=<uuid>` readable (test-pinned); L3 live check is qa's.
- The `/members` redirect for open-redirect inputs on a password sign-in runs through `getCallback()` inside the submit handler; qa click-through 4 covers it live.
- I did not touch the dev server, `docs/decisions.md`, `docs/backlog.md`, `package.json` or release notes.

## Phase 4 — Increment 2a (ux-developer) — 2026-10-10

**Owner:** ux-developer
**Status:** complete. qa (Phase 5) is next.

### Summary
Built the 2a UI: the Approvals page now has Pending / Recently decided tabs, the `?txn=` banner and highlight, the History cards, `RowHighlighter` `persistent`, the F1 noun-correct dialog copy, entity names in `ApprovalFundLabel`, and the F3/F5.4 formatting. A live browser pass against seeded local rows found one real bug in api-developer's `resolveApprovalTarget` (see Deviation 1), which I fixed and pinned with a test.

### What I did
- `approvals/page.tsx`: `searchParams` Promise; order auth, `hasFeature`, `parseApprovalTab`, `Promise.all`, `resolveApprovalTarget` in its own try/catch (`console.error`, no banner), `getRecentDecisions` only on the decided tab in its own try/catch (`historyFailed`). `h1` "Approvals"; count line via `describePendingCount`; `formatDollars` deleted for `formatApprovalDollars`; pending empty state gained the "See recently decided" link-button; the threshold description and footer show on the Pending tab only (decided tab has its own one-line description).
- New flat Server components: `approval-tabs.tsx` (`<nav>` of `<Link>`s, `aria-current`, 44px), `approval-banner.tsx` (`role="status"`, plain text, tone classes, 44px link), `approval-history.tsx` (one card per row at every width, also exports `deciderLabel`). New tiny `approval-highlight.ts` holds the shared `HIGHLIGHT_CLASSES`.
- Highlight: `highlightId` is passed only when the target row is on the tab being rendered (pending list contains it, or the 25 contain it). Card, table row and History card server-render the ring with `tabIndex={-1}`; `bg-white` is swapped out (not stacked) when highlighted. `RowHighlighter` is mounted in `<Suspense fallback={null}>` with `persistent`.
- `row-highlighter.tsx`: logic extracted to exported `findVisibleRow` and `runRowHighlight` (testable in the node env, since the repo has no jsdom). Default mode and both existing call sites unchanged; `persistent` scrolls and focuses the first visible `[data-row-id]` only.
- F1: both dialogs use `approvalDialogTitle`, `approvalSuccessMessage`, `rejectPlaceholder`, `minuteHelper`, `minuteRequiredMessage`. F2: `ApprovalFundLabel` takes `entityName` (secondary text for every kind except sweep, whose text already names both books); card and table pass it; `describeApprovalFund` gets both entity names.

### Outputs (files)
Created: `src/components/admin/ledger/approval-tabs.tsx`, `approval-banner.tsx`, `approval-history.tsx`, `approval-highlight.ts`, `approval-history.test.tsx`, `approval-fund-label.test.tsx`, `row-highlighter.test.tsx`.
Modified: `src/app/(dashboard)/admin/ledger/approvals/page.tsx`, `approval-card.tsx`, `approval-fund-label.tsx`, `approve-dialog.tsx`, `reject-dialog.tsx`, `row-highlighter.tsx` (all under `src/components/admin/ledger/`), `src/lib/ledger-approval-queries.ts` (bug fix), `src/lib/ledger-approval-queries.test.ts` (importer scan made strict, plus one new test).

### Tests and gates
- `pnpm exec tsc --noEmit` clean. `pnpm test`: 200 files, 3497 tests, 0 failures (was 197/3470; new: history 13, fund-label 4, row-highlighter 7, queries +1).
- `pnpm lint`: 0 errors, only the pre-existing `budget-context-panel.tsx` warning. `pnpm build:only` passes. No `console.log`, no native dialogs. The two scan tests api-developer flagged are now strict (`importers` equals exactly the page) and pass.

### Browser verification (local dev DB, e2e admin, Playwright headless; dev server untouched)
Seeded 8 local rows tagged `UXTEST` (approved by other and by me with a very long unbroken minute, rejected with stamp and a 60-word reason, legacy rejected, pending not-own, pending own, a Foundation to Club Sweep pair). **Cleanup: all 8 deleted, 0 `UXTEST` rows remain.**
- Pending tab: h1 "Approvals", tabs "Pending (3)" / "Recently decided", "3 items awaiting approval", Sweep card reads "Charitable Fund (Foundation) → Activity Fund (Club)", plain rows show "Club" as secondary text.
- Decided tab at 390px: four cards, no horizontal scroll, long minute and reason wrap in full, "Approved by You", "Approved by {name}", "Rejected, decider not on file" with the legacy row dated by `updated_at`; Eastern times.
- `?txn=` for every state (approved other/me, rejected other/legacy, pending not-own/own, sweep expense leg, sweep income-leg id resolving to the expense row): correct banner text, target focused, ring still present after 3.5 s, URL unchanged (no `router.replace`). A decided id viewed on the Pending tab shows the banner with the "See it under Recently decided" link. `?txn=not-a-uuid`, `'; select 1`, a 5,000-char value and an unknown UUID: HTTP 200, "We can't find that disbursement" banner, input not echoed in visible text. `?tab=bogus` falls to Pending.
- Dialogs: Sweep Approve title "Approve Sweep"; Reject placeholder "Explain why this sweep is being rejected…".
- Widths 390, 1024, 1279, 1280: no horizontal scroll; at 1024/1279 the card is the visible variant and at 1280 the table row is, and focus lands on the visible one. Next dev "1 Issue" badge is the pre-existing CSP-eval and logo-aspect console messages, not a hydration warning from this page.

### Deviations from the design
1. **Bug fix in api-developer's `resolveApprovalTarget` (about 8 lines, `ledger-approval-queries.ts`).** drizzle renders a top-level column of a single-table select unqualified, so inside the correlated subqueries (`FROM ledger_transactions d` / `v`) `${t.transferGroupId}` and `${t.id}` bound to the INNER table: `viewerRecorded` was always true (every pending banner said "You recorded this") and the partner lookup matched any income row (a plain disbursement was called a "transfer"). Mocked unit tests cannot see this; the live pass did. Fixed with hand-qualified `"ledger_transactions"."id"` / `"transfer_group_id"` and pinned by a source-scan test. Under the absorb limit; flagging for api-developer awareness. The History (`selectDecided`, which uses joins) was unaffected.
2. `approval-highlight.ts` (shared class constant) and the exported `findVisibleRow`/`runRowHighlight` are small additions for dedupe and testability.
3. The pending-tab description and footer are hidden on the decided tab; decided tab gets "The most recent board decisions, newest first." (new copy).
4. The footnote always shows on a non-empty History (design wording), even with fewer than 25 rows.

### Open questions / handoff notes for qa
- Click through: `/admin/ledger/approvals` both tabs, each `?txn=` state, the Pending empty state link, 360/390/1024/1279/1280. Every `?txn=` check must run against real Postgres: the resolver bug above only showed there (qa click-through 3 and the discriminator fixtures cover it).
- At 1280 the table row ring renders as gold top/bottom lines plus the tint (box-shadow on `<tr>`); acceptable, but look at it.
- New copy for the club to refine: decided-tab description, "Try again" failure link, "Approved by You".
- Page has two `h1`s (the admin layout's "Admin" plus the page's); pre-existing pattern, so qa selectors should use `h1.text-3xl`.
- Not exercised live (needs two sessions or a failing query): double-click 409 "You already rejected", `historyFailed` card (covered statically by tests only), Google callback round trip.


## Phase 5 — Verification — Increment 2a — 2026-10-10

**Owner:** qa
**Status:** complete (Increment 2a). Increment 2b is not in this tree and was not verified.
**Scope:** Increment 2a only: reject attribution (migration 0111), Recently decided, the `?txn=` banner and highlight, the sign-in callback guard, the email deep link and the F1 to F3 / F5.4 follow-ups.
**Tree measured:** `main` at `4730983` plus the uncommitted 2a working tree (40 entries in `git status --short` before qa; `git status` was byte-identical before and after `pnpm build:only` and after the coverage run). qa added one untracked file, `e2e/ledger-approvals-history.spec.ts`. No concurrent pipeline touched these files. Dev server :3000 (pid 1189, started 19:42 after the schema step) was not touched; its process environment carries neither `EMAIL_DEV_ALLOWLIST` nor a key, and `.env.local` has `RESEND_API_KEY=` blank and no allowlist.

### Summary

**Verdict: PASS** for Increment 2a. Every gate is green, every unit test the 2a design names exists and passes, and the live pass against real Postgres found no defect in the shipped tree: reject stamps both legs of a Transfer/Sweep pair with rejector and time and never touches `approvedAt`; Recently decided shows exactly the board decisions (25 cap, newest first, stable on ties, reimbursement-stamped and under-threshold-Sweep rows out); every `?txn=` state renders the right banner (the correlated-subquery fix the ux-developer made holds against real data); the signed-out deep link survives the password sign-in; the email carries `?txn=<expense-leg id>` and the one-approval sentence and the queue view leaves the UUID readable. Three items are recorded as not fully testable locally (see "Not testable here"): the Google round trip, the failed-history card, and a regression run against pre-fix code.

### What I did

**Gates (measured on the tree above)**

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS (exit 0, no output; re-run after the last spec edit, still 0) |
| `pnpm lint` | PASS: 0 errors, 1 warning, `src/components/admin/ledger/budget-context-panel.tsx:114` "unused eslint-disable directive" (pre-existing, not this diff). My own spec had one unused-variable warning mid-run; removed. |
| `pnpm test` | PASS: **200 files, 3497 tests passed, 0 failed**, 4.0s (the ux-developer's count, reproduced). `admin-page-feature-gates.test.ts` is inside it. |
| `pnpm build:only` | PASS: exit 0, compiled successfully, 125/125 static pages, 272 route lines, zero "warn" lines; :3000 stayed 200 throughout. |
| Migration replay | `export $(grep -E "^DATABASE_URL=" .env.local \| xargs) && pnpm db:migrate`: "Migrations completed successfully"; the only 0111 output is two NOTICEs "column rejected_by_user_id / rejected_at ... already exists, skipping" (a no-op). Live FK: `FOREIGN KEY (rejected_by_user_id) REFERENCES users(id) ON DELETE SET NULL`; columns `rejected_by_user_id uuid`, `rejected_at timestamp without time zone`. |
| Pre-push idempotence grep on `0111_ledger_rejection_attribution.sql` (`grep -nE "^\s*(CREATE TABLE \|ALTER TABLE [^ ]+ ADD COLUMN \|INSERT INTO \|CREATE INDEX )" ... \| grep -vE "IF NOT EXISTS\|ON CONFLICT\|WHERE NOT EXISTS"`) | empty. The FK sits inside a `pg_constraint`-guarded `DO $$` block. |
| `e2e/ledger-approvals-history.spec.ts` (new; whole suite NOT run, the orchestrator runs it at pre-push) | PASS: **54/54** in 2.2 min, single worker. Run together with the Increment 1 spec `e2e/ledger-approvals-mobile.spec.ts`: **66/66** (54 + 12), 2.8 min, so Increment 1 behaviour still holds under the 2a tree. |

**Unit tests the 2a design names: all present and passing** (verified by listing the 15 relevant files verbosely, 352 tests, 15/15 files; nothing missing). By file: `ledger-approval-schema.test.ts` 5 (idempotent ADD COLUMN, FK only inside the `pg_constraint` guard, FK name equals drizzle's derived name with SET NULL, both columns nullable no default, no NOT NULL / DEFAULT / UPDATE); `ledger-board-decision.test.ts` 7 (rejected branch, reimbursement exclusion, keyed on `approved_at` not the approver id, single definition, no runtime `db` import, R9 scan); `ledger-approval-decision.test.ts` (rejected-with-stamp names the rejector, legacy falls back to `updatedAt` with a null name, reject double-click `decidedByViewer`, approve-then-reject and reject-then-approve races, `lookupDeciderName` variants, the UPDATE `.set` carries `rejectedByUserId` and never `approvedAt`); `ledger-approval.test.ts` (`formatDecisionDateTime` Eastern and each side of a DST change, `parseApprovalTab`, `formatApprovalDollars`, `approvalNounLabel` / `describePendingCount`, `describeApprovalFund` with and without entity names, "You already rejected", every `buildApprovalBanner` row, no output contains "@"); `ledger-approval-queries.test.ts` 22 (importer allow-list, history query shape, row mapping including no `*UserId` key at any depth, `resolveApprovalTarget` for every state, non-UUID never touches the DB, failure rejects, plus the new source-scan pinning the hand-qualified subquery columns); `safe-callback-path.test.ts` 25 and `src/proxy.test.ts` 5; `route.test.ts` (Sweep 201 carries the expense-leg id, ordinary and Sweep emails link `?txn=`, an under-threshold Transfer still returns the id and sends nothing, no-expense-row fallback to the plain URL); `email-compose.test.ts` (sentence appended unconditionally, `buildApprovalReviewUrl`); `email-queue-view.test.ts` (UUID `?txn=` left readable); `approval-dialog-logic.test.ts` (titles, success messages, placeholder, helper per noun, no "disbursement" for Transfer/Sweep); `row-highlighter.test.tsx` 6 (default mode adds then removes the ring and strips `highlight`; `persistent` never mutates classes or the URL and picks the visible match); `approval-history.test.tsx` 13 and `approval-fund-label.test.tsx` 4; `ledger-queries.test.ts` (`getPendingApprovals` entity names, Sweep partner, rejection columns selected).

**Manual click-through, dev server :3000, local dev DB.** Driven by Playwright against real Postgres (headless Chromium, the real credentials form, the real routes), written as the spec so it re-runs. Viewer is the e2e admin; other deciders are example.invalid fixture users who never sign in. Decision times are fixed in 2090 so the fixtures outrank anything else in the newest-25 list. Dev-DB state at start: 285 `ledger_transactions`, 0 pending, 0 rejected, 0 with `approved_at` (so the History is deterministic).

| Flow | Result | Observed |
|---|---|---|
| Reject stamps both legs (L5, DB assert) | pass | Rejecting a pending Sweep from the card (390px): toast "Sweep rejected."; both legs `status = rejected`, `rejected_by_user_id` = the admin, `rejected_at` within 2 minutes of the click and **identical on both legs**, `approved_at` and `approved_by_user_id` NULL, reason stored in full (60 words). Recently decided shows **one** card for the pair: "Rejected by You", reason in full, "Foundation" and "Club" both named. |
| Reject double-click, API rate (L5) | pass, **5/5** | Five fresh Sweeps, two simultaneous POSTs from one session each: always one 200 and one 409 `{code: not_pending, decision: rejected, decidedByViewer: true, deciderName: <the admin's display name>}`, no "@" in any body, both legs stamped by the winner, no approval stamp ever. |
| "You already rejected" toast (UI) | pass | Dialog open on a pending Sweep, the same user rejects it through the API (the first click), then the dialog's Reject is clicked: the toast reads "You already rejected this sweep.", the dialog closes, and the second click wrote nothing (reason still the first click's). |
| Recently decided: contents and order | pass | Nine decisions in exact newest-first order across approved, rejected, legacy and both entities: deleted-approver row (appears, "Approved by a board member"), approved by another ("Approved by QA History Board", $2,275.00, "Jun 8, 2090 at 12:00 PM", the 127-character unbroken minute in full), "Approved by You", rejected by another (60-word reason in full), "Rejected by You", legacy rejection with no stamp ("Rejected, decider not on file", dated by `updated_at`), an approved Transfer pair as **one** card dated "Jun 2, 2090 at 10:30 PM" (02:30Z is the previous evening in New York), a rejected Sweep pair as one card, a Foundation-entity row. No income-leg card. Footnote shows. |
| Exclusions | pass | A reimbursement-paid row stamped `approved_at` + minute, an under-threshold Sweep with a creation-time minute and no `approved_at`, and a posted expense with no minute are all absent from the History. |
| 25 cap, ties | pass | 26 approved rows (two per timestamp, explicit ids): exactly 25 cards, in (time desc, id desc) order, the oldest cut. |
| `?txn=` banners, one fixture each (19 states) | pass | Pending not-own ("This is the disbursement from your email. It is waiting for a board decision."), pending own, pending Sweep and Transfer by expense-leg id, a pair whose **income leg alone** the viewer recorded ("You recorded this sweep, ..."), approved by someone else (full text with payee and Eastern time, "Only one approval is needed"), approved by the viewer, approved by a deleted account ("A board member"), rejected by someone else with the reason, rejected by the viewer, legacy rejection, approved Transfer and rejected Sweep by **both** the expense-leg and the income-leg id (income id resolves to its pair), a reimbursement-paid row, an under-threshold Sweep, a posted row with no decision (all three: "This entry did not need board approval, so there is nothing for you to do."), and a deleted id ("We can't find that disbursement. ..."). Decided states carry the "See it under Recently decided" link to `?tab=decided&txn=<id>`. HTTP 200 each; no banner contains "@"; no horizontal overflow at 390. |
| The ux-developer's subquery bug, against real Postgres | pass | The plain pending row reads "the disbursement from your email" and never "transfer" or "sweep"; a pending row recorded by someone else never says "You recorded this". Both would have failed under the unqualified-column bug the ux-developer fixed. |
| `?txn=` malformed | pass | `not-a-uuid`, `'; select 1 --`, a 5,000-character value, `<script>window.__pwned=1</script>`: HTTP 200, the not-found banner, the value not echoed in visible text, no script ran. `?tab=bogus` falls to Pending. |
| Highlight (390 at 500px tall, and 1280) | pass | The last pending row in the list: scrolled (`scrollY > 0`), is `document.activeElement`, in the viewport, **ring-2 / ring-lions-gold still present after 3.5 s**, URL unchanged (no `router.replace`). A decided id on the Recently decided tab highlights its card (only one ringed element); a decided id on the Pending tab highlights nothing and shows the link. At 1280 the `<tr>` ring renders as the gold top and bottom lines plus the tint (`shots/highlight-1280.png`), acceptable as the ux-developer predicted. |
| Approve from the card, banner survives refresh | pass | `?txn=<pending>`: approve from the card, toast "Disbursement approved."; after `router.refresh()` the banner changes to "You approved this ..." and the URL still carries `txn`; DB `posted`, `approved_by_user_id` = the admin, no rejection stamp. |
| F1 to F3, F5.4 | pass | Sweep card reads "Activity Fund (Club) → Charitable Fund (Foundation)"; plain row shows "Club" as secondary text; dialog titles "Approve Sweep", "Approve Transfer", "Reject Sweep"; reject placeholder "Explain why this sweep is being rejected…"; no "isbursement" in a Sweep dialog; Cancel changes nothing. $2,275.00 on the 390 card, the 1280 table row and the History card, never "$2275.00". h1 reads "Approvals"; the Pending empty state offers "See recently decided", which opens the decided tab (needs 0 other pending rows; it ran, not skipped). |
| Signed-out deep link, password | pass | `GET /admin/ledger/approvals?txn=<id>` signed out redirects to `/signin?callbackUrl=%2Fadmin%2Fledger%2Fapprovals%3Ftxn%3D<id>` (decodes to the exact path and query); the credentials form lands on the page with `txn` intact and the pending banner. |
| Open-redirect checks | pass | `/signin?callbackUrl=` of `https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:alert(1)`: each lands on `/members` (same origin) after a password sign-in. On `/signin` **and** `/register` the Google button hands NextAuth a same-origin callback: the `authjs.callback-url` cookie decodes to `localhost:3000/admin/ledger/approvals?txn=<id>` for the deep link and `localhost:3000/members` for `//evil.example` and `https://evil.example` (accounts.google.com navigation aborted in the test, so Google was never contacted). |
| Email (L3) | pass | Real recordings through the route as the admin: an ordinary over-threshold expense, a same-fund Transfer (Administrative Checking to Petty Cash), and a Club Activity to Foundation Charitable Sweep. All three 201; the Transfer and Sweep 201 bodies carry `id` (the expense leg). Every queued approver row (each type queued to the approver set) contains `/admin/ledger/approvals?txn=<that id>` and "Only one board approval is needed. If a colleague has already acted, the link will show who."; **every row `blocked_non_production`, zero `sent`**. `/admin/email-queue` > View on the Transfer row: the sandboxed iframe's `srcdoc` contains `?txn=<uuid>` readable (not redacted) and the sentence. |
| `ledger.approve`-less user | pass | A `budget_committee` user (ledger.view, no ledger.approve) opening `?tab=decided&txn=<id>` is redirected away from the page and the rendered text carries neither the decider's name nor the minute. |
| Widths 360, 390, 1024, 1279, 1280 | pass | Banner, tabs and History cards (the longest minute and the 60-word reason) fit with no horizontal scroll at each; exactly one visible variant of a pending row (list item below 1280, `TR` at 1280); the banner box stays inside the viewport. Screenshots in `.../qa-2a/shots/`. |
| Next dev "1 Issue" badge | pass | New test: Pending, Recently decided and both deep-link shapes load with zero console messages matching "hydrat" and zero uncaught page errors (the badge is the dev CSP `eval()` message, as in Increment 1). |
| Dev server log | pass | Across all runs: no `Approvals:` console.error, no `[Ledger email]` failure, no HTTP 500; the only non-2xx are the expected 409s. |

**Not testable here (recorded, not claimed):**
- **L4, the Google round trip.** Needs a real Google account and `accounts.google.com`. Verified locally: the page hands NextAuth the right same-origin callback (cookie assertion above) and the signed-out redirect encodes it once. **Manual, owner: the user, before relying on the Google email-link path:** signed out, open an emailed-style link `/admin/ledger/approvals?txn=<a pending id>`, choose "Sign in with Google", confirm you land on the Approvals page with the banner, not `/members`. Not signed off by qa.
- **The failed-history card.** Inducing a History-only query failure needs a code or schema change (every column the History selects is also read by the Pending query, so any database-level break takes Pending down with it). Static only: `approval-history.test.tsx` "renders the failure state with a reload link", `ledger-approval-queries.test.ts` "rejects when the query fails", and reading `page.tsx` confirms `getRecentDecisions` sits in its own try/catch that sets `historyFailed` and never touches the Pending render, and `resolveApprovalTarget` has its own try/catch that renders no banner.
- **Pre-fix run of the regression tests.** I may not edit app code, so the banner and highlight tests were not run against the pre-fix `ledger-approval-queries.ts`. They are structurally false under the bug (a pending banner for a row recorded by someone else would say "You recorded this", and a plain row would be called a transfer), but "would fail" is argued, not observed.

### Regression tests added

All in `e2e/ledger-approvals-history.spec.ts` (new, qa-owned, 54 tests, seeds and cleans its own fixtures, example.invalid users, serial, real Postgres; also run beside the Increment 1 spec, 66/66):
- `should show a pending banner that distinguishes a plain disbursement from a transfer — regression for the correlated-subquery partner lookup` and the 19 per-state `should show the right banner for ?txn= <state> — regression for the pending banner that always said "You recorded this"` tests: guard the unqualified-column bug the ux-developer fixed, which mocked unit tests could not see.
- `should stamp BOTH legs of a Sweep with the rejector and time when rejected from the page, leave approvedAt null, and show it under Recently decided`, `should answer a reject double-click with a 409 toast that reads You already rejected this sweep`, `should answer 5 of 5 parallel same-user reject double-posts ... (live check L5)`: guard the unattributed rejection.
- `should carry ?txn= through the sign-in redirect and land on the page with the banner after a password sign-in` and the four hostile `callbackUrl` tests plus the two Google-button cookie tests: guard the signed-out redirect dropping the query string and the open redirect.
- `should show exactly the newest 25 decisions in (time desc, id desc) order when 26 exist, with equal timestamps stable`, `should list decisions newest first ...`, `should leave reimbursement-stamped, under-threshold-Sweep and no-minute rows out of Recently decided`.
- `should queue approver emails whose link is ?txn=<expense-leg id> ... (live check L3)`, `should keep the You approved banner after approving from the card (router.refresh)`, scroll/focus/ring-after-3.5s at 390 and 1280, the five width tests, `should render ... with no hydration warning`, the gate test, and the empty-state test.
- The first run of the spec failed one test (45 pass, 1 fail, 6 not run): my own test-order bug, the empty-state test deleted the pending fixtures before the sign-in test needed one; not a product defect. Moved the empty-state test to a final describe. A second run failed one Google-cookie assertion that read the cookie before the click had replaced it; fixed by polling for the expected value. Final: 54/54, run three times in a row green after the last edit (66/66 with the Increment 1 spec).
- qa wrote no additional Vitest (the implementers delivered every named unit test).

### Coverage on critical modules

Whole suite (`vitest --coverage`, `src/lib/**`): 73.95% statements overall (target 70%). New and changed 2a modules: `ledger-board-decision.ts` 100 / 100, `ledger-approval-decision.ts` 97.5 / 92.6, `ledger-approval-queries.ts` 97.5 / 84.2, `ledger-approval.ts` 88.7 / 92.4, `safe-callback-path.ts` 90.6 / 96.6 (statements / branches). `events.ts` 94.9%, `permissions.ts` 100%, `members.ts` 86.8%, all unchanged by this diff and above target. UI components under `src/components` are outside the configured coverage include and are covered by the server-render tests and the e2e spec.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| Page `/admin/ledger/approvals` (now also renders Recently decided and the `?txn=` banner) | yes, first (`redirect("/signin")`) | yes, before any query or `searchParams` use (`redirect("/admin/ledger")`) | `FEATURES.LEDGER_APPROVE`; no key widened, no nav change. History and banner data (names, minute, reason) are produced only by `ledger-approval-queries.ts`, imported solely by this page (source-scan test) |
| `POST /api/admin/ledger/transactions/[id]/approve` | yes, 401 | yes, 403 | `FEATURES.LEDGER_APPROVE` (unchanged) |
| `POST /api/admin/ledger/transactions/[id]/reject` | yes, 401 | yes, 403 | `FEATURES.LEDGER_APPROVE` (unchanged; now stamps the rejector) |
| `POST /api/admin/ledger/transactions` (2a changes: Transfer/Sweep 201 `id`, email link and sentence) | yes, first, 401 | yes, 403 | `FEATURES.LEDGER_RECORD` (unchanged) |
| `src/proxy.ts` | n/a (outer gate) | n/a | only the signed-out `callbackUrl` composition changed (`pathname + search` through `safeCallbackPath`); the derived admin rules are untouched, and the page keeps its own gate |
| Server actions | none added or changed | n/a | n/a |

Verified by reading each file, then by behaviour (a `ledger.view`-only user is redirected and sees nothing; signed-out is redirected with the query preserved). The 409 bodies carry display names only, never an email (asserted).

### Cleanup (local dev DB; production untouched, `PROD_DATABASE_URL` never read, nothing under `scripts/` run, `RESEND_API_KEY` and `EMAIL_DEV_ALLOWLIST` never set)

The spec's `afterAll` deletes every `QATEST E2E Approvals History` transaction, the fixture reimbursement, the three `example.invalid` users and their roles, and the email rows it created (only after confirming none was `sent`). It also ran a `beforeAll` cleanup. Final measured state after the last run: `ledger_transactions` 285 (as at start), 0 pending, 0 rejected, 0 with `approved_at`, **0 rows tagged `QATEST`**; `ledger_reimbursements` 0; `users` 53 (as at start), 0 `qa-history-*` users, 0 orphan `user_roles`; `ledger_audit_log` 826 (as at start; 2a writes no audit rows); `email_queue` 1221 (as at start). One leftover to report: running the Increment 1 spec twice left four "New portal user needs member record review" notices (all `blocked_non_production`; that spec does not clean the email queue); I deleted exactly those four. Visiting `/admin/email-queue` triggers the page's own lazy retention purge, so an `email_queue` count can drop for reasons that are not test cleanup; the count here matched the pre-run value exactly.

### Observations (none blocking)

1. **Card `isSelf` looks at the expense leg only.** For a Transfer/Sweep whose *income* leg alone the viewer recorded, the banner correctly says "You recorded this" (live fixture) while the page's `isSelf` (`txn.recordedByUserId === currentUserId`, expense leg) would still draw Approve and Reject, and the decide route would answer 403 under its either-leg rule. Not exercised in the UI, and unreachable through the app (the route records both legs under one user); only hand-edited data produces it. A one-line consistency follow-up if the orchestrator wants it; pre-existing page logic from Increment 1, not a 2a regression.
2. Increment 1's spec (`ledger-approvals-mobile.spec.ts`) leaves two "New portal user" email rows per run; it could delete them in `afterAll` as the new spec does.
3. New copy the club may want to refine (carried from the ux-developer): the decided-tab description "The most recent board decisions, newest first.", "Try again", "Approved by You", "You recorded this {noun}, so another board member needs to decide it." (it now says "disbursement", "transfer" or "sweep").
4. At 1280 the row ring is gold top and bottom lines plus the tint, not a full ring (box-shadow on `<tr>`); looks fine in `shots/highlight-1280.png`.
5. The `drizzle-kit push` `ledger_entities_slug_unique` vs `_key` drift database-admin hit is pre-existing and already logged by the orchestrator; not re-checked here.

### Outputs

- `e2e/ledger-approvals-history.spec.ts` (new)
- Screenshots, logs, helper SQL wrapper: `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/approvals-mobile-and-history/qa-2a/` (`shots/{decided-360,decided-390,decided-1024,decided-1279,decided-1280,highlight-390,highlight-1280}.png`, `unit-verbose.txt`, `build.log`, `e2e-run*.log`, `e2e-final.log`, `cov/coverage-summary.json`)
- No application code edited, nothing committed; `docs/decisions.md`, `docs/backlog.md`, `package.json` and release notes untouched.

### Open questions / handoff notes

- **Next agent: analyst** for the short 2a confirmation (not the pipeline-closing Phase 6), then Increment 2b begins with database-admin per the Phase 3 addendum.
- **Before the push that ships 2a:** the orchestrator's full `pnpm test:e2e` run covers this spec; the L4 Google round trip above is a manual check for the user, not something qa can sign off.
- Proposed backlog text, if wanted (orchestrator files): "Approvals card `isSelf` should use the either-leg recorder rule the decide route enforces (observation 1)."

**Verdict (Increment 2a): PASS**


## Increment 2a — analyst confirmation — 2026-10-10

**Owner:** analyst
**Status:** complete (short confirmation; not the pipeline-closing Phase 6, which follows Increment 2b)

**Verdict: CONFIRMED WITH NOTES.** Everything 2a was meant to deliver is in the tree and matches Phase 1 intent; the notes below are one hard sequencing constraint (N1) and small items.

### What I did
- Re-read Phase 1 (verbs, flows, the `?txn=` state table, the six answers, N1 to N12), the user decisions, the Phase 3 addendum's rulings and 2a sections, and the four 2a reports (database-admin, api-developer, ux-developer, qa PASS).
- Read the shipped `approvals/page.tsx`, `approval-banner.tsx`, `approval-history.tsx` and `buildApprovalBanner()` in `src/lib/ledger-approval.ts`; re-ran the seven 2a test files that carry the contract (147 tests, all pass). No source, dev server, database, decisions, backlog, `package.json` or release-notes edits.

### Verbs and `?txn=` states

| Phase 1 item | Result | Note |
|---|---|---|
| Verb: tap the email link and land on the specific disbursement | delivered as intended | Email link is `?txn=<expense-leg id>` for ordinary, Transfer and Sweep (Transfer/Sweep 201 now returns the leg id, with a fallback to the plain URL). |
| Verb: signed-out approver signs in and arrives at the disbursement (Flow 4, N3) | delivered as intended (password path); Google path not signed off | Proxy now uses `pathname + search`; one `safeCallbackPath()` guards proxy, signin and register. qa proved the password round trip and that `//evil`, `https://evil`, `/\evil`, `javascript:` land on `/members`. The Google round trip (L4) is a manual check for the user, see N2. |
| Verb: open "Recently decided", see who/when/which minute (Flow 5, scope B) | delivered as intended | `?tab=decided`, cap 25, newest decision first, approved and rejected, pairs once, reimbursement-paid and under-threshold rows excluded, Eastern time, minute and reason in full (wrap, no tooltip), entity name per row, footnote with register/search links, empty and failure cards as specified. Wording difference: the cards read "Approved by You" with a capital Y mid-sentence (Phase 1 said "You approved..." in the banner only). Cosmetic. |
| Verb: read "already approved by X" after a stale click (Flow 3) | delivered with a wording difference | Banner names the decider and Eastern time and links to the History row, as specified. The text still ends "Only one approval is needed, so there is nothing more to do." That is Phase 1 wording and the agreed 2a wording, but it is now contrary to the user's decision to allow multiple approvers. See N1. |
| Verb: approver who recorded the item is told someone else must decide | delivered as intended | "You recorded this {noun}, so another board member needs to decide it." Noun is now kind-correct. Also correct when the viewer recorded only the income leg of a pair (qa fixture). |
| Verb: Reject (Flow 2) now attributed | delivered as intended | Both legs stamped `rejected_by_user_id` and `rejected_at`, `approved_*` never touched (DB-asserted 5/5 under double-click); the 409 names the rejector and reads "You already rejected this sweep." for a double-click. |
| State: pending, not own | delivered as intended | Text as specified; row ringed, scrolled, focused; ring survives past 3.5 s (the Phase 3 "persistent" fix to the 3-second strip). |
| State: pending, own | delivered as intended | |
| State: approved by someone else / by viewer | delivered with a wording difference | Same as above; "You approved this ..." survives `router.refresh()` as the free confirmation Phase 1 wanted. |
| State: rejected (other / viewer / legacy) | delivered as intended | Legacy rejection with no stamp reads "This {noun} was rejected on {date}." Minor: if a typed reason already ends in a period the banner shows a doubled period (the template appends one). Not worth a tracked item. |
| State: Transfer/Sweep by either leg id | delivered as intended | Income-leg id resolves to the pair (19 live states in qa's spec). |
| State: posted, no board decision (reimbursement paid, under-threshold) | delivered as intended | |
| State: deleted / malformed / hostile id | delivered as intended | 200, not-found banner, no 500, input never echoed, `<script>` inert. Wording says "disbursement" even for a deleted transfer id; unavoidable, nothing is known about it. |
| State: viewer lacks `ledger.approve` | delivered as intended | Redirect to `/admin/ledger`; qa confirmed no name or minute leaks. |
| Flow 6 empty Pending tab | delivered as intended | "Nothing is waiting for approval" plus the secondary-style "See recently decided" link-button (Inc 1 deferred this; now shipped). |
| N10 `h1` "Approvals", tabs "Pending (n)" / "Recently decided", `?tab=` whitelisted | delivered as intended | |
| Flow 5 failure: Pending survives a failed history query | delivered as intended (static proof only) | History fetch is in its own try/catch; qa could not induce a History-only failure locally. Code reading and tests are sufficient. |
| N4 race-safe decision, N7 escaping, N5 email sentence | delivered as intended | Race and escaping shipped in Inc 1; the sentence ships in 2a (see N1). |
| Inc 1 hand-offs F1 (noun-correct copy), F2 (entity names), F3 (thousands separator), F5.4 | delivered as intended | Verified live: "Approve Sweep", "$2,275.00" on card, table and History, Sweep card names both books. |

Not delivered in 2a, by design (2b): co-sign ("add your approval"), "also approved by", the replaced race-lost-to-approval landing, and the removal of "Only one approval is needed". Nothing else from the 2a list is missing.

### The user's concerns that 2a covers

1. **No indication a transaction was already approved:** met. A stale-link click now shows who, when, and under which minute (banner), the empty Pending tab no longer says "All expenditures are approved", and the tab shows the decision on its own.
2. **Does the link go to the specific transaction:** met. Yes, `?txn=<id>`, highlighted and focused if pending, otherwise a banner; survives sign-in on the password path. Google path pending the user's manual check.
3. **A filter for already-decided transactions, last 25:** met, as a "Recently decided" tab (same page, URL-addressable) rather than a filter control, with a fixed cap of 25 and no pagination, as Phase 1 recommended and the user's words ("only a history of the last 25") asked.
4. **Recording who rejected:** met going forward (the user said "yes, record who rejected going forward"). Zero legacy rejections exist in production, so "decider not on file" is a fallback branch no one will see today.

### Notes

- **N1 (hard constraint, not a defect in 2a): 2a must not be pushed without 2b.** The banner ("Only one approval is needed, so there is nothing more to do"), the email sentence ("Only one board approval is needed. If a colleague has already acted, the link will show who.") and the Inc 1 toast ("Only one approval is needed.") all state a rule the user has since decided to change. The user's instruction was "continue with 2a and then 2b, take it all the way to production", so this is the plan, but if 2b slips, the orchestrator should either hold the push or ship 2a with those three strings neutralised. Both Phase 3 and I recorded this; restating because it is the one way 2a alone would mislead 14 board members.
- **N2: L4, the Google round trip, is an owner check before relying on the Google email-link path.** Signed out, open `/admin/ledger/approvals?txn=<a pending id>`, choose "Sign in with Google", confirm landing on the Approvals page with the banner, not `/members`. qa verified only that the right same-origin callback reaches NextAuth. Fold it into the same human glance as Inc 1's F4 (fine-pointer autofocus). It is a one-minute manual step, not a tracked item.
- **N3: post-deploy count check (qa click-through 8).** After deploy the orchestrator reads, counts only, that Recently decided shows `board_approved_rows + rejected_expense_legs` rows (1 + 0 on 2026-10-10). That is the production sanity check on the discriminator.
- **N4: copy the club may tune** (carried from ux-developer and qa; no action unless the club asks): "Approved by You", the decided-tab description "The most recent board decisions, newest first.", the "Try again" link. If 2b re-touches `deciderLabel()`, lowercase the viewer case to "Approved by you" or reword as "You approved" in the same edit (absorb-sized).

### Proposed backlog text (drafts only; ID to be reserved by the orchestrator, nothing filed; B-160 is held for the dissent question and B-161 is used)

**Proposed (ID to be reserved).** *Approvals card/table `isSelf` should use the either-leg recorder rule the decide route enforces.* The page computes `isSelf` as `txn.recordedByUserId === currentUserId` on the expense leg only, while the decide route refuses when the actor recorded either leg of a Transfer/Sweep pair. If only the income leg were recorded by the viewer, the card would offer Approve/Reject and the route would answer 403 (the `?txn=` banner already says "You recorded this" correctly). Unreachable through the app today (both legs are written under one user), so low priority; fix by selecting a `viewerRecordedEitherLeg` boolean in `getPendingApprovals()` (the resolver already computes it). Origin: this work-log, qa 2a observation 1.

**Proposed (ID to be reserved, trivial).** *`e2e/ledger-approvals-mobile.spec.ts` leaves two "New portal user" `email_queue` rows per run.* Delete them in `afterAll`, as `ledger-approvals-history.spec.ts` does. Origin: qa 2a observation 2.

### Release-note bullets for 2a (user-facing; for the v1.90 entry, to be combined with 2b's)

- Opening a pending-approval email now takes you straight to that disbursement, transfer or sweep: it is highlighted on the Approvals page, and if a colleague has already decided it, a banner tells you who decided, when, and under which board minute instead of a bare "all approved" message. This also works when you have to sign in first.
- A new "Recently decided" tab on Approvals lists the last 25 board decisions, approved or rejected, newest first, with the amount, payee, fund, who recorded it, who decided it, and the full board-minute reference or rejection reason.
- Rejecting a disbursement, transfer or sweep now records who rejected it and when (from now on), and the Approvals page uses the right word for what you are approving, shows which book (Club or Foundation) a pending item belongs to, and writes amounts with thousands separators.

(Do not reuse the phrase "only one approval is needed" in the v1.90 notes; 2b replaces it. Sign-in links now also refuse to send you to any address outside the site; that is worth one clause in the security line if the notes have one.)

### Outputs
- This work-log only (this section). No code, database, dev server, `docs/decisions.md`, `docs/backlog.md`, `package.json` or release-notes changes.

### Open questions / handoff notes
- Orchestrator: hold the push until 2b is through Phase 5 (N1); run the L4 and F4 human checks; run the N3 counts read-only after deploy.
- 2b may begin (database-admin first, per the Phase 3 addendum). 2a's Phase 5 PASS covers the tree it was measured on (`4730983` plus the uncommitted 2a files).

## Phase 4 — Increment 2b (database-admin) — 2026-10-10

**Owner:** database-admin
**Status:** complete

### Summary
Added the `ledger_txn_cosigns` table (schema.ts first, then migration 0112) exactly as the 2b data model specifies, and extended the schema test. Both migration replays succeeded on the local dev DB, the constraints on the live table match the design, and tsc and the schema test are green.

### What I did
- Re-derived the migration number: highest existing was 0111, so this is `0112`.
- `schema.ts`: `ledgerTxnCosigns` directly after `ledgerTransactions` (id, txn_id notNull FK CASCADE, user_id nullable FK SET NULL, cosigned_at naive timestamp notNull defaultNow, `unique("ledger_txn_cosigns_txn_user_key").on(txnId, userId)`), plus `LedgerTxnCosign` type. No other index (design).
- Wrote `drizzle/migrations/0112_ledger_txn_cosigns.sql`: `CREATE TABLE IF NOT EXISTS`, then one `DO $$` block with three `pg_constraint`-guarded `ADD CONSTRAINT`s (two FKs, one UNIQUE constraint). No seed, back-fill or role binding.
- Extended `src/lib/ledger-approval-schema.test.ts` with a "migration 0112" describe (5 tests).

### Outputs
- `/Users/cshenso/git/westervillelions/src/lib/db/schema.ts` (table export name: `ledgerTxnCosigns`; type `LedgerTxnCosign`; columns `txnId`, `userId`, `cosignedAt`)
- `/Users/cshenso/git/westervillelions/drizzle/migrations/0112_ledger_txn_cosigns.sql`
- `/Users/cshenso/git/westervillelions/src/lib/ledger-approval-schema.test.ts`
- Constraint names (all <= 63): `ledger_txn_cosigns_txn_id_ledger_transactions_id_fk` (51), `ledger_txn_cosigns_user_id_users_id_fk` (38), `ledger_txn_cosigns_txn_user_key` (31).

### Tests and gates
- Replay 1 and replay 2 of `pnpm db:migrate` (local dev DB): both ended "Migrations completed successfully", both listed `0112_ledger_txn_cosigns.sql`; the only noise is the usual "already exists, skipping" notices from older migrations.
- Live table check (`pg_constraint` on the dev DB): pkey, both FKs with the specified ON DELETE rules, and `UNIQUE (txn_id, user_id)`, names as above.
- `pnpm db:push` (no `--force`, non-TTY): aborted at the interactive prompt about the pre-existing `ledger_entities_slug_unique` (vs `ledger_entities_slug_key`) mismatch; nothing was applied. Because drizzle-kit raises that prompt before printing its statement list, it cannot itself prove "no cosigns diff". The no-diff evidence is instead: drizzle-derived constraint names equal the live names (pinned by the new test) and the live table shape matches schema.ts. The prompt is the only difference it reported.
- `pnpm exec tsc --noEmit`: clean. `vitest run src/lib/ledger-approval-schema.test.ts`: 10/10 pass.
- Idempotence grep (DROP, bare ADD COLUMN) on 0112: nothing.

### Deviations from the design
- None. (The test's "no data writes" check matches `INSERT`, `UPDATE`, `DELETE FROM` rather than a bare `DELETE`, since `ON DELETE` is legitimate in the FKs.)

### Open questions / handoff notes
- For api-developer: import `ledgerTxnCosigns` from `@/lib/db/schema`; `txnId` is the EXPENSE leg; use `INSERT ... ON CONFLICT DO NOTHING` on `(txnId, userId)` and pass `cosignedAt: new Date()` explicitly (T9). `userId` is nullable (deleted account); NULLs are distinct in the unique key.
- Orchestrator: the dev server needs the restart announced (new table exists on the dev DB already). Per the design, do not push until 2b passes Phase 5. Next agent: api-developer.

### Orchestrator: dev-server restart after the 2b schema step (2026-10-10)

The `:3000` dev server was stopped and restarted after migration `0112_ledger_txn_cosigns.sql` landed (log: scratchpad `dev-restart-2b.log`). "User decisions" re-read before this step: the no-quorum decision stands, no later entry. Every live check from here runs against the restarted server. The `db:push` prompt is the same pre-existing `ledger_entities_slug` naming mismatch classified after the 2a schema step; database-admin's live `pg_constraint` check plus the schema test stand in for the push diff.

## Phase 4 — Increment 2b (api-developer) — 2026-10-10

**Owner:** api-developer
**Status:** complete (B1 to B7). ux-developer is next.

### Summary
Delivered the whole 2b server side: the shared lock helper (and `decideTransaction()` refactored onto it with every existing assertion unedited), the co-sign carrier vocabulary, `cosignTransaction()`, the cosign route, the queries-module second query with the co-signer fields, the new banner states, and the B7 string replacements. `tsc` is clean; `pnpm test` is 202 files / 3596 tests, all passing (2a ended at 197 / 3470); `pnpm lint` shows only the pre-existing `budget-context-panel.tsx` warning; no `console.log`, no native dialogs; both E-1 `console.error` catches untouched. No page, dialog, history or banner component was edited.

### What I did
- **B2 (first, so B3 could use it).** `lockDecisionPair(tx, id, "update" | "share")` in `ledger-board-decision.ts`, moved verbatim from `decideTransaction()` (which now calls it with `"update"`; the file lost its inline lock and the unused `asc/or/sql` imports). The executor type is `import type { db }`, so the file still has no runtime `db` import. `ledger-approval-decision.test.ts`: zero existing assertions edited; one scan test appended.
- **B1.** In `ledger-approval.ts`: `cosignEligibility`, `CosignIneligibleReason`, `CosignConflictCode/Body`, `CosignForbiddenBody`, `CosignCreatedBody`, `isCosignConflict`, `isCosignForbidden`, `CosignerView`, `formatApproverList`; `DecidedApprovalRow` approved member gained required `cosigners / canCosign / viewerHasCosigned / viewerRecorded`; `ApprovalBannerModel.action?: "cosign"`; `describeApprovalConflict(body, noun, verb = "approve")`.
- **B3.** `src/lib/ledger-cosign.ts`, procedure exactly as designed (see deviations 1 and 2 for the two small choices).
- **B4.** `POST /api/admin/ledger/transactions/[id]/cosign`, `auth()` then `hasFeature(user.id, LEDGER_APPROVE)` first, no body read, thin wrapper.
- **B5.** `ledger-approval-queries.ts`: second statement for the returned approved ids (`inArray`, `ORDER BY cosigned_at, id`, LEFT JOIN `users`, skipped when empty, throws on failure); the main SELECT also reads `recorder`/`dest.recorded_by_user_id` and `approved_by_user_id` inside the module only; one `cosignEligibility()` call per approved row drives all three booleans.
- **B6.** `buildApprovalBanner` approved branch rewritten to the 2b table (precedence recorded > poster > cosigned > eligible).
- **B7.** The three "Only one approval is needed" strings are gone: banner (above), email sentence (`buildPendingApprovalEmailHtml`: "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too."), and the toast (`describeApprovalConflict`). `approvalFailureAction` now passes its `verb` to `describeApprovalConflict` (that is what makes the reject variant suffix-free; both dialogs already pass the verb, so they needed no edit).

### Contracts ux-developer consumes

**Route.** `POST /api/admin/ledger/transactions/{id}/cosign`; no body, no `Content-Type`. Gate: `auth()` then `ledger.approve`.

| Status | Body | Carrier guard |
|---|---|---|
| 201 | `{ id, cosignedAt }` (`id` = the EXPENSE leg; `cosignedAt` ISO) | `CosignCreatedBody` |
| 401 | `{ error: "Unauthorized" }` | none |
| 403 | `{ error: "Forbidden" }` (NO `code`) | `isCosignForbidden` false |
| 403 | `{ error, code: "recorded_by_you" }` | `isCosignForbidden` true |
| 404 | `{ error, code: "not_found" }` | `ApprovalNotFoundBody` |
| 409 | `{ error, code, at, deciderName }`, `code` in `not_approved`, `rejected`, `not_board_decision`, `already_approved`, `already_cosigned` | `isCosignConflict` |
| 500 | `{ error: "Failed to add your approval" }` | none |

`at` (ISO or null): `rejected` = `rejectedAt ?? updatedAt`; `already_approved` = the entry's `approvedAt`; `already_cosigned` = the caller's existing `cosigned_at`; otherwise null. `deciderName` is non-null only for `rejected` (the rejector via `displayDeciderName`; never an email). Branch on `code`, never on `error`. Sending the id of either Transfer/Sweep leg works; the response `id` is always the expense leg.

**Imports (client-safe, from `@/lib/ledger-approval`):** `cosignEligibility`, `CosignConflictBody`, `CosignConflictCode`, `CosignForbiddenBody`, `CosignCreatedBody`, `isCosignConflict`, `isCosignForbidden`, `CosignerView`, `formatApproverList`. Not yet written (ux-developer's per the design): `approvalEntryHref`, `cosignRequest`, `cosignFailureAction`, and `ApprovalFailureAction.showEntry` in `approval-dialog-logic.ts`.

**Row shape (approved members of `DecidedApprovalRow`, History and the `?txn=` banner share one mapper):**
`cosigners: { name: string | null; cosignedAt: string /* ISO */; isViewer: boolean }[]` in time order (all of them, no cap; `name: null` = deleted account or email-shaped name), `canCosign`, `viewerHasCosigned`, `viewerRecorded` (all server-computed from the one `cosignEligibility()` result; `deciderIsViewer` is the poster). Rejected rows carry none of these. No user id on any returned object (test-walked). The History card list should render all names: `formatApproverList(row.cosigners)` (no `max`) returns `{ text, hiddenCount: 0 }`; use `text` as the "Also approved by:" content or map the entries yourself for the per-name dates ("Ann (Oct 10), Bo (Oct 11)"). Render the button only when `canCosign`.

**`formatApproverList(entries, { max? })`** returns `{ text, hiddenCount }`. When `hiddenCount > 0`, `text` already ends in " and N others" (or "and 1 other") and items are comma-joined, so do not append anything (deviation 3).

**Banner (`buildApprovalBanner`)** new approved-state outputs, `role="status"`, plain text:
- eligible, no co-signs: success, "Approved by {P} on {date}. It has been posted. You can add your approval too.", `action: "cosign"`.
- eligible, with co-signs: success, "Approved by {P} on {date}. Also approved by {list}. You can add your approval too.", `action: "cosign"`; the list is capped at 3 and `linkLabel` becomes "See everyone under Recently decided" when more exist (link target unchanged, `?tab=decided&txn=<id>`); otherwise the usual "See it under Recently decided".
- poster: success, "You approved this {amount} {kind}{ to payee} on {date}. Also approved by {list}." (second sentence omitted when none), no action.
- cosigned: success, "You added your approval on {date}. Approved by {P} on {date}. Also approved by {others}." (others exclude the viewer), no action.
- recorder: neutral, "You recorded this {kind}, so another board member decides it. Approved by {P} on {date}. Also approved by {list}.", no action.
- `{P}` is "You", the name, or "A board member". `action` is present only on the two eligible rows and only when `canCosign`. The dialog props the design lists (amountText, party, noun, fundText, memo, recorderName, boardMinute) all come from `row` on the `decided` state.

**Toast text:** `describeApprovalConflict(body, noun, "approve")` ends "You can add your approval too."; with `"reject"` it is "{Name} already approved this {noun}." The approve dialog's navigate-to-`?txn=` branch (`showEntry`) is ux's.

### Tests (all passing; 202 files, 3596 tests overall)
- `ledger-board-decision.test.ts` 14 (lockDecisionPair: mode, ORDER BY id, NULL-subselect WHERE, row order; no-runtime-db scan now ignores `import type`; R9 scans for `ledger-cosign.ts` and the queries module).
- `ledger-approval-decision.test.ts` 37 (existing unedited; +1 scan: imports `lockDecisionPair`, no inline `.for("update")`).
- `ledger-cosign.test.ts` 29 (every bullet of the design list: leg normalisation incl. income-leg then expense-leg, double tap with `at`, either-leg recorder, poster `at`, deleted poster, pending/rejected/legacy/email-shaped name, predicate-false and lone-income and wrong-size sets, call order lock then predicate-on-expense-id then insert in one transaction, 404 and malformed id with the db untouched, `.for("share")` + ORDER BY, two users, ON CONFLICT target `(txn_id, user_id)`; scans: no `update(`/`delete(`, `boardApprovalPredicate(` present, `paidReimbursementExists(` absent, no queries import, table-identifier allow-list across `src`, `drizzle`, `scripts`, and "imported only by the cosign route").
- `cosign/route.test.ts` 14 (401, 403 without `code`, gate order, 201, body ignored and session id used, body never read, `recorded_by_you` distinguishable, 404, the five 409 codes, 500 leaks nothing).
- `ledger-approval.test.ts` 66 (+`cosignEligibility` table, `isCosign*`, `formatApproverList`, every B6 banner row, precedence, no "only one approval"/fraction/votes/@ in any output, `describeApprovalConflict` verbs).
- `ledger-approval-queries.test.ts` 34 (+11: History statement and ordering free of the co-sign table, one second statement with IN and `cosigned_at, id`, skipped when empty/only rejected, throws when it fails, null-name co-signers, grouping, `canCosign` matrix incl. dest-leg recorder, deleted poster, one eligibility call per approved row, no user-id key at any depth, resolver parity).
- `approval-dialog-logic.test.ts` 17 (+1 reject-verb no-suffix; one expected string changed to the new sentence), `email-compose.test.ts` 21 (2b sentence present, 2a sentence absent), `transactions/route.test.ts` (sentence constant updated).
- Not mine, still the design's ux list: `approval-history.test.tsx` (co-signer line/button), `approval-dialog-logic.test.ts` `showEntry` / `approvalEntryHref` / `cosignRequest` / `cosignFailureAction`.

### Outputs (files)
Created: `src/lib/ledger-cosign.ts`, `src/lib/ledger-cosign.test.ts`, `src/app/api/admin/ledger/transactions/[id]/cosign/route.ts`, `.../cosign/route.test.ts`.
Modified: `src/lib/ledger-board-decision.ts` (+test), `src/lib/ledger-approval-decision.ts` (+test), `src/lib/ledger-approval.ts` (+test), `src/lib/ledger-approval-queries.ts` (+test), `src/lib/email-compose.ts` (+test), `src/app/api/admin/ledger/transactions/route.test.ts` (sentence constant), `src/components/admin/ledger/approval-dialog-logic.ts` (one argument: `verb`) and its test. No schema, migration, dev-server, decisions, backlog, package.json or release-notes change.

### Deviations from the design (all inside the absorb limit)
1. **404 for a locked set that omits the requested id** and a few data-fault branches reuse `not_board_decision` exactly as B3 says; the one addition is that `conflict()` always fills `at`/`deciderName` with null so every 409 matches `CosignConflictBody`.
2. **Rejector name** reuses `lookupDeciderName()` exported from `ledger-approval-decision.ts` (separate select, no join) rather than a second copy. It means `ledger-cosign.ts` imports the decision module (server-to-server, fine; it does not import the queries module).
3. **`formatApproverList` with `hiddenCount > 0` returns text already ending "and N others"** (comma-joined items), instead of the banner appending it, because appending to the "A, B and C" join would read "A, B and C and 4 others". `hiddenCount` is still returned. Singular "and 1 other" when exactly one is hidden.
4. **`approvalFailureAction` passes `verb`** to `describeApprovalConflict` (one argument in `approval-dialog-logic.ts`) so the Increment 1 toast and its reject variant are correct now; `showEntry` stays with ux-developer.
5. `FOR SHARE` is mockable; no fallback to `"update"` was needed.

### Open questions / handoff notes
- Next agent: **ux-developer** (cosign dialog, banner button on `action === "cosign"`, History line and button, help line, `showEntry`/`approvalEntryHref`/`cosignRequest`/`cosignFailureAction`, approve dialog's `router.replace` branch).
- The recorder who loses an approve race gets the "You can add your approval too." suffix although they can never co-sign (the 409 does not say who recorded). Only reachable if a recorder is shown Approve, which `isSelf` prevents except in the income-leg-only edge already filed as the either-leg backlog draft. If the `showEntry` branch is built, the banner it lands on is correct (recorder row), so no wrong action is offered.
- qa: the L6/L7/L8 concurrency checks and the table-identifier scan are the live proofs of the lock claims; my unit tests cover them against a mock only. The predicate renders table-qualified columns in the co-sign select (rendered and checked with a scratch drizzle query; not committed).
- I did not touch the dev server, `docs/decisions.md`, `docs/backlog.md`, `package.json`, release notes, `scripts/`, or any production setting.

## Phase 4 — Increment 2b (ux-developer) — 2026-10-10

**Owner:** ux-developer
**Status:** complete (step 3 of the 2b order). qa is next.

### Summary
Built the whole 2b client surface: the `CosignDialog` island, the "Add your approval" control on approved History cards and on the `?txn=` banner (only when `canCosign`), the "Also approved by" line, the "You added your approval" and "You recorded this" states, the approve dialog's lose-the-race landing on `?txn=<id>`, the Recently decided help line, and every unit test the 2b design names for these files. The page stays a Server Component; the only new client code is the dialog. `tsc` clean, `pnpm test` 203 files / 3624 tests all passing (api-developer ended at 202 / 3596), `pnpm build:only` passes, `pnpm lint` shows only the pre-existing `budget-context-panel.tsx` warning.

### What I did
- **`approval-dialog-logic.ts`:** `ApprovalFailureAction.showEntry` (true only for verb `approve`, a typed 409, `decision === "approved"`, `!decidedByViewer`; false on every other branch including reject); `approvalEntryHref(id)`; `cosignRequest(id)` (bodiless POST, no headers); `cosignFailureAction(status, body, noun)` with one branch per row of the design table (typed refusals close, refresh, info toast, `already_cosigned` is success-shaped; 403 without `code`, 400, 5xx and network failure keep the dialog open; 404 closes with an error toast); `cosignDialogProps(row, amountText)` (strings only, no user ids, fund text via the existing `describeApprovalFund`); `cosignerItems()` (per-name short dates in Eastern time, the viewer as "You", unnamed collapsed to "a board member" / "N other board members"); the success, retry, not-found and help-line constants.
- **`cosign-dialog.tsx` (new, client):** `LedgerDialogShell` dialog owning its trigger, secondary `border-2 border-lions-blue` 44px `rounded-lg` button (full width on a phone, `sm:w-auto`); body shows amount, payee, fund, memo, recorder, board minute on file read-only, and "Your name will be added to this entry. This does not change the books."; footer `flex-col-reverse` on a phone, Cancel and "Add my approval" both 44px; pending label "Adding…". Success toast "Your approval was added." then refresh.
- **`approval-history.tsx`:** help line; "Also approved by:" line only when co-signers exist (all names, no cap); "You added your approval." and "You recorded this, so another board member decides it." lines; the button only when `canCosign`. Rejected cards carry none of it.
- **`approval-banner.tsx`:** optional `cosign` prop; button rendered only when `model.action === "cosign"` and props are present, full width on a phone, below the text, above the link.
- **`approvals/page.tsx`:** builds `bannerCosign` from the embedded approved row and passes it; nothing else changed.
- **`approve-dialog.tsx`:** `router.replace(approvalEntryHref(transactionId))` when `action.showEntry`, else the existing refresh. The dialog's toast and `verb` handling were already right (api-developer). `reject-dialog.tsx` needed no edit (already passes `verb: "reject"`; the toast has no suffix).
- **Copy polish (analyst's 2a cosmetic notes):** doubled period on a rejected banner fixed in `buildApprovalBanner` (trimmed reason; period appended only when it does not already end in `.`, `!` or `?`). See deviation 2 for the capitalisation note.

### Outputs (files)
Created: `src/components/admin/ledger/cosign-dialog.tsx`, `src/components/admin/ledger/approval-banner.test.tsx`.
Modified: `src/components/admin/ledger/approval-dialog-logic.ts` (+test), `approval-history.tsx` (+test), `approval-banner.tsx`, `approve-dialog.tsx`, `src/app/(dashboard)/admin/ledger/approvals/page.tsx`, `src/lib/ledger-approval.ts` (+test; the doubled-period fix only).
No schema, migration, route, query, dev-server, decisions, backlog, package.json, release-notes or `scripts/` change.

### Tests and gates
- `pnpm exec tsc --noEmit`: clean.
- `pnpm test`: **203 files, 3624 tests, all passing** (+1 file, +28 tests over api-developer's 202 / 3596).
- New or extended: `approval-dialog-logic.test.ts` (showEntry matrix, `approvalEntryHref` incl. encoding, `cosignRequest` no body and no headers, `cosignFailureAction` one case per design row plus unrecognised 409, `cosignerItems`, `cosignDialogProps`; the existing `toEqual` expectations gained `showEntry: false`, nothing else edited), `approval-history.test.tsx` (help line, line only with co-signers and never "None", all 13+ names and "You", button only when `canCosign`, already-added and recorded states without a button, rejected cards bare, no fraction/votes/email, 44px `rounded-lg`; fixtures gained the four new fields and a `next/navigation` + `sonner` mock), `approval-banner.test.tsx` (button only for `action: "cosign"` with props, none otherwise, plain-text rendering, trigger styling), `ledger-approval.test.ts` (no doubled period).
- `pnpm build:only`: passes.
- `pnpm lint`: 0 errors, 1 warning (pre-existing `budget-context-panel.tsx:114`).
- No `console.log`, no `alert/confirm/prompt` in any file I touched; no `rounded-full`; no `lions-red`.

### Browser verification (local dev DB via `DATABASE_URL`, e2e admin, headless Chromium against :3000)
Fixtures: 9 transactions tagged `UXTEST` plus 15 `uxtest-*@example.invalid` users (one poster, one recorder, 13 co-signers), 20 co-sign rows. Script and screenshots are in the scratchpad `approvals-mobile-and-history/` (`verify2b.ts`).
- **History at 390px:** eligible card shows the button; the viewer-as-poster card has none ("Approved by You"); the viewer-recorded card has none and says "You recorded this..."; the already-co-signed card has none and says "You added your approval." with "You (Jul 4)" in the list; the rejected card has none and no approvals line. Help line present. No horizontal scroll (390 and 360).
- **Co-sign from a History card:** dialog opened (buttons 44px, copy as designed), toast "Your approval was added.", card re-rendered with "Also approved by: You (...)" and no button.
- **Stale dialog:** a co-sign was inserted for the viewer after the dialog opened; clicking Add my approval returned 409 `already_cosigned`, the dialog closed, the info toast read "You already added your approval on Jul 9, 2090 at 11:00 AM.", the card refreshed to the added state.
- **Banner:** thirteen co-signers reads "Approved by Pat Poster on ... Also approved by Ann ..., Bo ..., Cy ... and 10 others. You can add your approval too." with the button (308px wide at 390, 44px high) and the link "See everyone under Recently decided"; the History card for the same entry lists all 13 with no horizontal scroll at 360. Eligible-with-no-cosigns reads "It has been posted. You can add your approval too." Poster, recorder, already-co-signed and rejected banners show no button and the designed text. Co-sign from the banner: toast, banner re-rendered as "You added your approval on ...", no button.
- **Lose the approve race:** Approve dialog open with a typed minute, colleague approval inserted, click Approve: dialog closed, URL became `/admin/ledger/approvals?txn=<id>`, banner offered Add your approval, toast "Pat Poster already approved this disbursement. You can add your approval too." The reject variant is covered by the logic test only (no click-through; qa step 4 drives it).
- **Widths driven:** 390 and 360. Not driven: 1024 / 1279 / 1280 (the History is single-column cards at every width, so no layout branch changed).
- **Cleanup:** deleted the `UXTEST` transactions and the fixture users in the script's `finally`. After cleanup: 0 `UXTEST` transactions, 0 fixture users, 0 co-sign rows on fixture transactions, 0 co-sign rows by fixture users (co-signs cascade with the transaction). No email was queued (all writes were direct DB inserts plus the three real co-sign routes; none send mail).

### Deviations from the design (routed by size)
1. **Added `cosignDialogProps(row, amountText)` and `cosignerItems(cosigners)` to `approval-dialog-logic.ts` (absorbed, ~60 lines, pure, tested).** The design lists the dialog's props but not where they are built; one helper keeps the banner and the History card on the same mapping. `cosignerItems` renders per-name dates ("Ann (Oct 11)") as the B6 History line specifies, so it does not call `formatApproverList` (that function has no per-name date and is still the banner's source).
2. **Copy polish.** (a) Doubled period on a rejected banner: fixed. (b) "Approved by You" capitalisation mid-sentence: **not changed.** B6 defines `{P}` as "You" in the banner and the viewer reads "You" in `formatApproverList` and the tested History label; in every state where the banner can print it, "You" is already the sentence start or the poster branch ("You approved this ..."). The only mid-sentence "You" is the History label "Approved by You" and the list item "You (Oct 4)", both specified and tested. Raise if the analyst wants "you" lowercased there.
3. **`cosignFailureAction` has no `showEntry` and no `successShaped` field.** `already_cosigned` is success-shaped by its info toast and its wording only; adding a field no consumer reads would be dead code.
4. **Unrecognised 409 body on the cosign route** closes and refreshes with "This entry can no longer take your approval. It has been refreshed." (the design table had no row for it; mirrors the approve dialog's generic-409 branch).
5. **Fund kind in the dialog** is derived from the noun (`disbursement` is `plain`, otherwise the noun) instead of a separate prop, so `CosignDialogProps` matches the design list exactly.
6. **Help line sits at the top of the Recently decided list** (inside `ApprovalHistory`, shown when there are rows), not in the page header, so it disappears with the empty and failed states where it would mislead.

### Open questions / handoff notes for qa
- **Click through (390 and 360):** `/admin/ledger/approvals?tab=decided` as a board member: button only on entries you neither recorded, approved nor co-signed; add from a card and from `?txn=<id>`; the toast and the re-render; the 13-name wrap; poster, recorder (either leg of a Transfer/Sweep), already-co-signed and rejected rows show no button; Pending count, layout badge and sidebar unchanged.
- **Lose-the-race:** approve variant lands on `?txn=` with the button; reject variant closes and refreshes with no suffix and no navigation (only unit-tested by me).
- **Not browser-checked by me:** a Transfer/Sweep pair card and banner (the dialog fund line uses `describeApprovalFund`, unit-tested); the income-leg recorder case; 403 `recorded_by_you` and 404 toasts (unit-tested only); the concurrency checks L6 to L8 (yours).
- The Next dev "1 Issue" badge is visible in the screenshots on both the History and the dialog; I did not open it, so qa should confirm it is not a hydration warning from this page (design click-through 9).
- New copy the Lions Club may want to refine: "Add your approval", "Add my approval", "Your name will be added to this entry. This does not change the books.", "Your approval was added.", the help line "These are already posted. You can add your approval to any entry you did not record.", and the two states "You added your approval." / "You recorded this, so another board member decides it."
- The recorder who loses an approve race still sees the "You can add your approval too." toast (api-developer's note); the `?txn=` banner it lands on is the recorder row, so no wrong action is offered.
- Next agent: **qa** (Phase 5), then analyst Phase 6.


## Phase 5 — Verification — Increment 2b — 2026-10-10

**Owner:** qa
**Status:** complete (Increment 2b)
**Scope:** Increment 2b only: the `ledger_txn_cosigns` table (migration 0112), `lockDecisionPair()` and the `decideTransaction()` refactor onto it, `cosignTransaction()` and `POST /api/admin/ledger/transactions/[id]/cosign`, the second History query and the co-signer fields, the 2b banner states, the cosign dialog, the "Also approved by" line, the lost-approve-race landing on `?txn=`, and the three string replacements (banner, email sentence, toast).
**Tree measured:** `main` at `4730983` plus the uncommitted 2a and 2b working tree (49 entries in `git status --short` before qa). Application code (`src/`, `drizzle/`) was **not modified by qa** (`find src drizzle -newer` returned nothing at the end); qa touched only `e2e/` (one new spec, one string in each of the two existing approval specs) and this work-log. Dev server :3000 (restarted by the orchestrator after the 2b schema step) was not touched; `.env.local` has `RESEND_API_KEY=` blank and no `EMAIL_DEV_ALLOWLIST`; nothing under `scripts/` was run; `PROD_DATABASE_URL` was never read.

### Summary

**Verdict: PASS** for Increment 2b. Every gate is green; every unit test the 2b design names exists and passes; the live pass against real Postgres found **no product defect**. The lock claims that the unit tests could only mock are proven live: two co-signers do not queue behind each other (`FOR SHARE`), a co-sign waits behind a `FOR UPDATE` holder, and the approve path still waits behind a `FOR SHARE` holder (so `decideTransaction()` kept its `FOR UPDATE` through the helper extraction). Leg normalisation holds under real concurrency: one person can never sign twice on a Transfer or Sweep, by either leg, sequentially or in parallel (L8, 20/20 per shape, 5 complete passes). A co-sign never changes `ledger_transactions` (whole-table digest before and after), the audit log or the email queue. The two existing approval specs needed four assertion updates for strings and banner rows the 2b design deliberately replaced (listed below), and pass 54/54 and 12/12 beside the new spec. The dev "1 Issue" badge is **not** a hydration warning: it is the dev-only CSP `eval()` console error, identical on the untouched `/admin` dashboard. Not signed off by qa and recorded as such: L9 (orchestrator, post-deploy) and the L4 Google round trip (carried from 2a, a manual check for the user).

### What I did

**Gates (measured on the tree above)**

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS (exit 0, no output; re-run after the last spec edit, still 0) |
| `pnpm lint` | PASS: 0 errors, 1 warning, `src/components/admin/ledger/budget-context-panel.tsx:114` "unused eslint-disable directive" (pre-existing, not this diff). The new spec and both edited specs lint clean. |
| `pnpm test` (whole suite) | PASS: **203 files, 3624 tests passed, 0 failed**, 4.0 s (the ux-developer's count, reproduced; run again at the end, same). `admin-page-feature-gates.test.ts` is inside it. |
| `pnpm build:only` | PASS: exit 0, "Compiled successfully", 125/125 static pages, **273** route lines (2a had 272: the one new route), zero "warn" lines, :3000 stayed 200 throughout. `git status` byte-identical before and after. |
| Migration replay | `export $(grep -E "^DATABASE_URL=" .env.local \| xargs) && pnpm db:migrate`: "Migrations completed successfully", lists `0111_ledger_rejection_attribution.sql` and `0112_ledger_txn_cosigns.sql`, no error. A no-op for both (the table and all three constraints already exist). Live table check via `pg_constraint` / `information_schema`: `ledger_txn_cosigns_pkey`, `..._txn_id_ledger_transactions_id_fk` FK to `ledger_transactions(id)` **ON DELETE CASCADE**, `..._user_id_users_id_fk` FK to `users(id)` **ON DELETE SET NULL**, `ledger_txn_cosigns_txn_user_key UNIQUE (txn_id, user_id)`; columns exactly `id uuid default gen_random_uuid()`, `txn_id uuid NOT NULL`, `user_id uuid` (nullable), `cosigned_at timestamp NOT NULL default now()`. `drizzle-kit push` was **not** re-run: database-admin recorded that it aborts at the interactive prompt about the pre-existing `ledger_entities_slug_unique` naming mismatch before printing any statement list, so it cannot prove "no cosigns diff"; the evidence that stands is the live constraint names and shape above equal to the names `ledger-approval-schema.test.ts` derives from `schema.ts` (5 tests, passing). |
| Idempotence grep on `0112_ledger_txn_cosigns.sql` (`CREATE TABLE`, `ADD COLUMN`, `INSERT INTO`, `CREATE INDEX` lines without `IF NOT EXISTS` / `ON CONFLICT` / `WHERE NOT EXISTS`) | empty. A second grep for `DROP`, `INSERT`, `UPDATE`, `DELETE FROM` also empty (`ON DELETE` in the two FKs is the only match of a bare `DELETE`). The three `ADD CONSTRAINT` statements each sit inside a `pg_constraint`-guarded `DO $$` block. |
| `e2e/ledger-approvals-cosign.spec.ts` (new) with `ledger-approvals-history.spec.ts` (2a) and `ledger-approvals-mobile.spec.ts` (Increment 1) only; the full suite NOT run, the orchestrator runs it at pre-push | PASS: **136/136** in 9.7 min, single worker (70 new + 54 + 12). Five complete passes of the new spec, all green after the last fixes (see "Runs"). |

**Unit tests the 2b design names: all present and passing.** Listed verbosely: 11 relevant files, **286 tests, 11/11 files, 0 failures** (`unit-verbose.txt`). Checked against the design by name: `ledger-approval-schema.test.ts` migration-0112 describe (5: FK names equal drizzle's within 63 chars and guarded in the SQL, unique is exactly `(txn_id, user_id)`, cascade / set null / nullable, exact columns, `CREATE TABLE IF NOT EXISTS` with guarded constraints and no data writes); `ledger-board-decision.test.ts` (`lockDecisionPair` update / share / order by id / the NULL-subselect WHERE / row order; R9 scans for `ledger-cosign.ts` and the queries module; no runtime `db` import); `ledger-approval-decision.test.ts` (existing assertions untouched, plus the "imports lockDecisionPair and has no inline row lock" scan); `ledger-cosign.test.ts` (29: every bullet of the design list including income-leg id inserts the expense id, same user via income then expense gets `already_cosigned` with the same `txnId`, double tap with `at`, either-leg recorder, posting approver, deleted poster, pending single and pair, rejected with and without the stamp, email-shaped name, predicate-false, lone income row, wrong-size set, call order lock then predicate then insert in one transaction, 404, malformed id never touching the db, `.for("share")` with ORDER BY, two users, ON CONFLICT target, and the table-identifier allow-list and importer scans); `cosign/route.test.ts` (14: 401, 403 with no `code`, body ignored, session id used, each result mapped, `recorded_by_you` distinguishable, auth before the helper); `ledger-approval.test.ts` (`cosignEligibility` table, `isCosignConflict` / `isCosignForbidden`, `describeApprovalConflict` verbs, `formatApproverList`, every 2b banner row, precedence, nothing contains "@", "of N" or "votes"); `ledger-approval-queries.test.ts` (History statement free of the co-sign table, one second statement with IN ordered `cosigned_at, id`, skipped when empty, throws on failure, null-name co-signers, `canCosign` matrix, one `cosignEligibility` call per approved row, no user-id key at any depth, resolver parity); `approval-dialog-logic.test.ts` (`showEntry` matrix, `approvalEntryHref` encoding, `cosignRequest` bodiless, `cosignFailureAction` one case per design row); `email-compose.test.ts` (2b sentence present, 2a absent); `approval-history.test.tsx` and `approval-banner.test.tsx`. **Nothing missing.** The `ledger-cosign.test.ts` identifier allow-list (R12) passes, and I re-grepped the tree myself: `ledgerTxnCosigns` / `ledger_txn_cosigns` appear only in `schema.ts`, `ledger-cosign.ts`, `ledger-approval-queries.ts`, the migration, the tests and `e2e/`.

**Manual click-through, dev server :3000, local dev DB.** Driven by Playwright against real Postgres (headless Chromium, the real credentials form for every fixture user, the real routes), written as `e2e/ledger-approvals-cosign.spec.ts` so it re-runs. Fixtures: 10 board / budget-committee / treasurer users who sign in, 13 ghost co-signers, one deliberately distinctive co-signer name, 18 approved or decided entries including a Transfer and two Sweeps, a reimbursement-paid row, an under-threshold Sweep, a pending and a rejected entry; all `example.invalid`, memo prefix `QATEST E2E Approvals Cosign`, decision times in 2090 so they outrank everything in the newest-25 list. Dev-DB baseline at start: 285 `ledger_transactions`, 0 pending, 0 approved-stamped, 0 rejected, 0 `ledger_txn_cosigns`, 53 users, 1221 `email_queue`, 826 `ledger_audit_log`, 0 `ledger_reimbursements`, 70 `user_roles`.

| Flow | Result | Observed |
|---|---|---|
| Banner by viewer, 21 viewer/entry combinations (checklist 1) | pass | Eligible admin on a plain approved entry: "Approved by QA Cosign Poster on Jun 20, 2090 at 12:00 PM. It has been posted. You can add your approval too." with the button. Thirteen co-signers: "Also approved by QA Ghost Signer 01, QA Ghost Signer 02, QA Ghost Signer 03 and 10 others." plus the link "See everyone under Recently decided". Posting approver: "You approved this ... Also approved by QA Zebrafinch Cosigner." no button. Already co-signed: "You added your approval on ... Approved by ... Also approved by ..." no button. Recorder: "You recorded this disbursement, so another board member decides it." no button. Rejected, reimbursement-paid, under-threshold Sweep and pending: no button (the last three read "did not need board approval" and "waiting for a board decision"). No banner contains "@", "votes", "of N" or "only one approval is needed". |
| Transfer and Sweep pairs, by either leg id | pass | Admin recorded only the Transfer's **income** leg: "You recorded this transfer, so another board member decides it. Approved by ..." by the expense-leg id and the income-leg id, no button. The recorder of the Sweep's **income** leg only gets the same via the income-leg id; the recorder of its **expense** leg only gets "You recorded this sweep" ; a board member who recorded neither Transfer leg gets the button. An eligible admin sees the button on the Sweep by the expense-leg id and by the income-leg id. History shows one card per pair (the income id never renders a second card), with "Activity Fund (Club)" and "Charitable Fund (Foundation)". |
| Button geometry at 360 and 390 | pass | Height >= 44 px, width >= 80% of the banner (about 308 px at 390), inside the viewport, no horizontal scroll. Dialog Cancel and "Add my approval" both >= 44 px at 360; the dialog fits. Screenshots `shots/banner-plain-{360,390}.png`, `dialog-360.png`. |
| Add from the banner (checklist 2) | pass | Dialog shows amount, fund, memo, the minute on file read-only and "Your name will be added to this entry. This does not change the books."; clicking "Add my approval": toast "Your approval was added.", the banner re-renders "You added your approval on ...", no button. DB: exactly one row, user = the admin, `cosigned_at` within 2 minutes of the click. **The whole `ledger_transactions` md5 digest, the row's JSON, `email_queue`, `ledger_audit_log` counts, the Pending tab text and the Ledger overview's pending/approval lines (sidebar included) are byte-identical before and after.** (There is no layout or sidebar badge for approvals in this codebase; the only count is the Pending tab, which is unchanged.) |
| Cancel | pass | Cancelling the dialog writes no row. |
| Add from a Recently decided card | pass | Help line "These are already posted. You can add your approval to any entry you did not record." shown. After adding: "Also approved by: You (...)", "You added your approval.", no button; digest unchanged. On a **Sweep** card: dialog names both funds and the minute, the co-sign is keyed on the **expense** leg (one row), none on the income leg. |
| Cards without the button | pass | Poster ("Approved by You"), recorder ("You recorded this, so another board member decides it."), existing co-signer ("You added your approval."), rejected (no "Also approved by", no state line), Transfer the admin half-recorded. A board member (recorder of the Sweep's expense leg) sees the Sweep with no button and the Transfer with one. |
| Ordering | pass | A co-sign dated 2095 (newer than every decision on the page) added to an old entry leaves the list order identical: ordering stays on the posting decision time. |
| Lose the approve race (checklist 4) | pass | Approve dialog open, a colleague approves through the route, click Approve: dialog closed, URL becomes `...?txn=<id>`, toast "QA Cosign Poster already approved this disbursement. You can add your approval too.", banner "Approved by QA Cosign Poster on ..." with the button; the loser's minute was discarded (DB keeps the colleague's); no co-sign row until the loser clicks "Add your approval", which then writes one for them. Same for a **Sweep**: "...already approved this sweep. You can add your approval too." and it lands on `?txn=<expense id>`. |
| Lose the **reject** race | pass | Reject dialog open, a colleague approves, click Reject: dialog closed, toast "QA Cosign Poster already approved this disbursement." with **no** co-sign suffix, the URL is unchanged and carries no `txn`, the entry stays posted by the colleague, no rejection stamp, no co-sign row. |
| Stale-dialog toasts (the 403 and 404 toasts, plus every typed 409), 7 cases | pass | Dialog open, then the row changed under it: recorder-became-you -> "You recorded this entry, so another board member needs to approve it."; deleted -> "We can't find that entry. It may have been deleted."; posting-approver-became-you -> "You approved this on ..."; co-sign added elsewhere -> "You already added your approval on Jan 1, 2091 at 7:00 AM."; back to pending -> "This entry is still waiting for its first approval."; rejected -> "QA Cosign Poster rejected this disbursement on Feb 1, 2091 at 7:00 AM, so it cannot take more approvals."; approval stamp removed -> "This entry did not need board approval." Each closes the dialog and writes no new row. |
| Refusals, typed bodies (L10) | pass, **300/300 per pass** | 15 refusal kinds x 20 runs: pending 409 `not_approved`; rejected 409 `rejected` with `at` equal to the rejection time and `deciderName` "QA Cosign Poster"; reimbursement-paid, under-threshold Sweep by the expense leg and by the income leg 409 `not_board_decision`; recorder of a plain entry, recorder of only a Sweep income leg (by either leg id), recorder of only an expense leg by the income id, and an admin who recorded only a Transfer income leg (by either leg id) all 403 `recorded_by_you`; the posting approver 409 `already_approved` with `at` = `approved_at`; an existing co-signer 409 `already_cosigned`. **Zero rows written** (checked on every refused target), the table digest unchanged, no "@" in any body. |
| 404, 401, 403 | pass | Malformed and unknown ids: 404 `not_found` (10/10). Signed out: 401. A `ledger.view`-only user (budget_committee) and a **treasurer outside the Board**: 403 with body exactly `{error: "Forbidden"}` (no `code`, so distinguishable from `recorded_by_you`); no row. |
| 201 shape, body ignored | pass | 201 `{id: <expense leg>, cosignedAt: <ISO>}`; a body `{userId, txnId}` naming someone else and another entry is ignored: the row carries the session user and the named entry got nothing. |
| Leg normalisation (L8, single) | pass | Income-leg id then expense-leg id by one user: 201 (body `id` = the expense leg) then 409 `already_cosigned` whose `at` equals the first `cosignedAt`; the income id again: 409; a second user: 201; two rows, both `txn_id` = the expense leg, none on the income leg. |
| Lock dependency (checklist 6) | pass | `DELETE` and `PATCH` by an admin on a co-signed approved entry: 403, 403; on **either leg** of a co-signed approved Transfer: 403 each (4 requests); both legs and the co-sign survive. |
| Visibility (checklist 7) | pass | The distinctive co-signer name and the ghost names appear on **none** of 14 pages as admin (`/admin/ledger`, the fund register, search for the fixture tag, reports, compliance, reconciliation, donors, reimbursements, budgeting, `/members`, `/members/finances`, `/members/financial-reports`, `/members/impact`, `/members/records`; all HTTP 200) nor in the CSV export for fiscal years 2026 and 2027 (which carried 38 of the fixture rows, so the check is not vacuous). They appear on the Approvals page. A `ledger.view`-only user and a Board-less treasurer are redirected away from `?tab=decided&txn=` and the rendered body carries no name and no minute. |
| Deleted accounts | pass | A co-signer deleted: the row survives with `user_id` NULL; the card and the banner degrade to "Also approved by QA Cosign Two and a board member." and the deleted name is gone. A posting approver deleted (`approved_by_user_id` NULL, `approved_at` set): the banner reads "Approved by A board member on ...", the button shows, and a board member's co-sign returns 201. |
| Email (checklist 8) | pass | A new over-threshold expense recorded through the real route: 23 queued approver rows, **every one `blocked_non_production`, zero `sent`**, each linking `?txn=<id>` and carrying "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too." and **not** "If a colleague has already acted, the link will show who." Co-signing queued no email (queue count unchanged across co-signs). |
| 13 names at 360 (checklist 9) | pass | Banner and History card with thirteen co-signers: no horizontal scroll at 360; all 13 names on the card; "See everyone under Recently decided" navigates to `?tab=decided&txn=<id>`. Screenshots `shots/many-banner-360.png`, `many-card-360.png`. |
| Widths 360, 390, 1024, 1279, 1280 | pass | Banner (with the button, >= 44 px), the card button (>= 44 px) and the Pending tab: no horizontal overflow at each width; exactly one visible variant per decided card. Screenshots `shots/decided-{360,390,1024,1279,1280}.png`. |
| Dev "1 Issue" badge | pass (not a hydration warning) | Opened the badge on `/admin/ledger/approvals?tab=decided`: "Console Error: eval() is not supported in this environment. If this page was served with a `Content-Security-Policy` header, make sure that `unsafe-eval` is included. React requires eval() in development mode ...". **Identical on the untouched `/admin` dashboard** (the badge is in the screenshot there too), so it is the dev CSP `eval()` message site-wide, as noted in Increments 1 and 2a. A console capture across the banner, the Recently decided tab and both dialogs (open and cancelled) found only that error and an `<Image>` width/height warning for the layout logo; zero messages matching `hydrat`, `did not match` or `server rendered HTML`, zero uncaught page errors. |
| Dev server log | pass | Across every run since the restart (3,499 co-sign POSTs in the dev log, qa's and the ux-developer's): no HTTP 500, no `Error adding co-sign`, no `Approvals:` or `[Ledger email]` console.error, no deadlock, no lock timeout, no canceling-statement. |

**Concurrency and locking (the only live proof of the lock claims), counts per pass of the spec; five complete passes, 5/5 identical outcomes**

| Check | Runs | Result |
|---|---|---|
| **L6** two different users co-sign one entry simultaneously | 20 per pass (100 total) | 20/20 two 201 and two rows, no 5xx, no deadlock or lock timeout; slowest pair 369 to 692 ms. The `decision` row JSON unchanged each run. |
| L6b six different users at once | 10 per pass | 10/10 six 201 and six rows. |
| **L7** one user double-POST | 20 per pass | 20/20 one 201, one 409 `already_cosigned` whose `at` equals the winner's `cosignedAt`, one row. Triple POST 10/10: one 201, two 409, one row. |
| **L8** Sweep through both legs | 20 per shape per pass | Sequential income-then-expense 20/20 (201, 409); parallel same user via both legs 20/20 (one 201, one 409); two users via different legs 20/20 (two 201). **Every row keyed on the expense leg, zero on the income leg.** |
| Co-sign racing a **reject** on a still-pending row | 20 per pass | 20/20: reject 200, co-sign 409, **zero rows ever inserted**; the row ends rejected by the rejector with `approved_at` NULL. The co-sign saw `not_approved` or `rejected` depending on who locked first (e.g. 11 / 9, 18 / 2 across passes). |
| Co-sign racing the **first approval** | 20 per pass | 20/20 consistent: the approve is always 200 with the approver's minute stamped; the co-sign is either 409 `not_approved` (no row) or 201 after the approval commits (exactly one row). Observed refused 13 to 18, recorded 2 to 7. Never a row without an approval, never torn. |
| Two approvers racing + a co-sign | 20 per pass | 20/20: exactly one 200 and one 409 `not_pending`; the stored approver is the winner; the co-sign 201 or 409 and the row count agrees. The approve/reject path is unchanged by the helper extraction. |
| **Lock probe 1** (a transaction holds `FOR UPDATE` on the entry) | 1 per pass | The co-sign request did **not** complete while held (1.8 s), then returned 201 on release: blocked 2,038 to 2,079 ms. A co-sign takes a lock that conflicts with `decideTransaction()`'s `FOR UPDATE`. |
| **Lock probe 2** (a transaction holds `FOR SHARE` on a pending entry) | 1 per pass | The **approve** request did not complete while held, then returned 200 on release (1,956 to 1,967 ms): `decideTransaction()` still takes `FOR UPDATE` after the extraction. |
| **Lock probe 3** (a transaction holds `FOR SHARE` on an approved entry) | 1 per pass | A co-sign completed in 334 to 410 ms **while it was held**: co-signers do not queue behind each other (the design's "thirteen taps do not queue"). |

**Existing specs: assertions updated for the designed replacements (qa-owned specs; no product code touched).** The two pre-existing approval specs failed on exactly these, each a string or banner row the 2b design replaces (Phase 3 addendum ruling 3, B6, B7), not a regression:
1. `ledger-approvals-mobile.spec.ts:329` (Increment 1, the lost-race toast): `... Only one approval is needed.` -> `... You can add your approval too.`
2. `ledger-approvals-history.spec.ts`, banner "approved by someone else": the fixture is **recorded by the viewing admin**, so under the 2b precedence (recorded first) the banner is now the recorder row, "You recorded this disbursement, so another board member decides it. Approved by QA History Board on Jun 8, 2090 at 12:00 PM." The eligible-viewer variant is covered by the new spec.
3. Same file, "approved by an account since deleted": the same fixture shape, now "You recorded this disbursement, ... Approved by A board member on Jun 9, 2090 at 12:00 PM."
4. Same file, the email test's sentence constant: the 2a sentence -> the 2b sentence.
The other four "approved by" banner tests in that spec (approved by the viewer, the approved Transfer by both leg ids, and so on) pass unchanged.

**Runs, and failures along the way (all test bugs of mine, none a product defect):** run 1 of the new spec failed one test (a `main` locator that resolves to two elements; changed to `body`); the next pass was 67/67. A later combined run failed one test because my new ordering test reused a fixture another test later asserted on (test-order bug, mine; moved to its own fixture). Complete green passes of the new spec: 67/67, 67/67 (inside 133/133 with the two existing specs), 67/67, 69/69 (inside 135/135), 70/70 (inside 136/136, the final).

### Regression tests added

All in `e2e/ledger-approvals-cosign.spec.ts` (new, qa-owned, 70 tests, seeds and cleans its own fixtures, example.invalid users, serial, real Postgres):
- `should answer 201 with the expense-leg id and write one row, changing nothing in the books`, the banner and card tests that compare the whole `ledger_transactions` digest, `email_queue` and `ledger_audit_log` counts before and after — **guards against** a co-sign leaking into the books or sending mail (DECISION-116: a co-sign writes only `ledger_txn_cosigns`).
- `L8: a Sweep co-signed through both legs ...` and `should key a Sweep co-sign on the expense leg ...` — **guards against** one person signing once per leg of a pair (regression for the unique key not covering the leg).
- `L6`, `L6b`, `L7`, and the three lock probes — **guards against** a lock-mode regression (a co-sign taking `FOR UPDATE` and queuing co-signers, or `decideTransaction()` losing `FOR UPDATE` in the extraction), which mocked tests cannot see.
- `a co-sign racing a reject on a still-pending row never inserts`, `a co-sign racing the first approval is either refused or recorded after the approval, never torn`, `two approvers racing the first approval while a third co-signs ...` — **guards against** a co-sign slipping in around a decision.
- `should refuse every ineligible target with its typed body and write no row (live check L10, 20/20 runs each)`, the 401 / 403 / 404 tests, the `ignore a request body` test.
- `should land the approve loser on ?txn= with the co-sign offered and the new toast ...`, the Sweep variant, and `should close the reject loser's dialog with the plain toast, no co-sign suffix and no navigation` — **guards against** the lost race leaving the person with "Only one approval is needed." and no next step.
- Seven stale-dialog toast tests, 21 banner-by-viewer tests, the widths, 13-name, ordering, visibility, deleted-account, lock-dependency and email tests.
- Assertion updates in `e2e/ledger-approvals-history.spec.ts` and `e2e/ledger-approvals-mobile.spec.ts` (four strings, above).
- qa wrote no additional Vitest (the implementers delivered every named unit test).
- **Not run against pre-fix code:** the new behaviour has no pre-fix code to run against (a new table and route). The negative controls that exist are structural: with no leg normalisation the L8 sequential case would return two 201s, and a co-sign that took `FOR UPDATE` would fail lock probe 3. "Would fail" for those is argued from the assertions, not observed (I may not edit app code to break it).

### Coverage on critical modules

Whole suite (`vitest --coverage`, `src/lib/**`): **74.4%** statements overall (target 70%), 72.7% branches. Statements / branches: `ledger-cosign.ts` **90.9 / 87.2**, `ledger-board-decision.ts` **100 / 100**, `ledger-approval-queries.ts` **98.1 / 86.7**, `ledger-approval.ts` **94.0 / 96.6**, `ledger-approval-decision.ts` 97.5 / 92.6. Unchanged by this diff and above target: `events.ts` 94.9%, `permissions.ts` 100%, `members.ts` 86.8%. Uncovered lines in `ledger-cosign.ts` are the exhaustive-`never` default and the defensive paths the live run exercises (not counted by Vitest, since e2e is a separate runner). UI components are outside the configured coverage include and are covered by the server-render tests and the e2e spec.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/admin/ledger/transactions/[id]/cosign` (new) | yes, first statement, 401 | yes, second statement, 403 with no `code` | `FEATURES.LEDGER_APPROVE`; verified by reading `route.ts`, then by behaviour: signed out 401, `ledger.view`-only 403, Board-less treasurer 403 (`{error: "Forbidden"}` each) |
| Page `/admin/ledger/approvals` (now renders co-signers, the button and the Add-your-approval banner) | yes, first (`redirect("/signin")`) | yes, before any query or `searchParams` use (`redirect("/admin/ledger")`) | `FEATURES.LEDGER_APPROVE`; co-signer names come only from `ledger-approval-queries.ts`, imported solely by this page (source-scan test, and my own grep of the table identifier) |
| `POST .../[id]/approve` and `.../[id]/reject` | unchanged, not modified by this diff (absent from `git status`) | unchanged | `FEATURES.LEDGER_APPROVE`; behaviour re-proved by the race tests and lock probe 2 |
| `src/proxy.ts` | n/a (outer gate) | n/a | The only change in the tree is 2a's `callbackUrl` composition; **no hand-written rule was added**, `src/lib/permissions.ts` and `ADMIN_NAVIGATION` are untouched (no nav entry added, none widened), the derived rules are as they were, and the page keeps its own gate |
| Server actions | none added or changed | n/a | n/a |

The bulk-PII question for this feature: the new data is co-signer names, visible only to `ledger.approve` holders on the Approvals page (page gate) and nowhere else (14-page and CSV check above); no email addresses appear in any body (asserted).

### Cleanup (local dev DB; production untouched, `PROD_DATABASE_URL` never read, nothing under `scripts/` run, `RESEND_API_KEY` and `EMAIL_DEV_ALLOWLIST` never set)

The spec's `afterAll` deletes every `QATEST E2E Approvals Cosign` transaction (co-signs cascade), the fixture reimbursement, the 24 `example.invalid` users and their roles, and the email rows it created (only after confirming none was `sent`); it also runs a `beforeAll` cleanup. Final measured state: `ledger_transactions` **285** (as at start), **0 pending**, **0 rejected**, 0 with `approved_at`, **0 rows tagged `QATEST` or `E2E QA`**; `ledger_txn_cosigns` **0**; `ledger_reimbursements` 0; `users` **53** (as at start), **0** `qa-cosign-*`, `qa-history-*` or `qa-approvals-*` users, `user_roles` 70 (as at start, 0 orphans); `ledger_audit_log` 826 (as at start; co-signs write no audit row); `email_queue` **1221** (as at start) after I deleted the "New portal user needs member record review" notices the Increment 1 spec leaves behind (all `blocked_non_production`, none `sent`; 3 after the first runs, 4 after the last, every one created by my runs): its `afterAll` does not clean the email queue, as noted in 2a. The whole-table `ledger_transactions` md5 digest equals its value at the start (`6318cbf9...`). The Increment 1 and 2a specs' own cleanup also ran clean.

### Observations (none blocking)

1. **Stray file in the tree: `src/components/admin/ledger/approval-history.tsx.bak`** (untracked, present since 2a, not touched by qa). It must not be committed; the orchestrator should delete it before `/pre-push`.
2. **The dev-server log line "The destination stream closed early" is a test-teardown artifact, not an app error.** It appeared 5 to 8 times per pass, only after a stale-dialog test's `router.refresh()`. Established: running just those seven tests twice, with a plain `networkidle` wait before closing the page gave **5 of 7** log lines and with an extra 3 s settle gave **0 of 7**; the spec now settles those tests. Believed (not separately proven): the browser closing mid-stream while Next streams the refreshed RSC payload. There is no 5xx, no application frame (digest only, ignore-listed frames), and every assertion passes.
3. **The recorder who loses an approve race still sees the "You can add your approval too." toast** although they can never co-sign (api-developer's note, ux-developer's note). Not reproducible through the UI here: Approve is not drawn for the recorder, except the income-leg-only edge below. The `?txn=` banner it would land on is the recorder row, so no wrong action is offered. Left as is.
4. **Carried from 2a: the pending card's `isSelf` checks the expense leg only**, while the decide and co-sign routes use the either-leg rule. For a pair whose **income** leg alone the viewer recorded, the Pending card would still draw Approve (the route answers 403). 2b's own surfaces (the banner, the History card, the button) all use `cosignEligibility()` and are correct for that shape (proved above for both a Transfer and a Sweep, by either leg id). The either-leg backlog text proposed in 2a still stands.
5. **New copy the club may want to refine** (from the ux-developer's list, seen live and fine): "Add your approval" / "Add my approval", "Your name will be added to this entry. This does not change the books.", "Your approval was added.", the help line, and "Approved by You" capitalisation mid-sentence in the History label (specified and tested as is).
6. A co-sign racing the first approval is, by design and as observed, either refused (`not_approved`) or recorded just after the approval commits; a person who clicks Add your approval a few milliseconds early sees the "still waiting for its first approval" toast, which is correct.

### Not testable here (recorded, not claimed)

- **L9** (post-deploy: the count of `ledger.approve` holder accounts whose normalised display name duplicates another holder's): orchestrator, counts only. Not run and not signed off by qa.
- **L4, the Google round trip** (carried from 2a): needs a real Google account. Manual, owner: the user, before relying on the Google email-link path: signed out, open `/admin/ledger/approvals?txn=<a pending id>`, choose "Sign in with Google", confirm you land on the Approvals page with the banner, not `/members`.
- **`drizzle-kit push` no-diff**: not re-run (see the migration row above); the live constraint names, shape and the schema test stand in for it, as the orchestrator and database-admin recorded.

### Outputs

- `e2e/ledger-approvals-cosign.spec.ts` (new, 70 tests)
- `e2e/ledger-approvals-history.spec.ts` (new in 2a, three assertion updates for 2b), `e2e/ledger-approvals-mobile.spec.ts` (one assertion update)
- Screenshots, logs, helper SQL wrapper: `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/approvals-mobile-and-history/qa-2b/` (`shots/{banner-plain-360,banner-plain-390,dialog-360,many-banner-360,many-card-360,decided-{360,390,1024,1279,1280},badge_admin,issue_*}.png`, `unit-verbose.txt`, `build.log`, `e2e-run2.log`, `e2e-all3-final2.log`, `e2e-cosign-run3.log`, `cov/coverage-summary.json`, `devlog-*.txt`)
- No application code edited, nothing committed; `docs/decisions.md`, `docs/backlog.md`, `package.json` and release notes untouched.

### Open questions / handoff notes

- **Next agent: analyst** for the closing Phase 6 (Increments 1, 2a, 2b together; SHIP IT closes the pipeline). Items for the analyst to weigh: observations 3 and 4 (the recorder toast suffix and the expense-leg-only `isSelf`), and the copy list in observation 5.
- **Before the push:** the orchestrator deletes the stray `approval-history.tsx.bak`, runs the full `pnpm test:e2e` (about 13 minutes; it includes these three specs) and `/pre-push`, and runs L9 post-deploy (reads only). Do not push until 2b's Phase 6 SHIP IT. The migration number `0112` was re-derived by database-admin; a second pipeline adding a migration would collide.
- Proposed backlog text, if wanted (orchestrator files): "Approvals card `isSelf` should use the either-leg recorder rule the decide and co-sign routes enforce (2a observation 1; confirmed again in 2b observation 4)." And: "Increment 1 spec `ledger-approvals-mobile.spec.ts` should delete the `New portal user needs member record review` email rows its sign-ins queue (qa-owned, trivial)."

**Verdict (Increment 2b): PASS**

---

# Phase 6 — Shipped vs Intent (analyst) — Increments 2a and 2b — 2026-10-10

**Owner:** analyst
**Status:** complete
**Scope:** the pipeline-closing verdict for Increments 2a and 2b together. Increment 1 closed earlier today (SHIP WITH NOTES, shipped as v1.89.0, commit `4730983`); 2a got its short confirmation (CONFIRMED WITH NOTES). Read-only: no source, database, dev server, decisions, backlog, `package.json` or release-notes edits. Nothing here was filed.

## VERDICT

**SHIP WITH NOTES.** Nothing is fix-before-push and nothing reopens a phase. Everything the Phase 1 addendum asked for is in the tree, qa passed both increments on real Postgres with concurrency counts, and the stale "only one approval is needed" strings are gone from the product. The notes below are tracked follow-ups: two small backlog items that qa observed, two stale lines in the decision log that must be corrected before DECISION-116 and DECISION-117 move to Resolved, four post-deploy measurements that only a human or the orchestrator can take, and one question (Q8) that is still the user's. The one residual intent risk is Q1 (see "The user's statements").

## ONE-LINE TAKE

> A board member who arrives second, from the email or from Recently decided, sees who approved and who else added their name, can add their own with one tap and a confirm on a 360px phone, and cannot alter the books by doing so; rejections now say who rejected; and the one thing the user may have meant but we did not build is a quorum.

## What I did

- Re-read the Origin, my Phase 1 and the multiple-approver addendum (user verbs, Pass 4, Pass 5, the nine answers, Q1 to Q8), "User decisions" including the latest entry, the Phase 2 and 3 addenda (R8 to R15, T1 to T11, gating), my 2a confirmation, and every 2b report (database-admin, api-developer, ux-developer, qa).
- Read the shipped `ledger-cosign.ts`, the second query and eligibility mapper in `ledger-approval-queries.ts`, `cosign-dialog.tsx`, `approval-dialog-logic.ts` (`cosignerItems`), the decide helper's check order, and the pending-email sentence.
- Re-ran the contract tests: 41 files, **931 tests, all passing** (the cosign, approval, queries, board-decision, decision, schema, email-compose and admin-gate files, the transactions route tests, and everything under `src/components/admin/ledger`). I did not re-run tsc, the build or e2e; qa's gates stand (tsc, lint, 203 files / 3624 tests, `pnpm build:only`, 70-test cosign spec, five full concurrency passes).
- Grepped the non-test tree for the three stale strings ("Only one approval is needed", "nothing more to do", "has already acted"): none remain outside tests that assert their absence. The stray `approval-history.tsx.bak` qa flagged is already gone (`find src e2e drizzle` for `*.bak`/`*.orig` is empty).
- Checked `docs/backlog.md` for the reserved IDs (below).

## The user's statements, honoured?

**"yes, record who rejected going forward": honoured.** Reject stamps `rejected_by_user_id` and `rejected_at` on both legs of a pair in the same pinned UPDATE, never touches `approved_*` (DB-asserted; 5/5 simultaneous double-click runs in 2a; unchanged by the 2b lock refactor, which qa re-proved with the approve-vs-reject races). It shows as "Rejected by {Name}" in Recently decided, in the `?txn=` banner, and in the loser's toast ("You already rejected this sweep."). "Going forward" is literal: no back-fill, and a legacy unstamped rejection reads "decider not on file" (the Phase 1 fallback). Production had 0 rejected rows on 2026-10-10, so nobody will see that fallback today. Still open and deliberately so: neither approve nor reject writes `ledger_audit_log` (B-157).

**"i also think we should allow multiple people approve": honoured under the recorded no-quorum reading, and only under it.** Delivered: after one board member approves and the entry posts, any other `ledger.approve` holder who did not record it can add a recorded, append-only, no-effect-on-the-books approval, from the banner or from a Recently decided card, with the list visible to approvers. Not delivered, by design: any rule that requires a second approval before an entry posts. The question "did you mean quorum?" was put to the user twice and never answered; the user then said "take it all the way to production", which the orchestrator recorded as proceeding on the default. I treat that as authorisation to ship, not as confirmation of the reading. **Recommended wording in the push summary to the user, one line:** "'Allow multiple people to approve' shipped as: the first approval posts the entry and others can add their name afterward; if you meant two approvals required before it posts, say so, that is a separate piece of work." That is the cheapest moment to catch a miss; the shipped schema is additive (one table), so a quorum later is a new Phase 1 and a new migration, not an undo.

## Verb-by-verb: the Phase 1 addendum against what shipped

Surface for every row: admin, `ledger.approve` holder.

| Phase 1 addendum verb | Result | Detail |
|---|---|---|
| Open the email link and learn the entry is already approved, by whom, and who else | **delivered** | Banner "Approved by {P} on {date}. Also approved by {A}, {B}, {C} and N others." with "See everyone under Recently decided" past three names. qa drove 21 viewer/entry combinations, including thirteen co-signers at 360px, no horizontal scroll. No banner contains "@", "votes", a fraction of the board or "only one approval". |
| Add my approval to an approved entry (banner and each approved History card) | **delivered** | Secondary `rounded-lg` 44px button (full width on a phone), `LedgerDialogShell` dialog showing amount, payee, fund (Sweep names both books), memo, recorder, and the minute on file read-only; Cancel / Add my approval; toast "Your approval was added."; page refreshes. One addition over Phase 1, and a good one: "Your name will be added to this entry. This does not change the books." Co-sign writes exactly one row; qa's whole-table digest of `ledger_transactions`, the audit-log and email-queue counts are byte-identical before and after. |
| See everyone who has approved, with dates (History card) | **delivered with difference** | The card lists every co-signer in time order as "Also approved by: Ann (Oct 11), You (Oct 12)". The per-name date is month and day only, no year (`cosignerItems`/`shortDate`); the "Approved by {P} · {date time}" line above it carries the full date. Cosmetic, in the copy follow-up. |
| See that I already approved, and when | **delivered with difference** | Banner: "You added your approval on {full date}. Approved by {P}..." with no button. Card: "You added your approval." and the date only inside the list item ("You (Jul 4)"). Same cosmetic gap. |
| See "you recorded this, so you cannot approve it" | **delivered with difference** | Reads "You recorded this {noun}, so another board member decides it." (Phase 1 said "cannot approve it"); neutral tone, no button, on the banner and the card, and correct for a recorder of only the income leg of a Transfer or Sweep, by either leg id (qa fixtures). The **pending** card still tests the expense leg only (qa observation 4; pre-existing; unreachable through the app; follow-up A). |
| Lose the approve race and be offered to add mine | **delivered** | Dialog closes, URL becomes `?txn=<id>`, toast "{Name} already approved this {noun}. You can add your approval too.", banner with the button, the typed minute discarded. Verified for a plain disbursement and a Sweep (lands on the expense-leg id). Refinement beyond Phase 1 (T5): losing a **reject** to an approval closes with "{Name} already approved this {noun}." and neither navigates nor suggests approving; qa drove it live. One flaw, below (qa observation 3). |
| Withdraw my approval | **not delivered, by design** | Append-only (Q5). B-159 holds the audited removal. |
| `ledger.view`-only, Board-less treasurer, anonymous, no-role member: nothing new | **delivered** | Route 403 with no `code` for a `ledger.view`-only user and a Board-less treasurer, 401 signed out; page redirects them; co-signer names appear on none of 14 other pages nor in the CSV export (38 fixture rows in range, so not vacuous). |

Flows, failure paths. **C1** (banner): every row of the Phase 1 failure table has a typed branch, and qa drove seven stale-dialog cases live (recorder-became-you, deleted, poster-became-you, co-signed elsewhere, back-to-pending, rejected, stamp-removed), each closing the dialog, writing no row and showing the specified sentence. Network and 5xx keep the dialog open: unit-tested only (`cosignFailureAction`), not driven live; acceptable, the branch is one line and mirrors Approve. **C2** (History card): delivered, including the Sweep card keyed on the expense leg. **C3** (lose the race): delivered. **C4** (pair): one row per pair, either leg id resolves, recorder rule reads both legs: delivered (L8, below). **C5** (poster and recorder views): delivered, with the precedence recorded > poster > co-signed > eligible, which Phase 1 did not state but is the right order.

**Tabs and badges.** Pending is still exactly `status = 'pending'`; no "needs your approval too" queue; the Pending count is unchanged by a co-sign (qa compared the tab text and the overview lines before and after). The Recently decided help line ("These are already posted. You can add your approval to any entry you did not record.") shipped, inside the list so it disappears with the empty and failure cards. Ordering stays on the posting decision time (qa added a co-sign dated 2095; the list order did not move).

**Email.** No email on a co-sign (queue count unchanged across co-signs). The pending-approval sentence is now "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too." qa saw it in 23 queued rows, all `blocked_non_production`, none sent, each linking `?txn=<id>`. The 2a sentence is gone. Because the push is one combined commit, the Phase 1 constraint "the sentence ships in the same delivery as the co-sign UI" holds.

## Phase 1 edge cases and adversarial items: closed and remaining

| Item | Status | Closed by |
|---|---|---|
| Two co-signs racing, different users | **closed** | Share locks do not conflict: L6 20/20 per pass, five passes (100/100); six users at once 10/10 per pass; slowest pair under 700 ms; no deadlock or lock timeout in 3,499 POSTs. |
| Same user twice (double tap, two devices) | **closed** | Unique key plus `ON CONFLICT DO NOTHING`: L7 20/20 per pass (100/100), triple POST 10/10 per pass, always one 201, 409 `already_cosigned` whose `at` equals the winner's time, one row. |
| One person signing once per leg of a Transfer/Sweep (R8's trap) | **closed** | Writer normalises to the expense leg inside the lock; L8 sequential 20/20, parallel same-user 20/20, two users 20/20, five passes; every row on the expense leg, none on the income leg. |
| Posting approver co-signing their own approval | **closed** | `cosignEligibility()` compares `approved_by_user_id`; typed 409 `already_approved` with the approval time; unit and L10. |
| Refusals on pending, rejected, reimbursement-paid, under-threshold Sweep, lone income row | **closed** | One `boardApprovalPredicate`; L10 15 kinds x 20 runs = 300/300 per pass, zero rows written, typed bodies, no "@". |
| Recorder of either leg | **closed** (route, banner, card, button) / **remains** (pending card) | 403 `recorded_by_you` on all four leg shapes (live); `isSelf` on the Pending card is expense-leg only (follow-up A). |
| Co-sign after Delete / PATCH | **closed** | The existing `approvedAt` guards: DELETE and PATCH on a co-signed approved entry, and on both legs of a co-signed Transfer, answer 403; entries and co-sign survive. Pinned by a live test. |
| Co-sign on a row moved cross-entity | **closed, not re-driven** | `moveBlockKind()` refuses approved rows and Transfer/Sweep legs (existing, tested in `ledger-transaction-lock.test.ts`); no new code touches it. qa did not drive a move against a co-signed entry; I accept that because the co-sign table stores no entity, fund or amount. |
| Signer names leaking to `ledger.view` surfaces | **closed** | Separate table; identifier scan allows only `schema.ts`, `ledger-cosign.ts`, `ledger-approval-queries.ts`, the migration, `e2e/**` and tests (I re-ran the grep: exactly those); queries module is page-only; 14 pages and the CSV checked live; no user id on any returned object (test-walked). |
| Posting approver or co-signer account deleted | **closed** | `ON DELETE SET NULL`; banner "Approved by A board member", button still shown, a different member's co-sign returns 201; deleted co-signers collapse to "a board member" / "N other board members". Live. |
| Incomplete signer list reading as the whole list | **closed** | The second query throws on failure, so the tab shows its failure card (unit-tested; not inducible live, same as the 2a History failure card). |
| Impersonation, enumeration | **closed** | Route reads no body (a body naming another user and entry is ignored, live); malformed and unknown ids both 404 (10/10). |
| Open redirect | **closed** | The lose-the-race `router.replace` target is built from the dialog's own transaction id by `approvalEntryHref`, never from user input; `safeCallbackPath()` from 2a covers the sign-in path. |
| Co-sign racing the first approval or a reject | **closed** | 20/20 per pass: never a row without an approval, never torn; the loser of a reject race writes no row. Lock probes: a co-sign waits behind a `FOR UPDATE` holder (about 2.0 s), `decideTransaction()` still waits behind a `FOR SHARE` holder (about 1.96 s), a co-sign completes in 334 to 410 ms while another `FOR SHARE` is held. |
| One person, two accounts | **remains (accepted residual)** | Uniqueness is per account. Sizing count L9 is still to be taken post-deploy by the orchestrator. |
| A mistaken co-sign cannot come off | **remains (accepted)** | B-159, on demand. |
| No way to record disagreement | **remains** | Q8, with the user. |
| Google round trip of the encoded `?txn=` (L4) | **remains** | Manual, user. Believed, unmeasured. |
| Pending-card Approve drawn for an income-leg-only recorder; lost-race toast offering co-sign to that same person | **remains** | Follow-up A. Only reachable with hand-edited data; the server refuses (403) and the page they land on is correct. |

**DECISION-117 item 3's open sentence ("co-sign rows are used for display and the unique-conflict path only; Phase 6 re-reads both modules"): re-read, holds, with one clarification.** In `ledger-cosign.ts` the table is touched only by the `INSERT ... ON CONFLICT DO NOTHING` and, on conflict, a read of the caller's own `cosigned_at` for the toast; the file contains no write to `ledger_transactions`. In `ledger-approval-queries.ts` the table is read for names and dates, and the co-signers' user ids are fed to `cosignEligibility()` to decide whether the Add button is drawn. That is display gating, not authorisation: the route re-evaluates and the unique key is the authority. Nothing reads the existence or the count as a permission. The decision text should name the button-gating use (see the DECISION section).

## Open questions, status

| Q | Status |
|---|---|
| Q1 quorum or add-your-name | Never answered. Shipping on the recorded no-quorum default, with the user's "take it to production". Add the one-line check to the push summary (above). Nothing shipped makes a later quorum harder than the data model allows (additive table), but it would be a new Phase 1. |
| Q2 to Q7 (labels, no minute, names shown, no withdrawal, treasurer unchanged, no email or badge) | Defaults adopted in Phase 1 and shipped as written. Q6 verified live: a Board-less treasurer gets 403. Q7 verified: queue count unchanged across co-signs. |
| **Q8** dissent on a posted approval | **Still with the user, not answered, not changed by anything shipped.** The shipped list makes the asymmetry a little more visible (names of those who agreed appear on the card and the banner), so the guardrails matter and are present: no counts or fractions anywhere (test-pinned), nothing labelled "votes", and the help line says these entries are "already posted". That is a reason to ask Q8 once more after deploy, not a reason to build anything. **B-160 stays unfiled (held).** File it only if the user says a posted approval needs a way to record disagreement; otherwise it is simply never filed. |

## Edge cases (Phase 6 checklist)

| Check | Result |
|---|---|
| Empty state | **pass.** No co-signs renders no "Also approved by" line (never "None"); Pending empty state and Recently decided empty and failure cards from 2a stand. |
| Failure microcopy | **pass.** Every refusal has a human sentence keyed on a typed `code`, never on English; no raw error or email reaches the page (asserted in the unit and e2e tests). Live network-failure keep-open is unit-only. |
| Permission gate | **pass.** `auth()` then `hasFeature(LEDGER_APPROVE)` are the first statements in the route and the page; no new key, no nav or proxy change; `admin-page-feature-gates.test.ts` green in my run. |
| Mobile 360 | **pass.** Banner button and card button at least 44px, 13 names wrap, dialog fits, no overflow at 360, 390, 1024, 1279, 1280. Not checked on a real phone (post-deploy glance). |
| Brand | **pass.** Secondary `rounded-lg` buttons, `rounded-2xl` cards, `role="status"` banner, Radix `LedgerDialogShell`, no native dialog, no `rounded-full` on buttons, no `lions-red`. |
| OAuth vs password, access-pending, Google Group sync | **pass / not applicable.** The route needs only a session with `ledger.approve`; the Google email-link round trip is L4. |

## Notes (each becomes a tracked follow-up; nothing blocks the push)

1. **N1 DECISION wording, before the status flips (tech-lead).** Specified under "DECISION status", below. One of the edits corrects a claim that did not happen: DECISION-117's Impact says a "no-diff `drizzle-kit push`" was recorded; database-admin and qa both recorded that push aborts at a pre-existing prompt and cannot prove it.
2. **N2 Post-deploy measurements (orchestrator reads, user glances).** L2, L9, L4, F4; list below. None can fail the build; each closes a believed claim.
3. **N3 Ask Q8 once, after deploy.** Orchestrator, with the Q1 one-liner.
4. **N4 (backlog A)** Pending-card `isSelf` is expense-leg only, and the lost-race toast offers co-sign to a recorder. One root cause, two symptoms.
5. **N5 (backlog B)** The Increment 1 e2e spec leaves "New portal user" email rows.
6. **N6 (backlog C)** Copy pass: "Approved by You" capitalisation mid-sentence, per-name dates with no year, "Try again", the decided-tab description.
7. **N7 (backlog D)** The `ledger_entities_slug_unique` versus `ledger_entities_slug_key` drift makes `drizzle-kit push` interactive and unusable as a no-diff proof.
8. **N8 Docs housekeeping.** The work-log header "Reserved IDs" line is garbled ("B-161 used for the recorder-email item ... unused") and the Phase 3 addendum says "B-161 released", but `docs/backlog.md` has **B-161 filed** (the recorder-email item, Later). See "Reserved IDs".
9. **N9 CLAUDE.md at release (tech-lead, already on the filing record).** The "Disbursement approvals (v1.89, DECISION-116)" bullet says "sit `pending` until **one** approver posts them", which stays true; add that later approvers may add an informational co-sign (v1.90, DECISION-117, never a control), and the `safeCallbackPath()` Key Patterns note.
10. **N10 Pre-push mechanics (orchestrator).** One `/pre-push` on the combined 2a plus 2b tree, including the full serial `pnpm test:e2e` (about 13 minutes; it includes the three approval specs). Migrations 0111 and 0112 are the only new ones; nothing else in the tree adds a migration. The `.bak` is already gone.

### Reserved IDs

B-155, B-156, B-157, B-158 filed. B-159 filed. **B-161 is filed** (recorder receives the pending email; Later), so it is not released, whatever the Phase 3 addendum line says. **B-160 is the only reserved ID unused, and it is held** for Q8. No ID in the reserved list remains free. The next free number in `docs/backlog.md` appears to be **B-162**; the orchestrator should confirm before reserving B-162 to B-165 for the four drafts below.

### Proposed backlog text (drafts only; IDs to be reserved by the orchestrator; nothing filed; count: 4)

**Proposed A (ID to be reserved; low; home: Soon next to B-158, or Later).** *The Approvals page offers Approve and Reject by an expense-leg-only recorder check.* `approvals/page.tsx` computes `isSelf` as `txn.recordedByUserId === currentUserId` (card at line ~237, table row at ~269) on the expense leg only, while the decide and co-sign routes refuse the actor who recorded **either** leg. If only the income leg of a Transfer or Sweep was recorded by the viewer, the Pending card draws Approve and Reject and the route answers 403; and if a colleague approves first, the lost-race toast then says "You can add your approval too." to a person who can never co-sign. One root cause: select a `viewerRecordedEitherLeg` boolean in `getPendingApprovals()` (the decided mapper and the `?txn=` resolver already derive it from `cosignEligibility()`/the dest self-join) and feed it to `rowActions`; with that, the recorder never sees Approve and the toast branch is unreachable. Unreachable through the app today (both legs are recorded under one user), so low. Origin: this work-log, qa 2a observation 1, qa 2b observations 3 and 4.

**Proposed B (ID to be reserved; trivial; Later).** *`e2e/ledger-approvals-mobile.spec.ts` leaves "New portal user needs member record review" `email_queue` rows.* Two to four per run, all `blocked_non_production`. Delete them in `afterAll` as `ledger-approvals-history.spec.ts` and `ledger-approvals-cosign.spec.ts` do. Origin: qa 2a observation 2, 2b cleanup note.

**Proposed C (ID to be reserved; low; Later).** *Approvals copy pass.* Four strings the club may want tuned, to take together if it asks: "Approved by You" (capital Y mid-sentence on the History label and the co-signer list), the per-name co-sign date having no year (an entry decided in December and co-signed in January reads "Dec ... Jan 3"), the decided-tab description "The most recent board decisions, newest first.", and the "Try again" link. No behaviour change. Origin: this work-log, 2a note N4, 2b ux deviation 2, qa 2b observation 5.

**Proposed D (ID to be reserved; low; Later; owner database-admin).** *`drizzle-kit push` is interactive because `ledger_entities` has a unique constraint named `ledger_entities_slug_unique` in `schema.ts` and `ledger_entities_slug_key` in the database.* `pnpm build` runs push with `--force`, which answers the prompt, so deploys are unaffected, but a plain `pnpm db:push` aborts at the prompt before printing any diff, so it cannot be used to prove that a new migration leaves no drift (it blocked that proof for migrations 0111 and 0112). Make the name agree in one direction (a guarded rename in a migration, or rename in `schema.ts`) and confirm `drizzle-kit push` reports no changes. Count: 1 constraint. Origin: database-admin 2a and 2b reports.

**B-160 (held, unchanged):** *Record dissent on a posted approval.* File only if the user answers Q8 "yes, we need to record disagreement". Draft text is in the Phase 2 addendum.

## DECISION status (for tech-lead; I do not edit `docs/decisions.md`)

`docs/decisions.md` uses `Resolved | Superseded | Under review`; there is no "Accepted". **Recommendation: both move from `Proposed` to `Resolved` at push, once these edits are made. None of them changes what was built.**

**DECISION-117** (Status -> `Resolved`):
1. *Context.* Replace "and the user has not objected" with: "The question was put to the user twice and not answered; on 2026-10-10 the user said 'ok continue with 2a and then continue with 2b. take it all the way to production', and the no-quorum reading was recorded as the decision for 2b. It is the adopted default, not an explicit confirmation of 'no quorum'."
2. *Item 3, the "Believed, not mechanically enforced" sentence.* Replace with the Phase 6 re-read: in `ledger-cosign.ts` the table is written only by the `INSERT ... ON CONFLICT DO NOTHING` and read only to return the caller's own earlier `cosigned_at`; in `ledger-approval-queries.ts` it is read for names and dates and its user ids feed `cosignEligibility()` to decide whether the Add button is drawn (display gating; the route and the unique key are the authority). Nothing reads the existence or count of rows as a permission. State that this remains a human re-read, not a scan.
3. *Item 5.* Replace "Observed by live checks L6 and L7; until then the two-co-signer behaviour is the documented Postgres semantics, not a measurement" with the measurement: L6 100/100 (five passes of 20), six simultaneous users 50/50, L7 100/100, and three lock probes (a co-sign blocked about 2.0 s behind a `FOR UPDATE` holder; an approve blocked about 1.96 s behind a `FOR SHARE` holder; a co-sign completed in 334 to 410 ms while another `FOR SHARE` was held). Keep "an FK check takes an implicit key-share lock" as believed, unmeasured.
4. *Residuals.* Record L8 (20/20 per shape, five passes) and L10 (300/300 per pass); leave **L9 as "pending, orchestrator, post-deploy"** and append the count when it arrives; add to "must be revisited before any quorum": the pending-email sentence "Only one board approval is needed to post this" and the banner text "It has been posted", both of which state the no-quorum rule.
5. *Impact.* Replace "two replays and a no-diff `drizzle-kit push` recorded" with "two replays and a live `pg_constraint` check of names, rules and columns recorded; `drizzle-kit push` could not be used as the no-diff proof because it aborts at the pre-existing `ledger_entities_slug` prompt (backlog D)". Fix `Depends on DECISION-116 items 1 and 4` to items 1 to 4 if desired (the lock-marker rationale is item 2, the helper is item 3); optional.

**DECISION-116** (Status -> `Resolved (item 1 amended by DECISION-117)`):
1. *Item 1 as amended by DECISION-117 stands.* The amendment already says the predicate has three consumers; no further change to "one approver posts" is needed. That phrase lives in the Context, Item 3 and the CLAUDE.md bullet, not in item 1's text.
2. *Item 3, last sentence.* Add: "'Who decided' means who posted or rejected the entry. Later co-signatures (DECISION-117) are endorsements, not decisions, and are listed separately."
3. *Residual on `redactQueuedEmailHtml()` and `?txn=`.* Change "Believed until the pinned test ... runs; L3 observes it" to "Observed 2026-10-10 (2a qa, L3): the queue view shows `?txn=<uuid>` readable."
4. *Residual on the race (L1).* Add "Observed 6/6 in Increment 1; after the `lockDecisionPair()` extraction the approve-vs-approve and approve-vs-reject races re-ran 20/20 per pass, five passes (2b)."
5. *Open measurements, kept honest:* **L2** (History count equals `board_approved_rows + rejected_expense_legs` after deploy) is pending the orchestrator; **L4** (the encoded `?txn=` surviving the Google round trip) remains **believed, unmeasured** until the user runs it. Because L4 is a belief about a sign-in path, say so in the Status line or the residual rather than letting `Resolved` imply it was measured. The password path, the hostile-callback checks and the Google-button cookie assertions were measured in 2a.

## v1.90 release-notes draft (user-facing only; for the orchestrator or tech-lead to place; no file lists)

> ### Feature: Add your approval
>
> **Value:** When a disbursement, transfer or sweep needs a board decision, the first approval still posts it, exactly as before. Now other board members can add their approval afterward, so the record shows who on the board agrees. Adding your approval is a record only: it does not change the books, and it never holds anything up.
>
> **Changes:**
> - On the Approvals page, the "Recently decided" list shows "Also approved by" with each board member's name and date, and an "Add your approval" button on any entry you did not record, approve or already sign.
> - The link in the approval email shows the same thing: who approved, who else has added their approval, and a button to add yours.
> - If you press Approve a moment after a colleague, your window closes, a message says who approved first, and you land on the entry where you can add your approval.
> - Your name is added once per entry; for a transfer or sweep, one approval covers both sides.
>
> ### Enhancement: See what the board has decided, and follow the email to the exact entry
>
> - A new "Recently decided" tab lists the last 25 approvals and rejections, newest first, with the amount, payee, fund, who recorded the entry, who decided it, and the full board-minute reference or rejection reason.
> - The link in the approval email opens the exact disbursement, transfer or sweep: if it is waiting, it is highlighted; if a colleague already decided it, a note says who and when. This also works when you have to sign in first.
> - Rejections now record who rejected the entry and when, from now on.
> - Transfers and sweeps are named as such on their buttons and messages, sweeps show which book (Club or Foundation) each side belongs to, and dollar amounts show thousands separators.
> - The notification email tells recipients what to expect when a colleague has already approved.
>
> ### Security: Sign-in links stay on this site
>
> Sign-in and registration links now refuse to send anyone to an address outside the club's site.
>
> #### Permissions
>
> | Feature key | Required for |
> |-------------|--------------|
> | `ledger.approve` | Unchanged: the Approvals page, Approve, Reject, Add your approval. |

(Phrases deliberately avoided: "only one approval is needed", "votes", "2 of N". "Coming next" from v1.89 is now delivered and should not be repeated.)

## Manual post-deploy checks

For the user:
1. **L4, Google round trip (carried from 2a).** Signed out, open `/admin/ledger/approvals?txn=<a pending id>` (or the link in the next real approval email), choose "Sign in with Google", and confirm you land on the Approvals page with the entry highlighted, not on `/members`.
2. **F4, the two things headless QA could not see.** On a laptop, open Approve: the cursor should already be in the minute field. On a real phone, open Approvals (and, once one exists, a Recently decided card and the "Add your approval" dialog) and confirm the buttons are on screen and the keyboard does not cover the context.
3. **Q8, and the Q1 one-liner,** in the same message: others can add their name after it posts; is it acceptable that there is no way to record disagreement?

For the orchestrator (reads only, counts only, `branchId` passed explicitly, nothing personal copied into the repo; I did not run any of this):
4. **Migrations applied.** The build runs both; confirm the Approvals page loads and Recently decided renders without error. Expect `ledger_txn_cosigns` to hold **0** rows until someone adds an approval.
5. **L2.** Re-run the Phase 1 Verify-First block; expect Recently decided to show `board_approved_rows + rejected_expense_legs` (1 + 0 on 2026-10-10) cards. This is the production check that the board-decision discriminator matches the real data.
6. **L9, sizing the per-account residual:**

```sql
WITH holders AS (
  SELECT DISTINCT u.id,
         lower(regexp_replace(btrim(u.name), '\s+', ' ', 'g')) AS norm_name
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN role_features rf ON rf.role_id = ur.role_id
  JOIN features f ON f.id = rf.feature_id
  WHERE f.name = 'ledger.approve' AND u.is_active = TRUE
    AND u.name IS NOT NULL AND btrim(u.name) <> ''
)
SELECT count(*) AS approve_holder_accounts,
       count(*) FILTER (WHERE norm_name IN
         (SELECT norm_name FROM holders GROUP BY norm_name HAVING count(*) > 1)) AS accounts_sharing_a_display_name
FROM holders;
```

Paste the two counts under "Production facts (orchestrator, 2026-10-10)". Zero is the expected result; any non-zero is a fact to tell the user, not a defect (the residual is accepted).

## Phase 6 — Shipped vs Intent — Increments 2a and 2b — 2026-10-10 (standard handoff)

**Owner:** analyst
**Status:** complete

### Summary
SHIP WITH NOTES. Both of the user's statements are honoured under the recorded reading: rejections record who rejected going forward, and after the first approval posts an entry, other board members can add their names, informationally, from the email link or Recently decided. The only intent risk is that the user may have meant a quorum; the question went unanswered and the push summary should restate it in one line. No flow regressed, every Phase 1 edge and adversarial item is closed by code or a live count except four named residuals, and the two qa observations fold into one small backlog item.

### What I did
- Compared every Phase 1 addendum verb, flow, edge case and adversarial probe with the shipped code and qa's live counts; re-read the two modules DECISION-117 item 3 asked me to; re-ran 41 test files (931 tests, green); grepped for the stale strings and the stray `.bak`; checked the reserved IDs against `docs/backlog.md`.
- Drafted four backlog items, the DECISION-116 and DECISION-117 status edits, the v1.90 notes and the post-deploy checks.

### Outputs
- This work-log only (this section; Per-Phase Status table). No code, database, dev server, `docs/decisions.md`, `docs/backlog.md`, `package.json`, release-notes or email changes. Nothing committed.

### Open questions / handoff notes
- **Orchestrator:** confirm the next free backlog number and reserve IDs for backlog A to D; the stale Reserved IDs header line (B-161 is used); run `/pre-push` with the full e2e; take L2 and L9 after deploy; send the user the Q1 one-liner, the Q8 question and the L4/F4 glance together.
- **Tech-lead:** apply the DECISION-116 and DECISION-117 edits above, then set both to `Resolved`; at release add the CLAUDE.md bullet and Key Patterns note; place the v1.90 draft with `/release-notes`.
- **User:** Q8 (dissent on a posted approval) decides whether B-160 is ever filed.


## Ship filing (tech-lead, 2026-10-10)

**Owner:** tech-lead
**Status:** complete (docs and version only; no code, database, dev server or commit)

Filed after the analyst's Phase 6 (SHIP WITH NOTES) for Increments 2a and 2b, applying her DECISION status recommendation and her drafts. Increment 1 shipped earlier today as v1.89.0 (4730983).

### Decisions
- **DECISION-117** `Proposed` -> `Resolved (2026-10-10; L9 pending, orchestrator, post-deploy)`. Edits applied: Context states the quorum question went unanswered twice and the no-quorum default is the recorded decision from "take it all the way to production" (adopted default, not an explicit confirmation); item 3 carries the Phase 6 re-read of `ledger-cosign.ts` and `ledger-approval-queries.ts` and says it remains a human re-read, not a scan; item 5 carries the measured results (L6 100/100, six users 50/50, L7 100/100, three lock probes) with the FK key-share lock kept as believed, unmeasured; residuals record L8 (20/20 per shape, five passes) and L10 (300/300 per pass), L9 pending, and the quorum-revisit scope now names the pending-email sentence and the "It has been posted" banner; Impact no longer claims a no-diff `drizzle-kit push` (replaced by the `pg_constraint` check and the backlog-D reason); "Depends on DECISION-116 items 1 to 4".
- **DECISION-116** `Proposed (item 1 amended by DECISION-117)` -> `Resolved (item 1 amended by DECISION-117; L2 pending, orchestrator, post-deploy; L4 believed, unmeasured, user run pending)`. Edits applied: item 3 clarifies "who decided" means who posted or rejected, co-signatures listed separately; the `?txn=` queue-view residual is now observed (2a qa, L3); L1 residual gains the post-refactor counts (6/6 in Increment 1, then 20/20 per pass, five passes); the L4 residual says `Resolved` does not imply it was measured, and records what 2a did measure.
- I did not re-run the "Established" re-read myself beyond the analyst's Phase 6 re-read; each factual edit above is the analyst's wording.

### Backlog (`docs/backlog.md`; highest ID in the file was B-161; B-160 still held for Q8 and unused)
- **B-162** (Soon) The Approvals page offers Approve and Reject by an expense-leg-only recorder check (analyst draft A).
- **B-163** (Later) `e2e/ledger-approvals-mobile.spec.ts` leaves "New portal user" `email_queue` rows (draft B).
- **B-164** (Later) Approvals copy pass (draft C).
- **B-165** (Later, database-admin) `drizzle-kit push` is interactive because of the `ledger_entities` slug constraint name mismatch (draft D).
- ToC updated (Soon: B-162; Later: B-163 to B-165). Correction recorded: the header `Reserved IDs:` line (line 4) is fixed, and the Phase 3 addendum's filing record gains a correction line, because B-161 was filed by the orchestrator (recorder-email item, Later) and is in use. The Phase 3 addendum's note that B-158's body and ToC sit in different tiers no longer applies: both are under Soon.

### Release notes and version
- New `docs/release-notes/v1.90.md` with entry **1.90.0 — 2026-10-10**: Feature (Add your approval; permissions table `ledger.approve`; New Routes `POST /api/admin/ledger/transactions/[id]/cosign`, `?tab=decided`, `?txn=`), Enhancement (Recently decided, email deep link, rejection attribution, email wording), Defect Fix (noun, fund and thousands-separator polish), Security (sign-in links stay on this site). User-facing only, no file lists, never the phrase "only one approval is needed". `→ [v1.90](v1.90.md)` added at the bottom of `v1.89.md`. `package.json` version `1.89.0` -> `1.90.0`.

### CLAUDE.md
- The Key Features bullet is now "Disbursement approvals (v1.89–v1.90, DECISION-116/117)" and carries the 2a/2b facts: rejection stamps and `approvedAt` untouched; `lockDecisionPair()` and `boardDecisionPredicate` as the single helpers; `ledger_txn_cosigns` informational and append-only, written only by `cosignTransaction()` through the cosign route; the no-quorum strings to change with any quorum; approver-only queries module; `safeCallbackPath()` for every `callbackUrl` consumer; the `drizzle-kit push` prompt (B-165). One bullet; no Key Patterns edit (the `safeCallbackPath()` note lives in the bullet).

### Treasury User's Guide (`/admin/ledger/guide`)
- **The guide does document approvals** (section 5, "Reimbursements & Approvals", `src/components/admin/ledger/guide/reimbursements-section.tsx` lines ~56 to 70): it describes the Approvals queue and the Approve-permission gate, and does not mention the Recently decided tab or adding your approval. **Not updated in this pass because the task forbids edits under `src/`.** Needs a small copy addition (one sentence on the Recently decided tab, one on "Add your approval" being a record only) by an implementer; orchestrator to route it. Guide wording to supply: "The Approvals page also has a Recently decided tab listing the last 25 decisions. After an entry posts, other board members can add their approval from there or from the email link; this is a record only and does not change the books."

### Left for the orchestrator
- Post-deploy: L2 and L9 counts (append to DECISION-116/117 residuals and to "Production facts"), L4 and F4 glances (user), Q1 one-liner and Q8 (decides whether B-160 is ever filed).
- `/pre-push` on the combined tree; commits are the orchestrator's (nothing committed here).

### Orchestrator: Treasury User's Guide copy (2026-10-10)

Absorbed deviation (6 lines, copy only, no schema, no API): added the paragraph tech-lead drafted in the Ship filing section to `src/components/admin/ledger/guide/reimbursements-section.tsx` after the Approvals-queue paragraph (Recently decided tab; adding your approval is a record only). No e2e spec visits `/admin/ledger/guide`, so the edit landed while the full suite ran. tsc and eslint re-run clean on the file; `pnpm build:only` re-run after the e2e suite finishes, before the commit.

## Pre-push gates for Increments 2a + 2b (orchestrator, 2026-10-10)

Measured on `4730983` plus the full uncommitted 2a + 2b tree (57 changed/untracked files), dev server restarted after migration 0112, logs in scratchpad `prepush-2/`.

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Lint | PASS (0 errors; the pre-existing `budget-context-panel.tsx:114` warning) |
| Unit tests | PASS — 203 files, 3624 tests |
| Production build | PASS — 125/125 pages; re-run after the guide copy edit, PASS |
| E2E (full suite, serial) | PASS — 356 passed, 1 skipped, 21.8 min |
| Schema and migrations | 0111 and 0112 in `drizzle/migrations/`, idempotence grep empty, both replay as no-ops; `drizzle-kit push` prompts only on the pre-existing `ledger_entities_slug` name drift (B-165) |
| Dependency CVE audit (`--prod --audit-level=high`) | PASS (exit 0); 1 low + 1 moderate advisory, not blocking |
| Personal data sweep (`--untracked`) | clean (email, phone, address); no `.env*` tracked |
| Native dialogs / console.log | none in production paths (only `<script>alert(1)</script>` fixtures in tests) |
| Release notes + version | `docs/release-notes/v1.90.md` 1.90.0, `package.json` 1.90.0, CLAUDE.md updated, guide updated |

Ready to push: yes. Authorization: the user's "take it all the way to production" (User decisions, 2026-10-10). Phase 6: SHIP WITH NOTES (notes filed as B-162..B-165; Q8/B-160 held). Post-deploy checks for the user: L4 Google round trip with `?txn=`, F4 autofocus glance, L9 read-only production counts.

## Deployed (orchestrator, 2026-10-10 evening)

Commit `ae0e210` (v1.90.0) pushed to `main`; Vercel deployment for that sha reports `success` (GitHub commit status). Read-only production check after the deploy (counts and booleans only, nothing written): `ledger_txn_cosigns` exists; both rejection columns present on `ledger_transactions`; co-sign rows 0; board-approved rows 1; rejected 0; pending 0. That is the L9 expectation (1 + 0) — Recently decided should show exactly one row. Remaining manual checks for the user: L4 Google round trip with `?txn=`, F4 autofocus glance, Q8 (dissent) answer for B-160.
