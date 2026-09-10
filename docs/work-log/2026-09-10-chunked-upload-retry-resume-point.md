# Chunked Upload Retry Re-Sent Every Chunk — Work Log

> **Slug:** `2026-09-10-chunked-upload-retry-resume-point`
> **Surface:** (dashboard) admin — Club Files upload / replace
> **Permission(s):** none new — existing `club_files.manage` unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped — bug confirmed by control-flow trace, not report | — | 2026-09-10 |
| 2 — Architectural review | architect | Skipped — no invariant touched; public hook contract unchanged | — | 2026-09-10 |
| 3 — Technical design | tech-lead | Skipped — fix shape fell out of the trace; recorded below | — | 2026-09-10 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-10 |
| 5 — Verification | qa | Pending — unit tests green; e2e + manual click-through outstanding | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Skips are deliberate and recorded here per CLAUDE.md.** Phase 5 is genuinely
outstanding: this is a refactor of a load-bearing upload path verified only by unit
tests so far. `e2e/club-files-flow.spec.ts` and a manual click-through of a simulated
finalize failure still need to run.

---

## Root Cause

Club Files uploads PDFs up to 25MB in 3MB chunks, because Vercel hard-caps function
request bodies at 4.5MB (DECISION-095). The protocol is: upload N chunks, then call
`finalize`. `retry()` is meant to resume from wherever it stopped.

In `src/lib/hooks/use-chunked-upload.ts`, `runChunks` wrote `resumeRef.current` **only
on the failure branch**. On success it wrote nothing, so `nextChunkIndex` stayed at the
`0` that `upload()` seeded.

Consequently, when every chunk uploaded and `finalize` then failed:

- `upload()`'s catch set `canRetry = true`, with `nextChunkIndex` still `0`
- `retry()` evaluated `resume.nextChunkIndex < resume.totalChunks` → `0 < N` → true
- so it re-ran the whole chunk loop from index 0

A failed finalize therefore re-uploaded the entire file, directly contradicting both the
protocol comment and `retry()`'s own doc comment. For a volunteer uploading a 25MB club
document over a poor connection, that is the difference between re-sending one small
request and re-sending the whole file.

Found incidentally while fixing an unrelated lint rule (a ref read during render in the
same hook), then confirmed by tracing every write to `resumeRef.current` — not from a
user report.

## Fix

Resume bookkeeping extracted into three plain, framework-free exported functions, which
also made them directly unit-testable with a mocked `fetch`:

- `runChunks()` now **always** returns `{ nextChunkIndex, error? }` — equal to
  `totalChunks` on full success, or the first never-landed chunk on failure. This is the
  actual fix: progress is reported on success, not only on failure.
- `runFinalize()` — extracted unchanged.
- `resumeUpload()` — the single place deciding "chunks-then-finalize" vs
  "finalize-only", used identically by a fresh upload (`nextChunkIndex: 0`) and by
  `retry()`. This removes the duplicated resume logic that had drifted apart between
  `upload()`'s catch and `retry()` — the divergence that allowed the bug.

`useChunkedUpload()` is now a thin React-state wrapper preserving the exact public
contract (`status`, `progress`, `error`, `upload`, `retry`, `canRetry`, `reset`). No
consumer changes were needed in `club-file-upload-form.tsx` or
`club-file-replace-control.tsx`.

The `canRetry`-backed-by-state property (from the earlier ref-during-render fix) is
preserved — do not reintroduce a ref read during render here.

One parity gap was caught during the refactor and fixed: the original `retry()` cleared
`error` at the start of an attempt; the first draft did not, which would have left a
stale error message on screen mid-retry.

## Tests

`src/lib/hooks/use-chunked-upload.test.ts` — 7 tests, mocked `fetch`, no jsdom needed.
Notably test 3 is the exact bug: all chunks succeed, finalize fails, and the retry round
must make **zero** chunk-endpoint calls. Suite went 1926 → 1933 passing.

## Follow-Ups

- **Phase 5 is not done.** Run `e2e/club-files-flow.spec.ts` and click through a
  simulated finalize failure in the browser before this is considered verified.
- `onFinalizing` fires even on the finalize-only retry path. That preserves the original
  UX (status flips so the progress UI updates) but deserves a visual confirmation.
