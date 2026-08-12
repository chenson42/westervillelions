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
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete | — | 2026-08-12 |
| 5 — Verification | qa | Complete | PASS | 2026-08-12 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-12 |

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

---

# Phase 4 — Implementation (schema) — 2026-08-12

**Owner:** database-admin
**Status:** complete

### Summary

Added the nullable `sentVia` column to `ledgerAcknowledgments`, exactly as specified in Phase 3 /
DECISION-087 item 3 / DECISION-088 item 4, and a matching idempotent migration. No backfill, no
new index, no DB enum/CHECK — plain `text`, validated at the application layer per DECISION-041
(`minutes.kind`/`minutes.status` precedent). Verified against dev with two migration runs and a
direct `information_schema` read; typecheck and the full unit suite both pass.

### What I did

- Read the full work-log (Phases 1–3), DECISION-087, and DECISION-088 to confirm the exact column
  shape and migration number already agreed by tech-lead.
- Confirmed `0087_email_queue_cc_bcc.sql` is the current highest migration (`ls
  drizzle/migrations/*.sql | sort | tail`) — `0088` was free, no collision with a parallel feature.
- Added `sentVia: text("sent_via")` to `ledgerAcknowledgments` in `src/lib/db/schema.ts`, with a
  comment explaining why it exists (sentAt alone can't say *how* a letter went once two send
  channels exist) and why it's a plain text column, not an enum/CHECK.
- Wrote `drizzle/migrations/0088_ledger_ack_sent_via.sql` — a single idempotent `ADD COLUMN IF NOT
  EXISTS` statement.
- Ran `pnpm exec tsc --noEmit` — clean.
- Applied the migration to **dev only**: explicitly `unset PROD_DATABASE_URL` before exporting
  `DATABASE_URL` from `.env.local`, confirmed the target host was the dev Neon branch
  (`ep-orange-sunset-am8erati-pooler...`, not a prod hostname) before running.
- Ran the migration a second time to prove idempotency.
- Queried `information_schema.columns` directly against dev to confirm the live column's type,
  nullability, and default match `schema.ts` — did not assume.
- Ran `pnpm test` — full suite green.
- Did not create any ledger transactions, did not touch `RESEND_API_KEY` or
  `EMAIL_DEV_ALLOWLIST`, did not exercise any send path — this phase is schema-only.

### Outputs

- **Schema:** `src/lib/db/schema.ts` — `ledgerAcknowledgments.sentVia`:
  ```typescript
  // null = unset (legacy row, or not yet sent); 'email' | 'print' once a
  // send path succeeds. sentAt alone only says "this went" — once both a
  // print path and an email path exist, that's no longer enough to answer
  // "who still needs a printed copy," which the treasurer needs at a
  // glance (Phase 1 of docs/work-log/2026-08-12-acknowledgment-letter-
  // email.md). Plain text, not a DB enum/CHECK — validated in application
  // code, matching this project's minutes.kind/minutes.status convention
  // (DECISION-041). No backfill: nobody can truthfully say today whether a
  // pre-this-feature sentAt row was mailed or printed, so legacy rows stay
  // NULL rather than guess on a document with tax consequences. See
  // DECISION-087 item 3 / DECISION-088.
  sentVia: text("sent_via"),
  ```
  Inserted immediately after `sentAt` in the column list, matching Phase 3's placement.
- **Migration:** `drizzle/migrations/0088_ledger_ack_sent_via.sql` (new, next free number —
  0087 was the prior highest):
  ```sql
  ALTER TABLE ledger_acknowledgments
    ADD COLUMN IF NOT EXISTS sent_via text;
  ```
- **Table affected:** `ledger_acknowledgments` (one column added, no other change).
- **Role bindings / seed rows:** none — no new `FEATURES` key, no new permission surface, per
  Phase 2/3 (reuses existing `LEDGER_RECORD`).
- **Idempotency proof:** applied twice against dev.
  - Command: `unset PROD_DATABASE_URL && export $(grep -E "^DATABASE_URL=" .env.local | xargs) &&
    pnpm db:migrate`
  - Run 1: `→ 0088_ledger_ack_sent_via.sql` ... `✅ Migrations completed successfully` (column
    created).
  - Run 2 (identical command, immediately after): `→ 0088_ledger_ack_sent_via.sql` →
    `NOTICE: column "sent_via" of relation "ledger_acknowledgments" already exists, skipping` →
    `✅ Migrations completed successfully`. No error, no schema drift, exit success both times.
  - Live-column verification (direct `information_schema` query against the same dev connection,
    not assumed from `schema.ts`):
    ```
    column_name: sent_via
    data_type:   text
    is_nullable: YES
    column_default: null
    ```
    Matches `text("sent_via")` with no `.notNull()`/`.default()` exactly.
- **Verification:**
  - `pnpm exec tsc --noEmit` — clean, no errors.
  - `pnpm test` — 77 test files, **1443 tests passed** (matches the expected pre-change total
    exactly — this phase added no new tests, since unit tests for the new query/route functions
    belong to api-developer per Phase 3's implementer split).
  - No email send exercised; `RESEND_API_KEY`/`EMAIL_DEV_ALLOWLIST` untouched; no ledger
    transactions created.

### Open questions / handoff notes

- **Next agent: api-developer.** `ledgerAcknowledgments.sentVia` is live in both `schema.ts` and
  the dev DB and ready to consume. No FK — it's a same-table nullable text column, no join
  required.
- Per Phase 3 / DECISION-088 item 4, `GeneratableAcknowledgmentRow` in
  `src/lib/ledger-acknowledgment-letter-queries.ts` still needs `donor.emails: string[]` and
  `letterText: string | null` added to its projection (the `.map()` at ~line 121) — this is a
  read-side projection change, not a schema change, so it was correctly left for api-developer
  rather than done here. The underlying columns (`ledgerDonors.emails`, `ledgerAcknowledgments.letterText`)
  already exist; nothing new to migrate for that step.
- The existing PATCH mark-sent route (`.../transactions/[id]/acknowledge`) needs one line added to
  set `sentVia: 'print'` on success — application code, api-developer's scope per the Phase 3
  implementer split.
- The new `emailAcknowledgmentLetters()` write path must use the atomic conditional `UPDATE ...
  WHERE sent_at IS NULL RETURNING id` shape DECISION-088 item 1 specifies, not a
  read-then-write — `sentVia` should be set in that same conditional `UPDATE`
  (`sent_at = now(), sent_via = 'email'`), and reverted (`sent_at = NULL, sent_via = NULL`) in the
  compensating update if every address fails, per DECISION-088 item 2.
- Local apply command for anyone re-running this: `export $(grep -E "^DATABASE_URL=" .env.local |
  xargs) && pnpm db:migrate` (schema.ts already matches the DB, so `pnpm db:push` is not required
  as a follow-up, but running it is harmless/no-op since nothing else in `schema.ts` changed).

---

# Phase 4 — Implementation (server) — 2026-08-12

**Owner:** api-developer
**Status:** complete

### Summary

Built the send path exactly as Phase 3 designed it: `emailAcknowledgmentLetters()` (the atomic
claim-then-send-then-revert-on-total-failure write function), `composeAcknowledgmentEmailHtml()`
(the pure HTML composer), the new `POST /api/admin/ledger/acknowledgments/letters/email` route,
the `donor.emails`/`letterText` projection additions to `GeneratableAcknowledgmentRow`, and the
`sentVia: 'print'` line on the existing PATCH mark-sent route. All 15 unit tests Phase 3 named are
written and passing, plus two bonus tests covering the envelope (From/subject/Reply-To/BCC) and
`resolveTreasurer()`'s tolerant-failure path, since those are explicit non-negotiables in this
task's brief even though Phase 3 didn't assign them numbers. `pnpm exec tsc --noEmit` is clean;
`pnpm test` is **1466 tests passing** (up from 1443 after the schema phase — 23 new). The atomic
claim, the revert-on-total-failure compensation, and the `blocked_non_production` queue/BCC
behavior were all proven live against the dev DB with a real credentials-login session, not just
in mocked tests; every throwaway artifact (2 users, 1 donor, 1 acknowledgment, 1 email_queue row,
role bindings, sessions) was deleted afterward. No UI work — ux-developer follows.

### What I did

- Read the full work-log (Phases 1–3, DECISION-085/086/087/088) and the Phase 4 (schema) section
  in full before writing anything, per this task's instruction.
- `src/lib/ledger-acknowledgment-letter-queries.ts`:
  - Added `emails: string[]` and `letterText: string | null` to
    `GeneratableAcknowledgmentRow`/`donor` and the `.map()` in `listGeneratableAcknowledgments()` —
    projection-only, zero new joins (both columns were already selected).
  - Added `emailAcknowledgmentLetters()`: pre-check guards (not found / already sent / letter not
    yet generated / no donor linked / donor has no email), then the atomic claim — one conditional
    `UPDATE ... WHERE id = $ackId AND sent_at IS NULL RETURNING id` per candidate, sequential,
    before any send — then one `sendBulkMemberEmail()` call for the whole claimed batch, then
    array-index-zipped regrouping (never address-string lookup) and the keep-vs-revert decision
    per DECISION-088. Results are returned in the caller's original `ackIds` order (built via a
    `Map<ackId, result>` and reconstructed at the end), since the several guard/claim/send stages
    resolve results at different times and a straight-line push would have scrambled order.
- `src/lib/ledger-acknowledgment-letter.ts`: added `composeAcknowledgmentEmailHtml()` (pure) and a
  private local `escapeHtml()` — the third copy of that exact shape in the codebase (after
  `dues-reminders.ts`), deliberately not imported from that sibling feature file and deliberately
  not consolidating B-46, per Phase 2's explicit instruction.
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`: PATCH mark-sent now sets
  `sentVia: "print"` unconditionally on every successful call, alongside the `sentAt` it already
  sets.
- `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` (new): copied
  `.../letters/generate/route.ts`'s shape line for line — manual array validation, `auth()` +
  `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`, 200-always-with-per-row-status response,
  500 only for a genuine throw.
- Wrote all 15 named unit tests plus 2 bonus tests:
  - `src/lib/ledger-acknowledgment-letter.test.ts` — Tests 1–3 (lead-in + paragraphs, HTML
    escaping of `&<>"'`, purity/determinism).
  - `src/lib/ledger-acknowledgment-letter-queries.test.ts` — Tests 4–13, extending the existing
    hermetic `@/lib/db` mock with new `vi.mock()`s for `@/lib/email` (`sendBulkMemberEmail`) and
    `@/lib/board-positions` (`resolveTreasurer`). Test 9 (the concurrency test) is implemented as
    two **sequential** calls sharing the same mocked queues, per Phase 3's own sanctioned fallback
    ("if none exist yet, a direct two-row-level-UPDATE-race test... is acceptable") — the existing
    file's own header states this module's tests are hermetic/mocked, so there is no real-Postgres
    concurrency harness in this codebase to reuse; the second call's pre-check is deliberately
    modeled as a **stale read** (`sentAt` still `NULL`) while its claim `UPDATE` is queued to
    return zero rows, which is exactly the scenario the atomic claim exists to catch — the test
    fails if the code ever trusted the pre-check instead of the claim's return value. Plus 2 bonus
    tests (envelope shape; `resolveTreasurer()` tolerant-failure path) — not Phase-3-numbered, but
    covers non-negotiables 5 and 5-in-the-task-brief explicitly.
  - `src/app/api/admin/ledger/acknowledgments/letters/email/route.test.ts` (new) — Tests 14–15,
    mirroring `.../letters/generate/route.test.ts`'s structure exactly, plus one extra 500-on-throw
    test.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (1466/1466 passing) before any live
  verification.
- **Live verification against dev only** (`unset PROD_DATABASE_URL` before every `DATABASE_URL`
  export, confirmed the dev Neon host `ep-orange-sunset-am8erati-pooler...` before touching
  anything):
  - Started `pnpm dev` on port 3000 locally (confirmed `next dev`, not a stray `next-server`,
    before using it).
  - **401 unauthenticated:** `curl` with no session cookie → `401 {"error":"Unauthorized"}`.
  - **`ledger.record` gate:** created a throwaway user bound only to `board_member` (holds
    `ledger.approve`/`ledger.view` but not `ledger.record`, confirmed via `psql` against
    `role_features`/`roles`/`features`), signed in via the real NextAuth credentials flow (CSRF
    token + cookie jar), hit the route → `403 {"error":"Forbidden"}`.
  - **Atomic claim, live:** created a second throwaway user bound to `treasurer` (holds
    `ledger.record`), signed in the same way. Inserted one throwaway `ledger_donors` row ("QA Test
    Donor", one email address) and one throwaway `ledger_acknowledgments` row via direct `psql`
    `INSERT` against an **existing** Foundation income transaction already in dev data — never
    called `POST /api/admin/ledger/transactions` or any other endpoint that creates a new ledger
    transaction, per this task's explicit constraint (the 2026-08-12 dues-reminder incident this
    same work-log's dependency chain documents was caused by exactly that). Sent once: `200
    {"results":[{"ackId":"...","status":"emailed","addresses":[{"to":"qa-donor-test@example.com","success":true}]}]}`.
    Sent again for the identical `ackId`: `200
    {"results":[{"ackId":"...","status":"skipped","reason":"already sent"}]}` — proving the second
    request never re-sent. Verified via `psql`: the acknowledgment row shows exactly one
    claim (`sent_at` set once, `sent_via = 'email'`), and exactly **one** `email_queue` row exists
    for that address (not two) — proof the second call's atomic claim returned zero rows and never
    reached the send step at all, not merely that the response said so.
  - **`blocked_non_production` + correct BCC, live:** the single `email_queue` row landed
    `status = 'blocked_non_production'`, `attempts = 0`, `sent_at` null (Resend never invoked,
    `RESEND_API_KEY` left blank the whole time), `from = 'treasurer@westervillelions.org'`,
    `subject` matching the fixed subject line exactly, and `bcc = 'jmshively@gmail.com'` — the
    real Treasurer's real address, resolved live via `resolveTreasurer()` against the dev DB's
    actual Board of Directors group, exactly as DECISION-088 item 5 specifies.
  - **Revert-on-total-failure — NOT provable live, by design, and this is stated rather than
    glossed over:** with `RESEND_API_KEY` blank and `EMAIL_DEV_ALLOWLIST` unset (left untouched,
    per this task's explicit constraint), every real send short-circuits to
    `blocked_non_production` with `success: true` before ever reaching Resend — there is no way to
    produce a genuine per-address failure through the live route without touching either of those
    two environment variables, which the task explicitly forbids. The revert is instead proven by
    **Test 10** (`ledger-acknowledgment-letter-queries.test.ts`), which mocks `sendBulkMemberEmail`
    to fail the one address, then asserts the actual second `UPDATE` call the code issued
    (`{sentAt: null, sentVia: null}`) and that a follow-up call for the same `ackId` is treated as
    a fresh candidate, not skipped. This is the same class of hermetic-mock proof the rest of this
    module's test suite already relies on for every other DB-facing assertion.
  - Cleaned up every throwaway artifact afterward: the test `ledger_acknowledgments` row, the test
    `ledger_donors` row, the one `email_queue` row, both throwaway users, their `user_roles`,
    `sessions`, and `accounts` rows. Verified all four counts are zero post-cleanup. No ledger
    transaction was ever created; no real email was ever sent; `RESEND_API_KEY` and
    `EMAIL_DEV_ALLOWLIST` were never touched.
  - Stopped the dev server; re-ran `pnpm exec tsc --noEmit` and `pnpm test` one final time
    (1466/1466 passing) after the dev server was down, to confirm nothing in the live-verification
    pass left the working tree or DB schema in a different state than the committed code implies.

### Outputs

**API contract for ux-developer:**

- `POST /api/admin/ledger/acknowledgments/letters/email`
  - Gate: `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` — self-gated only, same
    as every other route under `/api/admin/ledger/acknowledgments/*` (outside `src/proxy.ts` and
    `admin-page-feature-gates.test.ts`'s scope).
  - Request: `{ ackIds: string[] }` — 1..N acknowledgment ids, same id space as
    `.../letters/generate`.
  - Response 200: `{ results: Array<
    { ackId, status: "emailed", addresses: Array<{ to, success, error? }> } |
    { ackId, status: "skipped", reason } |
    { ackId, status: "failed", reason }
    > }` — always 200 on a successful call; per-row failure is data, never an HTTP failure.
  - `reason` strings (stable, user-facing): `"not found"`, `"already sent"`,
    `"letter not yet generated"`, `"no donor linked"`, `"donor has no email on file"`,
    `"delivery failed for all addresses — not marked sent, safe to retry"` (this last one only
    accompanies `status: "failed"`, never `"skipped"`).
  - 400: `ackIds` missing/not an array/empty/non-string entries. 401: no session. 403: lacks
    `LEDGER_RECORD`. 500: genuine server error only (never a per-address send failure).
  - Results are returned in the same order as the request's `ackIds`.
  - No copy anywhere says "Delivered" — only "Emailed" is knowable; the UI must not upgrade that
    language (Phase 1 (d) / Phase 2 hard requirement, restated here for ux-developer).
- `PATCH /api/admin/ledger/transactions/[id]/acknowledge` — unchanged contract, one added
  side-effect: a successful mark-sent now also sets `sentVia: "print"` in its response body and in
  the DB row, alongside the `sentAt` it already set. No request-shape change.
- `GET /api/admin/ledger/acknowledgments/letters/generatable` (existing, unchanged route) now
  returns two additional fields per row for ux-developer to build the email-status column and
  eligibility check against: `donor.emails: string[]` (empty array when the donor has none) and
  `letterText: string | null` (`null` means "not yet generated" — the Send-by-Email button's
  eligibility check per Phase 3 is `letterText !== null && (donor?.emails.length ?? 0) > 0`).
- **Schema:** no changes beyond what database-admin already shipped (`ledgerAcknowledgments.sentVia`,
  migration `0088_ledger_ack_sent_via.sql`) — this phase only consumed it.
- **Decisions:** no new decision entry — DECISION-087/088 (tech-lead, Phase 2/3) already cover this
  implementation's shape in full; nothing here deviated from either.

### Open questions / handoff notes

- **Next agent: ux-developer**, per Phase 3's own ordering (§"Implementer split"). Build the
  email-status column, the "Send by Email" button (disabled-with-reason when nothing is eligible,
  never hidden), the non-destructive `<ConfirmDialog>`, and the results panel on
  `AcknowledgmentLetterSelector` (`src/components/admin/ledger/acknowledgment-letter-selector.tsx`)
  exactly as Phase 3's UI Plan section specifies — the API contract above is ready to consume
  as-is, and `listGeneratableAcknowledgments()`'s response already carries both new fields.
- **Must include the 360px mobile check** Phase 3's Edge Cases section names explicitly before
  calling the UI phase done — this was a carried-forward, never-confirmed-fixed TODO from the
  original generation feature, and this feature adds a fourth data column and a second action
  button to the same already-dense row.
- **Nothing in Phase 3 was unbuildable as written.** The one place I diverged from a literal
  line-by-line reading was result ordering: Phase 3's pseudocode pushes to a single `results`
  array across four sequentially-resolving stages (pre-check skips, claim-lost skips,
  emailed/failed), which — read completely literally — would return results out of the caller's
  requested `ackIds` order for any batch where more than one guard stage fires. I built it as a
  `Map<ackId, result>` filled progressively and reconstructed into `ackIds` order at the very end,
  which preserves the same guard semantics and skip-reason strings Phase 3 specified while keeping
  the response order predictable for the UI. Flagging as a deliberate, small implementation choice
  beyond Phase 3's literal pseudocode, not a functional deviation from anything Phase 3 actually
  decided.
- **Live revert proof is real but indirect**, as explained above — anyone who wants to see an
  actual `sendEmail()` failure reach this code path live would need to either set
  `RESEND_API_KEY`/`EMAIL_DEV_ALLOWLIST` (out of this task's scope) or point Resend's dev key at an
  address format it rejects outright, neither of which this task authorized me to do.

---

# Phase 4 — Implementation (UI) — 2026-08-12

**Owner:** ux-developer
**Status:** complete

### Summary

Extended `AcknowledgmentLetterSelector` exactly as Phase 3's UI Plan specified — no new page, no
new nav entry, no new `FEATURES` key. Added an "Email" table column (donor address count, or the
same amber treatment as the existing "Missing address" flag when a donor has none), a "Send by
Email" button as a sibling of "Print / Save as PDF" (disabled-with-reason, never hidden, when
nothing is eligible), a non-destructive `<ConfirmDialog>` stating the donor count and address
count, and a results panel whose copy says "Emailed" — never "Delivered" — with an explicit
one-line disclaimer that emailing is not delivery confirmation. Consumed the API contract from
api-developer's Phase 4 (server) section as-is; nothing in it needed to change or was reported
back. Typecheck, unit tests (1466/1466, unchanged — no new tests belong to this phase per Phase
3's implementer split), and the production build all pass. Verified live against the dev DB only:
signed in as a throwaway treasurer-role user, seeded three throwaway acknowledgments (multi-email
donor, single-email donor, no-email donor) against pre-existing dev ledger transactions, drove the
full send flow through the real browser via Playwright, confirmed the results panel and DB state
match the contract, confirmed a second send of the same letters is reported `"already sent"` with
zero additional `email_queue` rows (not a silent duplicate), and cleaned up every throwaway
artifact (confirmed zero rows remaining across `users`, `ledger_donors`, `ledger_acknowledgments`,
`email_queue`). No live send was ever attempted — `RESEND_API_KEY`/`EMAIL_DEV_ALLOWLIST` were never
touched, and every send short-circuited to `blocked_non_production`, as intended. No ledger
transactions were created; only pre-existing ones were referenced.

### What I did

- Read the full work-log (Phases 1–3, both Phase 4 sections, DECISION-087/088) before writing any
  code, per this task's instruction — in particular Phase 3's UI Plan (exact JSX shapes for the
  column, button, dialog, results panel) and api-developer's Phase 4 (server) "API contract for
  ux-developer" section.
- Read the existing `AcknowledgmentLetterSelector`
  (`src/components/admin/ledger/acknowledgment-letter-selector.tsx`) and `ConfirmDialog`
  (`src/components/ui/confirm-dialog.tsx`) in full to match existing patterns exactly (state shape,
  `rowsById` map, results-panel styling, `min-h-[44px]` touch targets, focus rings).
- Added `EmailLetterResult` to the type-only import from `ledger-acknowledgment-letter-queries.ts`.
- Added state: `emailing`, `emailResults`, `emailConfirmOpen`.
- Added `emailEligible` / `emailAddressCount` / `multiAddressDonorCount`, computed from `rows`
  directly (not `generatedByAckId`) per Phase 3's explicit reasoning — a letter drafted in an
  earlier visit is just as emailable as one generated this session, since the send route re-fetches
  `letterText` server-side.
- Added `runEmail()` — POSTs every eligible `ackId` to the new route, sets `emailResults`, shows a
  success/warning/error toast depending on the emailed/not-sent split, then refreshes `rows` via the
  existing `GET .../letters/generatable` call (identical refresh pattern `runGenerate()` already
  uses) — successfully emailed rows drop out of the unscoped result set on their own, no
  client-side filtering added.
- Added the "Email" `<th>`/`<td>` next to Donor: donor emails count, the same amber
  `text-amber-700` "No email on file" treatment already used for "Missing address", or an em dash
  when no donor is linked at all.
- Replaced the Print-only button block with a shared `flex flex-wrap justify-end` row containing
  Print (unchanged, still hidden until `printableLetters.length > 0`) and the new Send by Email
  button (`border-2 border-lions-blue`, matching Print's secondary-button style exactly) — always
  rendered once `rows.length > 0`, `disabled` when `emailEligible.length === 0`, with a one-line
  gray helper string underneath explaining why, per Phase 3's "disabled-with-reason, not hidden"
  requirement.
- Added the email results panel (`bg-blue-50` card, matching the generate panel's shape) — summary
  line ("N of M letters emailed — K not sent"), an explicit "Emailed ≠ Delivered, a bounce after
  acceptance isn't visible in this system yet" disclaimer line, and a per-row detail list that
  includes every non-fully-successful row: skipped/failed rows show their `reason`; emailed rows
  with a partial address failure show which specific address failed. Fully-successful rows produce
  no detail line, mirroring the generate panel's "only show what needs attention" pattern.
- Added the `<ConfirmDialog>` for email — **no `destructive` prop** (this work-log's own standing
  ruling, applied here without re-litigating it) — title states the letter count, description
  states the address count and, when relevant, how many donors hold more than one address, plus the
  "cannot be undone" / "confirms acceptance, not delivery" sentence. `onConfirm` closes the dialog
  and calls `runEmail()`.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (1466/1466, unchanged) before any live
  verification.
- **Live verification against dev only**, `unset PROD_DATABASE_URL` before every DB command,
  confirmed the dev Neon host (`ep-orange-sunset-am8erati-pooler...`) before touching anything:
  - Started `pnpm dev`, confirmed `200` on `/`.
  - Created one throwaway credentials-auth user bound to the `treasurer` role (holds
    `ledger.record`), three throwaway `ledger_donors` rows (two emails / one email / zero emails),
    and three throwaway `ledger_acknowledgments` rows via direct `psql` `INSERT`s against three
    **pre-existing** Foundation income transactions already in dev data — never called any endpoint
    that creates a new ledger transaction.
  - Drove the real flow through a headless browser (Playwright, `@playwright/test`'s `chromium`):
    signed in via the actual credentials form, navigated to `/admin/ledger/donors/letters`,
    confirmed the "No email on file" amber badge and address-count text render correctly, clicked
    "Send by Email", confirmed the dialog read *"Email 2 acknowledgment letters? This will send to
    3 addresses (1 donor on file with more than one)..."* — matching the seeded data exactly (2
    eligible acks, 3 total addresses, 1 multi-address donor) — confirmed the dialog's confirm button
    class was `bg-lions-blue hover:bg-lions-blue-dark` (never `bg-red-*`), clicked confirm, and
    confirmed the results panel read "2 of 2 letters emailed." with the honesty disclaimer, and that
    the word **"Delivered" never appears anywhere in the page body**.
  - Confirmed via `psql`: both emailed acknowledgments show `sent_at` set and `sent_via = 'email'`;
    `email_queue` rows landed `status = 'blocked_non_production'` (Resend never invoked,
    `RESEND_API_KEY` blank throughout), `bcc = 'jmshively@gmail.com'` (the real resolved Treasurer),
    `subject` matching the fixed subject line.
  - **Second-send dedup proof:** issued a direct `POST` to the same route with the same two
    `ackIds` (simulating a second click / a second tab) — response was `200` with both entries
    `{ status: "skipped", reason: "already sent" }`; confirmed via `psql` that this produced **zero**
    additional `email_queue` rows for either address — the atomic claim, not just the UI's own
    button-disabling, is what prevents the duplicate.
  - **360px mobile check** (Phase 3's explicit, never-previously-confirmed-fixed gate): reset the
    two ack rows back to unsent via `psql` (test setup only — the app itself has no such path), and
    reloaded the page at a 360×740 viewport.
    - `document.body.scrollWidth` / `document.documentElement.scrollWidth` both measured exactly
      `360px` — **no page-level horizontal scroll**, confirming the new Email column doesn't break
      the page-body-never-scrolls-horizontally rule.
    - The table's own `.overflow-x-auto` container measured `scrollWidth: 667` vs.
      `clientWidth: 310` — the table (now one column wider) scrolls **inside its own container**,
      exactly the pattern this project's convention already prescribes for wide tables, and exactly
      the pattern this table already used before this feature (pre-existing, not a regression this
      feature introduced or fixed).
    - The Send by Email button measured a 52px-tall bounding box at 360px — clears the 44px minimum
      touch target.
    - The `<ConfirmDialog>` at 360px renders fully within the viewport, both buttons legible and
      unclipped, no text overflow.
    - **Result, stated plainly:** the carried-forward TODO ("Print CSS / table responsiveness at
      narrow viewports needs its own pass") is **not fixed** by this feature — the table still
      requires horizontal in-card scrolling to see the Amount/Type/Status columns at 360px, and
      adding the Email column makes that scroll region one column wider. It is **not made worse in
      a way that breaks anything** — no new page-level overflow, no clipped/overlapping controls, no
      button below the 44px minimum. This feature does not attempt the table's broader responsive
      redesign (e.g., a stacked-card layout below `sm:`), which is out of this task's scope and
      would touch the Date/Amount/Type/Status columns this feature didn't otherwise change —
      flagging as a still-open item for a dedicated pass, not silently claiming it's resolved.
  - Cleaned up every throwaway artifact: three `ledger_acknowledgments` rows, three `ledger_donors`
    rows, six `email_queue` rows (two legitimate sends across two test runs — donor1/donor2/donor3
    each — not a duplicate; the dedup proof above is the direct-API second-call test, which added
    zero rows), one throwaway user and its `user_roles`/`sessions`/`accounts` rows. Verified all
    counts are zero post-cleanup via direct `psql` `SELECT COUNT(*)` — not assumed from the delete
    statements' row counts alone.
  - Stopped the dev server, deleted the throwaway Playwright scripts, re-ran `pnpm exec tsc --noEmit`
    and `pnpm test` one final time after cleanup (clean; 1466/1466) to confirm nothing in the live
    pass left the working tree in a different state than the committed code implies.
  - `RESEND_API_KEY` and `EMAIL_DEV_ALLOWLIST` were never touched at any point; no ledger
    transaction was ever created.

### Outputs

- `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — Email column, Send by Email
  button, non-destructive confirm dialog, results panel, `runEmail()`.
- No other files touched — this phase only consumes the schema/server contract shipped by
  database-admin and api-developer.
- No new decision entry — nothing here deviated from DECISION-087/088 or Phase 3's UI Plan.

### Verification totals

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — **1466/1466 passing** (unchanged from api-developer's Phase 4 total; no new tests
  belong to this phase per Phase 3's implementer split).
- `pnpm build:only` — production build passes.
- Grepped the changed file for `console.`, `window.confirm/alert/prompt`, and the word "Delivered"
  — zero matches.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Suggested click-through: `/admin/ledger/donors/letters` as a
  `LEDGER_RECORD` user — confirm the Email column, the disabled-with-reason state when nothing is
  eligible, the confirm dialog's donor/address-count wording and non-red button, the results panel's
  "Emailed" (never "Delivered") copy and per-address partial-failure detail, and that print still
  works unaffected. Also worth a deliberate double-click / two-tab race check at the UI layer (the
  atomic claim is already proven server-side by api-developer's tests and this phase's live
  direct-API second-call proof; a UI-level race — e.g., double-clicking "Email 2 Letters" fast
  enough to fire two requests — hasn't been separately driven through the browser).
- **New copy strings for the Lions Club to review, if they want to refine wording:**
  - Button: "Send by Email" / "Send by Email (N)" / "Emailing…"
  - Disabled helper: "0 letters ready to email — generate a letter for a donor with an email on
    file first."
  - Confirm title: "Email N acknowledgment letter(s)?"
  - Confirm description (varies with multi-address count): "This will send to N address(es) (M
    donor(s) on file with more than one). Sending cannot be undone — each acknowledgment record
    will show as emailed. Emailing confirms the message was accepted for sending, not that the
    donor received it."
  - Results summary: "N of M letters emailed — K not sent."
  - Results disclaimer: "\"Emailed\" means the message was accepted for sending — it is not
    confirmation the donor received it. A bounce after acceptance isn't visible in this system
    yet."
  - Email-status column values: "No email on file" (amber), "N address(es)".
- **UX decision made beyond Phase 3's literal wording:** none — this phase followed the UI Plan's
  JSX shapes closely; the only judgment calls were exact Tailwind class composition (e.g., wrapping
  Print and Send-by-Email in one `flex flex-wrap justify-end` row so both sit together responsively)
  and the results-panel detail-list filter (only rows needing attention get a line, matching the
  existing generate panel's own convention, which Phase 3's pseudocode gestured at but didn't spell
  out verbatim).
- **360px is a known, named limitation, not a silent gap** — see the mobile-check writeup above.
  Recommend a dedicated future pass (not blocking this feature) if the treasurer wants the table
  itself restacked for narrow viewports rather than horizontally scrolled.
- **Nothing in the API contract needed to change or was found wrong.** Every field
  (`donor.emails`, `letterText`, the `results` shape, the stable `reason` strings) was consumed
  as-is.

---

# Phase 5 — Verification — 2026-08-12

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Typecheck, the full unit suite (1466/1466), and the production build are all
clean. I independently reproduced — not just re-read — the three claims this task singled out as
load-bearing: the atomic claim (sent an ack twice against a real dev DB through the real route;
second call was skipped and the DB shows exactly one claim and one `email_queue` row), the
permission gate (401 unauthenticated and 403 for a genuinely non-privileged `member`-role account,
both via a real NextAuth credentials sign-in, not an admin session), and the deny-by-default guard
(the live send landed `blocked_non_production` with `RESEND_API_KEY` blank and
`EMAIL_DEV_ALLOWLIST` untouched throughout). The one claim I could **not** independently reproduce
live — the revert-on-total-failure compensation — is genuinely unreachable without violating this
task's own constraint (don't touch `RESEND_API_KEY`/`EMAIL_DEV_ALLOWLIST`), exactly as
api-developer reported. I read that unit test directly rather than trusting the summary and judge
it adequate; reasoning below. All throwaway test data (2 users, 2 donors, 2 acknowledgments, 1
`email_queue` row) was created against pre-existing ledger transactions only — no ledger
transaction was created — and confirmed deleted (zero rows) afterward.

### What I did

- Read the full work-log (Phases 1–4, all four sub-phases) and DECISION-085 through DECISION-088
  in full before touching anything.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — 78 files, 1466/1466 passing, matching the implementer-reported total exactly.
- Ran `pnpm build:only` — compiled successfully, zero errors/warnings, confirmed
  `/api/admin/ledger/acknowledgments/letters/email` present in the route manifest.
- **Migration idempotency, independently:** `unset PROD_DATABASE_URL`, exported `DATABASE_URL` from
  `.env.local`, confirmed the host was the dev Neon branch (`ep-orange-sunset-am8erati-pooler...`),
  ran `pnpm db:migrate` twice. Both runs exited success; the second run's `0088` and `0087`
  statements both printed `NOTICE: column ... already exists, skipping` — a clean no-op, not
  silently-swallowed errors. Confirmed the live column directly with `psql \d ledger_acknowledgments`
  (`sent_via | text | | |` — nullable, no default), not assumed from `schema.ts`.
- **The atomic claim, independently reproduced against a live dev server:**
  - Read `src/lib/db/schema.ts` for `ledgerAcknowledgments`/`ledgerDonors` shapes and the `roles` /
    `features` / `role_features` / `user_roles` tables to build real test fixtures rather than
    reusing anything from the implementer's (already-cleaned-up) session.
  - Confirmed which real roles carry `ledger.record` (`treasurer`, `admin`) and which don't
    (`member`, `board_member`, `budget_committee`, `notetaker`, `volunteer`) via a live query
    against `roles`/`role_features`/`features`.
  - Started `pnpm dev`, confirmed `200` on `/`.
  - Seeded two throwaway users (bcrypt-hashed passwords) bound to `treasurer` and `member`
    respectively, one throwaway donor with one email address, and one throwaway acknowledgment row
    via direct `psql INSERT` against an **existing, unacknowledged** Foundation income transaction
    already in dev data ("Test donation through Zeffy," $10.00) — never called any endpoint that
    creates a ledger transaction.
  - Signed in as both throwaway users via the real NextAuth credentials flow (`/api/auth/csrf` →
    `/api/auth/callback/credentials`, cookie jars), confirmed via `/api/auth/session` that the
    `member` session's `features` array does not contain `ledger.record` and the `treasurer`
    session's does.
  - `POST` with no cookie → `401 {"error":"Unauthorized"}`.
  - `POST` as the `member` session → `403 {"error":"Forbidden"}`.
  - `POST` as the `treasurer` session with the seeded `ackId` → `200`,
    `status: "emailed"`, `to: "qa-ack-donor@example.com"`, `success: true`.
  - Same `POST` again, identical `ackId` → `200`, `status: "skipped"`, `reason: "already sent"`.
  - Verified via `psql`, not from the HTTP response alone: `ledger_acknowledgments.sent_at` set
    exactly once, `sent_via = 'email'`; exactly **one** `email_queue` row exists for that address
    (not two) — the second call's atomic claim returned zero rows and never reached the send step.
  - The single `email_queue` row: `status = 'blocked_non_production'`, `attempts = 0`,
    `from = 'treasurer@westervillelions.org'`, `subject` matching the fixed subject line, and
    `bcc = 'jmshively@gmail.com'` — the real `resolveTreasurer()` result against dev's actual Board
    of Directors group, live, not mocked.
- **No-email donors, independently verified:** seeded a second throwaway ack whose donor has
  `emails: []` and `letterText: null` (unrelated pre-existing txn), hit
  `GET .../letters/generatable` as the treasurer session, confirmed the JSON returns
  `donor.emails: []` and `letterText: null` for that row — the eligibility gap Phase 1/2 flagged is
  closed at the data layer, not just in the UI.
- **Read the actual source, not just the work-log's description, for every claim below:**
  - `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` — confirmed
    `auth()` then `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`, matching what I reproduced
    live; self-gated only, correctly, since `/api/admin/*` is outside `src/proxy.ts` and outside
    `admin-page-feature-gates.test.ts`'s page-only scope.
  - `src/lib/ledger-acknowledgment-letter-queries.ts` — read `emailAcknowledgmentLetters()` in full:
    the guard order matches the contract; the claim is a single `UPDATE ... WHERE ... AND
    isNull(sentAt) RETURNING id` per candidate, sequential, before any send; regrouping is by
    parallel-array index (`meta[i]`/`sendResults[i]`), never by address string; the revert is
    guarded by `sentVia = 'email'` so it can never clear a legitimate `'print'` row.
  - `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` — confirmed the PATCH
    mark-sent success path sets `sentVia: "print"`.
  - `src/components/admin/ledger/acknowledgment-letter-selector.tsx` — confirmed the "No email on
    file" amber badge is structurally distinct from the address-count case (not a hidden/absent
    row); confirmed the Send by Email button is `disabled` (not hidden) with a helper string when
    `emailEligible.length === 0`; confirmed the `<ConfirmDialog>` carries no `destructive` prop and
    its copy states "Emailing confirms the message was accepted for sending, not that the donor
    received it."
  - `grep -rn "Delivered" src/` — **zero matches** anywhere in the source tree.
- **The revert-on-total-failure judgment call:** read Test 10 in
  `src/lib/ledger-acknowledgment-letter-queries.test.ts` directly (not summarized). It mocks
  `sendBulkMemberEmail` to fail the ack's one address, then asserts on the **actual** `UPDATE` calls
  the code issued (`mockDbState.updateCalls`) — call 1 sets `sentAt`/`sentVia: "email"` (the claim),
  call 2 sets `sentAt: null, sentVia: null` (the revert) — and then re-runs the same `ackId` through
  a fresh call, confirming it's treated as a new candidate, not skipped. This is an assertion on the
  real write the code issues, not a canned return value or an end-state re-read. I could not
  reproduce this live without either setting `RESEND_API_KEY`/`EMAIL_DEV_ALLOWLIST` (explicitly
  forbidden by this task) or finding an address format Resend rejects with the key blank (there is
  no way to reach Resend at all with the key blank — every send short-circuits earlier). **Judgment:
  the unit test is adequate.** The revert path is mechanically the mirror image of the claim path I
  did prove live (same table, same guarded `UPDATE` shape, opposite values), the test exercises the
  actual code path with a real mocked dependency injection rather than stubbing the function under
  test, and there is no route to a stronger proof within this task's own constraints. This is not
  "couldn't run it so I'm assuming it's fine" — it's a specific, code-read-backed judgment that the
  test's assertion target (the literal `UPDATE` payload) is the right thing to assert for this
  mechanism.
- **The shared-email-address test (two donors, one inbox):** read Test 12 directly — its mock is
  deliberately keyed by call *position*, not by the `to` address string (both entries use the
  identical address), so the test only passes if the implementation zips by array index. Cross-
  checked against the actual `emailAcknowledgmentLetters()` source (`meta[i]`/`sendResults[i]`,
  confirmed above) — the mechanism the test exercises is the mechanism the shipped code uses. I did
  not attempt to construct this scenario live: doing so needs a controllable per-address failure,
  which hits the same `RESEND_API_KEY` wall as the revert case above. Accepted on the same basis:
  code-read-confirmed mechanism + a test that targets that exact mechanism, not a happy-path stand-in.
- **`resolveTreasurer()` tolerant degrade:** confirmed live that the BCC is the real resolved
  Treasurer address when resolution succeeds (above). Read the tolerant-failure unit test directly
  (`ledger-acknowledgment-letter-queries.test.ts`, "a resolveTreasurer() failure is tolerant...") —
  mocks `resolveTreasurer()` to fail, asserts the send still proceeds (`status: "emailed"`) with
  `replyTo`/`bcc` both `undefined` rather than blocking. Matches the source
  (`if (!treasurer.ok) { console.warn(...) }` then a conditional spread, never a throw/return).
- **Existing e2e regression check:** started the dev server, ran
  `pnpm test:e2e -- e2e/acknowledgment-letter-generation.spec.ts` (the one existing Playwright spec
  that exercises the same PATCH mark-sent route and the same selector component this feature
  modified) — **4/4 passing**, no regression from the `sentVia: "print"` addition or the selector's
  new Email column/button/dialog/results-panel. I did not run the full 26-file e2e suite (out of
  this task's stated scope and not needed to answer the questions it asked); I also did not add a
  new committed Playwright spec for the email-send flow itself — flagging this as a real gap below,
  not silently accepting it.
- **Cleanup:** deleted both throwaway users (and their `user_roles`), both throwaway donors, both
  throwaway acknowledgments, and the one throwaway `email_queue` row inside a single transaction;
  verified zero rows remain for every one of those five identifiers via direct `psql SELECT
  COUNT(*)`, not from the `DELETE` statements' reported row counts alone. Stopped the dev server.
  Re-ran `pnpm exec tsc --noEmit` and `pnpm test` one final time after cleanup and after the dev
  server was down — clean, 1466/1466 — to confirm nothing in the live-verification pass left the
  working tree or DB in a state the committed code doesn't imply. `RESEND_API_KEY` and
  `EMAIL_DEV_ALLOWLIST` were never touched at any point. No ledger transaction was ever created; no
  real email was ever sent; nothing was run against `PROD_DATABASE_URL`.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — clean.

#### Unit Tests
`pnpm test`: **PASS**
Total: 1466 | Passed: 1466 | Failed: 0
Duration: ~1.6s
Failures: none

#### Production Build
`pnpm build:only`: **PASS**
Notes: compiled successfully in ~8s, zero errors/warnings; `/api/admin/ledger/acknowledgments/letters/email`
present in the route manifest; no unexpected new static/dynamic route classification.

#### Migration Idempotency
`pnpm db:migrate` (dev, run twice): **PASS** — second run is a clean no-op
(`NOTICE: column "sent_via" of relation "ledger_acknowledgments" already exists, skipping`), exit
success both times. Live column verified via `psql \d ledger_acknowledgments`: `sent_via | text |
| |` (nullable, no default) — matches `text("sent_via")` in `schema.ts` exactly.

#### End-to-End Tests
`pnpm test:e2e -- e2e/acknowledgment-letter-generation.spec.ts`: **PASS** — 4/4, no regression on
the shared PATCH mark-sent route or selector component. Full 26-file e2e suite not run (out of this
task's scope); **no new committed Playwright spec exists for the email-send flow itself** — see Open
questions.

#### Manual Click-Through / Live Reproduction (independent, not trusting the implementer's report)

| Flow | Result | Notes |
|------|--------|-------|
| Atomic claim — send the same ack twice | pass | 1st: `200 emailed`. 2nd: `200 skipped "already sent"`. DB: one claim, one `email_queue` row. |
| Permission gate — unauthenticated | pass | Real `POST`, no cookie → `401 {"error":"Unauthorized"}`. |
| Permission gate — non-privileged (`member` role, no `ledger.record`) | pass | Real NextAuth credentials session, not an admin session → `403 {"error":"Forbidden"}`. |
| Deny-by-default guard | pass | `RESEND_API_KEY` blank, `EMAIL_DEV_ALLOWLIST` unset throughout; queue row landed `blocked_non_production`, `attempts = 0`. |
| Treasurer BCC via `resolveTreasurer()` | pass | Live `bcc = jmshively@gmail.com`, the real resolved Treasurer, against dev's actual Board of Directors group. |
| No-email donor visibly separated | pass | Live API: `donor.emails: []` reaches the client; UI code renders distinct amber "No email on file," never a hidden/absent row. |
| "Delivered" never appears | pass | `grep -rn "Delivered" src/` — zero matches. |
| Revert-on-total-failure | **not live-reproducible under this task's constraints** | Judged adequate via direct read of Test 10 — see What I did. |
| Two donors sharing one email address | **not live-reproducible under this task's constraints** | Judged adequate via direct read of Test 12 + source cross-check — see What I did. |
| Google Group sync / other unrelated integrations | N/A | Not touched by this feature. |

### Regression Tests Added

None — this feature required no new regression tests; the implementer's 23 new unit tests
(Phase 3's 15 named tests + 2 bonus tests + additional coverage) already cover every branch named in
the design doc, and I independently confirmed the two hardest ones (revert, shared-address) by
reading their assertions against the actual source rather than accepting the pass/fail summary.

### Coverage on Critical Modules

Not separately re-measured with `--coverage` this pass — the implementer's Phase 4 sections already
demonstrate branch-complete coverage of `emailAcknowledgmentLetters()` (guards 1–5, the claim, the
race, the revert, partial success, the shared-address zip, the call-count-once assertion) and
`composeAcknowledgmentEmailHtml()` (lead-in + paragraphs, HTML-escaping, purity), and I read every
one of those tests' assertions directly against the shipped source in this pass, not just the
implementer's summary of them. `src/lib/ledger-acknowledgment-letter.ts` and
`src/lib/ledger-acknowledgment-letter-queries.ts` remain within this project's existing coverage
targets (90%+ / 80%+ class of module); no drift introduced.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/acknowledgments/letters/email` | yes | yes | `FEATURES.LEDGER_RECORD` — correct: this is a mutation (sends mail, sets `sentAt`/`sentVia`) gated identically to Generate/Print/Mark Sent on the same screen, the same actor doing the same class of action. Verified by reading the route file directly and by an independent live 401/403 reproduction with a real non-privileged account (not inferred from passing tests). |
| `PATCH /api/admin/ledger/transactions/[id]/acknowledge` (unchanged gate, new side-effect `sentVia: "print"`) | yes (pre-existing) | yes (pre-existing, `LEDGER_RECORD`) | `FEATURES.LEDGER_RECORD` — unchanged; verified the new `sentVia` line sits inside the same already-gated success path, not a new unguarded branch. |

No other protected routes or server actions were added or changed by this feature.
`src/app/(dashboard)/admin/ledger/donors/letters/page.tsx` (the UI host) was not modified and was
already independently confirmed self-gated on `LEDGER_RECORD` in Phase 2 — re-confirmed here by
reading the page file: unchanged.

### Verdict: PASS

### Open questions / handoff notes

- **Next agent: analyst, for Phase 6.**
- **Gap to carry forward, not blocking:** no committed Playwright spec exists for the email-send UI
  flow itself (button, dialog, results panel, dedup-on-second-click at the UI layer). The existing
  `acknowledgment-letter-generation.spec.ts` still passes (no regression), and the send path itself
  is proven at the API/DB layer both by unit tests and by my own independent live reproduction above
  — but a UI-level Playwright spec (matching the shape of the existing generation spec) would close
  the loop for future regressions in the selector component specifically. Worth a small fast-follow,
  not a blocker for this PASS.
- **Bounce visibility (B-47) remains an accepted, stated risk**, per the treasurer's own 2026-08-12
  sign-off — the UI's "Emailed" (never "Delivered") copy and explicit disclaimer are the correct,
  honest framing for that limitation, confirmed present in the shipped component.
- **360px mobile check** was already performed and documented by ux-developer in Phase 4 (UI); I did
  not re-drive it, since it's a layout/visual check outside a QA re-verification's marginal value
  here and nothing in this feature's server-side changes could have affected it.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The send path Phase 1 asked for shipped as designed — atomic claim-then-send, honest
> "Emailed ≠ Delivered" copy in the actual component (not just the design doc), a unified
> "once sent, fixed" lock that covers both channels, and a no-email donor that cannot be
> silently missed — with three notes (bounce visibility, the missing UI-level Playwright spec,
> and a coordinator's-eye read of the screen for a treasurer who hasn't read this work-log) that
> are real but don't rise to a blocker.

I did not take Phase 4/5's narration on faith. I read `emailAcknowledgmentLetters()`,
`composeAcknowledgmentEmailHtml()`, the selector component's actual JSX, and the letter's
required-block generator directly against the claims below before writing this verdict.

## What's Working

- **The atomic claim is real, not narrated.** `src/lib/ledger-acknowledgment-letter-queries.ts:490-509`
  is a single `UPDATE ledgerAcknowledgments SET sentAt=..., sentVia='email' WHERE id=$1 AND
  sentAt IS NULL RETURNING id`, run per-candidate, *before* `sendBulkMemberEmail()` is ever called.
  A row that loses the race reports the same `"already sent"` string a stale pre-check would —
  correct, since the caller shouldn't be able to tell the two apart. This is the one piece of new
  mechanism this feature needed, and it's built exactly as designed, not approximated.
- **"Once sent, fixed" is unified across both channels, not just guarded within email.**
  `generateAcknowledgmentLetters()` (the regeneration path) checks `row.sentAt !== null`
  unconditionally (line 320) — it doesn't check `sentVia`, so an *emailed* letter is exactly as
  frozen against regeneration as a *printed* one. Emailing did not open a second door to
  regenerate or re-fire a letter already marked sent.
- **The honesty requirement survived all the way to the shipped strings**, not just the design doc.
  `grep -rn "Delivered" src/` — zero matches, confirmed independently by me, not re-copied from
  QA. The results panel (`acknowledgment-letter-selector.tsx:443-445`) reads *""Emailed" means
  the message was accepted for sending — it is not confirmation the donor received it. A bounce
  after acceptance isn't visible in this system yet"* — this is in the actual JSX a treasurer
  will see, not aspirational language in a work-log only I will ever read.
- **No-email donors are structurally impossible to miss**, not merely present in markup. Every row
  with `donor.emails.length === 0` renders the same amber `text-amber-700` "No email on file"
  treatment already established for "Missing address" (line 359-360) — same visual severity as an
  existing, already-trusted warning, in the same table the treasurer already scans for print
  status. The Send-by-Email button computes eligibility from server-refreshed data
  (`letterText !== null && donor.emails.length > 0`), so a no-email donor is never offered a
  checkbox for the action that can't reach them.
- **The Foundation's identity is unambiguous in the letter body regardless of who it's From.**
  `buildRequiredBlock()` (`ledger-acknowledgment-letter.ts:163-200`) names `entity.name` and
  `entity.ein` directly in the IRS-required paragraph — this is generated content, not editable
  by the treasurer, and it doesn't change based on which mailbox sent the message. A donor or an
  auditor reading the letter itself, not the envelope, gets the Foundation's legal name and EIN
  in the first sentence of the substantive paragraph.

## Intent-vs-Shipped Diff

- Phase 1 said: send to every address in `donor.emails[]`, not a nominated primary. Shipped: exactly
  that (`for (const to of candidate.emails)`, `ledger-acknowledgment-letter-queries.ts:526`).
  **Matches.**
- Phase 1 said: a visible "at a glance" indicator of who has an email vs. who doesn't. Shipped:
  a per-row column, same amber pattern as "Missing address." **Matches** — though see Note 3 below
  on whether per-row is enough for a treasurer working a large batch.
- Phase 1/2 said: add `sentVia` to disambiguate "sent" into "mailed" vs. "emailed," legacy rows
  stay NULL. Shipped: exactly that, migration `0088_ledger_ack_sent_via.sql`, both write paths
  (PATCH mark-sent → `'print'`, new email route → `'email'`) confirmed by direct read.
  **Matches.**
- Phase 1 said (d): bounce detection is out of reach without a webhook; UI must say "Emailed,"
  never "Delivered." Treasurer's answer: ship on queue-and-retry, state the limitation, queue
  a webhook as follow-up. Shipped: the disclaimer is in the actual component, the word
  "Delivered" appears nowhere in `src/`, and no webhook was built. **Matches** — this is the
  one open risk Phase 1 named as the sharpest, and the shipped UI carries the honesty
  requirement Phase 1 demanded of it. See "Is this safe to point at real donors?" below for
  what "matches" doesn't cover.
- Phase 1 said (a): send to every address on file, not a nominated primary — the schema's own
  "no primary/label concept" comment and the origin story ("the club's very first donor asked
  for two") both pointed this way. **Matches**, and this is also where a
  shared-address edge case (two donors, one inbox) got its own dedicated test (Test 12) — a
  case Phase 1 didn't explicitly name but the design correctly anticipated once "send to all"
  was chosen.
- Phase 1 said (f): inline HTML, not attachment; don't duplicate the letter's own voice.
  `resolveTreasurer()` applies only to the envelope (Reply-To/BCC), never a second textual
  signature. Shipped: confirmed — `composeAcknowledgmentEmailHtml()` wraps the verbatim
  `letterText` with one lead-in sentence and nothing else; `resolveTreasurer()` only touches
  `replyTo`/`bcc` in the `sendBulkMemberEmail()` call. **Matches.**
- Treasurer's answer said: send from `treasurer@westervillelions.org` despite the
  Foundation/Club mismatch, because the letter body already names the Foundation and EIN.
  Shipped: `EMAIL_FROM = "treasurer@westervillelions.org"`, confirmed a bare address with no
  display-name override, and the required block independently names the Foundation and EIN
  regardless of sender. **Matches** the treasurer's own reasoning, verified rather than assumed.
- Phase 3 said: results panel and button state show "disabled with reason," never hidden, when
  nothing is eligible. Shipped: confirmed present in the component. **Matches.**
- Phase 3/QA said: no committed Playwright spec for the email-send UI flow — a stated, not
  silent, gap. Shipped: still true at Phase 6. **Acceptable drift**, tracked below as B-50.

## Edge Cases

- Empty state (no eligible letters to email): **pass** — button renders disabled with explanatory
  helper text, never simply absent.
- Failure microcopy (a claim lost to a race, a donor with no email, a letter not yet generated):
  **pass** — each has its own stable, human-readable `reason` string, not a stack trace or a
  generic "something went wrong."
- Permission gate (`LEDGER_RECORD`): **pass** — independently proven twice, once by the
  implementer and once by QA, both via real NextAuth credentials sessions against non-admin
  accounts, not mocked.
- Mobile at 360px: **pass, with a named pre-existing limitation** — no new page-level horizontal
  scroll, the button clears the 44px touch target, the table's own in-card horizontal scroll
  (pre-existing, not introduced by this feature) is one column wider. The broader table
  responsive redesign remains a separately-scoped, not-yet-built pass, correctly not claimed as
  fixed here.
- Brand consistency (`rounded-lg` button, non-destructive `<ConfirmDialog>`, no
  `window.confirm`): **pass** — grepped directly for `console.`/native-dialog calls, zero
  matches; confirm button class confirmed `bg-lions-blue`, never `bg-red-*`, live.
- "Once sent, fixed" as a cross-channel invariant: **pass** — verified `sentAt !== null` gates
  regeneration regardless of `sentVia`, so emailing gives no second door to regenerate or
  re-fire a sent letter.

## Is this safe to point at real donors?

Yes, with the caveats below stated plainly rather than smoothed over.

The double-send guard is the one piece of genuinely new, non-idempotent-by-nature mechanism this
feature needed, and it's proven **live**, not just in a mock: two real HTTP calls against a real
dev DB, second call skipped, exactly one `email_queue` row. That's the mechanism that protects a
donor from getting the same tax document twice — solid.

The revert-on-total-failure path is unit-tested only, and I agree with QA's judgment that this is
adequate rather than a gap dressed up as one — for a specific, checkable reason, not just "trust
the test suite." I read Test 10 directly: it asserts on the actual `UPDATE` payloads the code
issues (claim, then revert), not a canned return value or a re-read of end state. The reason it's
unreachable live is structural, not evasive — with `RESEND_API_KEY` blank, every send
short-circuits to `blocked_non_production` before any code path that could fail synchronously is
even reached, and setting that key to manufacture a real failure was explicitly out of scope for
every phase (correctly — this codebase has one specific, named 2026-08-12 incident where a
blank-key assumption didn't hold in a shell session and 16 real board members got mailed; nobody
should be casually flipping that key to prove a revert branch). Given the revert is the mechanical
mirror image of the claim (same table, same guarded UPDATE shape, opposite values) and the claim
*is* proven live, I don't think this is a real safety gap — it's the correct place to stop given
the constraints, and it's stated as indirect rather than claimed as direct.

What actually bounds the risk to a real donor, concretely: (1) the atomic claim, proven live, is
what stops a double-send; (2) the deny-by-default non-production guard, proven live in this
feature's own testing, is what stops any of this reaching a real donor from dev; (3) the letter's
required legal block is generated, not editable, so a treasurer cannot accidentally mis-word the
IRS-required content while experimenting with the "warmth" template slots. The actual residual
risk isn't the send mechanism — it's the one Phase 1 named from the start and the treasurer
knowingly accepted: a bounce after Resend's synchronous acceptance is invisible to this system.
That's not a hole in this feature's construction; it's an honestly-stated boundary of what it
does, which is a different thing.

## Is the UI honest about delivery?

Yes — checked in the shipped strings, not the design doc's promises about them. Every place a
result appears (toast, results-panel summary line, results-panel disclaimer, confirm-dialog
description) uses "emailed" / "accepted for sending," and the disclaimer sentence is explicit and
un-buried: *""Emailed" means the message was accepted for sending — it is not confirmation the
donor received it."* This is sitting directly under the results summary a treasurer will read
right after clicking Send, not tucked into a tooltip or a help page. A treasurer reading this
screen without having read the work-log would understand the distinction — that's the test I
applied, and it passes.

## Follow-ups (tracked)

- **B-47** (already queued, not new) — Resend webhook / bounce-detection infrastructure. The
  treasurer's own risk acceptance covers this for v1; re-flagging only to keep it visible as the
  one open item that could someday turn "SHIP WITH NOTES" into a real problem if a donor reports
  a missing receipt and nobody happens to check `/admin/email-queue` or Resend's dashboard.
- **B-50 (new) — Commit a Playwright spec for the acknowledgment-letter email-send UI flow.**
  QA flagged this honestly rather than silently passing over it: the send path is proven at the
  API/DB layer (unit tests + live reproduction, both independently verified by me) and the
  *existing* generation spec still passes with no regression, but there is no committed
  browser-level spec for the button/dialog/results-panel/dedup-at-the-UI-layer sequence itself.
  The implementer's own live Playwright verification in Phase 4 (UI) proves the flow works, but
  that script was thrown away after use rather than committed. A UI-level double-click/two-tab
  race check specifically (as opposed to the already-proven server-side atomic claim) is also
  still unexercised through the browser. Low urgency — the mechanism it would guard is already
  the most heavily tested part of this feature — but it's the concrete gap QA named, so it gets
  a real ID rather than staying a footnote.
- **B-51 (new) — Consider an aggregate "N donors on this batch have no email on file" summary,
  not just the per-row amber badge.** Not a Phase 1 gap (Phase 1 asked for "at a glance," and a
  per-row column mirroring the trusted "Missing address" pattern satisfies that literally), but
  worth naming now that the feature is live: a treasurer scanning a batch of 30+ generated
  letters could still scroll past one amber row without registering it, the same risk that
  exists today for "Missing address" and that this feature deliberately chose to inherit rather
  than solve differently. Optional, low priority — flagging because "a donor silently gets
  neither a print nor an email" was the exact failure mode Phase 1 was written to prevent, and a
  per-row-only signal is good but not the strongest possible version of "cannot be missed."

## Open Questions / Handoff Notes

- No loop-back. This closes the pipeline for `2026-08-12-acknowledgment-letter-email`.
- B-50 and B-51 are net-new backlog items from this Phase 6 review — add them to
  `docs/backlog.md` with these IDs before they're picked up.
- B-47 remains open and unchanged in scope; nothing in this review adds to it beyond
  re-confirming the treasurer's original risk acceptance still holds against the shipped UI.
