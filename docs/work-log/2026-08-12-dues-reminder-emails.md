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
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-12 |
| 4 — Implementation (schema) | database-admin | Complete | — | 2026-08-12 |
| 4 — Implementation (server) | api-developer | Complete | — | 2026-08-12 |
| 4 — Implementation (client) | ux-developer | Pending | — | — |
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

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Two things ship together, per the scope-widening above: (1) `sendEmail()`/`email_queue` gain
`cc`/`bcc`, and a new sibling entrypoint `sendBulkMemberEmail()` gives any future "email many
members" feature an unconditional non-production block by construction; (2) the Dues Reminder
Emails feature itself — a new `/admin/dues/reminders` screen that lets a `dues.manage` holder
preview, select, and send a warm, non-collections nudge to unpaid/partial-balance members for a
fiscal year, signed by the Board's `position = 'Treasurer'` office-holder, BCC'd to that same
office-holder, logged in a new `dues_reminders` table. A third, small piece falls out of doing
this cleanly: the "who is the Treasurer" lookup is now needed by three call sites with the same
exact-one-or-fail semantics (the reminder signer, and the five existing treasury emails' new CC),
so it's extracted once into `src/lib/board-positions.ts` rather than duplicated a second time —
see DECISION-086.

Nothing in Phase 1/2's settled rulings is reopened here: signing, the unpaid/partial split, the
14-day non-blocking cooldown warning, the personal note, and the safety-guard placement in
`email.ts` are taken as given.

## Permissions

No new `FEATURES` key. `FEATURES.DUES_MANAGE` (`dues.manage`) already exists and already binds to
`admin` and `treasurer` (migration `0041_dues_permissions.sql`) — it gates both the
`/admin/dues/reminders` page and both new API routes, **independently of the proxy**, per Phase
2 §6: `/admin/dues` (and everything nested under it) is admitted through `src/proxy.ts` at the
weaker `FEATURES.DUES_VIEW` because that's what the top-level `ADMIN_NAVIGATION` "Dues" entry
declares. `admin-page-feature-gates.test.ts` only walks top-level `admin/` segments, so it will
not catch a missing gate on the nested `reminders/` page — the obligation is real, just not
machine-checked at this depth (same as the existing `admin/dues/[memberId]/page.tsx`, which is the
precedent to copy exactly: `auth()` → `hasFeature(FEATURES.DUES_MANAGE)` → `redirect("/admin/dues")`
on failure, in the page body, independent of the route handler's own check).

## 1. Email layer — `cc`/`bcc` on `sendEmail()` and `email_queue`

**Schema (`src/lib/db/schema.ts`, `emailQueue`):** add two nullable columns, matching the existing
column style exactly:

```ts
export const emailQueue = pgTable("email_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  from: text("from").notNull(),
  cc: text("cc"),
  bcc: text("bcc"),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  nextRetryAt: timestamp("next_retry_at"),
});
```

**Migration `drizzle/migrations/0087_email_queue_cc_bcc.sql`** (see §4 for why this is 0087, not
0086 — that number is already spoken for):

```sql
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS cc text;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS bcc text;
```

Both statements are idempotent (`IF NOT EXISTS`) and touch only the one existing table — no
backfill needed since both are nullable and every historical row correctly has neither.

**`src/lib/email.ts`:**

```ts
interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  /** @internal Set only by sendBulkMemberEmail() below — see its doc comment.
   *  Never set this from feature code; call sendBulkMemberEmail() instead. */
  _bulkMemberSend?: boolean;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  /** The persisted email_queue row id — present whether the send succeeded,
   *  failed, or was blocked, so a caller that wants to link a domain record
   *  (e.g. dues_reminders.emailQueueId) to the delivery record can do so
   *  without a second lookup. Additive — every existing caller destructures
   *  only { success, error } today and is unaffected. */
  emailQueueId: string;
}
```

`sendEmail()` changes:
- The initial `db.insert(emailQueue).values({...})` gains `cc: cc ?? null, bcc: bcc ?? null`.
- Every `SendEmailResult` return adds `emailQueueId: queued.id`.
- The existing non-production guard condition widens from `isClubDistributionList(to)` to
  `isClubDistributionList(to) || options._bulkMemberSend` — one added clause on the existing
  `if`, not a second code path. `isClubDistributionList()` itself is untouched (still
  address-based, still the two lists only), matching Phase 2's ruling that it must not be widened
  or special-cased.
- `resend.emails.send({...})` gains `...(cc && { cc: [cc] }), ...(bcc && { bcc: [bcc] })`.

**Existing call sites are unaffected.** Every current `sendEmail({...})` call omits `cc`/`bcc`;
they destructure to `undefined`, insert as `null`, and the Resend call omits the fields exactly as
today. No call site needs to change to keep working — only the seven sites in §3 opt in.

**`sendBulkMemberEmail()`** — the new sanctioned entrypoint for "email many individual members at
once" (DECISION-085 §2/DECISION-086):

```ts
interface SendBulkMemberEmailRecipient {
  to: string;
  html: string; // pre-rendered per-recipient body; subject is shared across the batch
}

interface SendBulkMemberEmailOptions {
  from: string;
  subject: string;
  replyTo?: string;
  bcc?: string;
  recipients: SendBulkMemberEmailRecipient[];
}

interface SendBulkMemberEmailResult {
  results: Array<{ to: string; success: boolean; error?: string; emailQueueId: string }>;
}

/**
 * Send the same subject to many individual members, one sendEmail() call per
 * recipient. Every call is made with _bulkMemberSend: true, which widens
 * sendEmail()'s non-production guard UNCONDITIONALLY — no address matching,
 * so a member added to dev/QA data after this code was written still gets
 * blocked. This is the load-bearing safety property (DECISION-085): a dev
 * or QA run of this feature must never be able to reach a real member's
 * inbox. Reuses sendEmail()'s own queue-insert/blocked-status write; nothing
 * is duplicated. One recipient's failure never aborts the others' sends.
 */
export async function sendBulkMemberEmail(
  options: SendBulkMemberEmailOptions,
): Promise<SendBulkMemberEmailResult> {
  const { from, subject, replyTo, bcc, recipients } = options;
  const results: SendBulkMemberEmailResult["results"] = [];
  for (const r of recipients) {
    const result = await sendEmail({
      to: r.to,
      from,
      subject,
      html: r.html,
      replyTo,
      bcc,
      _bulkMemberSend: true,
    });
    results.push({ to: r.to, success: result.success, error: result.error, emailQueueId: result.emailQueueId });
  }
  return { results };
}
```

Add a one-line doc comment next to the existing guardrail comment in `email.ts` noting
`sendBulkMemberEmail()` as the expected entrypoint for future "email many members" features, per
Phase 2 §7.

**`/admin/email-queue` viewer** (`src/app/(dashboard)/admin/email-queue/page.tsx` +
`view-email-dialog.tsx`): each of the three tables (`Failed`, `Blocked (Non-Production)`,
`Recently Sent`) gets a `Cc`/`Bcc` cell rendered only when the row has one (`item.cc &&
<div className="text-xs text-gray-500">Cc: {item.cc}</div>`, same treatment as `To`) —
placed under the existing `To` cell, not a new column, to avoid widening three already-wide
tables. `ViewEmailDialog` gets optional `cc`/`bcc` props shown in its existing metadata row
(`To: … | Cc: … | Bcc: …`) alongside the existing `To` / `StatusPill` / `Queued` line.

## 2. `sendBulkMemberEmail()` — recap of why this shape (DECISION-085, confirmed)

Covered above; restating the constraint explicitly since it's the one piece of this design that
overrides Phase 1's original proposal: **no feature-local reimplementation of the block.** The
reminders route (§5) never calls `sendEmail()` directly for the batch send — it calls
`sendBulkMemberEmail()` exclusively. A code review that finds a hand-rolled loop over
`sendEmail()` for member-address batches anywhere in this feature is a defect, not a stylistic
nit.

## 3. The treasury CC rule — five existing sends, one resolver

**Where the resolver lives — `src/lib/board-positions.ts` (new file).** Phase 2 declined to
extract a shared Treasurer lookup out of `/api/public/leadership/route.ts`, reasoning that two
consumers with different semantics (display-many vs. exact-one-or-fail) didn't yet justify it, and
explicitly deferred: *"If a third feature needs board-position lookup, extract then, not
preemptively."* The treasury-CC rule is that third consumer — and unlike the dues-reminder signer
(which hard-blocks on failure), it needs *tolerant* failure (§ below), so it isn't even the same
shape as the one Phase 2 already anticipated putting in `dues-reminders-queries.ts`. Duplicating
the lookup a second time inside the ledger routes was the one outcome Phase 2's own reasoning was
built to prevent. Logged as DECISION-086.

```ts
// src/lib/board-positions.ts — DB-facing, no "use client" import anywhere upstream needed.
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export type TreasurerResolution =
  | { ok: true; memberId: string; firstName: string; lastName: string; email: string }
  | { ok: false; reason: "no_board_group" | "none" | "multiple"; boardGroupId?: string };

/**
 * Resolves the single Board of Directors member whose position is
 * "Treasurer" (case-insensitive, trimmed — see rationale below). Never
 * guesses: zero or multiple matches both return ok: false. The ONE
 * definition of "the Treasurer" in this codebase — the dues reminder
 * signer (§5) and the five treasury-email CC sites (below) both call this
 * and only this.
 */
export async function resolveTreasurer(): Promise<TreasurerResolution> {
  const boardGroup = await db.query.groups.findFirst({
    where: sql`lower(${groups.name}) = 'board of directors'`,
  });
  if (!boardGroup) return { ok: false, reason: "no_board_group" };

  const rows = await db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
    })
    .from(groupMemberships)
    .innerJoin(members, eq(groupMemberships.memberId, members.id))
    .where(
      and(
        eq(groupMemberships.groupId, boardGroup.id),
        sql`lower(trim(${groupMemberships.position})) = 'treasurer'`,
      ),
    );

  if (rows.length === 0) return { ok: false, reason: "none", boardGroupId: boardGroup.id };
  if (rows.length > 1) return { ok: false, reason: "multiple", boardGroupId: boardGroup.id };
  return { ok: true, ...rows[0] };
}
```

**Case-sensitivity decision (Phase 2 §7, undecided until now):** case-insensitive, trimmed exact
match (`lower(trim(position)) = 'treasurer'`). Rationale: the existing
`/api/public/leadership/route.ts` already normalizes case for its own position handling
(`.toLowerCase().trim()`), so this matches established leniency rather than inventing a stricter
rule this codebase doesn't otherwise apply; a bare casing/whitespace difference (`"treasurer "`
from a copy-paste in `/admin/groups`) is not the kind of ambiguity "fail loudly" was meant to
catch — genuine zero-match or multiple-match conditions still fail loudly exactly as designed.

**Applied to the five sends**, all via a shared pattern — resolve once per request, CC when
available, never throw:

```ts
const treasurer = await resolveTreasurer();
if (!treasurer.ok) {
  console.warn(`[Ledger email] Treasurer CC skipped: ${treasurer.reason}`);
}
await sendEmail({
  to: memberEmail,
  from: fromEmail,
  subject: "...",
  html: "...",
  ...(treasurer.ok ? { cc: treasurer.email } : {}),
});
```

- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` — three sends (approved ~L201, rejected
  ~L261, paid ~L453), each already inside a `try { … } catch { /* best-effort */ }` block. The
  `resolveTreasurer()` call goes inside that same `try` — a resolver failure never throws past the
  catch, so it degrades to "no CC" exactly like a `sendEmail()` failure already degrades to
  "logged, request still succeeds."
- `src/app/api/admin/ledger/transactions/route.ts` — two sends (~L383, ~L687), each a `for (const
  email of approverEmails)` loop notifying every `LEDGER_APPROVE` holder of a pending disbursement.
  CC is added once per loop iteration (resolve `treasurer` once, outside the loop, reuse for every
  approver email) — if the Treasurer happens to also hold `LEDGER_APPROVE`, they get one `To` and
  one `Cc` line in the same message here, which is a harmless, expected overlap, not a duplicate
  send.

**Failure mode, explicit per the prompt's ask:** if `resolveTreasurer()` returns `ok: false` for
any reason (no Board group, zero Treasurers, multiple Treasurers), **the underlying email still
sends, just without a CC** — a `console.warn` is the only signal. This is deliberately the
opposite failure mode from §5's reminder screen, which hard-blocks: a member's reimbursement
notification or a board approver's pending-approval alert is time-sensitive and must never be
silently dropped because of an unrelated data-entry gap in `/admin/groups`. Only the dues-reminder
*signature* — where "who signed this" is the entire point of the email — blocks on failure.

## 4. Data model

**`drizzle/migrations/0086_dues_reminders.sql`** — this number was already assigned by Phase 2
(DECISION-085) before the scope widened to include the email-layer change, so it stays as named;
the email `cc`/`bcc` migration takes the next free number, `0087` (§1), rather than colliding with
it. Both are independent (one `ALTER`s `email_queue`, the other `CREATE TABLE`s `dues_reminders`)
so their relative order doesn't matter functionally.

```sql
CREATE TABLE IF NOT EXISTS dues_reminders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  fiscal_year           integer     NOT NULL,
  cohort                text        NOT NULL, -- 'unpaid' | 'partial' — which template variant was actually sent
  sent_by_user_id       uuid        REFERENCES users(id) ON DELETE SET NULL,   -- who clicked Send
  signed_as_member_id   uuid        REFERENCES members(id) ON DELETE SET NULL, -- resolved Treasurer at send time
  email_queue_id        uuid        REFERENCES email_queue(id) ON DELETE SET NULL,
  success               boolean     NOT NULL,
  error                 text,
  note                  text,       -- the treasurer's optional per-send free-text note, verbatim
  sent_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_dues_reminders_member_fy') THEN
    CREATE INDEX ix_dues_reminders_member_fy ON dues_reminders(member_id, fiscal_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_dues_reminders_fy_sent') THEN
    CREATE INDEX ix_dues_reminders_fy_sent ON dues_reminders(fiscal_year, sent_at);
  END IF;
END $$;
```

`schema.ts` addition mirrors this with `pgTable`/`index()`, following the `duesPayments` table
immediately below it (same `memberId` FK style — `onDelete: "cascade"` — since a reminder log row
with no member is meaningless and members aren't hard-deleted in practice, only deactivated via
`membershipStatus`).

Two columns beyond Phase 2's minimum list (`memberId`, `fiscalYear`, `sentAt`, `sentByUserId`,
`signedAsMemberId`, nullable `emailQueueId`), added here as an implementation-level fill-in Phase 2
explicitly deferred to Phase 3/4:
- **`cohort`** — without it, "was this member's last reminder the zero-paid or partial-balance
  wording" can't be answered later (dues status is mutable — a member who was `unpaid` when
  reminded may be `partial` by the time anyone looks at the log), and the treasurer needs that
  distinction to judge whether a second nudge is warranted.
- **`success`/`error`** — Phase 1's Gaps section names "a record of what was sent to whom and
  when" and Flow 1's failure path requires per-recipient failure visibility; without a boolean on
  the domain row itself, answering "did this member's reminder actually go out" requires a join
  through the nullable `emailQueueId` that may itself be null (a `sendBulkMemberEmail()` call that
  never reached `sendEmail()` — it can't happen given the design above, but the row should be
  self-describing regardless of `email_queue`'s retention).
- **`note`** — persists the treasurer's own optional note verbatim, so a later question ("what did
  we actually tell this member") doesn't depend on `email_queue.html` still existing.

No new `FEATURES` key, no permissions migration — confirmed again per Phase 2 §5.

## 5. API contract

Both routes live at `src/app/api/admin/dues/reminders/route.ts`, nested under the existing
`/api/admin/dues` tree per Phase 2 §1. **Every handler independently calls `auth()` +
`hasFeature(session.user.id, FEATURES.DUES_MANAGE)`** — the proxy only admits at `DUES_VIEW` for
this path (Permissions section above); relying on it would leak the recipient list (member names +
emails + payment status) to a `dues.view`-only account.

### `GET /api/admin/dues/reminders?fiscalYear=2026`

Purpose: refresh the cohort/signer preview without a full page reload (the client's "Refresh list"
action — see §7). The page's *first* paint does not call this route; `page.tsx` (Server Component)
calls the same underlying query function directly for its initial render, matching the "Resolves
the fiscal-year param, does the initial cohort + signer fetch server-side for first paint" split
Phase 2 already specified.

- 401 unauthenticated, 403 not `dues.manage`.
- 400 if `fiscalYear` is missing or not a positive integer.
- 200:
  ```ts
  {
    fiscalYear: number;
    seasonLabel: string;          // "2026–27"
    duesSettings: { individualAmountCents: number; familyAmountCents: number } | null;
    signer:
      | { ok: true; firstName: string; lastName: string }
      | { ok: false; reason: "no_board_group" | "none" | "multiple"; boardGroupId?: string };
    unpaid: ReminderCandidate[];
    partial: ReminderCandidate[];
  }
  ```
  where
  ```ts
  type ReminderCandidate = {
    memberId: string;
    firstName: string;
    lastName: string;
    email: string;
    duesCategory: "individual" | "family";
    lastReminded: { sentAt: string; cohort: "unpaid" | "partial" } | null;
  };
  ```
  `unpaid`/`partial` are sourced from `listMemberDuesStatus(fiscalYear)` (existing function,
  untouched — Phase 2 §1's non-negotiable: the reminder screen must never be able to disagree with
  `/members/dues`), filtered to `status === 'unpaid'` / `'partial'`, joined against
  `dues_reminders` for each member's most recent row that fiscal year.

### `POST /api/admin/dues/reminders`

Purpose: send. Body:
```ts
{ fiscalYear: number; memberIds: string[]; note?: string }
```
Hand-rolled validation (no `zod`, matching `NOTE_MAX_LEN` precedent from the minutes-email route):
`fiscalYear` positive integer; `memberIds` non-empty array of strings, deduped via `Set` server-side
(closes the "same member selected under both cohorts" edge case structurally — see §8); `note`
optional, trimmed, sliced to `NOTE_MAX_LEN = 1_000`.

Steps:
1. `auth()` + `hasFeature(DUES_MANAGE)` → 401/403.
2. `resolveTreasurer()` — if `!ok`, **400**, nothing sent, response `{ error: "No single Treasurer
   found in the Board of Directors group — fix the group position before sending reminders.",
   reason, boardGroupId? }`. Hard block, matching Flow 1's failure path exactly (never guesses,
   never falls back to the sender's own name).
3. Re-run `listMemberDuesStatus(fiscalYear)` **fresh** — this is the "server re-derives at send
   time, never trusts the client's payload" requirement from Phase 1's Gaps. Build the actual
   send list from *this* query's `status`, not from anything the client submitted.
4. For each requested `memberId`: if absent from the fresh unpaid/partial sets (now `paid`, no
   longer `isActive`) → `skipped.push({ memberId, reason: "now_paid" | "no_longer_active" })`. If
   present but `email` is blank/whitespace-only → `skipped.push({ memberId, reason: "no_email_on_file" })`
   (defensive only — `members.email` is `NOT NULL` and validated non-empty at creation, so this
   should be unreachable in practice, but the row is filtered rather than trusted blindly; see §8).
5. Render each survivor's HTML via `renderDuesReminderBody(cohort, {...})` (§6) using the cohort
   the *fresh* query assigned, the resolved signer, the active `duesSettings` row for this FY, and
   the shared `note`.
6. `sendBulkMemberEmail({ from: "treasurer@westervillelions.org", subject: renderDuesReminderSubject(fiscalYear), replyTo: treasurer.email, bcc: treasurer.email, recipients })`.
7. For every result, insert one `dues_reminders` row (`memberId`, `fiscalYear`, `cohort`,
   `sentByUserId: session.user.id`, `signedAsMemberId: treasurer.memberId`, `emailQueueId`,
   `success`, `error`, `note`).
8. **200 always** (per DECISION-075 §6 precedent this codebase already established for the minutes
   email — a partial or total send failure is a *successful API call reporting failure*, never a
   500):
   ```ts
   {
     signer: { firstName: string; lastName: string };
     sent: Array<{ memberId: string; email: string; cohort: "unpaid" | "partial"; success: boolean; error?: string }>;
     skipped: Array<{ memberId: string; reason: "now_paid" | "no_longer_active" | "no_email_on_file" }>;
   }
   ```

## 6. Email copy — final

**`seasonLabel(fy)`** (new pure helper, `src/lib/dues-reminders.ts`) — member-facing, distinct from
the existing admin-facing `fiscalYearLabel()` (`"FY2026 (Jul 2026 – Jun 2027)"`):
`seasonLabel(2026) → "2026–27"`.

**`formatDuesAmount(cents)`** (new pure helper, same file) — drops the trailing `.00` for a
friendlier read in prose (every seeded amount today is a round dollar figure) but stays exact if a
future amount isn't: `12000 → "$120"`, `9650 → "$96.50"`.

**Subject (both cohorts, one line):**
> A friendly note about your {{seasonLabel}} Westerville Lions dues

**Body — Unpaid cohort (zero paid):**

> Hi {{firstName}},
>
> I hope this finds you well! I'm reaching out with a quick, friendly note — our records show
> we haven't yet received your dues for the {{seasonLabel}} Lions year. It's an easy thing to
> lose track of, especially with everything else going on, so consider this a gentle nudge
> rather than anything to worry about.
>
> Dues are {{formatDuesAmount(individualAmountCents)}} for the year, or
> {{formatDuesAmount(familyAmountCents)}} for a family membership.
>
> You can see your dues status anytime at {{link to /members/dues}}. If you've already sent a
> payment and it just hasn't made it into our records yet, please just let me know — that
> happens on my end sometimes, and I'd love to get it squared away.
>
> {{optional treasurer note, if provided}}
>
> Thank you, truly, for everything you do for our club and our community — it means a great
> deal, and it's never gone unnoticed.
>
> With gratitude,
> {{signerFirstName}} {{signerLastName}}
> Treasurer, Westerville Lions Club

**Body — Partial-balance cohort:**

> Hi {{firstName}},
>
> Hope you're doing well! Just a friendly note that our records show a balance still remaining
> on your {{seasonLabel}} Lions dues. No stress at all — these things happen, and I just wanted
> to flag it in case it slipped your mind.
>
> Dues are {{formatDuesAmount(individualAmountCents)}} for the year, or
> {{formatDuesAmount(familyAmountCents)}} for a family membership.
>
> You can see the details anytime at {{link to /members/dues}}. If this doesn't look right, just
> reply and let me know — happy to sort it out together.
>
> {{optional treasurer note, if provided}}
>
> Thank you for all you do for our club!
>
> With gratitude,
> {{signerFirstName}} {{signerLastName}}
> Treasurer, Westerville Lions Club

**Headers:** `From: treasurer@westervillelions.org`, `Reply-To:` and `Bcc:` both the resolved
office-holder's own `members.email` (per the treasurer's own ruling — `treasurer@` is a forwarding
alias that may retain no copy). No dollar amount owed, no due date, no "please remit by" — matches
Phase 1's copy notes exactly. The standard-rate sentence is built from `duesSettings` at send time
(§5 step 5), never hard-coded, so it can never drift from the books.

**Note placement**, when provided: rendered above the closing gratitude line, in its own
visually-offset paragraph (blockquote-style), matching the precedent
`renderMinutesEmailHtml(detail, note)` already established ("note renders above the … content when
present"). Both the note and `{{firstName}}` are HTML-escaped before interpolation — this is a
templated HTML email built from free text, and neither the treasurer's own note nor a member's
stored first name is trusted content.

## 7. Component plan

**Server:** `src/app/(dashboard)/admin/dues/reminders/page.tsx` — `auth()` +
`hasFeature(FEATURES.DUES_MANAGE)` + `redirect("/admin/dues")`, `?fy=` query param (default =
`getActiveFiscalYear()`), calls `listMemberDuesStatus`, `resolveTreasurer`, and a new
`getLastReminded(memberIds, fiscalYear)` query directly (no round-trip through the GET route for
first paint), passes everything as props to the client component. Standard admin header style
(`text-3xl font-bold text-gray-900`, matching `/admin/email-queue`, not the public/member-portal
blue-gradient hero — this is an admin surface). **No new `ADMIN_NAVIGATION` entry** — reached via a
"Send Reminders" button added to the existing `/admin/dues/page.tsx`, the same precedent
`admin/dues/[memberId]/page.tsx` already sets for a nested, unlisted admin sub-page.

**Client:** `src/components/admin/dues-reminder-sender.tsx` (`"use client"`, naming convention
matches `dues-add-payment-button.tsx` / `dues-configure-modal.tsx`):
- Two sections, "Unpaid" (checkboxes pre-checked) and "Balance remaining" (pre-unchecked), each a
  `rounded-2xl` card list; empty state `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`
  ("Nobody owes dues for the {{seasonLabel}} season right now.") when both are empty.
- Each row: name, email, `duesCategory` badge, and a "Last reminded" badge — gray if none or
  ≥14 days ago, amber if `< 14 days ago` (via the pure `isWithinReminderCooldown()` helper, §9).
- A "Refresh list" button hitting `GET` to re-pull without a full navigation.
- Optional note `<textarea>`, capped client-side at 1,000 chars matching `NOTE_MAX_LEN`.
- A read-only preview of both rendered bodies (subject + HTML, iframe-sandboxed exactly like
  `ViewEmailDialog` — this is still untrusted-in-principle rendered HTML even though the app
  generated it).
- If `signer.ok === false`: no Send button at all; a blocking message naming the reason, linking to
  `/admin/groups/${boardGroupId}` when available ("No single Treasurer found in the Board of
  Directors group — fix the group position before sending reminders.").
- `<ConfirmDialog>` on Send: title states the selected count; description adds a line "N of these
  were reminded within the last 14 days" when that count is > 0. `destructive` prop **not** set —
  sending a reminder isn't a destructive action in the delete-something sense.
- After send: per-recipient results list (name, cohort, success/failure + reason) rendered inline,
  not just a toast — mirrors the minutes-email failure-surfacing precedent (Flow 1's failure path).
- Mobile at 360px: rows are a stacked card layout below `sm:`, not a table — name/email/badges
  stack vertically, checkbox stays top-right.

**Files modified:**
- `src/app/(dashboard)/admin/dues/page.tsx` — add the "Send Reminders" button/link.
- `src/app/(dashboard)/admin/email-queue/page.tsx`, `view-email-dialog.tsx` — `cc`/`bcc` display
  (§1).
- The five ledger send sites (§3).

## 8. Edge cases

- **Member with no email address.** `members.email` is `NOT NULL`, unique, and required non-empty
  at creation (`src/app/api/admin/members/route.ts` L79). This should be structurally unreachable
  today, but the POST route still filters any blank/whitespace email defensively into `skipped`
  with `reason: "no_email_on_file"` (§5 step 4), and the GET preview surfaces the same members
  under an "excluded — no email on file" note rather than silently omitting them, so the treasurer
  can see *why* the count is smaller than expected rather than assuming full coverage.
- **Treasurer position unset or held by two members.** `resolveTreasurer()` returns `ok: false`;
  the reminder screen shows a blocking error and no Send button (never guesses); the five ledger
  sends degrade to "no CC, logged via `console.warn`" and still send (§3) — deliberately different
  failure modes because one email's entire point is the signature and the other five are not.
- **A send that partially fails.** Every recipient is an independent `sendEmail()` call inside
  `sendBulkMemberEmail()`; one failure never aborts the loop. The POST response's `sent[]` array
  and the per-row `dues_reminders.success/error` make every individual outcome visible; the UI
  lists failed names by name, not just an aggregate count (§7).
- **The same member in both cohorts.** Structurally impossible from a single `listMemberDuesStatus`
  call — `deriveStatus()` returns exactly one of `paid`/`partial`/`unpaid` per member — but a
  member could theoretically be checked in the client's stale "Unpaid" list while a payment lands
  between load and send, making them `partial` (or `paid`) by send time. The POST route dedupes
  `memberIds` via `Set` and assigns cohort from the *fresh* query only (§5 step 3), so a member is
  sent at most once, with whichever wording currently matches their real status — never both.
- **`position` case-sensitivity.** Decided (§3): case-insensitive, trimmed exact match against
  `"treasurer"`.
- **Stale recipient list between preview and send.** Already covered structurally by step 3/4 of
  the POST handler — this is not a separate mechanism, it's the same fresh-query re-derivation
  that resolves the cohort question above.

## 9. Unit tests required (Phase 4 implementer writes these, not qa)

**`src/lib/dues-reminders.test.ts`** (new, pure — no DB, mirrors `dues.test.ts`):
1. `seasonLabel(2026)` → `"2026–27"` (and the FY-boundary case, e.g. `seasonLabel(2025)` →
   `"2025–26"`).
2. `formatDuesAmount(12000)` → `"$120"`; `formatDuesAmount(9650)` → `"$96.50"` (non-round cents
   preserved).
3. `renderDuesReminderSubject(2026)` returns the exact expected string.
4. `renderDuesReminderBody('unpaid', {...})` — asserts the standard-rate sentence reflects
   **whatever `duesSettings` values are passed in** (call it twice with different amounts, assert
   the output differs accordingly — this is the regression test for "never hard-coded"), asserts
   no per-member dollar-owed figure appears anywhere in the output.
5. `renderDuesReminderBody('partial', {...})` — asserts the body never contains "haven't paid" /
   "have not paid" (must read as a balance, not an accusation).
6. Note rendering — present vs. absent; a note containing `<script>alert(1)</script>` is
   HTML-escaped in the output (XSS regression).
7. A member first name containing `<`/`&` is HTML-escaped in the output (same class of bug, second
   interpolation site).
8. `classifyRecipients(requestedMemberIds, freshStatuses)` (pure, extracted from the route so it's
   testable without a DB) — splits into per-cohort sends vs. `skipped` (`now_paid`,
   `no_longer_active`, `no_email_on_file`), and de-duplicates a `memberId` that appears twice in
   the request.
9. `isWithinReminderCooldown(lastRemindedAt, now)` — boundary test at exactly 14 days (one test
   just under 14 days → `true`, one at exactly 14 days → `false`, matching the ">= 14 days is no
   longer a warning" reading of Phase 1's ruling).

**`src/lib/board-positions.test.ts`** (new, DB mocked like `email-guardrail.test.ts`):
10. `resolveTreasurer()` — zero matches → `{ok:false, reason:'none'}`; exactly one → `{ok:true,
    ...}`; two or more → `{ok:false, reason:'multiple'}`; missing "Board of Directors" group →
    `{ok:false, reason:'no_board_group'}`; position values `"Treasurer"`, `"treasurer"`, `"
    Treasurer "` all match as the same single row.

**`src/lib/email-guardrail.test.ts`** (extend the existing file — it already has the exact mocking
scaffold needed):
11. `sendEmail()` persists `cc`/`bcc` onto the inserted `email_queue` row and forwards both to the
    mocked Resend `send()` call when provided; omitting both leaves the existing assertions
    (`cc: null, bcc: null` implicitly, no `cc`/`bcc` key sent to Resend) — regression coverage that
    every pre-existing call site is unaffected.
12. `sendBulkMemberEmail()` outside production — **every** recipient is blocked
    (`status: 'blocked_non_production'`, Resend's mocked `send()` never called), including an
    address that could never match `isClubDistributionList()` (e.g. a fabricated
    `newmember@example.com`) — this is the load-bearing regression test for DECISION-085's
    unconditional-block requirement; assert the mock call count is exactly 0 across a batch of
    several recipients, not just one.
13. `sendBulkMemberEmail()` in production (`NODE_ENV=production`) delivers per-recipient and
    returns individual `success`/`error`/`emailQueueId` per result; one recipient's induced
    failure (mock rejects once) does not prevent the next recipient's send.

## Edge cases already resolved by earlier phases (not reopened)

Repeat-send 14-day warning copy, mobile layout, and QA's obligation to confirm the first real send
from `treasurer@westervillelions.org` lands cleanly are all carried forward unchanged from Phase
1/2 and are captured in §§6–9 above where they land in this design.

## Out of Scope (unchanged from Phase 1/2)

Automatic/scheduled sending; an online-payment CTA in the email; fixing family/household
double-billing structurally; editing officer/role assignments from this feature; any channel
besides email; a "you were reminded" banner on `/members/dues`; building the donor-acknowledgment
email (tracked separately, inherits the treasury CC rule when it's built).

## Outputs

- Work-log updated: this file — Phase 3 section added, Per-Phase Status row set to Complete /
  2026-08-12.
- Decision logged: `docs/decisions.md`, **DECISION-086** — shared `resolveTreasurer()` extraction
  into `src/lib/board-positions.ts`, `sendEmail()`/`email_queue` `cc`/`bcc` + `sendBulkMemberEmail()`
  exact signature, and the `0086`/`0087` migration split.

## Open questions / handoff notes

Implementer selection — **specialist split**, following the same pattern every Ledger increment
has used (Phase 2 already described the module boundaries; this is genuinely too large for
full-stack-developer's ~150-line/small-and-coupled bar):

1. **database-admin** first: `schema.ts` (`emailQueue.cc/bcc`, new `duesReminders` table) +
   `drizzle/migrations/0086_dues_reminders.sql` + `drizzle/migrations/0087_email_queue_cc_bcc.sql`.
   Run migrations locally and confirm both apply cleanly against the existing dev DB before
   handoff.
2. **api-developer** second: `src/lib/email.ts` (`cc`/`bcc`, `sendBulkMemberEmail()`),
   `src/lib/board-positions.ts` (new), `src/lib/dues-reminders.ts` (new, pure),
   `src/lib/dues-reminders-queries.ts` (new, DB-facing — cohort/last-reminded/send orchestration),
   the five ledger route edits (§3), both new route handlers (§5), and **all thirteen unit tests
   named in §9** — this is the Phase 4 gate, not something qa backfills.
3. **ux-developer** third, once the API surface is real: `page.tsx`,
   `dues-reminder-sender.tsx`, the `/admin/dues` button, and the `email-queue` viewer's `cc`/`bcc`
   display.

Flag to **qa** for Phase 5 (carried forward from Phase 2, still unresolved by design — it's an
external-system fact, not a code fact): confirm the first real send from
`treasurer@westervillelions.org` actually lands and isn't spam-filtered, before the treasurer sends
to the whole unpaid list. Also manually verify a `dues.view`-only (non-`dues.manage`) account is
blocked from both `/admin/dues/reminders` and `POST /api/admin/dues/reminders` — this nesting depth
isn't covered by `admin-page-feature-gates.test.ts` (Phase 2 §6).

---

## Phase 4 — Implementation (schema) — 2026-08-12

**Owner:** database-admin
**Status:** complete

### Summary

Delivered exactly the two schema/migration items Phase 3 specified: the new `dues_reminders`
table (with the `cohort`/`success`/`error`/`note` columns Phase 3 added beyond Phase 2's
minimum) and nullable `cc`/`bcc` on `email_queue`. Checked `ls drizzle/migrations/*.sql | sort |
tail` first — highest existing was `0085_proposals_permissions.sql`, so `0086`/`0087` (already
assigned by Phase 2/3) don't collide with anything landed since. No route handlers, no
components, no `FEATURES` key — out of scope per the brief, left to api-developer/ux-developer.

### What I did

- Added `duesReminders` table to `src/lib/db/schema.ts`, placed immediately after
  `duesPayments` per Phase 3's stated placement, with `$inferSelect`/`$inferInsert` type
  exports (`DuesReminder`/`NewDuesReminder`) matching the file's convention.
- Added nullable `cc`/`bcc` text columns to the existing `emailQueue` table in `schema.ts`.
- Wrote `drizzle/migrations/0086_dues_reminders.sql` (`CREATE TABLE IF NOT EXISTS` + a guarded
  `DO $$ … END $$` block for the two indexes) and `drizzle/migrations/0087_email_queue_cc_bcc.sql`
  (two `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements) — both copied verbatim from Phase 3's
  SQL, since Phase 3 already fully specified them.
- **Timestamp ruling, verified rather than assumed:** queried DEV `information_schema.columns`
  for `created_at`/`decided_at`/`sent_at`/`submitted_at` across `proposals`, `proposal_decisions`
  (the most recently added tables, migration `0084`), `dues_payments`, and `email_queue`. Result:
  `proposals`/`proposal_decisions` are live as `timestamp with time zone`, matching their
  `schema.ts` declarations of `timestamp(..., { withTimezone: true })` — this is the current,
  deliberate convention (the `proposals` table already carries a comment in `schema.ts` stating
  this explicitly, contrasting it with the confirmed `minutes` table drift CLAUDE.md warns
  about). `dues_payments`/`email_queue` are live as naive `timestamp without time zone`, also
  matching their own `schema.ts` declarations — an older convention, not a drift. Chose
  `timestamp("sent_at", { withTimezone: true })` for `dues_reminders.sent_at`, matching the
  current convention and Phase 3's own migration SQL (`timestamptz`). Documented the reasoning
  inline in both `schema.ts` and the migration file so the next reader doesn't have to
  re-derive it.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Applied migrations to DEV twice in a row to prove idempotency (command below); second run
  produced only Postgres `NOTICE`-level "already exists, skipping" messages for `0086`/`0087`
  (and, incidentally, for `0084`/`0085` — those are pre-existing and unrelated to this change),
  no errors either time.
- Verified live column types/nullability/defaults for `dues_reminders` and the two new
  `email_queue` columns directly against DEV `information_schema.columns` and `pg_indexes` (not
  assumed) — every column, nullability, default, and both indexes match `schema.ts` exactly (full
  output in the report below).
- Ran `pnpm test` — 75 files / 1409 tests, all passing.
- Attempted `pnpm db:push` as a sanity check; it hit an **unrelated, pre-existing** interactive
  prompt about a `ledger_entities_slug_unique` constraint (offering to truncate a table with
  existing data) before ever reaching `dues_reminders`/`email_queue`, and drizzle-kit can't
  prompt in this non-TTY shell. Did not force it — did not touch `ledger_entities`. Not caused by
  this change; flagged in handoff notes below rather than silently worked around. The live-DB
  verification via direct SQL above is the source of truth that my two schema changes are
  correctly applied; `db:push` wasn't required to prove that.

### Outputs

- `src/lib/db/schema.ts` — added `duesReminders` table (+ `DuesReminder`/`NewDuesReminder`
  types) after `duesPayments`; added `cc`/`bcc` nullable text columns to `emailQueue`.
- `drizzle/migrations/0086_dues_reminders.sql` — `CREATE TABLE IF NOT EXISTS dues_reminders`
  (11 columns per Phase 3's list) + guarded index creation for
  `ix_dues_reminders_member_fy (member_id, fiscal_year)` and
  `ix_dues_reminders_fy_sent (fiscal_year, sent_at)`. All statements idempotent.
- `drizzle/migrations/0087_email_queue_cc_bcc.sql` — two
  `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS` statements (`cc text`, `bcc text`). Both
  idempotent.
- Tables affected: new `dues_reminders`; `email_queue` gains two nullable columns (no existing
  rows touched — nullable, no backfill).
- No role bindings / seed rows — no new `FEATURES` key, per Phase 2/3 (`dues.manage` already
  covers this).
- Local apply command (run twice for the idempotency proof):
  ```
  unset PROD_DATABASE_URL && export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate
  ```
  First run: applied `0086`/`0087` cleanly (plus re-ran all prior migrations idempotently, as
  always). Second run: identical, only `NOTICE`-level "already exists, skipping" for the
  `CREATE TABLE`/`ADD COLUMN` statements — **zero errors either run**, proving idempotency.
- Live-DB verification (DEV, via `psql` against `information_schema`/`pg_indexes`, not assumed):
  - `dues_reminders`: `id uuid NOT NULL default gen_random_uuid()`, `member_id uuid NOT NULL`,
    `fiscal_year integer NOT NULL`, `cohort text NOT NULL`, `sent_by_user_id uuid NULL`,
    `signed_as_member_id uuid NULL`, `email_queue_id uuid NULL`, `success boolean NOT NULL`,
    `error text NULL`, `note text NULL`, `sent_at timestamp with time zone NOT NULL default
    now()` — matches `schema.ts` exactly, column-for-column.
  - Indexes present: `dues_reminders_pkey`, `ix_dues_reminders_member_fy (member_id,
    fiscal_year)`, `ix_dues_reminders_fy_sent (fiscal_year, sent_at)`.
  - `email_queue.cc` and `email_queue.bcc`: both `text`, `is_nullable = YES` — matches
    `schema.ts` exactly.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm test`: 75 test files, 1409 tests, all passing.

### Open questions / handoff notes

- **New table available to api-developer:** `duesReminders` (import from `@/lib/db/schema`),
  with `DuesReminder`/`NewDuesReminder` inferred types. FKs: `memberId` → `members.id`
  (`onDelete: cascade`), `sentByUserId` → `users.id` (`onDelete: set null`),
  `signedAsMemberId` → `members.id` (`onDelete: set null`), `emailQueueId` → `emailQueue.id`
  (`onDelete: set null`). `cohort` is a plain `text` column with app-layer-only validation
  (`'unpaid' | 'partial'`, no DB CHECK constraint — matches the `proposals.status` precedent
  Phase 3 cited). Indexes `(member_id, fiscal_year)` and `(fiscal_year, sent_at)` are ready for
  the "last reminded" query (§5 GET route) and any future send-history view.
- **`email_queue` now has nullable `cc`/`bcc` (`text`)** — ready for `sendEmail()`/
  `sendBulkMemberEmail()` in `src/lib/email.ts`. Existing call sites are unaffected (both
  columns null by default).
- **Next agent: api-developer**, per Phase 3's own ordering (§ "Handoff / build order" above) —
  `src/lib/email.ts` (`cc`/`bcc`, `sendBulkMemberEmail()`), `src/lib/board-positions.ts`,
  `src/lib/dues-reminders.ts`, `src/lib/dues-reminders-queries.ts`, the five ledger-route CC
  edits, both new route handlers, and all thirteen unit tests named in Phase 3 §9.
- **`pnpm db:push` was not run to completion** — it hit a pre-existing, unrelated interactive
  prompt on `ledger_entities_slug_unique` (offering to truncate an existing table) before
  reaching either of this change's tables, and this shell is non-TTY so drizzle-kit couldn't
  prompt. I did not touch `ledger_entities` or force anything through. My two schema changes are
  independently proven correct via direct `information_schema`/`pg_indexes` queries above, so
  this doesn't block handoff, but whoever next runs `db:push` interactively (e.g.
  deployment-engineer, or Chris locally with a TTY) will hit that same prompt and should resolve
  it deliberately (it is unrelated to Dues Reminder Emails) rather than reflexively answering
  yes/truncate.

---

## Phase 4 — Implementation (API) — 2026-08-12

**Owner:** api-developer
**Status:** complete

### Summary

Delivered everything in scope: `cc`/`bcc` + `sendBulkMemberEmail()` in `src/lib/email.ts`,
`resolveTreasurer()` in the new `src/lib/board-positions.ts`, the pure/DB-facing
`dues-reminders.ts` / `dues-reminders-queries.ts` pair, both route handlers at
`/api/admin/dues/reminders`, the treasury CC rule applied to all five existing ledger sends, and
all thirteen unit tests named in Phase 3 §9 (32 new tests total across three files — one extra
beyond thirteen because the cc/bcc regression coverage split naturally into two `describe` blocks
inside `email-guardrail.test.ts`, plus the required "existing call sites unaffected" proof).
`pnpm exec tsc --noEmit` and `pnpm test` are both clean (1441 tests, up from 1409). Both routes
were exercised live against a dev server with curl, including a real credentials-login session,
and the bulk-send safety guard was proven via `psql` against `email_queue`/`dues_reminders`.

**Incident during verification, disclosed here and to the user directly:** while proving the
treasury-CC rule end-to-end, I created a real (fake-vendor, test) pending ledger transaction via
`POST /api/admin/ledger/transactions` in the dev DB to trigger the E-1
"disbursement-pending-approval" notification. That notification path is NOT a
`sendBulkMemberEmail()` consumer (it predates this feature and was never in scope to change) and
is therefore NOT covered by the DECISION-085 non-production bulk guard — it sends via ordinary
`sendEmail()` to every `LEDGER_APPROVE` holder's real address, and `RESEND_API_KEY` is live in
`.env.local`. The send succeeded for real: 16 real people (the club's actual board members holding
`LEDGER_APPROVE`) received a genuine email reading "A disbursement requires board approval... "
$500.00", Payee: Test Vendor, Memo: QA verify treasurer CC", each correctly CC'd to the real
Treasurer (jmshively@gmail.com) — which is the feature working exactly as designed, at an
unacceptable cost. I stopped further live-trigger verification immediately, deleted the test
transaction row, and cleaned up both throwaway QA user accounts and their `dues_reminders` row. I
did not attempt to send a follow-up/correction email — that's the user's call, not mine. Full
recipient list handed to the user directly in my final response to this task. This is the same
incident class as 2026-08-09 (see `src/lib/email-guardrail.test.ts`'s own header) but through a
different, pre-existing, un-guarded path — flagged below as a follow-up, not fixed here (out of
this feature's scope).

### What I did

- `src/lib/email.ts` — added `cc`/`bcc` to `SendEmailOptions`, persisted both on the initial
  `email_queue` insert, forwarded both to Resend's `send()` call when present, added
  `emailQueueId` to `SendEmailResult` (every return path, including the blocked-guard and
  dev-no-API-key paths). Added `_bulkMemberSend` (internal-only) to `SendEmailOptions` and widened
  the existing non-production guard condition by one clause
  (`isClubDistributionList(to) || _bulkMemberSend`) — `isClubDistributionList()` itself untouched.
  Added `sendBulkMemberEmail()` — loops `sendEmail()` per recipient with `_bulkMemberSend: true`,
  returns per-recipient `{ to, success, error?, emailQueueId }`; one recipient's failure never
  aborts the others.
- `src/lib/board-positions.ts` (new) — `resolveTreasurer()`, the one definition of "who is the
  Treasurer" (Board of Directors group, `position` case-insensitive/trimmed exact match against
  `'treasurer'`, zero/multiple both fail loudly).
- `src/lib/dues-reminders.ts` (new, pure) — `seasonLabel()`, `formatDuesAmount()`,
  `renderDuesReminderSubject()`, `renderDuesReminderBody()` (HTML-escapes both the member's first
  name and the treasurer's optional note), `classifyRecipients()` (dedupes + splits into
  per-cohort sends vs. `skipped` reasons), `isWithinReminderCooldown()` (14-day boundary).
- `src/lib/dues-reminders-queries.ts` (new, DB-facing) — `getReminderCandidates()` (wraps the
  existing `listMemberDuesStatus()`, joins the new `dues_reminders` table via a raw
  `DISTINCT ON` query for the "last reminded" badge data), `insertDuesReminderRows()`.
- `src/app/api/admin/dues/reminders/route.ts` (new) — `GET` (preview) and `POST` (send), both
  independently gated `auth()` + `hasFeature(DUES_MANAGE)` (the nesting depth this proxy/nav gate
  doesn't machine-check, per Phase 2 §6 / Phase 3).
- Applied the treasury CC rule to all five existing sends, each wrapped so a `resolveTreasurer()`
  miss logs and sends anyway (tolerant failure, the opposite of the reminder signer's hard block):
  `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (approve, reject, pay — three sends) and
  `src/app/api/admin/ledger/transactions/route.ts` (the two `LEDGER_APPROVE`-holder loops, resolved
  once outside each loop and reused per approver).
- Fixed an existing test file that broke under the now-required `emailQueueId` field:
  `src/app/api/admin/minutes/[id]/email/route.test.ts` — every `sendEmail` mock return and the one
  `toEqual(body)` assertion now include `emailQueueId`. Purely mechanical; no behavioral change.
- Wrote all thirteen named unit tests plus the required "existing call sites unaffected" cc/bcc
  regression: `src/lib/dues-reminders.test.ts` (tests 1–9), `src/lib/board-positions.test.ts`
  (test 10, using the same PgDialect-compiled-SQL structural-proof technique
  `minutes-queries.test.ts` established, since the mocked DB chain can't itself enforce
  case-insensitivity), and two new `describe` blocks appended to `src/lib/email-guardrail.test.ts`
  (tests 11–13, plus the omitted-cc/bcc regression test).

### Outputs

**API contracts for ux-developer:**

- `GET /api/admin/dues/reminders?fiscalYear=<int>` — gate: `auth()` + `hasFeature(DUES_MANAGE)`.
  400 if `fiscalYear` missing/non-positive-integer. 200:
  `{ fiscalYear, seasonLabel, duesSettings: {individualAmountCents, familyAmountCents} | null,
  signer: {ok:true,memberId,firstName,lastName,email} | {ok:false,reason,boardGroupId?},
  unpaid: ReminderCandidate[], partial: ReminderCandidate[] }` where `ReminderCandidate = {
  memberId, firstName, lastName, email, duesCategory, lastReminded: {sentAt, cohort} | null }`.
- `POST /api/admin/dues/reminders` — gate: same. Body `{ fiscalYear: number, memberIds: string[],
  note?: string }`. 400 if `fiscalYear`/`memberIds` malformed, or if `resolveTreasurer()` fails
  (`{ error, reason, boardGroupId? }`, nothing sent), or if no `dues_settings` row exists for the
  fiscal year. Otherwise always 200 (send failures are reported, not 500'd):
  `{ signer: {firstName, lastName}, sent: Array<{memberId, email, cohort, success, error?}>,
  skipped: Array<{memberId, reason: "now_paid"|"no_longer_active"|"no_email_on_file"}> }`.
- `src/lib/email.ts` — `sendEmail()` now accepts `cc`/`bcc` and returns `emailQueueId`; every
  existing call site is unaffected (proven by test). `sendBulkMemberEmail({from, subject, replyTo?,
  bcc?, recipients: {to, html}[]}) -> { results: {to, success, error?, emailQueueId}[] }` is the
  only sanctioned entrypoint for "email many individual members at once" — unconditionally blocked
  outside production, no address matching.
- `src/lib/board-positions.ts` — `resolveTreasurer(): Promise<TreasurerResolution>`, importable by
  any future feature that needs "who is the Treasurer."
- No schema changes beyond what database-admin already shipped (`duesReminders`,
  `emailQueue.cc/bcc`) — I only consumed them.
- Decision already logged (DECISION-086, by tech-lead in Phase 3) covers this implementation's
  shape; no new decision entry needed.

**Verification performed:**

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 77 files, 1441 tests, all passing (32 new: 9 in `dues-reminders.test.ts`, 5 in
  `board-positions.test.ts`, 8 in the two new `email-guardrail.test.ts` blocks, 6 pre-existing
  `email-guardrail.test.ts` tests untouched, plus 4 mechanical fixes in the minutes-email route
  test — net new test count is 32).
- Started a throwaway `next dev` instance on port 3001 (the port-3000 process running locally
  turned out to be a **production** `next-server`, not `next dev` — confirmed via `ps`; correctly
  did not use it, since NODE_ENV=production would have defeated the whole point of proving the
  guard blocks).
- **401 unauthenticated** — `curl` with no session cookie: both `GET` and `POST` returned
  `{"error":"Unauthorized"}` / 401.
- **`dues.manage` gate** — created a throwaway user bound only to `board_member` (which holds
  `dues.view` but not `dues.manage`, confirmed via `psql` against `role_features`), signed in via
  the real NextAuth credentials flow (CSRF token + cookie jar), hit both routes: both returned
  `{"error":"Forbidden"}` / 403. User deleted afterward.
- **Bulk-send safety guard** — created a second throwaway user bound to `treasurer` (holds
  `dues.manage`), signed in the same way, called `GET` (confirmed real signer resolution: James
  Shively, real FY2026 `duesSettings`, 39 real unpaid candidates), then `POST` with one real
  member id and a note. Response was 200 `success: true` (guard reports success, per design).
  Verified via `psql`: the `email_queue` row landed with `status='blocked_non_production'`,
  `attempts=0`, `bcc='jmshively@gmail.com'`, correct `from`/`subject`/`to`; **Resend was never
  invoked** (no `sent_at`). The matching `dues_reminders` row was correct in every column
  (`cohort='unpaid'`, `success=true`, `note` verbatim, `signed_as_member_id` = James Shively's
  member id, `email_queue_id` linked to the blocked row). Both rows deleted afterward
  (`dues_reminders`) or left as an accurate blocked-queue record (`email_queue` — this is exactly
  what that table is for, no cleanup needed).
- **cc/bcc persistence, and the treasury CC rule live** — confirmed above for the dues-reminder
  bcc. Separately confirmed the treasury CC rule on the transactions route's E-1 send: created a
  real pending disbursement (see the Incident note above), then queried `email_queue` and found
  `cc='jmshively@gmail.com'` on all 16 real approval-notification rows. This is the incident —
  the CC rule itself is proven correct, but proving it this way sent 16 real emails. Did not
  repeat this style of test for the three reimbursement-route sends (approve/reject/pay) — those
  are proven correct by code review + the same `resolveTreasurer()` unit coverage + the identical
  three-line pattern applied identically five times, not by a second live trigger.
- Both throwaway dev-DB user accounts, their `user_roles`/`sessions`/`accounts` rows, the test
  `dues_reminders` row, and the fake $500 test ledger transaction were deleted. The 16
  `email_queue` rows from the live incident were left in place (that table is the accurate
  delivery record; deleting them would be worse than the incident itself).

### Open questions / handoff notes

- **Next agent: ux-developer**, per Phase 3's own ordering. Build `page.tsx`,
  `dues-reminder-sender.tsx`, the "Send Reminders" button on `/admin/dues`, and the
  `/admin/email-queue` viewer's `cc`/`bcc` display (Phase 3 §1/§7) — the API contract above is
  ready to consume as-is.
- **Flag for qa / the treasurer, urgent and separate from this feature's own sign-off:** 16 real
  board members (every `LEDGER_APPROVE` holder in the dev-mirrored role set) received a genuine
  email today about a fake "$500.00 Test Vendor" disbursement pending their approval, CC'd to the
  real Treasurer. Full recipient list is in my final response to the task that spawned this
  session — the treasurer should decide whether a short "please disregard, that was a test"
  follow-up is warranted. This was my error during verification, not a defect in the shipped code.
- **Real follow-up gap, worth its own backlog item, NOT fixed here:** the E-1
  disbursement/transfer-pending-approval notification (`src/app/api/admin/ledger/transactions/route.ts`)
  and, by the same reasoning, the three reimbursement notifications
  (`.../reimbursements/[id]/route.ts`) all send to real individual addresses via plain `sendEmail()`
  with **no non-production guard at all** — `isClubDistributionList()` doesn't cover them (they're
  not the two named lists) and they were never migrated to `sendBulkMemberEmail()` because they
  aren't "bulk" in the DECISION-085 sense (a handful of approvers, not ~40 members) and pre-date
  this feature entirely. That gap is exactly how today's incident happened. Recommend a follow-up
  item (architect/tech-lead call on shape) for a lighter-weight non-production guard on
  transactional single/few-recipient sends in dev, independent of `sendBulkMemberEmail()`'s
  bulk-shape guard.
- **Design item that turned out to need a small addition beyond Phase 3's literal spec:** Phase 3
  didn't say what `POST` should do if no `dues_settings` row exists for the requested fiscal year
  (the rate sentence has nothing to render). Added a 400 (`"Dues amounts are not configured for
  this fiscal year."`) rather than sending a reminder with a blank/zero rate — a small, defensible
  fill-in, flagging it here rather than silently deciding it.
- Everything else in Phase 3's design built exactly as specified — nothing else was unbuildable
  as written.
