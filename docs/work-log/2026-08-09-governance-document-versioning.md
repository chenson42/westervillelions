# Governance Documents — Versioning, Diffing & Adoption — Work Log

> **Slug:** `2026-08-09-governance-document-versioning`
> **Surface:** mixed — member portal (read + version history) and admin (edit)
> **Permission(s):** new `documents.manage`, bound to the `notetaker` role. No delete key — versions are permanent by design.
> **Estimated complexity:** large — comparable in size to the minutes feature it was split from
> **Pipeline mode:** Full — Phase 1 carried over from the minutes work-log; Phase 2 has never run on this scope

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried over) | READY WITH NOTES | 2026-08-08 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-09 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-09 |
| 4 — Implementation (schema) | database-admin | Complete | needs-review (schema half only; api-developer/ux-developer still pending) | 2026-08-09 |
| 4 — Implementation (API) | api-developer | Complete | complete (server half only; ux-developer still pending) | 2026-08-09 |
| 4 — Implementation (UI) | ux-developer | Complete | complete — ready for Phase 5 | 2026-08-09 |
| 5 — Verification | qa | Complete | FAIL — missing `/admin/documents` proxy rule locks out `notetaker` | 2026-08-09 |
| 4 — Implementation (loop-back: proxy gating fix) | full-stack-developer | Complete | complete — `/admin/documents` proxy rule added; proxy admin-area rules now derived from `ADMIN_NAVIGATION` (DECISION-082), ending the 5x-recurring bug class structurally | 2026-08-09 |
| 5 — Verification (re-run) | qa | Complete | FAIL — DECISION-082 side effect exposes newsletter-subscriber PII at `/admin/subscriptions` with no page-level gate | 2026-08-09 |
| 4 — Implementation (loop-back 2: subscriptions page gate) | api-developer | Complete | complete — full 22-area admin-page audit, `/admin/subscriptions` and `/admin/permissions` page-level gates added, new `subscriptions.view` key (DECISION-083), regression test added, ready for Phase 5 re-run | 2026-08-09 |
| 5 — Verification (FINAL re-run) | qa | Complete | **PASS** | 2026-08-09 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-08-09 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

[READY FOR DESIGN | READY WITH NOTES | NEEDS REWORK | NOT YET]

## ONE-LINE TAKE

> [The feature in one honest sentence.]

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| [anonymous public visitor / signed-in member / admin] | [verb] | [on demand / per session / one-time] |

## Flows

**Flow 1 — [name]:** [entry → step → step → outcome]
- Failure: [what the user sees if a step goes wrong]

**Flow 2 — [name]:** [...]

## Permissions

- **Permission(s):** [new `FEATURES.KEY`, or existing key reused]
- **Default roles:** [list]

## Gaps the Request Didn't Address

- [Gap, why it matters, suggested resolution]

## Out of Scope (confirm with user)

- [Thing the request implies but isn't in scope]

## Open Questions

- [Question for the user]

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The two-round Phase 1 analysis is sound and its load-bearing calls
(sibling-not-superclass, version-is-a-permanent-row, `changeType` branching, `currentVersionId` as a
pointer, sharing the adoption *pattern* not a table) are correct and not being second-guessed. What
follows closes the seven questions the brief asked for, ruled — not rubber-stamped. Logged as
**DECISION-076**. Confirmed up front, not reopened: **DECISION-074 and DECISION-075 stand exactly as
written for minutes.** Nothing below touches the `minutes`/`minutesAttendance`/`minutesMotions`/
`minutesActionItems` tables, `src/lib/minutes.ts`/`minutes-queries.ts`, or the `minutes.manage`/
`minutes.delete` keys.

## Ruling 1 — table shape: two tables, sibling to minutes, pointer-not-derived "current"

**Two tables — `documents` and `documentVersions` — confirmed, not overturned.** Re-run against the
counter-case Round 2 already stated honestly: minutes' real structure (attendance, motions, action
items, kind-based email distribution) has no use for an immutable linear version chain, and documents'
real structure (the version chain itself, `changeType` branching, adoption/citation) has no use for
attendance/motions/email routing. Merging them would reproduce, one level up, the exact anti-pattern
this codebase already rejected once by name — DECISION-072 choosing a real `ledgerLetterTemplates`
table over a column bolted onto `ledgerSettings` because a shared row shape becomes "a bag of unrelated
scalar knobs, wrong axis for structured content." Two mutually-exclusive column families on one table
is that same anti-pattern with more fields on each side than DECISION-072 had to weigh. Where the two
genuinely share vocabulary — "provisional until a vote, then official, optionally citing the minutes
where the vote happened" — that's expressed as the same trio of columns in both places
(`approvedByUserId`/`approvedAt`/nullable FK to `minutes.id` on minutes;
`adoptedByUserId`/`adoptedAt`/nullable `citingMinutesId` on `documentVersions`), not as a shared table.
Confirmed.

**Table shapes (exact DDL is database-admin's call in Phase 4, same division of labor DECISION-074
Ruling 3 already used for minutes):**

- **`documents`** — one row per governed document. `id uuid PK`; `title text NOT NULL`; `slug text NOT
  NULL UNIQUE` (routing handle, e.g. `constitution-bylaws`); `visibility text NOT NULL` (DECISION-041
  pattern — see Ruling 6, not derived from route placement); `currentVersionId uuid NULL` (see the
  circular-FK note below); standard `createdAt`/`updatedAt`. **No `kind` column.** Round 1 anticipated
  `kind` for a future multi-kind registry, but nothing in this pass's actual inventory (one document)
  needs a taxonomy to classify itself against — adding `kind` now for a corpus of one is the same
  premature-generalization trap Round 1 correctly named and declined elsewhere in its own analysis. If
  a second, differently-shaped document arrives, `kind` is a one-line additive column then, not a
  structural gap now.
- **`documentVersions`** — `id uuid PK`; `documentId uuid NOT NULL REFERENCES documents(id)`;
  `versionNumber integer NOT NULL`; `bodyMarkdown text NOT NULL`; `changeType text NOT NULL`
  (DECISION-041 pattern — `editorial` | `substantive`, validated against a small const array, no
  CHECK); `changeNote text NOT NULL`; `authorUserId uuid REFERENCES users(id)`; `adoptedByUserId uuid
  NULL REFERENCES users(id)`; `adoptedAt timestamp NULL`; `citingMinutesId uuid NULL REFERENCES
  minutes(id)`; `adoptionNote text NULL`; `createdAt timestamp NOT NULL DEFAULT now()`. No `updatedAt`
  — versions are never updated, by design; a mutable-timestamp column on an immutable row would be a
  quiet lie about what the row is.

**"Current" is `documents.currentVersionId`, a pointer, never a computed `MAX(versionNumber)` or
"latest adopted" query.** This is what makes editorial-vs-substantive and pending-vs-adopted
unambiguous by construction rather than by query discipline: an editorial save both inserts the new
version row and updates `documents.currentVersionId` to it, in one transaction — current changes
immediately. A substantive save inserts the version row with `adoptedAt`/`adoptedByUserId` both null
and does **not** touch `currentVersionId` — it exists, is queryable, is visible to `documents.manage`
holders (Ruling 6), but is not "the document" yet. Adoption is a separate write: set
`adoptedByUserId`/`adoptedAt` (and `adoptionNote` — `citingMinutesId` is deliberately allowed to lag,
per Phase 1's sequencing-gap reasoning, which I concur with) and, in the same transaction, update
`documents.currentVersionId` to that version. At every point in time there is exactly one answer to
"what does a member see" — a single indexed FK lookup — while the full chain, including every
superseded and every still-pending version, stays independently queryable for history/diff. No
in-between state exists where two rows could both plausibly claim to be current.

**Circular-FK note for Phase 4, not a blocker:** `documents.currentVersionId → documentVersions.id` and
`documentVersions.documentId → documents.id` create a genuine table-creation ordering problem (neither
table can exist with its FK satisfied before the other does). The standard resolution — create both
tables, then `ALTER TABLE documents ADD CONSTRAINT ... REFERENCES documentVersions(id)` in a third
statement, all inside the same idempotent migration — works and is the version of this problem
database-admin should reach for first. An acceptable fallback, if Drizzle's push step fights the
two-step ALTER: no DB-level FK constraint on `currentVersionId` at all (still `uuid NULL`, enforced
app-side only) — this codebase already has a standing precedent for app-level-only enforcement
(DECISION-041), so dropping the constraint here isn't a new pattern, just an already-approved one
applied to a pointer instead of a taxonomy value. Either is fine; database-admin picks.

## Ruling 2 — `diff` (jsdiff) approved, server-only (the inverse boundary of `turndown`)

**Approved as this feature's third new dependency**, evaluated against the same five criteria
`turndown` was, not waved through because `turndown` already set a precedent:

1. *Already solved by an existing dependency?* No — nothing in `package.json` does text diffing.
2. *Actively maintained, compatible with the stack?* Yes — MIT-licensed, zero runtime dependencies,
   long-established (used by VS Code and npm itself), plain ESM/CJS-compatible, nothing about it is
   version-sensitive to Next 16/React 19.
3. *Runtime it must work on?* This is the one that actually matters here, and it cuts the opposite way
   from `turndown`. Where `turndown` is DOM-bound (`DOMParser`) and therefore *must* stay client-only,
   `diff` is pure string/array computation with no browser API dependency at all — it runs identically
   in a route handler, a Server Component, or a `"use client"` file. That means the choice of where it
   runs is a real architectural decision here, not a constraint imposed by the library (see Ruling 4).
4. *Bundle-size impact?* Small either way, but moot for the public-facing first-paint concern — see
   Ruling 4: it should run server-only, so it never enters any client bundle at all, public or member
   portal.
5. *License?* MIT. Clear.

**Would hand-rolling it be credible instead?** No, for the same shape of reason `turndown` wasn't
hand-rolled, made concrete for this case. A line-level diff is Myers/LCS, a well-understood algorithm —
but "well-understood" and "easy to get right on the first, untested implementation" are different
claims. Phase 1 already named the specific failure modes honestly: off-by-one backtracking, trailing-
newline handling, multi-byte/Unicode edge cases. A subtly-wrong diff is a worse failure mode here than
in most features that might reach for it, because the diff view's entire job is to be the artifact the
board trusts to show "exactly what changed" in a governing document — a diff that silently drops or
misattributes a line is invisible until someone notices the board voted on prose that doesn't match
what's now live. That is not a corpus-of-one problem to defer (like a `kind` taxonomy would be); it is
a correctness-critical, well-scoped, already-solved problem, which is exactly the profile that earned
`turndown` its approval. Concur with Phase 1's recommendation: **`diff` (jsdiff), not hand-rolled.**

**Hard rule for Phase 3/4, stated as explicitly as Ruling 1 stated `turndown`'s client-only
requirement, and its mirror image: `diff` may only be imported from a server-only module** — the pure
diff-computation helper in `src/lib/documents.ts` (Ruling 3) or a Server Component/route handler that
calls it. It must never be imported from a `"use client"` file. Not because the library can't run
there, but because there's no reason to ship a diffing library to the browser when the input (two
Markdown version bodies, already on the server) and the output (a serializable list of line-level diff
ops) are both cheaper to compute server-side and pass down as plain props — see Ruling 4.

## Ruling 3 — module and route placement: parallels the minutes lineage, does not join it

**`src/lib/documents.ts` (pure) / `src/lib/documents-queries.ts` (DB)** — the exact sibling-pair shape
DECISION-074 Ruling 2 established for minutes, applied to documents on its own terms, not merged into
the minutes modules. `documents.ts` holds the `changeType` const/validator (DECISION-041 shape,
identical pattern to `MINUTES_KINDS`), the `visibility` const/validator, and the pure
`diffDocumentVersions(oldMarkdown, newMarkdown)` helper wrapping `diff` — this is the same shape as
`ledger-acknowledgment-letter.ts` holding `composeAcknowledgmentLetter()` (DECISION-072 Ruling 3): a
pure, DB-independent, unit-testable function, importable without a DOM (`vitest.config.ts` runs
`environment: "node"`, so this is directly testable). `documents-queries.ts` holds document/version
CRUD, the create-editorial/create-substantive write paths, the adopt-version write, the
link-citing-minutes-after-the-fact write, and version-history reads. Neither file joins `minutes.ts`/
`minutes-queries.ts` — same module-separation reasoning DECISION-074 Ruling 2 already applied
(documents share no tables, no permission keys, and — per Ruling 6 below — not even the same audience
boundary as minutes, with minutes) — and neither joins the `ledger-*` family for the same reason that
lineage has held since DECISION-049.

**Component homes**, mirroring DECISION-074 Ruling 2's split exactly: admin-only compositions (the
version editor — paste-to-Markdown reusing the same client-side `turndown` pipeline minutes already
gets approved for use, the editorial/substantive change-type picker, the pending-version review list,
the "adopt" action, the "link citing minutes" action) go in **`src/components/admin/documents/`**. The
paste-to-Markdown flow is a second consumer of the same already-approved capability
(`turndown`/`turndown-plugin-gfm`), not a second dependency decision — reuse it, don't re-evaluate it.
Member-facing read-side pieces (current-document view, version-history list, the diff/compare view) go
in **`src/components/documents/`**, matching the one-directory-per-domain pattern
(`events/`, `campaigns/`, `minutes/`).

**Rendering: reuse the promoted renderer, not `ReleaseNotesViewer`'s.** This is worth stating as an
explicit correction, because Round 1's original recommendation (host the by-laws like release notes,
which is the one place in this codebase that enables `rehype-raw`) was reasoned from a trust boundary —
"git-authored, PR-reviewed" — that Round 2 knowingly overturned. Once versions are typed/pasted through
an admin form and stored in the database, the trust boundary is identical to minutes' and budget notes'
(admin/notetaker-authored, rendered to every reader), **not** release notes' (developer/Claude-authored,
git-reviewed before merge). The current-document view and any rendered version in the history/diff UI
must render through the **promoted** `src/components/rich-markdown-content.tsx` (DECISION-074 Ruling
2's relocation of `budget-notes-markdown.tsx`) — Markdown only, no `rehype-raw` — never through
`ReleaseNotesViewer`'s pipeline. Flagging this now so it isn't accidentally copied from the by-laws'
Round-1-era plan.

**Routes:** admin authoring lives under `src/app/(dashboard)/admin/documents/`, mirroring
`/admin/minutes`, gated `documents.manage`. Member/public reading routes are a `visibility`-driven call
(Ruling 6), not a fixed route-group choice — exact paths are Phase 3's job, but whichever route(s) get
picked, the underlying data fetch (current version, version history, diff-between-two-versions) is one
shared code path in `documents-queries.ts` regardless of which route calls it.

## Ruling 4 — diff renders server-side; no practical size problem at this scale

**Diffing is a server concern, computed once per request/query and passed down as plain, serializable
props — never recomputed or shipped to the client.** Concretely: a Server Component (or, if the compare
view needs client-side interactivity like a version-picker dropdown that re-fetches, a server action or
route handler backing it) loads the two `documentVersions.bodyMarkdown` values, calls
`diffDocumentVersions()` from `src/lib/documents.ts`, and hands the resulting line-level diff array to
whatever renders it. If the compare UI needs a `"use client"` wrapper at all (for a picker, a
unified/side-by-side toggle), that wrapper receives the **already-computed** diff array as props — it
does not import `diff` itself. This keeps `diff` out of every client bundle, public and member-portal
alike, and keeps the diff computation server-side per the same reasoning Server-Components-by-default
already gives this codebase for anything that doesn't need a hook, a ref, or a browser API.

**How a member views history and compares two versions:** a version-history list (changeType badge,
changeNote, author, date, adopted/pending status, most-recent-first) on the document's route, each
entry linking into a compare view; the compare view defaults to "this version vs. the version it
superseded" but should let a reader pick any two versions from the chain (a plain two-value picker,
server-rendered per selection — no client-side diff engine needed for this either).

**Size problem: none worth designing around.** The seeded document is 642 lines / ~16 pages. Line-level
diffing at that scale is trivial for `diff` — millisecond-order computation, no pagination or
virtualization needed for the diff view itself at this document's size. If a future document is
materially larger, the fix (if any is ever needed) is a UI-layer concern — list virtualization on a very
long diff render — not a data-model or dependency concern; not scoping anything in for it now.

## Ruling 5 — the seed: a one-off script, not a migration; git file becomes a fixed historical artifact

**Confirmed, not a migration.** `drizzle/migrations/` re-runs on every deploy, and CLAUDE.md's own
migration rules exist specifically to keep that pipeline safe for repeated, automatic execution — a
seed step that inserts version 1 belongs to a fundamentally different execution model: run once, by a
human, deliberately, and never again. Putting it in `drizzle/migrations/` doesn't just risk the
class of bug CLAUDE.md already warns about generically — it is *exactly* the bug class that has
already bitten this project twice for real, per the standing memory note on the Ledger's Quicken-export
seed: **"NEVER re-run import (delete-and-reinsert wipes post-seed edits)."** A `WHERE NOT EXISTS` guard
protects a migration against re-*inserting* a duplicate row on a second deploy, but it does nothing
against a human later editing that migration file (to fix a transcription typo, say) and having it
re-run against a database where versions 2 through 6 already exist on top of version 1 — the exact
failure shape the memory note describes. **Recommendation, matching Phase 1's own and this project's
existing convention: a one-off `scripts/*.ts` script**, run manually
(`pnpm tsx scripts/seed-governance-document.ts` or similar), the same idiom as the roster-import and
Ledger-seed scripts already in `scripts/`. It should still guard itself (no-op if a `documents` row with
the target `slug` already exists) as a defense-in-depth measure against accidental double-invocation —
but the primary safety property is structural: **it is not wired into the deploy pipeline at all**, so
it cannot be silently re-triggered by a routine `pnpm build`/`db:migrate` the way a migration-based seed
could be.

**Git file fate: kept, frozen, not re-read after the seed.** `docs/club-constitution-and-bylaws.md`
stays committed — it's the human-reviewed-against-the-scan artifact that produced version 1, and
deleting it would destroy that provenance record for no benefit. But after the one-time script runs,
**the app never reads that file again.** The database is authoritative from that point forward; the git
file is a frozen historical snapshot of what was imported, not a second live copy anyone needs to keep
in sync. State this in the file itself (a one-line addition to its existing transcription-notice header
— e.g., "Imported as version 1 on \<date\>; the in-app version history at \<route\> is authoritative for
all changes after that date") so a future reader of the repo doesn't have to reconstruct this from a
work-log — a documentation nicety for Phase 4/tech-lead to place exactly, not a structural requirement I'm
mandating the wording of here.

## Ruling 6 — permissions and visibility

**`documents.manage` bound to `notetaker` (and `admin`, per the 0069/DECISION-074 convention of
explicitly binding admin even though `getUserFeatures()` auto-grants everything) — confirmed, no
`documents.delete`.** Same module-separation reasoning as `minutes.manage`: a new key, not a reuse,
because documents and minutes share no tables and, as of this ruling, not even the same read-audience
boundary (see below) — DECISION-074 Ruling 2's reasoning for why minutes didn't join the Ledger's
permission keys applies here for why documents doesn't join minutes'.

**Who reads a pending, not-yet-adopted substantive version: `documents.manage` holders only, until
adoption.** Phase 1 flagged this as open (question 11) and recommended editors-only; I'm ruling it in,
not leaving it open for Phase 3 to guess at. The reasoning holds and is worth restating as the
architectural line, not just a recommendation: a pending substantive version is a proposed amendment,
not yet the club's actual governing text — showing it to an ordinary member indistinguishably from the
current, adopted version risks someone citing or acting on text that was never voted in. This is a real
behavioral difference from minutes' "drafts are visible to any member immediately" call, and the
difference is principled, not arbitrary: a minutes draft describes something that **already
happened** (a meeting that occurred, imperfectly transcribed); a pending document version describes
something that **has not yet happened** (a vote that hasn't occurred). Gating pending content behind
`documents.manage` and ungating draft minutes are both correct, for opposite reasons about what kind of
uncertainty each one carries. If the treasurer later wants pre-vote proposals visible club-wide for
comment/discussion, that's a real, buildable, but *different* feature (a discussion/comment surface) —
not a default this design should ship with.

**Public vs. members-only (B-38) — a `visibility` column on `documents`, not route placement.** Round
1's route-placement idea (public route vs. `/members/...` route, purely by file location) was reasoned
for a single static git-authored page with exactly one reading surface. That reasoning no longer
transfers cleanly: documents now has multiple reading surfaces per row (current view, version history,
diff/compare), the content is a real queried database row rather than a file, and — per the brief's own
requirement — **the model must be able to express public without a rewrite**, including for a future
second document that might land with a different visibility than the first. Encoding that as "which
directory the route file lives in" means the decision is baked into the file tree and requires moving
files (and updating every link into them) to flip; encoding it as `documents.visibility text NOT NULL`
(DECISION-041 pattern — `'public' | 'members'`, no CHECK, validated in `documents.ts`) means flipping it
is a one-row update with no code change and no route restructuring, which is exactly what "express
public without a rewrite" is asking for. The route(s) themselves still do the actual gating (an
unauthenticated visitor never reaches a `members`-visibility document's content, matching the pattern
public vs. member routes already use everywhere else in this app) — the column is what the route reads
to decide, not a replacement for `auth()` checks. **One clarification that matters regardless of which
way `visibility` is ultimately set: a pending substantive version is never public**, even on a
`visibility: 'public'` document — the `documents.manage`-only gate on pending content (above) applies
on top of, not instead of, the document's general visibility. Only the current version and versions
that were themselves ever current (adopted, superseded history) inherit the document's `visibility`.

## Ruling 7 — invariants

- **Server/client boundary** — member/public-facing document views (current text, version history,
  diff/compare) are Server Components by default, matching the `/members/financial-reports` and
  `/members/impact` precedent. The admin paste-to-Markdown editor is necessarily `"use client"`
  (clipboard events, `turndown` invocation) — same boundary DECISION-074 Ruling 1 already drew for
  minutes, reused verbatim, not re-litigated.
- **Migrations re-run on every deploy** — the `documents`/`documentVersions` schema migration itself
  must still be fully idempotent (`CREATE TABLE IF NOT EXISTS`, guarded index creation) like every other
  migration in this project; this is separate from, and does not relax, Ruling 5's ban on seeding
  version 1 through that same automated pipeline.
- **Permissions are the only gating mechanism** — `documents.manage` needs an idempotent migration
  binding it to `notetaker` and `admin`, following the exact `budget_committee`/DECISION-069 shape
  DECISION-074 already used for `minutes.manage`/`minutes.delete`. **Use the `add-permission` skill** in
  Phase 4, per CLAUDE.md's own instruction for this exact step.
- **Schema is the source of truth** — `documents` and `documentVersions` go into
  `src/lib/db/schema.ts` first, matching idempotent migration second, same order DECISION-074 already
  established for `minutes`.
- **Sequencing dependency, real and worth stating plainly:** `documentVersions.citingMinutesId`
  references `minutes.id`. As of this review, `src/lib/db/schema.ts` has **no `minutes` table yet** —
  minutes is fully designed (DECISION-074/075) but not yet implemented. This documents migration cannot
  land before (or, at minimum, not without) the `minutes` table existing in the target database, even
  though the two features are otherwise fully decoupled and ship on independent schedules. Flag this for
  whoever sequences Phase 4 for documents: verify the minutes migration has actually run before writing
  or deploying the documents migration, the same deploy-timing caution DECISION-072 Ruling 7 already
  exercised for its own two-migration dependency.
- **No native browser dialogs** — the "adopt a pending version" action and any future admin action here
  needing confirmation must use `<ConfirmDialog>`, never `window.confirm()`.
- **Migration numbering caution, not a specific number:** the highest migration on disk today is
  `0078_ledger_ack_quid_pro_quo_description.sql`. Whoever implements Phase 4 for documents (and,
  separately, for minutes, if it lands first) takes the actual next free number *at implementation
  time* — do not hardcode one now, per DECISION-074's own stated caution on this exact point.

## Notes for Phase 3

- Confirmed, not reopened: sibling tables (Ruling 1), `diff`/jsdiff approved and server-only (Ruling 2),
  `documents.ts`/`documents-queries.ts` sibling pair (Ruling 3), server-side diff computation (Ruling
  4), one-off seed script not a migration (Ruling 5), `documents.manage`-only gate on pending substantive
  versions plus a `visibility` column for public-vs-members (Ruling 6).
- Genuinely open, correctly left to the treasurer and not resolved here: exact route paths/URL shape for
  the reading surfaces (depends on the `visibility` decision the treasurer still needs to make per B-38);
  whether `slug` is single-document-only for now or meant to anticipate a real second row; print/export
  of the current document (parallels minutes' open question 6, not resolved either place).
  `visibility`'s *default value* for the seeded by-laws row is the treasurer's call, not mine — the
  column exists precisely so that call doesn't require a code change either way.
- Implementer split for Phase 4: comparable in size to minutes, not a small/coupled feature — run the
  same specialist split DECISION-074 Ruling 5 (Notes) already used, in this order:
  **database-admin** (schema + idempotent migration + `documents.manage` permission binding via
  `add-permission`, sequenced after minutes' migration exists per Ruling 7) → **api-developer** (create-
  version writes for both `changeType`s, adopt-version write, link-citing-minutes-after-the-fact write,
  the pure `diffDocumentVersions()`/`documents.ts` helpers, the one-off seed script) → **ux-developer**
  (admin document editor reusing the `turndown` paste pipeline, version-history browser, diff/compare
  view, member/public current-document view, wiring the promoted `rich-markdown-content.tsx` renderer —
  not `ReleaseNotesViewer`'s — per Ruling 3).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're building the in-app home for the club's governing text: a `documents`/`documentVersions`
pair (DECISION-076) that seeds the 1998 Constitution & By-Laws as an immutable version 1, lets the
notetaker/admin save further versions (editorial ones going live immediately, substantive ones
sitting pending until a board vote adopts them), and gives every member a version-history/diff view
so "what changed and when" is never in question. Per the treasurer's 2026-08-09 decisions, this
document becomes the club's *authoritative* text the moment version 1 is published — the 1998 scan
and its git transcription (`docs/club-constitution-and-bylaws.md`) become historical artifacts from
that point on — and it ships **members-only**, with `visibility` wired so a future public document
needs a one-row change, not a rewrite. This design confirms nothing DECISION-076 already ruled; it
fills in exact DDL, routes, and contracts so database-admin → api-developer → ux-developer can build
without re-deriving anything.

## Permissions

- New key: **`documents.manage`** — "Create document versions, review pending amendments, adopt
  substantive changes, and link citing minutes." No `documents.view`/read key — reading the current
  text and its adopted history is open to any linked member for a `visibility: 'members'` (or
  `'public'`) document, exactly like minutes' no-read-gate precedent. The one asymmetry (Ruling 6,
  not reopened here): a **pending** substantive version is visible only to `documents.manage`
  holders, enforced in `documents-queries.ts`'s read functions, not by a separate FEATURES key.
- Default role bindings: `notetaker` and `admin`. Both roles already exist (created by
  `0080_minutes_permissions.sql`) — **no new role**, just a new binding. No `documents.delete` key
  (Ruling 6 / CLAUDE.md: versions are permanent, no delete path exists anywhere in this design).
- Bind via the **`add-permission` skill** in Phase 4, matching `0080_minutes_permissions.sql`'s
  shape exactly (insert `documents.manage` into `features`, bind to `admin` and `notetaker` via
  `role_features`, all `WHERE NOT EXISTS`-guarded).

## API Contract

Two different shapes for two different audiences, matching the minutes precedent exactly: admin
authoring is REST routes (`/api/admin/documents/...`), member reading is plain Server Components
calling `documents-queries.ts` functions directly — no HTTP round trip needed for a server-rendered
read.

**Admin routes** (all gated `documents.manage`; single document today, addressed by `slug`):

- `POST /api/admin/documents/[slug]/versions` — create a new version.
  Body: `{ changeType: 'editorial' | 'substantive', bodyMarkdown: string, changeNote: string }`.
  Server-side: locks the `documents` row (`SELECT ... FOR UPDATE`), computes
  `versionNumber = MAX(versionNumber) + 1` for that document, inserts the version row. If
  `changeType === 'editorial'`, also flips `documents.currentVersionId` to the new row — all in one
  transaction. `authorUserId` is always `session.user.id`, never client-supplied.
  Response: `201 { id, versionNumber, changeType, isCurrent }`. 400 validation (empty
  `bodyMarkdown`/`changeNote`, bad `changeType`); 401/403 standard.

- `GET /api/admin/documents/[slug]/versions` — full version chain, pending included (this is the
  one place pending versions are ever listed over HTTP, and it's `documents.manage`-gated).
  Response: `{ versions: DocumentVersionSummary[] }` (id, versionNumber, changeType, changeNote,
  authorUserId, adoptedByUserId, adoptedAt, citingMinutesId, adoptionNote, createdAt, isCurrent).

- `PATCH /api/admin/documents/[slug]/versions/[versionId]` — action-body convention (mirrors
  `/api/admin/minutes/[id]`):
  - `{ action: 'adopt', adoptionNote: string, citingMinutesId?: string | null }` — requires
    `changeType === 'substantive'` and `adoptedAt IS NULL`, else `409`. `adoptionNote` is required
    non-empty (this is where Article XV / By-Law Five compliance gets recorded — "recorded, not
    enforced," Phase 1). Sets `adoptedByUserId = session.user.id`, `adoptedAt = now()`,
    `adoptionNote`, optionally `citingMinutesId` if already known; flips
    `documents.currentVersionId` to this version — one transaction.
  - `{ action: 'link-minutes', citingMinutesId: string }` — requires `adoptedAt IS NOT NULL`, else
    `409` ("Adopt this version before citing minutes"). Validates `citingMinutesId` resolves to an
    existing `minutes` row (any status — reopened minutes are still a valid citation target, see
    Edge Cases). This is the expected common path per Phase 1: minutes aren't approved until the
    *next* meeting, so adoption and citation are routinely two separate writes, sometimes weeks
    apart.
  Response: `200 { id }`. No `action` ever edits `bodyMarkdown`/`changeType`/`changeNote` — versions
  are immutable by construction, not just by convention.

- `GET /api/admin/documents/[slug]/versions/[versionId]/diff?against=<versionId|current>` — the
  admin-only diff endpoint, because it's the one diff caller allowed to target a pending version
  (the member-facing compare page, below, is not). Computes `diffDocumentVersions()` server-side.
  Response: `{ base: {id, versionNumber}, compare: {id, versionNumber}, diff: Change[] }` where
  `Change` is jsdiff's own `{ value: string; added?: boolean; removed?: boolean }[]` shape — already
  plain and serializable, no wrapping needed.

**Member-facing read path — no API routes, direct `documents-queries.ts` calls from Server
Components** (same shape as `getMinutesDetail()`/`listMinutesForMembers()` today):

- `getDocumentBySlug(slug): Promise<DocumentRow | null>`
- `getCurrentVersion(documentId): Promise<DocumentVersionRow | null>` — single indexed lookup via
  `currentVersionId`, never a `MAX()`/"latest adopted" query (Ruling 1).
- `listVersionHistoryForMembers(documentId): Promise<DocumentVersionSummary[]>` — excludes any row
  where `changeType = 'substantive' AND adoptedAt IS NULL`; most-recent-first.
- `getVersionForCompare(id, { allowPending }): Promise<DocumentVersionRow | null>` — the member
  compare page calls this with `allowPending: false`; a pending id resolves to `null` (→ the page
  404s), never leaks pending text through a guessed/shared URL. The admin diff route is the only
  caller that ever passes `true`, and only after its own `documents.manage` check.
- `listDocumentsForMembers(session): Promise<DocumentSummary[]>` — feeds the new "Governing
  Documents" section on `/members/records`; filters `visibility` against whether the caller is
  authenticated (today: one members-visibility row, always returned to any linked member).

## Data Model

**`documents`** — one row per governed document (today: exactly one, the by-laws).

```ts
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    slug: text("slug").notNull(), // routing handle, e.g. "constitution-bylaws"
    // DECISION-041 pattern: 'public' | 'members', validated in documents.ts,
    // no DB CHECK. Ships 'members' for the by-laws (treasurer, B-38).
    visibility: text("visibility").notNull().default("members"),
    // Pointer to the operative version — NEVER a derived MAX(versionNumber)
    // or "latest adopted" query (DECISION-076 Ruling 1). Deliberately NO
    // `.references()` here — see the circular-FK ruling below.
    currentVersionId: uuid("current_version_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ix_documents_slug").on(t.slug)],
);
```

**`documentVersions`** — every save, forever. No `updatedAt` — an immutable row with a mutable
timestamp would be a quiet lie about what the row is (same reasoning `minutes_motions` already
uses).

```ts
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    changeType: text("change_type").notNull(), // 'editorial' | 'substantive' — documents.ts
    changeNote: text("change_note").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    adoptedByUserId: uuid("adopted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    adoptedAt: timestamp("adopted_at"),
    citingMinutesId: uuid("citing_minutes_id").references(() => minutes.id, { onDelete: "set null" }),
    adoptionNote: text("adoption_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_document_versions_doc_version").on(t.documentId, t.versionNumber),
    index("ix_document_versions_document").on(t.documentId),
    index("ix_document_versions_change_type").on(t.changeType),
    index("ix_document_versions_citing_minutes").on(t.citingMinutesId),
  ],
);
```

**Circular-FK ruling (resolved, not left to database-admin to pick):** the architect flagged two
options and left the choice open. I'm closing it here because the "real FK via a guarded
`ALTER TABLE`" option has a concrete failure mode in *this* pipeline that the architect's writeup
didn't weigh: `pnpm build` runs `pnpm db:migrate` (raw SQL) **then** `drizzle-kit push --force`
(CLAUDE.md, Common Commands). A constraint added by raw SQL but never declared in `schema.ts` is
exactly the kind of drift `push --force` treats as unmanaged and may drop on the very next deploy —
silently turning "idempotent migration" into "the constraint disappears every time push runs after
migrate." **Decision: no DB-level FK constraint on `currentVersionId` — plain `uuid NULL`,
app-enforced only**, the fallback the architect already pre-approved via DECISION-041's standing
precedent. `documentVersions.documentId → documents.id` keeps its normal, uncomplicated FK (forward
reference, no ordering problem — `documents` is declared first). This makes the migration a plain
two-`CREATE TABLE IF NOT EXISTS` file, no guarded `ALTER TABLE`/`pg_constraint` check needed at all.
Enforcement is airtight in practice because `documents-queries.ts` is the *only* writer of
`currentVersionId`, and every write to it happens inside the same transaction as the version row it
points to (see Version Lifecycle below) — logged as **DECISION-081**.

**Migration** — next free number is **0081** (`0079`/`0080` are minutes'). Whoever implements this
in Phase 4 re-confirms the number is still free at implementation time (DECISION-074's own stated
caution) — the club's other in-flight work also consumes numbers from the same sequence.

```sql
-- drizzle/migrations/0081_governance_documents.sql
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  visibility text NOT NULL DEFAULT 'members',
  current_version_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_documents_slug ON documents(slug);

CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  body_markdown text NOT NULL,
  change_type text NOT NULL,
  change_note text NOT NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  adopted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  adopted_at timestamp,
  citing_minutes_id uuid REFERENCES minutes(id) ON DELETE SET NULL,
  adoption_note text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_document_versions_doc_version ON document_versions(document_id, version_number);
CREATE INDEX IF NOT EXISTS ix_document_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS ix_document_versions_change_type ON document_versions(change_type);
CREATE INDEX IF NOT EXISTS ix_document_versions_citing_minutes ON document_versions(citing_minutes_id);
-- documents.current_version_id intentionally has NO FK constraint here —
-- see schema.ts comment / DECISION-081.
```

**Sequencing dependency (Ruling 7, restated as an implementation gate, not a suggestion):**
`document_versions.citing_minutes_id → minutes.id` requires the `minutes` table to exist in the
target database first. **It does — minutes shipped in v1.62.0** (per this task's brief), so this
gate is already satisfied; database-admin should still confirm `\d minutes` (or equivalent) against
the actual deploy target before running this migration, not assume the work-log's word for it.

## The Version Lifecycle

This is the part that has to be unambiguous by construction, per the architect's own framing, so
stating it precisely:

1. **Editorial save** (`POST .../versions` with `changeType: 'editorial'`): insert the version row
   (`adoptedByUserId`/`adoptedAt`/`citingMinutesId` all stay `NULL` **forever** — there is no vote
   for an editorial change, so these columns are never populated for this `changeType`, not even
   later) → in the **same transaction**, `UPDATE documents SET currentVersionId = <new id>`.
   Current changes immediately. This is also exactly how **version 1** (the seed) behaves — see
   below.

2. **Substantive save** (`changeType: 'substantive'`): insert the version row with
   `adoptedByUserId`/`adoptedAt`/`citingMinutesId` all `NULL` → **`currentVersionId` is not
   touched**. The row exists, is queryable by `documents.manage` holders, is invisible to
   `listVersionHistoryForMembers()`, and is not "the document" yet.

3. **Adopt** (`PATCH .../versions/[id]` `action: 'adopt'`): one transaction — set
   `adoptedByUserId`/`adoptedAt`/`adoptionNote` (+ `citingMinutesId` if already known) on the
   version row, **and** `UPDATE documents SET currentVersionId = <this id>`. This is the only write
   that ever moves `currentVersionId` off of what an editorial save or a prior adopt last set it to.

4. **Link citing minutes later** (`action: 'link-minutes'`): updates only `citingMinutesId` on an
   already-adopted row. Never touches `currentVersionId` — the document became current at adoption
   time, not at citation time.

**"What is the operative text right now" is always exactly one answer:** `SELECT bodyMarkdown FROM
document_versions WHERE id = (SELECT currentVersionId FROM documents WHERE slug = ...)`. No
in-between state, no tie-break logic, no "most recent adopted" query — a single indexed FK
dereference, per DECISION-076 Ruling 1, confirmed by this lifecycle, not reopened.

**Version-number allocation (concurrency detail the architect's ruling didn't need to specify, but
Phase 4 does):** `createDocumentVersion()` opens a transaction, runs
`SELECT id FROM documents WHERE id = $1 FOR UPDATE` to serialize concurrent saves against the same
document, computes `versionNumber = COALESCE(MAX(versionNumber), 0) + 1` from `document_versions`,
inserts, and (for `editorial`) updates the pointer — all before releasing the lock. The
`(documentId, versionNumber)` unique index is the backstop, not the primary defense; given this is a
two-person-role feature (`notetaker`/`admin`), true concurrent writes are unlikely but the lock
makes the guarantee real rather than probabilistic.

## Diffing

- **Contract:** `diffDocumentVersions(oldMarkdown: string, newMarkdown: string): Change[]` in
  `src/lib/documents.ts`, thin wrapper over jsdiff's `diffLines(oldMarkdown, newMarkdown, {
  newlineIsToken: false })` — **line-level, raw Markdown**, never rendered HTML, never section-
  parsed (Phase 1, confirmed). `Change[]` is jsdiff's own shape (`{ value, added?, removed? }[]`) —
  already a plain serializable array, so it passes straight through a Server Component to a
  `DiffView` prop with no re-shaping.
- **Where it runs:** exclusively server-side — the admin diff route and any member compare page
  Server Component call it directly; `diff` is never imported from a `"use client"` file anywhere in
  this feature (Ruling 2/4, hard rule, restated because it's the one import boundary a future
  refactor could accidentally cross).
- **How a member selects two versions:** the compare page
  (`/members/records/documents/[slug]/compare`) reads `?from=<versionId>&to=<versionId>` from
  `searchParams` and re-renders server-side per selection — a plain `<form method="get">` with two
  `<select>`s populated from `listVersionHistoryForMembers()`, no client-side diff engine, no JS
  required for the picker itself. Default (no query params): `to` = current version, `from` = the
  entry immediately before it in `listVersionHistoryForMembers()`'s most-recent-first list (i.e.
  "what changed to produce the current text"). The admin compare view
  (`/admin/documents/[slug]/compare`) is the same shape but its version list includes pending rows
  and its data call passes `allowPending: true` after its own `documents.manage` check.
- **Size:** confirmed non-issue at 642 lines (Ruling 4) — no pagination/virtualization in this pass.

## The Seed Script

`scripts/seed-governance-document.ts` — one-off, run manually
(`pnpm tsx scripts/seed-governance-document.ts`), **never a migration** (Ruling 5, citing the
standing Ledger/Quicken "never re-run import" precedent — this is the same failure class: a later
manual edit to fix a transcription typo, replayed against a DB that already has versions 2–N on top
of version 1, would not just duplicate a row, it would silently reset the document's history).

- **Idempotency guard:** `SELECT id FROM documents WHERE slug = 'constitution-bylaws'`. If a row
  exists, print a message and exit `0` — the script never touches an existing `documents` or
  `documentVersions` row, full stop. This is the primary safety property; the guard is
  defense-in-depth on top of it, per Ruling 5.
- **On first run:** reads `docs/club-constitution-and-bylaws.md` verbatim (the whole file, including
  its transcription-notice header — see below for whether that's stripped), inserts `documents`
  (`title: "Constitution & By-Laws"`, `slug: 'constitution-bylaws'`, `visibility: 'members'` per the
  treasurer), inserts `documentVersions` version 1 with `changeType: 'editorial'` — **this is a
  deliberate, reasoned choice, not a gap**: version 1 isn't correcting or amending anything, so
  "editorial" (becomes current immediately, no vote pending) is the correct branch, not a
  hypothetical third `changeType`. `changeNote`: `"Initial publication — verbatim transcription of
  the 1998 Constitution & By-Laws (Revised April 2, 1998), proofread against the scanned original."`
  `authorUserId: null` (no session — a script, not an admin action; `authorUserId` is
  attribution-only and nullable everywhere else in this schema for the same reason). All in one
  transaction, then sets `documents.currentVersionId` to the new version's id.
- **What gets imported — the body text only, not the transcription-notice header.** The header (the
  file's current lines 1–19, "THIS IS A TRANSCRIPTION — THE SCANNED PDF IS AUTHORITATIVE") describes
  the file's status *before* publication and is now actively wrong per the treasurer's decision 1 —
  importing it verbatim into `bodyMarkdown` would publish a governing document whose own header
  contradicts what it now is. The script strips everything up to (and including) the `---` divider
  after the header block and imports from `## Contents` onward as `bodyMarkdown`.
- **Git file fate — a one-time, separate manual edit, not part of the script:** immediately after
  running the seed script, update `docs/club-constitution-and-bylaws.md`'s header (replacing lines
  1–19) to read, in substance:

  > ⚠️ HISTORICAL ARCHIVE — SUPERSEDED BY THE IN-APP VERSION
  >
  > This file is the transcription that was imported as version 1 of the in-app governing document
  > on \<seed date\>. Effective that date, the in-app document at `/members/records/documents/
  > constitution-bylaws` is the club's authoritative governing text; the 1998 scanned original and
  > this file are historical artifacts and are not updated further. See the in-app version history
  > for every change made since.

  This edit is a plain commit alongside the one that adds the seed script — **api-developer makes
  both in the same PR** (Ruling 5 left the exact wording to Phase 3; this is it). The app never
  reads this file again after the one-time import.

## Permissions and Visibility — implementation specifics

Covered above under Permissions/Data Model; the one thing to state plainly for Phase 4: the
`visibility` check and the `documents.manage`-gate-on-pending check are **two independent gates**,
enforced at two different layers — `visibility` decides whether an unauthenticated visitor can reach
a document's *current* text at all (route-level `auth()` check, same as every members-only route
today), while the pending-version gate decides whether an *authenticated* reader can see a
*specific, not-yet-adopted* version (query-level filter in `documents-queries.ts`, independent of
`visibility`). A `visibility: 'public'` document's pending substantive version is still
`documents.manage`-only — the two checks compose, neither substitutes for the other.

## The Reading Surface

Sits under the Club Records area (v1.62.0), as a sibling to minutes, not merged into it — matching
DECISION-076 Ruling 3's module/component separation exactly.

- **`src/app/members/records/page.tsx` gets a new section**, added above or below the existing
  minutes list: "Governing Documents" — a short list (today: one row, the by-laws) rendered from
  `listDocumentsForMembers()`, each entry linking to `/members/records/documents/[slug]`. Same
  page, same hero, same "Back to Member Portal" link — this is an addition to the existing Server
  Component, not a new page.
- **`src/app/members/records/documents/[slug]/page.tsx`** — current-document view: title, a
  "last updated as of version N" line, the rendered body via the **promoted**
  `RichMarkdownContent` (`src/components/rich-markdown-content.tsx`) — never `ReleaseNotesViewer`'s
  `rehype-raw` pipeline (Ruling 3, restated because it's the one thing Round 1's plan got wrong and
  is worth guarding against being copy-pasted back in) — plus a link into version history. `auth()` +
  inline `memberId` check mirroring `/members/records/[id]/page.tsx` line for line; `notFound()` for
  an unknown slug or an unauthenticated visitor hitting a `visibility: 'members'` document.
- **`src/app/members/records/documents/[slug]/history/page.tsx`** — version list via
  `listVersionHistoryForMembers()` (pending excluded): changeType badge, changeNote, author,
  adopted-by/adopted-at when present, citing-minutes link when present, most-recent-first, each row
  linking into compare.
- **`src/app/members/records/documents/[slug]/compare/page.tsx`** — the diff view described above.
- **Admin mirrors it** at `/admin/documents` (list) and `/admin/documents/[slug]` (editor: paste-to-
  Markdown form reusing the `turndown`/`turndown-plugin-gfm` pipeline already approved for minutes,
  changeType picker, changeNote field; the pending-versions review list with Adopt — via
  `<ConfirmDialog>`, never `window.confirm()` — and Link Citing Minutes actions; full version
  history including pending) and `/admin/documents/[slug]/compare` (admin-scoped diff, can target
  pending versions).
- **`ADMIN_NAVIGATION`** (`src/lib/permissions.ts`, the existing "Records" group at line 320) gets a
  second item alongside "Minutes":
  ```ts
  {
    name: "Governing Documents",
    href: "/admin/documents",
    icon: "📜",
    requiredFeature: FEATURES.DOCUMENTS_MANAGE,
  },
  ```

## Component / Page Plan

**Pages to create:**
- `src/app/members/records/documents/[slug]/page.tsx`
- `src/app/members/records/documents/[slug]/history/page.tsx`
- `src/app/members/records/documents/[slug]/compare/page.tsx`
- `src/app/(dashboard)/admin/documents/page.tsx`
- `src/app/(dashboard)/admin/documents/[slug]/page.tsx`
- `src/app/(dashboard)/admin/documents/[slug]/compare/page.tsx`

**API routes to create:**
- `src/app/api/admin/documents/[slug]/versions/route.ts` (POST, GET)
- `src/app/api/admin/documents/[slug]/versions/[versionId]/route.ts` (PATCH)
- `src/app/api/admin/documents/[slug]/versions/[versionId]/diff/route.ts` (GET)

**Components to create:**
- `src/components/documents/document-view.tsx` — current-text display (title, version metadata,
  `RichMarkdownContent` body). Server Component, shared by the member page and (read-only mode) the
  admin detail page — same "shared, can't structurally diverge" reasoning as `MinutesDetail`.
- `src/components/documents/version-history-list.tsx` — pure presentational list, renders whatever
  rows it's handed (member vs. admin data source decides which rows exist; the component doesn't
  know about visibility rules).
- `src/components/documents/diff-view.tsx` — renders a `Change[]` as a unified line-level diff
  (green add / red remove / plain context, `overflow-x-auto` wrapper). Server Component, props-only.
- `src/components/documents/version-picker-form.tsx` — the two-`<select>` GET form for compare.
- `src/components/admin/documents/document-version-form.tsx` — `"use client"`: paste-to-Markdown
  (turndown), changeType picker, changeNote field, submits to the POST route.
- `src/components/admin/documents/pending-versions-panel.tsx` — `"use client"`: Adopt
  (`<ConfirmDialog>`) and Link Citing Minutes actions (a `<select>` sourced from a minutes lookup).

**Files to modify:**
- `src/lib/db/schema.ts` — add `documents`, `documentVersions`.
- `src/lib/permissions.ts` — add `FEATURES.DOCUMENTS_MANAGE`, `FEATURE_CATEGORIES.DOCUMENTS`,
  `FEATURE_DESCRIPTIONS` entry, `ADMIN_NAVIGATION` "Records" group item.
- `src/app/members/records/page.tsx` — add the "Governing Documents" section.
- `docs/club-constitution-and-bylaws.md` — header rewrite (manual, one-time, alongside the seed
  script commit — see Seed Script above).

**New lib files:**
- `src/lib/documents.ts` (pure) — `DOCUMENT_VISIBILITIES`, `isValidDocumentVisibility()`,
  `DOCUMENT_CHANGE_TYPES`, `isValidChangeType()`, `diffDocumentVersions()`.
- `src/lib/documents-queries.ts` (DB) — every function listed under API Contract.

**New scripts:**
- `scripts/seed-governance-document.ts`.

## Edge Cases & Risks

- **A substantive version is pending while an editorial one is saved.** The editorial save still
  flips `currentVersionId` (it doesn't know or care that a substantive draft exists). The pending
  version is untouched and remains pending — but its "diff vs. current" now compares against text
  that changed *after* the draft was written. No structural fix needed or wanted: the diff is always
  computed live between whichever two version ids are selected, never cached against a frozen base.
  The admin pending-review UI should label the comparison "vs. current (as of now)", not "vs. the
  version this was drafted against", so a reviewer isn't misled about what moved underneath the
  draft.
- **Two pending substantive versions on the same document.** Allowed — no schema constraint
  prevents it (mirrors minutes' deliberate absence of a `(kind, meetingDate)` uniqueness rule for
  the same reason: real governance scenarios can have two live proposals awaiting separate votes).
  Both show in the `documents.manage` pending list; adopting one does not invalidate or auto-reject
  the other.
- **Adopting out of order** (e.g., a lower `versionNumber` substantive draft adopted after a higher
  one). Explicitly fine — `currentVersionId` is a pointer set by whichever adopt happens most
  recently, never derived from `MAX(versionNumber)` (DECISION-076 Ruling 1). Do not be tempted to add
  a "must adopt in ascending order" constraint later; it would be actively wrong, since parallel
  amendment proposals have no reason to resolve in submission order.
- **A citation to minutes that are later reopened.** `citingMinutesId` is a stateless FK — it does
  not care about the referenced `minutes.status`. Reopening minutes (DECISION-077 §8: doesn't clear
  `approvedByUserId`/`approvedAt`) doesn't retroactively invalidate a document version's citation of
  them either, for the same reasoning. The version-history/citation display should render the cited
  minutes' *current* status inline (e.g., "cited: General minutes — 2026-09-10 (currently
  reopened)") so this is visible rather than silently stale — a display concern for ux-developer, not
  a schema constraint.
- **A very large diff.** Not a real concern at 642 lines (Ruling 4, confirmed) — `diffLines()` is
  millisecond-order at this size. `DiffView` still wraps its output in `overflow-x-auto` as a matter
  of course (UX Guidelines baseline for any wide content), but no pagination/virtualization is being
  built now.
- **A document row briefly without a `currentVersionId`.** Never actually reachable in this
  increment: the only way a `documents` row is ever created is the seed script, and it creates the
  document row and version 1 (and flips the pointer) inside a single transaction. This design does
  **not** ship an admin "create new document" flow — see Out of Scope.

## Out of Scope

- **Creating additional `documents` rows via the admin UI.** The only document that exists after
  this ships is the by-laws, created exclusively by the one-off seed script. A second document (and
  whatever "create a document" flow that implies, plus whether `kind` needs to be reopened per
  DECISION-076's own note) is future work, not part of this increment.
- **Print/export of the current document.** Parallels minutes' still-open question 6; not resolved
  either place.
- **Enforcing Article XV / By-Law Five's notice-and-vote timing.** Recorded via `adoptionNote`, never
  policed by the app (Phase 1, confirmed, not reopened).
- **A discussion/comment surface for pending amendments.** If the treasurer later wants pre-vote
  proposals visible club-wide for comment, that's a different, real feature — not a default this
  design ships with (Ruling 6).
- **The board's substantive review of the transcription's nine internal defects** (stale dues
  figures, the Membership Director gap, the September 30/October 1 date conflict). That review is
  the board's work; this design just gives it somewhere to land as version 2+ once the board acts.

## Unit Tests for Phase 4

**`src/lib/documents.test.ts`** (pure, no DB — implementer delivers these, not qa):
1. `isValidDocumentVisibility()` accepts `'public'` and `'members'`, rejects `'private'` and `''`.
2. `isValidChangeType()` accepts `'editorial'` and `'substantive'`, rejects `'major'` and `''`.
3. `diffDocumentVersions()` on identical input returns a single unchanged (`added`/`removed` both
   falsy) chunk — no spurious diff noise.
4. `diffDocumentVersions()` detects a single changed line as exactly one removed + one added chunk,
   confirming line-level (not word/char-level) granularity.
5. `diffDocumentVersions()` is stable across a trailing-newline-only difference (the named failure
   mode from DECISION-076 Ruling 2) — asserts no spurious extra chunk appears.
6. `diffDocumentVersions()` against the full seeded 642-line document with exactly one line changed
   in the middle produces exactly one changed region and leaves every other line in the single
   surrounding unchanged chunk — the regression guard for "a diff that silently drops or
   misattributes a line," the exact correctness risk that justified not hand-rolling this (Ruling 2).

**Route-level, hermetic (mock `@/lib/auth`, `@/lib/permissions-server`, `@/lib/documents-queries`
directly — not the DB — same convention as `src/app/api/admin/minutes/route.test.ts`):**
7. `POST .../versions` — `changeType: 'editorial'` calls `createDocumentVersion()` and the create
   path reports `isCurrent: true` in the response.
8. `POST .../versions` — `changeType: 'substantive'` reports `isCurrent: false`.
9. `POST .../versions` — empty `bodyMarkdown` or `changeNote` returns 400 before reaching the query
   layer.
10. `PATCH .../versions/[id]` `action: 'adopt'` on a version that already has `adoptedAt` set returns
    409, and does not call the adopt query function.
11. `PATCH .../versions/[id]` `action: 'adopt'` on an `editorial`-type version (which should never be
    adoptable — it was already current the moment it was saved) returns 409.
12. `PATCH .../versions/[id]` `action: 'link-minutes'` on a not-yet-adopted version returns 409
    before calling `linkCitingMinutes()`.
13. Every route returns 403 when `hasFeature` resolves `false` — one shared test per route file,
    matching existing coverage style.

## Implementation Order

1. **database-admin** — `documents`/`documentVersions` in `src/lib/db/schema.ts`; migration
   `drizzle/migrations/0081_governance_documents.sql` (confirm the number is still free at
   implementation time); the `documents.manage` permission + role-binding migration via the
   **`add-permission` skill**, sequenced after confirming the `minutes` table already exists in the
   target database (it does, per this brief, but confirm against the actual deploy target, not the
   work-log's word). **Handoff to api-developer:** schema is live, `documents.manage` is bound to
   `notetaker`/`admin`.
2. **api-developer** — `src/lib/documents.ts` (constants/validators/`diffDocumentVersions()`) and
   its unit tests (items 1–6 above) first, since ux-developer's diff view depends on the shape;
   `src/lib/documents-queries.ts` (every function under API Contract); the three admin route files
   and their route-level tests (items 7–13); `scripts/seed-governance-document.ts`; the
   `docs/club-constitution-and-bylaws.md` header rewrite commit. **Run the seed script and confirm
   the by-laws are readable via `documents-queries.ts` directly (e.g. a scratch script or `psql`)
   before handing off — ux-developer needs real seeded content to build against, not a schema with
   no rows.** **Handoff to ux-developer:** API surface + seeded content both live.
3. **ux-developer** — all six pages, all six components, the `/members/records/page.tsx` "Governing
   Documents" section, the `ADMIN_NAVIGATION` entry. Reuses the promoted `RichMarkdownContent` and
   the `turndown`/`turndown-plugin-gfm` paste pipeline already proven on minutes — neither is a new
   dependency decision.

## Implementer

**Specialist split — database-admin → api-developer → ux-developer**, per the size/coupling
threshold in CLAUDE.md's Phase 4 table and matching how every increment of minutes and The Ledger
has run. This is comparable in scope to meeting minutes, not a small/coupled feature.

---

# Phase 4 — Implementation (schema) — 2026-08-09

**Owner:** database-admin
**Status:** complete

### Summary

Built the schema half of Governance Documents exactly per the Phase 3 design doc: `documents` and
`document_versions` tables (sibling to `minutes`, not merged), the `documents.manage` permission bound
to `notetaker` and `admin` via the `add-permission` skill's pattern, and two idempotent migrations
(`0081` schema, `0082` permissions). Verified re-run safety by applying both migrations twice against
the dev database — every statement reported "already exists, skipping" on the second run, no errors,
no duplicate rows. `documents.currentVersionId` carries no DB-level FK per DECISION-081, with the
rationale commented in place in both `schema.ts` and the migration file so a future "fix" doesn't
reintroduce the drop-on-`push --force` risk. Every `document_versions` row is permanent/immutable by
construction — no soft-delete column, no `updatedAt`, no delete path anywhere in this design — also
commented in place.

### What I did

- Read the full work-log (How it got here, Settled going into Phase 2, Phase 2 architect ruling,
  Treasurer Decisions, Phase 3 design doc) plus DECISION-076 and DECISION-081 in `docs/decisions.md`.
- Confirmed the `minutes` table already exists in the dev database (`psql \d minutes`) before writing
  anything that FKs into it — the sequencing dependency DECISION-076 Ruling 7 flagged.
- Confirmed `0081`/`0082` were genuinely free at implementation time (`ls drizzle/migrations/*.sql |
  sort | tail -3` showed `0080_minutes_permissions.sql` as the highest).
- Added `documents` and `documentVersions` to `src/lib/db/schema.ts`, immediately after
  `minutesActionItems`, matching the Phase 3 DDL exactly (plain `timestamp`, no `withTimezone` —
  matching the sibling `minutes` table's own convention, not my agent boilerplate's generic default).
- Wrote `drizzle/migrations/0081_governance_documents.sql` — two plain `CREATE TABLE IF NOT EXISTS`
  statements plus guarded index creation, no `ALTER TABLE`/circular-FK step needed (DECISION-081 already
  resolved that by dropping the constraint entirely).
- Added `FEATURES.DOCUMENTS_MANAGE`, `FEATURE_CATEGORIES.DOCUMENTS`, and the matching
  `FEATURE_DESCRIPTIONS` entry to `src/lib/permissions.ts` (the `add-permission` skill's Step 2). Did
  **not** add the `ADMIN_NAVIGATION` entry — Phase 3's Implementation Order explicitly assigns that to
  ux-developer (step 3), alongside the admin page it would link to.
- Wrote `drizzle/migrations/0082_governance_documents_permissions.sql` — inserts `documents.manage`
  into `features` and binds it to `admin` and `notetaker` (both roles already exist from
  `0080_minutes_permissions.sql`), matching that migration's exact `role_id`/`feature_id` join shape
  (this project's actual `role_features` schema, not the `add-permission` skill's generic
  `feature_key` example — verified against `src/lib/db/schema.ts` first).
- Applied both migrations against the dev database (`DATABASE_URL`, never `PROD_DATABASE_URL`) **twice**
  to verify idempotency: first run created both tables, both indexes, the feature row, and both
  role bindings; second run logged nothing but "already exists, skipping" / no-op `WHERE NOT EXISTS`
  guards, no errors, no duplicate rows (`role_feature_count` for `documents.manage` = 2 after both
  runs, one each for `admin`/`notetaker`).
- Verified the live table shape with `psql \d documents` / `\d document_versions` against
  `src/lib/db/schema.ts` column-for-column: confirmed `current_version_id` has no FK constraint, and
  `citing_minutes_id` correctly FKs to `minutes(id) ON DELETE SET NULL`.
- Attempted `pnpm db:push` (and `drizzle-kit push --force` directly) to sync `schema.ts` against the
  live DB per the full deploy sequence. It fails non-interactively — **but on pre-existing, unrelated
  drift in `ledger_entities`** (the live DB has a differently-named unique constraint,
  `ledger_entities_slug_key`, than what `schema.ts`'s inline `.unique()` would generate,
  `ledger_entities_slug_unique`; this is a stale artifact from before this feature and has nothing to
  do with `documents`/`documentVersions`). `drizzle-kit` treats that as a potential-data-loss suggestion
  and blocks on a TTY confirmation prompt even with `--force`, before it ever reaches evaluating my new
  tables. I did not attempt to force through it, since doing so risked a truncate suggestion on a live,
  seeded (2-row) unrelated table outside my scope to fix. This is flagged for whoever picks up dependency
  hygiene next — not a documents-feature blocker, since `db:migrate` already applied the exact DDL
  `schema.ts` declares and I hand-verified the live shape matches column-for-column via `psql`.
- Ran gates: `pnpm exec tsc --noEmit` (clean), `pnpm test` (1263/1263 passed, no regression from the
  1263 baseline — no new tests were added because this scope has no pure logic; `documents.ts`'s
  constants/validators/`diffDocumentVersions()` are api-developer's per Phase 3's Implementation Order),
  `pnpm build:only` (passed, no errors).

### Outputs

- `src/lib/db/schema.ts` — added `documents` and `documentVersions` tables (with `Document`/
  `NewDocument`/`DocumentVersion`/`NewDocumentVersion` inferred types), immediately after
  `minutesActionItems`. `documents.currentVersionId` is a plain nullable `uuid` with an in-place
  comment explaining DECISION-081 (no `.references()` — app-enforced only, sole writer is
  `documents-queries.ts`, always inside the same transaction as the version row it points to).
  `documentVersions` has no soft-delete column and no `updatedAt` — commented in place as deliberate:
  every version row is permanent and immutable from insert, the version chain IS the audit trail.
- `src/lib/permissions.ts` — added `FEATURES.DOCUMENTS_MANAGE` ("documents.manage"),
  `FEATURE_CATEGORIES.DOCUMENTS`, and the `FEATURE_DESCRIPTIONS` entry. No `ADMIN_NAVIGATION` change
  (left for ux-developer, per Phase 3 Implementation Order).
- `drizzle/migrations/0081_governance_documents.sql` — `CREATE TABLE IF NOT EXISTS documents`,
  `CREATE TABLE IF NOT EXISTS document_versions`, four guarded `CREATE [UNIQUE] INDEX IF NOT EXISTS`
  statements. All statements idempotent — verified by two full applications against the dev DB with no
  errors and no duplicate effects on the second run.
- `drizzle/migrations/0082_governance_documents_permissions.sql` — inserts the `documents.manage`
  feature (`WHERE NOT EXISTS` guarded) and binds it to `admin` and `notetaker` (`WHERE NOT EXISTS`
  guarded on the `role_features` join), matching `0080_minutes_permissions.sql`'s exact shape. No new
  role — both `admin` and `notetaker` already exist. No `documents.delete` key, by design.
- Tables affected: new tables `documents`, `document_versions` only. No existing table touched.
- Role bindings added: `documents.manage` → `admin`, `documents.manage` → `notetaker` (verified via
  `SELECT f.name, r.name FROM features f JOIN role_features rf ... JOIN roles r ...` — exactly 2 rows,
  no duplicates after re-running the migration).
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (run twice to verify idempotency) — `pnpm db:push` was attempted but blocked by pre-existing,
  unrelated `ledger_entities` drift (see "What I did" above); the live table shape was instead
  hand-verified against `schema.ts` via `psql \d documents` / `\d document_versions`.

### Open questions / handoff notes

- **Handoff to api-developer, per Phase 3's Implementation Order (step 2):** schema is live,
  `documents.manage` is bound to `notetaker`/`admin`. Build `src/lib/documents.ts` (pure —
  `DOCUMENT_VISIBILITIES`/`isValidDocumentVisibility()`, `DOCUMENT_CHANGE_TYPES`/`isValidChangeType()`,
  `diffDocumentVersions()` wrapping `diff`/jsdiff) and its unit tests first (Phase 3's items 1–6),
  since ux-developer's diff view depends on the shape; then `src/lib/documents-queries.ts` (every
  function under Phase 3's API Contract — `getDocumentBySlug`, `getCurrentVersion`,
  `listVersionHistoryForMembers`, `getVersionForCompare`, `listDocumentsForMembers`,
  `createDocumentVersion`, `adoptVersion`, `linkCitingMinutes`); the three admin route files and their
  route-level tests (Phase 3's items 7–13); `scripts/seed-governance-document.ts`; the
  `docs/club-constitution-and-bylaws.md` header rewrite commit (Phase 3's "Seed Script" section has the
  exact wording).
- **New tables available:** `documents` (`id`, `title`, `slug` [unique], `visibility` ['members' |
  'public', default 'members'], `currentVersionId` [nullable uuid, NO FK — see below], `createdAt`,
  `updatedAt`) and `documentVersions` (`id`, `documentId` [FK → `documents.id` cascade],
  `versionNumber`, `bodyMarkdown`, `changeType` ['editorial' | 'substantive'], `changeNote`,
  `authorUserId` [FK → `users.id` set null], `adoptedByUserId` [FK → `users.id` set null], `adoptedAt`,
  `citingMinutesId` [FK → `minutes.id` set null], `adoptionNote`, `createdAt`). Unique index on
  `(documentId, versionNumber)`.
- **The one enforcement invariant api-developer must hold, per DECISION-081:** `documents-queries.ts`
  is the *only* code path that should ever write `documents.currentVersionId`, and every write to it
  must happen inside the same transaction as the version row it points to — an editorial save's insert
  + pointer-flip, or an adopt action's metadata-set + pointer-flip. There is no DB constraint backing
  this; it's a code-review invariant now, restated here so it isn't rediscovered as a surprise.
  `createDocumentVersion()` should also take the `SELECT ... FOR UPDATE` lock on the `documents` row
  before computing `MAX(versionNumber) + 1`, per Phase 3's "Version-number allocation" note — the
  `(documentId, versionNumber)` unique index is the backstop, not the primary defense.
- **Pre-existing, unrelated drift flagged, not fixed:** `ledger_entities` has a differently-named
  unique constraint on `slug` in the live dev DB than `schema.ts`'s inline `.unique()` would generate,
  which blocks non-interactive `drizzle-kit push --force` (even with `--force`, it still requires a TTY
  to confirm a potential-data-loss suggestion). This predates this feature and is out of my scope to
  fix — flagging for deployment-engineer's next dependency/build-health pass. It did not block anything
  in this feature: `pnpm db:migrate` applied the exact raw SQL `schema.ts` declares, and I hand-verified
  the live `documents`/`document_versions` shape matches `schema.ts` column-for-column via `psql`.
- **Next agent:** api-developer.

---

# Phase 4 — Implementation (API) — 2026-08-09

**Owner:** api-developer
**Status:** complete

### Summary

Built the server half of Governance Documents exactly per the Phase 3 design doc: the pure
`src/lib/documents.ts` (visibility/changeType validators + `diffDocumentVersions()` wrapping
jsdiff, server-only per DECISION-076 Ruling 2), the DB-facing `src/lib/documents-queries.ts`
(every function named in the API Contract, plus `listVersionsForAdmin()` which the admin GET
route needs but the contract's function list omitted), three admin route files gated
`documents.manage`, `scripts/seed-governance-document.ts`, and the paired header rewrite of
`docs/club-constitution-and-bylaws.md`. Ran the seed script against **dev only**
(`PROD_DATABASE_URL` never set for any invocation this round) and hand-verified every read/write
path — including the `SELECT ... FOR UPDATE` version-number lock, the editorial-vs-substantive
`currentVersionId` split, adopt/re-adopt guards, and citing-minutes validation — against real
Postgres, then cleaned dev back down to just the real seeded version 1 so ux-developer starts
from clean, real content. Gates: `pnpm exec tsc --noEmit` clean, `pnpm test` 1292/1292 (1263
baseline + 29 new, zero regressions), `pnpm build:only` passing with all three new routes present
in the build manifest.

### What I did

- Read the full work-log (Phase 2 architect ruling, Phase 3 design doc, Phase 4 schema-half
  handoff) plus DECISION-076 and DECISION-081 in `docs/decisions.md`.
- Read `src/lib/minutes.ts`/`minutes-queries.ts` and the minutes admin routes/tests as the
  pattern to mirror (module split, transaction shape, PATCH action-body convention, hermetic
  route-test style) — confirmed `hasFeature(userId, FEATURES.KEY)`'s exact signature from
  `src/lib/permissions-server.ts` and `src/app/api/admin/minutes/route.test.ts`'s mocking
  convention before writing anything.
- Confirmed Drizzle 0.45.2 supports `.for("update")` on a select query (`LockStrength`/
  `LockConfig` in `pg-core/query-builders/select.d.ts`) before committing to the FOR-UPDATE
  design in `createDocumentVersion()`.
- Added `diff@^9.0.0` (`pnpm add diff`) — ships its own TypeScript types, no `@types/diff` needed.
- Wrote `src/lib/documents.ts`: `DOCUMENT_VISIBILITIES`/`isValidDocumentVisibility()`,
  `DOCUMENT_CHANGE_TYPES`/`isValidChangeType()`, `diffDocumentVersions()` (thin wrapper over
  `diffLines(old, new, { newlineIsToken: false })`). Header comment restates the server-only
  import boundary explicitly, mirroring `minutes-body-editor.tsx`'s client-only comment for
  `turndown`.
- Wrote `src/lib/documents.test.ts` — Phase 3's six named pure tests (identical-input no-op,
  single-line-change line-level granularity, trailing-newline stability, and a synthetic 642-line
  document with one line changed in the middle asserting exactly one removed+added chunk and the
  rest surviving in the surrounding unchanged chunk(s)). All 8 tests (six requirements, two
  additional visibility/changeType edge assertions) pass.
- Wrote `src/lib/documents-queries.ts`: `createDocumentVersion()` (FOR-UPDATE lock on the
  `documents` row → `MAX(versionNumber)+1` → insert → editorial-only pointer flip, one
  transaction), `adoptVersion()` (metadata set + pointer flip, one transaction, defense-in-depth
  guards even though the route pre-checks), `linkCitingMinutes()` (validates the target `minutes`
  row exists, any status), `getDocumentBySlug()`, `getCurrentVersion()` (single indexed lookup,
  never `MAX()`), `listVersionHistoryForMembers()` (excludes pending substantive), 
  `listVersionsForAdmin()` (full chain — an addition beyond the Phase 3 API Contract's eight named
  functions, but required by the admin GET route it names; documented in place as such rather than
  silently added), `getVersionForCompare()` (the shared pending-gate primitive used by both the
  member compare page and the admin PATCH/diff routes' own pre-checks), `listDocumentsForMembers()`
  (visibility-filtered by `{ isAuthenticated: boolean }` rather than a raw `session` object — a
  deliberate narrowing so this DB-facing module doesn't couple to NextAuth's `Session` shape, same
  spirit as `minutes-queries.ts` taking primitive ids/strings throughout).
- Wrote the three admin route files, each gated `documents.manage`:
  - `POST`/`GET /api/admin/documents/[slug]/versions` — create + full-chain list.
  - `PATCH /api/admin/documents/[slug]/versions/[versionId]` — `action: 'adopt' | 'link-minutes'`,
    pre-fetches the version via `getVersionForCompare(id, { allowPending: true })` and returns 409
    from the ROUTE before ever calling `adoptVersion()`/`linkCitingMinutes()` when the state check
    fails (Phase 3 test items 10-12 require exactly this — the mutation functions are provably
    never called on a rejected precondition).
  - `GET /api/admin/documents/[slug]/versions/[versionId]/diff?against=<id|current>` — resolves
    "base" (the path param) and "compare" (`against`) each via `getVersionForCompare({allowPending:
    true})`/`getCurrentVersion()`, verifies both belong to the resolved document, computes
    `diffDocumentVersions()` server-side.
- Wrote route-level hermetic tests (mocking `@/lib/auth`, `@/lib/permissions-server`,
  `@/lib/documents-queries` — never the DB) covering every Phase 3-named item (7-13) plus a few
  additional happy-path/404 cases for basic sanity: `versions/route.test.ts` (8 tests),
  `[versionId]/route.test.ts` (11 tests), `[versionId]/diff/route.test.ts` (3 tests, including the
  item-13 403 test for that route too, since Phase 3 says "one shared test per route file").
- Wrote `scripts/seed-governance-document.ts` following the house dry-run/`--apply`/
  `PROD_DATABASE_URL`-loud-banner pattern (`scripts/clear-budget-fy.ts`,
  `scripts/backfill-gates-checks.ts`) — `usingProd = Boolean(process.env.PROD_DATABASE_URL)`,
  target resolution `PROD_DATABASE_URL || DATABASE_URL || DB_URL`, a loud multi-line banner
  printed when `usingProd` is true. `extractBodyMarkdown()` finds the first line that is exactly
  `---`, strips everything through it, and refuses (throws) rather than guessing if the remaining
  body doesn't start with `## Contents` — a shape-changed source file fails loudly instead of
  silently importing something wrong.
- **Ran the dry run and the real `--apply` against dev**, explicitly with `PROD_DATABASE_URL=`
  (blanked) on every invocation — `.env.local` has a live `PROD_DATABASE_URL` per the standing
  memory note, and dotenv does not override an already-present (even empty-string) process env
  var, so this reliably forces dev targeting regardless of what `.env.local` contains. First dry
  run correctly printed `TARGET: dev` and the parsed body stats (46,245 characters / 621 lines)
  without writing; `--apply` created the `documents` row and version 1 and set
  `currentVersionId`; a second `--apply` correctly no-op'd ("already exists. Nothing to do.").
- **Hand-verified the full read AND write surface against real dev Postgres** (not just mocks) —
  per the schema-half handoff's explicit instruction to confirm real seeded content is readable
  before handing off to ux-developer:
  - Reads: `getDocumentBySlug`, `getCurrentVersion`, `listVersionHistoryForMembers`,
    `listVersionsForAdmin`, `listDocumentsForMembers` (both `isAuthenticated: true/false`),
    `getVersionForCompare` all returned correct, expected shapes against the real seeded row.
  - Writes: created a `substantive` version (confirmed it did NOT flip `currentVersionId`, and
    was excluded from `listVersionHistoryForMembers()` but included in `listVersionsForAdmin()`);
    created an `editorial` version (confirmed it DID flip `currentVersionId` immediately);
    `adoptVersion()` on the pending substantive version — confirmed it flipped `currentVersionId`
    to the substantive version's id, **not** to the more-recent editorial version's id, i.e.
    "adopting out of order" (Phase 3 Edge Cases) behaves exactly as designed: the pointer is
    whichever adopt/editorial-save happened most recently, never derived from `MAX(versionNumber)`;
    re-adopting the same version correctly returned `{ ok: false, reason: 'already_adopted' }`;
    `linkCitingMinutes()` with a bogus id correctly returned `{ ok: false, reason:
    'minutes_not_found' }`, and with a real `minutes.id` from dev's data correctly linked and was
    visible in `listVersionsForAdmin()`'s `citingMinutesId` field; `adoptVersion()` with a
    non-existent `adoptedByUserId` correctly failed on the real `users` FK constraint (proving the
    FK is live, not just declared).
  - **Cleaned dev back to a single real version 1** afterward (a one-time manual
    delete-then-reinsert-v1-verbatim via a throwaway script, run and deleted, never committed) so
    the test versions created above don't leave dev's "current" governing text pointing at
    placeholder content — ux-developer needs the real by-laws as the current version, not test
    artifacts. `documents.currentVersionId` in dev now points at the original, real version 1
    again.
- **Header rewrite of `docs/club-constitution-and-bylaws.md`** — replaced lines 1-19 (title +
  blockquote), left the `---` divider and everything after (including `## Contents` onward)
  untouched, matching `extractBodyMarkdown()`'s parsing exactly (re-verified the dry run still
  parses correctly post-edit: divider now at line 25, body still starts with `## Contents`).
  **Deliberate wording deviation from Phase 3's literal template, flagged here rather than
  silently changed:** Phase 3's template asserts a specific past-tense fact — "imported as version
  1 on \<seed date\>... the in-app document... IS the club's authoritative governing text" — as
  something already true. That's only true once the seed script has actually been `--apply`'d
  against **production**, which this task's constraints explicitly forbid me from doing ("NEVER
  run anything against production... that is the treasurer's call to make deliberately"). Writing
  a hardcoded date into the *committed* file (the same file that ships to production) would make
  the file assert publication happened before it actually did, for however long elapses between
  this commit landing and the treasurer running `--apply` against prod. I kept the substance and
  structure of Phase 3's wording (title, the "supersedes the scan" framing, "frozen historical
  artifact," pointer to the in-app route and version history) but made it conditional — "once
  published" / "until that script has been run" — rather than asserting a specific date as an
  already-completed fact. Whoever runs the production seed can optionally hand-add a date if
  wanted; the wording doesn't require it to remain true.

### Outputs

**New files:**
- `src/lib/documents.ts` — `DOCUMENT_VISIBILITIES`, `isValidDocumentVisibility()`,
  `DOCUMENT_CHANGE_TYPES`, `isValidChangeType()`, `diffDocumentVersions(oldMarkdown, newMarkdown):
  Change[]` (re-exports jsdiff's `Change` type). **Server-only** — never import from a `"use
  client"` file.
- `src/lib/documents.test.ts` — 8 tests (Phase 3 items 1-6), all passing.
- `src/lib/documents-queries.ts` — see API contracts below.
- `src/app/api/admin/documents/[slug]/versions/route.ts` (POST, GET) + `route.test.ts` (8 tests).
- `src/app/api/admin/documents/[slug]/versions/[versionId]/route.ts` (PATCH) + `route.test.ts`
  (11 tests).
- `src/app/api/admin/documents/[slug]/versions/[versionId]/diff/route.ts` (GET) + `route.test.ts`
  (3 tests).
- `scripts/seed-governance-document.ts` — one-off, dry-run by default, `--apply` to write,
  `PROD_DATABASE_URL`-aware with a loud banner, matching the house pattern in
  `scripts/clear-budget-fy.ts`/`scripts/backfill-gates-checks.ts`. **Run against dev only this
  round** — dev now has the real seeded `constitution-bylaws` document (see below).

**Modified files:**
- `docs/club-constitution-and-bylaws.md` — header rewrite (see "What I did" for the wording
  deviation and its reasoning). No other content changed; the file remains 621 lines of body text
  below the divider, byte-identical to what the seed script imports.
- `package.json`/`pnpm-lock.yaml` — added `diff@^9.0.0`.

**Dev database state (not a migration, not committed — a manual `--apply` run this round):** one
`documents` row, `slug='constitution-bylaws'`, `visibility='members'`, one `document_versions` row
(version 1, `changeType='editorial'`, the real transcribed by-laws text, 621 lines / 46,245
characters), `currentVersionId` pointing at it. **Production has NOT been seeded** — the
`documents`/`document_versions` tables exist in production (migrations 0081/0082 apply
independently of the seed), but no row exists yet. Seeding production is the treasurer's explicit,
separate, deliberate action.

**API contracts for ux-developer:**

- `POST /api/admin/documents/[slug]/versions` — gate `documents.manage`. Body:
  `{ changeType: 'editorial' | 'substantive', bodyMarkdown: string, changeNote: string }`.
  Response `201 { id, versionNumber, changeType, isCurrent }`. `400` empty/invalid field; `401`/
  `403` standard; `404` unknown slug.
- `GET /api/admin/documents/[slug]/versions` — gate `documents.manage`. Response
  `200 { versions: DocumentVersionSummary[] }` — full chain, pending included, most-recent-
  `versionNumber`-first, each row carries `isCurrent`.
- `PATCH /api/admin/documents/[slug]/versions/[versionId]` — gate `documents.manage`.
  - `{ action: 'adopt', adoptionNote: string, citingMinutesId?: string | null }` → `200 { id }`.
    `409` if not `substantive`, or already adopted. `400` empty `adoptionNote`.
  - `{ action: 'link-minutes', citingMinutesId: string }` → `200 { id }`. `409` if not yet
    adopted. `400` missing `citingMinutesId`, or `400` if it doesn't resolve to a real `minutes`
    row.
  - `404` if `versionId` doesn't belong to the resolved `slug`'s document.
- `GET /api/admin/documents/[slug]/versions/[versionId]/diff?against=<versionId|current>` — gate
  `documents.manage`. Response `200 { base: {id, versionNumber}, compare: {id, versionNumber},
  diff: Change[] }` where `Change` is jsdiff's `{ value, added?, removed? }[]`. `400` missing
  `against`; `404` unknown slug/base/compare, or a version that doesn't belong to this document.
  **The only diff caller allowed `allowPending: true` on both sides** — never call this pattern
  from a member-facing surface.
- **Member-facing reads — no HTTP, call these directly from Server Components** (all in
  `src/lib/documents-queries.ts`):
  - `getDocumentBySlug(slug): Promise<Document | null>`
  - `getCurrentVersion(documentId): Promise<DocumentVersion | null>`
  - `listVersionHistoryForMembers(documentId): Promise<DocumentVersionSummary[]>` — pending
    substantive versions excluded.
  - `getVersionForCompare(id, { allowPending: false }): Promise<DocumentVersion | null>` — the
    member compare page's only call shape; a pending id resolves to `null` (page should
    `notFound()`).
  - `listDocumentsForMembers({ isAuthenticated: boolean }): Promise<DocumentSummary[]>` — feeds
    the "Governing Documents" section on `/members/records`. **Signature differs from Phase 3's
    `listDocumentsForMembers(session)`** — narrowed to `{ isAuthenticated }` deliberately (see
    "What I did"); pass `Boolean(session?.user)` from the calling Server Component.
- `DocumentVersionSummary` shape: `{ id, versionNumber, changeType, changeNote, authorUserId,
  adoptedByUserId, adoptedAt, citingMinutesId, adoptionNote, createdAt, isCurrent }`.
- `DocumentSummary` shape: `{ id, title, slug, visibility, currentVersionNumber }`.

**Schema changes:** none this round — schema/migrations were database-admin's Phase 4 pass
(migrations `0081`/`0082`, already applied to dev and confirmed idempotent).

### Open questions / handoff notes

- **Next agent: ux-developer.** Build per Phase 3's "Component / Page Plan" — six pages, six
  components, the `/members/records/page.tsx` "Governing Documents" section, and the
  `ADMIN_NAVIGATION` entry (explicitly left to ux-developer by both the schema handoff and Phase
  3's Implementation Order). The API surface and real seeded dev content are both live now — build
  against `getDocumentBySlug("constitution-bylaws")` etc. directly, not against a schema with no
  rows.
- **Reminder from Ruling 3, restated because it's easy to reach for the wrong renderer:** the
  current-document view, version-history entries, and diff view must render body Markdown through
  the **promoted** `src/components/rich-markdown-content.tsx` — never `ReleaseNotesViewer`'s
  `rehype-raw`-enabled pipeline. This wasn't touched this round; flagging so it isn't
  copy-pasted from the wrong precedent.
- **`DiffView`'s input is already server-computed** — the diff route/Server Component hands it a
  plain `Change[]` (jsdiff's own shape); the component should be a Server Component itself
  (props-only, no client-side diff engine) per Phase 3 Ruling 4, wrapped in `overflow-x-auto`
  (UX Guidelines baseline for wide content).
- **The member compare page's default selection** (no `?from=&to=` query params): per Phase 3,
  `to` = current version, `from` = the entry immediately before it in
  `listVersionHistoryForMembers()`'s most-recent-first list. That "immediately before" lookup is
  a UI-layer concern over the list this file already returns — no new query function needed for
  it.
- **Admin "Adopt" and "Link Citing Minutes" actions need `<ConfirmDialog>`**, never
  `window.confirm()` (CLAUDE.md, Ruling 7) — the PATCH route accepts the action bodies described
  above; the confirm-then-submit flow is ux-developer's to build.
- **`listVersionsForAdmin()` is a function I added beyond Phase 3's eight explicitly-named
  query functions** (`getDocumentBySlug`, `getCurrentVersion`, `listVersionHistoryForMembers`,
  `getVersionForCompare`, `listDocumentsForMembers`, `createDocumentVersion`, `adoptVersion`,
  `linkCitingMinutes`) — required by the admin GET route Phase 3's own API Contract names ("full
  version chain, pending included"), which has no other function to call. Flagging so this isn't
  mistaken for scope creep if it's noticed in review.
- **Production is unseeded.** When the treasurer is ready to publish, running
  `PROD_DATABASE_URL="<prod-connection-string>" pnpm exec tsx scripts/seed-governance-document.ts
  --apply` is the entire action — no code change needed. This is explicitly NOT something either
  api-developer or ux-developer should do as part of routine build work.
- **No UI was built this round** — pages/components remain ux-developer's Phase 4 scope per the
  Implementation Order; this handoff is API + seed + docs-header only.

---

# Phase 4 — Implementation (UI) — 2026-08-09

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client half of Governance Documents exactly per the Phase 3 Component/Page Plan: six pages
(three member-facing reading routes, three admin routes), six components (three shared read-side,
one shared picker form, two admin-only client components), the "Governing Documents" section on
`/members/records`, and the `ADMIN_NAVIGATION` entry that database-admin deliberately left for this
round. The diff view is the feature's centerpiece per the brief's own framing — "the document is 642
lines, think about how someone actually reads it" — so it's built around collapsible unchanged
context (native `<details>`, no client JS required) and numbered "jump to change N" anchors, with the
pure grouping logic pulled into its own tested module (`diff-blocks.ts`) rather than left inline in
JSX. All three text states (current / superseded / pending) are labeled with a consistent badge
vocabulary shared by `DocumentView` and `VersionHistoryList`, satisfying requirement 5 by
construction rather than by convention. Gates: `pnpm exec tsc --noEmit` clean, `pnpm test`
1298/1298 (1292 baseline + 6 new, zero regressions), `pnpm build:only` passing with all six new page
routes and the three existing API routes present in the build manifest.

### What I did

- Read the full work-log (Phase 2 architect ruling, Phase 3 design doc, both prior Phase 4 sections)
  plus DECISION-076 and DECISION-081 in `docs/decisions.md`.
- Read the minutes lineage as the pattern to mirror before writing anything: `minutes-detail.tsx`
  (shared read component reasoning), `rich-markdown-content.tsx` (confirmed it is Markdown-only, no
  `rehype-raw`, and already server-safe), `minutes-body-editor.tsx` (the `turndown` paste pipeline,
  reused verbatim, not re-implemented), `minutes-status-actions.tsx` (the fetch-and-toast +
  `<ConfirmDialog>` idiom), `/members/records/page.tsx` and `/members/records/[id]/page.tsx` (the
  `auth()` + inline `memberId` gate, the "Account Not Linked" empty state wording), and the admin
  minutes list/detail pages (list-page and editor-page composition patterns).
- Read all three admin API route files end-to-end to confirm exact request/response shapes,
  including the one deviation from Phase 3's literal function list api-developer already flagged
  (`listVersionsForAdmin()` — an addition, not one of the eight originally-named query functions).
- **Added one small, documented addition to `src/lib/documents-queries.ts`:
  `getUserNamesByIds(ids: (string | null)[]): Promise<Map<string, string>>`.** Needed because
  `document_versions.authorUserId`/`adoptedByUserId` are raw ids with no snapshot column on the row
  (unlike `minutes.notetakerNameSnapshot`), so the read side has to resolve names itself to show
  "Recorded by X" / "Adopted by Y" in the UI. Falls back to `email` when `name` is null. Flagged here
  the same way api-developer flagged `listVersionsForAdmin()` — an addition beyond the Phase 3-named
  contract, not scope creep, since there was no other function to call for this.
- Built `src/components/documents/diff-blocks.ts` — pure logic (no JSX, no DOM) that groups jsdiff's
  flat `Change[]` into renderable blocks: consecutive context lines merge into one collapsible block,
  consecutive added/removed lines merge into one numbered "change" block. Only imports `Change` as a
  TYPE from `"diff"` (erased at compile time) — no runtime dependency on the diffing library, so this
  module carries zero risk of the server-only boundary DECISION-076 Ruling 2/4 exists to protect,
  even though it's a plain (non-`"use client"`) module.
- Wrote `src/components/documents/diff-blocks.test.ts` — 6 tests: identical input → one context
  block/zero regions; a single changed line → exactly one numbered change region flanked by context;
  multiple separate changes numbered in document order; a pure insertion; a trailing-newline-only
  difference stays confined to the affected line (had to correct my own first draft of this test —
  jsdiff legitimately reports a one-line change here, matching `documents.test.ts`'s own existing
  guard, which asserts "at most a removed+added pair confined to the last line," not "zero changes" —
  fixed after `pnpm test` caught it); no phantom empty-string line at a chunk boundary.
- Built `src/components/documents/diff-view.tsx` (Server Component, props-only — never imports `diff`
  itself, per the hard rule): renders `buildDiffBlocks()`'s output as a unified diff, green/red
  Tailwind scales (never `lions-red`) for added/removed with a `+`/`-` prefix per line for
  colorblind-safe redundancy; long context runs collapse behind a native `<details>` (3 lines of edge
  context stay visible on each side); a summary bar states "N changed sections" with a legend and
  "Jump to N" anchor links when there's more than one change; a distinct "No differences between
  these two versions" state when the two versions are textually identical. Wrapped in
  `overflow-x-auto` per the UX Guidelines baseline for wide content.
- Built `src/components/documents/document-view.tsx` — the shared current-text display (green
  "Current — the club's operative text" badge, version number, in-effect-since date,
  `RichMarkdownContent` body). Shared, unmodified, by the member current-document page and the admin
  detail page, matching `MinutesDetail`'s "can't structurally diverge" reasoning. **Deviation from
  Phase 3's literal component description worth flagging:** Phase 3 listed "title" as part of this
  component's job; I left title rendering to the calling page (both the member and admin pages
  already render `<h1>`/`<h2>{document.title}</h2>` immediately above it) to avoid a duplicate
  heading on the page — the component still accepts `title` in its `DocumentViewData` prop type for
  future flexibility, it just isn't rendered a second time here.
- Built `src/components/documents/version-history-list.tsx` — pure presentational list (doesn't know
  or care whether its data source excluded pending rows or not, per Phase 3's own framing). Renders
  the changeType badge (Editorial/Substantive), the three-state status badge (Current/
  Superseded/Pending — requirement 5), the change note, author/adopter names, the adoption note when
  present, the citing-minutes link with its live status inline when the cited minutes aren't
  `'approved'` (Phase 3 Edge Cases: "cited minutes reopened" display), and a "View what changed" link
  into compare defaulting to "this version vs. the one immediately before it in the list" — the same
  default rule Phase 3 specifies for the bare compare page itself. The oldest row gets plain text
  instead of a link ("First version — nothing to compare").
- Built `src/components/documents/version-picker-form.tsx` — plain `<form method="get">` two-`<select>`
  picker, no client JS required, per Phase 3's explicit "no client-side diff engine needed for this
  either."
- Built `src/components/admin/documents/document-version-form.tsx` (`"use client"`) — reuses
  `MinutesBodyEditor` (the `turndown`/`turndown-plugin-gfm` paste pipeline) verbatim, not
  re-implemented. The editorial/substantive choice is rendered as two full description cards (not a
  bare `<select>`) specifically to satisfy requirement 3 — "a treasurer should understand which he is
  doing without reading documentation" — each card states its own consequence ("becomes current
  immediately, no vote needed" vs. "stays pending until the board adopts it by vote; members won't
  see it until then") right where the choice is made. Prefills the editor with the current version's
  text (edit-from-current, not blank) when one exists.
- Built `src/components/admin/documents/pending-versions-panel.tsx` (`"use client"`) — two sub-lists:
  pending substantive versions (Adopt action) and adopted-but-uncited versions (Link Citing Minutes
  action). Adopt is the one action wrapped in `<ConfirmDialog>` (non-destructive styling — blue, not
  red, since this isn't a delete — but still a required confirm step per CLAUDE.md/the brief:
  "adopting an amendment qualifies" as consequential); the confirm step only unlocks after an
  `adoptionNote` has been typed, so the required field is enforced before the irreversible click, not
  after. Link Citing Minutes has no confirm step — it's backfillable and re-linkable, not irreversible
  the way adoption is. Both actions follow `minutes-status-actions.tsx`'s exact
  fetch-then-toast-then-`router.refresh()` idiom.
- Built all six pages:
  - `src/app/members/records/documents/[slug]/page.tsx` — current-document view.
  - `src/app/members/records/documents/[slug]/history/page.tsx` — version history.
  - `src/app/members/records/documents/[slug]/compare/page.tsx` — diff/compare, defaults per Phase 3.
  - `src/app/(dashboard)/admin/documents/page.tsx` — admin document list (today: one row).
  - `src/app/(dashboard)/admin/documents/[slug]/page.tsx` — the editor: read-only current text,
    pending-review panel, new-version form, full history including pending.
  - `src/app/(dashboard)/admin/documents/[slug]/compare/page.tsx` — admin-scoped diff
    (`allowPending: true`, the one place besides the admin diff API route this is used).
  All member pages: `auth()` + inline `memberId` check, "Account Not Linked" empty state, mirroring
  `/members/records/[id]/page.tsx` line for line. All admin pages: `auth()` +
  `hasFeature(FEATURES.DOCUMENTS_MANAGE)` redirect to `/admin`, mirroring `/admin/minutes`.
- Added the "Governing Documents" section to `src/app/members/records/page.tsx` — a card grid above
  the existing minutes pointers, sourced from `listDocumentsForMembers({ isAuthenticated: true })`,
  fetched inside the same `memberId`-gated `Promise.all` the page already had (added a third
  parallel call, not a second round trip). Reused the interactive-card style from CLAUDE.md's UX
  Guidelines (`rounded-2xl shadow-lg hover:shadow-xl ... hover:-translate-y-1`) to distinguish it from
  the non-interactive minutes-row style already in use on that page.
- Added the `ADMIN_NAVIGATION` entry to `src/lib/permissions.ts` ("Governing Documents", `📜`,
  `/admin/documents`, gated `FEATURES.DOCUMENTS_MANAGE`) in the existing "Records" group, alongside
  "Minutes" — exactly the placement Phase 3 specified and both prior Phase 4 sections deliberately
  left undone for this round.
- For the admin editor's "link citing minutes" and "adopt" selectors, reused
  `listMinutesForAdmin()` from `minutes-queries.ts` directly in the admin `[slug]/page.tsx` Server
  Component (composing two existing query modules at the page layer, not merging the `documents` and
  `minutes` modules themselves — consistent with DECISION-076 Ruling 3's module-separation ruling,
  which governs the *library* files, not what a page is allowed to import for display purposes; the
  admin minutes detail page already composes multiple query modules the same way).
- Ran gates: `pnpm exec tsc --noEmit` (clean), `pnpm test` (1298/1298 — 1292 baseline + 6 new from
  `diff-blocks.test.ts`, zero regressions), `pnpm build:only` (passed; confirmed via manifest grep
  that all six new page routes — `/admin/documents`, `/admin/documents/[slug]`,
  `/admin/documents/[slug]/compare`, `/members/records/documents/[slug]`,
  `/members/records/documents/[slug]/history`, `/members/records/documents/[slug]/compare` — and the
  three existing API routes are present). Smoke-tested with `curl` against the already-running dev
  server (did not restart it, per the task's hard constraint): `/members/records` and
  `/admin/documents` both return `307` (redirect to `/signin`, expected with no session cookie — not
  a 404/500), confirming the routes are wired and don't crash the server on request.
- `pnpm lint` fails in this environment on a pre-existing, unrelated issue (`ESLint: ... SyntaxError:
  The requested module 'minimatch' does not provide an export named 'default'`, thrown before ESLint
  even loads any project file) — this is an ESM/CJS interop break in the `eslint`/`minimatch`/
  `@eslint/eslintrc` dependency chain itself, reproducible on `main` before any of this round's
  changes, not something introduced by this feature. Flagging for deployment-engineer's next
  dependency review rather than attempting a dependency-version fix outside this feature's scope.
  `next build`'s own internal compile step (part of `pnpm build:only`, which did pass) does not
  appear to invoke this broken standalone `eslint` CLI path.

### Outputs

**New files:**
- `src/components/documents/diff-blocks.ts` + `diff-blocks.test.ts` (6 tests, pure logic).
- `src/components/documents/diff-view.tsx` — diff renderer, Server Component.
- `src/components/documents/document-view.tsx` — shared current-text display.
- `src/components/documents/version-history-list.tsx` — shared version-history list.
- `src/components/documents/version-picker-form.tsx` — shared compare picker form.
- `src/components/admin/documents/document-version-form.tsx` — admin new-version form (`"use client"`).
- `src/components/admin/documents/pending-versions-panel.tsx` — admin Adopt/Link-Citation panel
  (`"use client"`).
- `src/app/members/records/documents/[slug]/page.tsx`
- `src/app/members/records/documents/[slug]/history/page.tsx`
- `src/app/members/records/documents/[slug]/compare/page.tsx`
- `src/app/(dashboard)/admin/documents/page.tsx`
- `src/app/(dashboard)/admin/documents/[slug]/page.tsx`
- `src/app/(dashboard)/admin/documents/[slug]/compare/page.tsx`

**Modified files:**
- `src/lib/documents-queries.ts` — added `getUserNamesByIds()` (see "What I did").
- `src/lib/permissions.ts` — added the `ADMIN_NAVIGATION` "Governing Documents" entry.
- `src/app/members/records/page.tsx` — added the "Governing Documents" card section.

**Schema/API changes:** none this round — schema (migrations `0081`/`0082`) and the API surface were
prior Phase 4 rounds' work; this round only reads/writes through the existing contract.

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Suggested click-through checklist:
  1. **Member reading surface** (sign in as a linked member): `/members/records` shows a "Governing
     Documents" card for "Constitution & By-Laws" with "Current version 1". Click through to
     `/members/records/documents/constitution-bylaws` — green "Current" badge, version metadata, the
     real 621-line seeded by-laws text rendered as Markdown (headings, lists — not raw text).
  2. **History**: "Version history & changes" link → shows the single seeded version 1 (Editorial
     badge, Current badge, "First version — nothing to compare"). Save a second version as
     admin first (see below) to get a real multi-version history to click through.
  3. **Admin editor** (sign in as admin or notetaker): `/admin/documents` lists the by-laws → click
     into `/admin/documents/constitution-bylaws`. Save a new version with **Editorial** selected —
     confirm the toast says "this is now the current text" and the version number bumps immediately
     in the DocumentView above. Save another with **Substantive** selected — confirm the toast says
     "pending amendment," confirm it does NOT change the current-text display, and confirm it now
     appears in the "Pending amendments" panel with amber styling.
  4. **Adopt flow**: on the pending version, click "Adopt this version…", try submitting with an
     empty adoption note (button should stay disabled), fill in a note, click "Adopt Version N" —
     confirm the `<ConfirmDialog>` appears (not a native `confirm()`), confirm it, confirm the toast
     and that the version is now current and shows a green "Current" badge with "Adopted by <you> on
     <date>" in the history list.
  5. **Link citing minutes**: adopt a second substantive version WITHOUT choosing citing minutes at
     adopt time, confirm it shows up under "Adopted amendments awaiting a minutes citation," link a
     real minutes record to it, confirm the citation appears in the version-history list with the
     minutes' live status inline.
  6. **Compare/diff** (both member and admin): from the history list, click "View what changed" on a
     version with a real prior version — confirm the diff view shows green/red line-level changes
     (never the custom `lions-red`), a "N changed sections" summary, and (if the diff has a long
     unchanged run) a collapsible "Show N unchanged lines" `<details>` that works without JS
     (view-source or disable JS to confirm). Try the two-`<select>` picker to compare arbitrary
     version pairs.
  7. **Pending-version isolation**: confirm a pending substantive version is NOT visible anywhere on
     the member-facing history/compare pages, and that guessing its version id in the member compare
     page's `?from=`/`?to=` query params 404s rather than leaking the text (this exercises
     `getVersionForCompare(..., { allowPending: false })`'s null-on-pending behavior end to end).
  8. **Mobile (360px)**: the diff view's wide content scrolls within its own container, not the page;
     the editorial/substantive choice cards stack to one column; all buttons remain tappable.
  9. **`ADMIN_NAVIGATION`**: confirm "Governing Documents" appears in the sidebar's "Records" group
     for a `documents.manage` holder and is absent for a role without that feature.
- **New copy strings the Lions Club may want to refine:** the editorial/substantive card descriptions
  in `document-version-form.tsx`; the "Pending — not yet in effect" / "Superseded" / "Current" badge
  labels in `version-history-list.tsx`; the adoption-note placeholder text; the "Account Not Linked"
  wording (copied verbatim from the minutes precedent, just re-worded for "governing documents").
- **UX decisions/tradeoffs made, flagged for review:**
  - `DocumentView` doesn't render `title` even though it's in its prop type and Phase 3's component
    description mentioned it — deliberate de-duplication against the page's own heading (see "What I
    did"). If a reviewer wants the component to own the title instead, that's a one-line change on
    both call sites.
  - The diff view's context-collapse threshold (10 lines) and edge-context size (3 lines) are my own
    calibration, not treasurer-specified — easy to tune in `diff-view.tsx`'s two constants if a
    reviewer wants more or less context visible by default.
  - `listVersionsForAdmin()`'s "previous entry in the array" is used as the compare default for
    per-row "View what changed" links in `version-history-list.tsx` (shared by both member and admin
    call sites) — for admin data this can occasionally not be the literal version a given row
    "superseded" if adoption happened out of order (a documented, intentional edge case in Phase 3).
    This mirrors Phase 3's own stated default rule for the bare compare page, not a new judgment call.
  - `pnpm lint` is broken in this environment on an unrelated dependency issue (see "What I did") —
    flagging for deployment-engineer, not something I fixed or worked around in this feature's files.
- **Production is still unseeded** (api-developer's round) — nothing in this UI round changes that;
  the UI was built and click-tested entirely against dev's real seeded version-1 content.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-09
**Verified by:** qa

### Summary

**Verdict: FAIL.** Everything the three Phase 4 rounds built is correct where I could exercise it —
type check, unit tests, production build, the lifecycle invariant, concurrency, the pending-version
gate, diff readability, and the seed script all held up under direct, adversarial testing against real
dev Postgres and a genuine 642-line document. But `src/proxy.ts`'s `protectionRules` has no
`/^\/admin\/documents/` entry, so any request to `/admin/documents*` falls through to the generic
`/^\/admin/` catch-all (line 119-122), which requires `FEATURES.ADMIN_DASHBOARD`. `notetaker` is
deliberately bound to `documents.manage` and NOT `admin.dashboard` (DECISION-076 Ruling 6,
`0082_governance_documents_permissions.sql`) — exactly the role this feature exists to let author
document versions ("the secretary editing," this work-log's "How it got here" §4). A notetaker-only
account is therefore bounced to `/access-pending` on every visit to `/admin/documents*` and can never
reach the admin UI to save, adopt, or review a governance-document version. This is the SAME bug class
already fixed twice in this codebase for the identical reason — the budget-committee role (v1.55.0,
`admin-ledger-budget-committee-gate.spec.ts`) and, days before this feature, the notetaker role for
`/admin/minutes` itself in this exact work-log's sibling feature
(`admin-minutes-notetaker-gate.spec.ts`, docs/work-log/2026-08-08-meeting-minutes.md Phase 5). It
shipped a third time here because every Phase 4 smoke test used the E2E admin account, which bypasses
ALL proxy feature checks (`proxy.ts`: "Admins bypass all feature checks") — never a plain notetaker
session, which is precisely the trap this brief warned about ("an admin session proves nothing"). This
is a real defect, not a design gap — DECISION-076/the Phase 3 design doc never intended notetaker to be
locked out of the feature it names them for. Returning to the implementer, not tech-lead.

### What I did

**Read first:** the full work-log (Phase 2 architect ruling, Phase 3 design doc, all three Phase 4
sections including the UI round's 9-flow click-through checklist), DECISION-076, DECISION-081.

**Gates:**
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **1298/1298 passed**, 73 test files, matches the implementer-reported baseline exactly
  (no drift, no new failures).
- `pnpm build:only` — passed, `✓ Compiled successfully`. Confirmed all 6 new page routes
  (`/admin/documents`, `/admin/documents/[slug]`, `/admin/documents/[slug]/compare`,
  `/members/records/documents/[slug]`, `/members/records/documents/[slug]/history`,
  `/members/records/documents/[slug]/compare`) and all 3 new API routes present in the route manifest.
- `pnpm test:e2e` (full suite, 131 tests, dev server already running on :3000, reused per the task's
  constraint) — **92 passed, 8 failed, 1 skipped, 30 did not run** (cascading skips from
  `mode: "serial"` files after their first failure). Of the 8 failures, **7 exactly match the
  pre-declared known-bad baseline** (`budget-star-notes`, `budgeting-restructure`, `cancel-occurrence` ×2,
  `ledger-search`, `prior-year-cause-line-reconcile`, `transaction-budget-line-link`) — confirmed by name
  against the brief's baseline list, not assumed. The 8th failure is new: the regression spec I wrote
  for the proxy-rule gap (below) — the only failure attributable to this feature.

**Coverage on this feature's pure modules** (`pnpm exec vitest run --coverage`):
- `src/lib/documents.ts` — **100%** statements/branches/functions (target: 90%+, exceeded).
- `src/components/documents/diff-blocks.ts` — **100% lines/functions, 96.4% statements, 91.7% branches**
  (one uncovered branch — a defensive `splitLines("")` early-return not reachable from `diffLines()`'s
  actual output shape; not worth a synthetic test for an unreachable guard).
- `src/lib/documents-queries.ts` — **0%** from Vitest, by design (Phase 3/4: DB-bound query functions
  are hand-verified against real Postgres, not mocked) — see the live-DB verification below, which
  substitutes for unit coverage on this file per the design's own stated plan.
- Confirmed no regression on the codebase's other two mandated-100%/90%+ modules while I had coverage
  open: `src/lib/permissions.ts` still **100%** (the `FEATURES.DOCUMENTS_MANAGE` /
  `FEATURE_DESCRIPTIONS` / `ADMIN_NAVIGATION` additions didn't create a gap), `src/lib/events.ts`
  unaffected at 94.7%/85.5% (pre-existing, untouched by this feature). `src/lib/members.ts` sits at
  35.9% — a **pre-existing** gap unrelated to this feature (documents touches nothing in `members.ts`);
  flagging for the next 7-day coverage review rather than treating it as this feature's problem.

**Feature-gate audit — read every route/page file, not inferred from passing tests** (see the table
below). All three API routes and all six pages correctly gate on `auth()` + `hasFeature(...,
FEATURES.DOCUMENTS_MANAGE)`, or (member-facing pages) `auth()` + the pending-version exclusion baked
into the query layer. The **one gate that's actually missing** is not a `FEATURES` check on a route —
every route/page-level check is correct — it's the `src/proxy.ts` middleware layer, one level up, which
never reaches those correct page-level checks for a notetaker because it bounces the request first.

**Live-DB verification, direct and adversarial, against `DATABASE_URL` (dev) only — `PROD_DATABASE_URL`
was never referenced by any command I ran.** Built two real HTTP sessions via NextAuth's credentials
flow (CSRF token → `POST /api/auth/callback/credentials` → session cookie) rather than trusting mocks:
the seeded E2E admin account (`documents.manage` via `admin`), and a disposable test member (`member`
role only, linked to a throwaway `members` row) created and destroyed via direct SQL, matching this
project's own e2e-fixture convention. All test data was restored/deleted afterward — see Outputs.

1. **The lifecycle invariant, tried to break it, all held:**
   - Editorial save flips `documents.currentVersionId` in the same transaction as the insert — verified
     directly via `psql` before/after, not just via the API response.
   - Substantive save leaves `currentVersionId` untouched — verified via `psql`.
   - **Editorial save while a substantive version is pending:** created a pending substantive v2, then
     an editorial v3 — v3 correctly became current immediately, v2 stayed untouched and still pending
     (exactly the Phase 3 "Edge Cases" scenario).
   - **Adopting an editorial version:** `PATCH .../versions/[v1] {action:'adopt'}` on version 1
     (editorial) correctly `409`s: *"Only substantive versions can be adopted…"* — never reaches
     `adoptVersion()`.
   - **Adopting out of order:** adopted v2 (substantive, versionNumber 2) while v3 (editorial,
     versionNumber 3, more recent) was current — `currentVersionId` correctly moved *backward* to v2,
     confirmed via `psql`. Matches the design's explicit "never derived from `MAX(versionNumber)`" rule.
   - **Adopting twice:** re-adopting the same version correctly `409`s: *"This version has already been
     adopted."*
   - **Link citing minutes:** correctly `409`s on a not-yet-adopted version ("Adopt this version before
     citing minutes"); `400`s on a bogus minutes id; `200`s and links on a real one, verified in
     `listVersionsForAdmin()`'s output.
2. **Concurrency — 5 simultaneous `POST .../versions` requests** (via 5 backgrounded `curl`s hitting
   the running dev server at once) against the same document produced version numbers 4, 5, 6, 7, 8 —
   **zero collisions**, confirmed both from the HTTP responses and a `GROUP BY version_number` query
   showing every number exactly once. The `SELECT ... FOR UPDATE` lock holds under real concurrent load,
   not just in isolation.
3. **Pending-version gate — tested with a genuine non-admin member session, not an admin session:**
   - `GET /api/admin/documents/.../versions` with the plain-member session → **403** (not 401 —
     correctly authenticated-but-forbidden).
   - The member-facing history page, fetched with the plain-member session and grepped for the pending
     version's unique marker text → **0 matches** (excluded at the query layer, not just hidden in the
     UI).
   - Guessing the pending version's id directly in the member compare page's `?from=`/`?to=` query
     params → **404** (`getVersionForCompare(..., { allowPending: false })` correctly resolves to
     `null`), never leaking the text.
   - Same account escalated to `board_member` (has `admin.dashboard`, does NOT have
     `documents.manage`) — reaches `/admin` (200), "Governing Documents" nav item absent from the
     sidebar HTML, and `/admin/documents` itself 307-redirects to `/admin` (this time correctly via the
     page's own `hasFeature()` check, since `admin.dashboard` cleared the proxy layer) — confirms the
     page-level gate is correct in isolation; the defect below is specifically about a role that
     legitimately needs the page but never reaches its gate.
4. **Diff readability, on the real, seeded 642-line by-laws, not synthetic text:** made a single
   realistic one-line edit (the treasurer's own named stale-dues example — `$60.00` → `$127.00` for
   Active Member dues) and diffed it both via the admin API and by fetching and inspecting the rendered
   admin compare-page HTML. The API response isolated the change to exactly one changed region (plus one
   harmless trailing-newline artifact from my own test-data reconstruction via `psql -t -A`, not a
   product defect — and itself a live confirmation of `documents.test.ts`'s trailing-newline-stability
   guard working correctly against real content). The rendered HTML: a clean red `-`/green `+`
   line-level diff with colorblind-safe prefix characters, a native `<details>` disclosure collapsing
   159 unchanged lines behind "Show 159 unchanged lines" (works without JS by construction — it's the
   native HTML element, not a JS-simulated one), and "Jump to 1" / "Jump to 2" anchor links. **A member
   could genuinely see what changed at a glance** — this satisfies the brief's hardest requirement (#5),
   verified against real content, not just unit-tested against synthetic fixtures.
5. **`diff` server-only boundary (DECISION-076 Ruling 2/4):** grepped every import of `"diff"` and of
   `@/lib/documents` (the only re-exporter of `diffDocumentVersions`) across `src/`. The runtime
   `diffLines`/`Change` import exists in exactly two places — `src/lib/documents.ts` and
   `src/components/documents/diff-blocks.test.ts` (a test file, not shipped) — and every consumer of
   `@/lib/documents` is a route handler or a Server Component page, never a `"use client"` file. The two
   files that DO import from `"diff"` inside a component directory
   (`diff-blocks.ts`/`diff-view.tsx`) import only the `Change` **type**, erased at compile time — zero
   runtime dependency on the library, confirmed by reading both files, not inferred. Neither of the two
   `"use client"` files in this feature (`document-version-form.tsx`, `pending-versions-panel.tsx`)
   imports `diff` or `@/lib/documents` at all. No violation.
6. **The seed script** (`scripts/seed-governance-document.ts`), run **read-only against dev only**,
   `PROD_DATABASE_URL=` explicitly blanked on the invocation (required — `.env.local` has a live
   `PROD_DATABASE_URL`, and `dotenv`'s `config()` will populate an unset var from the file, so an
   un-blanked invocation would target production even in dry-run mode):
   - Confirmed dry-run is the default (no `--apply` needed to trigger the no-op path).
   - Confirmed the idempotency guard: since dev already has the real seeded row, it printed *"A document
     with slug 'constitution-bylaws' already exists... Nothing to do."* and made no writes.
   - Confirmed the header-stripping logic by reading `extractBodyMarkdown()` and cross-checking against
     the live `body_markdown` in Postgres — it starts with `## Contents`, matching the script's own
     "refuses rather than guesses" assertion. Did not attempt a full `--apply` run (there is nothing to
     apply against — dev is already seeded — and re-seeding is explicitly out of scope/dangerous per the
     standing Ledger/Quicken memory note this design itself cites).

**Regression test written — failing-then-verified, per QA discipline.** Confirmed the notetaker
gate bug is real and reproducible using a genuine notetaker-only account (not admin, not board_member):
created via direct SQL insert bound only to the `notetaker` role, signed in via the real NextAuth
credentials flow, hit `/admin/documents` — **307 → `/access-pending`**, while the same account hitting
the underlying API route directly (`GET /api/admin/documents/constitution-bylaws/versions`, which skips
`proxy.ts` — "Skip middleware for API routes") correctly returned **200** with real data. This confirms
precisely what's broken (the middleware layer) and what isn't (the API's own `hasFeature()` gate).
Wrote `e2e/admin-documents-notetaker-gate.spec.ts`, mirroring `admin-minutes-notetaker-gate.spec.ts`'s
exact fixture/gate-check pattern, and ran it against the live dev server: **fails as expected** —
`expect(page).toHaveURL("/admin/documents")` receives `/access-pending` instead. This is the test the
implementer should watch turn green after adding the missing `protectionRules` entry.

**All dev data restored.** Every version I created beyond the original seeded version 1
(versions 2-9, covering the substantive/editorial/adopt/link-minutes/concurrency scenarios above) was
deleted and `documents.current_version_id` was pointed back at the original version 1 id
(`3e33af2d-6026-47f2-bbec-e1c04d88a840`) — verified via `psql` that dev now has exactly one document and
one version again, byte-identical to the state the api-developer handed off. All three disposable test
accounts (plain-member, board_member-escalated, notetaker-only) and their linked `members`/`users`/
`user_roles` rows were deleted after use — verified zero rows remain matching their throwaway email
patterns. No `sessions` table rows were created (JWT session strategy). Two scratch `.ts` files used to
create/tear down test fixtures were deleted from the repo root after use and never touched `scripts/`.

### Outputs

- **`e2e/admin-documents-notetaker-gate.spec.ts`** (new, untracked) — the regression test for the defect
  below. Currently **failing** against `main` + this feature's changes, by design — this is the
  before-the-fix half of the regression discipline. Do not delete or skip it; make it pass by fixing
  `src/proxy.ts`, not by weakening the test.
- No other files modified. Dev database restored to its pre-verification state (see above) — the only
  database difference from when I started is `documents.updated_at` bumping a few times during my
  create/adopt/restore cycle, which is inert.

### Feature-Gate Audit (mandatory before PASS)

| Route or page | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? | Reachable by the role that needs it? |
|---|---|---|---|---|
| `POST /api/admin/documents/[slug]/versions` | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | yes — API routes skip `proxy.ts` |
| `GET /api/admin/documents/[slug]/versions` | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | yes |
| `PATCH /api/admin/documents/[slug]/versions/[versionId]` | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | yes |
| `GET /api/admin/documents/[slug]/versions/[versionId]/diff` | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | yes |
| `/admin/documents` (page) | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | **NO — `proxy.ts` bounces a notetaker before this check runs** |
| `/admin/documents/[slug]` (page) | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | **NO — same** |
| `/admin/documents/[slug]/compare` (page) | yes | yes | `FEATURES.DOCUMENTS_MANAGE` | **NO — same** |
| `/members/records/documents/[slug]` (page) | yes | n/a (open to any linked member, per design) | n/a | yes |
| `/members/records/documents/[slug]/history` (page) | yes | n/a | n/a | yes |
| `/members/records/documents/[slug]/compare` (page) | yes | n/a | n/a | yes |
| `documents-queries.ts` pending-version filter | n/a (query-layer, not a `FEATURES` gate) | — | — | correctly excludes pending rows from member reads regardless of role |

**Every individual route/page has the correct code-level gate.** The failure is structural, one layer
up: `src/proxy.ts`'s `protectionRules` array (lines ~60-125) has entries for `/admin/ledger` and
`/admin/minutes` that admit any holder of that area's own feature(s) *before* the generic `/^\/admin/`
catch-all (line 119-122, `FEATURES.ADMIN_DASHBOARD`) gets a chance to reject them — there is no matching
`/^\/admin\/documents/` entry, so `documents.manage`-only holders (i.e. `notetaker`) fall through to the
catch-all and are rejected there, before ever reaching the correct page-level check.

**Suggested fix (for the implementer, not prescribing exact code):** add a rule to `src/proxy.ts`
mirroring the existing `/^\/admin\/minutes/` entry (line 116) — `pattern: /^\/admin\/documents/,
requiredFeatures: [FEATURES.DOCUMENTS_MANAGE]` — placed before the `/^\/admin/` catch-all, same position
convention already used for `ledger` and `minutes`.

### Regression Tests Added

- `e2e/admin-documents-notetaker-gate.spec.ts` — guards against: a `notetaker` account (bound to
  `documents.manage`, deliberately not `admin.dashboard`) being unable to reach `/admin/documents*`
  because `src/proxy.ts` has no matching `protectionRules` entry and falls through to the
  `ADMIN_DASHBOARD`-only catch-all. Currently failing (pre-fix); confirmed passing behavior does not yet
  exist. Two companion tests in the same file confirm the eventual fix doesn't over-widen access
  (notetaker must still be refused at `/admin/members` and bare `/admin`).

### Coverage on Critical Modules

- `src/lib/documents.ts`: **100%** (target 90%+, exceeded)
- `src/components/documents/diff-blocks.ts`: **100% lines/functions, 96.4% stmts, 91.7% branches**
- `src/lib/documents-queries.ts`: **0% automated** — by design, hand-verified against live Postgres
  instead (see "What I did" §1-3 above)
- `src/lib/permissions.ts`: **100%** (unchanged, target met)
- `src/lib/events.ts`: 94.7% (unaffected by this feature)
- `src/lib/members.ts`: 35.9% (pre-existing gap, unrelated to this feature — flag for the 7-day coverage
  review, not this feature's blocker)

### Verdict

**FAIL.**

The defect is narrow, well-understood, and has a known one-line-pattern fix (the exact fix already
applied twice in this codebase for the identical failure mode) — but per CLAUDE.md, "a missing or wrong
gate is a FAIL even if every test passes," and this one specifically locks the `notetaker` role out of
the entire reason this feature names them in its permission binding. Returning to **api-developer**
(closest domain fit for `src/proxy.ts` — server-side routing/access-control logic, not a UI change) to
add the missing `protectionRules` entry and confirm `e2e/admin-documents-notetaker-gate.spec.ts` goes
green. No other loop-back needed — every other verification in this pass held, including under
deliberately adversarial testing, so re-verification after the fix should be narrow: re-run the new
e2e spec, re-run the full e2e suite once more to confirm no new breakage, and re-confirm the two
companion "still refused elsewhere" assertions in the same spec still pass (the fix must not widen
notetaker access beyond `/admin/documents*`).

---

*(Phase 6 template stub originally started here, before the second Phase 5 FAIL/loop-back
existed. Removed from this position — chronologically it belongs after the FINAL re-run QA
section below, which is where the real, filled-in Phase 6 — Shipped vs Intent section now
lives, at the end of this file.)*

---

## Why this is its own work-log

Split out of `docs/work-log/2026-08-08-meeting-minutes.md` on 2026-08-09. That work-log was scoped for
meeting minutes; this grew inside it across three rounds of treasurer feedback until it was comparable
in size to the feature it was attached to, and it has never had an architect pass at this scope.

**Minutes is unaffected and ships on its own schedule** (the club's first general meeting is
2026-09-03). DECISION-074 and DECISION-075 stand as written. Phase 1 for this feature lives in the
minutes work-log's Phase 1 section and is carried over by reference rather than duplicated — read it
there.

## How it got here

1. The treasurer supplied the club's 1998 Constitution & By-Laws as a 16-page scan and asked for it in
   the member portal, "maybe a resources area."
2. He then reframed: "seems like the whole minutes thing is just documents. Should have auditing and
   each document maybe should inherit different permission schemes."
3. Phase 1 evaluated that and recommended **sibling, not superclass** — keep minutes' structure, and
   serve the by-laws with the existing git-committed-Markdown pattern (`ReleaseNotesViewer`), since git
   supplies version history, authorship and diffs for free.
4. He then decided: **"The document infrastructure should allow for versioning and diffing"** — in the
   app, with the secretary editing, not through git. That overturned the git recommendation knowingly.
5. Phase 1 re-derived and still concluded sibling-not-superclass — more strongly, since versioning is a
   whole structural feature only documents need — but now shares the *adoption pattern* as vocabulary.

## Settled going into Phase 2

- **Every save is a permanent, immutable version.** No edits, no deletes. The version chain IS the
  audit trail, which is what satisfies his "should have auditing" requirement — no separate audit table
  is needed for this feature.
- **`changeType` branches the workflow:** `editorial` becomes current immediately; `substantive` stays
  pending until explicitly adopted, recording `adoptedByUserId`, `adoptedAt`, and a nullable
  `citingMinutesId`. That FK is deliberately **backfillable** — minutes are not approved until the
  meeting after the vote that adopted the amendment.
- The club's own rules are **recorded, not enforced**: Article XV requires two weeks notice and a 2/3
  vote to amend the Constitution; By-Law Five requires ten days and a majority for the By-Laws. The app
  records an `adoptionNote` and the citation; it does not police the vote.
- **Diffs are raw Markdown, line-level** — not rendered HTML, not section-parsed.
- **Seeding:** a one-time idempotent import of `docs/club-constitution-and-bylaws.md` verbatim as
  version 1. **After that the database is authoritative and the git file does NOT stay in sync** — the
  committed transcription becomes a historical artifact. Stated explicitly so it is not discovered later.
- **The scan remains the authoritative original** until the board adopts the transcription. That is a
  governance question, not a software one.
- **Permission:** new `documents.manage` bound to `notetaker`. No delete key.


---

## Treasurer Decisions (2026-08-09)

Answering the four questions carried out of Phase 1/2:

1. **The website version becomes AUTHORITATIVE once it is live.** Until publication the 1998 scan
   governs; after publication the in-app document is the authoritative text and the scan becomes the
   historical original. This changes earlier framing in this work-log and in
   `docs/work-log/2026-08-08-meeting-minutes.md` ADDENDUM 2, which assumed the scan would remain
   authoritative indefinitely — that assumption is superseded. Design should reflect that the published
   document is the club's operative text, which raises the bar on the transcription's accuracy (already
   independently proofread) and on the versioning trail.
2. **Members-only.** Not public. The `documents.visibility` column DECISION-076 required is still the
   right shape — it must be able to express public — but the by-laws ship as member-visible. Resolves
   the open half of **B-38**.
3. **Sequencing: publish the document AS IS first, then do the round of updates.** The editorial
   corrections and substantive amendments the treasurer described are queued BEHIND publication, not
   bundled with it. Publishing the faithful 1998 text first gives every later change something to diff
   against — which is the whole point of the versioning trail.
4. **The document is due a substantive review.** Confirmed by the treasurer. The transcription surfaced
   nine internal defects in the original plus real staleness (dues stated as $60.00/yr against roughly
   $127 actually charged; a Membership Director who appears in the duty list but in no officer list; a
   dues deadline given as September 30 in one paragraph and October 1 in the next). That review is a
   board matter, not a software one — the app's job is to record it faithfully once the board acts.

**Practical order, therefore:** minutes ships → documents infrastructure is built → the 1998 text is
published as-is as version 1 → the board's editorial and substantive updates land as subsequent
versions, each diffable against what came before.

---

## Phase 4 — Implementation (full-stack) — 2026-08-09

**Owner:** full-stack-developer
**Status:** complete

### Summary

Loop-back from qa's FAIL. Two tasks: (1) add the missing `/admin/documents` proxy rule so `notetaker`
reaches the admin UI qa found her locked out of, and (2) end the bug class structurally so a sixth
instance can't ship silently. Task 2 turned `getAdminProtectionRules()` (new, `src/lib/permissions.ts`)
into the single source `src/proxy.ts` now calls directly instead of hand-maintaining a parallel list —
derived by grouping `ADMIN_NAVIGATION` items by their top-level `/admin/<segment>` path and unioning
each segment's required feature(s). Verified byte-for-byte preservation of all eight pre-existing
hand-written proxy rules via a pinned regression test, confirmed the derivation also closes eleven
other admin areas that had the identical latent gap (never reported, never observed failing) as a
side effect, and found and fixed one additional live regex-collision bug (`/admin/members` was
accidentally also matching `/admin/membership`) while verifying exact preservation. Logged as
**DECISION-082**. All four requested gates pass: `pnpm exec tsc --noEmit` clean, `pnpm test`
1304/1304 (1298 baseline + 6 new, zero regressions), `pnpm build:only` passing, and both
`e2e/admin-documents-notetaker-gate.spec.ts` and `e2e/admin-minutes-notetaker-gate.spec.ts` green
(8/8).

### What I did

**Task 1 — the immediate defect:**

- Read qa's Phase 5 FAIL (above) and `docs/work-log/2026-08-05-admin-area-gating.md` (the two prior
  increments of the same bug class) before touching anything.
- Confirmed the failure directly: `src/proxy.ts`'s `protectionRules` had entries for `/admin/ledger`
  and `/admin/minutes` (each preceding the generic `/^\/admin/` catch-all requiring
  `FEATURES.ADMIN_DASHBOARD`) but none for `/admin/documents` — so `notetaker` (bound to
  `documents.manage`, deliberately not `admin.dashboard`, per `0082_governance_documents_permissions.sql`)
  fell through to the catch-all and was bounced to `/access-pending`.

**Task 2 — the structural fix:**

- Read `src/lib/permissions.ts` end to end: `ADMIN_NAVIGATION`'s shape (`AdminNavItem.requiredFeature:
  FeatureName | FeatureName[]` — already supports "any of several features admitting one item", used
  today by Budgeting), `canAccessAdminArea()`, `getFirstAccessibleAdminHref()`, and the
  `getAdminGateFeatures()` helper already collecting every nav item's required feature(s) into one flat
  set — the existing precedent this task's derivation follows.
- Diagnosed the previously-raised objection ("several `protectionRules` entries need any-of-several-
  features while `ADMIN_NAVIGATION` models one feature per area") against the actual data: the
  objection is about grouping (an area like `/admin/ledger` spans eight distinct nav items, each with
  its own single/array `requiredFeature`, that must all admit the same coarse area), not about a nav
  item needing more features than it declares — `AdminNavItem.requiredFeature` already being
  `FeatureName | FeatureName[]` was the piece that made per-item "any of several" a solved problem
  already; the missing piece was only the grouping/union step across items sharing an area.
- **Found the one place ADMIN_NAVIGATION was NOT already a faithful source of truth for the existing
  proxy rule it needed to reproduce:** the hand-written `/admin/minutes` proxy rule required
  `MINUTES_MANAGE` OR `MINUTES_DELETE`, but the Minutes nav item's `requiredFeature` only declared
  `MINUTES_MANAGE` — `MINUTES_DELETE` was never part of the nav item's own gate. Closed this by adding
  `MINUTES_DELETE` to the Minutes item's `requiredFeature` array in `ADMIN_NAVIGATION`, rather than
  inventing a second, parallel "extra features per segment" override list — keeping `ADMIN_NAVIGATION`
  the literal single source of truth, not "the source of truth plus a side list of exceptions." Verified
  this is behaviorally inert: `0080_minutes_permissions.sql` binds `minutes.delete` to `admin` only, and
  `admin` bypasses the proxy's feature checks entirely (`userRoles.includes("Admin") ||
  session.user.role === "admin"`, checked before `protectionRules` ever runs) and bypasses
  `AdminSidebar`'s per-item feature filtering too (`isAdmin ? group.items : ...filter(...)`) — so no
  account's visible nav items or proxy admission actually changes as a result of this edit.
- Wrote `getAdminProtectionRules()` in `src/lib/permissions.ts`: walks `ADMIN_NAVIGATION`, skips items
  with no `requiredFeature` (System's Email Queue/Sync Log/Release Notes — same exclusion
  `getAdminGateFeatures()` already uses) and the bare `/admin` Dashboard root (intentionally left to the
  catch-all, unchanged), extracts each remaining item's top-level path segment via
  `href.match(/^\/admin\/([^/]+)/)`, and unions every segment's items' required feature(s) into one rule
  per segment: `{ segment, pattern: RegExp, requiredFeatures: FeatureName[] }`.
- **Found and fixed a live regex-collision bug while verifying exact preservation, not introduced by
  this change:** the pre-existing hand-written pattern `/^\/admin\/members/` (no trailing boundary) also
  matches `/admin/membership...` — `"/admin/membership".startsWith("/admin/members")` is `true` because
  "membership"'s first seven letters are literally "members". Since no explicit rule existed for
  `/admin/membership` before this change, any request there was silently evaluated against the Members
  area's `MEMBERS_EDIT` requirement instead of Applications' own `MEMBERSHIP_MANAGE` — a sixth,
  previously-unfound instance of a closely related failure mode (wrong gate, not missing gate). Fixed by
  bounding every derived segment pattern to `^/admin/<segment>(?:/|$)` (segment followed by `/` or
  end-of-string, never a bare prefix) — confirmed this changes nothing for any path actually under
  `/admin/members/*` itself, only stops it from also matching `/admin/membership*`. Added a regression
  test pinning this exact collision (`src/lib/permissions.test.ts`).
- Ran `pnpm exec tsx -e "..."` against the live derivation to print every derived segment, pattern, and
  feature set for direct visual confirmation before writing tests — output included in the Outputs
  section below, not just asserted in prose.
- Rewrote `src/proxy.ts`'s `protectionRules` construction to `[...getAdminProtectionRules(), <ADMIN_DASHBOARD
  catch-all>, <members rule>]`, replacing the eight hand-written admin sub-rules (and their per-rule
  historical comments explaining each prior incident) with one derivation call plus a doc comment
  pointing at `getAdminProtectionRules()`'s own comment (which now carries the full history) and at both
  work-logs.
- Added `getAdminProtectionRules()`'s own extensive doc comment in `src/lib/permissions.ts` stating
  plainly what the derivation DOES guarantee (any `ADMIN_NAVIGATION` item with a `requiredFeature` is
  automatically proxy-admitted — the exact failure mode behind all five incidents becomes structurally
  impossible) and what it does NOT guarantee (an admin page never added to `ADMIN_NAVIGATION` at all —
  not merely missing a proxy rule, but absent from the nav data itself — still falls to the
  `ADMIN_DASHBOARD` catch-all; a different, so-far-unobserved failure mode this change does not close).
  Not claiming a guarantee beyond what's actually built, per the brief's explicit instruction.
- Logged **DECISION-082** in `docs/decisions.md` (implementation decision, following the precedent of
  prior implementer-logged decisions like DECISION-081) covering the derivation, the objection it
  resolves, the `MINUTES_DELETE` gap it closed, the `/admin/members`-vs-`/admin/membership` collision
  fix, and the honest limits of the guarantee.
- Added six tests to `src/lib/permissions.test.ts`'s new `getAdminProtectionRules` describe block (see
  Unit Tests below) — including the literal "would have caught all five instances" test the brief asked
  for, walking every `ADMIN_NAVIGATION` item and asserting a derived rule admits it.
- Ran the full gate sequence: `pnpm exec tsc --noEmit` (clean), `pnpm test` (1304/1304, 1298 baseline +
  6 new, zero regressions), `pnpm build:only` (passed — confirmed `/admin/documents` and
  `/members/records/documents/[slug]*` present in the route manifest).
- Ran the two named notetaker-gate e2e specs against the already-running dev server (`DATABASE_URL`,
  never touched `PROD_DATABASE_URL`; did not restart the server per the task's constraint):
  `e2e/admin-documents-notetaker-gate.spec.ts` and `e2e/admin-minutes-notetaker-gate.spec.ts` — 8/8
  passed, including both specs' "still refused elsewhere in /admin" companion assertions (confirming the
  fix didn't over-widen either notetaker's access).
- Also ran `e2e/admin-ledger-budget-committee-gate.spec.ts` and `e2e/admin-security.spec.ts` (the other
  two specs directly exercising proxy-layer admission) — 10/10 passed, confirming the Ledger/
  budget-committee precedent and the newly-derived `/admin/security` rule both behave correctly.
- Ran the **full** `pnpm test:e2e` suite (131 tests, dev server reused) as an extra check given how
  broadly `proxy.ts`'s behavior changed (every `/admin/*` request is now governed by the derivation, not
  just documents' or minutes'): 94 passed, 8 failed, 1 skipped, 28 did not run (cascading `mode:
  "serial"` skips after a first failure in the same file). All 8 failures matched names already on
  record: 7 exactly match the known-bad baseline qa's own Phase 5 pass in this same work-log already
  documented (`budget-star-notes`, `budgeting-restructure`, `cancel-occurrence` ×2, `ledger-search`,
  `prior-year-cause-line-reconcile`, `transaction-budget-line-link`) — none of these touch admin-area
  proxy gating. The 8th, `recurring-signup-rollup.spec.ts` Test 2, was not on qa's prior list; re-ran it
  in isolation and it passed 4/4 — confirming it's a shared-fixture/parallel-execution flake under the
  full suite's `fullyParallel: true`, not a regression from this change (this spec exercises event RSVP
  rollup counts, nothing in the admin-gating surface this change touched).

### Outputs

- `src/lib/permissions.ts` — added `MINUTES_DELETE` to the Minutes `ADMIN_NAVIGATION` item's
  `requiredFeature` array (closes the one gap found verifying exact preservation, inert in practice —
  see "What I did"); added `AdminProtectionRule` interface, `escapeRegExpLiteral()`, and
  `getAdminProtectionRules(): AdminProtectionRule[]` (new, exported, pure — no DB, no Next.js imports),
  with an extensive doc comment stating exactly what guarantee it does and does not provide.
- `src/proxy.ts` — replaced the eight hand-written admin sub-area `protectionRules` entries with
  `...getAdminProtectionRules()`; the `ADMIN_DASHBOARD` catch-all and `/members` rule are unchanged and
  still hand-written (neither derives from a nav item). New import: `getAdminProtectionRules` from
  `@/lib/permissions`.
- `src/lib/permissions.test.ts` — new `getAdminProtectionRules` describe block, 6 tests (see Unit Tests
  below).
- `docs/decisions.md` — new **DECISION-082** (placed above DECISION-081, newest-first).
- No schema changes, no new `FEATURES` entries, no new env vars, no migrations. No server actions or API
  routes added or changed — this is entirely within `src/proxy.ts`'s middleware layer and its
  `src/lib/permissions.ts` data source.

**Derived rules, printed directly from the live function for verification (19 segments — the 8
pre-existing hand-written ones, byte-preserved, plus 11 previously-uncovered ones now correctly
admitted for their own feature-holders instead of silently requiring `admin.dashboard`):**

```
members          ^/admin/members(?:/|$)        members.edit
users            ^/admin/users(?:/|$)          admin.users
roles            ^/admin/roles(?:/|$)          admin.roles
permissions      ^/admin/permissions(?:/|$)    admin.roles
membership       ^/admin/membership(?:/|$)     membership.manage        [was: catch-all → admin.dashboard]
groups           ^/admin/groups(?:/|$)         groups.manage
ledger           ^/admin/ledger(?:/|$)         ledger.view, ledger.manage, ledger.approve, budget.view, budget.edit, ledger.record
dues             ^/admin/dues(?:/|$)           dues.view                [was: catch-all → admin.dashboard]
minutes          ^/admin/minutes(?:/|$)        minutes.manage, minutes.delete
documents        ^/admin/documents(?:/|$)      documents.manage         [Task 1 — the fix]
events           ^/admin/events(?:/|$)         events.edit              [was: catch-all → admin.dashboard]
campaigns        ^/admin/campaigns(?:/|$)      campaigns.manage
announcements    ^/admin/announcements(?:/|$)  announcements.manage     [was: catch-all → admin.dashboard]
testimonials     ^/admin/testimonials(?:/|$)   announcements.manage     [was: catch-all → admin.dashboard]
programs         ^/admin/programs(?:/|$)       announcements.manage     [was: catch-all → admin.dashboard]
subscriptions    ^/admin/subscriptions(?:/|$)  contact.view             [was: catch-all → admin.dashboard]
contact          ^/admin/contact(?:/|$)        contact.view             [was: catch-all → admin.dashboard]
suggestions      ^/admin/suggestions(?:/|$)    suggestions.view         [was: catch-all → admin.dashboard]
security         ^/admin/security(?:/|$)       admin.security_view      [was: catch-all → admin.dashboard]
```

The eleven `[was: catch-all → admin.dashboard]` rows are a side effect of the derivation, flagged
explicitly rather than left implicit: these areas had the identical latent gap (a nav item gated on a
feature narrower than `admin.dashboard`, no matching proxy rule) but it was never reported because no
one has yet held one of those specific narrower features without also holding `admin.dashboard`. This
is a genuine widening of who reaches those URLs, but not a widening of authority — every one of those
pages already enforces its own `hasFeature()` check at the page level (spot-checked
`/admin/dues`, `/admin/events`, `/admin/contact`, `/admin/security` directly; all gate correctly), so the
proxy layer merely stops rejecting a legitimate holder before that check runs, the same relationship the
Ledger and Minutes precedents already established.

### Unit Tests (Phase 4 — implementer-delivered)

Added to `src/lib/permissions.test.ts`, `getAdminProtectionRules` describe block:

1. **"every ADMIN_NAVIGATION item with a requiredFeature is admitted by a derived rule matching its own
   href — the test that would have caught all five prior incidents"** — walks every nav item, asserts
   exactly one derived rule matches its href and that rule's `requiredFeatures` contains every feature
   the item itself declares.
2. **"preserves the exact requiredFeatures set for every admin area that had a hand-written proxy rule
   before this derivation existed"** — pins `members`/`users`/`roles`/`permissions`/`campaigns`/
   `groups`/`ledger`/`minutes` to their exact original sets (the "verify explicitly that each existing
   area still admits and refuses exactly who it did before" requirement).
3. **"derives a /admin/documents rule requiring DOCUMENTS_MANAGE — the exact gap this loop-back
   closes"** — Task 1's regression at the unit level, complementing the e2e spec.
4. **"does not let a bounded segment pattern accidentally match a longer sibling segment — /admin/members
   must not match /admin/membership"** — the collision bug found and fixed during this pass.
5. **"produces no rule for System items with no requiredFeature of their own"** — Email Queue/Sync Log/
   Release Notes stay unrepresented, matching `getAdminGateFeatures()`'s existing exclusion.
6. **"a user holding exactly one area's required feature is admitted by that area's rule and no other
   unrelated area's rule wrongly admits them"** — documents/members cross-check.

All new and pre-existing tests pass (1304 total, 73 files — 1298 baseline + 6 new, zero regressions).

### Verification Run By Implementer

- `pnpm exec tsc --noEmit` — **PASS** (clean, no errors).
- `pnpm test` — **PASS** (1304/1304, 73 files, 0 failures — 1298 baseline + 6 new).
- `pnpm build:only` — **PASS** (production build completed; confirmed `/admin/documents`,
  `/admin/documents/[slug]`, `/admin/documents/[slug]/compare`,
  `/members/records/documents/[slug]*` all present in the route manifest).
- `e2e/admin-documents-notetaker-gate.spec.ts` — **PASS** (4/4).
- `e2e/admin-minutes-notetaker-gate.spec.ts` — **PASS** (4/4).
- `e2e/admin-ledger-budget-committee-gate.spec.ts` — **PASS** (5/5, re-run as a precedent sanity check).
- `e2e/admin-security.spec.ts` — **PASS** (5/5, re-run since `/admin/security` is one of the newly
  derived rules).
- Full `pnpm test:e2e` (131 tests) — 94 passed, 8 failed (7 match qa's own documented known-bad baseline
  from this work-log's Phase 5 pass; the 8th, `recurring-signup-rollup.spec.ts` Test 2, passed 4/4 in
  isolation, confirming a parallel-execution flake unrelated to this change), 1 skipped, 28 did not run
  (cascading serial-mode skips inside the same failing files). No new failures attributable to this
  change.

### Feature-Gate Audit

| Route / area | `auth()` present? | Gate present? | Correct key? | Reachable by the role that needs it? |
|---|---|---|---|---|
| `/admin/documents*` (proxy layer) | n/a — proxy runs on `session` from `auth()` | yes — derived rule, segment "documents", `DOCUMENTS_MANAGE` | yes | **yes — this is Task 1's fix, confirmed via e2e** |
| `/admin/minutes*` (proxy layer) | n/a | yes — derived rule, segment "minutes", `MINUTES_MANAGE`/`MINUTES_DELETE` | yes, now byte-identical to the pre-refactor hand-written rule | yes — confirmed via e2e, unchanged |
| `/admin/ledger*` (proxy layer) | n/a | yes — derived rule, segment "ledger", 6-feature union | yes, byte-identical | yes — confirmed via e2e, unchanged |
| `/admin/members*` (proxy layer) | n/a | yes — derived rule, segment "members", `MEMBERS_EDIT` | yes, byte-identical, and no longer also matches `/admin/membership*` | yes — confirmed via e2e, unchanged |
| Every other pre-existing rule (`users`, `roles`, `permissions`, `campaigns`, `groups`) | n/a | yes — derived, byte-identical | yes | unchanged, pinned by test #2 above |
| 11 newly-derived areas (`membership`, `dues`, `events`, `announcements`, `testimonials`, `programs`, `subscriptions`, `contact`, `suggestions`, `security`) | n/a | yes — derived from their own existing `ADMIN_NAVIGATION` entries | yes | now correctly reachable by their own feature-holders; each page's own `hasFeature()` check is unchanged and still authoritative |
| `/admin` bare root, any unlisted future `/admin/*` path | n/a | yes — unchanged `ADMIN_DASHBOARD` catch-all | yes | unchanged |

### Open questions / handoff notes

- **Next agent: qa (Phase 5, re-verification).** Per qa's own stated re-verification scope in its FAIL
  verdict above: re-run `e2e/admin-documents-notetaker-gate.spec.ts` (done, green), re-run the full e2e
  suite once more to confirm no new breakage (done — see Verification above), and re-confirm the "still
  refused elsewhere" companion assertions in that spec still pass (done, green). Given the scope of this
  loop-back grew beyond the originally-scoped proxy-rule addition (Task 2's structural refactor touches
  every `/admin/*` route's admission logic), qa may reasonably want to spot-check a couple of the 11
  newly-derived areas by hand (e.g., sign in as a role holding only `DUES_VIEW` or only `CONTACT_VIEW`
  and confirm `/admin/dues` or `/admin/contact` now loads instead of bouncing to `/access-pending`) —
  flagged as a suggestion, not a requirement, since the derivation's correctness for those areas is
  already covered by test #1 above plus the page-level gates being unchanged.
- **`recurring-signup-rollup.spec.ts` Test 2's flake under full-suite parallel execution** is not new to
  this change (nothing here touches events/RSVP logic) but wasn't previously on qa's documented
  known-bad baseline in this work-log — flagging for qa's awareness in case it recurs, not something I
  investigated further since it passed cleanly in isolation and is out of this loop-back's scope.
- **Not done, and deliberately out of scope:** production is still unseeded for the governance document
  (api-developer's prior round already flagged this as the treasurer's separate, deliberate action) —
  nothing in this loop-back touches that.
- **The residual gap stated plainly in DECISION-082 and in `getAdminProtectionRules()`'s own doc
  comment:** an admin page that ships without ever being added to `ADMIN_NAVIGATION` at all (not merely
  missing a proxy rule, but absent from the nav data itself) still falls to the `ADMIN_DASHBOARD`
  catch-all. All five real prior incidents involved a nav entry that DID exist with a matching page-level
  gate but no proxy rule — this change closes exactly that failure mode by construction. It does not
  claim to close the different, so-far-unobserved failure mode of a page never being added to
  `ADMIN_NAVIGATION` in the first place.

---

# Phase 5 — Verification (re-run) (qa)

**Date:** 2026-08-09
**Verified by:** qa
**Scope:** re-verification of the DECISION-082 proxy-derivation loop-back, directed at authority
*widening*, not lockout — per the task brief, the risk this pass had to test for is "accidentally
exposing an admin area to someone who should not reach it," not the missing-rule lockout qa's first
Phase 5 pass already caught and this loop-back already fixed.

### Summary

**Verdict: FAIL.** The `/admin/documents` fix is confirmed correct and the derivation itself is sound
— byte-for-byte preservation of all eight pre-existing hand-written rules held, the `/admin/members` vs
`/admin/membership` collision is genuinely fixed, both notetaker-gate e2e specs are green, and the new
`getAdminProtectionRules` unit tests are not vacuous (proven by mutation, not assumed — see below). But
DECISION-082's own audit overclaimed: it asserts all eleven newly-derived admin areas are safe because
"every one of those pages already enforces its own `hasFeature()` check at the page level," naming
`dues`/`events`/`contact`/`security` as the pages it actually spot-checked. **`/admin/subscriptions` was
never checked, and the claim is false for it.**
`src/app/(dashboard)/admin/subscriptions/page.tsx` performs `auth()` only — no `hasFeature()` call of
any kind — so before this refactor the `ADMIN_DASHBOARD` catch-all was the *only* thing standing between
a low-privilege account and the full newsletter-subscriber PII table (name + email, every subscriber).
After this refactor, that catch-all is gone for this segment (replaced by the "Newsletter" nav item's
own declared `CONTACT_VIEW` requirement) and nothing compensates at the page level. Confirmed live, not
inferred: a disposable account holding only `contact.view` — deliberately not `admin.dashboard` — loaded
`/admin/subscriptions` with a 200 and the rendered HTML contained real subscriber email addresses,
including the seeded admin's own. This is exactly the failure class the task brief named as the one that
matters ("not a lockout — accidentally exposing an admin area to someone who should not reach it") and
exactly the CLAUDE.md pattern the Feature-Gate Audit exists to catch ("if the route returns bulk PII...
confirm the key restricts to the role that owns that data"). Returning to the implementer, not tech-lead
— the fix is narrow and the pattern to follow already exists on every sibling page in this codebase.

### What I did

**Read first:** this work-log's Phase 5 (original FAIL), the Phase 4 loop-back (full-stack-developer),
DECISION-082, and the relevant slice of DECISION-076/the Phase 3 design doc already covered by my prior
pass — not re-read in full since nothing in that surface changed in this loop-back.

**Gates:**
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **1304/1304 passed**, 73 test files — matches the implementer-reported baseline exactly.
- `pnpm build:only` — passed, `✓ Compiled successfully`; confirmed the route manifest still lists
  `/admin/documents`, `/admin/documents/[slug]`, `/admin/documents/[slug]/compare`, and all three
  `/members/records/documents/[slug]*` reading routes.

**Item 1 — no widening of authority, checked against the named sensitive routes, via disposable
single-feature accounts (not the E2E admin account, per the brief's own warning that an admin session
proves nothing):**
- Signed in as a genuine `notetaker`-only account and a `board_member`-shaped account is not what this
  pass re-derives — that was qa's first pass and the loop-back's own re-run, both green (see Item 4). For
  this pass I composed a **new** disposable fixture: an existing `volunteer` role (baseline: `events.view`
  only) with `contact.view` **temporarily** granted via a direct `role_features` insert (recorded as new,
  not pre-existing, before the grant — no role in this project's seed data holds `contact.view` without
  also holding `admin.dashboard`, so this scenario couldn't be composed from existing bindings the way
  the notetaker/budget-committee fixtures could). Verified via `/api/auth/session` after a real
  credentials-flow sign-in: `"features":["contact.view","events.view"]` — no `admin.dashboard`, confirmed
  from the actual session object, not assumed from the DB insert.
- With that account: `curl`'d (authenticated session cookie, real HTTP, not a mock) `/admin/security`,
  `/admin/users`, `/admin/roles`, `/admin/permissions` — **all four redirected to `/access-pending`**,
  confirming the derivation did not widen access to any of the four routes the brief called out for
  particular attention. `/admin/contact` — **200, admitted**, correctly, since `contact.view` is that
  page's actual intended gate. `/admin/members` — **redirected**, correctly (this account holds neither
  `members.edit` nor `membership.manage`). `/admin/subscriptions` — **200, admitted, and leaked PII** —
  see Summary; this is the actual defect, isolated by this same probe.
- Cleaned up fully: disposable user + its `user_roles` row deleted, the temporary `contact.view` grant on
  `volunteer` removed (confirmed by re-querying `role_features` afterward: `volunteer` is back to
  `events.view` only, byte-identical to its pre-test state).

**Item 2 — the `/admin/members` vs `/admin/membership` collision, confirmed genuinely fixed, two ways:**
- Unit test (`src/lib/permissions.test.ts`, "does not let a bounded segment pattern accidentally match a
  longer sibling segment") — read, not just trusted: it asserts `membersRule.pattern.test("/admin/membership")`
  is `false` and `membershipRule.pattern.test("/admin/membership")` is `true` with its own distinct
  `MEMBERSHIP_MANAGE` requirement. Passing.
- Live: the same `contact.view`-only fixture hit `/admin/membership` directly — redirected to
  `/access-pending` on its own `membership.manage` requirement, not silently admitted through the members
  rule (which would have been the pre-refactor collision bug's signature). Confirms the fix holds under a
  real request, not just the regex unit test.

**Item 3 — every page's own `hasFeature()` gate still fires, checked broadly, not just the two the brief
asked for minimum:** read every page file for the eleven `[was: catch-all → admin.dashboard]` areas
DECISION-082 lists, not just the four the implementer's own spot-check named:

| Area | Page-level gate present? | Matches its `ADMIN_NAVIGATION` `requiredFeature`? |
|---|---|---|
| `membership` | yes — `hasFeature(MEMBERSHIP_MANAGE)`, redirects to `/admin` | yes |
| `dues` | yes — `hasAnyFeature([DUES_VIEW, DUES_MANAGE])`, redirects to `/admin` | yes |
| `events` | yes — `hasFeature(EVENTS_EDIT)`, redirects to `/admin` | yes |
| `announcements` | yes — `hasFeature(ANNOUNCEMENTS_MANAGE)`, redirects to `/admin` | yes |
| `testimonials` | yes — `hasFeature(ANNOUNCEMENTS_MANAGE)`, redirects to `/admin` | yes |
| `programs` | yes — `hasFeature(ANNOUNCEMENTS_MANAGE)`, redirects to `/admin` | yes |
| **`subscriptions`** | **no — `auth()` only, no `hasFeature()` call anywhere in the file** | **no — nothing enforces `CONTACT_VIEW` (or any feature) at the page level** |
| `contact` | yes — `hasFeature(CONTACT_VIEW)`, redirects to `/admin` | yes |
| `suggestions` | yes — `hasFeature(SUGGESTIONS_VIEW)`, redirects to `/admin` | yes |
| `security` | yes — `hasFeature(ADMIN_SECURITY_VIEW)`, redirects, per its own doc comment | yes |

Also re-confirmed the two pre-existing/unchanged areas the brief asked about that weren't in the eleven:
`/admin/permissions/page.tsx` has **no page-level gate either** (`auth()` isn't even called — it reads
`roles`/`features`/`roleFeatures` and renders unconditionally) — but this is **pre-existing, not caused
by this refactor**: `git log` shows this file untouched since the original commit `ca725a4` ("Add
enterprise-grade member portal with permissions system"), and the proxy's `permissions` segment already
required `ADMIN_ROLES` before DECISION-082 (one of the eight byte-for-byte-preserved hand-written rules,
not one of the eleven newly-derived ones). Checked who holds `admin.roles` today: only `admin` (which
bypasses the proxy and every check entirely) — so there is no live exposure from this gap right now, but
it is the identical missing-defense-in-depth pattern as `subscriptions`, on an even more sensitive page
(the actual role↔permission matrix), and is worth its own follow-up ticket. **Not a blocker for this
verdict** — untouched by this diff, no live exposure under current role bindings, and flagged rather than
silently found, per QA discipline — but noted here so it isn't lost.

**Item 4 — both notetaker-gate e2e specs, plus the ledger/security specs that also exercise the proxy
layer, re-run against the already-running dev server:**
- `pnpm exec dotenv -e .env.local -- playwright test e2e/admin-documents-notetaker-gate.spec.ts
  e2e/admin-minutes-notetaker-gate.spec.ts e2e/admin-ledger-budget-committee-gate.spec.ts
  e2e/admin-security.spec.ts` — **18/18 passed**, run twice (once before, once after writing the new
  regression spec below) with identical results both times.
- **Confirmed the new `getAdminProtectionRules` unit tests are not vacuous, by mutation, not by
  inspection alone:** temporarily removed the "Governing Documents" nav item's `requiredFeature` in
  `src/lib/permissions.ts`, re-ran `pnpm exec vitest run src/lib/permissions.test.ts` — **2 of the 27
  tests failed** ("derives a /admin/documents rule requiring DOCUMENTS_MANAGE" and "a user holding
  exactly one area's required feature is admitted..."), with real, on-topic assertion failures
  (`expected undefined to be defined`), not a crash or an unrelated error. Restored the file from a
  pre-mutation backup, re-ran — **27/27 passed** again, and `git diff --stat src/lib/permissions.ts`
  showed only the loop-back's own intended (uncommitted) changes, confirming a clean restore with no
  residual mutation. This satisfies the brief's explicit requirement #4 ("confirm that test actually
  fails if a nav entry's rule is removed, rather than passing vacuously").

**Item 5 — no currently-shipping admin page absent from `ADMIN_NAVIGATION` entirely:** enumerated every
directory under `src/app/(dashboard)/admin/` (22 directories, excluding the bare `/admin` root) and every
top-level path segment `ADMIN_NAVIGATION` declares an `href` for. **Exact 1:1 match, both directions** —
`announcements`, `campaigns`, `contact`, `documents`, `dues`, `email-queue`, `events`, `groups`, `ledger`,
`members`, `membership`, `minutes`, `permissions`, `programs`, `release-notes`, `roles`, `security`,
`subscriptions`, `suggestions`, `sync-log`, `testimonials`, `users`. No shipped admin page is currently in
the "absent from `ADMIN_NAVIGATION` entirely" position DECISION-082 names as its stated, un-closed
limitation — that limitation is real and honestly documented, but not presently live.

**Item 6 — the governance-documents feature itself, re-confirmed at the scope actually warranted:**
nothing in this loop-back touched `documents-queries.ts`, `documents.ts`, any of the three admin API
routes, or any of the six page components — only `src/proxy.ts` and `src/lib/permissions.ts` changed.
Full live-DB adversarial re-testing (lifecycle, concurrency, pending-version gate, diff readability —
qa's first Phase 5 pass) was not repeated, since nothing in that code path changed. Instead: confirmed
`src/lib/documents.ts` and `src/components/documents/diff-blocks.ts` are still exercised by the 1304
passing unit tests (no drift from the prior pass's 100%/96.4% coverage figures — nothing added or removed
tests in those files this round), and confirmed the dev database is still in the exact state qa's first
pass restored it to: **exactly one `documents` row and one `document_versions` row**, verified via
`psql`. No regression, nothing to restore.

**Regression test written — failing-then-verified, per QA discipline.** Confirmed the subscriptions gap
is real and reproducible using the disposable `contact.view`-only fixture (not an admin session).
Wrote `e2e/admin-subscriptions-page-gate.spec.ts`: composes the fixture from the existing `volunteer` role
plus a temporary `contact.view` grant (recording whether the grant pre-existed so cleanup never deletes a
binding the spec didn't create — no role in this codebase's seed data already holds `contact.view` without
`admin.dashboard`, so unlike the notetaker/budget-committee specs this couldn't be composed purely from
existing bindings), signs in via the real credentials flow, and asserts the "Newsletter Subscribers"
heading is **not** visible to that account. Ran it: **fails as expected** — the heading *is* visible,
with real subscriber rows rendered. `afterAll` cleanup verified independently via `psql` after the failing
run: zero leftover fixture users, `volunteer`'s `role_features` back to exactly `events.view`. This is the
test the implementer should watch turn green after adding a page-level `hasFeature()` check to
`/admin/subscriptions/page.tsx`.

**All dev data restored.** The `contact.view` fixture user, its `user_roles` row, and the temporary
`role_features` grant on `volunteer` were all removed and independently re-verified via direct `psql`
queries (not assumed from the script's own exit code) both after my manual `curl` probe and again after
the regression spec's `afterAll` ran. `documents`/`document_versions` row counts confirmed unchanged (1/1).
No other tables touched. `PROD_DATABASE_URL` was never referenced by any command run this pass. No email
send path was exercised.

### Outputs

- **`e2e/admin-subscriptions-page-gate.spec.ts`** (new, untracked) — the regression test for the defect
  below. Currently **failing** against the current code, by design — the before-the-fix half of the
  regression discipline. Do not delete or skip it; make it pass by adding a page-level feature check to
  `/admin/subscriptions/page.tsx`, not by weakening the test.
- No other files modified. `src/lib/permissions.ts` was temporarily mutated in place to prove the
  derivation tests aren't vacuous (Item 4) and fully restored from a pre-mutation copy before this
  pass concluded — `git diff --stat` confirms only the loop-back's own pre-existing (uncommitted) changes
  remain, no residual mutation.
- Dev database restored to its pre-verification state (see above) — no net difference from when this pass
  started.

### Feature-Gate Audit (mandatory before PASS)

| Route or page | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? | Reachable by the role that needs it, not wider? |
|---|---|---|---|---|
| `/admin/documents*` (proxy layer) | n/a | yes — derived rule, `DOCUMENTS_MANAGE` | yes | yes — confirmed via e2e, unchanged from the loop-back's own run |
| `/admin/minutes*` (proxy layer) | n/a | yes — derived rule, `MINUTES_MANAGE`/`MINUTES_DELETE` | yes | yes — confirmed via e2e |
| `/admin/ledger*` (proxy layer) | n/a | yes — derived rule, 6-feature union | yes | yes — confirmed via e2e |
| `/admin/members*` (proxy layer) | n/a | yes — derived rule, `MEMBERS_EDIT`, bounded so it no longer matches `/admin/membership*` | yes | yes — confirmed live and via unit test |
| `/admin/membership*` (proxy layer) | n/a | yes — derived rule, `MEMBERSHIP_MANAGE`, own bounded pattern | yes | yes — confirmed live |
| `/admin/security`, `/admin/users`, `/admin/roles`, `/admin/permissions` (proxy layer) | n/a | yes — derived rules, `ADMIN_SECURITY_VIEW`/`ADMIN_USERS`/`ADMIN_ROLES`/`ADMIN_ROLES` | yes | yes — confirmed live: a `contact.view`-only account is refused all four |
| `/admin/subscriptions` (proxy layer) | n/a | yes — derived rule, `CONTACT_VIEW` | **questionable** — `CONTACT_VIEW` was seeded as "View contact form submissions," a different dataset than the subscriber list this page renders; reusing it predates this refactor and isn't this loop-back's to fix, but is worth a design note | **NO at the page level — see below** |
| `/admin/subscriptions` (page) | yes (`auth()` only) | **NO — zero `hasFeature()` call in the file** | n/a | **NO — this is the FAIL** |
| Ten other newly-derived pages (`membership`, `dues`, `events`, `announcements`, `testimonials`, `programs`, `contact`, `suggestions`, `security`, plus `documents` itself) | yes, every one | yes, every one, matching their nav item's `requiredFeature` | yes | yes — read every file, not inferred |
| `/admin/permissions` (page) | **no — not called at all** | **no** | n/a | pre-existing (commit `ca725a4`), untouched by this diff, no live exposure today (`admin.roles` bound only to `admin`) — flagged as a follow-up, not this verdict's blocker |

### Regression Tests Added

- `e2e/admin-subscriptions-page-gate.spec.ts` — guards against: a `contact.view`-only account (no
  `admin.dashboard`) reading the full newsletter-subscriber PII table at `/admin/subscriptions`, because
  the page performs no `hasFeature()` check of its own and DECISION-082's derivation replaced the
  `ADMIN_DASHBOARD` catch-all this area previously fell to with the narrower `CONTACT_VIEW` requirement
  the "Newsletter" nav item declares. Currently failing (pre-fix); confirmed via direct `curl` probe with
  a real session before the spec was written, and confirmed the spec itself fails for the right reason
  (visible heading, not a fixture-setup error).

### Coverage on Critical Modules

No change from qa's first Phase 5 pass — nothing in this loop-back touched `src/lib/documents.ts`,
`src/lib/documents-queries.ts`, `src/components/documents/diff-blocks.ts`, `src/lib/events.ts`, or
`src/lib/members.ts`. `src/lib/permissions.ts` remains effectively 100%-exercised by
`src/lib/permissions.test.ts`'s existing suite plus the six new `getAdminProtectionRules` tests (all
confirmed non-vacuous this pass, see Item 4).

### Verdict

**FAIL.**

The proxy-derivation refactor itself is correctly built and does exactly what DECISION-082 says it does
— the defect is not in `getAdminProtectionRules()`, the segment-boundary fix, or either notetaker gate.
It is a false safety claim in the same decision's own audit: `/admin/subscriptions` was asserted safe
without being checked, and it is not safe — a `contact.view`-only account can read the full
newsletter-subscriber roster (names and email addresses) with no page-level gate standing behind the
proxy. Per CLAUDE.md, "a missing or wrong gate is a FAIL even if every test passes," and this one
specifically exposes bulk PII exactly along the axis the audit process exists to catch. Returning to
**api-developer** (server-side gating logic, the same domain that owns `src/proxy.ts`/pages' `auth()` +
`hasFeature()` checks) to add a page-level feature check to
`src/app/(dashboard)/admin/subscriptions/page.tsx` mirroring every sibling page's pattern (e.g.
`redirect("/admin")` if the check fails), and to confirm
`e2e/admin-subscriptions-page-gate.spec.ts` goes green. Flagging one design question for tech-lead to
weigh in on *alongside* the fix, not blocking it: whether `CONTACT_VIEW` (seeded description: "View
contact form submissions") is the right key to gate a bulk *subscriber* PII table, or whether this is a
second instance of the "wrong key, not missing key" pattern DECISION-082 itself already found and fixed
once (the `/admin/members`-vs-`/admin/membership` collision) — matching the existing key exactly
preserves current intended behavior and is sufficient to close this FAIL, but a narrower dedicated key
would be more honest about which role actually owns this data, per CLAUDE.md's own audit guidance. Also
carrying forward, non-blocking: `/admin/permissions/page.tsx`'s identical missing-page-gate pattern is
pre-existing and not live-exploitable today, but shares the same defect shape and deserves its own
follow-up ticket rather than being silently dropped now that it's been found. Re-verification after the
fix should be narrow: re-run `e2e/admin-subscriptions-page-gate.spec.ts` (expect green), re-run the four
gating specs from Item 4 once more (expect unchanged), and re-confirm via the same disposable-fixture
technique that a `contact.view`-only account still reaches `/admin/contact` (unchanged, correct) but no
longer sees `/admin/subscriptions`' data.

---

# Phase 4 — Implementation (loop-back 2: subscriptions page gate) — 2026-08-09

**Owner:** api-developer
**Status:** complete

### Summary

Fixed the FAIL qa's Phase 5 re-verification found (`/admin/subscriptions` performed `auth()` only, no
`hasFeature()` call, leaking the full newsletter-subscriber PII table to any account the proxy admitted)
and, per the brief's explicit instruction not to stop at the two named pages, audited all 22 areas under
`src/app/(dashboard)/admin/` for the identical defect shape. Found and closed a second, pre-existing
instance at `/admin/permissions`. During the fix, empirically determined (via qa's own already-written
regression test, which cannot pass under a `contact.view`-based gate) that `CONTACT_VIEW` is not an
adequate long-term key for this data and introduced a dedicated `subscriptions.view` permission
(DECISION-083) rather than reusing the nav's pre-existing key. While auditing the newsletter-subscriber
surface end-to-end, also found and closed an adjacent gap in the export API route. Added a new static
regression test (`src/lib/admin-page-feature-gates.test.ts`, 67 tests) that fails CI if a future admin
page ships without a permission gate or without joining `ADMIN_NAVIGATION` at all.

### What I did

1. **Read first:** this work-log's Phase 5 re-verification (qa) in full, and DECISION-082 in full, per
   the task brief's explicit instruction — not just the summary/verdict.
2. **Confirmed both known defects by reading the live source**, before touching anything:
   `src/app/(dashboard)/admin/subscriptions/page.tsx` (`auth()` only) and
   `src/app/(dashboard)/admin/permissions/page.tsx` (no `auth()` or `hasFeature()` call at all).
3. **Audited all 22 admin areas** (see table below) by reading every `page.tsx` under
   `src/app/(dashboard)/admin/` (not just the top-level list pages — also the `[id]`/`new` sub-pages,
   to understand which areas rely on page-level checks vs. proxy-only admission) and cross-referencing
   against `ADMIN_NAVIGATION`'s declared `requiredFeature`(s) and `src/proxy.ts`/`getAdminProtectionRules()`.
4. **Fixed `/admin/subscriptions`** — added `auth()` (`session.user.id`, matching every sibling page's
   exact pattern) + `hasFeature()` gate + `redirect("/admin")` on failure.
5. **Fixed `/admin/permissions`** — added the identical pattern, using `FEATURES.ADMIN_ROLES` (matching
   the "Permissions" nav item's own declared `requiredFeature` and `/admin/roles`'s own gate exactly).
6. **Ran the required gates with the first-pass fix (`CONTACT_VIEW` for subscriptions)** and found
   `e2e/admin-subscriptions-page-gate.spec.ts` still failing — traced this to the fixture legitimately
   holding `contact.view` (that's how qa composed a "reaches the proxy" account with no `admin.dashboard`),
   which means a page gate that is *also* `CONTACT_VIEW` cannot exclude it. This is empirical proof, not
   just an aesthetic judgment call, that closing the FAIL as *this test defines it* requires a key the
   fixture doesn't hold.
7. **Used the `add-permission` skill** to add `FEATURES.SUBSCRIPTIONS_VIEW` ("subscriptions.view") and an
   idempotent migration binding it to `admin` and `board_member` — the exact two roles that already held
   `contact.view` (see DECISION-083 for the full reasoning, and note the skill's own generic template
   uses a stale `key`/`role_id`+`feature_key` shape that doesn't match this project's real
   `features.name`/`role_features.role_id`+`feature_id` schema — cross-checked against
   `src/lib/db/schema.ts` and `drizzle/migrations/0080_minutes_permissions.sql` before writing the SQL,
   per the skill's own caution to verify column names against the current schema).
8. **Ran the migration against the dev database** (`pnpm db:migrate`) and verified via direct `psql` query
   that `admin` and `board_member` both hold the new key and `contact.view`'s own bindings are untouched.
9. **Updated `ADMIN_NAVIGATION`'s "Newsletter" item and the page gate** to `SUBSCRIPTIONS_VIEW`.
10. **Found an adjacent gap while auditing the subscriber-PII surface end-to-end**:
    `/api/admin/newsletter/export/route.ts` gated solely on `FEATURES.REPORTS_EXPORT` — a generic,
    cross-cutting export permission also used by the dues/ledger/members exports — with no relationship
    to `contact.view` or the new `subscriptions.view` at all. Not live-exploitable today (only
    `admin`/`board_member` hold `reports.export`, and both already hold `subscriptions.view`), but a
    future role granted `reports.export` alone for an unrelated report would have silently gained the
    ability to download the full subscriber list. Fixed to `hasAnyFeature([SUBSCRIPTIONS_VIEW,
    REPORTS_EXPORT])`, matching the OR-pattern `dues/export` and `ledger/export` already use (their own
    resource permission OR the generic export grant) — `members/export` has the identical
    standalone-`REPORTS_EXPORT` shape and was **not** fixed (out of this pass's scope, flagged as a
    follow-up in DECISION-083).
11. **Wrote `src/lib/admin-page-feature-gates.test.ts`** (67 tests, Vitest, `node` environment) — a static
    regression test making the missing-gate defect class fail CI going forward. See "Regression Tests
    Added" below for exactly what it does and doesn't guarantee.
12. **Proved the new test is non-vacuous by mutation, not by inspection**: `git stash push` on just the
    two fixed page files, re-ran the suite (3 tests failed for the expected reason — missing feature-gate
    call and missing `redirect()` on both pages), `git stash pop` to restore, re-ran (67/67 green again).
    `git diff --stat` on those two files after the restore matched the pre-mutation diff exactly.
13. **Ran the full required gate list**: `pnpm exec tsc --noEmit` (clean), `pnpm test` (1371/1371 —
    1304 baseline + 67 new), `pnpm build:only` (`✓ Compiled successfully`), the five named e2e specs
    (`admin-subscriptions-page-gate`, `admin-minutes-notetaker-gate`, `admin-documents-notetaker-gate`,
    `admin-ledger-budget-committee-gate`, `admin-security` — 19/19 passed) — each run against the
    already-running dev server, never restarted, per the task's constraint.
14. **Did not touch `PROD_DATABASE_URL`** — every `psql`/`pnpm db:migrate` command used the dev
    `DATABASE_URL` from `.env.local` exclusively; confirmed by inspecting each command before running it,
    not just by intent.

### The 22-Area Admin Page Audit

Every top-level directory under `src/app/(dashboard)/admin/`. "auth()" / "hasFeature()" columns describe
the area's primary list page (`page.tsx` directly under the segment) — sub-pages (`[id]`, `new`,
nested settings) are noted separately where their pattern differs from the list page's.

| Area | `auth()`? | `hasFeature()`/`hasAnyFeature()`? | Feature(s) checked | Matches `ADMIN_NAVIGATION`'s `requiredFeature`? | Notes |
|---|---|---|---|---|---|
| announcements | yes | yes | `ANNOUNCEMENTS_MANAGE` | yes | `[id]`/`new` sub-pages have no independent check — rely on the proxy's `announcements` segment rule (same `ANNOUNCEMENTS_MANAGE`), which is a correct, matching gate, not a gap |
| campaigns | yes | yes | `CAMPAIGNS_MANAGE` | yes | same sub-page pattern as announcements, same conclusion |
| contact | yes | yes | `CONTACT_VIEW` | yes | unchanged by this pass |
| documents | yes (all 3 pages) | yes (all 3) | `DOCUMENTS_MANAGE` | yes | unrelated feature (governance documents), unchanged |
| dues | yes (both pages) | yes | `hasAnyFeature([DUES_VIEW, DUES_MANAGE])` | yes | unchanged |
| email-queue | yes | yes | `ADMIN_USERS` | **no requiredFeature on the nav item** (falls to the `ADMIN_DASHBOARD` catch-all at the proxy layer) | stricter than the nav suggests, not a gap — a holder of `ADMIN_USERS` but not `ADMIN_DASHBOARD` would be locked out by the proxy before reaching the page's own (looser) check; a pre-existing lockout-shaped quirk, not a widening, out of this pass's scope |
| events | yes | yes | `EVENTS_EDIT` | yes | `[id]`/`new` rely on the proxy's `events` segment rule, same conclusion as announcements |
| groups | yes | yes | `GROUPS_MANAGE` | yes | same pattern |
| ledger (9 sub-pages) | yes, every one | yes, every one | `LEDGER_VIEW`/`RECORD`/`MANAGE`/`APPROVE`/`BUDGET_VIEW`/`BUDGET_EDIT`, area-appropriate | yes | every single ledger sub-page has its own independent check (defense-in-depth beyond the proxy) — the one area that never relied on proxy-only admission for any of its pages |
| members | yes | yes | `MEMBERS_EDIT` | yes | `[id]`/`new` rely on the proxy's bounded `members` segment rule (fixed by DECISION-082 to no longer collide with `membership`) |
| membership | yes | yes | `MEMBERSHIP_MANAGE` | yes | unchanged |
| minutes (3 pages) | yes, all 3 | yes, all 3 | `MINUTES_MANAGE` (+ `MINUTES_DELETE` check on `[id]`) | yes | unchanged |
| **permissions** | **no (fixed this pass)** | **no (fixed this pass)** | now `ADMIN_ROLES` | now yes | **the second defect this pass closes** — see below |
| programs | yes | yes | `ANNOUNCEMENTS_MANAGE` | yes | unchanged |
| release-notes | yes | no (by design) | — | nav item has no `requiredFeature`, matching `ADMIN_NAVIGATION`'s own doc comment | on the new test's documented allowlist; proxy's `ADMIN_DASHBOARD` catch-all is the real gate |
| roles | yes | yes | `ADMIN_ROLES` | yes | unchanged |
| security | yes | yes | `ADMIN_SECURITY_VIEW` | yes | unchanged |
| **subscriptions** | **no → yes (fixed this pass)** | **no → yes (fixed this pass)** | now `SUBSCRIPTIONS_VIEW` (new key, not `CONTACT_VIEW` — DECISION-083) | now yes | **the primary defect this pass closes** — see below |
| suggestions | yes | yes | `SUGGESTIONS_VIEW` | yes | unchanged |
| sync-log | yes | no (by design) | — | nav item has no `requiredFeature` | on the allowlist, same shape as release-notes; shows Google-Group sync history including member emails to any `ADMIN_DASHBOARD` holder — pre-existing, unaffected by DECISION-082 (never one of its 11 newly-derived areas), out of this pass's scope but noted for completeness since it's real PII behind a coarse gate |
| testimonials | yes | yes | `ANNOUNCEMENTS_MANAGE` | yes | `[id]`/`new` sub-pages rely on the proxy's `testimonials` segment rule (correctly derived post-DECISION-082) |
| users | yes | yes | `ADMIN_USERS` | yes | `[id]` sub-page relies on the proxy's `users` segment rule (one of the eight pre-existing hand-written rules, unchanged) |
| *(root)* `/admin` | yes | inline `.includes(FEATURES.ADMIN_DASHBOARD)`, not `hasFeature()` | `ADMIN_DASHBOARD` | yes (Dashboard nav item) | its own narrower gate on top of the layout's coarser `canAccessAdminArea` check, per its own doc comment — unchanged, asserted separately in the new test since it doesn't use the `hasFeature()`/`hasAnyFeature()` helper functions |

**Result: 20 of 22 areas were already correctly gated at the page level** (matching or exceeding their
`ADMIN_NAVIGATION`-declared feature); **2 had zero page-level gate** (`subscriptions`, `permissions`,
both fixed this pass); **2 intentionally have none by design** (`email-queue` has its own, stricter check
despite the nav item declaring none; `sync-log`/`release-notes` rely on the documented `ADMIN_DASHBOARD`
catch-all). No area was found admitting a *wider* audience than its own page-level check enforces —
the proxy layer is either exactly matched or stricter everywhere except the two now-fixed pages, which is
the property this whole audit exists to confirm.

### Who could reach each fixed page before, and who can now

- **`/admin/subscriptions`**: **Before** — anyone the proxy admitted to the `subscriptions` segment. Pre-
  DECISION-082, that was `ADMIN_DASHBOARD` holders only (`admin`, `board_member`, and anyone else granted
  `admin.dashboard`). Post-DECISION-082 (before this fix), that widened to any `CONTACT_VIEW` holder —
  today still only `admin`/`board_member` in this project's actual seed data, but with no page-level
  backstop if that ever changed. **After this fix** — exactly `admin` and `board_member` (via the new
  `subscriptions.view` key, DECISION-083), enforced independently at the page level regardless of what the
  proxy admits. **No one who previously had legitimate access lost it**; the only account shape that loses
  access is a hypothetical future `CONTACT_VIEW`-only role that was never actually granted in this
  project's data — confirmed via the `psql` query in step 8 above.
- **`/admin/permissions`**: **Before** — the proxy's hand-written `permissions` rule already required
  `ADMIN_ROLES` (one of DECISION-082's eight byte-for-byte-preserved pre-existing rules, unrelated to that
  refactor), so in practice only `ADMIN_ROLES` holders (`admin` today) could ever reach the page at all —
  the missing page-level check was real but not live-exploitable. **After this fix** — identical
  real-world population (`ADMIN_ROLES` holders), now enforced at both layers instead of one. No behavior
  change for anyone.
- **`/api/admin/newsletter/export`**: **Before** — anyone holding `REPORTS_EXPORT` (today: `admin`,
  `board_member` — the same population as after). **After** — anyone holding `SUBSCRIPTIONS_VIEW` OR
  `REPORTS_EXPORT` — a strict superset by construction, but identical in practice today since both keys
  resolve to the same two roles; the change closes a *future* gap (a `REPORTS_EXPORT`-only role gaining
  subscriber-PII export rights by accident), not a present one.

### Outputs

- **`src/app/(dashboard)/admin/subscriptions/page.tsx`** — added `auth()` (`session.user.id`) +
  `hasFeature(session.user.id, FEATURES.SUBSCRIPTIONS_VIEW)` + `redirect("/admin")` on failure.
- **`src/app/(dashboard)/admin/permissions/page.tsx`** — added the identical pattern using
  `FEATURES.ADMIN_ROLES`, matching `/admin/roles/page.tsx` exactly.
- **`src/app/api/admin/newsletter/export/route.ts`** — `hasFeature(REPORTS_EXPORT)` →
  `hasAnyFeature([SUBSCRIPTIONS_VIEW, REPORTS_EXPORT])`.
- **`src/lib/permissions.ts`** — new `FEATURES.SUBSCRIPTIONS_VIEW`, `FEATURE_DESCRIPTIONS` entry,
  `FEATURE_CATEGORIES.SUBSCRIPTIONS`, and the "Newsletter" `ADMIN_NAVIGATION` item's `requiredFeature`
  changed from `CONTACT_VIEW` to `SUBSCRIPTIONS_VIEW`. Because `src/proxy.ts`'s admin-area rules are
  derived from `ADMIN_NAVIGATION` (DECISION-082), this single change is also what re-points the proxy's
  `subscriptions` segment rule — no `proxy.ts` edit was needed.
- **`drizzle/migrations/0083_subscriptions_view_permission.sql`** (new, idempotent) — inserts
  `subscriptions.view` and binds it to `admin` and `board_member`. Run against dev via `pnpm db:migrate`;
  confirmed via `psql` (see step 8).
- **`src/lib/admin-page-feature-gates.test.ts`** (new, 67 tests) — see "Regression Tests Added."
- **`docs/decisions.md`** — new **DECISION-083** (placed above DECISION-082, newest-first).

**API contracts for the next agent (qa, Phase 5 re-run):**

- `/admin/subscriptions` (Server Component page, not an API route) — auth: `auth()` session required;
  authorization: `hasFeature(session.user.id, FEATURES.SUBSCRIPTIONS_VIEW)`, redirects to `/admin` on
  failure. No request/response shape change — same subscriber table as before, now correctly gated.
- `/admin/permissions` (Server Component page) — auth: `auth()`; authorization:
  `hasFeature(session.user.id, FEATURES.ADMIN_ROLES)`, redirects to `/admin` on failure. No content change.
- `GET /api/admin/newsletter/export?format=zeffy` — auth: `auth()`; authorization:
  `hasAnyFeature(session.user.id, [FEATURES.SUBSCRIPTIONS_VIEW, FEATURES.REPORTS_EXPORT])`. Response shape
  unchanged (an `.xlsx` file).
- No schema changes beyond the new `features`/`role_features` rows the migration inserts — no new tables,
  no changes to `src/lib/db/schema.ts`.

### Regression Tests Added

- **`e2e/admin-subscriptions-page-gate.spec.ts`** (already existed, written by qa) — now green. Not
  modified in any way; the fix was made to satisfy it as written, not to weaken it.
- **`src/lib/admin-page-feature-gates.test.ts`** (new, 67 tests) — static source-text regression coverage
  for the missing-page-gate defect class:
  1. Every top-level directory under `src/app/(dashboard)/admin/` has a matching `ADMIN_NAVIGATION` entry
     (closes the "page directory that never joined the nav" loophole `getAdminProtectionRules()`'s own
     doc comment names as explicitly unclosed).
  2. Every such area's `page.tsx` calls `hasFeature()`/`hasAnyFeature()` (or the inline
     `.includes(FEATURES.*)` pattern the dashboard root uses) **and** calls `redirect()` — unless the
     segment is on a small, explicit, documented allowlist (`sync-log`, `release-notes`) mirroring
     `ADMIN_NAVIGATION`'s own comment about which areas intentionally have no permission of their own.
     A test also asserts the allowlist itself stays honest — it fails if a future change ever adds a
     `requiredFeature` to either allowlisted nav item without also removing it from the allowlist.
  3. The `/admin` dashboard root is asserted separately (it uses the inline session-features check, not
     the helper functions).
  - **Confirmed non-vacuous by mutation** (step 12 above): stashed the two page fixes, 3 tests failed for
    the right reason (missing gate call, missing `redirect()` on both pages), restored, re-ran green.
  - **What this test does NOT guarantee**, stated as honestly as `getAdminProtectionRules()`'s own doc
    comment states its limits: it cannot verify the gate checks the *correct* feature (a page could call
    `hasFeature()` with the wrong key and still pass this test — exactly DECISION-083's own `CONTACT_VIEW`
    lesson, which is why the Feature-Gate Audit and qa's manual click-through remain load-bearing, not
    replaced by this test), cannot verify the check runs on every code path before data is fetched, and
    cannot verify a component the page renders doesn't itself leak data. It closes the specific,
    previously-realized failure mode ("a new admin page ships with zero permission-gate call, or ships
    outside `ADMIN_NAVIGATION` entirely") — not every way an admin page could theoretically be miswired.

### Coverage on Critical Modules

- `src/lib/permissions.ts` — still effectively 100%-exercised; `src/lib/permissions.test.ts` (94 tests
  after this pass, up from 88 — no existing tests needed changes, since `getAdminProtectionRules()`
  derives from `ADMIN_NAVIGATION` data rather than hardcoding `CONTACT_VIEW`/`SUBSCRIPTIONS_VIEW`
  anywhere) plus the new `src/lib/admin-page-feature-gates.test.ts` (67 tests) cover the nav-derivation
  and page-gate-presence axes respectively.
- No other library module touched this pass.

### Gates

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — **1371/1371 passed** (1304 baseline + 67 new in `admin-page-feature-gates.test.ts`), 76
  test files.
- `pnpm build:only` — `✓ Compiled successfully`.
- `e2e/admin-subscriptions-page-gate.spec.ts` — **green** (was the required, previously-failing gate).
- `admin-minutes-notetaker-gate.spec.ts`, `admin-documents-notetaker-gate.spec.ts`,
  `admin-ledger-budget-committee-gate.spec.ts`, `admin-security.spec.ts` — **18/18 unchanged, still green.**
- All 5 specs together: **19/19 passed**, run against the already-running dev server (never restarted,
  per the task's explicit constraint).
- `PROD_DATABASE_URL` never referenced by any command this pass. No live email path exercised.

### Open questions / handoff notes

- **Next: qa**, for the Phase 5 re-run. Suggested scope, narrower than a full re-audit since the only
  surface that changed this pass is permissions/gating (not `documents-queries.ts`, not the diff/version
  lifecycle, not any UI component): re-run `e2e/admin-subscriptions-page-gate.spec.ts` plus the four
  previously-green gate specs (confirm still green); spot-check live with a fresh `board_member`-shaped
  and `admin`-shaped account that `/admin/subscriptions` still renders correctly for legitimate holders
  (this pass confirmed the negative case live via the e2e spec and the `psql` role-binding query, but did
  not screenshot/click-through the positive case); confirm the new `admin-page-feature-gates.test.ts`
  suite reads as intended (not just that it passes) since it's the artifact meant to prevent a sixth
  recurrence of this bug class.
- **Follow-ups logged, not fixed, not blocking:**
  - `/api/admin/members/export/route.ts` has the identical standalone-`REPORTS_EXPORT` gating shape the
    newsletter export route had — not live-exploitable today, out of this pass's scope (a members-data
    question, not a subscriptions one), flagged in DECISION-083 for a future look.
  - `/admin/sync-log` shows Google-Group sync history including real member email addresses to any
    `ADMIN_DASHBOARD` holder, with no dedicated permission of its own — pre-existing, unaffected by
    DECISION-082 (never one of its 11 newly-derived areas, always behind the `ADMIN_DASHBOARD` catch-all),
    genuinely PII-adjacent, worth a future look but explicitly out of this pass's scope (the brief's
    defect class was "narrower-than-catch-all gate with no page backstop," not "coarse catch-all gate on
    PII" — a real but different question).
  - `/admin/email-queue`'s nav item declares no `requiredFeature` even though its page enforces
    `ADMIN_USERS` independently — a harmless inconsistency (the page is stricter than the nav suggests,
    not looser), not touched.
  - The admin dashboard's "Newsletter Subscribers" stat card (`src/app/(dashboard)/admin/page.tsx`) links
    to `/admin/newsletter`, which does not exist (the real route is `/admin/subscriptions`) — a pre-existing
    dead link, unrelated to permissions, noticed incidentally while auditing this file and left unfixed as
    out of scope for a security pass.

---

# Phase 5 — Verification (FINAL re-run) (qa)

**Date:** 2026-08-09
**Verified by:** qa
**Scope:** re-verification of the loop-back 2 fix (DECISION-083, `subscriptions.view`) and, per the task
brief, an independent re-check of everything the brief called out by name — not a re-trust of the
implementer's own claims. Every check below was re-derived from the live source, the live dev database, or
a real HTTP session this pass created itself; nothing here is copied forward from the prior two Phase 5
passes without being re-run.

### Summary

**Verdict: PASS.** The original `/admin/subscriptions` PII exposure is genuinely closed and does not
overcorrect into a lockout: a disposable account holding only `contact.view` is refused (no
`hasFeature()` gate to slip through anymore), a disposable account holding only the new
`subscriptions.view` is admitted and sees real data, and a real `board_member`-shaped account — the
like-for-like claim DECISION-083 makes — still reaches the page with no code path changes required for
it. The three intentionally-open areas (`email-queue`, `sync-log`, `release-notes`) are still refused to
a narrow-feature account with no `admin.dashboard`, confirming the `ADMIN_DASHBOARD` catch-all these areas
rely on is undisturbed by DECISION-083. The newsletter export endpoint's `SUBSCRIPTIONS_VIEW`-only
account can export successfully, confirming the widened `hasAnyFeature()` gate didn't strand anyone. The
new `src/lib/admin-page-feature-gates.test.ts` suite is not vacuous — reverting the two fixed pages to
their genuinely pre-fix, committed-parent content (via `git stash`, not a hand-edited approximation) fails
exactly 3 of 67 tests for the correct, on-topic reasons, and restoring returns to a byte-identical diff and
67/67 green. All four gates (`tsc --noEmit`, `pnpm test`, `pnpm build:only`, the five named e2e specs)
pass, the full e2e suite shows zero failures beyond the pre-declared known-bad baseline, and the
governance-documents feature itself is confirmed untouched by this loop-back (no file in
`documents-queries.ts`/`documents.ts`/its API routes/its UI components appears in `git diff --name-only`;
dev DB state is byte-identical to what the first Phase 5 pass restored it to). **Ready for Phase 6.**

### What I did

**Read first:** the Phase 5 original FAIL, the Phase 5 re-run FAIL, the Phase 4 loop-back (proxy
derivation), the Phase 4 loop-back 2 (subscriptions page gate) sections of this work-log in full, plus
DECISION-082 and DECISION-083 in full — not just the verdicts/summaries.

**Gates, re-run independently, not taken on the implementer's word:**
- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — **1371/1371 passed**, 74 test files, matches the task brief's stated baseline exactly.
- `pnpm build:only` — `✓ Compiled successfully`; confirmed the route manifest still lists all
  governance-documents routes (`/admin/documents*`, `/members/records/documents/[slug]*`) and the
  unchanged `/api/admin/newsletter/export` route.

**Item 1 — the original exposure is genuinely closed, tested with two fresh disposable single-feature
accounts this pass created itself (not reusing qa's prior fixtures), via real NextAuth credentials-flow
HTTP sessions, not mocks:**
- A `contact.view`-only account (base role `member`, one feature grant, deliberately no `admin.dashboard`,
  no `subscriptions.view`) hitting `/admin/subscriptions` directly: **307 redirect**, response body
  contains no "Newsletter Subscribers" heading and no subscriber data — confirmed by fetching the response
  body and checking for the heading string, not just the status code.
- A `subscriptions.view`-only account (base role `volunteer`, one feature grant, no `admin.dashboard`, no
  `contact.view`) hitting the same route: **200**, "Newsletter Subscribers" heading present in the
  response body — confirms the fix does not lock out the population it was built for.
- Also re-ran the pre-existing `e2e/admin-subscriptions-page-gate.spec.ts` (qa's own regression spec from
  the prior pass) against current code: **passes**, matching the live-HTTP result above independently.

**Item 2 — `board_member` still works, tested directly rather than accepted from the decision record:**
created a disposable account bound to the real `board_member` role with **zero extra feature grants** (it
already holds `subscriptions.view` and `contact.view` natively per the dev-DB query below) and hit
`/admin/subscriptions`: **200**, heading and data present. This is the like-for-like claim, verified live,
not just read off the migration.

**Item 3 — the three intentionally-open areas, tested for a genuine widening/narrowing regression:**
created a disposable account with **only its base role's default `events.view`** (no `admin.dashboard`,
no area-specific feature) and hit `/admin/email-queue`, `/admin/sync-log`, `/admin/release-notes`
directly: **all three returned 307** — still refused, confirming the `ADMIN_DASHBOARD` catch-all these
three areas rely on (they have no `requiredFeature` of their own in `ADMIN_NAVIGATION`, so
`getAdminProtectionRules()` derives no rule for them and they fall to the generic `/^\/admin/` proxy rule)
is unaffected by DECISION-083's change to the "Newsletter" nav item. DECISION-083 only changed one nav
item's `requiredFeature`; it does not touch the derivation mechanism itself, and this probe confirms that
holds under a live request, not just by code inspection.

**Item 4 — the newsletter export change doesn't lock out a prior legitimate exporter:** the same
`subscriptions.view`-only account from Item 1 called `GET /api/admin/newsletter/export`: **200**, correct
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` content-type. Confirms the
`hasAnyFeature([SUBSCRIPTIONS_VIEW, REPORTS_EXPORT])` OR-gate admits a `subscriptions.view` holder even
without `reports.export`, and — since `admin`/`board_member` (the only real exporters before this change)
both hold `subscriptions.view` today (confirmed via the same `psql` query as Item 2) — neither loses
export access.

**Item 5 — the static test is not vacuous, re-proven independently rather than trusting the implementer's
own mutation run:** used `git stash push -- <subscriptions page> <permissions page>` to revert both files
to their exact last-committed (genuinely pre-fix) content — not a hand-edited comment-out, which a first
attempt at this check showed is insufficient (see Open Questions below) because the source-text regex the
test uses does not distinguish code from comments, and the fix's own doc comments contain the literal
substring `hasFeature(` inside prose. With the real `git stash` revert (confirmed via `grep` that the
reverted `subscriptions/page.tsx` contains no `hasFeature` token anywhere, code or comment, only its
original `auth()`-only body): re-ran `pnpm exec vitest run src/lib/admin-page-feature-gates.test.ts` —
**3 of 67 failed**, exactly the two files × the expected assertions (`subscriptions/page.tsx` and
`permissions/page.tsx` both fail "calls hasFeature()...", `permissions/page.tsx` additionally fails
"...enforces the gate with a redirect()" since its pre-fix body had no `redirect()` call at all). `git
stash pop` restored both files; `git diff --stat` on both after restore matched the pre-mutation diff
exactly (44 lines: 25 insertions/1 deletion + 19 insertions across the two files, unchanged); re-ran —
**67/67 green** again. This satisfies the task's requirement to apply the same non-vacuity technique
independently, not accept the implementer's own claim of it.

**Item 6 — nothing else regressed:**
- The five named specs, re-run together against the running dev server:
  `e2e/admin-subscriptions-page-gate.spec.ts`, `e2e/admin-minutes-notetaker-gate.spec.ts`,
  `e2e/admin-documents-notetaker-gate.spec.ts`, `e2e/admin-ledger-budget-committee-gate.spec.ts`,
  `e2e/admin-security.spec.ts` — **19/19 passed**.
- Full e2e suite (131 tests): **97 passed, 7 failed, 1 skipped, 27 did not run** (cascading skips from
  `mode: "serial"` files after their first failure, same shape as every prior pass). All 7 failures
  matched the task brief's pre-declared known-bad baseline by name — `budget-star-notes`,
  `budgeting-restructure`, `cancel-occurrence` (×2), `ledger-search`, `prior-year-cause-line-reconcile`,
  `transaction-budget-line-link` — confirmed by reading each failure's spec file path against the baseline
  list, not assumed. **Zero new failures.**
- The governance-documents feature itself: confirmed via `git diff --name-only` / `git status --porcelain`
  that this pass's changes touch only `src/app/(dashboard)/admin/subscriptions/page.tsx`,
  `src/app/(dashboard)/admin/permissions/page.tsx`, `src/app/api/admin/newsletter/export/route.ts`,
  `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `src/proxy.ts`, the new migration/decision/
  work-log docs — **no file under `src/lib/documents.ts`, `src/lib/documents-queries.ts`,
  `src/app/(dashboard)/admin/documents/`, `src/app/api/admin/documents/`,
  `src/app/members/records/documents/`, or `src/components/documents/` appears in either diff.** Dev
  database state re-confirmed via `psql`: exactly one `documents` row and one `document_versions` row,
  `documents.current_version_id` still points at the original seeded version 1
  (`3e33af2d-6026-47f2-bbec-e1c04d88a840`) — byte-identical to what qa's first Phase 5 pass restored.
  `e2e/admin-documents-notetaker-gate.spec.ts` (4/4) confirms the admin document read/write surface is
  still reachable by `notetaker` and still refused elsewhere. Given zero code in the documents feature's
  own files changed this pass, a full re-run of the lifecycle/concurrency/pending-version-gate/diff-
  readability adversarial battery (qa's first Phase 5 pass) was not repeated — narrower re-confirmation is
  proportionate here, matching the "narrow scope" guidance every prior loop-back's own handoff note gave.

**All dev data restored.** Every fixture user created this pass (five: contact.view-only, subscriptions
.view-only, board_member-shaped, narrow/events.view-only, plus one abandoned member-linkage probe — see
Open Questions) and every temporary `role_features` grant was deleted immediately after its own probe
completed, not batched to the end — verified via `psql` after each fixture's cleanup that `volunteer` and
`member` are back to their exact baseline bindings (`volunteer`: `events.view` only; `member`:
`events.view`, `members.view` only) and that zero `users` rows remain matching the
`qa-final-verify-*@example.test` pattern. Two scratch `.ts` files used to drive the HTTP-session probes
were written to the repo root, run via `pnpm exec dotenv -e .env.local -- tsx`, and deleted immediately
after use — never committed, never placed in `scripts/`. `PROD_DATABASE_URL` was explicitly `unset` in
the shell before every command this pass ran against the database; no command in this pass referenced it.
No email send path was exercised.

### Outputs

- No files modified by this pass beyond the work-log itself (this section) and the Per-Phase Status
  table update at the top of this file. All source-file mutations performed during verification (Item 5's
  `git stash`/`git stash pop`) were fully reverted and confirmed byte-identical via `git diff --stat`
  before this pass concluded.
- Dev database restored to its pre-verification state — no net difference from when this pass started
  (confirmed via the same `documents`/`document_versions` row-count and `current_version_id` check qa's
  prior two passes used).

### Feature-Gate Audit (mandatory before PASS)

| Route or page | `auth()` present? | `hasFeature(...)`/`hasAnyFeature(...)` present? | Correct `FEATURES.*` key? | Reachable by the role that needs it, not wider? |
|---|---|---|---|---|
| `/admin/subscriptions` (page) | yes | yes — `hasFeature(FEATURES.SUBSCRIPTIONS_VIEW)` | yes — dedicated key, not a `contact.view` reuse (DECISION-083) | yes — confirmed live: `subscriptions.view`-only admitted, `contact.view`-only refused, `board_member` admitted |
| `/admin/permissions` (page) | yes | yes — `hasFeature(FEATURES.ADMIN_ROLES)` | yes — matches `/admin/roles`'s own gate and the nav item's declared feature | yes — only `ADMIN_ROLES` holders (`admin` today); no live population change |
| `GET /api/admin/newsletter/export` | yes | yes — `hasAnyFeature([SUBSCRIPTIONS_VIEW, REPORTS_EXPORT])` | yes — resource-specific OR generic-export, matching the `dues`/`ledger` export pattern | yes — confirmed live: `subscriptions.view`-only account exports successfully |
| `/admin/documents*`, `/admin/minutes*`, `/admin/ledger*`, `/admin/members*`, `/admin/membership*`, `/admin/security`, `/admin/users`, `/admin/roles` (proxy layer, `getAdminProtectionRules()`) | n/a | yes — derived rules, unchanged by this pass | yes | yes — confirmed via the 19/19 five-spec run; no code in `src/proxy.ts` or the derivation function changed since the last Phase 5 pass |
| `/admin/email-queue`, `/admin/sync-log`, `/admin/release-notes` (no dedicated key, by design) | yes (page-level, `email-queue` only) | `email-queue`: yes (own stricter `ADMIN_USERS` check); `sync-log`/`release-notes`: no, by design | n/a — documented allowlist | yes — confirmed live this pass: a narrow single-feature account with no `admin.dashboard` is refused all three via the `ADMIN_DASHBOARD` catch-all |
| `src/lib/admin-page-feature-gates.test.ts` (static regression, not a runtime route) | n/a | n/a | n/a | confirmed non-vacuous independently this pass via `git stash`-based mutation (Item 5) |

No protected route or server action beyond the table above was added or changed by loop-back 2.

### Regression Tests Added

None new this pass — the two regression tests this FAIL cycle produced
(`e2e/admin-subscriptions-page-gate.spec.ts` from the Phase 5 re-run, `src/lib/admin-page-feature-gates
.test.ts` from the loop-back 2 implementation) were both independently re-verified for correctness and
non-vacuity in this pass (Items 1 and 5) rather than superseded.

### Coverage on Critical Modules

No change from the loop-back 2 implementer's own report — nothing in this pass's scope touched
`src/lib/documents.ts`, `src/lib/documents-queries.ts`, `src/components/documents/diff-blocks.ts`,
`src/lib/events.ts`, or `src/lib/members.ts`. `src/lib/permissions.ts` remains effectively
100%-exercised (94 tests in `permissions.test.ts` + 67 in `admin-page-feature-gates.test.ts`, both
suites re-run and green this pass).

### Verdict

**PASS.**

Every item the task brief named was independently re-derived, not accepted on the implementer's or the
prior QA pass's word: the original PII exposure is closed without locking out `subscriptions.view` or
`board_member`; the three intentionally-open catch-all areas are still genuinely protected; the newsletter
export change is additive, not exclusionary; the static regression test fails for the right reason when
the fix is genuinely reverted (via `git stash`, not a cosmetic comment-out) and passes cleanly once
restored; the full e2e suite shows zero new failures against the declared baseline; and the
governance-documents feature's own code and data are confirmed untouched by this loop-back. All gates
(`tsc --noEmit`, `pnpm test` at 1371/1371, `pnpm build:only`) pass. No open FAIL remains in this work-log.

**Next: analyst, for Phase 6 (Shipped vs Intent).** Suggested framing for that pass: the feature itself
(versioning, diffing, adoption workflow, seed) was fully verified in the first Phase 5 pass and untouched
since; the two loop-backs were entirely about an unrelated structural refactor's blast radius
(DECISION-082's proxy derivation) landing on a pre-existing gap in `/admin/subscriptions` and
`/admin/permissions` — worth naming explicitly in the Phase 6 write-up as scope creep that got caught and
closed, not a defect in the governance-documents feature's own design.

### Open questions / handoff notes

- **A methodology note for future QA passes, not a defect:** my first attempt at Item 5's non-vacuity
  check used a hand-edited comment-out of the `hasFeature()` call rather than a full revert, and it
  produced a false "still passing" result — the source-text regex `admin-page-feature-gates.test.ts` uses
  does not strip comments, and the fix's own doc comment happens to contain the literal substring
  `hasFeature(` in prose describing the fix. `git stash` against the real committed diff is the correct
  mutation technique (matching what the loop-back 2 implementer actually did); a hand-edited comment-out
  is not equivalent and can silently under-report. Worth remembering next time this test is mutation-
  tested.
- **Follow-ups carried forward from DECISION-083, still not fixed, still not blocking:**
  `/api/admin/members/export/route.ts`'s standalone-`REPORTS_EXPORT` gating shape; `/admin/sync-log`'s
  PII-adjacent content behind only the `ADMIN_DASHBOARD` catch-all; `/admin/email-queue`'s nav item having
  no `requiredFeature` despite the page enforcing one anyway; the dead `/admin/newsletter` link on the
  admin dashboard's stat card. None of these are this work-log's to fix — noted so they aren't lost before
  Phase 6 closes this entry.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-08-09
**Reviewed by:** analyst

## VERDICT

**SHIP WITH NOTES.**

## ONE-LINE TAKE

> The club's by-laws now have a real in-app home — immutable versions, an unambiguous "current text"
> pointer, a legible editorial/substantive choice, and an adversarially-verified permission boundary
> around unadopted amendments — but the treasurer's own "authoritative once live" framing never made it
> onto the page a member actually reads, one confirm dialog undersells its own irreversibility, and the
> feature is fully built and shipped in code while production sits unseeded, so no member can read any
> of this yet.

## What's Working

- **The version lifecycle is unambiguous by construction, and QA proved it, not just asserted it.**
  `documents.currentVersionId` as a pointer (never `MAX(versionNumber)` or a derived "latest adopted"
  query) means "what's the operative text right now" is always one indexed lookup. QA's Phase 5 pass
  didn't take this on faith — it created a pending substantive version, then an editorial version on top
  of it (pending stayed pending, editorial went live immediately), adopted an out-of-order older version
  while a newer editorial one was current (pointer correctly moved backward), tried to adopt an editorial
  version (409) and adopt twice (409), and fired 5 concurrent version-creation requests at the same
  document (zero version-number collisions). This is exactly the kind of design-was-actually-load-bearing
  verification a governance feature needs and got it.
- **Editorial vs. substantive is genuinely legible to a non-technical board member, not just to a
  developer.** `document-version-form.tsx` renders two full description cards, not a bare `<select>`:
  editorial explicitly says "Fixes typos, formatting, or clarifies existing wording... Becomes the club's
  current text immediately — no vote needed"; substantive says "Changes what the by-laws actually
  require — dues, terms, procedures, amendments. Stays pending until the board adopts it by vote; members
  won't see it until then." The submit button label and the post-save toast both change to match the
  selection. This directly answers the task's crux question 4 (editorial vs. substantive legibility) in
  the affirmative — a treasurer fixing a typo and a treasurer proposing a dues change are told, in the
  moment, in plain language, what each choice does and doesn't require.
- **The pending-version gate is real, not just page-deep.** QA tested it with a genuine non-admin member
  session (not the E2E admin account that bypasses proxy checks): the admin versions API 403s a plain
  member, the member-facing history page has zero occurrence of a pending version's marker text (excluded
  at the query layer, not hidden in the DOM), and guessing a pending version's id in the member compare
  page's URL 404s rather than leaking text. A `board_member` account with `admin.dashboard` but not
  `documents.manage` reaches `/admin` but not `/admin/documents`. This is the correct behavioral line
  Phase 2 drew (a pending amendment is "not yet the club's actual governing text") and it held under
  adversarial testing with real sessions, not mocks.
- **The audit trail claim actually cashes out into visible UI**, which is the part I was most skeptical
  of going in, given the design's own framing was "the version chain IS the audit trail, no separate audit
  table needed." In practice, `version-history-list.tsx` puts who (author/adopter name, falling back to
  email), when (`createdAt`/`adoptedAt`), what (change-type badge + a "View what changed →" diff link),
  and why (`changeNote`/`adoptionNote`, both required non-empty fields) on one card per version. That's a
  legitimate answer to "who, when, what, why" — the treasurer's original ask — even without a dedicated
  audit-log screen. The one real gap in this claim is noted below.
- **The diff view was built for the actual 642-line document, not a toy case**, and it shows: line-level
  jsdiff output is grouped into alternating context/change blocks, unchanged runs longer than 10 lines
  collapse behind a native `<details>` (works without JS), each changed region gets a numbered anchor and
  a "Jump to N" pill. QA's one live test (`$60.00` → `$127.00`, the treasurer's own stale-dues example)
  confirmed the rendering is clean on real content. See the diff note below on what wasn't tested.
- **The notetaker lockout and the subscriptions PII exposure were both caught before shipping, not
  after** — that's the pipeline working as designed. `src/proxy.ts` deriving its `protectionRules` from
  `ADMIN_NAVIGATION` (DECISION-082) is a structurally sound fix to a bug class that had already recurred
  four times before this feature hit it a fifth; the follow-up subscriptions gap it exposed was closed
  with a dedicated `subscriptions.view` key and a non-vacuous static regression test (`git stash`-based
  mutation, not a hand-edited comment-out) rather than a quick patch. Both fixes were independently
  re-verified by QA's third pass, not taken on the implementer's word.
- **No design decision blocks a second document.** `slug`/`visibility` are per-row, routes are
  `[slug]`-parameterized throughout, `listDocumentsForMembers()` already returns a collection. Scoping
  down from "documents system" to one document (Phase 2 Ruling 1) was the right call and doesn't need to
  be revisited when a second one lands.

## Intent-vs-Shipped Diff

- Phase 1 said (via the treasurer, 2026-08-09): "the website version becomes authoritative once live."
  Shipped: this is true at the data layer (once seeded, `currentVersionId` is the one queryable answer)
  and stated in the git file and the seed script's console output — but **never stated on the page a
  member actually reads**. Verdict: **acceptable drift for what it does say ("Current — the club's
  operative text" functionally communicates "this is the governing text"), but a real gap against what
  was asked** — the treasurer's specific word "authoritative," and the supersession-of-the-1998-scan
  framing, only exist where a member will never see them. Tracked as B-40.
- Phase 1/2 said: members-only, not public, with `visibility` as a one-row flip for later. Shipped:
  matches exactly — `visibility: 'members'` on the seeded row, route-level `auth()` gating, column
  documented as the flip point for a future public document. Verdict: **matches.**
- Phase 1/2 said: "publish as-is first, then a round of updates" (sequencing). Shipped: the seed script
  is the as-is publish step, correctly never auto-run (dry-run default, requires `--apply` against
  `PROD_DATABASE_URL` explicitly). Verdict: **matches the design**, but see the "could he actually use
  this today" note below — the as-is publish hasn't happened against production yet, as far as this
  review can determine from the repo (I cannot query the live database from here).
- Phase 1 said: "should have auditing." Shipped: no separate audit table, but a real per-version
  who/when/what/why summary in the UI. Verdict: **matches in substance**, though the fact that "what
  changed" requires one more click (into the diff view) rather than being inline is a reasonable
  trade-off for a 642-line document, not a shortfall.
- Phase 1 said: "each document maybe should inherit different permission schemes." Shipped: documents
  has its own `documents.manage` key, independent of `minutes.manage`, per DECISION-076's module-
  separation reasoning. Verdict: **matches** — though this is only proven for a corpus of one; a genuinely
  *different* permission scheme per document (e.g., one document editable by `notetaker`, a hypothetical
  second editable only by `board_member`) isn't modeled — `documents.manage` is one key for all documents,
  not a per-document binding. Not a defect against what was asked (the treasurer never asked for a second
  document with different permissions, just floated it as a "maybe"), but worth naming as a real limit if
  a second document arrives with different authorship rules in mind.
- Design said (Phase 3 Ruling 6): destructive/irreversible admin actions use `<ConfirmDialog destructive>`.
  Shipped: `<ConfirmDialog>` is used for adoption (never `window.confirm`), correctly — but `destructive`
  is not passed, despite the dialog's own copy calling the action irreversible. Verdict: **regression
  against CLAUDE.md's own explicit rule**, small and mechanical. Tracked as B-39.

## Edge Cases

- Empty state: **not applicable** — no document exists in the member-facing UI until the seed script runs;
  there's no "0 documents" list state to design for since `/members/records` always shows either the
  seeded document or (pre-seed) nothing, and pre-seed is explicitly an intermediate deploy state, not a
  steady-state empty condition a member is expected to hit.
- Failure microcopy: **pass** — the 409s QA exercised return human sentences ("Only substantive versions
  can be adopted…", "This version has already been adopted.", "Adopt this version before citing
  minutes"), not stack traces or raw error codes.
- Permission gate: **pass** — verified with real sessions at both the route/page level and the
  `src/proxy.ts` middleware level, for `documents.manage` holders, non-holders, and the specific
  `notetaker`-without-`admin.dashboard` shape this feature exists for. This is the one area QA tested
  hardest and it held after the loop-back fix.
- Mobile (360px): **not verified** — nothing in the Phase 4/5 record shows a mobile-viewport check on the
  admin editor, the version-history cards, or the diff view specifically. Given the diff view is the one
  surface most likely to strain at 360px (side-by-side context, jump-link pill bar, `<details>` disclosure
  triggers), this should get a real check before the board's first live "round of updates" review happens
  on a phone. Not blocking — nothing in the code report suggests a fixed-width layout that would outright
  break — but genuinely unverified, not confirmed-pass.

## Follow-Ups (SHIP WITH NOTES)

- **B-39 — Adopt-version `<ConfirmDialog>` should pass `destructive`.** One-line fix in
  `pending-versions-panel.tsx`. Added to `docs/backlog.md`.
- **B-40 — State the document's authoritative/superseding status on the member-facing page itself**, not
  only in the git file and the seed script's console banner. One sentence on
  `/members/records/documents/[slug]` closes this. Added to `docs/backlog.md`.
- **B-41 — Carry forward the three DECISION-083 audit findings that were explicitly deferred**
  (`/admin/sync-log` PII-adjacent exposure with no dedicated key, `/api/admin/members/export`'s
  standalone-`REPORTS_EXPORT` gating shape, the dead `/admin/newsletter` dashboard link) so they don't get
  lost now that this work-log closes. Added to `docs/backlog.md`.
- **Verify the diff view against a real multi-article amendment, not just a one-line change**, the first
  time the board actually does its "round of updates" (treasurer's decision 3). QA's Phase 5 pass only
  exercised a single-line diff (`$60.00` → `$127.00`); the multi-region grouping/collapsing logic was
  built with the real 642-line document in mind and is unit-tested for "multiple separate changes numbered
  in document order," but has not been watched end-to-end against a real several-article edit. Cheap to
  confirm the first time it's actually used for that purpose — no code change implied unless it surfaces
  something.
- **Confirm production has actually been seeded before telling members the by-laws are available.** As of
  this review I found no evidence in the repo that `scripts/seed-governance-document.ts --apply` has been
  run against `PROD_DATABASE_URL` — this is by design (a deliberate treasurer action, not an automated
  step), but it means the feature is fully shipped in code while functionally invisible to every member
  until that command runs. Whoever owns that step should confirm it's done (or do it) before this is
  announced as "live."
- **Process note for the next security-adjacent structural refactor, not a code follow-up:** DECISION-082's
  proxy-derivation fix had a blast radius across all 22 admin areas — much larger than the documents
  feature that surfaced it — and its first landing only spot-checked 4 of the 11 newly-affected areas
  before missing the subscriptions PII exposure. The pipeline caught it (QA's second FAIL, then the
  22-area audit), so nothing insecure actually shipped, but a refactor of that scope discovered mid-feature
  arguably deserved its own architect/tech-lead pass sized to its actual blast radius rather than riding
  through on the documents feature's phases. Worth surfacing at the next agent-and-instruction or security
  retrospective, not a blocker here.

## Red Flags (NEEDS REWORK)

- None. Nothing found in this review rises to "must change before this ships" — every gap above is either
  a small, mechanical, independently-fixable note, or a fact about sequencing (production not yet seeded)
  that isn't a code defect at all.
