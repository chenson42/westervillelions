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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
