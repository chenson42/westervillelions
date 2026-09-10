# Documentation Review — 2026-09-10

**Type:** 30-day documentation review
**Owner:** tech-lead
**Last review:** 2026-06-27 (75 days overdue — cadence badly missed)
**Scope:** `CLAUDE.md` (primary), `docs/decisions.md`, `docs/backlog.md`, `docs/release-notes/` chain, `docs/work-log/` (spot check against `src/app/`)

Since 2026-06-27 the project shipped `v1.26.0` through `v1.76.2` — 12 substantial features
(minutes, governing documents, welcome packet, club files, proposals, social requests, event
announcement emails, dues reminders, acknowledgment letters, financial reports, ledger
budgeting/reconciliation/search, and minutes browse/search) plus DECISION-027 through
DECISION-095 (69 new decisions). This is the largest gap this review has ever covered.

---

## Prior review (2026-06-27) — were its findings actioned?

**Yes, both MEDIUM findings were actioned**, though not necessarily by this review — someone
updated `CLAUDE.md` between then and now. Verified directly:

- **MEDIUM-1** (Project Structure missing ledger/dues/reimbursements) — actioned. The admin
  parenthetical already listed `dues, ledger`; `members/reimbursements` was already in the tree.
- **MEDIUM-2** (Key Features Admin bullet missing dues/Ledger) — actioned. The Admin bullet
  already read "...annual dues tracking...The Ledger (online accounting: ...)".
- **LOW-1** (`members/impact` gate comment) — actioned, word-for-word the suggested fix.
- **LOW-2** (`BLOB_READ_WRITE_TOKEN` DECISION-018/020 cite) — resolved by removal: the env var
  is no longer documented at all, which is correct — `grep` confirms it's no longer read by the
  app (`src/lib/receipt-storage/index.ts` only mentions it in a historical comment).
  Nothing stale remains.
- **LOW-4** (ledger spec historical note) — actioned, the exact note is present at the top of
  `docs/features/the-ledger-accounting.md`.
- **LOW-3** (v1.25 forward nav link) — actioned as part of normal release-note hygiene; the
  chain is intact through v1.76 (see below).

**So the substance of the 2026-06-27 review was not, in fact, left to rot for 75 days** — the
findings were fixed promptly, only the *review cadence itself* slipped by ~44 days past the
30-day target. That's still worth surfacing: a documentation review that never ran on schedule
means new drift (documented below) accumulated for over two months with no structured check.

---

## Findings

### HIGH (0)

None.

### MEDIUM (4)

#### MEDIUM-1: Project Structure admin parenthetical missing three shipped admin areas

**Location:** `CLAUDE.md` → Project Structure → `(dashboard)/admin/` line

`club-files`, `documents` (governing documents), and `minutes` all exist on disk
(`src/app/(dashboard)/admin/club-files/`, `.../documents/`, `.../minutes/`) and are each
described in Key Features, but were absent from the Project Structure parenthetical.

**Applied:** added `club-files, documents, minutes` to the list.

#### MEDIUM-2: Key Features "Club Records" bullet doesn't mention the Lions-year browse/search feature (v1.76.0, shipped yesterday)

**Location:** `CLAUDE.md` → Key Features → Member Portal → Club Records

v1.76.0 added year-pill browsing (July–June Lions years, per-year counts, opens on the current
year, "year is young → jump to most recent" fallback) and a rebuilt search (cross-year,
highlighted excerpts, "matched in minutes/motion/action item" labeling, a distinct search view
with its own Clear-search affordance) — see `docs/release-notes/v1.76.md` 1.76.0. None of this
was reflected in the one-sentence Club Records bullet, which still read as if the page were an
undifferentiated list.

**Applied:** appended a sentence describing year-pill browsing and cross-year search, and added
`records/[id]/` to the Project Structure tree (the minutes detail route this feature routes
into — it existed on disk but wasn't in the tree at all before this review).

#### MEDIUM-3: Key Features "Admin" Ledger parenthetical missing budgeting, reconciliation, and search

**Location:** `CLAUDE.md` → Key Features → Member Portal → Admin bullet

`/admin/ledger/budgeting`, `/admin/ledger/reconciliation`, and `/admin/ledger/search` all exist
on disk and shipped well within this review's window (release notes for budgeting/reconciliation
land between v1.42 and v1.68; ledger search in v1.56 — all after the 2026-06-27 review's v1.25
cutoff). The Ledger parenthetical only listed "books, reimbursements, compliance/990, reports,
donors & acknowledgments" plus the guide link.

**Applied:** added "budgeting, reconciliation" and "an admin search across ledger records" to
the parenthetical.

#### MEDIUM-4: `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` / `E2E_ADMIN_PASSWORD_HASH` undocumented

**Location:** `CLAUDE.md` → Environment Variables

Cross-checking `process.env.*` usage against the documented list (both directions) turned up
three real, required variables with zero documentation: `scripts/create-test-user.mjs` needs
`E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD_HASH` to seed a database user, and `e2e/helpers/auth.ts`
separately needs `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` (plaintext) to drive the sign-in form.
Both throw immediately if unset. A contributor trying to run `pnpm test:e2e` for the first time
following CLAUDE.md alone would hit an opaque runtime error with no pointer to what to set.

No other direction-2 gaps found (documented-but-unused): every var currently listed in CLAUDE.md
is still read somewhere in `src/`, `drizzle/`, or `scripts/`.

**Applied:** added the three-variable entry, explaining the seed/login split.

### LOW (4)

#### LOW-1: `pnpm test:e2e` command doc doesn't mention the always-serial worker change

**Location:** `CLAUDE.md` → Common Commands

`playwright.config.ts`'s `workers: 1` is now unconditional (not gated on `process.env.CI`), per
an inline comment dated 2026-09-09: every spec shares one database and asserts on shared state,
so parallel local runs produced 4 false failures that vanished on serial re-run. This changes
local wall-clock from ~2.5 min to ~12 min — a real cost a contributor should be warned about
before they assume `pnpm test:e2e` hung.

**Applied:** expanded the command comment with the reason and the new runtime budget.

#### LOW-2: Gotchas doesn't carry the `wasm-unsafe-eval` CSP dependency

**Location:** `CLAUDE.md` → Gotchas

`next.config.ts` already has a thorough inline comment explaining that `'wasm-unsafe-eval'` in
`script-src` is load-bearing for HEIC receipt uploads (v1.75.0 silently broke this for five days;
fixed in v1.76.1). Gotchas is exactly the section an agent scans before touching security
headers, and this is precisely the kind of "looks removable, isn't" trap Gotchas exists to catch
— the same failure mode (well-intentioned hardening breaking a quiet dependency) already burned
one release cycle.

**Applied:** added a Gotchas bullet. In writing it, found that `next.config.ts`'s own comment
cites **DECISION-038**, which `docs/decisions.md` marks `Status: Superseded by DECISION-039`
(the shipped design is `libheif-js/wasm-bundle`, matching DECISION-039, not `heic2any` per
DECISION-038). The new Gotchas bullet cites DECISION-039 and flags the stale cite in
`next.config.ts` in a trailing note — but `next.config.ts` itself is out of this review's
ownership (not `CLAUDE.md`, not `docs/`), so the comment there is unfixed. Recommend
deployment-engineer or database-admin correct the cite next time that file is touched.

#### LOW-3: `docs/release-notes/v1.66.md` doesn't exist — but this is not a broken link

**Location:** `docs/release-notes/`

The directory jumps from `v1.65.md` straight to `v1.67.md`. This looked like a gap on first
listing, but the chain is internally consistent: `v1.65.md` forward-links to `v1.67.md` and
`v1.67.md` back-links to `v1.65.md` — both files agree v1.66 doesn't exist as a release-notes
entry (most likely a version bump that was reverted or squashed before ever getting its own
minor file). No dangling link, no orphaned reference anywhere in `docs/`. No action needed;
noted only so a future reviewer doesn't re-flag it as a suspected gap.

#### LOW-4: No documented policy on `pnpm.overrides` hygiene, despite three incidents

**Location:** `CLAUDE.md` — no current section covers this; candidate location is Gotchas or a
new subsection near Common Commands.

`package.json`'s `pnpm.overrides` block has caused three real incidents, confirmed via `git log`
and `docs/reviews/log.md`:

1. A `minimatch` override crashed the ESLint gate outright for a period (`git log` shows
   `fix(deps): patch critical Next.js RCE advisories; restore the ESLint gate`, and the
   2026-09-10 `eslint-warning-cleanup` work-log's root-cause note: *"The lint gate had been
   crashing outright for a period and was only just restored"*). 33 warnings accumulated unseen
   in application code during the outage before today's cleanup.
2. `@auth/core` was pinned via override to a vulnerable `0.41.1` — closed 2026-07-28
   (`docs/reviews/log.md`: *"@auth/core was pinned to the vulnerable 0.41.1"*).
3. A `brace-expansion` override range that didn't actually reach the patched version — same
   2026-07-28 dependencies-review entry.

This is a judgment call about process, not a factual correction, so I'm surfacing it as a
finding rather than writing a rule into CLAUDE.md myself. **Recommend** a short addition —
either in Gotchas or as a rule alongside the Dependencies review ownership — along the lines of:
*"An entry in `pnpm.overrides` is a standing liability, not a one-time fix: it silently pins a
transitive dependency until someone removes it. Every override needs a comment naming the CVE or
bug it exists for, and the 30-day dependencies review (deployment-engineer) must re-verify each
override still reaches a patched version and hasn't started blocking something else (as
`minimatch` did to ESLint)."* This is deployment-engineer's review to own the check, but the
rule belongs in CLAUDE.md since it constrains how anyone edits `package.json`.

---

## Chains / Integrity Checks

### `docs/decisions.md` numbering

DECISION-001 through DECISION-095 are contiguous, no gaps, no duplicates (verified by
extracting every `## DECISION-NNN` header and diffing against the expected sequence). The
template sentinel `DECISION-NNN: [One-line title]` at the bottom is correctly excluded from the
numbered sequence.

### Release-notes chain (v1.25 → v1.76)

Spot-checked the full back/forward link chain across all 76 files present. One apparent gap
(`v1.66.md` missing) is not a break — see LOW-3. `v1.75.md` forward-links to `v1.76.md`;
`v1.76.md` back-links to `v1.75.md`. `v1.76.md` contains all three expected entries —
1.76.0 (2026-09-09, minutes browse/search), 1.76.1 (2026-09-09, HEIC CSP fix), 1.76.2
(2026-09-10, three-defect sweep) — matching `package.json`'s `"version": "1.76.2"` exactly.
Chain intact end to end.

### `docs/treasurer-todo.md` / `docs/board-motions.md` dangling references

CLAUDE.md's own Project Structure section documents that these were deliberately removed on
2026-08-12 and that T-nn/Q-n/A-n references in older work-logs, decisions, and release notes are
expected dangling references, not bugs — per this review's instructions, these were not
re-flagged as findings. Confirmed the note is still present and accurate.

### Other cross-links from `CLAUDE.md` / `docs/`

Checked every `docs/*.md` path and `` `src/...` `` path cited in `CLAUDE.md` for existence. The
only "missing" hits were `docs/release-notes/vX.Y.md`, `docs/reviews/2026-05-18-security.md`,
and `docs/work-log/2026-05-18-volunteer-hours.md` — all three are illustrative examples in the
Document Naming table, not real cross-references, so not counted as breaks. No genuine broken
link found.

### `docs/backlog.md`

Reorganized into priority tiers on 2026-09-05 (per its own header) and audited for staleness
against shipped work as of today's `3af283d` commit. Current at time of this review; no findings.

### `docs/work-log/` spot check

Confirmed work-log entries exist for every feature named in this task's brief (minutes,
governing documents, welcome packet, club files, proposals, social requests, event
announcements, dues reminders, acknowledgment letters, financial reports, and minutes
browse/search), plus today's three-fix sweep (`2026-09-10-budget-context-panel-compiler-findings.md`,
`2026-09-10-chunked-upload-retry-resume-point.md`, `2026-09-10-eslint-warning-cleanup.md`) and
yesterday's `2026-09-09-heic-csp-wasm-regression.md` — all map cleanly onto the release-notes
entries in v1.76.0–v1.76.2. No orphaned or missing work-log found for anything in scope.

---

## Applied vs. left as recommendation

**Applied directly to `CLAUDE.md`** (factual corrections, high confidence):
1. Project Structure admin parenthetical — added `club-files, documents, minutes`
2. Project Structure members tree — added `records/[id]/` and the `finances/` hub
   (DECISION-074-cited)
3. Key Features "Club Records" bullet — added Lions-year browse + cross-year search description
4. Key Features "Admin" Ledger parenthetical — added budgeting, reconciliation, search
5. Environment Variables — added `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` / `E2E_ADMIN_PASSWORD_HASH`
6. Common Commands — expanded `pnpm test:e2e` line with the always-serial-worker rationale and
   revised runtime
7. Gotchas — added the `wasm-unsafe-eval` / HEIC dependency bullet

**Left as a recommendation, not applied** (judgment calls about how the project should work):
- LOW-4 — a documented `pnpm.overrides` hygiene rule. This prescribes new process rather than
  fixing drift; recommend the user or deployment-engineer decide wording and whether it belongs
  in CLAUDE.md's Gotchas or a new short section.
- LOW-2's trailing note — the stale DECISION-038 cite inside `next.config.ts` itself is a code
  comment, out of this review's file ownership (not `CLAUDE.md`, not under `docs/`). Flagged for
  whoever next touches that file.

No findings were severe enough to require anything beyond an edit — nothing warranted opening a
backlog item or a new decision entry.
