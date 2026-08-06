# Budget Notes Markdown Rendering — Work Log

> **Slug:** `2026-08-05-budget-notes-markdown`
> **Surface:** (dashboard) admin — The Ledger, Budgeting
> **Permission(s):** existing `LEDGER_MANAGE` / `BUDGET_EDIT` (write) and `LEDGER_MANAGE` / `LEDGER_APPROVE` / `BUDGET_VIEW` / `BUDGET_EDIT` (read/print) cover this — no new permission
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 skipped (rationale below). Ran the light form the user specified directly.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-08-05 |
| 2 — Architectural review | architect | Skipped | — | 2026-08-05 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-08-05 |
| 4 — Implementation | ux-developer | Complete | — | 2026-08-05 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Why 1–3 were skipped:** the user's request pre-resolved the scope questions those phases exist to answer — no new dependency (react-markdown/remark-gfm/rehype-raw already installed, confirmed by `grep`), no API/data-model change (existing `PATCH /api/admin/ledger/budget-notes` and `ledger_budget_notes` table untouched), and both render sites were already named. This is a display-layer swap (`whitespace-pre-wrap` text → rendered Markdown) behind an existing permission gate, not a new user-facing capability. Explicit user instruction: "Follow the CLAUDE.md pipeline in its light form."

---

# Phase 4 — Implementation (UI)

**Owner:** ux-developer
**Status:** complete

## Summary

The budget-level "Notes & Assumptions" block (stored in `ledger_budget_notes.notes`, one row per entity+fiscal-year) now renders as Markdown — headings, bold/italic, bullet/numbered lists, links, and GFM tables — instead of plain preformatted text, on both render sites: the admin view-only display in `budget-notes-editor.tsx` and the printed board document in `budget-print-worksheet.tsx`. Both were confirmed (by grep across `src`) to be the only two places `ledger_budget_notes` content is displayed; no third site (budgeting overview table, drill-down, fiscal report) touches this field. No API, schema, or permission changes — write path, the 4000-char cap, and the auth gates are all untouched.

## What I did

- Read the API contract directly from `src/app/api/admin/ledger/budget-notes/route.ts` (PATCH, `entityId`/`fiscalYear`/`notes`, 4000-char cap via `MAX_BUDGET_NOTES_LENGTH`) and its test file — confirmed no change needed there, so no api-developer handoff was required for this task.
- Grepped for every render site of `ledger_budget_notes` / `getBudgetNotes` / `budgetNotes` across `src` — confirmed exactly two: `budget-notes-editor.tsx` (view-only display) and `budget-print-worksheet.tsx` (print). The category/cause-line `note` fields shown elsewhere in the print worksheet (`line.note`, `cl.note`) are a **different**, unrelated column (`ledger_budgets.note` / `ledger_budget_lines.note`, DECISION-057) — left untouched, out of scope.
- Found the codebase already has a similar pattern (`src/components/markdown-content.tsx`, used by event descriptions, and `src/components/admin/release-notes-viewer.tsx`, which uses `rehype-raw`). Neither fit directly: the generic one lacks heading/table styling and print concerns; the release-notes one enables `rehype-raw`, which requirement 2 explicitly forbids here. Built a new dedicated shared component instead of reusing/mutating either.
- Created `src/components/admin/ledger/budget-notes-markdown.tsx` — a client component wrapping `ReactMarkdown` + `remark-gfm` only (no `rehype-raw`), with Tailwind-styled overrides for `h1`–`h3`, `p`, `strong`, `em`, `a` (always-underlined, `lions-blue`, opens external links in a new tab), `ul`/`ol`/`li` (outside-position markers via `list-disc`/`list-decimal` + `pl-5`, so bullets/numbers never clip on a narrow print column), `table`/`th`/`td` (bordered, wrapped in an `overflow-x-auto` — `print:overflow-visible` — container), `blockquote`, `hr`, and inline `code`.
- Swapped both render sites' `<p className="... whitespace-pre-wrap">{notes}</p>` for `<BudgetNotesMarkdown>{notes}</BudgetNotesMarkdown>`, keeping each site's existing card/heading chrome (`bg-white rounded-2xl shadow-sm overflow-hidden p-5` on-screen; the print worksheet's `border-b` section-header style) unchanged.
- Added a small, unobtrusive Markdown hint in `budget-notes-editor.tsx`'s edit mode, folded into the existing char-counter line (`"1234/4000 · Markdown supported (headings, **bold**, lists, links, tables)"`) rather than adding a toolbar or preview pane — matches the existing UI voice (small gray helper text) and satisfies requirement 3 without adding UI surface area. The textarea itself is unchanged — still plain-text Markdown source, no live preview.
- Verified requirement 1's specific legacy-data claim with a real render test rather than assuming it: production notes are plain paragraphs separated by blank lines, some starting with a literal "•" character (not Markdown list syntax). Wrote `budget-notes-markdown.test.tsx` using `renderToStaticMarkup` (works in vitest's default `node` environment, no jsdom needed) to assert this shape renders as three separate `<p>` blocks in order, each preserving its leading "•" as plain text — confirming the requirement's claim ("Markdown renders that acceptably as paragraphs") rather than taking it on faith. Also asserted: Markdown feature coverage (headings → `<h4>`, bold → `<strong>`, italic → `<em>`, both list types → `<ul class="...list-disc...">`/`<ol class="...list-decimal...">`, links → `<a href>` with `target="_blank"`/`rel="noopener noreferrer"` for external URLs, GFM tables → real `<table>`/`<th>`/`<td>`), and a negative test that raw HTML (`<script>`, `<b>`) is never passed through unescaped — proving `rehype-raw` really is off.
- Ran `pnpm test` (full suite, not just the new file) to confirm no regression: 35 files / 883 tests, all passing.
- Ran `pnpm exec tsc --noEmit`: clean, no errors.
- Ran `pnpm build:only`: production build succeeded, no errors or warnings; all routes (including `/admin/ledger/budgeting`) built successfully.

## Outputs

- `src/components/admin/ledger/budget-notes-markdown.tsx` — new shared Markdown renderer (client component)
- `src/components/admin/ledger/budget-notes-markdown.test.tsx` — new unit tests (4 tests: feature coverage, GFM tables, no-raw-HTML, legacy-data paragraph shape)
- `src/components/admin/ledger/budget-notes-editor.tsx` — swapped `whitespace-pre-wrap` for `BudgetNotesMarkdown` in the view-only display; added the Markdown-supported hint next to the char counter in edit mode
- `src/components/admin/ledger/budget-print-worksheet.tsx` — swapped `whitespace-pre-wrap` for `BudgetNotesMarkdown` in the printed "Notes & Assumptions" section
- No `docs/decisions.md` entry — this didn't rise to an architectural decision (no new dependency, no data-model change, no permission change), just a display-layer swap using already-decided-on tooling.

## Open questions / handoff notes

- **What a reviewer should click through:** `/admin/ledger/budgeting` as a user with `BUDGET_VIEW` (view-only, no `BUDGET_EDIT`/`LEDGER_MANAGE`) — confirm the Notes & Assumptions card at the bottom renders Markdown (try a note with a heading, a bold word, a bullet list, and a link) instead of raw asterisks/hashes. Then as an editor (`BUDGET_EDIT`), confirm the textarea still shows raw Markdown source and the new hint line reads correctly next to the char counter. Then click "Print / Save as PDF" (`PrintBudgetButton`) and confirm the Notes & Assumptions section on the printed document renders the same way — check list markers aren't clipped and a table (if tested) doesn't get cut off at the page edge.
- **New copy strings the Club may want to refine:** the hint text `"Markdown supported (headings, **bold**, lists, links, tables)"` — currently folded into the existing char-counter `<p>` with a middot separator; if it reads too dense on a narrow admin viewport it could be split onto its own line.
- **UX decisions/tradeoffs made:**
  - Built a new dedicated component (`budget-notes-markdown.tsx`) rather than extending the existing generic `MarkdownContent` (event descriptions) or reusing `ReleaseNotesViewer`'s inline Markdown setup — the generic one lacks table/heading styling this feature needs, and the release-notes one has `rehype-raw` on, which requirement 2 explicitly forbids for admin-authored budget notes. A future consolidation (e.g. generalizing `MarkdownContent` to take a `components` override) is possible but out of scope here.
  - Did NOT add `remark-breaks` or any single-newline→hard-break preprocessing to more literally reproduce `whitespace-pre-wrap`'s per-line-break behavior. The task's own framing ("paragraphs separated by blank lines... Markdown renders that acceptably as paragraphs") pointed at plain CommonMark being sufficient, and the render test confirms it holds for the described legacy shape. If real production notes turn out to use single-newline (no blank line) separation between bullets, they'd currently render as one run-on paragraph — worth a quick DB spot-check by someone with read access before or shortly after this ships, since I was instructed not to touch the database in this session.
  - Headings map `h1`→visually `<h3>`-sized, `h2`→`<h4>`-sized, `h3`→`<h5>`-sized (deliberately de-emphasized relative to true document headings) since this block is a sub-section of a larger page/document, not its own document — an author-typed `# Big Heading` shouldn't outrank the page's own `<h1>`/`<h2>`.
- **Next agent:** qa (Phase 5) — please also decide whether Phase 1/2/3 being skipped needs anything beyond this stub's rationale, and run the manual click-through above since it spans an on-screen admin view AND a print stylesheet, which automated typecheck/build/unit-tests can't fully verify.
