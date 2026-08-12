# Emailing the Donor Acknowledgment Letter — Work Log

> **Slug:** `2026-08-12-acknowledgment-letter-email`
> **Surface:** (dashboard) admin — The Ledger / Donors & Acknowledgments
> **Permission(s):** likely existing `ledger.record`; confirm in Phase 1
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-12 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-12 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-12 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Origin

Backlog **B-45**, raised by the treasurer 2026-08-12 on discovering the send path had never
been built: *"i must have lost track that the donor email has not been built yet. lets queue
that up for building as well."*

## What already exists (v1.61.0) — this feature is the missing last step

- `ledger_acknowledgments` rows, with an immutable copy of the gift's amount and date taken at
  acknowledgment time (DECISION-026), `sentAt`, an optional uploaded letter file, and free
  text.
- IRS Pub. 1771-compliant composition for both `written_ack_250` and `quid_pro_quo_75`,
  including the DESCRIPTION of goods received, not just their value (DECISION-073).
- An editable club letter template whose writable surface is only four "warmth" slots
  (greeting, body, closing, signature) — the required legal paragraph is generated and cannot
  be edited away.
- Batch generation, one letter per page, for printing.
- Donor email addresses, **several per donor**, captured deliberately in v1.61.0 whose release
  note says they "will be used when emailing arrives." This is that arrival.

**What is missing:** there is no `sendEmail` call anywhere under the donors surface. Every
acknowledgment is printed and handed or posted.

## Depends on, and must inherit from, the dues-reminder work

`docs/work-log/2026-08-12-dues-reminder-emails.md` adds:
- `cc` / `bcc` on `sendEmail()` and on `email_queue`,
- `sendBulkMemberEmail()` and the **deny-by-default** non-production guard (DECISION-085),
- `resolveTreasurer()` in `src/lib/board-positions.ts` — the ONE definition of who the
  treasurer is (DECISION-086),
- the treasurer's standing rule that **any email sent as part of running the club's money CCs
  the treasurer**.

This feature inherits all of it. Do not re-implement any of it.

## Questions Phase 1 must answer

- **A donor with several addresses** — send to all, or a nominated primary? The club's very
  first donor asked for two, which is why multiple addresses exist at all.
- **A donor with no email address** still needs a printed letter. Both paths must coexist, and
  the treasurer must see at a glance which donors fall on which side.
- **`sentAt` currently means only "this went."** If some letters are emailed and some printed,
  the record should say which, or the audit trail quietly loses that distinction.
- **A bounce is not cosmetic.** An acknowledgment is a tax document; a bounced one means a
  donor has no valid receipt. Bounces must surface, not be swallowed.
- **"A letter, once sent, is fixed"** is already the rule. Emailing must not become a second
  way to regenerate a letter already marked sent.
- **Attachment or inline HTML?** Minutes email inline by deliberate choice. A receipt a donor
  may need to keep for their records is a different case and deserves a decision rather than a
  default.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Add a "Send by Email" action to the acknowledgment-letter selector the treasurer already uses to
> print, reusing every piece of already-shipped infrastructure (`sendBulkMemberEmail()`,
> `resolveTreasurer()`, the deny-by-default non-production guard, the `sentAt`-gated
> already-sent lock) — the real work is two small, precise gaps in what's already built: the
> letters query doesn't expose donor email addresses yet, and `sentAt` alone can't say whether a
> letter went out by mail or by email, which the treasurer needs to answer "who still needs a
> printed copy" at a glance.

## Context confirmed in code (read-only checks, not implementation)

- **`sendBulkMemberEmail()`, `resolveTreasurer()`, and `cc`/`bcc` on `sendEmail()`/`email_queue`
  are live**, not just designed. `src/lib/email.ts` and `src/lib/board-positions.ts` are real,
  merged code (confirmed by direct read), and the dues-reminder work-log's own Phase 4 (API)
  entry shows both were exercised against a real dev DB. This feature can consume them as-is.
- **The non-production guard is stronger than either dependency work-log describes.** Both
  `docs/work-log/2026-08-12-dues-reminder-emails.md` and `docs/backlog.md` B-45 describe the
  guard as address-based (`isClubDistributionList()`) widened by an unconditional
  `_bulkMemberSend` clause for bulk sends. Reading `src/lib/email.ts` directly shows it has since
  been rewritten to **deny-by-default for every non-production send**, not just bulk ones — the
  2026-08-12 incident note in the file's own comment (16 real board members mailed by an
  un-guarded transactional route during QA) is why. Every path this feature could take —
  single-donor multi-address, or a full batch — is now safe in dev by construction, with no
  address list to keep current. This *strengthens* the "nothing may reach a real donor from dev"
  constraint beyond what was asked; nothing here weakens it.
- **`ledgerDonors.emails` is a flat `text[]`, no primary/label concept** (`schema.ts`, confirmed):
  *"Zero or more email addresses, all equal (no labels/primary — treasurer explicitly wants a flat
  list, not a contact-management model)."* This settles (a) below by removing the option of a
  "nominated primary" — the data model was deliberately built to say there isn't one.
- **`GeneratableAcknowledgmentRow` (the type the letters-selector screen is built on,
  `src/lib/ledger-acknowledgment-letter-queries.ts:40-62`) does not carry donor emails.** Its
  `donor` field is `{ id: string; name: string; address: string | null } | null` — `address` for
  print, nothing for email. This is a real, concrete gap: the screen this feature extends
  literally cannot decide "does this donor have an email" until this type and the query at
  line ~122 (`donor: r.donor ? { id: r.donor.id, name: r.donor.name, address: r.donor.address } :
  null`) both add `emails: string[]`. Small, but load-bearing — Phase 3 must name it explicitly,
  not discover it mid-implementation.
- **`sentAt` is set exactly one way today**: `MarkSentDialog` → `PATCH
  .../transactions/[id]/acknowledge`, a manual, treasurer-attested "this went" with an optional
  uploaded/pasted letter copy. `generateAcknowledgmentLetters()` refuses to regenerate
  `letterText` once `sentAt !== null` (DECISION-073 item 2) — this is the existing "a letter, once
  sent, is fixed" rule, and it is enforced entirely through `sentAt`, not through any other flag.
  Whatever this feature does, it must key off exactly this same field for the same guarantee.
- **No Resend webhook receiver exists anywhere in this codebase** (confirmed by grep — no
  "webhook" or "bounce" handling tied to Resend). `email_queue.status` reflects only the outcome
  of the synchronous `resend.emails.send()` call (`sent`/`failed`/`blocked_non_production`) —
  it cannot and does not know whether a message Resend *accepted* was later bounced. This bounds
  what (d) below can honestly promise.
- **The composed letter already contains its own greeting/body/required-block/closing/signature**
  (`ledgerLetterTemplates` + `composeAcknowledgmentLetter()`), fully treasurer-editable except the
  IRS-required block. `signatureName`/`signatureTitle` seed **empty by default** and are plain
  text, not derived from `resolveTreasurer()`. This creates a real tension with this task's
  instruction that the send be "signed by the treasurer per `resolveTreasurer()`" — see (f)/Gaps
  below; the letter's own signature line and a `resolveTreasurer()`-derived signature are two
  different things that can disagree, and the design must not silently show both.
- **The existing selector UI (`AcknowledgmentLetterSelector`,
  `src/components/admin/ledger/acknowledgment-letter-selector.tsx`) is the natural host for this
  feature**, not a new screen: it already tracks "letters generated this session"
  (`generatedByAckId`), already renders the `>10`-selection `<ConfirmDialog>` pattern, and already
  puts "Print / Save as PDF" as a sibling action once letters exist. "Send by Email" is a second
  sibling action in the same spot, operating on the same generated set.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer / `LEDGER_RECORD`) | On the existing letters-selector screen, click "Send by Email" for one or more generated (unsent) letters whose donor has an email on file | Per batch, same cadence as print |
| Admin (treasurer / `LEDGER_RECORD`) | Confirm the send via `<ConfirmDialog>`, seeing the donor count and total address count about to be mailed | Every send |
| Admin (treasurer / `LEDGER_RECORD`) | See, at a glance on the same table, which donors have an email on file vs. which still need a printed copy | Every visit to the screen |
| Admin (treasurer / `LEDGER_RECORD`) | Review per-address success/failure after sending | Every send |
| Donor (external, no portal access) | Receives the email, reads the letter, may reply (lands with the resolved Treasurer, not a dead address) | Reactive, per send |

Every verb sits on the existing admin surface (`/admin/ledger/donors/letters`), gated the same way
generate/print already are — no new surface, no new role.

## Flows

**Flow 1 — Batch or single email send**
Entry: `/admin/ledger/donors/letters`, after the treasurer has generated letters for one or more
selected acknowledgments (existing, unchanged flow) → step: for each letter generated *this
session* whose donor has ≥1 email address, a "Send by Email" button appears next to the existing
"Print / Save as PDF" button, scoped to exactly the letters with an email available (donors with
no email are never offered a checkbox for this action — mirrors how "Missing address" rows are
already excluded from print's implicit expectations, just for email) → step: treasurer clicks →
`<ConfirmDialog>` states the count in donor terms and address terms, e.g. *"Email 5 acknowledgment
letters to 6 addresses? (1 donor has 2 addresses on file.)"* → step: on confirm, `POST
/api/admin/ledger/acknowledgments/letters/email` with `{ ackIds: string[] }` → server re-validates
every id fresh, server-side, exactly as `generateAcknowledgmentLetters()` already does for its own
guards (never found / already sent / no letter text / donor has no email) → for surviving acks,
every donor email address is added to one `sendBulkMemberEmail()` call for the whole batch → on a
successful send for an ack, `sentAt` is set (see Gaps §c/e) inside the same kind of guarded,
single-writer update the "already sent" check already implies → outcome: a results list, per
address, success/failure — mirrors the existing generate-results panel's shape exactly (`{N}
generated/emailed, {M} skipped`, expandable per-row detail).
- Failure: an ack with `letterText === null` (never generated this session or in the DB) → skip,
  `"letter not yet generated"` — you cannot email nothing.
- Failure: an ack already `sentAt !== null` → skip, `"already sent"` — same lock generation
  already respects (see Gaps §e — this is the load-bearing rule, not new).
- Failure: donor has no email addresses → not offered in the UI; defense-in-depth 400/skip if
  reached directly via the API.
- Failure: one address in a multi-address donor's list bounces at send time (Resend rejects it
  synchronously) → that address is reported failed, the *other* address for the same donor (if
  any) still sends, and — open question below — whether a partial per-donor failure still sets
  `sentAt` for that ack needs an explicit call, not a default.

**Flow 2 — Print stays available regardless of email status**
Entry: same screen, unchanged. Every generated letter can still be printed whether or not it was
also emailed — a treasurer may want a physical copy in addition, or the email path may have failed
and printing is the fallback. Nothing about adding email removes or narrows the existing print
flow.

**Flow 3 — At-a-glance "who needs a printed copy"**
Entry: the selector table, unchanged rows.
Step: each row gains an email-status indicator alongside the existing donor/address column — "2
addresses", "1 address", or "No email on file" (styled like the existing amber "Missing address"
treatment for print). This answers (b) directly: nothing new to build beyond a column, since the
underlying `donor.emails` just needs to reach the row (see Gaps).
- Failure: N/A, passive display.

**Flow 4 — Donor receives the email**
Entry: inbox. From: an address representing the Foundation/treasury (open question — see below);
Reply-To and BCC: the resolved Treasurer's own address, per the treasury-CC rule this task says
applies directly.
Step: reads a short covering line, then the full composed letter inline (see (f) — no attachment).
Step: may reply — lands with a real person, not a forwarding alias with no retained copy (same
reasoning the dues-reminder work already established for `treasurer@westervillelions.org`).
Step: may print or save the email itself for tax records.
- Failure: if the message is accepted by Resend but bounces afterward, the donor sees nothing and
  — per the "No Resend webhook" finding above — **the club currently has no way to know**. This is
  named explicitly in Gaps (d) rather than glossed over, because it's the one failure mode this
  system genuinely cannot detect today, not one it detects imperfectly.

## Permissions

- **Send Email:** existing `FEATURES.LEDGER_RECORD` — identical gate to Generate/Print/Mark Sent
  on this same screen today. No new `FEATURES` key.
- **Default roles:** whoever already holds `LEDGER_RECORD` (Treasurer, Admin per existing
  bindings) — unchanged.
- No template-editing permission question here — this feature doesn't touch
  `ledgerLetterTemplates` or its `LEDGER_MANAGE` gate at all.

## Judged Questions — recommendations

**(a) Multiple donor addresses — send to all, not a nominated primary.** The schema was
deliberately built with no primary/label concept (`ledgerDonors.emails`'s own comment: "the
treasurer explicitly wants a flat list, not a contact-management model"), and the origin story —
"the club's very first donor asked for two" — reads as *both* addresses wanting the letter, not
one address needing to be chosen over the other. Recommend: every address in `donor.emails[]`
receives the letter for that ack, all in the same `sendBulkMemberEmail()` batch call. Cost of
picking a "primary" instead: it would require inventing a concept (which one is primary, who
decides, does it change over time) the schema and the treasurer's own stated intent both already
rejected — more work, for a worse fit than "send to all."

**(b) Donors with no email — a visible column, not a hidden exclusion.** Answered structurally in
Flow 3: the selector table gains an email-status cell per row, using the exact same visual
treatment (`amber, inline microcopy`) already established for "Missing address." Getting this
wrong (the risk the task names explicitly) means a donor silently gets neither a print nor an
email — the fix is making "no email" as visible as "missing address" already is, on the same
screen, not a separate report.

**(c) `sentAt` needs a companion "how," and today's schema doesn't have one — recommend adding
one.** `sentAt` currently means only "this went" (verified in code, not assumed). Once this feature
ships, "went" can mean two different things (mailed a physical letter, or emailed one), and the
treasurer's own ask in (b) — "who still needs a printed copy at a glance" — cannot be answered
correctly without knowing which. **Recommendation:** add a nullable `sentVia` column (`'email' |
'print'`) to `ledgerAcknowledgments`, set to `'print'` when `MarkSentDialog` completes (today's
only path, unchanged behavior otherwise) and `'email'` when this feature's send succeeds. Legacy
rows read `NULL` — acceptable, since this is forward-looking disambiguation, not a backfill claim.
**Cost of leaving it ambiguous:** the treasurer cannot answer "did we mail this or email it" for an
audit or a donor dispute ("I never got a letter") without opening the row and guessing from
context, and the at-a-glance view this task explicitly asks for in (b) degrades into "sent or not,"
losing the one distinction that actually matters once two channels exist.

**(d) Bounces — this system can detect send-time failure, and only that; say so honestly in the
UI.** No Resend webhook exists in this codebase (verified, not assumed) — there is no mechanism to
learn that a message Resend *accepted* later bounced. What this feature *can* do: surface
`sendBulkMemberEmail()`'s per-address synchronous failures (bad address format, Resend rejects at
send time) immediately in the results panel, exactly like Flow 1's failure path, and route them to
the existing `/admin/email-queue` retry surface a treasurer already knows. What it must **not** do:
claim delivery. UI copy should say "Emailed [date]," never "Delivered [date]" — the system does not
know that. **This is a genuine open question for the treasurer, not something I'm resolving
silently**: is manual monitoring (spot-checking Resend's own dashboard, or a donor eventually
saying "I never got this") acceptable for v1, or does the treasurer want a real webhook-based
bounce feed as a fast-follow? Given this is the one document in the entire app whose absence has a
tax consequence for someone outside the club, I'd rather this be a stated, accepted risk than an
implied guarantee nobody actually checked.

**(e) "Once sent, fixed" — reuse the exact existing lock, don't build a second one.** The rule
already lives entirely in `sentAt !== null` blocking `generateAcknowledgmentLetters()`. This
feature's send action must (1) refuse to send an ack whose `sentAt` is already set — same skip
reason class, `"already sent"` — and (2) itself set `sentAt` (plus `sentVia: 'email'`, per (c)) the
moment a send succeeds, which automatically closes the loop: an emailed letter can no longer be
regenerated OR re-emailed through the normal flow, for the same reason a printed-and-marked-sent
one can't today. One real design question this raises that Phase 1 shouldn't silently answer:
**should a treasurer ever be able to re-send the identical, already-frozen letter** (donor says "I
never got it")? I'd recommend yes, as an explicit, separately-labeled "Resend" action on an
already-sent row — reusing the frozen `letterText` verbatim (no regeneration), logged as a second
send event — rather than either (a) making already-sent rows completely untouchable forever, or
(b) quietly allowing the normal Send button to fire twice. Flagging as an open question rather than
deciding it outright, since "resend" wasn't in the original ask.

**(f) Inline, not attachment — and the covering email should not duplicate the letter's own
wording.** `sendEmail()` has no attachment parameter (verified), and this project has twice already
declined a PDF-generation dependency for this exact document type (`print-statement-button.tsx`'s
"this IS the Save-as-PDF flow" comment; DECISION-072's explicit "no PDF library" ruling). Building
attachment support would mean either a new dependency (against the stated constraints) or
attaching plain text/HTML, which is a worse artifact than a well-formatted inline email. Recommend:
the composed `letterText` — the exact same content the print path already renders, unchanged, not
re-derived — becomes the email body, rendered to HTML the same way the print component does. **The
"covering email" should add as little new prose as possible**, for a reason this task's own
phrasing surfaces: the letter already has its own `greeting`/`bodyText`/`closing`/signature
(treasurer-editable), and a second, separately-authored opening/signature risks either duplicating
that voice or, worse, showing **two different signatures in one message** if the covering note is
"signed by `resolveTreasurer()`" while the letter body's own `signatureName` (which seeds empty and
is free text, not derived from `resolveTreasurer()`) says something else or nothing. **Recommend:**
apply `resolveTreasurer()` only to the email's *envelope* — Reply-To and BCC — never as a second
textual signature in the body. The only new prose is a one-line lead-in before the letter
("Please find your official gift acknowledgment below — you may want to save or print this email
for your tax records."), and the letter itself, exactly as composed, is the rest of the message.
This is the version that satisfies "must not duplicate or re-write the letter's club-editable
wording" literally, not just in spirit.

**(g) Batch, not one-at-a-time only — and reuse `sendBulkMemberEmail()` exactly as instructed.**
The existing selector already supports multi-select generate/print; email should be a third action
on the same selection, not a separate flow. Because sending several donors' letters in one action
is exactly the "email many individual recipients at once" shape `sendBulkMemberEmail()` exists for
— and because a single donor's own multiple addresses are, mechanically, the same shape (several
distinct `to` addresses in one logical action) — recommend routing **both** the multi-donor batch
case and the single-donor multi-address case through one `sendBulkMemberEmail()` call per "Send by
Email" click, never a hand-rolled loop over `sendEmail()`. One naming friction worth flagging for
architect/tech-lead, not something I'm resolving: `sendBulkMemberEmail()`'s name and doc comment
say "members" — a donor is frequently not a club member at all (could be a business, a
non-member individual). The function's actual behavior (per-recipient `sendEmail()` with an
unconditional non-prod block) fits this use perfectly; only the name assumes a narrower audience
than it actually serves. Not a blocker — flagging so Phase 2 can decide whether that's worth a
one-line doc-comment broadening or a rename, not something this feature should route around by
reimplementing the same guard under a different name.

**(h) What the request didn't mention, surfaced now:**

- **`GeneratableAcknowledgmentRow` doesn't carry donor emails yet** (see Context above) — this is
  the single concrete blocking gap for Phase 3/4, not a judgment call. The type and its one query
  site both need `emails: string[]` added before the selector screen can decide anything about
  email eligibility.
- **From-address entity mismatch.** The dues-reminder precedent sends from
  `treasurer@westervillelions.org` — but that's Club (501(c)(4)) treasury mail, and every
  acknowledgment letter this feature would send is a **Foundation** (501(c)(3)) document (per
  DECISION-072/073's Foundation-only scope). Sending a Foundation legal receipt from a Club-branded
  address is a minor but real entity-mixing concern for an org that is careful elsewhere about
  keeping the two apart (Club vs. Foundation deductibility language, EIN, tax classification, all
  already entity-scoped in the composer). **Open question, not resolved here**: does a
  Foundation-specific From address exist or need to be verified in Resend, or is
  `treasurer@westervillelions.org` acceptable because both entities share one treasurer and one
  practical mailbox? Flagging rather than guessing.
- **Concurrency / double-send race.** Two admins (or one admin in two tabs) could both click "Send
  by Email" on the same ack before either request observes the other's `sentAt` write, sending the
  same letter twice and/or racing to set conflicting `sentAt`/`sentVia` values. The pre-check must
  happen inside the same guarded write (a conditional `UPDATE ... WHERE sent_at IS NULL` or
  equivalent), not a separate SELECT-then-UPDATE with a gap. `generateAcknowledgmentLetters()`
  doesn't have this exact race today because regeneration before `sentAt` is deliberately
  idempotent-safe (overwrite is fine); an email send is not idempotent-safe (a donor doesn't want
  two copies), so this feature needs a guard the code it's extending didn't previously need.
- **OAuth-vs-password, `/access-pending`, Google Group sync — not applicable.** This is an
  admin-only, `LEDGER_RECORD`-gated action with no member-facing surface and no group-membership
  interaction. Named explicitly per the standard checklist rather than silently skipped.
- **Empty/disabled state for "nothing to email."** If every letter in the current generated set
  belongs to a donor with no email on file, "Send by Email" should be visibly disabled with
  explanatory text ("0 of N selected have an email on file — use Print / Save as PDF instead"), not
  simply absent — an absent button reads as "not built," a disabled one with a reason reads as
  "correctly not applicable here."
- **Mobile at 360px.** The selector table already has an unresolved flag from the original
  generation feature ("Print CSS at narrow viewports... needs its own responsive pass," carried
  forward, never confirmed fixed). Adding a fourth data point (email status) and a second action
  button to an already-dense row makes this worse, not neutral — this feature should not ship
  without actually checking the table at 360px, not just inheriting the old TODO.
- **Brand consistency.** New button: `rounded-lg`, matching the existing "Print / Save as PDF"
  secondary-button style exactly (`border-2 border-lions-blue text-lions-blue`). Confirm dialog:
  `<ConfirmDialog>`, not `window.confirm` — this task's own constraints already say so, restating
  because the existing selector already has the exact pattern to copy
  (`LARGE_BATCH_THRESHOLD`/`ConfirmDialog` for generate).

## Out of Scope (confirm with user)

- **PDF attachment delivery** — explicitly out per (f) above and per two prior, already-settled
  project decisions against a PDF-generation dependency.
- **Resend webhook / bounce-detection infrastructure** — real gap named in (d), but building a
  webhook receiver is a materially larger, separate piece of work (new route, signature
  verification, a place to surface bounce events) that this task's scope ("only the send path is
  missing") doesn't ask for. Flagging as a natural fast-follow, not silently assuming it's wanted.
- **Retroactively emailing the pre-existing backlog of already-`sentAt`-set (printed) letters** —
  the "once sent, fixed" rule (e) means this feature cannot and should not offer to email something
  already marked sent by print; a treasurer who wants to *also* email an already-printed
  acknowledgment would need the explicit "Resend" affordance flagged as an open question in (e),
  not the default Send button.
- **A donor self-service "resend my receipt" request flow** — nothing in the ask suggests a
  donor-facing surface; this stays 100% treasurer-initiated, admin-side.

## Open Questions

1. **`sentVia` column — confirm the recommendation in (c).** Add `ledgerAcknowledgments.sentVia:
   'email' | 'print' | NULL`, set automatically by both send paths. This is the cleanest fix I can
   see for "who still needs a printed copy," but it's a real schema decision, naming it for
   explicit sign-off rather than assuming.
2. **Bounce-detection risk tolerance (d).** Is manual monitoring acceptable for v1, given this
   system architecturally cannot detect a post-acceptance bounce without a webhook this task
   doesn't ask for? If the treasurer wants stronger delivery assurance before shipping, that's a
   materially different, larger feature — better to know now than mid-Phase-3.
3. **Resend semantics (e).** Should an already-sent (emailed or printed) letter get an explicit
   "Resend the exact frozen letter" action, distinct from the normal Send button which the
   "already sent" guard blocks? If yes, it's a small addition; if it's out of scope, the guard
   alone is sufficient and nothing else needs building.
4. **Partial multi-address failure (Flow 1).** If a donor has two addresses and one bounces at
   send time while the other succeeds, does `sentAt`/`sentVia` still get set for that ack (the
   letter *did* reach the donor via the surviving address), or does a partial failure block it
   entirely until the treasurer resolves the bad address? I don't think this is safely default-able
   either way — recommend treating it as "sent" if at least one address succeeded (the donor did
   receive it), but flagging the specific address failure separately so the treasurer can fix the
   stale address, rather than blocking the whole ack on one bad entry.
5. **From-address entity mismatch (h).** Does emailing a Foundation legal document from
   `treasurer@westervillelions.org` (a Club-branded alias, per the dues-reminder precedent) need a
   Foundation-specific From/Reply-To, or is one practical mailbox for one shared treasurer
   acceptable? Can't verify Resend's domain-verification scope from the code.
6. **`resolveTreasurer()` failure mode for this feature specifically.** The codebase currently has
   two different postures: hard-block (the dues-reminder *signature*, because "who signed this" is
   the whole point) vs. tolerant/log-and-send-anyway (the five existing treasury-email CCs, because
   an unrelated `/admin/groups` data problem shouldn't silently drop a time-sensitive notice). I'd
   recommend **tolerant** here too — the reasoning that motivated tolerance for reimbursement/
   disbursement notices applies at least as strongly to a legally-required donor receipt (falling
   back the BCC/Reply-To to the `treasurer@westervillelions.org` alias itself and logging a
   warning, rather than blocking a donor's tax document over a Board group data-entry gap) — but
   this is a real policy call, not mine to make silently.

---

---

## Treasurer's answers (2026-08-12)

- **From address: `treasurer@westervillelions.org`**, the same as the dues reminder, despite
  the acknowledgment being a Foundation document and that being a Club address. The letter
  body already names the Foundation and its EIN, so the legal content is unambiguous
  regardless of sender, and one recognisable address beats two.
- **Bounces: ship on the existing queue-and-retry**, with the limitation stated. The treasurer
  observed, correctly, that queued retry already exists. It does — for Resend *refusing* a
  message. It does not cover a bounce, which happens after Resend has accepted and returned
  success, and which this codebase cannot see because there is no webhook receiver. Queued as
  **B-47**, and the design must state the limitation on the send screen rather than implying
  delivery is confirmed.

## Ruling on the confirm dialog (dues reminder, applies here too)

The dues-reminder send confirm was briefly shipped with `destructive` styling because the
coordinator's brief said so, overriding Phase 3's explicit decision. Reverted. Phase 3 was
right: sending is irreversible, but a red danger button on a warm, friendly note reads as a
warning about the act itself. The safety is the recipient count in the title and the named
list behind it, not the colour of the button. Apply the same reasoning here.

---

# Phase 2 — Architectural Review (architect)

## VERDICT

**Approved with suggestions**

## Summary

Extend, don't fork: this feature adds one new sibling route, one new write function on the
existing `ledger-acknowledgment-letter-queries.ts` module, one new pure function on the existing
`ledger-acknowledgment-letter.ts` module, and a third action on the existing
`AcknowledgmentLetterSelector` component — no new module pair, no new page, no new `FEATURES` key.
Two concrete gaps from Phase 1 are confirmed by direct code read and are as small as advertised.
One real structural risk not previously named — the send path cannot reuse
`generateAcknowledgmentLetters()`'s read-then-batch-write shape, because sending mail isn't
idempotent-safe the way overwriting `letterText` is — is called out as a hard requirement for
Phase 3, not a suggestion. Full rulings and rationale are logged as **DECISION-087**.

## 1. Placement

**Extends the existing pair — does not get its own.**

- Write side: new `emailAcknowledgmentLetters()` in `src/lib/ledger-acknowledgment-letter-queries.ts`
  (367 lines today — no size pressure to split), alongside `generateAcknowledgmentLetters()`. Same
  file's own header comment already frames this module as "two responsibilities, kept separate" from
  `ledger-queries.ts`/`ledger-category-queries.ts` — send is a third responsibility in the *same*
  domain, not a reason to fork a fourth file.
- Pure side: new `composeAcknowledgmentEmailHtml()` in `src/lib/ledger-acknowledgment-letter.ts`
  (251 lines), which takes the already-composed plain-text `letterText` (unchanged, not
  re-derived — per Phase 1 (f)) and wraps it with the one-line lead-in and HTML-escapes/formats it
  for an email body. Stays pure/DB-free, consistent with `composeAcknowledgmentLetter()` next to it.
- Route: `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts`, a direct sibling of
  `.../letters/generate/route.ts`. Copy that route's shape exactly: manual array validation (no
  zod, per constraint), `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`, same
  error-string conventions.
- UI: a "Send by Email" action + an email-status column on the existing
  `AcknowledgmentLetterSelector` (`src/components/admin/ledger/acknowledgment-letter-selector.tsx`,
  382 lines) on the existing page `src/app/(dashboard)/admin/ledger/donors/letters/page.tsx`
  (confirmed: already calls `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` directly). No new
  route segment, no new `ADMIN_NAVIGATION` entry, no new page-gate test surface to satisfy.

This is the same discipline DECISION-072/073 already established for this feature (sibling module,
not a new one, until a genuinely different domain shows up) — email is not a different domain from
generate/print, it's the third verb on the same letter.

## 2. `sendBulkMemberEmail()` naming

**Keep the name. Broaden the doc comment by one line. Do not rename, do not add a sibling.**

Read `src/lib/email.ts` directly (not just the work-log descriptions): the deny-by-default
non-production guard (the block added after the 2026-08-12 16-board-member incident) is
unconditional for *every* `sendEmail()` call regardless of the `_bulkMemberSend` flag —
`process.env.NODE_ENV !== "production" && !isDevAllowedRecipient(to)` blocks first, before any
bulk-vs-single distinction is even consulted. So the safety property this rule cares about — "a dev
run must never reach a real donor" — already holds independent of what the function is named or
whether donors are members. That leaves the naming question as pure documentation accuracy, not a
behavioral one. Renaming would touch two call sites already referenced by name in two resolved
decisions (DECISION-085/086) for a cosmetic reason; a sibling function would duplicate the
identical per-recipient-`sendEmail()`-loop logic under a second name, which is exactly the kind of
duplication this codebase's module-boundary discipline (DECISION-085's own rationale) exists to
prevent. Ruling: keep `sendBulkMemberEmail()`, widen its doc comment to state recipients need not
be club members. Logged as DECISION-087 item 2.

## 3. `sentVia` on `ledger_acknowledgments`

**Approved as recommended in Phase 1, unchanged.** Add `sentVia: text` (nullable, application-level
enum `'email' | 'print'`), migration `0088_ledger_ack_sent_via.sql` (`ADD COLUMN IF NOT EXISTS`,
idempotent). The existing PATCH mark-sent route (`.../transactions/[id]/acknowledge`) sets
`'print'` on success; the new send route sets `'email'` on success. **No backfill** — existing rows
stay `NULL`. This matches the project's own precedent for a column added after the fact to
disambiguate going forward (DECISION-026's `amountCents` immutability is a different shape, but the
same "don't retroactively assert something about historical rows you can't actually verify" posture
applies): nobody can truthfully say today whether a pre-this-feature `sentAt` row was mailed or
printed, and guessing would create a false record on a document with tax consequences — worse than
leaving it honestly unknown.

## 4. `emails: string[]` on `GeneratableAcknowledgmentRow`

**Confirmed as the single blocking gap, and confirmed trivial — not a query change, a projection
change.** Read `listGeneratableAcknowledgments()` directly
(`src/lib/ledger-acknowledgment-letter-queries.ts:82-141`): the query already does
`.select({ ack: ledgerAcknowledgments, donor: ledgerDonors, ... })` — the *entire* `ledgerDonors`
row, including `emails`, is already fetched into `r.donor` on every call. The gap is only that the
`.map()` at line ~121 narrows it: `donor: r.donor ? { id: r.donor.id, name: r.donor.name, address:
r.donor.address } : null`. Fix is two lines: add `emails: string[]` to the `GeneratableAcknowledgmentRow.donor`
type (line ~59) and `emails: r.donor.emails` to the map. Zero new joins, zero new DB round-trips.

## 5. Immutability

**"Once sent, fixed" is inherited correctly in shape, but Phase 3 must not copy the read-then-write
mechanism the code it's extending uses.** Read both existing "already sent" enforcement points
directly:

- `generateAcknowledgmentLetters()` — pre-checks `row.sentAt !== null` from a `SELECT` done via
  `listGeneratableAcknowledgments()` *before* `db.transaction()` opens, then batch-updates
  `letterText` inside one transaction with a plain `.update(...).where(eq(id, ackId))` — no
  `sentAt IS NULL` re-check in the write itself.
- The PATCH mark-sent route (`.../transactions/[id]/acknowledge`) — same shape: `findFirst()`,
  check `existingAck.sentAt !== null` in application code, then `.update(...)`. Also not a
  conditional write.

Both are fine for what they do: regenerating `letterText` before a letter is sent is deliberately
idempotent-safe (DECISION-073 item 2 — "clicking Generate IS the review step"), and mark-sent's own
race window is a pre-existing, narrow gap this feature doesn't need to fix. **Sending an email is
not idempotent-safe** — a donor must not get the same acknowledgment twice because two requests, or
one double-click, both observed `sentAt IS NULL` before either wrote it. Ruling: the new
`emailAcknowledgmentLetters()` must set `sentAt`/`sentVia` via a single conditional
`UPDATE ledger_acknowledgments SET sent_at = now(), sent_via = 'email' WHERE id = $ackId AND
sent_at IS NULL RETURNING id`, per ack, checking the returned row count before treating that ack's
send as authoritative — not a `SELECT` gate followed by an unconditional `UPDATE`. This closes
exactly the double-send race Phase 1 flagged in (h) and gives emailing no path to become a second
way to regenerate or re-fire a sent letter. Named explicitly as a Phase 3 requirement, not a
suggestion — logged in DECISION-087 item 4.

## 6. Invariants

- **Schema is source of truth:** `sentVia` goes into `schema.ts` first, migration second, matching
  the standard order.
- **Idempotent migration:** `0088_ledger_ack_sent_via.sql` — `ALTER TABLE ledger_acknowledgments ADD
  COLUMN IF NOT EXISTS sent_via text;`. No seed/backfill statement needed (approved as NULL-for-legacy
  above), so there's nothing non-idempotent to guard.
- **`FEATURES` + `hasFeature()`:** no new key. Reuses `LEDGER_RECORD`, identical to
  Generate/Print/Mark Sent on the same screen — correct, since this is the same actor doing the same
  class of action on the same rows, not a new capability.
- **No native dialogs:** the `<ConfirmDialog>` for the send action is the same component the
  existing `LARGE_BATCH_THRESHOLD` generate-confirm already uses on this screen — same import, same
  pattern, non-destructive styling per the "Ruling on the confirm dialog" note already in this
  work-log (inherited, not re-litigated).
- **No secrets:** nothing here touches env vars beyond what `sendEmail()`/`RESEND_API_KEY` already
  read.
- **Gating derivation (`getAdminProtectionRules()`):** confirmed by reading `src/proxy.ts` directly
  — it **skips every `/api/` path unconditionally** (`if (request.nextUrl.pathname.startsWith("/api/"))
  return NextResponse.next();`) before any `ADMIN_NAVIGATION`-derived rule is even consulted. So the
  new route is **not** protected by the derived proxy rules at all, by design — no route under
  `/api/admin/*` ever is. Its *only* protection is its own `auth()` + `hasFeature()` call, which must
  copy the sibling `generate/route.ts` exactly. Separately, `admin-page-feature-gates.test.ts`'s
  static check (`topLevelAdminSegments()`) only walks top-level directories under
  `src/app/(dashboard)/admin/` — it inspects `ledger/page.tsx`-level segments, not the nested
  `ledger/donors/letters/page.tsx` this feature's UI lives on. That nested page is **not** newly
  created by this feature (it already exists and already self-gates on `LEDGER_RECORD`, confirmed by
  direct read), so no new gap opens — but it's worth stating plainly for Phase 4: the static test
  would not have caught a missing gate on this nested page either way, same as it wouldn't for any
  other already-nested admin page. Nothing to fix; noting so nobody assumes the static test is
  covering more than it does.

## 7. Problems flagged in Phase 1 / treasurer's answers

- **Bounce visibility on a tax document — accept, given the treasurer's explicit sign-off, but hold
  the UI to the honesty requirement.** Shipping an emailed acknowledgment with no bounce visibility
  beyond synchronous Resend-rejection is a real risk on the one document type in this app with a tax
  consequence for someone outside the club. The treasurer's answer above ("ship on the existing
  queue-and-retry, with the limitation stated," B-47 queued) is a legitimate risk-acceptance by the
  person who owns that risk, so this is not an architectural blocker. What Phase 3/4 must not do is
  let the UI imply more certainty than the system has: results-panel and any on-screen copy must say
  "Emailed [date]," never "Delivered [date]" — Phase 1 (d) already states this correctly; flagging it
  here so it survives into the design doc as a requirement, not a nice-to-have that gets cut under
  time pressure.
- **`escapeHtml()` — reuse the shape already established, don't invent a fourth variant, and don't
  smuggle B-46 into this feature.** `composeAcknowledgmentEmailHtml()` needs to turn plain-text
  `letterText` into escaped HTML for the email body. `src/lib/dues-reminders.ts` already has exactly
  this shape (`escapeHtml()` + `<p>`/`<br>` construction) for the same class of problem (plain
  template values into an HTML email). B-46 already tracks that this pattern is duplicated six times
  across the codebase and wants a real, separate consolidation pass (`src/lib/email-compose.ts`).
  This feature should follow the existing local pattern for its one new use, not add a seventh
  copy with different escaping behavior, but should also **not** attempt B-46's consolidation as a
  side effect — that was correctly scoped out as its own pass. Note for Phase 3, not a blocker.
- **Foundation-vs-Club From-address mismatch — settled by the treasurer, nothing further to rule
  on.** Inherited as instructed.
- **Everything else in Phase 1's Judged Questions ((a) send-to-all, (b) visible email-status column,
  (g) route both multi-donor and multi-address through one `sendBulkMemberEmail()` call) is sound
  and requires no architectural correction** — each already follows an existing pattern or an
  already-settled schema decision (`ledgerDonors.emails`'s own "no primary" comment). Open items (e)
  resend-of-an-already-sent-letter and (4) partial-multi-address-failure semantics are real product
  decisions but don't touch placement, dependencies, or invariants — Phase 3's to make, not Phase 2's.

## What I did

- Read the full acknowledgment-letter-email work-log (Phase 1, treasurer's answers, confirm-dialog
  ruling) and the dues-reminder-emails work-log this feature inherits from.
- Read DECISION-085, DECISION-086, and the DECISION-026/072/073 lineage in `docs/decisions.md`.
- Read backlog items B-45, B-46, B-47 in full.
- Read `src/lib/ledger-acknowledgment-letter-queries.ts` and `src/lib/ledger-acknowledgment-letter.ts`
  in full (query shape, existing guard/skip pattern, existing donor projection).
- Read `src/app/api/admin/ledger/acknowledgments/letters/generate/route.ts` and the
  `.../transactions/[id]/acknowledge/route.ts` PATCH handler to confirm the existing "already sent"
  enforcement mechanism (and its non-atomic shape).
- Read `src/lib/email.ts` in full — confirmed the non-production guard is unconditionally
  deny-by-default, not conditioned on `_bulkMemberSend`.
- Read `src/lib/board-positions.ts` (`resolveTreasurer()`), `src/lib/db/schema.ts`
  (`ledgerAcknowledgments`, confirming no `sentVia` column exists yet), `src/proxy.ts`, and
  `src/lib/admin-page-feature-gates.test.ts` to confirm the API-route-vs-page-gate scope question.
- Confirmed `src/app/(dashboard)/admin/ledger/donors/letters/page.tsx` already self-gates on
  `FEATURES.LEDGER_RECORD`.
- Logged **DECISION-087**.

## Outputs

- `docs/decisions.md` — new **DECISION-087** (placement, naming, `sentVia`, atomic-update ruling).
- `docs/work-log/2026-08-12-acknowledgment-letter-email.md` — this Phase 2 section; status table
  row 2 set to Complete / Approved with suggestions / 2026-08-12.

### Files this feature will touch (for Phase 3/4, not touched by me)

- `src/lib/ledger-acknowledgment-letter-queries.ts` — add `emails: string[]` to
  `GeneratableAcknowledgmentRow.donor` + map, new `emailAcknowledgmentLetters()`.
- `src/lib/ledger-acknowledgment-letter.ts` — new `composeAcknowledgmentEmailHtml()`.
- `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` — new.
- `src/lib/db/schema.ts` — `ledgerAcknowledgments.sentVia`.
- `drizzle/migrations/0088_ledger_ack_sent_via.sql` — new, idempotent.
- `src/lib/email.ts` — one-line doc-comment broadening on `sendBulkMemberEmail()` only.
- `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — new action + column.

## Open questions / handoff notes

- Phase 3 (tech-lead) must specify the exact conditional-`UPDATE` shape for
  `emailAcknowledgmentLetters()` (§5 above) as a hard requirement, and must decide the two product
  questions Phase 1 correctly left open: partial multi-address failure semantics (Phase 1 open
  question 4) and whether a "Resend an already-sent letter" affordance ships now or stays deferred
  (Phase 1 (e)/Out of Scope).
- Phase 3 must specify `composeAcknowledgmentEmailHtml()`'s exact signature and where the one-line
  lead-in text lives (likely a literal in that function, per Phase 1 (f) — not a new template field,
  since the template's five columns are already the treasurer's entire writable surface per
  DECISION-072 §2 and this feature must not widen that allowlist).
- No loop-back. Advance to Phase 3 (tech-lead).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Adds a "Send by Email" action to the existing acknowledgment-letter selector, alongside the existing
"Generate" and "Print" actions, all on `/admin/ledger/donors/letters`. Emailing is a new write
function, `emailAcknowledgmentLetters()`, in the same `ledger-acknowledgment-letter-queries.ts`
module `generateAcknowledgmentLetters()` already lives in; a new pure `composeAcknowledgmentEmailHtml()`
in the same `ledger-acknowledgment-letter.ts` module `composeAcknowledgmentLetter()` already lives in;
one new route, `POST /api/admin/ledger/acknowledgments/letters/email`. No new page, no new `FEATURES`
key, no new npm dependency. The one piece of genuinely new mechanism is the atomic
claim-then-send-then-revert-on-total-failure shape `emailAcknowledgmentLetters()` uses to guarantee a
donor is never emailed the same acknowledgment twice — everything else is direct reuse of
`sendBulkMemberEmail()`, `resolveTreasurer()`, and the existing selector's own patterns. Five
implementation decisions this phase makes beyond what Phase 1/2 specified are logged as
**DECISION-088**.

## Permissions

No new `FEATURES` key. Reuses `FEATURES.LEDGER_RECORD` — identical to Generate/Print/Mark Sent on
this same screen. The new route gates itself independently (`auth()` + `hasFeature(...,
LEDGER_RECORD)`), copying `.../letters/generate/route.ts` exactly, because `/api/admin/*` is entirely
outside `src/proxy.ts` (early-return on any `/api/` path) and outside
`admin-page-feature-gates.test.ts`'s scope (page.tsx files only, and this route has no page.tsx of its
own) — this self-gate is its only protection.

## API Contract

### `POST /api/admin/ledger/acknowledgments/letters/email`

New file: `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts`. Copy
`.../letters/generate/route.ts`'s shape line for line: manual array validation (no zod), `auth()` +
`hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`, identical error-response conventions, 200
always on a successful call (per-row failure is data in the response body, not an HTTP failure —
matches the dues-reminder POST route's own "6. 200 always" rule).

```
Body:
{ ackIds: string[] }   // 1..N acknowledgment ids — same id space as .../letters/generate

Response 200:
{
  results: Array<
    | { ackId: string; status: "emailed"; addresses: Array<{ to: string; success: boolean; error?: string }> }
    | { ackId: string; status: "skipped"; reason: string }
    | { ackId: string; status: "failed"; reason: string }   // claimed, but delivery failed at every address — see Immutability below
  >
}

Response 400: ackIds missing/not an array/empty/non-string entries — identical validation to generate.
Response 401: not authenticated.
Response 403: lacks LEDGER_RECORD.
Response 500: genuine server error (a DB failure claiming a row, or an unexpected throw — not a
  per-address Resend failure, which is always reported as data in `results`, never a 500).
```

`reason` strings (stable, user-facing), in guard order:

1. `"not found"` — id not among hydrated rows.
2. `"already sent"` — either the pre-check snapshot's `sentAt !== null`, or the atomic claim UPDATE
   returned zero rows (lost the race to a concurrent request). Both produce this identical string —
   the caller cannot and should not distinguish "was already sent when we looked" from "someone else
   sent it a moment ago"; both mean the same thing to the treasurer: nothing to do here.
3. `"letter not yet generated"` — `letterText === null`. You cannot email nothing; the treasurer must
   Generate first.
4. `"no donor linked"` — `donor === null` (mirrors generate's identical reason string and cause: the
   donor row was deleted after the ack was created, `donorId` is `ON DELETE SET NULL`).
5. `"donor has no email on file"` — `donor.emails.length === 0`. Not offered as a checkbox in the UI
   (Flow 3); this is the defense-in-depth 400-equivalent path for a direct API call.
6. (claimed but) `"delivery failed for all addresses — not marked sent, safe to retry"` — reported as
   `status: "failed"`, not `"skipped"`, because this ack DID pass every business-rule check and DID
   attempt to send; it just didn't reach anyone. See Immutability.

## Data Model

**Schema change:** `ledgerAcknowledgments` gains one nullable column.

```typescript
// src/lib/db/schema.ts — in the ledgerAcknowledgments column list, next to sentAt
// null = unset (legacy row, or not yet sent); 'print' | 'email' once a send path succeeds.
sentVia: text("sent_via"),
```

Plain `text("sent_via")` with no `.notNull()` — the identical Drizzle shape already used for
`quidProQuoDescription` (migration 0078) and `emailQueue.cc`/`bcc` (migration 0087), both already
proven correct against a live `drizzle-kit push --force` in this codebase, so there's no new mapping
to verify: a bare `text()` column with no modifiers produces a nullable Postgres `text` column,
matching `ADD COLUMN IF NOT EXISTS sent_via text;` exactly. No index needed — this column is never
filtered or sorted on by any query in this feature (Flow 3's email-status column reads `donor.emails`,
not `sentVia`; the existing `ix_ledger_acks_sent_at` index already covers every query that filters on
"is this ack sent").

**Migration:** `drizzle/migrations/0088_ledger_ack_sent_via.sql` — 0087 is the current highest
(`0087_email_queue_cc_bcc.sql`), confirmed by directory listing, so 0088 is free and next.

```sql
-- Migration 0088: sentVia on ledger acknowledgments — disambiguates "sent" into
-- "mailed a physical letter" vs. "emailed one" (docs/work-log/2026-08-12-
-- acknowledgment-letter-email.md, DECISION-087 item 3).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS is a no-op on re-run. Nullable, no
-- backfill — legacy rows and any row sent before this feature shipped stay
-- NULL, honestly, rather than guessing which channel a historical row went
-- through.

ALTER TABLE ledger_acknowledgments
  ADD COLUMN IF NOT EXISTS sent_via text;
```

**Existing PATCH mark-sent route** (`.../transactions/[id]/acknowledge`) gains one line: its success
patch sets `sentVia: 'print'` alongside the `sentAt` it already sets — this is the print-side half of
the disambiguation, unchanged in every other respect (still the same read-then-write shape it already
uses; that race is pre-existing and out of scope here, per Phase 2 §5).

**`GeneratableAcknowledgmentRow` (`ledger-acknowledgment-letter-queries.ts`) gains two fields** —
Phase 2 confirmed `emails`; this phase adds `letterText` as a second, equally load-bearing projection
gap discovered while designing `emailAcknowledgmentLetters()` (DECISION-088 item 4):

```typescript
export type GeneratableAcknowledgmentRow = {
  // ...unchanged fields...
  donor: { id: string; name: string; address: string | null; emails: string[] } | null; // + emails
  letterText: string | null; // NEW
};
```

Both are projection-only changes at the `.map()` in `listGeneratableAcknowledgments()` (~line 121):
`r.ack` and `r.donor` are already fully selected by the existing query; only the narrowing object
literal needs the two extra keys (`emails: r.donor.emails`, `letterText: r.ack.letterText`). Zero new
joins, zero new round-trips — same as Phase 2 already confirmed for `emails` alone.

## Component/Page Plan

- **Pages:** none new. `src/app/(dashboard)/admin/ledger/donors/letters/page.tsx` is unchanged (it
  already passes `listGeneratableAcknowledgments()`'s full row set to the selector; the two new
  fields flow through automatically once the type/query change lands).
- **Components to modify:** `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — new
  "Send by Email" button, new email-status table column, new `<ConfirmDialog>`, new results panel.
- **Files to modify:**
  - `src/lib/db/schema.ts` — `ledgerAcknowledgments.sentVia`.
  - `drizzle/migrations/0088_ledger_ack_sent_via.sql` — new.
  - `src/lib/ledger-acknowledgment-letter-queries.ts` — `GeneratableAcknowledgmentRow` +2 fields, new
    `emailAcknowledgmentLetters()`.
  - `src/lib/ledger-acknowledgment-letter.ts` — new `composeAcknowledgmentEmailHtml()`.
  - `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` — PATCH sets `sentVia: 'print'`.
  - `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` — new.
  - `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — action + column.

## Email Composition

`composeAcknowledgmentEmailHtml()`, new pure function in `src/lib/ledger-acknowledgment-letter.ts`,
next to `composeAcknowledgmentLetter()`:

```typescript
/**
 * Wraps an already-composed letterText (verbatim — never re-derived, never
 * re-worded) into an HTML email body: one short lead-in paragraph, then the
 * letter's own paragraphs, each escaped and wrapped in <p>. Mirrors the
 * escapeHtml() + <p>-per-paragraph shape already established in
 * dues-reminders.ts's renderDuesReminderBody() for the same class of
 * problem (plain template/free text into an HTML email) — this is that
 * module's one new use of the pattern, not a fourth reimplementation of it
 * (B-46 tracks consolidating all of these into src/lib/email-compose.ts as
 * its own pass; this feature does not attempt that consolidation).
 */
export function composeAcknowledgmentEmailHtml(letterText: string): string {
  const leadIn =
    "Please find your official gift acknowledgment below — you may want to save or print this " +
    "email for your tax records.";
  const paragraphs = letterText
    .split("\n\n")
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(p)}</p>`)
    .join("\n");

  return `<div style="font-family:Arial, Helvetica, sans-serif;color:#1a1a1a;font-size:14px;max-width:640px;">
<p style="margin:0 0 16px;line-height:1.5;">${leadIn}</p>
${paragraphs}
</div>`;
}
```

`escapeHtml()` is a private, local copy inside this file — the exact same four-line shape
`dues-reminders.ts` already has (not imported from there: `dues-reminders.ts` isn't a shared utility
module, it's a feature-local one, and reaching into a sibling feature's private helper would create
the wrong kind of coupling; B-46 is the tracked, correctly-scoped-out place to give this a single
real home). This is the *third* copy in the codebase, not a fourth pattern — same shape, same
behavior, deliberately not consolidated here per Phase 2's explicit instruction.

Newline convention: `composeAcknowledgmentLetter()`'s own doc comment states its output is
"paragraphs separated by blank lines (`\n\n`)" — `composeAcknowledgmentEmailHtml()`'s `\n\n` split
consumes that exact, already-documented contract, not a new assumption.

**Subject line:** `"Your Official Gift Acknowledgment — Thank You for Your Generosity"` — a single
static string, shared across the whole batch (see Bulk Send below for why this doesn't need to vary
per ack or per donor: the entity's legal name is already inside the required block of the letter body
itself, per `buildRequiredBlock()`, so the subject doesn't need to carry it).

## Bulk Send — `emailAcknowledgmentLetters()`

New function in `src/lib/ledger-acknowledgment-letter-queries.ts`, alongside
`generateAcknowledgmentLetters()`:

```typescript
export type EmailLetterResult =
  | { ackId: string; status: "emailed"; addresses: Array<{ to: string; success: boolean; error?: string }> }
  | { ackId: string; status: "skipped"; reason: string }
  | { ackId: string; status: "failed"; reason: string };

export async function emailAcknowledgmentLetters(ackIds: string[]): Promise<EmailLetterResult[]>
```

**Step 1 — hydrate and pre-check (mirrors `generateAcknowledgmentLetters()`'s existing shape).**
`listGeneratableAcknowledgments({ ackIds })` — same call generate already makes. For each requested
id, in order, apply guards 1–5 from the API Contract's reason list above. Rows that fail any of these
are immediately pushed to `results` as `skipped`; everything else becomes a **candidate**.

**Step 2 — the atomic claim (THE IMMUTABILITY REQUIREMENT).** For each candidate, one statement:

```typescript
const [claimed] = await db
  .update(ledgerAcknowledgments)
  .set({ sentAt: new Date(), sentVia: "email", updatedAt: new Date() })
  .where(and(eq(ledgerAcknowledgments.id, candidate.ackId), isNull(ledgerAcknowledgments.sentAt)))
  .returning({ id: ledgerAcknowledgments.id });
```

This is the single conditional `UPDATE ... WHERE id = $ackId AND sent_at IS NULL RETURNING id` Phase 2
required, run once per candidate, sequentially, **before any email is sent**. A candidate whose UPDATE
returns no row (someone else claimed it between Step 1's read and now — the exact race Phase 1 named
in Gaps §h) is immediately reported `skipped: "already sent"` and drops out; it is never included in
the send. This is a real Postgres row-level write — two concurrent requests targeting the same row
serialize on it (the second's `UPDATE` blocks until the first commits, then finds `sent_at IS NOT
NULL` and updates zero rows), so this is a correct mutual-exclusion primitive, not merely
"usually correct." Only successfully-claimed candidates proceed to Step 3.

**Step 3 — one `sendBulkMemberEmail()` call for the whole surviving batch.** Build a flat
`recipients` array across every claimed ack's donor's every address, and a parallel same-order
`meta: { ackId: string; to: string }[]` used only for regrouping results afterward (never for
lookup-by-address — see DECISION-088 item 3 for why address-keyed lookup is wrong when two donors
share an inbox):

```typescript
const html = composeAcknowledgmentEmailHtml(candidate.letterText!); // non-null: guard 3 already passed
for (const to of candidate.donor!.emails) {
  meta.push({ ackId: candidate.ackId, to });
  recipients.push({ to, html });
}

const treasurer = await resolveTreasurer();
if (!treasurer.ok) {
  console.warn(`[Ledger email] Acknowledgment send: Treasurer CC skipped (${treasurer.reason})`);
}

const { results: sendResults } = await sendBulkMemberEmail({
  from: "treasurer@westervillelions.org", // settled — same literal the dues-reminder route uses
  subject: "Your Official Gift Acknowledgment — Thank You for Your Generosity",
  ...(treasurer.ok ? { replyTo: treasurer.email, bcc: treasurer.email } : {}),
  recipients,
});
```

`sendResults` comes back in the same order `recipients` was submitted (`sendBulkMemberEmail()` is a
plain sequential `for` loop over its input array — confirmed by reading `src/lib/email.ts` directly,
not assumed) — so `meta[i]` and `sendResults[i]` describe the same send.

**Step 4 — regroup by ack, decide keep-vs-revert.** Group `sendResults` by `meta[i].ackId`. For each
claimed ack:
- **At least one address succeeded** → keep the claim (no further write — Step 2 already committed
  it). Report `status: "emailed"`, `addresses: [...]` with every address's own success/error. This is
  Phase 1's recommended partial-failure rule, adopted as final: the donor received the letter, so the
  ack is correctly "sent"; the specific failed address is still visible so the treasurer can fix a
  stale entry on the donor record.
- **Every address failed** → revert: `UPDATE ledger_acknowledgments SET sent_at = NULL, sent_via =
  NULL WHERE id = $ackId AND sent_via = 'email'` (the `sent_via = 'email'` guard, rather than an
  unconditional revert, means this can never accidentally clear a legitimate `'print'` sentVia —
  though that shouldn't be reachable here anyway, it costs nothing to be exact). Report `status:
  "failed"`, `reason: "delivery failed for all addresses — not marked sent, safe to retry"`. This is
  the one place a committed write is undone after the fact, and it is necessary precisely because Step
  2 has to claim before Step 3 can know whether delivery will succeed — Phase 2's ordering requirement
  leaves no alternative that is both atomic and never leaves a ghost "sent" record for a letter nobody
  received.

There is a narrow, accepted residual gap here, named rather than hidden: if the server process dies
between Step 2's claim and Step 4's revert (not a business-rule failure, a process crash), the ack is
left permanently marked `sentAt`/`sentVia: 'email'` with no delivered mail behind it. This is
extremely unlikely (the window is one in-process network call) and no worse than the pre-existing
mark-sent PATCH route's own unprotected window: a treasurer who suspects this happened has the same
recourse either way — check `/admin/email-queue` for the ack's actual delivery record, which is
unaffected by this gap (`sendEmail()` queues before ever attempting delivery).

## UI Plan — `AcknowledgmentLetterSelector`

**Email-status column (Flow 3, always visible, independent of any action):** new `<th>`/`<td>` next
to the existing Donor column.

```tsx
{!row.donor ? (
  <span className="text-gray-300">—</span>
) : row.donor.emails.length === 0 ? (
  <span className="text-xs font-medium text-amber-700">No email on file</span>
) : (
  <span className="text-xs text-gray-600">
    {row.donor.emails.length} address{row.donor.emails.length === 1 ? "" : "es"}
  </span>
)}
```

Same amber treatment already used for "Missing address" — a deliberate visual echo, not a new color
convention.

**"Send by Email" button — a sibling of "Print / Save as PDF", not checkbox-driven.** Phase 1's Flow 1
describes this as a single aggregate action ("a 'Send by Email' button appears... scoped to exactly
the letters with an email available"), matching Print's existing shape (one button, a count, operates
on a computed ready set) rather than Generate's shape (operates on the checkbox `selected` Set).
Eligibility is computed from `rows` directly — `letterText !== null && (donor?.emails.length ?? 0) >
0` — **not** scoped to "generated this session" the way Print's `printableLetters` is. This is a
deliberate widening beyond Phase 1's literal wording, made here because the reason Print is
session-scoped (it needs the actual letter text held in client memory to render for printing) doesn't
apply to email — the send route re-fetches `letterText` fresh from the DB server-side, the same way
Generate's own route never trusts client-held state. A letter drafted and left unsent from an earlier
visit to this screen should be just as emailable today as one generated a moment ago; scoping email to
`printableLetters` would silently under-serve that case for no reason tied to how email actually works.

```typescript
const emailEligible = useMemo(
  () => rows.filter((r) => r.letterText !== null && (r.donor?.emails.length ?? 0) > 0),
  [rows],
);
const emailAddressCount = emailEligible.reduce((n, r) => n + (r.donor?.emails.length ?? 0), 0);
const multiAddressDonorCount = emailEligible.filter((r) => (r.donor?.emails.length ?? 0) > 1).length;
```

**Button rendering — disabled-with-reason, not hidden, when nothing is eligible** (Phase 1 §h,
explicit): unlike Print (which only renders once `printableLetters.length > 0`), the Send by Email
button always renders once `rows.length > 0`, `disabled` when `emailEligible.length === 0`, with a
one-line helper underneath ("0 letters ready to email — generate a letter for a donor with an email on
file first"). This is a deliberate, stated inconsistency with Print's own hide-when-empty pattern, for
the reason Phase 1 gave: an absent button reads as "not built," a disabled one with a reason reads as
"correctly not applicable right now."

**Confirm dialog — non-destructive** (per the work-log's own standing ruling, inherited unchanged):

```tsx
<ConfirmDialog
  open={emailConfirmOpen}
  onOpenChange={setEmailConfirmOpen}
  title={`Email ${emailEligible.length} acknowledgment letter${emailEligible.length === 1 ? "" : "s"}?`}
  description={
    multiAddressDonorCount > 0
      ? `This will send to ${emailAddressCount} addresses (${multiAddressDonorCount} donor${multiAddressDonorCount === 1 ? "" : "s"} on file with more than one). Emailed letters cannot be un-sent — the acknowledgment record will show as sent by email.`
      : `This will send to ${emailAddressCount} address${emailAddressCount === 1 ? "" : "es"}. Emailed letters cannot be un-sent — the acknowledgment record will show as sent by email.`
  }
  confirmLabel={`Email ${emailEligible.length} Letter${emailEligible.length === 1 ? "" : "s"}`}
  onConfirm={() => { setEmailConfirmOpen(false); runEmail(); }}
  // NOT destructive — the recipient count and the description carry the weight, not button color
  // (this work-log's own "Ruling on the confirm dialog", inherited verbatim).
/>
```

**Results panel — copy says "Emailed", never "Delivered"** (Phase 1 (d), Phase 2 hard requirement).
A new panel, separate from the existing Generate results panel (different result shape, different
action — not unified into one component in this pass):

```tsx
{emailResults && (
  <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900">
    <p className="font-semibold">
      {emailResults.filter((r) => r.status === "emailed").length} of {emailResults.length} letter
      {emailResults.length !== 1 ? "s" : ""} emailed
      {emailResults.some((r) => r.status !== "emailed")
        ? ` — ${emailResults.filter((r) => r.status !== "emailed").length} not sent.`
        : "."}
    </p>
    {/* per-row list, same shape as the generate panel: donor name — reason, for every
        status !== "emailed" row; for status === "emailed" rows with a partial address
        failure, list the specific failed address alongside the success */}
  </div>
)}
```

No copy anywhere in this feature (button, dialog, results panel, row badge) uses the word
"Delivered" — the system can only ever know "Emailed" (Resend accepted it), never confirm receipt.

After a send, refresh `rows` via the existing `GET .../letters/generatable` (same call `runGenerate()`
already makes after generating) — successfully emailed acks now have `sentAt !== null` and drop out of
the unscoped `listGeneratableAcknowledgments()` result set on their own, the same way a printed/marked-
sent row already disappears from this screen today. No new client-side filtering needed.

## Edge Cases & Risks

- **Donor with no email** — not offered (Flow 3's amber "No email on file"); defense-in-depth 400-
  equivalent skip if reached directly via the API (reason 5 above).
- **Donor deleted after the ack was created** (`donorId` nullable, `ON DELETE SET NULL`) — `donor ===
  null` in the hydrated row, skip reason `"no donor linked"`, identical to how generate already handles
  this exact case.
- **An ack already marked sent** — pre-check catches the common case; the atomic claim is the
  authoritative backstop for the race (see Immutability). Both report the same `"already sent"` string.
- **A partial batch failure** — ruled: an ack is "emailed" if at least one of its donor's addresses
  succeeded, with the failing address surfaced per-address so the treasurer can fix it; an ack is
  "failed" (claim reverted, retryable) only if every address for it failed.
- **`resolveTreasurer()` returns nothing** — tolerant: log and send without `replyTo`/`bcc`, per
  DECISION-088 item 5. Justified because the letter's own signature block, not the CC, is what makes
  the document legally sufficient; a Board-group data gap shouldn't hold a donor's tax receipt hostage,
  and the treasurer notices and fixes the underlying group data independently of any one send.
- **A malformed address** — no new format validation is added here; `ledgerDonors.emails` is already
  validated at the donor-edit boundary (schema comment: "standard-email-format-validated at the app
  layer"). A malformed address that exists anyway (legacy data, a future write path that skips that
  check) is handled identically to any other synchronous Resend rejection — reported as a per-address
  failure, queued and visible at `/admin/email-queue`, no special case in this feature's code.
- **Concurrency (the immutability requirement itself)** — covered exhaustively above; this is the
  central risk this design exists to close.
- **Bounce-after-acceptance** — explicitly out of reach (no Resend webhook exists in this codebase),
  accepted risk per the treasurer's own answer above, tracked as **B-47**. This feature's only
  obligation is to never claim more certainty than "Emailed" in its own UI, which it doesn't.
- **Mobile at 360px** — the selector table gains a fourth data column and a second action button on an
  already-flagged-dense row (carried-forward TODO from the original generation feature). This feature
  must not ship without checking the table at 360px — named as a Phase 4/5 gate, not assumed fixed by
  inheritance.

## Out of Scope

- **A "Resend" affordance for an already-sent (emailed or printed) letter** — Phase 1 (e) raised this
  as an open question; it stays deferred. The normal Send button's guard (atomic claim requires
  `sent_at IS NULL`) makes an already-sent ack simply un-selectable for this action; there is no path
  in this feature to intentionally re-fire an already-sent letter.
- **PDF attachment delivery** — settled out in Phase 1 (f) and by two prior project decisions against a
  PDF-generation dependency; the email body is the composed letter rendered inline, nothing else.
- **Resend webhook / bounce-detection infrastructure** — tracked as B-47, materially separate work.
- **B-46's email-compose consolidation** — this feature adds one more local `escapeHtml()`/paragraph-
  wrapping use of the pattern (its third occurrence), matching the existing local shape exactly; it
  does not attempt to extract a shared module, which stays B-46's separately-scoped pass.

## Unit Tests Required (Phase 4 implementer writes these, not qa)

**`src/lib/ledger-acknowledgment-letter.test.ts`** (extend the existing file):

1. `composeAcknowledgmentEmailHtml()` includes the exact lead-in sentence, followed by every paragraph
   of the input `letterText`, unchanged in content (split on the same `\n\n` convention
   `composeAcknowledgmentLetter()` already documents producing).
2. `composeAcknowledgmentEmailHtml()` HTML-escapes `&`, `<`, `>`, `"`, and `'` appearing inside
   `letterText` (a donor or entity name containing one of these characters, reaching this function via
   an already-composed letter, must not break the email's markup or be interpreted as a tag).
3. `composeAcknowledgmentEmailHtml()` is pure and deterministic — same `letterText` in, byte-identical
   HTML out, across two calls (no hidden `Date.now()`/`Math.random()` dependency).

**`src/lib/ledger-acknowledgment-letter-queries.test.ts`** (extend the existing file):

4. `emailAcknowledgmentLetters()` skips an id not present in `listGeneratableAcknowledgments({ackIds})`
   with reason `"not found"`, and never attempts a claim UPDATE for it.
5. `emailAcknowledgmentLetters()` skips an ack whose `sentAt` is already non-null (pre-check) with
   reason `"already sent"`, without attempting the claim UPDATE at all (the pre-check should short-
   circuit before the write, not merely produce the same outcome as if it hadn't).
6. `emailAcknowledgmentLetters()` skips an ack with `letterText === null` with reason `"letter not yet
   generated"`.
7. `emailAcknowledgmentLetters()` skips an ack with `donor === null` with reason `"no donor linked"`.
8. `emailAcknowledgmentLetters()` skips an ack whose donor has `emails: []` with reason `"donor has no
   email on file"`.
9. **The concurrency test — the load-bearing one.** Two concurrent calls to
   `emailAcknowledgmentLetters([ackId])` for the same not-yet-sent ack: exactly one reports `"emailed"`
   (or `"failed"` if delivery fails), the other reports `skipped: "already sent"` — never both
   `"emailed"`, and the ack's `sentAt`/`sentVia` end in a single, consistent state. (Simulate via two
   sequential calls sharing a DB transaction boundary, or two `Promise.all()`-launched calls against a
   real test DB connection — whichever this project's existing concurrency tests, if any, already use
   as the pattern; if none exist yet, a direct two-row-level-UPDATE-race test against the test DB is
   acceptable.)
10. **The revert-on-total-failure test.** Given a donor with one email address, and `sendEmail()`/
    `sendBulkMemberEmail()` mocked to fail that address, `emailAcknowledgmentLetters()` reports
    `status: "failed"` for that ack AND the ack's `sentAt`/`sentVia` are both `null` afterward (the
    claim was reverted, not left as a ghost "sent" record) — and a second call for the same `ackId`
    is not skipped as "already sent"; it is retried as a fresh candidate.
11. **The partial-success test.** Given a donor with two email addresses, one mocked to succeed and one
    to fail, `emailAcknowledgmentLetters()` reports `status: "emailed"` for that ack (not "failed"),
    with `addresses` showing one `success: true` and one `success: false`, and the ack's `sentAt`/
    `sentVia` remain set (the claim is kept).
12. **The shared-address-across-two-donors test.** Two different claimed acks whose donors happen to
    share the exact same email address, one mocked to succeed and one to fail for that address (i.e.,
    the mock's behavior is keyed by call order/position, not by the address string) — each ack's
    result correctly reflects its own donor's outcome, proving the `meta[i]`/`sendResults[i]`
    index-based zip (not an address-string lookup) is what the implementation actually uses.
13. `emailAcknowledgmentLetters()` calls `sendBulkMemberEmail()` exactly once per invocation (not once
    per ack) for a multi-ack batch — a spy-based test asserting call count, guarding against a future
    regression back toward a call-per-ack shape.

**`src/app/api/admin/ledger/acknowledgments/letters/email/route.test.ts`** (new, mirroring
`.../generate/route.test.ts` if one exists — confirm and follow its shape):

14. 401 with no session; 403 without `LEDGER_RECORD`; 400 for a missing/empty/non-string `ackIds`.
15. 200 with a `results` array whose shape matches the contract above for a mixed batch (one emailed,
    one skipped, one failed).

## What I did

- Read the full work-log (Phase 1 analyst review, treasurer's answers, confirm-dialog ruling, Phase 2
  architect review) in full, plus DECISION-085/086/087 and backlog B-45/B-46/B-47.
- Read `src/lib/ledger-acknowledgment-letter-queries.ts` and `src/lib/ledger-acknowledgment-letter.ts`
  in full to confirm the exact existing guard order, query shape, and composition contract this
  feature extends.
- Read both existing "already sent" enforcement sites directly — `generateAcknowledgmentLetters()` and
  the PATCH mark-sent route in `.../transactions/[id]/acknowledge/route.ts` — to confirm their
  read-then-write shape is exactly as Phase 2 described, and to find the exact line the new `sentVia:
  'print'` write belongs on.
- Read `src/lib/email.ts` in full, confirming `sendBulkMemberEmail()`'s per-recipient loop is
  synchronous and order-preserving (load-bearing for the index-based result-zipping design) and that
  its options (`from`, `subject`, `replyTo`, `bcc`, `recipients`) have no `cc` field and no per-
  recipient subject — which is what settled the "one call for the whole batch, not one per ack"
  design, since a per-ack subject was never actually necessary.
- Read `src/app/api/admin/dues/reminders/route.ts` end to end as the closest existing precedent for
  "one `sendBulkMemberEmail()` call across a heterogeneous batch, replyTo/bcc from `resolveTreasurer()`,
  200-always response shape" — this feature's Bulk Send design mirrors it directly rather than
  inventing a new shape.
- Read `src/lib/dues-reminders.ts` for the exact `escapeHtml()` + `<p>`-per-paragraph shape to copy
  (not import — see Email Composition for why not importing from a sibling feature file is correct
  here).
- Read `src/lib/board-positions.ts` (`resolveTreasurer()`) and the reimbursement route's tolerant-CC
  pattern in `.../reimbursements/[id]/route.ts` to confirm the tolerant-failure precedent this feature
  adopts.
- Read `src/components/admin/ledger/acknowledgment-letter-selector.tsx` in full (382 lines) and its
  page `src/app/(dashboard)/admin/ledger/donors/letters/page.tsx` to design the new column/button/
  dialog/results-panel additions against the actual existing component shape, not a guess at it.
- Confirmed `drizzle/migrations/` currently tops out at `0087_email_queue_cc_bcc.sql`, so `0088` is
  free, and confirmed the exact idempotent-migration shape to copy from `0078`/`0087`, both of which
  add a single nullable `text` column the same way this feature's `sentVia` does.
- Logged **DECISION-088** (the five implementation calls beyond what Phase 1/2 specified).

## Outputs

- `docs/decisions.md` — new **DECISION-088**.
- `docs/work-log/2026-08-12-acknowledgment-letter-email.md` — this Phase 3 section; status table row
  3 set to Complete / Design complete / 2026-08-12; row 4 (Implementation) pre-filled with the named
  implementer split.

### Files this feature will touch (for Phase 4, not touched by me)

- `src/lib/db/schema.ts` — `ledgerAcknowledgments.sentVia`.
- `drizzle/migrations/0088_ledger_ack_sent_via.sql` — new, idempotent.
- `src/lib/ledger-acknowledgment-letter-queries.ts` — `GeneratableAcknowledgmentRow` +2 fields, new
  `emailAcknowledgmentLetters()`.
- `src/lib/ledger-acknowledgment-letter.ts` — new `composeAcknowledgmentEmailHtml()`.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` — PATCH sets `sentVia: 'print'`.
- `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` — new.
- `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — new action + column.
- `src/lib/ledger-acknowledgment-letter.test.ts`, `src/lib/ledger-acknowledgment-letter-queries.test.ts`
  — extended, per Unit Tests Required above.
- `src/app/api/admin/ledger/acknowledgments/letters/email/route.test.ts` — new.

## Open questions / handoff notes

**Implementer split — specialist split, not full-stack-developer.** This spans a schema change +
two DB-facing/pure-function write paths + a new route + a UI action-and-column addition, following the
exact same shape every prior increment of the acknowledgment-letter feature (and The Ledger generally)
has used — small individual pieces, but genuinely three different layers of concern, not one small
tightly-coupled change.

1. **database-admin** — `src/lib/db/schema.ts` (`ledgerAcknowledgments.sentVia`) and
   `drizzle/migrations/0088_ledger_ack_sent_via.sql`. Smallest, cleanest first step; nothing else can
   proceed correctly without this column existing.
2. **api-developer** — `emailAcknowledgmentLetters()` (queries), `composeAcknowledgmentEmailHtml()`
   (pure composer), the PATCH mark-sent route's `sentVia: 'print'` addition, the new
   `.../letters/email/route.ts`, and every unit test numbered 1–15 above. This is the bulk of the real
   design surface (the atomic claim, the revert-on-failure compensation, the index-zipped result
   grouping) and belongs with the agent that owns server-side business logic and its tests.
3. **ux-developer** — the selector component changes (email-status column, Send by Email button,
   confirm dialog, results panel) once the API contract above exists to build against. Must include the
   360px mobile check named in Edge Cases before calling this done.

No loop-back. Advance to Phase 4, in the order above.
