# Meeting Minutes + Member Portal Restructure — Work Log

> **Slug:** `2026-08-08-meeting-minutes`
> **Surface:** member portal (new "Club Records" tile + IA restructure, minutes + a sibling Constitution & By-Laws page) and admin (minute authoring, `/admin/minutes`)
> **Permission(s):** new `notetaker` role; recommended new keys `minutes.manage` (create/edit/approve, any kind) and `minutes.delete` (soft-delete, admin-only). Reading any kind of minutes is ungated — any linked member, like `/members/financial-reports`. By-laws visibility (public vs. members-only) still open — see Phase 1 open question 8.
> **Estimated complexity:** large — new records, new role, IA restructure, search, attendance, plus a small sibling by-laws page
> **Pipeline mode:** Full — Phase 1 proposal revised three times per treasurer feedback (scope, then permissions/rich-content, then a documents-generalization reframe evaluated and declined for now, 2026-08-08); READY WITH NOTES, minutes unblocked for Phase 3/4, by-laws needs one small architect pass first

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete (revised twice per treasurer feedback; documents reframe evaluated 2026-08-08) | READY WITH NOTES | 2026-08-08 |
| 2 — Architectural review | architect | **needs re-ruling** — DECISION-074/075 stand for minutes unchanged, but the documents reframe below raises new questions (by-laws hosting/rehype-raw trust boundary, deferring a general documents system) the architect has not yet seen | Approved with suggestions (minutes only) | 2026-08-08 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## REVISION NOTE (2026-08-08)

The treasurer read the original proposal and responded. Six of his calls reshape this materially — logged here rather than as a second competing draft, per instruction. What changed, in order of impact:

1. **One table, `kind` open-ended** (not enum(general/board) — committee minutes and "likely others" anticipated).
2. **Board minutes are readable by any member.** The `minutes.board_view` gate I recommended (grounded in real research on how nonprofits conventionally restrict board minutes) is dropped. This is his call to make over my research-backed recommendation, and it's made — noted plainly below, not re-litigated.
3. **No quorum feature.** Attendance stays a fact-record; nothing computes whether a meeting was quorate.
4. **Tile renamed "Minutes", not "Meetings"** — Events already owns the schedule; Minutes shouldn't try to also own it.
5. **Authoring model resolved:** notetakers create; only the notetaker can edit; admin soft-deletes. I had to decide what "only the notetaker" means precisely — see below.
6. **Rich-paste research, done properly** — this turned out to be the load-bearing decision of the whole feature. Recommendation below, flagged for the architect's dependency gate.

Everything else from the original proposal (draft→approve cycle and why, attendance-as-distinct-from-RSVP, the IA move of Dues/Reimbursements into Profile, Club Finances hub, the `/admin` write / `/members` read split) survives untouched because nothing in his feedback contradicted it.

## REVISION NOTE 2 (2026-08-08): the documents reframe

After Phase 2 closed (DECISION-074) and its email-distribution addendum (DECISION-075), the treasurer supplied the club's Constitution & By-Laws and, in ADDENDUM 2 above, it was folded into the renamed Minutes tile as a hosted scan. He has now gone further: *"I think it could be treated like minutes. Seems like the whole minutes thing is just documents. Should have auditing and each document maybe should inherit different permission schemes."* Separately, the by-laws are now being transcribed to Markdown at `docs/club-constitution-and-bylaws.md` rather than hosted as a scan — superseding ADDENDUM 2's "host the scan as-is" call.

This is evaluated honestly below, not simply implemented. **My conclusion, stated up front: the instinct is right that minutes and governing documents are kin, but the correct generalization is at the browse/permission/audit *layer*, not the data model.** Minutes keeps the table already designed and architect-approved (DECISION-074/075), completely untouched. The by-laws get a new, much lighter path than a documents table — one that turns out to already have a precedent in this codebase. A general, admin-editable "documents" system is a real future need but not a real *present* one, and building it now against a corpus of exactly one document is the CMS trap the brief warned against by name.

## VERDICT

**READY WITH NOTES**, on both pieces. Minutes: unchanged, still ready for Phase 3/4 exactly as DECISION-074/075 left it — nothing here reopens that design. By-laws + the documents question: ready for a **small, targeted architect pass** (not a redesign) on the two things that are genuinely new — the by-laws hosting mechanism's trust-boundary reasoning, and confirmation of the "defer general documents system" call — flagged precisely below rather than left implicit.

## ONE-LINE TAKE

> One open-ended `minutes` table, readable by every member regardless of kind, writable only by notetakers (plus admin), pasted from Word and stored as Markdown through the same rehype-raw-free renderer the budget notes already use — no new rendering security surface, one new small dependency instead of a rich-text-editor framework. Governing documents (starting with the by-laws) ship alongside it as a *sibling*, not a *generalization* — same tile, different mechanism, because they're actually different things.

## The Documents Reframe — Evaluated

### The counter-case, stated first

Minutes carry real, load-bearing structure that a governing document does not: per-member attendance rows, motions with mover/seconder/vote, action items with owner and due date, a draft→approved lifecycle keyed to the *next* meeting's vote, an optional link to a scheduled event occurrence, and — as of DECISION-075 — kind-based email distribution to `board@`/`club@`. Every one of those is a real column or child table already ruled in DECISION-074.

The Constitution & By-Laws has none of that. What it has instead: an adoption date (in force from 21 November 1991), an amendment history (revised April 2, 1998, and presumably again whenever the board next votes to amend it), and a document body. A single generic model that tries to hold both ends up in one of two bad places: a pile of columns most rows leave null (`motions`/`attendees`/`approvedByUserId` null for the by-laws; `adoptedDate`/`amendmentOf` null for every minutes row), or a JSON detail blob that trades away exactly the query-ability and DECISION-041-style validated-text discipline this codebase has consistently chosen over blobs elsewhere. This app has already rejected the first shape once, explicitly: DECISION-072 turned down a documents-adjacent generalization for the same reason — "a bag of unrelated scalar knobs, wrong axis for structured content" — when it chose a real `ledgerLetterTemplates` table over a column bolted onto `ledgerSettings`. The same reasoning applies here, one level up.

### What generalization actually buys, checked against the real inventory

The club's real document inventory today is: minutes (recurring, ~30/year, high volume, structured, already fully modeled), **one** constitution/by-laws document (rare, amended by formal vote, last touched in 1998), and "plausibly a handful" of future policies/guides that don't exist yet. A general documents system earns its keep when there are enough genuinely-alike rows that a shared shape saves more than it costs. At an inventory of *one* non-minutes document, it doesn't — there's nothing to generalize *from* yet, only something to anticipate. Building a permission-scheme engine, a versioning mechanism, and a shared audit table for a corpus of one document is the CMS trap named in the brief: real engineering weight carried by zero rows.

### Recommended shape: sibling, not superclass — until a second real document shows up

**Minutes stays exactly as DECISION-074/075 already designed it.** No `kind` value on the `minutes` table ever means "constitution" or "policy." This is the one non-negotiable conclusion of the counter-case above.

**The by-laws ship via a mechanism this codebase already has, not a new one.** This is the actual finding of this revision, and it resolves several of the open questions at once — see "Files, storage, and the trust boundary" below.

**A general `governanceDocuments` registry table is the *right future shape when a second admin-authored document exists* — not now.** I'm pre-describing it so it isn't reinvented from scratch later (Phase 3/4 should treat this as documented intent, not a spec to build): a thin table holding only what's genuinely common — `id`, `kind` (DECISION-041-style, no CHECK), `title`, `visibility` (see below), `pendingDeleteAt`, timestamps — with each kind's real content in its own detail table or, for developer-authored text, a git-committed file. That's DECISION-065's own "generalize on second real need" discipline, already used twice in this codebase (the promoted Markdown renderer in DECISION-074, the audit table's own forward-compatible column design below) — applied here as a reason to *wait*, not a reason to build ahead of the need.

### Files, storage, and the trust boundary — the part that changes the answer

I checked the actual storage mechanism rather than assume one. Two findings, both material:

1. **The architect's DECISION-074 aside — "if pasted images are ever wanted, `@vercel/blob` with the `receipts/<uuid>/<filename>` pattern" — is not accurate against the current codebase and should be corrected, not carried forward.** `package.json` has no `@vercel/blob` dependency. Production file storage (`src/lib/receipt-storage/`) is a pluggable `ReceiptStorage` interface (`save`/`read`/`delete` by opaque key) with two real adapters: `DatabaseReceiptStorage` (Postgres `bytea`, table `ledger_receipt_files`, used when `NODE_ENV === "production"`) and `LocalReceiptStorage` (filesystem, dev/test). A `VercelBlobStorage` adapter is referenced only in a code comment as a *historical* option DECISION-040 moved away from. If a scanned file ever needs storing through the app, the real precedent to reuse is this interface's *shape* (pluggable, opaque-key, DB-backed in prod) — not a dependency that isn't in this project.
2. **The transcription changes the answer entirely, and for the better.** The treasurer is having the by-laws transcribed to `docs/club-constitution-and-bylaws.md` — a Markdown file, git-committed, in the same directory as `docs/release-notes/*.md`. That is not a "document needing blob storage" — it's **the exact same shape as release notes**, and this codebase already has a working, precedented pattern for exactly that: `ReleaseNotesViewer` (`src/components/admin/release-notes-viewer.tsx`) reads `.md` files from `docs/release-notes/` and renders them. Reusing that pattern for the by-laws means **no new table, no new storage adapter, no admin-form authoring path, and no new permission-scheme engine** — just a route and a viewer component.

   This also resolves a security question I would otherwise have had to raise: `ReleaseNotesViewer` is the **one place in this codebase that already enables `rehype-raw`** (line 6, `import rehypeRaw from "rehype-raw"`) — every other Markdown surface (budget notes, and by design, minutes) explicitly refuses it. That's not an inconsistency to flag; it's the correct call, because release notes are **developer/Claude-authored and git-reviewed**, not submitted through an admin web form — a fundamentally different trust boundary than "any admin can type into a textarea and it renders to every member." The by-laws transcription sits in exactly that same tier: a human (transcriber) produces it, a PR review (implicitly) checks it against the scan before it merges, and git history is the permanent record of every change. Treat it like release notes, not like minutes or budget notes.

   The scanned original (the actual 1998 PDF/images) is a separate artifact from the Markdown transcription — ADDENDUM 2's concern ("unambiguously authoritative... a transcription error is a real risk") still applies to *that* file, and a link to download/view the original scan should sit alongside the transcribed, readable version, not replace it. Where the scan itself lives (repo-committed binary vs. the receipt-storage pattern) is a small Phase 3 implementation call, not an architectural one — either works, since it's a single static file, not a growing corpus.

### Auditing — reuse the pattern, not the table, and this genuinely is DECISION-065's "second need"

`ledger_audit_log` already exists with exactly the right shape for this — and its own schema comment says so explicitly: "typed nullable FK columns per target kind... deliberately schema-generalized ahead of need: a future transaction/budget-audit increment adds `target_transaction_id`/`target_budget_id` to this SAME table via an additive `ALTER TABLE... ADD COLUMN IF NOT EXISTS` migration" (`src/lib/db/schema.ts:623-639`).

Two ways to read that precedent, and they point in different directions:
- **Literally reuse `ledger_audit_log`** by adding `targetMinutesId` — cheap, additive, exactly what the comment anticipates.
- **Don't** — because the comment's own stated future scope is "a transaction/budget-audit increment," i.e. more *Ledger* targets, and the architect's own DECISION-074 Ruling 2 already established (correctly) that minutes must not join the `ledger-*` module family: "minutes shares no tables, no permission keys, and no audience boundary with the Ledger; prefixing it `ledger-*`... would misrepresent it as a Ledger sub-feature." Bolting `targetMinutesId` onto a table literally named `ledger_audit_log` contradicts that ruling directly — the pattern is exactly right, the specific table is exactly wrong.

**Recommendation: extract the pattern into a new, domain-neutral `audit_log` table** (typed nullable FK per target kind, `before`/`after` JSON diffs, `details` free text, actor + timestamp) — its first two non-Ledger columns being `targetMinutesId` and (when it's built) `targetGovernanceDocumentId`. This is not new complexity invented for this feature; it's the same shape `ledger_audit_log` already has, given a name that doesn't lie about its scope, at the exact moment (a second, unrelated domain wanting identical audit machinery) this codebase's own DECISION-065 discipline says "generalize now." `ledger_audit_log` itself is untouched — existing category-audit code keeps working exactly as it does today.

For the by-laws specifically: no `audit_log` row needed at all in v1, because **git history already is the audit trail** — every commit to `docs/club-constitution-and-bylaws.md` is attributed, timestamped, diffed, and permanent, which is arguably a *better* audit record for a document amended by formal vote than an app-level log entry saying "content changed." The general `audit_log` table is for minutes (already required by DECISION-074's shape) and for whatever future admin-editable document arrives second.

### Permissions — "inherit different permission schemes," made precise

His word "inherit" points at the right primary mechanism: **kind sets a default, and it's expressible as a route, not necessarily a stored flag.** Concretely:

- **Minutes:** already fully resolved by the earlier revision — no read gate at all, any linked member, any kind. Unchanged.
- **The by-laws:** B-38 (`docs/backlog.md`) already named the open question this reframe makes unavoidable — **public, or members-only?** This is a materially bigger permission surface than minutes ever needed, because minutes were always inside `/members/*` (authenticated at minimum); "public" means *unauthenticated*. The cleanest way to express that in this codebase is by **route placement, not a new visibility column**: a public by-laws page is a public-site route (`/about/bylaws` or similar, alongside `/about`, `/mission` — no `auth()` check, matching that precedent exactly); a members-only by-laws page lives under `/members/...` and is auth-checked like every other page there. No new `FEATURES` key needed either way — this is a binary that already has two matching route precedents in the app, not a scheme that needs its own engine. **This is still an open question for the treasurer, not decided here** — see open questions below.
- **The future general documents system**, when it exists: per-kind default visibility (a small const map, same shape as `MINUTES_KINDS`/`MINUTES_KIND_EMAIL`) with an optional, admin-only, single-field **override** on the individual document row (nullable `visibilityOverride`, defaults to "use the kind's default"). Deliberately *not* a full ACL/permission-scheme object per document — that's the CMS-scale feature the brief warned against, and nothing in the club's real inventory justifies it yet. "Inherit, with an occasional named exception" is the right amount of mechanism; a permission engine is not.

### Versioning and amendment — one mechanism does not serve both, and that's fine

Minutes are approved once and then fixed — DECISION-074's `status: draft/approved` plus `pendingDeleteAt` already covers its entire history model; there is no "version 2 of last month's minutes." A constitution is different: it's amended by vote, and "the version in force on a given date" can genuinely matter (a dispute about club process might hinge on which bylaws text applied in 2015 vs. today). For the by-laws' current shape (one Markdown file, git-committed), **git history already provides exactly this** — `git log`/`git blame` on `docs/club-constitution-and-bylaws.md` answers "what did this say on date X" precisely, with zero new mechanism. If amendments ever need to be member-facing browsable *inside the app* (not just in git), that's a real future feature — an `amendedAt`/`inForceFrom` pair on a future `governanceDocuments` detail row — but it's not needed to ship the by-laws now, and building it for a document that has been amended once in 28 years is exactly the kind of anticipatory engineering this revision is arguing against elsewhere.

## Research grounding (cited, not invented)

- **Retention is permanent, not "keep a while."** IRS guidance treats board minutes as core corporate/policy records to be kept forever, and most state nonprofit-corporation statutes agree — this is a database-plus-backups problem, not a UI feature, but it means "delete a minutes record" should not be a normal admin action the way deleting a stale event is. [LegalClarity — IRS Rules, Content, and Retention](https://legalclarity.org/nonprofit-board-minutes-irs-rules-content-and-retention/)
- **The draft→approve cycle is real and it is "first order of business."** Minutes are drafts until formally approved — conventionally at the *next* meeting, before anything else happens — which is exactly why the treasurer wants "the current meeting to link to last meeting's minutes": that link is the approval agenda item. This part of the research is unaffected by his feedback and still shapes the design below. [IdealsBoard — Nonprofit Board Meeting Minutes Requirements](https://idealsboard.com/blog/board-meetings/nonprofit-board-meeting-minutes-requirements/)
- **Quorum confirmation is why attendance is conventionally recorded** — it's what makes the votes in the minutes valid. Cited for completeness even though the club is explicitly not building quorum logic now (decision 3 below) — recording *who was present* still matters on its own, independent of computing whether that constituted a quorum. [MinuteSmith — Nonprofit Board Meeting Quorum Requirements](https://minutesmith.com/blog/nonprofit-board-meeting-quorum-requirements)
- ~~Board minutes are conventionally more restricted than general-membership minutes~~ — **superseded.** This was real research (nonprofits aren't legally required to publish board minutes, and many boards treat them as board-only per [OnBoard](https://www.onboardmeetings.com/blog/are-nonprofit-board-meeting-minutes-public/) and [BoardSource](https://boardsource.org/resources/executive-sessions/)), but it was common-practice guidance, not a hard legal requirement, and the treasurer has explicitly overridden it: **any member can read board minutes.** Not re-litigated below.
- **What effective minutes capture, at minimum:** date/time/location, who was present/absent, approval of the prior minutes, every motion with who moved/seconded and the vote result, action items with a named owner and due date, and time of adjournment. Still the structural spine proposed below, minus quorum computation. [Boardable — Nonprofit Board Meeting Minutes Template & Guide](https://boardable.com/resources/board-meeting-minutes/)
- **Word's clipboard HTML is a known, well-documented mess** — `mso-*` conditional styles, font tags, deeply nested spans carrying inline styles, and lists rendered as plain paragraphs with a literal bullet character plus `mso-list` metadata rather than real `<ul>/<li>` markup. This is exactly why dedicated tooling exists for it (see the rich-content section below) rather than "just paste it and store the HTML." [Tiptap — Paste Handler extension](https://tiptap.dev/docs/editor/extensions/functionality/paste-handler)
- **Sanitizing untrusted HTML before rendering it to other users is the standard 2026 posture** for any app that stores rich text — DOMPurify (client) / `sanitize-html` (server) with a strict tag/attribute allowlist, plus CSP as a second layer. This is the baseline Option A (a rich-text editor storing HTML) would need to meet. [pkgpulse — sanitize-html vs DOMPurify vs xss](https://www.pkgpulse.com/guides/sanitize-html-vs-dompurify-vs-xss-xss-prevention-2026)

## Verified ground truth (beyond what you gave me)

- The 8-tile grid is real: `src/app/members/page.tsx` lines 156-213 — Member Directory, Events, Groups, Profile, My Dues, My Reimbursements, Our Impact, Financial Statements.
- `boardMinute` is free text in exactly 3 places, confirmed: `ledgerTransactions.boardMinute` (schema.ts:773, set on disbursement approval), `ledgerBudgetApprovals.boardMinute` (schema.ts:976, set on budget lock), `ledgerReimbursements.boardMinute` (schema.ts:1193, required on reimbursement approval).
- `events` already has full recurrence columns (`isRecurring`, `recurrenceType`, `recurrenceDays`, `recurrenceEndDate`, schema.ts:204-207) **and** the admin event form already has working UI for all of them (`src/components/admin/event-form.tsx:392-420`). Making "Lions Club Meeting" and "Board Meeting" genuinely recurring is a **data fix an admin makes through existing UI**, not new code — but it's a hard prerequisite: nothing downstream ("default to next meeting") works while these are one-off events.
- Roles today: `admin`, `board_member`, `treasurer`, `member`, `volunteer`, `budget_committee` (the last one is real in the DB per `drizzle/migrations/0069_ledger_budget_permissions.sql` but isn't in the `ROLES` const in `src/lib/permissions.ts` — a pre-existing drift, not something I'm introducing). No `secretary` role exists; "Secretary" today is a free-text `members.boardPosition` value, not a system role.
- There is an established **read-tile-is-member-portal / write-is-admin** split already in this codebase: `dues.view` → `/members/dues` (read, self-service) vs. `dues.manage` → `/admin/dues` (write, all members); `ledger.record`/`ledger.manage`/`ledger.approve` all live under `/admin/ledger/*`. Minutes follows the same split rather than inventing a new pattern.
- `/members/dues` and `/members/reimbursements` are **already ungated beyond `auth()`** — no `FEATURES` check, same as `/members/financial-reports`'s "any linked member" pattern. That matters for the IA move: folding them into Profile doesn't change who can see them, it's a pure layout change.
- **`DECISION-041` precedent, confirmed exact:** `docs/decisions.md:996` — "no DB-level CHECK constraint... application-level enforcement only." This pattern already governs `ledger_transactions.status`, `ledger_budget_lines.cause` (validated against a `BUDGET_CAUSES` const array in `src/lib/ledger.ts`, not a DB enum), and several others. `kind` on minutes should follow this exactly: `text`, no CHECK, validated against a maintained list.
- **`pendingDeleteAt` precedent, read in full** (`ledgerBudgets`/`ledgerBudgetLines`, schema.ts:898/943): nullable timestamp, flag-flip only, restorable — but its purge trigger is "**purged in the same transaction as Approve & lock**," a budget-specific finalize event. Minutes has no equivalent batch-finalize moment, and per the retention research above, minutes shouldn't auto-purge at all. The *column shape* is reusable; the *purge behavior* is not — see decision 5 below.
- **No author-locked precedent exists in this codebase to copy.** The closest analog, `WithdrawButton` in `src/components/members/reimbursement-form.tsx:251`, lets a member DELETE their *own* submitted reimbursement via a member-facing route — that's a submitter withdrawing their own request, a different authority model from "only I may edit this system record." Every actual write-permission in this codebase (`LEDGER_RECORD`, `DUES_MANAGE`, `GROUPS_MANAGE`, etc.) is role-based: any holder can act on any row, not just their own.
- **The existing safe-rendering precedent is exactly on-target:** `src/components/admin/ledger/budget-notes-markdown.tsx` renders Markdown via `react-markdown` + `remark-gfm` with an explicit, commented decision to never enable `rehype-raw` — "Notes are admin-authored, but there's no reason to let arbitrary HTML into a document that also gets handed to the board." It already supports headings, bold/italic, links, ordered/unordered lists, tables, blockquotes, and code — i.e., almost exactly the shape a minutes body needs. `src/components/markdown-content.tsx` is a second, simpler sibling of the same pattern. Both dependencies (`react-markdown`, `remark-gfm`) are already in `package.json`.
- The existing ledger search (`src/lib/ledger-search-queries.ts`, `/admin/ledger/search`) is admin-only, single-audience. Since board minutes are now readable by every member (decision 2), the cross-audience search-leak risk I originally flagged for the adversarial pass **no longer applies** — noted, not re-built-around.

## Information Architecture — revised: "Minutes", not "Meetings"

The treasurer is right to question a "Meetings" hub: **Events already owns the schedule.** A tile called "Meetings" invites scope creep into RSVP/calendar territory Events already covers well, and it muddies what the tile is actually for. Renaming it **"Minutes"** is the correct fix, and it clarifies the tile's job precisely: Minutes owns the *record of what happened*, and only borrows a read-only pointer into Events for "what's next."

That doesn't remove the "defaults to the next meeting" / "links to last meeting's minutes" requirement — it just relocates it honestly. The Minutes landing page still opens on the next scheduled meeting occurrence (read from Events, not duplicated) with a prominent link to the most recent approved minutes — that behavior was never really a "Meetings hub" feature, it was always a Minutes feature that happened to need a peek at the calendar.

Everything else from the original IA proposal holds:

**Dues/Reimbursements → Profile, as-is.** Both already ungated, self-service pages — pure declutter, zero permission change.

**Financial Reports + Impact → "Club Finances", as-is.** Unchanged by his feedback; still recommended for the same reason (both read-only, ungated-beyond-membership "here's the club's numbers" pages; `ADMIN_NAVIGATION`'s "Treasury" group is the existing precedent for one entry point fanning out to independently-gated sub-pages).

**Revised 6-tile grid** (replacing the 8 at `src/app/members/page.tsx`):

| # | Tile | Route | What changed |
|---|------|-------|--------------|
| 1 | Member Directory | `/members` (unchanged) | — |
| 2 | Events | `/members/events` (unchanged) | — |
| 3 | Groups | `/members/groups` (unchanged) | — |
| 4 | **Club Records** *(superseded name — see below)* | `/members/records` (**new**) | Minutes as the primary view, Constitution & By-Laws as a signposted sibling, search |
| 5 | Profile | `/members/profile` (extended) | Gains "My Dues" and "My Reimbursements" as sections/tabs, not standalone tiles |
| 6 | **Club Finances** | `/members/finances` (**new landing**) | Fans out to existing Financial Statements + Our Impact pages, unchanged underneath |

Minutes does **not** replace Events — Events stays the forward-looking RSVP/planning surface; Minutes is the backward-looking accountability + record surface, with a link back into the matching Events occurrence for anyone who wants to RSVP from there. Since board-kind minutes are now readable by anyone (decision 2), the tile is **ungated for reading, in full** — the only permission surface left on this tile is on the write side (and, per the by-laws visibility question below, possibly nowhere at all if the by-laws are public).

**Tile naming, resolved across three rounds:** this section originally proposed "Minutes"; ADDENDUM 2 (below) then folded governing documents in and floated "Club Records" or "Governance"; this revision adds the by-laws as a *sibling page*, not a merged data model, which doesn't change the naming question — a member still thinks of "old minutes" and "the bylaws" as one mental bucket ("club records"), even though they're built differently under the hood. **Recommendation: "Club Records"** over "Governance" — plainer, matches how a member would actually describe what they're looking for, and doesn't presuppose the tile becomes a larger policy library it may never become. Route: `/members/records`. Landing view defaults to the Minutes experience already designed above (next-meeting pointer, kind filter, search) as the primary content, since minutes are the high-frequency content (~30/year) against one static reference document; the Constitution & By-Laws is a clearly labeled secondary link/card ("Looking for the club's governing documents?"), not one row in a symmetric "documents" list. This is a naming/UI call, not load-bearing — either name works, and it's listed as open question 7 below rather than declared final.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | Open the Minutes tile, see the next scheduled meeting's date/time/location | Per visit |
| Signed-in member | Click through from "next meeting" to the prior meeting's approved minutes | Occasional (usually right before attending) |
| Signed-in member | Read **any** minutes record, any kind — general, board, committee, or future kinds — attendees, motions, action items, discussion | On demand |
| Signed-in member | Filter/browse minutes by kind (Board / General / a specific committee) | Occasional |
| Signed-in member | Search minutes by keyword | Occasional |
| Signed-in member | Land on "Club Finances", choose Financial Statements or Impact | Per visit |
| Signed-in member | Manage Dues/Reimbursements from within Profile instead of a separate tile | Per visit |
| Signed-in member (`notetaker` role, or admin) | Create a new minutes record for a meeting occurrence: mark attendance, add motions, add action items, paste/write discussion notes | Per meeting (weekly/monthly) |
| Signed-in member (`notetaker` role, or admin) | Edit any existing minutes record (draft or approved-then-reopened) — not restricted to the record's original author | Per meeting cycle |
| Signed-in member (`notetaker` role, or admin) | Mark a draft "Approved" at/after the next meeting's vote; reopen an approved record for correction | Per meeting cycle |
| Admin only | Soft-delete a minutes record; restore a soft-deleted record | Rare |
| Admin | Grant the `notetaker` role to a user (existing role-assignment UI) | Rare — onboarding a new secretary or a stand-in |
| Admin | Mark the "Lions Club Meeting" and "Board Meeting" events as recurring with the real cadence (existing event-form UI) | One-time setup |

## Flows

**Flow 1 — Member checks the next meeting and reads last time's minutes:**
`/members` → click "Minutes" tile → `/members/minutes` defaults to the next upcoming occurrence of the club's recurring meeting event (same next-occurrence resolution the Events page already does) → page shows date/time/location plus a "Read [date]'s minutes" link to the most recent **approved** minutes of the matching kind → click through → minutes page (attendees, motions, action items, rendered discussion body). A kind filter/tab strip lets the member browse Board, General, or any committee's minutes archive directly, and a search box sits above it.
- Failure: no recurring meeting series configured yet (or `recurrenceEndDate` has lapsed) → empty state ("No upcoming meeting is scheduled — check back soon"), not a crash on a null next-occurrence query. No minutes posted yet on a fresh install → "No meeting minutes have been posted yet."

**Flow 2 — Notetaker creates minutes after a meeting:**
`/admin/minutes` (new admin section, mirroring `/admin/dues` and `/admin/ledger`) → "New Minutes" → pick kind (from the maintained list — General, Board, or a committee) and the meeting occurrence it's tied to (defaulted to the most recent past occurrence of that kind with no minutes yet, optional/nullable if there's no matching event) → mark each relevant member present or absent (roster checklist, optionally pre-filled from that occurrence's RSVPs as a starting point — RSVP is intent, this list is fact) → add motions (text, mover, seconder, result) and action items (text, owner, due date) as needed → paste discussion notes from Word, or type Markdown directly → Save Draft. `authorUserId` is stamped automatically from the session for attribution.
- Failure: saving with zero attendees marked present is blocked with a clear message ("Mark at least one attendee before saving"). Motions/action items may be empty — not every meeting has either. Pasting from Word that yields garbled or unexpected output — see the rich-content section below for the mitigation (a live preview pane, so the notetaker sees exactly what members will see before saving). Two notetakers editing the same record simultaneously — not handled (last write wins), named as a gap below, acceptable for this club's traffic.

**Flow 3 — Editing and approving:**
Any `notetaker`-role holder (or admin) can open **any** minutes record — draft or approved — and edit it; this is not locked to the record's original author (see decision 5 below for why). At the next meeting, the vote to approve happens live, in the room, under Roberts Rules — the app doesn't run that vote. Afterward, a notetaker opens the draft → "Approve" → `status: approved`, `approvedByUserId`/`approvedAt` set, and — mirroring the existing `ledgerBudgetApprovals` lock pattern — the record becomes read-only. Editing an approved record requires an explicit "Reopen for correction" action, through `<ConfirmDialog>` (never a native confirm), same as every other state-changing admin action in this codebase.
- Failure: someone without `minutes.manage` hits the edit/approve endpoint directly → 403/redirect, same as any other permission-gated server action.

**Flow 4 — Admin soft-deletes a record:**
`/admin/minutes` → a record's row menu → "Delete" (admin-only; a notetaker who is not an admin does not see this action) → `<ConfirmDialog>`, destructive styling → `pendingDeleteAt` set → record disappears from every member-facing and admin list query, but stays in the database (no purge — see decision 5). Admin can restore from a "Deleted" filter.
- Failure: a notetaker attempts the delete route directly (no UI entry point, but the route itself must still check) → 403.

**Flow 5 — Search:**
Search box on `/members/minutes` → matches title, discussion body, motion text, action-item text, and attendee names ("did I attend the March meeting?") across **every** kind, since read access is universal now — no per-result permission filtering needed. Deliberately does **not** share code or a route with `/admin/ledger/search` (different audience — member portal vs. admin-only — and different data), even though the original cross-audience leak concern no longer applies.
- Failure: no matches → "No minutes match '\<query\>'", not a blank page.

## Permissions — simplified

Dropping `minutes.board_view` and collapsing record/approve into one key, now that edit authority is role-wide rather than split by action:

| Key | Gates | Default roles |
|-----|-------|----------------|
| `minutes.manage` (new) | Create, edit (any kind, any status), approve, reopen | `admin`, `notetaker` (new role) |
| `minutes.delete` (new) | Soft-delete / restore | `admin` only |
| — (no key) | Read **any** minutes record, any kind, any status | any linked member (mirrors `/members/financial-reports`) |

This is a real simplification from the original 3-key proposal: reading is now completely ungated (no `minutes.board_view` at all), and writing collapses from a record/approve split down to one `minutes.manage` key, since "only the notetaker can edit" doesn't leave room for a separate approve-only tier. Deletion stays a distinct, narrower key bound only to `admin` — matching the existing `MEMBERS_VIEW`/`MEMBERS_EDIT`/`MEMBERS_DELETE` escalating-triad naming precedent already in `src/lib/permissions.ts`, adapted here to two tiers since there's no separate "view" gate to escalate from.

New role: `notetaker` — bound to `minutes.manage` by default (not `minutes.delete`; deletion stays admin-only per his explicit instruction). Not auto-derived from `members.boardPosition = 'Secretary'`; admin grants it manually, same as every other role today (open question 2).

## Decision — "only the notetaker can edit": role-wide, not author-locked

His words support either reading, so I picked one and I'm stating the reasoning plainly rather than silently choosing:

**Recommendation: role-wide.** "Only the notetaker" means *only users holding the `notetaker` role* (plus admin) may edit — **not** only the specific person who authored a given record. Any `notetaker` can edit any minutes record.

Why, concretely — each of these is a real scenario for a volunteer club with turnover, and a strict per-author lock breaks all three without an admin escape hatch:
- **The author leaves the club** before the next meeting's approval vote. A hard author-lock means the record becomes uneditable by anyone but an admin performing a manual override — worse, if admin has no edit path at all (only delete), it's stuck.
- **The author is unavailable** right before approval and a typo or missing action item needs fixing. Role-wide editing lets any other notetaker fix it same-day; author-locked editing means it waits, possibly past the approval meeting.
- **A second notetaker covers a meeting** the regular secretary missed — his own scenario, stated directly in his feedback ("meetings happen when the secretary is absent"). That second notetaker needs to be able to pick up and finish a record, not just start a new one.

I still track `authorUserId` on every record (stamped at creation) so attribution is preserved — "Minutes recorded by Jane Doe" — which satisfies the *spirit* of "only the notetaker" (credit, accountability, knowing who wrote it) without the operational trap of a literal per-record lock. If he actually wants hard author-locking despite the above, it's buildable, but I'm recommending against it — flagged as open question 1.

## Decision — `kind` is open-ended text, no migration to add one

Per `DECISION-041`, `kind` is a plain `text` column with no DB `CHECK`/enum — same pattern as `ledger_budget_lines.cause`, which is validated against a `BUDGET_CAUSES` const array in `src/lib/ledger.ts`, not a database object.

**Recommendation for v1: a hardcoded const array** (e.g. `MINUTES_KINDS` in a shared lib file), seeded with `general` and `board` at minimum. Adding "Membership Committee" or "Program Committee" later is a one-line code change plus a deploy — no migration, matching every other DECISION-041-governed field in this codebase.

The honest tradeoff: he said "we might even have other types... likely others," which signals the list could grow at a cadence a hardcoded array doesn't serve well (each new kind needs a developer). The alternative — a small admin-editable lookup table (same shape as `glasses_dropoff_locations`/`plastic_dropoff_locations`, which are already admin-CRUD-able lists) — would let him add "Fundraising Committee Minutes" himself with no deploy. I'm recommending the hardcoded array for v1 anyway: it's cheaper to ship, matches the existing DECISION-041 precedent exactly, and if new kinds turn out to arrive more than a couple of times a year, promoting it to a real lookup table is a clean, additive follow-up rather than something worth over-building against an unknown frequency today.

## Decision — rich content from Word: the load-bearing decision, researched properly

**The problem, stated precisely:** notetakers compose in Microsoft Word and paste into the app. Word's clipboard HTML is a well-documented mess — `mso-*` conditional-comment styles, font tags, deeply nested inline-styled spans, and lists that are visually bulleted but aren't real `<ul>/<li>` markup (Word fakes them with `mso-list` metadata and a literal bullet character). Whatever is stored has to be re-rendered faithfully to every other member, which makes this a stored-XSS surface the moment it's rendered back as HTML to someone other than the author.

**Two real options, weighed honestly:**

**Option A — Rich-text editor (TipTap/Lexical/Slate/Quill), stores HTML.** TipTap ships an official `PasteHandler` extension built specifically to clean Microsoft Word/Excel/Google Docs paste content automatically, no configuration required ([Tiptap — Paste Handler](https://tiptap.dev/docs/editor/extensions/functionality/paste-handler)). This gives notetakers a true WYSIWYG toolbar and generally the best paste-fidelity experience. But: it's a genuinely new, non-trivial dependency (ProseMirror core + several TipTap packages), it stores HTML, and storing HTML means the app now needs a real sanitization layer on top — `sanitize-html` (server) and/or DOMPurify (client), correctly configured with a strict allowlist and kept correct forever, before that HTML can ever be rendered to a second person ([pkgpulse — sanitize-html vs DOMPurify vs xss](https://www.pkgpulse.com/guides/sanitize-html-vs-dompurify-vs-xss-xss-prevention-2026)). It also opens a second "render user-authored rich text" code path in the app, alongside the existing Markdown-only one.

**Option B — Convert Word's pasted HTML to Markdown at paste time, store Markdown, render through the existing Markdown pipeline.** On paste, read `event.clipboardData.getData('text/html')` and run it client-side through **Turndown** (`turndown`, optionally `turndown-plugin-gfm` for tables) to get clean Markdown, dropped into a plain textarea the notetaker can review/hand-edit, with a live preview using a new `MinutesBodyMarkdown` component **cloned directly from `budget-notes-markdown.tsx`'s exact pattern** — same `react-markdown` + `remark-gfm`, same explicit refusal to enable `rehype-raw`. Both dependencies (`react-markdown`, `remark-gfm`) already exist in `package.json`; the only new dependency is `turndown` (+ its small GFM plugin).

**Recommendation: Option B.** Two reasons, one practical and one structural:
- **Practical:** it reuses the stack the project has already invested in and already blessed for exactly this purpose — rendering admin/notetaker-authored rich text to members, with a code comment on record explaining *why* raw HTML is refused. Cloning that component is a much smaller, better-precedented ask than introducing an editor framework.
- **Structural, and this is the part that actually matters:** Option B means there is **no HTML rendering path at all**, at any point, for minutes content — the browser converts pasted HTML to Markdown text before it's ever stored, and the render side only ever interprets Markdown through a renderer that has never executed raw HTML. That's a stronger security posture than "we sanitize the HTML," because it removes the question "did we sanitize correctly and will we keep sanitizing correctly forever" entirely, rather than answering it well. **Trusted user is not a security model** — even though notetakers are trusted-ish, a compromised account, an honest mistake, or Word itself embedding something odd in the clipboard payload could otherwise become stored, rendered content; Option B is safe by construction, independent of how much the notetaker is trusted, exactly the same reasoning already on record in `budget-notes-markdown.tsx`'s comment.

**Fidelity, stated honestly (Option B):** headings, bold/italic, real lists, links, and — with `turndown-plugin-gfm` — tables survive a Word paste reasonably well. Fonts, colors, images, Word's page layout/headers/footers, and track-changes markup do not, and are not recoverable. **Images specifically are a known gap**: Word often embeds pasted images as data the clipboard doesn't cleanly expose as a fetchable URL; this design does not attempt to auto-extract pasted images at MVP. If photo attachments are ever wanted, that's a separate, explicit attachment feature (reusing the existing `receipts/<uuid>/<filename>` storage-key pattern already used elsewhere), not something paste-conversion should try to solve. This tradeoff should be acceptable for meeting minutes specifically — the content that matters (what was discussed, decided, and assigned) is exactly the content Markdown preserves; the content that's lost (fonts, colors, letterhead) is exactly the content that doesn't matter for a governance record.

**This needs the architect's explicit ruling before Phase 3.** `turndown` (+ `turndown-plugin-gfm`) is a new dependency, and CLAUDE.md's dependency-evaluation gate applies. Flagging this explicitly rather than treating it as settled: this is, credibly, the first genuinely well-justified new-dependency case in a while for this project, and the architect should rule on Option A vs. B (or a third option neither of us has considered) with the full tradeoff above in view — not rubber-stamp my recommendation.

## Decision — soft-delete: reuse the column shape, not the purge behavior

`pendingDeleteAt` (nullable timestamp) is the right column to reuse from `ledgerBudgets`/`ledgerBudgetLines` — admin sets it, every default query filters `WHERE pending_delete_at IS NULL`, admin can restore by clearing it. What does **not** transfer is the *purge* behavior: budget rows are hard-deleted "in the same transaction as Approve & lock," a batch-finalize event minutes has no equivalent of. Given the retention research above (permanent record, kept forever), **minutes should never auto-purge.** A soft-deleted record stays in the database indefinitely, hidden from every read path, restorable by admin. A true hard-delete, if ever genuinely needed, is a separate, rare, manual-only action explicitly out of scope here — not something this feature should build a path for.

## Decision — no quorum, but leave room

No quorum threshold, no computed "quorum met" flag, no configuration for a threshold — confirmed, not building it. What I am keeping: the attendance data model is still a real per-member present/absent structure (not a single free-text "who was there" paragraph), so a future quorum feature could be computed against it without a schema change — it would just add a threshold source and a computed badge on top of data that already exists. That's the right amount of room to leave: don't build the feature, don't build around its absence either.

## Decision — scope and sequencing

Two real needs at two different urgencies, and they don't have to move together:

- **Minutes has a hard near-term deadline** (meetings starting September 3) and is already fully designed and architect-approved (DECISION-074/075). Ships on its existing schedule, untouched by any of this.
- **The by-laws have sat in a filing cabinet since 1998** — real, but not urgent in the same way, and now also gated on the transcription actually finishing. Because the recommended mechanism (git-committed Markdown + a `ReleaseNotesViewer`-style route) is small and independent of the minutes schema, it can ship **whenever the transcription is ready** — before, alongside, or after minutes — without blocking or being blocked by it. It does not need Phase 3/4's minutes implementation order to accommodate it.
- **The general documents system does not ship at all in this pass.** It's described above so it isn't reinvented from scratch, but nothing should be built against it now — no `governanceDocuments` table, no general `audit_log` table extraction, no per-document visibility override mechanism. Those get built when a second real admin-authored (not git-authored) document actually needs them.

## What the architect must re-rule

Stated explicitly, per the brief's ask, so this doesn't get missed in a long work-log: **DECISION-074 and DECISION-075 stand exactly as written for minutes — nothing here reopens them.** Two things from this revision have not yet had an architect pass and should before Phase 3/4 touches the by-laws:

1. **Confirm or reject the by-laws hosting mechanism** — git-committed Markdown under `docs/`, rendered via a route/component modeled on `ReleaseNotesViewer`, including that component's `rehype-raw` allowance being appropriate here on trust-boundary grounds (developer/git-authored, not admin-form-submitted). This is a security-adjacent call I'm recommending, not unilaterally blessing.
2. **Confirm or reject deferring the general documents system**, and if rejected, rule on the registry-table/visibility-override/general-`audit_log` shape described above rather than the narrower minutes-only shape DECISION-074 was scoped to.
3. **Correct the record on `@vercel/blob`** — DECISION-074 Ruling 1's aside about future pasted-image storage named a dependency (`@vercel/blob`) that isn't in `package.json`; the real precedent is the `ReceiptStorage` interface (Postgres `bytea` in production, local filesystem in dev). Doesn't change any ruling, but Phase 3/4 shouldn't go looking for a dependency that was never actually added.

## Gaps the Request Didn't Address

- **The meeting events aren't actually recurring yet.** "Default to the next meeting" is meaningless until "Lions Club Meeting" / "Board Meeting" are `isRecurring: true` with a real cadence. Operational fix through existing admin UI, but it blocks the whole feature if skipped — should be step zero of Phase 4.
- **Email isn't mentioned.** Recommend pull-only for MVP (matches `/members/financial-reports`, no email trigger). Confirm this is fine to skip — open question 4.
- **Google Group sync** — no touch point. Minutes don't change committee/group membership. Confirmed clean.
- **OAuth-vs-password / mobile** — neither flow diverges by sign-in method; the minutes UI (attendee checklist, motion list, action-item list) should use the same stacked-card responsive treatment used elsewhere below `sm`. No special risk identified, named per the standard pass rather than silently skipped.
- **Concurrent edits** — two notetakers (or a notetaker and admin) editing the same record at once isn't handled; last write wins. Low-traffic internal tool, probably acceptable, but worth a one-line note in the tech-lead's design doc.
- **What happens to `boardMinute` free text** — still explicitly not solving this now (Out of Scope), design should leave the door open (see below).
- **Committee-kind minutes and group linkage** — now that `kind` is open-ended and committee minutes are anticipated, should a committee-kind minutes record optionally link to the specific `groups` row (e.g., "Membership Committee") the way general/board minutes link to an event occurrence? Not requested explicitly, but implied by "committee minutes" existing as a kind at all — flagged as open question 5.

## Out of Scope (confirm with user)

- **Converting the three existing `boardMinute` free-text fields** (`ledgerTransactions`, `ledgerReimbursements`, `ledgerBudgetApprovals`) into real FKs against the new minutes table. Real records existing is the prerequisite, not part of this pass — but the minutes table's primary key should be stable/referenceable so that follow-up is a clean additive migration later (nullable `boardMinutesId` FK alongside the existing string), not a redesign.
- **E-signature / formal sign-off** of approved minutes beyond `approvedByUserId` + `approvedAt` — same digital-trail idiom the Ledger already uses; likely sufficient for a club this size.
- **Print/export of minutes.** Cheap to add later; not committing to it now.
- **Executive-session / redacted content within board minutes.** Moot now that board minutes are universally readable — not applicable to this design at all anymore, noted only for completeness.
- **Self-service attendance** (a member marking themselves present/absent). Not requested; I'd advise against it — attendance should be an authoritative notetaker action for the record, not a self-report.
- **Pasted-image extraction** from Word content. Explicitly not attempted at MVP — see the rich-content decision above.
- **Hard-delete / purge of minutes**, ever, as a normal feature. Soft-delete only; a true purge (if it's ever genuinely needed) is a separate rare manual action, not part of this design.
- **A general, admin-editable documents system** (registry table, per-document permission overrides, a generalized `audit_log` table). Explicitly deferred until a second real admin-authored (not git-authored) document exists — shape described above, nothing built now.
- **Member-facing browsable amendment history for the by-laws** (an in-app "what changed and when" view beyond git log). Git history already serves this for v1; a real in-app version needs a genuine document-versioning mechanism this pass isn't building.

## Open Questions

1. **Author-locked editing after all?** I'm recommending role-wide edit access (any `notetaker`) over strict per-author locking, for the reasons above. Override me if you actually want a hard per-author lock with an admin-only override path — it's buildable, I just don't recommend it.
2. **Should the `notetaker` role auto-follow `members.boardPosition = 'Secretary'`**, or is it fine for you to grant the role manually whenever you set someone's position to Secretary (same manual step as every other role today)?
3. **Kind taxonomy: hardcoded array (my v1 recommendation) or an admin-editable lookup table now?** I'm proposing the array to ship faster, with a promotion path later if new kinds arrive often — but if you already know you'll be adding committee kinds regularly (e.g., every time a new ad hoc committee forms), it may be worth building the self-service table now instead of twice.
4. **Should approving/posting minutes trigger any email/notification**, or stay pull-only like Financial Reports? Defaulted to pull-only above.
5. **Should a committee-kind minutes record optionally link to a `groups` row** (so "Membership Committee minutes" is tied to the actual Membership Committee group), the way general/board minutes link to an event occurrence? Not required to ship v1, but worth deciding before the data model is finalized in Phase 3.
6. **Print/export of approved minutes** — needed now, or fine to defer? (Retention is satisfied by the database + backups either way.)
7. **Tile name: "Club Records" (my recommendation) or "Governance"** (ADDENDUM 2's other option), or something else entirely? Not load-bearing, but worth settling once rather than drifting across a fourth round.
8. **By-laws visibility: public, or members-only?** B-38's own open question, now unavoidable rather than deferrable — the recommended mechanism (route placement: public-site route vs. `/members/...`) needs to know which before it can be built. Lions International's own constitution/by-laws are public and many clubs post theirs openly, which argues for public; the board may prefer members-only for a document that also names internal process detail. Your call, not mine to default.
9. **Is the transcription itself meant to become the authoritative text**, or does the scanned original remain authoritative with the Markdown as a readability aid only? Affects whether the by-laws page should visually foreground "official scan" or "official text," and whether future amendments get made by editing the Markdown directly (git-authored) or by a fresh scan-and-retranscribe cycle each time.
10. **Do you actually want the general documents system sketched above eventually**, or was "seems like the whole minutes thing is just documents" more a comment on this pass's UI (one tile, one mental bucket) than a request to build a second content-management layer? Either answer is fine — it changes what, if anything, Phase 3 should leave room for beyond what's already described.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The shape is sound and the analyst's research-backed calls (Option B for rich-paste, role-wide edit, `pendingDeleteAt`-shape-not-behavior reuse, no quorum) are correct and not being second-guessed. What follows are the specific structural rulings the brief asked for — real constraints, not optional polish, and Phase 3 must design against them rather than re-litigate them. Logged as **DECISION-074**.

## Ruling 1 — `turndown` is approved, client-only, single line-item

Assessed the no-dependency alternative honestly rather than rubber-stamping: hand-rolling a Word-HTML-to-Markdown converter means walking `DOMParser`-parsed clipboard HTML and re-implementing, from scratch, exactly what `turndown` already does — tag-to-Markdown-token mapping, whitespace/nesting normalization, and (this is the part that would actually hurt) redoing it *correctly* for Word's specific dirt (font/span soup, `mso-*` styles) with no test suite behind it. That's not a "no-dependency approach is basically free" situation — it's reimplementing a mature, narrowly-scoped library badly. Turndown fails all three of CLAUDE.md's dependency red flags in the *good* direction: not solved by anything already in `package.json` (no HTML→Markdown capability exists anywhere in the current dep set — `react-markdown`/`remark-gfm` only go the other direction), MIT-licensed and long-stable, and — the deciding factor — **client-only by construction** (it runs on the browser's `DOMParser`, so it cannot run in a route handler or server action even by accident; that's a real constraint on where the import is allowed to live, not just a nicety).

That client-only property changes the calculus materially, and I want it stated as a hard rule for Phase 3/4, not left implicit: **`turndown` (and `turndown-plugin-gfm`) may only be imported from a `"use client"` file** — the paste-handler inside the admin minutes editor. It never touches a server action, route handler, or the Edge runtime question CLAUDE.md's dependency criteria ask about (moot here — there's no Edge middleware in this project regardless). Bundle impact is real but contained: Next's per-route code-splitting means this dependency ships only in the chunk for the admin minutes create/edit page, never in the public-site or even the plain member-portal-read-side bundle — the bundle-size criterion that matters for public-facing first paint is untouched. **Approved.** One honest gap to flag, not a blocker: `turndown` alone does not specifically un-fake Word's `mso-list` pseudo-bullets (paragraphs styled to *look* like a list without real `<ul>/<li>` markup) — products that solve this well typically run a small Word-specific DOM pre-clean pass before handing HTML to Turndown. That pre-clean is *code*, not a dependency, and belongs in Phase 3's edge-cases list, not the dependency gate.

**Fidelity ruling:** concur exactly with the analyst — headings/bold/lists/links/tables survive, fonts/colors/images/layout don't, and that's the correct trade for a governance record where the content that matters (what was discussed, decided, assigned) is exactly what Markdown keeps. If pasted images are ever wanted, the mechanism is already in the dependency set — `@vercel/blob` with the same `receipts/<uuid>/<filename>` storage-key pattern reimbursements already use — so this doesn't change today's recommendation, it just confirms the future path doesn't need a new dependency either. Not scoping it in now, per the analyst's own Out-of-Scope call.

## Ruling 2 — module and component placement

**Query module: new top-level pair, not a `ledger-*` sibling.** The DECISION-049/062/065/069/072 lineage exists to split an already-oversized `ledger-queries.ts` (5,182 lines) or to keep a genuinely ledger-scoped concern out of it — neither applies here. Minutes shares no tables, no permission keys, and no audience boundary with the Ledger; prefixing it `ledger-*` or filing it next to ledger modules would misrepresent it as a Ledger sub-feature. Correct placement: **`src/lib/minutes.ts`** (pure — `MINUTES_KINDS` + validator following the `BUDGET_CAUSES`/`isValidBudgetCause()` shape exactly, per DECISION-041; status-transition helpers) and **`src/lib/minutes-queries.ts`** (DB reads/writes — CRUD, attendance/motions/action-items, `searchMinutes()`). This generalizes the Ledger's pure/DB split to a new domain without joining the Ledger's module family — the same split pattern `events.ts`/`members.ts` don't currently need (they're small enough to stay flat) but minutes, with attendance + motions + action items + search, is not.

**Search stays inside `minutes-queries.ts` — do not pre-emptively split out a `minutes-search-queries.ts`.** `ledger-search-queries.ts` was split out because `ledger-queries.ts` was already huge; `minutes-queries.ts` starts at zero, so the reason that pattern exists doesn't yet apply. Apply the *lineage's reasoning* (split when the parent gets oversized), not its literal shape, if this ever grows.

**Search implementation: `ILIKE`, no full-text index, no new index.** `ledger-search-queries.ts`'s own docblock already rules "sequential ILIKE scans are cheap at this club's data volume" at ledger-transaction volume; minutes at ~30 records/year is smaller still. A `tsvector`/GIN setup here would be premature. Confirmed separately from ledger search per the analyst's own reasoning (different audience, different data) — not joined, not shared.

**Markdown renderer: promote, don't clone.** Cloning `budget-notes-markdown.tsx` verbatim (as the Phase 1 doc proposed) creates two near-identical ~90-line renderers with two places to fix a bug or extend the element set — exactly the kind of quiet drift this review exists to catch, and there's already a live precedent for it: `markdown-content.tsx` and `budget-notes-markdown.tsx` are already two renderers doing overlapping jobs (noted for the next 30-day code review, not fixed here). Instead: **promote `budget-notes-markdown.tsx`'s component to a new neutral, non-domain-named top-level file** (e.g. `src/components/rich-markdown-content.tsx` — tech-lead picks the exact name), update its two existing call sites (`budget-notes-editor.tsx`, `budget-print-worksheet.tsx`) to import from the new location, and have minutes import the same component. Do **not** fold this into the existing `markdown-content.tsx` — that component already has real, different callers (event descriptions on `events/page.tsx`, `events/[id]/page.tsx`, `members/events/page.tsx`) using its simpler element set, and conflating the two risks bleeding print-worksheet/table styling into plain event prose. This is a small, mechanical move (relocate + 2 import updates), foldable into Phase 4's implementation order, not a separate pipeline pass. The "never `rehype-raw`" comment travels with the promoted file verbatim — that invariant must still be stated explicitly in the new location, not silently dropped in the move.

One thing for Phase 3 to actually check rather than copy blindly: `budget-notes-markdown.tsx` is marked `"use client"` but, reading it, contains no hooks/state/handlers — it may be client-only by inherited convention rather than real necessity. If the promoted component can drop `"use client"` and render server-side (react-markdown supports this), that's a strict win — smaller client bundle, correct per the Server-Components-by-default invariant, and the member-facing minutes detail page can then stay a pure Server Component end-to-end. Not a blocker either way.

**Component homes:** admin-only compositions (attendance checklist, motion/action-item editors, the paste-to-Markdown editor with live preview) go in **`src/components/admin/minutes/`**, per Component Rule 3. Member-facing read-side pieces (kind filter tabs, search box, next-meeting pointer widget, minutes detail view) go in a new **`src/components/minutes/`**, matching the existing one-directory-per-domain pattern (`events/`, `campaigns/`, `members/`) rather than being scattered top-level.

## Ruling 3 — data model, high level

One parent table plus child tables for the structured sub-records — deferring exact DDL to database-admin in Phase 4, but the shape and two specific column-type calls are architectural and settled here:

- **`minutes`** — `id uuid PK`; `kind text NOT NULL` (DECISION-041 pattern, validated against `MINUTES_KINDS`, no CHECK); `eventId uuid NULL REFERENCES events(id)` (nullable — not every record ties to a scheduled occurrence); **`meetingDate date NOT NULL`** — see below; `status text NOT NULL DEFAULT 'draft'` (DECISION-041 pattern again, no enum, `draft`/`approved`); `bodyMarkdown text`; `authorUserId uuid REFERENCES users(id)`; `approvedByUserId uuid NULL REFERENCES users(id)`; `approvedAt timestamp NULL`; `pendingDeleteAt timestamp NULL` (column shape reused from `ledgerBudgets`, purge behavior explicitly not — confirmed, concur with Phase 1); standard `createdAt`/`updatedAt`.
- **`minutesAttendance`** — `minutesId FK`, **`memberId uuid REFERENCES members(id)`** (not `users` — see below), `present boolean NOT NULL`.
- **`minutesMotions`**, **`minutesActionItems`** — child tables per the Phase 1 flow spec (mover/seconder/result; text/owner/due date). Exact columns are database-admin's call in Phase 4.

**`meetingDate` is a `date` column, not `timestamp`.** This directly follows DECISION-001's reasoning, not `eventRsvps.occurrenceDate`'s pattern: `eventRsvps.occurrenceDate` is a naive `timestamp("occurrence_date", { mode: "string" })`, and DECISION-001 explicitly called that "the known project bug" and chose `date` for `event_occurrence_overrides.occurrence_date` specifically to sidestep timezone ambiguity for occurrence-keyed data. Minutes is occurrence-keyed in the same way (a minutes record belongs to a calendar day, not a wall-clock instant) — same reasoning, same column type. This single `meetingDate` field does double duty: when `eventId` is set, it's the linked occurrence's calendar date; when it's null (ad hoc or historical), the notetaker enters it directly. No second date column needed.

**Attendance references `members`, not `users`.** `event_rsvps.userId` references `users` because RSVPs can be anonymous or from any signed-in account. Attendance is different: Flow 2 describes it explicitly as "a roster checklist" — a notetaker checking off known club members — which is the `members` table's job (same table the Directory and Dues already key off of), not the auth-account table. Settling this now avoids an arbitrary pick in Phase 3.

## Ruling 4 — IA restructure: navigation regroups, routes do not move

This is a real decision with a real cost, ruled explicitly rather than left to Phase 3 to guess: **`/members/dues`, `/members/reimbursements`, `/members/impact`, and `/members/financial-reports` all keep resolving exactly as they do today.** "Profile absorbs Dues + Reimbursements" and "Club Finances absorbs Financial Reports + Impact" are **navigation-entry-point changes only** — `/members/page.tsx`'s tile grid shrinks from 8 tiles to 6, and Profile / Club Finances become fan-out hubs one level down, the same shape `ADMIN_NAVIGATION`'s "Treasury" group already establishes for grouping several independently-gated admin pages under one sidebar entry. The Phase 1 doc already implicitly chose this for Club Finances ("fans out to existing Financial Statements + Our Impact pages, unchanged underneath") — this ruling makes it explicit and applies the *same* resolution to the Profile/Dues/Reimbursements absorption, which the Phase 1 wording ("gains... as sections/tabs") left more ambiguous about route fate. Two structurally identical "hub absorbs sub-pages" moves get one consistent resolution, not two different ones.

Cost avoided: zero broken bookmarks, zero broken links in already-sent email (`email_queue` history, any board-minutes-approval reminder emails later), zero broken browser history. Cost accepted: if ux-developer wants Profile's Dues/Reimbursements to *feel* like in-page tabs rather than link-out cards, the tab UI must still resolve to the real `/members/dues` / `/members/reimbursements` URLs (Next.js supports tabs backed by real routes) — a normal, already-common web pattern, not a compromise worth re-litigating.

## Ruling 5 — the three `boardMinute` free-text fields: leave room, touch nothing

Concur with the analyst's Out-of-Scope note exactly: no schema change to `ledgerTransactions.boardMinute`, `ledgerBudgetApprovals.boardMinute`, or `ledgerReimbursements.boardMinute` in this pass. The only thing required to keep a future `boardMinutesId` nullable FK clean and additive is that `minutes.id` is a stable `uuid` primary key — which it already is under the default pattern used everywhere else in this schema. Nothing else needs to be shaped now. This is a **verify-non-interference** ruling, not a design addition — Phase 3/4 should not add anything here beyond what's already true by default.

## Invariants Touched

- **Permissions catalog** — two new `FEATURES` keys (`minutes.manage`, `minutes.delete`) and one new role (`notetaker`). Follow the `budget_committee`/DECISION-069 migration shape exactly: `FEATURES` const + `FEATURE_CATEGORIES` + `FEATURE_DESCRIPTIONS` in `src/lib/permissions.ts`, an `ADMIN_NAVIGATION` entry for `/admin/minutes`, and an idempotent migration (`INSERT ... WHERE NOT EXISTS` for the features, the role, and each `role_features` bind) — bind `notetaker` → `minutes.manage` and `admin` → both keys explicitly (matching 0069's stated convention of explicit-binding admin even though `getUserFeatures()` auto-grants everything to admin). **Use the `add-permission` skill** for this — it exists exactly for this step. No `minutes.view`/read gate exists by design, per the treasurer's explicit call — do not add one "for symmetry."
- **Schema is the source of truth** — `minutes`, `minutesAttendance`, `minutesMotions`, `minutesActionItems` go into `src/lib/db/schema.ts` first, matching idempotent migration second.
- **DECISION-041 compliance** — `kind` and `status` are `text`, no DB `CHECK`/enum, application-validated. Confirmed, not a new pattern.
- **Migration numbering caution, not a ruling on a specific number:** `0076` is reserved in-narrative by the concurrently in-flight acknowledgment-letter-generation feature (DECISION-072) but is not yet on disk; `0077` (`ledger_donor_emails`) already exists. Whoever implements Phase 4 must take the actual next free number *at implementation time*, not hardcode one now — the same caution DECISION-073 itself already exercised.
- **No native browser dialogs** — Approve/Reopen/Delete flows already specify `<ConfirmDialog>` in Phase 1; confirmed, no gap.
- **Server/client boundary** — member-facing minutes list/detail pages are Server Components by default (matches the `/members/financial-reports`, `/members/impact` precedent). The paste-to-Markdown admin editor is necessarily `"use client"` (clipboard events, live preview, `turndown` invocation) — and per Ruling 1, `turndown` must never leak into a server-rendered file.
- **Pre-existing drift, opportunistic only:** `ROLES` in `src/lib/permissions.ts` is missing `budget_committee` today (a known, already-logged drift, not introduced by this feature). Since Phase 4 is already editing that file to add `notetaker`, adding both missing entries in the same touch is cheap hygiene — optional, not required, not a blocker if skipped.

## Notes for Phase 3

- Open questions 1 (author-lock), 2 (auto-role-from-boardPosition), 3 (kind taxonomy: array vs. table), 4 (email on approval), 5 (committee `groupId` link), 6 (print/export) are all still genuinely open — none of my rulings above resolve them, and none of them block advancing to Phase 3. If a committee-kind `groupId` link is added later, it's a nullable FK on `minutes`, same shape as `eventId` — compatible with everything ruled here, not scoped in now.
- Phase 4 implementer split: this is schema + API + UI + a new dependency + an IA restructure touching an existing page — squarely **large**, not "small and coupled." Run the specialist split per CLAUDE.md's stated precedent ("every increment of The Ledger ran this way cleanly"): **database-admin** (schema + migration + permission binding) → **api-developer** (route handlers/server actions for CRUD, approve/reopen, search, delete/restore) → **ux-developer** (admin minutes UI, member portal Minutes tile + detail + search, the Profile/Club Finances hub regroup, the promoted Markdown component move).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions

- Permission key(s): `area.action`
- Default role bindings: [list]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → add migration in `drizzle/migrations/` and update `src/lib/db/schema.ts`
2. `FEATURES` entry in `src/lib/permissions.ts` + role binding migration
3. Route handlers / server actions
4. UI
5. Email notification (if applicable) — enqueue via `sendEmail` in `src/lib/email.ts`
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

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

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]


---

## Treasurer Decisions — ADDENDUM (2026-08-08): email distribution

Added after the Phase 2 architectural review, before Phase 3. His words:

> "Once they are saved prompt to ask if they should be emailed. Board minutes go to
> board@westervillelions.org and club go to club@westervillelions.org. Add the ability to add a little
> note in the email. They can be inline in html format. No need to be an attachment."

**Requirements:**
1. **Post-save prompt** offering to email the minutes. Not automatic — the notetaker chooses.
2. **Distribution by kind:** board minutes → `board@westervillelions.org`; general/club minutes →
   `club@westervillelions.org`.
3. **An optional short note** from the sender, included in the email above the minutes.
4. **Minutes rendered INLINE as HTML in the email body.** Explicitly not an attachment — which is
   fortunate, since `sendEmail()` has no attachment support.

**Consequences that need ruling or design, flagged rather than assumed:**

- **Markdown → HTML on the server.** Minutes are stored as Markdown (DECISION-074's `turndown`
  ruling). The existing renderer is a React component (`react-markdown`), and email needs an HTML
  string. `renderToStaticMarkup()` on the existing component is one option with no new dependency —
  it is already used this way in this project's tests. Whether that, or a server-side
  remark/rehype pipeline, is the right answer is an architect call.
- **Email HTML is not web HTML.** Mail clients strip `<style>` blocks and ignore most class-based CSS,
  so Tailwind classes will not survive. Inline styles or a deliberately plain presentation are needed.
  This is a real constraint on reusing the web renderer as-is.
- **The `kind` taxonomy is open-ended** (committee minutes anticipated), but only two addresses are
  specified. What a kind with no mapped address does — no email offered, a default, or configuration —
  needs an answer.
- **Draft versus approved.** The lifecycle has both. Emailing a *draft* to the board for review is
  normal practice; emailing an unapproved draft to the whole club is a different matter, since the
  club would receive a record that has not been adopted. Needs an explicit rule.
- Whether the two addresses are Google Groups (the club syncs Groups already) and therefore whether
  membership of those lists is managed elsewhere.

---

## Phase 2 — ADDENDUM (architect, 2026-08-08): email distribution

Appended to the existing Phase 2 review above — the original rulings stand unchanged. Logged as
companion decision **DECISION-075** (extends DECISION-074, does not supersede it).

**1. Markdown → HTML for email: `renderToStaticMarkup()`, no new dependency.** The promoted renderer
(Ruling 2 above) is a `ReactMarkdown` element with a `components` map; `renderToStaticMarkup()` from
`react-dom/server` can render that same element tree to a plain HTML string in a server-only module
(a route handler or server action, Node runtime — never a `"use client"` file). This reuses the entire
parsing engine (`remark-gfm`, the Markdown→AST→React pipeline) already approved for this feature and
only needs a second, email-specific `components` map — not a second parser. A server-side
remark/rehype pipeline (`unified`/`remark-parse`/`remark-rehype`/`rehype-stringify`) would duplicate
capability the stack already has and is **not warranted** — this is the second new-dependency
question this feature has raised, and unlike `turndown` (which filled a real capability gap — nothing
converts HTML→Markdown today), a Markdown→HTML renderer already exists. Approving a second dependency
here would fail dependency-evaluation criterion 1 outright. **Ruling: no new dependency.**

**2. Email HTML needs its own components map — not the web renderer's, and not the web renderer's look.**
Confirmed by reading this app's existing transactional emails (`api/contact/route.ts`,
`api/auth/forgot-password/route.ts`, `api/suggestions/route.ts`, `lib/members.ts`): every one of them
is a plain HTML string with light inline `style=` attributes — no Tailwind classes, no rich visual
treatment. That is the house convention for email, and it already anticipates exactly this problem
(mail clients strip class-based CSS). **Ruling:** write a small, dedicated components map (e.g.
`minutesEmailMarkdownComponents`, living next to the promoted renderer or in the new email-sending
module) using inline styles only, matching this existing plain/light convention — not a re-skin of the
web renderer's Tailwind classes, and not an attempt to preserve the print-worksheet look. Reusing the
web renderer's component map as-is would silently produce unstyled, broken-looking email; that option
is rejected.

**3. Unmapped `kind` gets no email offer — not a default address, not a block on saving.** Consistent
with the open-ended-`kind`/no-migration ruling in DECISION-074: the address map is a **partial**
mapping (`general`→`club@`, `board`→`board@`). A `kind` with no entry simply doesn't show the post-save
email prompt — no silent default to `club@` (a future committee-only kind defaulting to the whole
membership would be a real privacy/governance mistake, not a convenience) and no hard block on saving
minutes of that kind (would re-couple "add a kind" to "resolve an address," defeating the entire point
of `kind` being code-only and migration-free). A new kind is fully usable — savable, readable, searchable
— the moment it's added to `MINUTES_KINDS`; an email route for it is a separate, optional addition to
the map whenever a real address exists.

**4. Address mapping: hardcoded const, co-located with `MINUTES_KINDS`, not a `ledgerSettings`-style
table.** The mapping changes at the same cadence, for the same reason, and by the same actor (a
developer) as `kind` itself — splitting "kind in code" from "address in a DB singleton" would let a
kind exist with a resolvable email path or not, discoverable only by checking two places instead of
one. `src/lib/minutes.ts` gets a `MINUTES_KIND_EMAIL: Partial<Record<string, string>>` (or equivalent)
next to `MINUTES_KINDS`, not a new table. This is explicitly the **same open question** Phase 1 already
named as open question 3 for `kind` itself (hardcoded array vs. self-service lookup table) — if the
treasurer wants to manage kinds *or* addresses himself without a deploy, that promotion should happen
for both together, not as two separate follow-ups arriving at different times. Not re-litigated here as
a new, independent decision.

**5. Draft vs. approved — the mechanism is mine to rule; whether to hard-block club-wide sends on draft
status is the treasurer's, and I'm not silently resolving it either way.** What follows directly and
mechanically from a fact the treasurer already settled (approval happens at the *next* meeting; a draft
is explicitly not yet the adopted record) is a **content rule, not a permission rule**: any minutes
email sent while `status != 'approved'` must carry an unmissable "DRAFT — subject to approval" banner
in the email body itself. This is architecturally mine to require because it's a direct consequence of
an already-decided fact, not a new policy call, and it doesn't block the board's own normal workflow
(reviewing a draft by email before the approval vote is exactly what a notetaker emailing a board-kind
draft to `board@` is for). What I am **not** deciding: whether sending an unapproved *general/club-kind*
draft to `club@` (the whole membership) should be technically disabled rather than merely banner-labeled.
That's a real governance-policy call in the same register as "any member may read board minutes" —
his to make, not mine to assume. **Flagged as a new open question for the treasurer, carried into
Phase 3 unresolved rather than quietly decided:** should a draft be sendable to `club@` at all, or only
to `board@` until approved?

**6. Delivery mechanics: `sendEmail()` is reused unmodified; the failure-visibility gap is a UI
requirement, not a new mechanism.** `sendEmail()`'s `to` is a single address string — a Google Group
address is, from Resend's point of view, an ordinary recipient; group expansion happens on Google's
side after acceptance. No changes needed to `src/lib/email.ts`. It already returns
`{ success, error }` synchronously after up to 3 in-request retries, and on final failure persists
`status: 'failed'` + `nextRetryAt` to `email_queue` — but retry from there is **admin-triggered only**
(`POST /api/admin/email-queue/retry`; confirmed no cron/Vercel scheduled job exists in this project).
That queue-and-manual-retry behavior is the existing architecture for every email this app sends and is
correctly out of scope to change here. What *is* required, and is new for this feature: the post-save
send action must surface `sendEmail()`'s result **directly to the notetaker at the moment of the
attempt** — a clear success or failure message, not a generic "Minutes saved" toast that implies the
email went out regardless. A governance-record email failing silently into an admin-only queue page the
notetaker may never open is exactly the failure mode flagged, and the fix is a UI-plan requirement for
Phase 3, not a change to the queue/retry mechanism itself.

**7. The two addresses are not symmetric — worth naming precisely, not just "an external fact."**
`club@westervillelions.org` is not external to this app: it is `CLUB_GROUP_EMAIL` in
`src/lib/google-groups.ts`, the exact Google Group this codebase already auto-syncs to every active
member. Sending minutes there reaches the current membership reliably, for the same reason every other
club-wide sync already works — this app keeps that list correct. `board@westervillelions.org` appears
nowhere in `google-groups.ts` — it is an external, presumably manually-managed group outside this app's
sync surface; if its membership is ever stale, that's outside this feature's control. This doesn't
change the send mechanism (`sendEmail()` is indifferent to which kind of address it's given), but one
concrete, small structural instruction follows from it: **export `CLUB_GROUP_EMAIL` from
`google-groups.ts`** (currently module-private) and import it into the new `MINUTES_KIND_EMAIL` map
rather than re-typing the literal `"club@westervillelions.org"` in a second file — a one-line change
that keeps the two call sites from being able to drift if the address or domain ever changes.

### Verdict (restated)

**Approved with suggestions** — unchanged from the original Phase 2 review. The addendum adds concrete,
required rulings (email-render approach, email components map, partial address mapping with no default,
the draft-email banner requirement, reuse of `sendEmail()` as-is, the `CLUB_GROUP_EMAIL` export) and one
genuinely open item carried forward rather than resolved: **whether draft club-wide minutes may be
emailed to `club@` at all, or only board-kind drafts to `board@` until approval** — that needs the
treasurer's answer before Phase 3 finalizes the send-gating design. Nothing in this addendum reopens or
contradicts the original seven rulings; Phase 3 should treat both documents as one combined brief.


---

## Treasurer Decisions — ADDENDUM 2 (2026-08-08): governing documents

The treasurer supplied the club's Constitution & By-Laws (`bylaws.pdf`) and asked for it in the member
portal, "maybe a resources area."

**Decisions:**
1. **Fold it into the Minutes tile and rename that tile** — "Club Records" or "Governance" — so it holds
   both minutes and governing documents. Stays at the six-tile ceiling, and it is where a member looking
   for "the rules" would think to look. A seventh Resources tile was rejected for that reason.
2. **Host the scan as-is for now.** No transcription in v1. It is unambiguously the authoritative
   document, and a transcription error in a document that governs the club is a real risk, not a
   theoretical one.

**What the document actually is — matters for the design:**
- Title page: "The Westerville Lions Club — Constitution & Bylaws — Revised April 2, 1998", in force
  from 21 November 1991. **28 years old**; whether it reflects current practice is a governance
  question for the board, not a website question. Flagged, not resolved.
- **It is a SCAN — page images, no selectable text.** Therefore not searchable, not linkable by
  article/section, and awkward on a phone. This directly limits what the Minutes area's search can
  cover: minutes will be searchable, the bylaws will not. Say so in the UI rather than letting a member
  conclude search is broken. OCR would fix it but needs careful proofreading before it could be
  presented as authoritative — a follow-up, tracked under **B-38**.

**Two clauses that bear on other work in this repo:**
- **Article I, Section F:** "The fiscal year of this Club shall be July 1st through June 30th" — the
  club's own governing document confirming the fiscal-year convention the entire Ledger is built on
  (DECISION-015 and every FY-derivation since). Worth citing if that convention is ever questioned.
- **Article II, Section F:** "partisan politics and sectarian religions shall not be imposed or debated
  by Club members" — binding on this club, not merely Lions International policy. Relevant to speaker
  selection (a faith-based organization describing its work is fine; imposition or debate is not).
- "A permanent copy … is filed in the record book maintained by the club secretary" — the same
  secretary who will hold the `notetaker` role. The digital copy supplements that record book; it does
  not replace it.
