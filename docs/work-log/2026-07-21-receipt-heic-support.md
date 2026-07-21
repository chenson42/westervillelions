# Receipt HEIC Support — Work Log

> **Slug:** `2026-07-21-receipt-heic-support`
> **Surface:** (dashboard) admin — The Ledger receipt upload (client only)
> **Permission(s):** none touched
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1-2 brief/skip (documented below); Phase 3 brief;
> Phases 4/5/6 run in full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (brief, documented) | Complete | READY | 2026-07-21 |
| 2 — Architectural review | Skipped (documented below) | Skipped | — | 2026-07-21 |
| 3 — Technical design | folded into Phase 1 brief (small) | Complete | — | 2026-07-21 |
| 4 — Implementation | ux-developer | Complete | — | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

"Can we support .HEIC files for receipt upload?" — iPhones shoot HEIC by
default; the receipts feature (v1.31.0) rejects HEIC on both ends (client
accept list `.pdf,.jpg,.jpeg,.png` in
`src/components/admin/ledger/receipt-file-input.tsx:151`; server magic-bytes
allow PDF/JPEG/PNG only).

## Phase 1/3 brief (orchestrator, user-reviewed approach)

**Approach (recommended to user; WASM alternative offered and not chosen):**
browser-native decode, zero new dependencies, zero server changes.

- Add `.heic,.heif` to the client accept list.
- The existing resize pipeline (`receipt-file-input.tsx` → canvas →
  `image-resize.ts` → JPEG 1600px/0.82) already converts every image to JPEG
  before upload — HEIC support only requires the browser to *decode* the file.
  Safari (macOS + iOS) decodes HEIC natively; the upload then proceeds as a
  normal JPEG and the server never sees HEIC bytes (magic-bytes unchanged).
- If decode fails (Chrome/Firefox can't read HEIC): show a human inline error —
  "This browser can't read HEIC photos — use Safari, or export the photo as
  JPEG" — and leave the transaction save unaffected (existing
  upload-failure-never-blocks-save behavior).
- Note: iOS Safari already transparently converts library photos to JPEG for
  file inputs that don't accept HEIC, so the iPhone flow largely works today;
  this change covers direct .heic files (AirDrop, desktop Safari) and makes
  the accept list honest.
- Upgrade path if the error shows up in practice: a WASM decoder (heic2any) —
  requires architect dependency review; explicitly NOT in this scope.

**Phase 2 skip rationale:** no new dependency, no server change, no schema, no
permission, one existing component + its pure-helper file touched. Per the
accelerated-pipeline rule; recorded here rather than silently skipped.

**Implementer:** ux-developer. **Named tests:** extend
`src/lib/image-resize.test.ts` only if a pure helper changes (decode attempts
are DOM-bound); otherwise Phase 5 covers by click-through — HEIC on Safari
(happy path), HEIC on Chrome (graceful error), JPEG/PNG/PDF regression.

---

# Phase 4 — Implementation (UI) — 2026-07-21

**Owner:** ux-developer
**Status:** complete

### Summary

Added `.heic`/`.heif` support to the receipt file input per the Phase 1/3
brief: browser-native decode, zero new dependencies, zero server changes.
HEIC files that a browser can decode (Safari, via `createImageBitmap`) flow
through the existing canvas → JPEG 1600px/0.82 pipeline unchanged, so the
server only ever sees JPEG bytes. HEIC files a browser can't decode (Chrome,
Firefox) now get a specific inline error instead of silently falling through
to a raw-bytes upload that would 400 confusingly at the server's magic-bytes
gate.

### What I did

- Added `.heic,.heif` to the `<input accept>` list (was
  `.pdf,.jpg,.jpeg,.png`).
- Extended `isImageFile()` to recognize `.heic`/`.heif` extensions (some
  browsers report an empty `file.type` for HEIC, so extension is the reliable
  signal, not just the MIME-type check that was already there).
- Added a new `isHeicFile()` pure helper (extension + `image/heic`/
  `image/heif` MIME check).
- In `handleChange`, on a decode/resize failure for the selected file: if
  `isHeicFile()` is true, set the error state to "This browser can't read
  HEIC photos — use Safari, or export the photo as JPEG." and `return` before
  reaching the fetch call — this is the one exception to the existing
  "resize failure falls back to raw-file upload" behavior, because raw HEIC
  bytes are the one raw-fallback case the server would actually reject.
  Non-HEIC image decode failures (rare, e.g. corrupt JPEG) keep the original
  fallback-to-raw-upload behavior untouched.
- Updated the hint copy under the input from "PDF, JPEG, or PNG..." to "PDF,
  JPEG, PNG, or HEIC..." so the accept list and the help text agree.
- Did not touch `src/lib/image-resize.ts` or its test file — no pure helper
  moved there; `computeResizeDimensions` and the JPEG-quality/dimension
  constants are unchanged and untouched by this feature. The new
  `isImageFile`/`isHeicFile` helpers are File-shape checks that belong next to
  the component that owns file selection, not the dimension-math module.
- Did not touch the server upload route or its magic-bytes allowlist — by
  design, per the brief: HEIC never reaches the server; it's either converted
  client-side to JPEG or rejected client-side before the fetch call fires.

### Outputs

- `src/components/admin/ledger/receipt-file-input.tsx` — accept list, hint
  copy, `isImageFile`/new `isHeicFile` helpers, HEIC-specific error branch in
  `handleChange`, updated JSDoc on `resizeImage` explaining the
  Safari-decodes/Chrome-Firefox-doesn't split and why HEIC gets its own error
  path instead of the generic raw-upload fallback.
- No changes to `src/lib/image-resize.ts` / `src/lib/image-resize.test.ts` —
  no pure helper moved or changed there this pass.
- No changes to any server route (`/api/admin/ledger/transactions/upload`) —
  magic-bytes allowlist (PDF/JPEG/PNG) is unchanged by design.
- No decisions.md entry — this is a client-only UX change within an already-
  documented feature (receipt upload, v1.31.0); doesn't rise to a new ADR.

### Gate results

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 432/432 passing (no new tests added; no pure helper in
  `image-resize.ts` changed, per the brief's test-scope note — the new
  `isImageFile`/`isHeicFile` helpers are simple `File`-shape predicates
  co-located with the component, and their DOM/File-object behavior is
  click-through territory along with the decode-attempt paths).
- `pnpm build:only` — production build succeeds, no new warnings or errors.
- No `console.log`/`console.debug` in the touched file.
- No native browser dialogs introduced (n/a to this change — no new dialogs).

### Exact decode-attempt mechanism

Unchanged from the existing pipeline: `resizeImage()` calls
`createImageBitmap(file)` directly on the raw `File` (no HEIC-specific
pre-processing). Safari's implementation of `createImageBitmap` can decode
HEIC/HEIF via the OS's native image decoders, so on Safari a `.heic` file
resolves to a bitmap exactly like a `.jpg` would, and the rest of the
pipeline (canvas draw → `toBlob("image/jpeg", 0.82)`) is identical — the
server receives a JPEG blob named `<original-basename>.jpg`, indistinguishable
from any other resized photo. On Chrome/Firefox, `createImageBitmap` rejects
the promise for a HEIC source (no native decoder), which is caught by the
existing `try/catch` around the resize call. The `isHeicFile()` check inside
that `catch` block is what changes the outcome for HEIC specifically: instead
of falling back to `uploadBlob = file` (raw bytes) and proceeding to
`fetch(...)`, it sets the error state and returns immediately, so the fetch
call — and the confusing generic 400 the server's magic-bytes check would
otherwise produce — never happens.

### Error-state behavior

- HEIC decode failure: `status` → `"error"`, inline red text (existing
  `role="alert"` paragraph) reads "This browser can't read HEIC photos — use
  Safari, or export the photo as JPEG." Input value is cleared (existing
  `finally` block). The transaction form is unaffected — `onUploaded` is
  never called, matching the existing "receipt upload failure never blocks
  transaction save" invariant (Phase 1 Flow A, unchanged).
- Non-HEIC image decode failure (e.g. a corrupt/truncated JPEG): unchanged —
  falls back to uploading the original file; if that also fails server-side,
  the generic catch-all error path fires as before.
- Oversized file (>10 MB), any format including HEIC: unchanged — caught
  before decode is attempted, same "File must be 10 MB or smaller." message.

### Open questions / handoff notes for qa

- **Manual click-through required** — decode success/failure is DOM/browser-
  engine-dependent and cannot be unit tested in this pass (Vitest has no real
  HEIC decoder). Please verify:
  1. **Safari happy path (needs a real `.heic` file):** the treasurer's
     machine is macOS, so `sips -s format heic <any.jpg> --out receipt.heic`
     can synthesize a `.heic` test file from any JPEG on hand — no iPhone
     needed. Select it in Safari (macOS) via the receipt input on a new/edit
     transaction in The Ledger admin UI; confirm it uploads successfully and
     the resulting receipt thumbnail/link works (i.e., it was actually
     converted to JPEG, not rejected).
  2. **Chrome/Firefox graceful error:** select the same synthesized `.heic`
     file in Chrome or Firefox; confirm the inline error reads "This browser
     can't read HEIC photos — use Safari, or export the photo as JPEG." and
     that the transaction can still be saved without a receipt (upload
     failure must not block save).
  3. **Regression:** confirm JPEG, PNG, and PDF uploads still behave exactly
     as before (resize applies to JPEG/PNG, PDF passes through unresized,
     both upload and error paths unchanged) in at least one browser.
  4. iOS Safari's photo-library picker already transparently re-encodes HEIC
     to JPEG for inputs that don't `accept` HEIC — that existing behavior is
     unaffected either way; this change is really about direct `.heic` files
     (AirDrop, Finder, desktop Safari) and making the `accept` attribute
     honest about what's supported.
- **New copy strings** the Club may want to review/refine:
  - Input hint: "PDF, JPEG, PNG, or HEIC, up to 10 MB. Photos are resized
    automatically."
  - Error message: "This browser can't read HEIC photos — use Safari, or
    export the photo as JPEG."
- **UX decision made:** chose to make the HEIC-decode-failure path a hard
  stop (error + return) rather than let it fall into the existing generic
  raw-upload fallback, because that fallback would produce a *worse* user
  experience for this one case specifically (a confusing server 400 instead
  of an actionable client message). This is a narrower behavior change than
  "all decode failures now stop" — every other image type keeps the original
  fallback-to-raw-upload behavior.
- Next: **qa** for Phase 5 (click-through above), then **analyst** for Phase
  6 shipped-vs-intent.

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All four gates are green, and the click-through went further
than expected: Playwright's WebKit build actually decoded the synthesized
`.heic` file end-to-end (client HEIC → JPEG conversion → server magic-bytes
accept → storage → retrieval), so the "true Safari happy path" was verified
directly rather than deferred to a manual device test. Chrome's graceful
inline error, the no-network-upload guarantee, and the JPEG/PDF regression
paths all verified clean. The HEIC-specific catch branch was confirmed by
code-read to leave the pre-existing non-HEIC decode-failure fallback
untouched.

### What I did

- Read the Phase 1/3 brief and Phase 4 implementation notes in full.
- Code-read `src/components/admin/ledger/receipt-file-input.tsx`: confirmed
  `isHeicFile()` gates only the HEIC branch inside the `resizeImage()` catch
  — the `else` path still falls back to `uploadBlob = file` unchanged, so a
  corrupt/truncated non-HEIC image keeps its original raw-upload fallback
  behavior. The accept list (`.pdf,.jpg,.jpeg,.png,.heic,.heif`), hint copy,
  and error copy all match the brief.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm test`: 432/432 passing, 293ms.
- `pnpm build:only`: production build succeeds, no new warnings/errors, full
  route manifest unchanged in shape.
- Synthesized a real HEIC locally: `sips -s format heic public/images/hero-bg.jpg
  --out <scratchpad>/receipt-test.heic` (verified via `file` as genuine "ISO
  Media, HEIF Image HEVC" — not a renamed JPEG).
- Started `pnpm dev` on port 3000, wrote a temporary Playwright spec
  (`e2e/heic-receipt-qa-temp.spec.ts`) and a temporary two-project config
  (chromium + webkit) to drive the real component against the real file,
  since Vitest has no HEIC decoder and the permanent Playwright config is
  chromium-only. Had to `pnpm exec playwright install webkit` — the cached
  webkit build on this machine (2311) didn't match this project's pinned
  playwright-core (2287).
- Drove, per test, via `signInAsAdmin` + a real "Record Transaction" dialog
  against the Administrative Fund (explicitly selected — the dialog's fund
  picker defaults to `funds[0]` of the entity, which is not guaranteed to be
  the fund the list page filters to):
  1. **Accept attribute** (chromium + webkit): input's `accept` includes
     `.heic,.heif`. PASS.
  2. **Chromium HEIC → graceful error**: selected the `.heic` file; asserted
     the exact inline `role="alert"` text; asserted (via a `page.on(request)`
     listener) that **zero** requests hit
     `/api/admin/ledger/transactions/upload`; saved the transaction without a
     receipt and confirmed the "Transaction recorded" toast — save is not
     blocked. PASS.
  3. **WebKit HEIC attempt**: selected the same `.heic` file — **WebKit
     decoded it** (`QA-RESULT: webkit-heic-decoded=true` in the test log).
     Verified the full happy path: saved the transaction, reloaded the list,
     found the row's "View receipt" link, fetched it via `page.request.get()`
     and got a 200 with `content-type: image/jpeg`. Confirmed via `sips` on
     the actual stored file that it was resized to the spec's 1600px longest
     edge (from the source JPEG's 2048×1287 down to 1600×1005) — i.e., this
     was genuinely the client-side canvas/JPEG pipeline, not a passthrough.
     PASS — no manual Safari click-through needed for this pass; noting for
     the record that a real-device/real-Safari spot-check is still good
     practice before the next release but is not a blocking gap.
  4. **JPEG regression** (chromium): uploaded a plain JPEG, confirmed
     resize + attach + "Transaction recorded" + a 200/`image/jpeg` receipt
     fetch. PASS. (PDF passthrough and the accept-list-honesty note were
     covered by code-read + the accept-attribute assertion above; the
     existing PDF/JPEG/PNG upload path is unchanged by this feature, per the
     Phase 4 summary and confirmed by re-reading the upload route.)
- Cleanup: every test that created a transaction deleted it via the UI's own
  Delete control (which passed the "Transaction deleted" toast) before
  finishing. One bug in my *own test script* (fixed mid-run, see below) left
  3 orphaned rows from failed early attempts — removed directly via
  `DELETE FROM ledger_transactions WHERE memo LIKE 'QA-%'` after confirming
  by `memo`/`txn_date` that all 3 were exactly the rows my own script had
  created (today's date, `QA-` prefix I invented for this run) and nothing
  else. Deleted all receipt blobs written under `.receipt-store/receipts/`
  during this session (8 UUID directories, all with today's mtimes);
  left `.receipt-store/acknowledgments/` (dated 2026-06-26, pre-existing,
  unrelated) untouched. Deleted the temporary spec, the temporary Playwright
  config, the synthesized `.heic` file, and `test-results/`. Killed the dev
  server; confirmed port 3000 is free.

### Outputs

- No source files changed this phase (verification only).
- Deleted after use (no longer present): `e2e/heic-receipt-qa-temp.spec.ts`,
  `playwright.heic-qa-temp.config.ts`, scratchpad `receipt-test.heic`,
  `test-results/`.
- Installed locally (machine-level, not a repo change): the
  `webkit-2287` Playwright browser binary, to match this project's pinned
  `playwright-core@1.60.0` (the machine only had a newer `webkit-2311` cached
  from some other project/global install).
- No decisions.md entry — verification-only phase, no new decision to record.

### Gate results

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (clean, no errors)

#### Unit Tests
`pnpm test`: **PASS**
Total: 432 | Passed: 432 | Failed: 0
Duration: 293ms
Failures: none
(No new unit tests added — per the Phase 3 brief, decode-attempt behavior is
DOM/browser-engine-bound and not unit-testable; `isImageFile`/`isHeicFile`
are simple `File`-shape predicates exercised indirectly by the e2e
click-through above. No pure helper in `src/lib/image-resize.ts` changed.)

#### Production Build
`pnpm build:only`: **PASS**
Notes: full route manifest built successfully; no new warnings; route count
unchanged from Phase 4's report.

#### End-to-End Tests
`pnpm test:e2e` (permanent suite): not run this phase — this feature has no
permanent Playwright coverage (correctly, per the Phase 3 brief: decode
behavior isn't reliably assertable across CI environments the way the
Chrome-error path is, and the WebKit-decodes-or-not branch would make a
permanent spec flaky depending on the CI machine's OS-level HEIC codec
support). All verification instead ran through a temporary spec, detailed
above and deleted after use.
Temporary spec results: Total: 8 (4 tests × 2 projects) | Passed: 5 | Skipped:
3 (intentional `test.skip` for browser-specific tests run under the other
project) | Failed: 0 | Duration: ~19s

#### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| WebKit HEIC decode (Playwright, macOS OS frameworks) | pass | Decoded successfully — see "What I did" #3. Substituted for a manual Safari click-through this pass. |
| Real-device Safari spot-check | not run | Recommend before next release as a belt-and-suspenders check, since Playwright WebKit and shipped Safari can diverge in codec availability; not a blocking gap given the Playwright WebKit result. |

### Regression Tests Added

None added to the permanent suite this phase — see "End-to-End Tests" above
for why (DOM/decode-bound, would be flaky/environment-dependent as a
permanent spec). If a HEIC-related bug surfaces in the future, the
implementer should add a targeted regression test using the same
`sips`-synthesized-HEIC technique used here.

### Coverage on Critical Modules

- `src/lib/events.ts`: unchanged this phase (not touched by this feature).
- `src/lib/permissions.ts`: unchanged this phase (not touched by this
  feature).
- `src/lib/members.ts`: unchanged this phase (not touched by this feature).
- `src/components/admin/ledger/receipt-file-input.tsx`: not unit-tested
  (DOM/File-API bound); fully exercised by the temporary e2e click-through
  (all 4 code paths: accept attribute, HEIC error, HEIC success, JPEG
  regression).

### Feature-Gate Audit (mandatory before PASS)

This feature added/changed **no protected routes or server actions** — it is
a client-only change to an existing component
(`src/components/admin/ledger/receipt-file-input.tsx`). The one route this
component talks to, `POST /api/admin/ledger/transactions/upload`, was **not
modified** by this feature; confirmed by re-reading it that its existing
gate is intact and unaffected:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/transactions/upload` (untouched by this feature) | yes | yes | `FEATURES.LEDGER_RECORD` — correct, matches the existing gate on the transaction-record flow this upload feeds |

No protected routes touched by this feature beyond the above (confirmed
unchanged).

### Verdict: PASS

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete

### Summary

**Verdict: SHIP IT.** The shipped feature matches the Phase 1/3 brief exactly:
zero new dependencies, zero server changes, browser-native decode on the
existing canvas → JPEG pipeline. I code-read
`src/components/admin/ledger/receipt-file-input.tsx` directly (not just the
work-log narrative) and every claim in the Phase 4/5 sections is accurate —
accept list, hint copy, error copy, and the HEIC-specific catch branch that
stops before the fetch call all match what's on disk. QA's WebKit
happy-path proof and Chromium graceful-error proof are the strongest form of
verification available short of a physical iPhone, and the work-log is
explicit that a real-device Safari spot-check is a nice-to-have, not a
blocking gap — I agree with that call given Playwright WebKit uses the same
OS-level HEIC codec path as shipped Safari on macOS.

### What I did

- Re-read the Phase 1/3 brief, the Phase 4 implementation notes, and the
  Phase 5 QA report in full.
- Read `src/components/admin/ledger/receipt-file-input.tsx` end to end to
  verify the narrative against the actual code, not just trust the summary.
- Walked the one user flow this feature touches (admin selects a receipt file
  in The Ledger's transaction dialog) against the Phase 1 description.
- Checked brand consistency and the permission gate.

### Intent-vs-shipped diff

- **Phase 1 said:** add `.heic,.heif` to the accept list, browser-native
  decode, no new dependency, no server change.
  **Shipped:** exactly that — `accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"`
  (line 191), no new imports, upload route untouched.
  **Verdict: matches.**
- **Phase 1 said:** Safari decodes HEIC natively and the server never sees
  HEIC bytes.
  **Shipped:** confirmed live by QA — WebKit decoded the synthesized `.heic`,
  resized it to the 1600px spec, and the stored file came back as
  `image/jpeg`.
  **Verdict: matches** (stronger than promised — this was proven live, not
  just reasoned from API docs).
- **Phase 1 said:** Chrome/Firefox get a human inline error instead of a
  confusing server 400, and the transaction save is unaffected.
  **Shipped:** confirmed live by QA — zero network requests to the upload
  route on decode failure, transaction saved successfully without a receipt.
  **Verdict: matches.**
- **Phase 1 said:** accept list should be "honest" about what's supported.
  **Shipped:** hint copy updated to "PDF, JPEG, PNG, or HEIC..." alongside the
  accept attribute.
  **Verdict: matches.**
- **Phase 1 said:** JPEG/PNG/PDF regression must stay clean.
  **Shipped:** QA re-verified JPEG end-to-end (resize + attach + 200 fetch)
  and confirmed by code-read that the non-HEIC fallback branch is untouched.
  **Verdict: matches.**
- **Phase 1 said (out of scope, explicitly):** WASM decoder (heic2any)
  upgrade path.
  **Shipped:** not built — correctly deferred, documented in the work-log as
  the path to take if the Chrome error proves to be a real-world pain point.
  **Verdict: matches** (scope held).

### Edge cases

- **Empty state:** not applicable — this feature doesn't touch a list/table
  surface.
- **Failure microcopy:** pass. "This browser can't read HEIC photos — use
  Safari, or export the photo as JPEG." is specific, human, and actionable —
  it names *why* (browser can't decode) and gives two concrete next steps.
  Better than the oversized-file message's baseline. I don't think this needs
  a rewrite, but per the work-log's own flag, worth a 30-second glance from
  the Club — "use Safari" reads slightly technical for a non-technical
  treasurer/volunteer audience. Not a blocker.
- **Permission gate:** pass / not applicable. No new `FEATURES.*` key, no
  permission surface changed. The one server route this component talks to
  (`POST /api/admin/ledger/transactions/upload`) is untouched and QA
  reconfirmed its existing `FEATURES.LEDGER_RECORD` gate is intact.
- **Mobile:** not separately re-verified this phase (no layout change — same
  `<input type="file">` element, same Tailwind classes as before this
  feature; the `capture="environment"` attribute and file-picker chrome are
  OS-rendered, not something this diff touches). No regression risk.
- **Brand consistency:** pass. File-input button styling is unchanged
  (`file:rounded-lg`, `focus:ring-lions-blue`), error text uses the existing
  `role="alert"` paragraph, no new buttons/cards/dialogs were introduced that
  could violate `rounded-2xl`/`rounded-lg`/`ConfirmDialog` conventions.
- **OAuth-vs-password paths:** not applicable — file selection and client-side
  decode have no relationship to how the admin authenticated.
- **Access-pending / mid-onboarding:** not applicable — this is an admin-only
  Ledger surface already gated upstream; no change to who can reach it.
- **Email queue / Google Group sync:** not applicable — no email, no group
  membership touched.

### Follow-ups (tracked, non-blocking)

1. Real-device Safari (iPhone or physical Mac) spot-check before the next
   release touching this component — Playwright WebKit and shipped Safari
   can in principle diverge in codec availability, even though this is
   unlikely. QA already flagged this; carrying it forward as a tracked note
   rather than a new gap.
2. Club/treasurer review of the two new copy strings (hint text, HEIC error
   message) — flagged by both Phase 4 and this review as worth a quick human
   read, not a functional concern.
3. If the Chrome/Firefox error message generates real support tickets in
   practice, the documented WASM upgrade path (heic2any, requires an
   architect dependency review) is the next step — already scoped out of
   this feature by design, not a regression.

### Outputs

- No files changed this phase beyond this work-log entry.
- `docs/work-log/2026-07-21-receipt-heic-support.md` — Phase 6 section
  appended, status table updated to `Complete` / `SHIP IT` / 2026-07-21.

### Open questions / handoff notes

- None blocking. The three follow-ups above are non-blocking notes, not
  gating conditions — this entry is closed with `SHIP IT` per the pipeline
  rule that only `SHIP IT` closes an entry (not `SHIP WITH NOTES`, since none
  of the three items require code changes before release; they're
  review/verification housekeeping).
- Release assembly (v1.32.0) can proceed.
