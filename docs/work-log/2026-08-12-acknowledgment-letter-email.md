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
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
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
