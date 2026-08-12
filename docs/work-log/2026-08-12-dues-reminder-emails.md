# Dues Reminder Emails — Work Log

> **Slug:** `2026-08-12-dues-reminder-emails`
> **Surface:** (dashboard) admin — The Ledger / Dues
> **Permission(s):** likely `dues.manage` (existing); confirm in Phase 1
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-12 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-12 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Origin

Requested by Chris Henson (treasurer) 2026-08-12:

> "can you add a feature to send an email out to members with unpaid dues? i want to
> make it manual. say something to the effect that my records show that you have not yet
> paid your dues for the westerville lions club for the 20xx season. Have it come from
> treasurer@westervillelions.org. signed by the current treasurer. make it super
> positive."

Follow-up: **"i'd like the treasurer's email to be bcc'd"** — the treasurer gets a blind copy
of each reminder, as their own record that it went.

### Stated requirements

1. **Manual, never automatic.** The treasurer decides when reminders go. No schedule, no cron,
   no send-on-login. This is explicit and load-bearing.
2. Recipients are **members with unpaid dues** for the season.
3. **From `treasurer@westervillelions.org`.**
4. **Signed by the current treasurer**, by name.
5. **Tone: "super positive."** Not a debt-collection notice. These are volunteers who mostly
   forgot, and the club's relationship with them is worth more than the $120.
6. **BCC the treasurer** on every reminder.

---

## THE SAFETY PROBLEM — read before designing anything

The existing email guardrail (`isClubDistributionList()` in `src/lib/email.ts`) blocks
delivery **only** to `club@westervillelions.org` and `board@westervillelions.org` outside
production. It exists because a QA run on 2026-08-09 mailed the club's real 44-person Google
Group.

**This feature sends to individual member addresses, which that guardrail does not cover.**
A dev or test run of this feature would mail ~40 real people, individually, telling them they
owe money — which is materially worse than the incident the guardrail was built for, because
it is per-person, it is about money, and it would be wrong (dev data is stale).

Phase 1 must treat this as a first-class requirement, not a testing note. At minimum the
design needs:

- A **non-production block on bulk member sends**, in the same spirit as the existing
  guardrail, so the feature is testable end to end without anything leaving the building.
- A **preview / dry-run that names every recipient** before anything is queued.
- An explicit **confirm step stating how many people will be emailed**.
- A **record of what was sent to whom and when**, so a double-send is visible rather than
  discovered by a member receiving two reminders.

Do not weaken or special-case the existing guardrail to make testing easier.

---

## Known facts (verified against the codebase, 2026-08-12)

- `duesPayments`: `memberId`, `fiscalYear`, `paymentDate`, `amountCents` (negative = refund),
  `method`, `notes`. Multiple rows per member per year are possible.
- `duesSettings`: per fiscal year, `individualAmountCents` (FY2026 = $120) and
  `familyAmountCents` (FY2026 = $96), with exactly one `isActive` row that determines the
  default year on every dues surface.
- Fiscal year convention is the **start year** — FY2026 = 1 Jul 2026 to 30 Jun 2027
  (DECISION-015). The member-facing word the treasurer used is "season", so the copy needs a
  human rendering of this, e.g. "the 2026-27 season".
- Existing keys: `dues.view` and `dues.manage`. Admin surface at `/admin/dues`.
- Outbound mail: `sendEmail()` writes to `email_queue` before attempting delivery, retries
  3×, and records failures. `/admin/email-queue` can view any queued message.

## Questions Phase 1 must answer

- **Who is "the current treasurer"?** Officer titles are **not** recorded in the portal —
  every board member is stored with the role `Leader`, so the name cannot be derived. Options:
  a dues/ledger setting, or the acting user's own name. Needs a decision, not a guess.
- **Which members count as unpaid?** Note `duesSettings` has two rates, so "unpaid" is not a
  single number. Also: **prospective members are deliberately not billed dues** (v1.37.0) and
  must be excluded, as must anyone whose membership has ended.
- **Partial payments.** A member who has paid $60 of $120 is neither paid nor unpaid. Does
  the reminder go to them, and does it say what is outstanding?
- **Does the email state the amount owed?** The treasurer's wording doesn't, and stating a
  figure the member disputes is a different conversation from a friendly nudge.
- **Repeat sends.** What stops the same member getting a reminder every week?
- Is `treasurer@westervillelions.org` a deliverable address on the verified sending domain?

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer-triggered, name-and-count-previewed batch email to members who haven't paid dues this season — the shape is sound and mostly buildable from existing dues/email infrastructure, but the "who signs it" and "who exactly is unpaid" defaults need the treasurer's explicit sign-off before Phase 3 locks the contract, and the non-production safety design is now a concrete, checked-in requirement, not a placeholder.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer / `dues.manage` holder) | Opens "Send Dues Reminders" from `/admin/dues` for a fiscal year | On demand |
| Admin | Reviews the computed recipient list (unpaid, and a separate partial-payer cohort) by name, email, amount, dues category, last-reminded date | On demand |
| Admin | Deselects/reselects individual recipients before sending | On demand |
| Admin | Confirms the send via `ConfirmDialog`, seeing an explicit recipient count | On demand |
| Admin | Reviews send history (who was reminded, when, by whom, success/failure) | On demand |
| Member (recipient) | Receives the email, reads it, optionally replies (lands in the shared `treasurer@westervillelions.org` mailbox, since that's the From address) or clicks through to `/members/dues` | Reactive, per send |

No verb here is unowned — every step above names the admin surface explicitly, and the one recipient-facing verb is passive (read an email), which is the correct shape for "manual, one-directional nudge."

## Flows

**Flow 1 — Treasurer (or delegated admin) sends a batch reminder**
Entry: `/admin/dues` → new "Send Reminders" action, scoped to a fiscal year (default = the active FY, i.e. the current season) → step: system computes the recipient cohort by re-running the **same** `listMemberDuesStatus()` / `deriveStatus()` logic that already powers `/admin/dues` and the member's own `/members/dues` page (see Gaps — this is a hard requirement, not a nice-to-have: the reminder and the member's own status view must never be able to disagree) → step: system independently resolves the signer — the Board of Directors group member whose `position = 'Treasurer'` (same derivation `/api/public/leadership` already uses), shown read-only at the top of the screen ("This reminder will be signed by: Chris Henson, Treasurer") with no admin input required → step: cohort splits into "Unpaid" (net paid ≤ 0), checked by default, and "Partial balance" (0 < paid < expected), shown separately, unchecked by default, with distinct copy → step: admin can uncheck/check individual names → step: admin previews the rendered email (subject + body, season label, signer name filled in) → step: admin clicks Send, `ConfirmDialog` states "Send this reminder to **N** members, signed by [Treasurer name]?" with the final list visible → step: on confirm, server **re-derives** eligibility from the database at that instant (not the client's stale payload — see adversarial pass) and sends via `sendEmail()` to each surviving recipient, BCC to `treasurer@westervillelions.org` (the fixed mailbox itself, per the original ask — not the sender's or signer's personal address, so it works identically no matter who clicks Send), one row written per member to a reminder log (recording both who *sent* it and who it was *signed as*) → outcome: toast "Sent N of N reminders" (or "Sent N of M — the rest are shown below" if the count shrank because someone paid between load and send, or because delivery failed for some).
- Failure: a per-recipient send failure must be surfaced individually — mirrors the existing minutes-email pattern (DECISION-075 §6: a failed send is a *successful API call reporting failure*, never a silent write into `email_queue` the treasurer has to go find). The UI lists which names failed and why, right there, not just an aggregate toast.
- Failure (signer lookup): if the Board of Directors group has **zero** or **more than one** member with `position = 'Treasurer'` (exact match), the screen must fail loudly — no Send button, a clear admin-facing message ("No single Treasurer found in the Board of Directors group — fix the group position before sending reminders," linking to `/admin/groups/[board-group-id]`) — never falls back to a guess, the first match, or the sender's own name.

**Flow 2 — Non-production safety block (the work-log's SAFETY PROBLEM, addressed directly)**
Entry: identical to Flow 1, but `process.env.NODE_ENV !== "production"`.
Design: the existing `isClubDistributionList()` guardrail in `sendEmail()` is address-based (`club@…`, `board@…`) and is explicitly not to be touched or widened — this feature's recipients are ~40 distinct individual addresses that guardrail was never meant to cover. Recommendation: add a **second, independent guard inside this feature's own send route** — not inside shared `sendEmail()` — that says: *if `NODE_ENV !== "production"`, this route never hands a real member address to `sendEmail()`'s live path; every recipient is written to the reminder log and to `email_queue` with the same `blocked_non_production` status the existing guardrail already uses, and the route returns the identical success shape it would in production.* This is additive (new code path, new file), leaves the existing guardrail untouched, and makes the entire flow — cohort computation, preview, confirm, send, log, failure display — clickable end-to-end by QA with zero chance of a real send, matching the "fully testable without anything reaching a real member" constraint exactly.
- Failure: N/A — this flow's job is to make the dangerous flow inert, not to fail.

**Flow 3 — Repeat-send visibility**
Entry: the recipient list in Flow 1.
Step: each row shows "Last reminded: Aug 5, 2026" or "Never reminded," sourced from the reminder log (see Gaps — `email_queue` alone can't answer this reliably; a small dedicated log is the likely resolution, final call is Phase 3/database-admin's).
Step: an already-reminded member is not hard-blocked from re-selection — a second nudge is a legitimate treasurer choice — but the badge makes it a *visible, deliberate* choice, not an accidental duplicate.
- Failure: N/A, this is passive information display.

**Flow 4 — Member receives the reminder**
Entry: inbox, From = Reply-To = `treasurer@westervillelions.org`.
Step: reads a warm note naming the season, with a link back to `/members/dues` to see their live status.
Step: if they've already paid and it just hasn't been recorded, they reply — the reply lands directly in the `treasurer@westervillelions.org` mailbox (From doubles as the natural reply-to address; no separate Reply-To header needed, unlike the minutes-email pattern where From is a no-reply address). Whether that mailbox is personally checked by the current office-holder or is a shared/forwarded alias is outside this feature's control — flagged as an assumption, not verified in code.
- Failure: this must work identically whether the member signs in via Google or a password, and whether or not they currently have portal access — `/members/dues` and the email itself never require an active login to read the email or to reply. A member stuck at `/access-pending` (no granted features) still legitimately owes dues and should still be reminded; their permission state is orthogonal to their billing status.

## Permissions

- **Access to the "Send Dues Reminders" screen and action:** existing `FEATURES.DUES_MANAGE` (`dues.manage`) — already bound to `admin` and `treasurer` roles (migration `0041_dues_permissions.sql`). No new `FEATURES` key. Anyone holding `dues.manage` may click Send — deliberately **independent** of who the letter is signed by (see below): James Shively, who holds `dues.manage` via the `treasurer` permission role, can correctly send a reminder that is signed by Chris Henson, the Board's Treasurer office-holder. This is the intended answer to the coordinator's question "must the sender also hold `dues.manage`, independent of who signs" — yes, and that's the only gate on the send action itself.
- **Signature identity is a separate lookup, not a permission check** — see below. It doesn't gate anything (anyone with `dues.manage` can still send regardless of the lookup's outcome for *them personally*), so it doesn't touch the "permissions are the only gating mechanism" invariant; it only decides whose name is printed at the bottom of the email.
- **Default roles for send access:** `admin`, `treasurer` (both already hold `dues.manage`).

### Who is "the current treasurer" — final answer, and a distinction worth stating plainly

Two different things in this codebase are both colloquially "the treasurer," and this feature must not conflate them:

| | What it is | Where it lives | Current holders |
|---|---|---|---|
| `treasurer` **role** | A *permission grant* — "may record/edit dues payments and configure dues amounts" (`dues.manage`, `dues.view`) | `roles` / `user_roles` (permission system) | **Two:** Chris Henson, James Shively — legitimate; both are trusted to do dues bookkeeping |
| Board of Directors **`position = 'Treasurer'`** | The actual *office* — who the club recognizes as Treasurer | `groups` / `group_memberships.position` (same field and derivation `/api/public/leadership` already uses for the public leadership listing) | **One:** Chris Henson |

**The email is signed by the office-holder (`position = 'Treasurer'`), never by whoever happens to hold the `dues.manage`/`treasurer` permission.** This is a pure lookup at send time — no admin picks anything, no dropdown, no stored setting:

- The signer's name and "Treasurer, Westerville Lions Club" are resolved server-side from the Board of Directors group the instant the screen loads and again immediately before send, and shown to the sender read-only before they confirm.
- **Sender ≠ signer is expected and fine.** Any `dues.manage` holder can click Send; the email is always correctly attributed to the actual office-holder, not to whoever happened to be at the keyboard.
- **Lookup fails loudly, never guesses.** If no Board of Directors member has `position` exactly `'Treasurer'`, or more than one does, the Send screen shows a blocking error naming the problem and links to fixing it in `/admin/groups` — it never falls back to the first match, an alphabetical pick, or the sender's own name (see Flow 1 failure path, added above).
- **Handover is just an edit to the Board group membership.** Someone (with the existing group-management permission) changes who holds `position = 'Treasurer'` in `/admin/groups`; the very next reminder screen load reflects the new name automatically. No code, no setting, no migration.
- **The two-holder `treasurer` role is not a bug and needs no fix here** — it answers "who may do dues bookkeeping," a different question from "whose name is on the letter," and this design keeps the two from ever being confused with each other again.

## Draft Email Copy

Substance preserved from the treasurer's own wording ("my records show that you have not yet paid your dues for the Westerville Lions Club for the 20xx season"), warmth added, no implication of bad faith, no dollar figure (pending confirmation — see Open Questions), and a live link rather than a static number.

**Subject line:**
> A friendly note about your 2026–27 Westerville Lions dues

**Body (Unpaid cohort — zero paid):**

> Hi {{firstName}},
>
> I hope this finds you well! I'm reaching out with a quick, friendly note — our records show we haven't yet received your dues for the 2026–27 Lions year. It's an easy thing to lose track of, especially with everything else going on, so consider this a gentle nudge rather than anything to worry about.
>
> You can see your dues status anytime at {{link to /members/dues}}. If you've already sent a payment and it just hasn't made it into our records yet, please just let me know — that happens on my end sometimes, and I'd love to get it squared away.
>
> Thank you, truly, for everything you do for our club and our community — it means a great deal, and it's never gone unnoticed.
>
> With gratitude,
> {{signerFirstName}} {{signerLastName}}
> Treasurer, Westerville Lions Club

**Body (Partial-balance cohort — if the treasurer opts to include it; wording changes so it never says "haven't paid" to someone who has):**

> Hi {{firstName}},
>
> Hope you're doing well! Just a friendly note that our records show a balance still remaining on your 2026–27 Lions dues. No stress at all — these things happen, and I just wanted to flag it in case it slipped your mind.
>
> You can see the details anytime at {{link to /members/dues}}. If this doesn't look right, just reply and let me know — happy to sort it out together.
>
> Thank you for all you do for our club!
>
> With gratitude,
> {{signerFirstName}} {{signerLastName}}
> Treasurer, Westerville Lions Club

Notes on the copy choices:
- Opens with warmth before the ask, never leads with the deficiency.
- "our records show" (not "you have not paid") — matches the treasurer's original framing while keeping the club, not the member, as the subject of the uncertain claim.
- Explicitly offers "it's probably my mistake" as the default explanation for a mismatch — this is the single biggest lever for "not collections-like."
- Closes on gratitude, not a call to action — the CTA (the portal link) is mid-body, not the last thing they read.
- No dollar amount, no due date, no "please remit by," nothing that reads as an invoice.

## Gaps the Request Didn't Address

- **Stale recipient list between preview and send.** The treasurer could load the screen, leave it open while people pay, then hit Send hours later. The server must re-derive each recipient's eligibility (active status, still-unpaid-as-of-send) at send time, not trust the client's submitted ID list — otherwise a member who paid in the interim still gets told they haven't. *Resolution: server-side re-query immediately before dispatch; the UI reflects "N of M eligible" if the count shrank.*
- **`email_queue` cannot answer "who's already been reminded."** It has no `memberId` or `fiscalYear` column, only a free-text `to`/`subject`. Matching on those would be fragile. *Resolution: a small dedicated reminder-log table (memberId, fiscalYear, sentAt, sentByUserId (the actual sender), signedAsMemberId (the resolved Treasurer office-holder at send time), emailQueueId, success/failure) — final schema call belongs to database-admin in Phase 3/4.*
- **The Treasurer-office lookup is a single point of failure for the whole feature.** It depends on exactly one Board of Directors membership row having `position` spelled exactly `'Treasurer'`. A typo, a blank position, or an officer transition where the old Treasurer's row hasn't been updated yet would all break the send screen. That's the correct failure mode (fail loud, per above) but it means this feature is now a second consumer of data that was previously "just" cosmetic for the public leadership page — a data-entry mistake there now blocks dues reminders too, not just a web page. Worth the treasurer knowing that coupling exists.
- **Family/household double-billing optics.** `duesCategory = 'family'` reduces the rate but each member row is billed and reminded independently — a married couple who are both members could each receive a separate "you haven't paid your dues" email about what they think of as one household obligation. Not fixable within this feature (there's no household link in the schema), but the recipient list should visibly label `duesCategory` so the treasurer can spot pairs and choose to skip one, and copy should say "your dues," not imply the club thinks each person owes a separate, un-shared amount.
- **Empty state.** A fiscal year with nobody unpaid (early in the year, or a small club having a good year) needs an explicit, on-brand empty state — `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, something like "Nobody owes dues for the 2026–27 season right now." — not a bare table with zero rows and a live Send button.
- **Failure microcopy.** DB/network failure while loading the cohort or while sending needs a human message, not a stack trace or a silent "Sent 0" with no explanation.
- **Mobile at 360px.** The recipient list (name, email, amount, category, last-reminded badge, checkbox) needs a layout that survives a phone screen — this is exactly the kind of dense admin table that breaks first at 360px.
- **Brand consistency for a new UI surface.** This is a genuinely new screen (no existing "preview named recipients → confirm count → bulk email" pattern exists elsewhere in the app to copy from — announcements are on-site only, not emailed). `rounded-2xl` cards, `rounded-lg` buttons, `<ConfirmDialog>` for the final send (not `window.confirm`), `lions-blue`/`lions-gold` — all need to be applied fresh, not inherited from a precedent.
- **`treasurer@westervillelions.org` deliverability.** Every other outbound email in this codebase sends `From: noreply@westervillelions.org` (via `RESEND_FROM_EMAIL`). This feature would be the first to send from a different address on the domain. I can't verify Resend's domain-verification scope from the code — flagged as an Open Question, not a blocker to design (SPF/DKIM is normally domain-wide, but it should be confirmed before Phase 4, not discovered at first real send).

## Out of Scope (confirm with user)

- Automatic/scheduled sending of any kind — explicitly excluded by the treasurer.
- An online dues-payment link/CTA in the email — no Zeffy dues campaign exists today; the email should not imply a "pay now" button that doesn't exist.
- Fixing the family/household double-billing gap structurally (linking spouse member records) — flagged above, not solved here.
- Editing officer/role assignments from this feature — that stays in `/admin/roles`.
- Any channel besides email (no SMS).
- A "you were reminded" banner on the member's own `/members/dues` page — the page already shows the same live status the reminder is based on (they can't disagree, since both would read `listMemberDuesStatus`/`deriveStatus`), so a redundant banner reads as a nice-to-have, not core to this request.

## Open Questions

- **Confirm the office-lookup signature design.** The email will be signed by whoever holds `position = 'Treasurer'` in the Board of Directors group (currently Chris Henson), resolved automatically at send time — not by whoever clicks Send. Does that match your intent?
- **Confirm the unpaid definition and partial-payer handling.** My default: the primary, pre-checked recipient list is members with **zero** dues paid this season (`status = 'unpaid'` from the existing `deriveStatus()`); partial payers (`status = 'partial'`) appear as a separate, unchecked cohort with different wording ("still has a balance," never "hasn't paid"). Is that the right default, or should partial payers be included in the primary send by default?
- **Should the email state a dollar amount at all?** My recommendation is no — link to the live `/members/dues` page instead, so the number shown is never stale and never disputable out of context (this is also the safest choice given the partial-payer case). Confirm before Phase 4 locks the copy.
- **Repeat-send policy.** Is an informational "last reminded" badge (no hard block on re-sending) sufficient, or do you want a real cooldown (e.g., can't remind the same member again within N days without an explicit override)?
- **Optional personal note field?** The meeting-minutes email feature lets the sender attach a short note above the templated body. Do you want the same for dues reminders, or should v1 be a fixed template with no per-send customization?
- **Is `treasurer@westervillelions.org` verified for outbound delivery in Resend today?** (External-system question, not answerable from the code.)

---

## Post-Phase-1 rulings (2026-08-12) — settled, do not re-litigate

Phase 1 closed with six open questions. Two went to the treasurer; the rest are decided here
so Phase 3 does not reopen them.

### Treasurer's answers

- **`treasurer@westervillelions.org` is an alias that forwards to the treasurer, not a
  mailbox.** Consequences the design must honour:
  - Send **From** `treasurer@westervillelions.org` as requested. The domain is verified in
    Resend (every successful send in `email_queue` has come from
    `noreply@westervillelions.org` on the same domain), so this will deliver.
  - Set **Reply-To to the office-holder's own address**, resolved from the same Board
    `position = 'Treasurer'` lookup that supplies the signature. An alias that forwards may
    not retain a copy, and a reply to a dues reminder is the most important mail this feature
    generates — "I paid in July" must never land nowhere.
  - **BCC the office-holder's own address**, for the same reason: the record has to exist in
    a real mailbox.
- **The email states the standard rate**, not a personalised balance: "Dues are $120 for the
  year, or $96 for a family membership." Read the amounts from the active `duesSettings` row
  rather than hard-coding them, so they cannot drift from the books. This is a fact about the
  club, not a claim about the member, so it removes friction without inviting an argument.

### Decided here

- **Signing — ACCEPTED as designed.** The office-holder from Board `position = 'Treasurer'`
  signs; sending is gated on `dues.manage` independently, so a second bookkeeper can send a
  letter correctly signed by the office-holder. Zero or multiple Treasurers blocks the send
  screen with an explicit error rather than guessing.
- **Partial payers — ACCEPTED as designed.** Excluded from the default recipient set, offered
  as a separate, unchecked cohort with its own wording. Telling someone who has paid half
  that "we haven't received your dues" is factually wrong and is exactly the kind of thing
  that costs a volunteer's goodwill.
- **Repeat sends — badge and warning, not a hard block.** Show when each member was last
  reminded, and warn before re-sending to anyone reminded within the last 14 days. Do not
  forbid it: a treasurer may legitimately re-send after a phone call, and a hard cooldown
  would just be worked around.
- **Personal note — INCLUDED.** An optional free-text note the treasurer can add per send,
  following the pattern meeting minutes already uses for its email. Cheap to build, and it is
  what turns a mail-merge into a note from a person.

### Still unverified

- Nothing has ever been sent from `treasurer@westervillelions.org`. The domain is proven but
  that specific From address is not. QA should confirm the first real send lands, and check
  it does not trip spam filtering, before the treasurer sends to the whole unpaid list.

---

# Phase 2 — Architectural Review (architect)

## VERDICT

**Approved with suggestions.** The feature's shape is sound and the placement follows established
precedent cleanly. One ruling below overrides Phase 1's specific recommendation for where the
non-production safety guard lives (§2) — that override is load-bearing and must carry into the
Phase 3 design, not treated as optional polish. Everything else is confirm-and-proceed.

## 1. Placement

**New module pair, not an extension of `dues.ts` / `dues-queries.ts`.**

- `src/lib/dues-reminders.ts` — pure: email template rendering (subject/body builders for the
  two cohort variants), reminder-log row shaping, any pure classification helpers specific to
  reminders. No DB import.
- `src/lib/dues-reminders-queries.ts` — DB-facing: reads the cohort via the *existing*
  `listMemberDuesStatus()` in `dues-queries.ts` (do not re-derive eligibility with a second query
  — Phase 1's Flow 1 is explicit that the reminder screen and `/members/dues` must never be able
  to disagree, and the only way to guarantee that is to call the same function, not a parallel
  one), resolves the Board `position = 'Treasurer'` signer, and reads/writes the new reminder-log
  table (§5).

This is the same pure/DB-facing split DECISION-074 established for minutes/documents and
DECISION-084 generalized for proposals — now a fourth domain using it. I ruled against folding
reminders into the existing `dues.ts`/`dues-queries.ts` files because those files have a narrow,
clean job today (status computation for the admin table and the member's own page) and mixing in
email-template rendering, signer resolution, and reminder-log CRUD would blur that boundary for no
benefit — the existing files still get *called* by the new ones, they just don't grow new
responsibilities.

**Signer resolution:** `/api/public/leadership/route.ts` already contains ad hoc Board
`position` lookup logic, but it optimizes for "list and sort everyone," not "find exactly one
Treasurer or fail loudly," so it is not a drop-in shared function today. I ruled it's fine to
implement `resolveTreasurerSigner()` locally in `dues-reminders-queries.ts` rather than force an
extraction now — two consumers with materially different semantics (display-many vs.
exact-one-or-fail) don't yet justify a shared abstraction. If a third feature needs board-position
lookup, extract then, not preemptively.

**Route handler:** `src/app/api/admin/dues/reminders/route.ts` (cohort/signer preview on GET, send
on POST), nested under the existing `/admin/dues` API tree, mirroring the
`/api/admin/minutes/[id]/email` nesting precedent (send action lives under the parent resource's
own path, not a flat top-level route).

**UI:** `src/app/(dashboard)/admin/dues/reminders/page.tsx` (new nested page under the existing
`/admin/dues` admin directory — this is a sub-area of Dues, not a sibling top-level admin area),
linked from `/admin/dues`. Interactive pieces (`DuesReminderSender` or similar) live in
`src/components/admin/`, following the existing `dues-configure-modal.tsx` /
`dues-add-payment-button.tsx` naming convention already established there.

## 2. The safety guard — ruling against Phase 1's specific recommendation

Phase 1 proposes a **second, feature-local** guard inside the reminders route that never hands a
real address to `sendEmail()`, hand-rolling the same `email_queue` insert +
`blocked_non_production` status write `sendEmail()` already does. I'm overriding this.

**Problems with a feature-local guard:**
- It duplicates `sendEmail()`'s persistence/status-write logic in a second file. Two places now
  need to agree on what a "blocked" row looks like, and they will drift the first time either one
  changes.
- It makes protection **opt-in per feature** — exactly the shape that produced the 2026-08-09
  incident this guardrail exists to prevent. A future feature that mails members in bulk and
  forgets to build its own local wall gets zero protection, because the shared chokepoint
  (`sendEmail()`) never learned that "bulk send to individuals" is a category that needs blocking.
  Question 2's framing is correct: the existing guard covering only two named distribution lists
  *is* a signal the abstraction is too narrow, and the fix belongs in the chokepoint, not next to
  it.

**Ruling:** `src/lib/email.ts` grows a second, explicit entrypoint — `sendBulkMemberEmail()` (exact
name is tech-lead's call) — that wraps `sendEmail()` per recipient and **unconditionally** applies
the non-production block when `NODE_ENV !== "production"`, with no address matching at all. This
is deliberately broader than `isClubDistributionList()`: it doesn't need to know which addresses
are "real" (an address-matching approach can always be gamed by a fresh member added to dev data
after the list was written), it just refuses *any* bulk-individual-recipient send outside
production, full stop. It reuses `sendEmail()`'s existing `email_queue` insert and
`blocked_non_production` write internally — no duplicated persistence logic — and returns the same
`{ success: true }` shape so the reminders route's preview/confirm/log/failure-display flow is
testable end to end exactly as Phase 1 wants, with nothing new to hand-roll.

Why not a single-recipient block instead (i.e., widen `sendEmail()` itself to block all
individual-address sends outside prod)? Because that would break dev testing of every other
feature that legitimately mails one real person in dev today — password reset, a minutes email to
a single board member, etc. The dangerous shape here is specifically *bulk* — a loop over ~40
distinct member addresses — not "any email to a person." Gating on the call shape (bulk vs.
transactional), not the address, is the correct generalization.

This satisfies all three of the prompt's constraints: the existing guardrail is untouched (still
address-based, still covers the two distribution lists, unchanged), it is impossible to reach a
real member from a dev/QA process (unconditional block, not a list that can go stale), and a
future feature inherits protection **by construction** the moment it reaches for the bulk
entrypoint — which, once it exists as precedent, is what any future "email many members" feature
would naturally reach for, and a feature that instead hand-loops `sendEmail()` directly is a
visible, reviewable deviation from precedent rather than an invisible gap. Exact function
signature and where the short-circuit lives inside `email.ts` is tech-lead/api-developer's call in
Phase 3/4 — the architectural requirement is that it is a shared, unconditional, chokepoint-level
guard, not a feature-local reimplementation.

## 3. Server / client split

- `page.tsx` — Server Component. `auth()` + `hasFeature(FEATURES.DUES_MANAGE)` + `redirect()` on
  failure (see §6 — this is required independent of the proxy, and there's already a same-area
  precedent: `admin/dues/[memberId]/page.tsx` does exactly this pattern today). Resolves the
  fiscal-year param, does the initial cohort + signer fetch server-side for first paint.
- Everything interactive — checkbox selection, live selected-count, the optional note field, the
  `ConfirmDialog` confirm-count step, the send action's `fetch()` call, and per-recipient
  success/failure display — is a `"use client"` component, consistent with how
  `MinutesEmailPrompt` is built. The two rendered email bodies are static per fiscal
  year/signer/settings (no per-member dollar amounts per the treasurer's ruling), so they can be
  composed server-side as strings and handed to the client component for read-only preview; no
  server action needed for that.

## 4. Dependencies

Confirmed: none. No `zod` — hand validation matching the `NOTE_MAX_LEN` clamp pattern in the
minutes-email route. No `react-hook-form` — DECISION-084 already ruled against adopting it
project-wide via a single feature; this feature doesn't reopen that, it reinforces it (still
installed-but-unused, still flagged for the 30-day dependency review). No new email-templating
library — HTML string building matches `renderMinutesEmailHtml()`. The only "new" code in
`email.ts` is the `sendBulkMemberEmail()` wrapper from §2, which is a modification to an existing
file, not a new dependency.

## 5. Data model

**New table, not a reuse of `email_queue`.** Confirmed by reading the schema:
`email_queue` has `to` (free text), `subject`, `html`, `status`, `attempts`, `sentAt` — no
`memberId`, no `fiscalYear`. Matching "who was reminded, for which year, when" against a free-text
`to` column would be fragile (display-name formatting, case, member email changes) and is exactly
the kind of query `email_queue` was never designed to answer — it's a delivery log, not a domain
record, as Phase 1 correctly frames it.

New table `dues_reminders` (exact column list is database-admin's call in Phase 3/4, per Phase 1's
own deferral), but architecturally it must:
- Carry `memberId`, `fiscalYear`, `sentAt`, `sentByUserId` (actual clicker), `signedAsMemberId`
  (resolved Treasurer office-holder at send time), and a nullable `emailQueueId` FK.
- Follow the existing nullable-FK-with-`onDelete: "set null"` idiom already used elsewhere in
  `schema.ts` (e.g. the FK to `duesPayments.id`) for the link to `email_queue` — the domain row
  must survive even if its `email_queue` row is later pruned.
- Be indexed on `(memberId, fiscalYear)` for the "last reminded" badge query (Flow 3) and on
  `(fiscalYear, sentAt)` for any admin-facing send-history view.
- Ship as a new idempotent migration, `0086_dues_reminders.sql` (`CREATE TABLE IF NOT EXISTS`),
  next in sequence after `0085_proposals_permissions.sql`.

No new `FEATURES` key and no accompanying permissions migration — `dues.manage` already exists and
already covers this (confirmed in `src/lib/permissions.ts`), matching Phase 1's own permissions
section.

## 6. Invariant compliance

- **Schema is source of truth:** `dues_reminders` goes into `schema.ts` first, migration second. ✓
- **Idempotent migrations:** single `CREATE TABLE IF NOT EXISTS`, no `ALTER` on existing tables. ✓
- **`FEATURES` + `hasFeature()`:** confirmed by reading `getAdminProtectionRules()` and
  `ADMIN_NAVIGATION` — the "Dues" nav item's `href` is `/admin/dues` with
  `requiredFeature: FEATURES.DUES_VIEW`, and the proxy derives protection **per top-level path
  segment**, so `/admin/dues/reminders` inherits the proxy's coarse gate at `DUES_VIEW` — not
  `DUES_MANAGE`. This is exactly the "widening a nav entry's permission widens proxy access"
  situation CLAUDE.md warns about: the proxy alone would let a `dues.view`-only holder reach the
  reminders page. The page and the route handler must each independently enforce the *stricter*
  `DUES_MANAGE` check and `redirect()`/403 on failure — this is not optional, and it already has
  same-directory precedent (`admin/dues/[memberId]/page.tsx` does its own `hasFeature(DUES_MANAGE)`
  check today for exactly this reason). Note also that `src/lib/admin-page-feature-gates.test.ts`
  only statically enforces this for *top-level* segments under `admin/` (i.e., `dues` itself) —
  it will not fail the build if `reminders/page.tsx` ships without its own gate, because it's
  nested. The obligation is real and load-bearing anyway; it's just not machine-checked at this
  nesting depth. Flag to qa: manually verify a `dues.view`-only (non-`dues.manage`) account is
  blocked from `/admin/dues/reminders` and from `POST /api/admin/dues/reminders`.
- **No native browser dialogs:** confirm/send step must use `<ConfirmDialog>`, per Phase 1's own
  design.
- **No secrets in committed files:** N/A, no new secrets introduced (`treasurer@…` and
  `RESEND_FROM_EMAIL` are existing env/config, not new).

## 7. Problems flagged in Phase 1 / the rulings

Nothing else rises to an architectural problem. Two non-blocking notes for the handoff:

- The `POSITION_ORDER` lookup in `/api/public/leadership/route.ts` normalizes case
  (`.toLowerCase().trim()`) for sorting, but Phase 1's signer resolution calls for an **exact**
  `position = 'Treasurer'` match with a hard fail on zero-or-many. Tech-lead should decide whether
  "exact" means case-sensitive-exact (a `position` value of `"treasurer"` lowercase fails loudly,
  forcing a data-entry fix) or case-insensitive-exact (matches the leadership page's existing
  leniency). Either is defensible; just make it a decision, not an accident of whichever
  comparison operator gets typed first.
- `sendBulkMemberEmail()` (§2) is new shared surface with no consumer yet besides this feature.
  Once it ships, it becomes the expected entrypoint for any future "email many members at once"
  feature — worth a one-line mention in `src/lib/email.ts`'s own doc comment (next to the existing
  guardrail comment) so a future implementer finds it by reading the file, not by re-discovering
  the need and re-implementing a local guard again.

## Outputs

- Work-log updated: `docs/work-log/2026-08-12-dues-reminder-emails.md` (this file) — Phase 2
  section added, Per-Phase Status row set to Approved with suggestions / 2026-08-12.
- Decision logged: `docs/decisions.md`, **DECISION-085** — see entry.

## Handoff notes for tech-lead (Phase 3)

- Design `sendBulkMemberEmail()`'s exact signature and where inside `email.ts` the unconditional
  non-prod block short-circuits (§2) — this is the one piece of this review that changes Phase 1's
  proposed mechanism, not just its detail.
- Confirm `dues_reminders` column list/nullability/indexes with database-admin (§5).
- Decide case-sensitivity of the `position = 'Treasurer'` match (§7).
- Carry forward Phase 1's still-open items unchanged: repeat-send 14-day warning copy, empty-state
  copy, mobile layout at 360px, and the unverified `treasurer@westervillelions.org` deliverability
  (flag to qa for the first real send).

---

## Scope widened (2026-08-12) — CC the treasurer on treasury mail

The treasurer, mid-Phase-2:

> "lets also make sure the donations acknowledgement emails cc the treasurer while we are
> at it. general rule, any email that goes out as part of the treasurery should cc the
> treasurer"

Two findings that shape how this lands:

1. **There are no donor acknowledgment emails to CC.** Acknowledgment letters are print-only
   (v1.61.0 recorded donor addresses explicitly for "when emailing arrives"); the send path
   was never built. The rule is recorded here so that whoever builds it inherits the rule
   rather than rediscovering it.
2. **`sendEmail()` supports neither CC nor BCC**, and `email_queue` has no columns for
   either. So the treasurer's general rule and this feature's own BCC requirement need the
   same foundation. Building it once, in the email layer, is why the scope is widened here
   rather than deferred.

### What is in scope now

- `cc` / `bcc` added to `sendEmail()`'s options, persisted on `email_queue` so a queued
  message is a faithful record of what was actually sent, and shown on the email-queue
  viewer.
- **The treasury CC rule applied to the five treasury emails that exist today**, all in the
  Ledger: reimbursement approved / rejected / paid (to the member), and the two
  disbursement-pending-approval notices (to board approvers). CC goes to the office-holder
  resolved from Board `position = 'Treasurer'` — the same lookup that signs the dues
  reminder, so there is one definition of "the treasurer" in the codebase.
- The dues reminder's own BCC, already required.

### Rule of thumb, for whoever adds the next treasury email

Any mail sent as part of running the club's money CCs the treasurer. The treasurer should
never have to ask whether a member was actually told something. When the donor
acknowledgment email is eventually built, it inherits this rule.

**Not in scope:** building the donor acknowledgment email itself. That is its own feature.
