# HEIC Receipt Photos in Chrome/Firefox (WASM Decode Fallback) — Work Log

> **Slug:** `2026-07-21-receipt-heic-wasm-fallback`
> **Surface:** (dashboard) admin — Ledger receipt upload (`receipt-file-input.tsx`)
> **Permission(s):** existing keys cover this (`LEDGER_RECORD` to attach; no new `FEATURES` key)
> **Estimated complexity:** small
> **Pipeline mode:** Full — small, but a new npm dependency makes Phase 2 (architect) mandatory

**Intent (user, 2026-07-21):** The 2026-07-21 `receipt-heic-support` work made HEIC
receipts upload in Safari via native `createImageBitmap` decode, and shows a dead-end
error in Chrome/Firefox ("This browser can't read HEIC photos — use Safari, or export
the photo as JPEG."). The user hit that error in Chrome and confirmed: "it needs to
work on chrome." No Chrome extension can add HEIC decode to page JS, so the fix is
in-app: lazy-load a WASM HEIC decoder (candidates: `heic2any`, `libheif-js`) only when
a `.heic`/`.heif` file is picked and native decode fails, convert to JPEG client-side,
then flow into the existing resize + upload path. Server contract unchanged — it still
only ever sees JPEG (magic-bytes check stays PDF/JPEG/PNG). Safari users never download
the WASM chunk.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | ux-developer | Complete | Typecheck/tests/build all pass | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-21 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Give Chrome/Firefox a second, in-browser decode attempt (WASM) before showing
> the dead-end HEIC error, so the treasurer's desktop-Chrome AirDropped `.heic`
> receipts actually upload instead of forcing a Safari/JPEG workaround —
> without changing the server contract or touching the sibling reimbursement
> upload surface, which is explicitly out of scope for this increment.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (Ledger, `FEATURES.LEDGER_RECORD`) | Picks a `.heic`/`.heif` file (AirDropped, saved from Finder, etc.) into the receipt input on a New/Edit Transaction dialog, on desktop Chrome or Firefox | On demand, whenever recording an expense with a photographed receipt |
| Admin (Ledger) | Same action on Safari (macOS/iOS) — unaffected by this change, must stay unaffected | On demand |
| Admin (Ledger) | Hits a still-failing decode (corrupt file, unsupported HEIC variant, or offline WASM fetch) and reads the resulting error, then either retries, exports as JPEG, or saves without a receipt | On demand, failure path |

No new surface is introduced — this is entirely inside the existing admin Ledger
receipt-attach flow. iPhone-only members are mostly unaffected: iOS Safari's
photo-library picker already re-encodes HEIC to JPEG for inputs that don't
explicitly accept HEIC-like content, and iOS Safari itself decodes HEIC
natively when a raw `.heic` file is picked directly.

## Flows

**Flow 1 — Chrome/Firefox HEIC upload, WASM fallback succeeds (new):**
Entry: admin opens New/Edit Transaction dialog → clicks the receipt file input →
picks a `.heic` file → `isImageFile()` true → `resizeImage()` calls
`createImageBitmap(file)` → rejects (no native decoder) → catch branch sees
`isHeicFile()` true → **(new)** lazy-loads the WASM decoder module → decodes
the HEIC bytes to a bitmap/JPEG → hands off into the *existing* resize
pipeline unchanged (canvas draw → `toBlob("image/jpeg", 0.82)`, longest edge
1600px) → uploads the resulting JPEG blob to
`/api/admin/ledger/transactions/upload` exactly as today.
Outcome: receipt attaches, thumbnail/link works, transaction saves — visually
identical to today's Safari-native happy path.
- Failure: covered by Flow 2 below.

**Flow 2 — WASM fallback itself fails (new failure path, not in the request):**
Entry: same as Flow 1, but the WASM path doesn't produce a usable image. Two
distinct sub-cases the request didn't separate:
  - **2a — decoder chunk fails to load** (offline, blocked script, CDN/bundle
    hiccup): the `import()` (or fetch inside the library) rejects before any
    decode is attempted.
  - **2b — decoder loads but decode fails on this specific file** (corrupt
    HEIC, an HEIC variant the WASM library doesn't support, or a `.heic`-named
    file that isn't actually HEIC).
Outcome today's brief specifies: "the current dead-end message should remain
as the final fallback" — but the existing copy ("This browser can't read
HEIC photos — use Safari, or export the photo as JPEG.") was written for
"we never tried," not "we tried and it still didn't work," and it's actively
wrong in 2b's file-is-bad case (the browser *did* try) and questionable in
2a's connectivity case (nothing to do with the browser's decode capability).
Flagged as a gap below — this needs two distinguishable messages or one
carefully-worded generalized one, not a verbatim reuse of the pre-WASM copy.

**Flow 3 — Safari, native decode succeeds (unchanged):** No behavior change.
WASM must only be reached after a native `createImageBitmap` failure, so
Safari users never download the WASM chunk, per the stated intent.

**Flow 4 — Non-HEIC image decode failure (unchanged):** Corrupt JPEG/PNG etc.
still falls back to raw-file upload, untouched by this feature — only the
`isHeicFile()` branch changes.

**Flow 5 — Oversized file, any format including HEIC (unchanged):** Rejected
by the 10 MB check before any decode attempt, same message as today.

## Permissions

- **Permission(s):** existing `FEATURES.LEDGER_RECORD` covers the one server
  route this component talks to (`POST /api/admin/ledger/transactions/upload`),
  unchanged by this feature. No new `FEATURES` key needed — this is a
  client-only decode-path addition; the server never learns HEIC was involved.
- **Default roles:** unchanged — whatever already holds `LEDGER_RECORD`
  (Treasurer, Admin per existing role bindings).

## Gaps the Request Didn't Address

- **Browser-detection logic has a latent bug that this change should fix, not
  perpetuate.** The current `isHeicFile()` catch branch fires on *any*
  browser's native-decode failure, not specifically Chrome/Firefox. If
  Safari's native HEIC decode ever fails (rare, but real for unusual HEIC
  variants — burst-mode, depth-effect, certain HDR encodings), the admin sees
  "use Safari" while already *in* Safari. This predates this feature but
  becomes directly relevant now: the cleanest fix is to make the WASM retry
  unconditional on native-decode failure (not gated on "browser is
  Chrome/Firefox"), which both delivers the requested Chrome fix and
  incidentally repairs the Safari-failure copy bug for free, since Safari
  would now also get a WASM retry instead of an immediately-wrong message.
  Recommend Phase 3 design this as "native fails → try WASM, regardless of
  browser" rather than browser-sniffing.
- **Post-WASM-failure copy needs two states, not a reused string.** See Flow 2
  above. Suggested resolution: one message for "couldn't load the HEIC
  decoder — check your connection and try again, or export the photo as
  JPEG" (2a, retry-oriented) and a second for "this photo couldn't be
  converted — it may not be a valid HEIC file, or try exporting it as JPEG"
  (2b, file-oriented, and no longer says "use Safari" since Safari may have
  already failed too under the fixed browser-detection logic above). Exact
  copy is a Phase 3/4 call; the gap is that the request assumed one dead-end
  message covers both new failure shapes and it doesn't.
- **Is "Uploading receipt…" honest during WASM fetch+decode?** The request
  flags this directly. Today "processing" covers a near-instant native decode
  plus the actual network upload. With WASM, "processing" now also covers a
  first-use chunk fetch (multi-hundred-KB to low-MB WASM binary) plus
  browser-side decode CPU time — plausibly several seconds before any network
  upload even starts. "Uploading receipt…" is not accurate for that span (an
  admin on a slow connection watching that text for 5+ seconds before
  anything appears to leave the machine is a bad signal). Suggest splitting
  the copy by phase (e.g., "Preparing receipt…" while decoding, "Uploading
  receipt…" only once the fetch to the upload route actually starts) — Phase
  3's call on exact strings, but the status state machine needs a third
  value or a way to distinguish phase, which the request didn't ask for.
- **10 MB cap interaction — confirmed fine, noted for awareness.** The cap is
  checked against the original file before any decode attempt, unchanged by
  this feature. iPhone HEIC files are typically 2–8 MB, comfortably under the
  cap, so this isn't a functional gap — but worth flagging that WASM decode
  time scales with source resolution, and a near-cap HEIC file will be the
  slowest case in the new path. Feeds directly into the honest-copy point
  above.
- **No test-matrix note for a `.heic`-named file that isn't real HEIC.**
  `isHeicFile()` checks extension/MIME only, not content. A renamed or
  corrupted file will reach the WASM decoder and must fail cleanly and
  quickly (2b above) rather than hang — this is implicit in "decode fails,"
  but the request's own note ("a .heic-named file that isn't HEIC") deserves
  an explicit test-matrix line in Phase 3/5, not just an assumption that the
  library handles it gracefully.

## Out of Scope (confirm with user)

- **Member reimbursement upload (`/members/reimbursements`,
  `src/components/members/reimbursement-form.tsx`) does NOT share
  `receipt-file-input.tsx`.** I checked directly — it's a fully separate
  implementation: `accept=".pdf,.jpg,.jpeg,.png"` (HEIC isn't even in the
  accept list there), no client-side resize/decode step at all, and the raw
  file is uploaded straight to `/api/members/reimbursements/upload`. A member
  picking a `.heic` file there today is either blocked by the OS file picker's
  extension filter or uploads raw HEIC bytes that the server's magic-bytes
  check would reject. This is the identical underlying problem on a sibling
  surface, but the user's request and today's reproduction were both
  specifically the admin Ledger flow. **Recommend: explicitly out of scope
  for this increment; log as a backlog follow-up** rather than silently
  leaving it broken with no record. In practice this surface is lower-urgency
  than the admin flow — members mostly upload receipt photos from the same
  phone that took them (iOS Safari's picker already re-encodes to JPEG in
  that case), whereas the treasurer's repro was a desktop-Chrome AirDrop,
  which reimbursements doesn't have an equivalent workflow for today anyway
  (no resize pipeline to plug HEIC support into without first building one).
- **Member profile picture upload
  (`src/components/members/profile-picture-uploader.tsx`, `accept="image/*"`)**
  — separate surface again, no HEIC-specific handling, not touched by this
  request. Flagging for the same reason (silent gaps are worse than named
  ones), recommend leaving out of scope unless the user wants it bundled.
- **Picking a final WASM library (`heic2any` vs `libheif-js` vs another)** —
  explicitly named in the intent as Phase 2/3's call, not mine. Not evaluating
  bundle size, license, or maintenance status here.

## Open Questions

- Confirm the "native decode fails → try WASM regardless of browser"
  direction (fixes the latent Safari-failure copy bug for free) — any reason
  to keep this Chrome/Firefox-only via explicit browser sniffing instead?
- Is a two-message split acceptable for the post-WASM failure case (chunk
  failed to load vs. this file failed to decode), or is one generalized
  message preferred to keep the component simpler?
- Should the processing-state copy split into a "preparing/decoding" phase
  and an "uploading" phase, or is "Uploading receipt…" throughout acceptable
  as a simplification even though it's not literally accurate during WASM
  decode?
- Confirm the reimbursement-upload gap (and profile-picture gap) should go to
  `docs/backlog.md` as a follow-up rather than being pulled into this
  increment.

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-07-21
**Reviewed by:** architect

## Verdict

Approved with suggestions

## Dependency Decision: `heic2any`

Evaluated all three named candidates plus checked for a better alternative.
Verdict: **add `heic2any@^0.0.4` (MIT) as a `dependencies` entry, dynamically
imported.** No better alternative found — the field for browser-side HEIC
decode is small and this is the only one of the three with a File/Blob → Blob
API that avoids canvas glue.

| Candidate | License (npm metadata) | Deps | Verdict |
|---|---|---|---|
| **heic2any 0.0.4** | MIT | none (`deps: none`, `"dependencies": {}` in package.json) | **Chosen** |
| libheif-js 1.19.8 | LGPL-3.0 | none | Rejected — lower-level, more glue, same underlying license exposure with none of heic2any's packaging benefits |
| heic-decode 2.1.0 | ISC (wrapper) | 1 (`libheif-js`) | Rejected — see below |

**heic2any, inspected directly (tarball pulled and unpacked, not taken on
faith from the README):**
- `package/dist/heic2any.js` is a single UMD bundle (1.36 MB min, 2.7 MB
  unpacked) with **no separate `.wasm` asset file** — the compiled libheif
  WASM is embedded inline inside the bundle and instantiated at runtime via
  `new Worker(new Blob([...]))`. This is the load-bearing fact for the
  Next.js compatibility question below.
- `package.json` declares `"license": "MIT"`, `"dependencies": {}`, matches
  `LICENSE.md` (Alex Corvi, MIT). The file header also carries a Yahoo Inc.
  MIT notice for a bundled `gifshot` module (unused by our call path — we
  only ever request `toType: "image/jpeg"`, never the GIF path).
- **License class to flag explicitly, per the task's instruction:** the MIT
  license covers Alex Corvi's wrapper code. The WASM binary it embeds is a
  compiled build of **libheif**, which upstream is **LGPL-3.0**, and HEIC's
  underlying HEVC codec carries patent licensing overhead in principle
  (HEVC Advance / MPEG LA / Access Advance pools). Assessment for this
  project: **acceptable, flagged not blocked.**
  - We consume `heic2any` unmodified as an npm dependency and never
    redistribute the compiled WASM as a standalone artifact — this is
    ordinary LGPL "linking/consumption" use, not the "modify and
    redistribute" case that triggers LGPL's copyleft obligations. No
    obligation flows to this project's own (proprietary-license-free,
    but still "our") application code.
  - Usage here is **decode-only, client-side, inside a small nonprofit's
    internal admin tool**, invoked interactively by a signed-in treasurer to
    convert a receipt photo they already possess — not a commercial
    HEIC-encoding product, not distributed as a device/software product,
    not monetized. This is the same risk profile as any website that
    displays HEIC thumbnails client-side. Practically negligible patent
    exposure; codify it in `docs/decisions.md` so a future session doesn't
    have to re-derive this reasoning.
  - If this ever stops being acceptable (e.g., legal counsel objects),
    the fallback is removing the one dynamic-import call site — no schema,
    no server, no other code depends on `heic2any`.

**Why not `heic-decode`:** confirmed by unpacking the tarball — its
`index.js` does `require('libheif-js/wasm-bundle')` and returns raw
`{width, height, data: Uint8ClampedArray}` pixel data, not a Blob. That
means we'd have to hand-write the `ImageData`/canvas-draw glue that
`heic2any` already does internally, for the same underlying decoder and the
same license story, with an added npm dependency edge (`libheif-js`) instead
of zero. Its own package description ("Decode HEIC images to raw data",
`engines: node >=8`) and CJS `require()`-based subpath import
(`libheif-js/wasm-bundle`) reads Node-tooling-first; nothing in the
package confirms it's been verified against Turbopack/webpack subpath
`"exports"` resolution in a browser client bundle. Not worth the risk or
the extra glue for zero functional gain over `heic2any`.

**Why not `libheif-js` directly:** same LGPL-3.0 license, same WASM-decode
mechanics, but without `heic2any`'s Blob-in/Blob-out convenience — we'd be
reimplementing what `heic2any` already wraps, for a lower-level API with
more surface for us to get wrong (worker/module instantiation, pixel
buffer → canvas plumbing). No upside over `heic2any` for this exact use case.

**Maintenance signal:** `heic2any` last published ~14 months ago, 4 releases
total, single maintainer, no recent commits visible from `pnpm view`. Not
actively churning, but it's also a small, complete, single-purpose,
zero-dependency wrapper around a stable format (HEIC's spec isn't moving) —
low ongoing-maintenance need, and if it's ever abandoned the surface we
depend on is one function call, trivially forkable/vendorable. Acceptable
per criterion 2, with the caveat noted for the 30-day dependency review to
periodically re-check.

## Placement

- **Directory placement:** `src/lib/heic-decode.ts` (new, client-safe TS
  module — no `'use client'` directive needed on a non-component module).
  Mirrors the `image-resize.ts` precedent already in this codebase (pure
  logic separated from the DOM glue in `receipt-file-input.tsx`) and the
  `permissions.ts`/`permissions-server.ts` client-safe/server-only split
  pattern referenced in that file's own docstring. **Rule out
  `src/components/admin/ledger/` for this logic** — it isn't a component,
  isn't Ledger-specific in mechanism (it's a generic HEIC-decode utility
  that happens to have one caller today), and `src/lib/` is where this
  project already puts exactly this shape of pure-logic-plus-thin-DOM-glue
  helper.
- **Where the testable seam actually is:** the WASM decode call itself
  (`await import("heic2any")` then invoking it) is irreducibly
  browser/WASM-dependent, same as `resizeImage()`'s existing
  `createImageBitmap()` call — neither is meaningfully unit-testable under
  Vitest's node environment, and that's fine; QA's manual click-through /
  Playwright already covers this class of DOM-dependent behavior (see
  Phase 1's test-matrix gap note re: a `.heic`-named non-HEIC file). What
  **is** purely testable and should be written as standalone pure functions
  in `heic-decode.ts`:
  - A failure classifier — e.g. `classifyHeicDecodeFailure(error: unknown):
    "chunk-load-failed" | "decode-failed"` — resolving Phase 1's Gap #2
    (two distinct messages). Pure function, testable with constructed
    Error/rejection shapes, no browser needed.
  - The message lookup for each classification (Gap #2's exact copy is
    Phase 3's call, but the *shape* — a pure `kind → string` mapping — is an
    architectural placement call: it belongs next to the classifier, not
    inlined in the component's JSX, so both are covered by the same test
    file).
  - Recommend structuring the orchestration (native decode → on failure,
    only for files where `isHeicFile()` is true → attempt WASM decode → on
    that failure, classify and message) as a function that takes the two
    async decode steps as parameters rather than importing `heic2any`
    directly inline in `receipt-file-input.tsx`'s `handleChange` — this lets
    Phase 4's implementer unit-test the *control flow* (which branch fires
    for which combination of native/WASM outcomes) by injecting stub
    functions, without needing a real WASM runtime in the test. The actual
    `heic2any` import stays isolated to one thin exported function (e.g.
    `decodeHeicFileToJpegBlob(file: File): Promise<Blob>`) that Phase 4 does
    not need to unit test directly — its correctness is proven by the
    manual click-through, same as `resizeImage()` today.
- **Server vs Client split:** entirely client-side. `receipt-file-input.tsx`
  already carries `'use client'` (unchanged). `heic-decode.ts` is a plain
  module (no directive) imported only from that client component — same
  pattern as `image-resize.ts`. **Confirmed: no server-side change of any
  kind.** The upload route (`/api/admin/ledger/transactions/upload`) and its
  magic-bytes check are untouched; the server still only ever receives
  JPEG/PDF/PNG bytes, same contract as today.
- **Dependencies:** one new npm dependency, `heic2any` — see above.

## Invariants Touched

- **Dependency evaluation criteria (this file's own review process):**
  respected — evaluated against maintenance, size, license, transitive
  deps, and exact-API fit; documented above rather than asserted.
- **Server/Client boundary:** respected, no change — see Placement.
- **Bundle-size discipline ("public-facing site that needs a fast first
  paint," criterion 4):** respected, and specifically verified, not just
  assumed:
  - This surface is `(dashboard)/admin` only — never shipped to a public
    visitor's first paint regardless.
  - The 1.36 MB `heic2any` bundle must land in its **own chunk**, fetched
    only after a native `createImageBitmap()` rejection on a HEIC file.
    Confirmed this is structurally guaranteed, not just conventionally
    expected: a dynamic `import("heic2any")` (or
    `import("@/lib/heic-decode")` if the module itself does the dynamic
    import internally) is split into a separate async chunk by **both**
    bundlers this project's scripts invoke — webpack (`next build` in
    `build:only`, no `--turbopack` flag present) and Turbopack (`next dev`
    defaults to it in Next 16). Code-splitting on a dynamic `import()`
    boundary is core, always-on behavior for both, not an opt-in flag —
    there is nothing to misconfigure here. Safari users, and any user whose
    native `createImageBitmap()` succeeds, never trigger the `import()` and
    never download the chunk.
- **Next.js/Turbopack asset-pipeline compatibility (task's explicit ask):**
  **no `next.config.ts` change required.** Verified by unpacking the
  tarball: `heic2any` has no separate `.wasm` file for the bundler to
  resolve as a static asset — the WASM binary is embedded inline in the JS
  bundle and instantiated at runtime inside a `Blob`-backed `Worker`. This
  sidesteps the exact class of problem that would require
  `next.config.ts` changes (e.g., `experiments.asyncWebAssembly`/
  `webpack.experiments`, or asset-module wiring for a `.wasm` import) —
  problems the two lower-level candidates (`libheif-js`, `heic-decode`)
  would be more likely to hit since they consume libheif's raw Emscripten
  output rather than heic2any's self-contained bundle.
  - **CSP already permits this** — checked `next.config.ts` directly, no
    change needed there either:
    `worker-src 'self' blob:` (line 22) already permits the
    `Blob`-constructed `Worker` heic2any spins up, and
    `script-src ... 'unsafe-eval' ...` (line 16) already covers WASM
    instantiation. Both were already present for unrelated reasons
    (Turnstile, presumably); this feature adds no new CSP directive.
- **No native browser dialogs:** not applicable — this feature touches no
  dialog surface. Confirmed no `alert()`/`confirm()`/`prompt()` introduced.
- **Permissions:** no `FEATURES` change — confirmed, matches Phase 1.
  `LEDGER_RECORD` already gates the one server route involved, unchanged.
- **Migrations:** none — no schema change, no migration file needed.

## Notes for Phase 3

1. **Honor the two adopted Phase 1 decisions that are architecturally
   load-bearing:** (a) the WASM retry must fire on *any* browser's native
   decode failure for a HEIC file, not gated on browser sniffing — this is
   also what keeps the dynamic-import boundary simple (one trigger
   condition: `isHeicFile(file) && nativeDecodeFailed`, not a UA-string
   branch); (b) two distinct failure messages, not one reused string —
   the pure classifier/message-lookup functions above exist specifically to
   make this cheap to implement and cheap to test.
2. **UMD interop note for whoever writes the actual import call:**
   `heic2any`'s bundle is UMD (`(function(...){ ... return heic2any; })(...)`),
   not native ESM, so `await import("heic2any")` will go through
   webpack/Turbopack's CJS interop shim. The safe access pattern is
   `const mod = await import("heic2any"); const convert = (mod as any).default ?? (mod as unknown as typeof convertFn);`
   or equivalent defensive unwrap — don't assume `.default` is always
   populated without checking, since UMD interop shape has historically
   been a source of "works in dev, breaks in prod build" bugs. Flagging so
   Phase 4 tests this specific call path in the production build
   (`pnpm build:only`), not just `pnpm dev`.
3. **API call shape:** `heic2any({ blob: file, toType: "image/jpeg", quality: RECEIPT_IMAGE_JPEG_QUALITY })`
   returns `Promise<Blob | Blob[]>` (array only for multi-image HEIC
   containers/animations, `multiple: true` opt-in we won't set). Feed the
   resulting single JPEG `Blob` back through the **existing**
   `resizeImage()` path (construct a `File`/reuse the `Blob` directly with
   `createImageBitmap`, which now succeeds since it's a JPEG) rather than
   duplicating the canvas-resize logic — keeps the 1600px/0.82-quality spec
   defined in exactly one place (`image-resize.ts`).
4. **Processing-phase copy (Phase 1's Gap #3):** now has real architectural
   grounding for a third status value — decoding a near-cap HEIC file
   through freshly-fetched WASM is plausibly multi-second CPU + network time
   before the actual upload `fetch` starts. Phase 3 should extend the
   `Status` type (`"idle" | "processing" | "error"` today) to distinguish
   "preparing/decoding" from "uploading," per Phase 1's suggestion — this is
   a component-state design call, not an architectural one, but flagging so
   it isn't dropped.
5. **Test matrix line to carry into Phase 3/5 (from Phase 1's gap):** a
   `.heic`-named file that isn't real HEIC must fail through the
   `decode-failed` classification cleanly and reasonably fast, not hang —
   `heic2any` rejects its promise on unparseable input (standard behavior
   for libheif-wrapping decoders), but this should be an explicit manual
   test case, not an assumption.
6. **Backlog housekeeping (adopted decision #4):** logged the member
   reimbursement upload and profile-picture upload HEIC gaps to
   `docs/backlog.md` as B-08 and B-09 (see Outputs) so Phase 1's "confirm
   with user" open question has a durable record now that the user's
   delegation to analyst recommendations adopted "out of scope for this
   increment" — nothing for Phase 3 to do here, just noting it's tracked
   rather than dropped.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-07-21
**Designed by:** tech-lead

## Summary

We're closing the Chrome/Firefox HEIC dead end from the 2026-07-21
`receipt-heic-support` work by giving the receipt file input one more shot
at decoding a HEIC/HEIF file after native `createImageBitmap()` fails,
regardless of browser: lazy-load `heic2any` (WASM, MIT wrapper over LGPL-3.0
libheif — DECISION-038), convert to a JPEG `Blob`, then run that JPEG back
through the *existing* `resizeImage()`/`createImageBitmap` pipeline so the
1600px/0.82-quality spec stays defined in exactly one place
(`src/lib/image-resize.ts`). If the WASM path also fails, the admin sees one
of two distinct, non-"use Safari" messages depending on whether the decoder
chunk failed to load or the file itself failed to decode. Server contract,
permissions, and schema are all untouched — this is a pure client-side
decode-path addition to `src/components/admin/ledger/receipt-file-input.tsx`
plus one new module, `src/lib/heic-decode.ts`.

## Permissions

No new permission key. Existing `FEATURES.LEDGER_RECORD` already gates the
one server route this component talks to
(`POST /api/admin/ledger/transactions/upload`), and that route is untouched
by this feature — the server still only ever receives JPEG/PDF/PNG bytes,
verified by its existing magic-bytes check. No role-binding changes.

## API Contract

No API changes. `POST /api/admin/ledger/transactions/upload` is unmodified
— same request shape (`multipart/form-data`, one `file` field), same
response shape (`{ key, ... }` on success, `{ error }` on 4xx), same 10 MB
cap and magic-bytes validation. This feature never lets the server learn
whether the original file was HEIC; by the time a `fetch` reaches this
route, the body is always JPEG (or PDF, unchanged) exactly as today.

## Data Model

No schema changes required.

## Component / Page Plan

- Pages to create: none.
- Components to create: none — no new component, only a new **library
  module**.
- Files to create:
  - `src/lib/heic-decode.ts` — the dynamic-import seam, the pure failure
    classifier, the message lookup, and the one thin
    `decodeHeicFileToJpegBlob()` orchestration function. No `'use client'`
    directive (plain TS module, same pattern as `image-resize.ts`).
  - `src/lib/heic-decode.test.ts` — Vitest unit tests (list below).
- Files to modify:
  - `src/components/admin/ledger/receipt-file-input.tsx` — `Status` type
    split, `handleChange` control flow, processing-copy split, error copy
    wiring for the two new failure messages.
  - `package.json` / `pnpm-lock.yaml` — new `heic2any@^0.0.4` dependency
    (via `pnpm add heic2any`).

## `src/lib/heic-decode.ts` — Design

```ts
export type HeicDecodeFailureKind = "chunk-load" | "decode";

/**
 * Tags which stage of the WASM HEIC decode failed, so classification never
 * has to guess from an arbitrary error's message string. Thrown only by
 * decodeHeicFileToJpegBlob below.
 */
export class HeicDecodeStageError extends Error {
  readonly stage: HeicDecodeFailureKind;
  constructor(message: string, stage: HeicDecodeFailureKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HeicDecodeStageError";
    this.stage = stage;
  }
}

/**
 * Pure, browser-free. Classifies a caught decode error into which of the
 * two user-facing messages applies. Defaults to "decode" for anything that
 * isn't a HeicDecodeStageError — a conservative choice: an unrecognized
 * error is more likely a content problem than a network problem, and
 * "decode" is the message that doesn't imply "try again."
 */
export function classifyHeicDecodeFailure(error: unknown): HeicDecodeFailureKind {
  if (error instanceof HeicDecodeStageError) return error.stage;
  return "decode";
}

export const HEIC_DECODE_FAILURE_MESSAGES: Record<HeicDecodeFailureKind, string> = {
  "chunk-load":
    "Couldn't load the HEIC photo converter — check your connection and try again, or export the photo as JPEG.",
  "decode":
    "This photo couldn't be converted — it may not be a valid HEIC file. Try exporting it as JPEG.",
};

export function getHeicDecodeFailureMessage(kind: HeicDecodeFailureKind): string {
  return HEIC_DECODE_FAILURE_MESSAGES[kind];
}

/**
 * The one untestable-without-a-browser seam: dynamically imports heic2any
 * and converts `file` to a single JPEG Blob. Everything around the import
 * — UMD unwrap, Blob[] handling, stage tagging — IS exercised in
 * heic-decode.test.ts via `vi.mock("heic2any", ...)`, which intercepts this
 * dynamic import without needing a real WASM runtime.
 *
 * Caller contract: on success, the returned Blob is JPEG-encoded but NOT
 * resized — the caller (receipt-file-input.tsx) must run it back through
 * the existing resizeImage() path, same as any other image source.
 */
export async function decodeHeicFileToJpegBlob(file: File): Promise<Blob> {
  let heic2any: (opts: {
    blob: Blob;
    toType: string;
    quality: number;
  }) => Promise<Blob | Blob[]>;

  try {
    const mod = await import("heic2any");
    heic2any = ((mod as { default?: unknown }).default ?? mod) as typeof heic2any;
  } catch (err) {
    throw new HeicDecodeStageError("Failed to load the HEIC decoder.", "chunk-load", { cause: err });
  }

  let result: Blob | Blob[];
  try {
    result = await heic2any({ blob: file, toType: "image/jpeg", quality: RECEIPT_IMAGE_JPEG_QUALITY });
  } catch (err) {
    throw new HeicDecodeStageError("Failed to decode the HEIC file.", "decode", { cause: err });
  }

  const jpegBlob = Array.isArray(result) ? result[0] : result;
  if (!jpegBlob) {
    throw new HeicDecodeStageError("HEIC decoder returned no image.", "decode");
  }
  return jpegBlob;
}
```

`RECEIPT_IMAGE_JPEG_QUALITY` is imported from `@/lib/image-resize` — reused,
not redefined, so the quality constant stays defined in one place.

## `receipt-file-input.tsx` — Control Flow Changes

**`Status` type:** replace `"idle" | "processing" | "error"` with
`"idle" | "preparing" | "uploading" | "error"`. This is a rename-and-split,
not an added flag — "processing" never meant two different things at the
call sites that read it, so there's no ambiguity to preserve. Update the
`disabled` prop on the `<input>` from `status === "processing"` to
`status === "preparing" || status === "uploading"`, and the hint-text
ternary to a three-way switch:

```tsx
{status === "preparing"
  ? "Preparing photo…"
  : status === "uploading"
  ? "Uploading receipt…"
  : "PDF, JPEG, PNG, or HEIC, up to 10 MB. Photos are resized automatically."}
```

**`handleChange` control flow** (replaces the current `isImageFile`/
`isHeicFile` block):

1. Size check (unchanged) — rejects before any state other than `"error"`.
2. `setStatus("preparing")` (was `setStatus("processing")`) — covers native
   decode, WASM chunk fetch, WASM decode, and the post-WASM resize; all of
   this is "getting the photo ready," none of it is network upload yet.
3. If `isImageFile(file)`:
   a. `try { resizeImage(file) }` — unchanged, attempts native
      `createImageBitmap` first, for every browser, no UA sniffing.
   b. On failure:
      - If `isHeicFile(file)` (binding constraint: fires on *any* browser's
        native failure for a HEIC file, including Safari — this also
        retires the "use Safari" copy bug the analyst flagged in Phase 1,
        since Safari now gets the same WASM retry instead of an
        immediately-wrong message):
        ```ts
        try {
          const jpegBlob = await decodeHeicFileToJpegBlob(file);
          const jpegAsFile = new File([jpegBlob], file.name, { type: "image/jpeg" });
          const resized = await resizeImage(jpegAsFile); // existing path, now succeeds — it's a JPEG
          uploadBlob = resized.blob;
          displayName = resized.name;
        } catch (wasmErr) {
          setStatus("error");
          setError(getHeicDecodeFailureMessage(classifyHeicDecodeFailure(wasmErr)));
          return;
        }
        ```
        Wrapping the *second* `resizeImage()` call in the same `try` as
        `decodeHeicFileToJpegBlob()` is deliberate: if `heic2any` produces a
        blob that somehow still fails to decode as a JPEG (defensive,
        expected never to happen for a real JPEG blob), the plain `Error`
        that `resizeImage` throws isn't a `HeicDecodeStageError`, so
        `classifyHeicDecodeFailure` falls through to its default
        `"decode"` classification — the correct message for "this file is
        the problem," with no extra branching needed.
      - Else (non-HEIC image decode failure): unchanged — fall back to
        uploading the original file.
4. `setStatus("uploading")` immediately before the `fetch(...)` call to the
   upload route (moved from implicitly being "processing" the whole time to
   explicitly starting only once bytes are about to leave the machine).
5. Success/failure handling for the fetch itself: unchanged, still lands on
   `setStatus("idle")` or `setStatus("error")`.

**Why not a separate orchestration function taking injected decode-step
stubs (Phase 2's suggestion):** considered it, but this project's Vitest
config runs `environment: "node"` with no jsdom/testing-library dependency
(checked `vitest.config.ts` and `package.json` directly) — there is no
existing precedent for testing component-level branching in this codebase,
and adding jsdom + a DOM-mocking harness just to unit-test five lines of
`if/try/catch` branching is disproportionate to the risk. The two things
that actually needed to be pure and unit-testable per the architect's
review — failure classification and message copy — live in
`heic-decode.ts` and are fully covered there. The remaining branching in
`handleChange` is exactly the class of DOM-dependent behavior the
architect's own Phase 2 notes assign to QA's manual click-through (same
treatment `resizeImage()` itself already gets today). Flagging this as a
deliberate, justified deviation from a Phase 2 "recommend" (not a "must"),
not a silent drop.

## Vitest Unit Tests — Implementer Must Deliver (Phase 4 Gate)

New file `src/lib/heic-decode.test.ts`, styled after `image-resize.test.ts`
and `ledger.test.ts` (small `describe` blocks per exported function, happy
path + boundary + defensive cases). Node has global `File`/`Blob` since
v18/20 (this project targets Node 20.x per `.nvmrc`), so no jsdom is needed
even for the mocked-import tests below.

**`classifyHeicDecodeFailure`**
1. Returns `"chunk-load"` for a `HeicDecodeStageError` constructed with
   stage `"chunk-load"`.
2. Returns `"decode"` for a `HeicDecodeStageError` constructed with stage
   `"decode"`.
3. Returns `"decode"` (default) for a plain `Error`.
4. Returns `"decode"` (default) for a non-`Error` rejection value
   (`undefined`, a string, or a plain object) — defensive, since a `catch`
   block can receive anything.

**`getHeicDecodeFailureMessage` / `HEIC_DECODE_FAILURE_MESSAGES`**
5. Returns the connectivity/retry-oriented copy for `"chunk-load"`.
6. Returns the file/content-oriented copy for `"decode"`.
7. Neither message contains the substring `"Safari"` — regression guard
   for the Phase 1 finding that the old copy wrongly told Safari users
   (who may now also hit this path) to use Safari.

**`HeicDecodeStageError`**
8. Carries the `stage` it was constructed with, and `name ===
   "HeicDecodeStageError"`.
9. Preserves a wrapped `cause` when one is passed in the constructor
   options.

**`decodeHeicFileToJpegBlob`** (mock `heic2any` via `vi.mock("heic2any", ...)`
— this intercepts the dynamic `import("heic2any")` call without needing the
real WASM runtime)
10. Resolves to the JPEG `Blob` when the mocked module exports
    `{ default: fn }` and `fn` resolves with a single `Blob` (ESM-shaped
    interop).
11. Resolves to the JPEG `Blob` when the mocked module resolves as a bare
    callable with no `.default` (UMD/CJS-interop shape) — locks down the
    defensive `.default ?? mod` unwrap called out in the architect's Phase
    2 notes.
12. Takes the first element when the mocked `heic2any` resolves with a
    `Blob[]` (multi-image HEIC container, e.g. burst mode).
13. Throws a `HeicDecodeStageError` tagged `"decode"` when the mocked
    `heic2any` resolves with an empty `Blob[]`.
14. Throws a `HeicDecodeStageError` tagged `"chunk-load"` when the mocked
    module import itself rejects.
15. Throws a `HeicDecodeStageError` tagged `"decode"` when the import
    succeeds but the mocked `heic2any(...)` call rejects.
16. Calls the mocked `heic2any` with
    `{ blob: file, toType: "image/jpeg", quality: RECEIPT_IMAGE_JPEG_QUALITY }`
    — argument-shape contract test.

16 tests total. All are pure or mock-isolated — no jsdom, no real network,
no real WASM.

## Edge Cases & Risks

- **Double-pick while a decode is in flight:** confirmed already handled —
  the `<input>` is `disabled` for both new `"preparing"` and `"uploading"`
  states, same guarantee the old single `"processing"` state gave. No
  change in behavior, just renamed/split.
- **`.heic`-named file that isn't real HEIC:** native `createImageBitmap`
  rejects (not real image content it can decode) → `isHeicFile()` true
  (extension-based) → `decodeHeicFileToJpegBlob` calls `heic2any`, which
  rejects on unparseable input → tagged `"decode"` → message (b). Explicit
  manual-test-matrix line below, per Phase 1's gap note.
- **`heic2any` returning `Blob[]`** (multi-image/burst HEIC container):
  handled — first element taken. Empty-array edge case also handled
  defensively (test #13), even though `heic2any` is not expected to return
  an empty array in practice.
- **UMD interop breaking only in the production build:** `heic2any`'s
  bundle is UMD, not native ESM (Phase 2 finding). Unit tests #10–11 cover
  both interop shapes in isolation, but per Phase 2's explicit flag, the
  implementer must also manually verify the real dynamic import against
  `pnpm build:only` output (not just `pnpm dev`) — mocked tests prove the
  unwrap *logic* is correct, not that webpack's production CJS-interop
  shim actually produces one of the two shapes tested.
- **Oversized file (any format, including HEIC):** unchanged — rejected by
  the 10 MB check before `setStatus("preparing")` is ever reached, same
  message as today.
- **A near-cap HEIC file is the slowest case in the new path** (Phase 1
  Gap #3): WASM chunk fetch + decode CPU time scales with source
  resolution/size. This is exactly what the `"preparing"` vs `"uploading"`
  copy split exists to make honest — an admin watching "Preparing photo…"
  for several seconds before any network activity starts is now accurate,
  where "Uploading receipt…" for the same span would not have been.
- **Non-HEIC image decode failures:** unchanged — still fall back to
  uploading the original file, only the `isHeicFile()` branch changes.

## Implementation Order

1. `pnpm add heic2any` — adds the dependency per DECISION-038 (no schema,
   no `next.config.ts` change per Phase 2's verified findings).
2. Create `src/lib/heic-decode.ts` per the design above.
3. Create `src/lib/heic-decode.test.ts` — all 16 tests listed above,
   passing.
4. Modify `src/components/admin/ledger/receipt-file-input.tsx`: `Status`
   type split, `handleChange` control flow, hint-text copy, error-message
   wiring. No changes to `resizeImage()` or `image-resize.ts` — reused
   as-is.
5. `pnpm exec tsc --noEmit` and `pnpm build:only` — confirm no typecheck
   or production-build regressions, and specifically confirm the UMD
   unwrap works against the real production bundle (Phase 2's flagged
   risk), not just `pnpm dev`.
6. Hand off to qa (Phase 5) for the manual click-through matrix below.
7. Release notes entry — written by tech-lead once qa passes and analyst
   ships (Phase 6), per this project's release-notes ownership; not an
   implementer task.

## Manual Click-Through Matrix (for qa, Phase 5)

| # | Case | Expected result |
|---|------|------------------|
| 1 | Chrome, desktop, real `.heic` file (AirDropped/Finder-saved) | Native decode fails silently, WASM path succeeds, receipt attaches with a JPEG thumbnail — visually identical to the Safari-native happy path |
| 2 | Chrome, devtools "Offline" throttling, real `.heic` file | Native decode fails, WASM chunk `import()` fails (network), error message (a) shown — connectivity/retry copy, no mention of Safari |
| 3 | Chrome, corrupt/truncated `.heic` file | Native decode fails, WASM chunk loads, `heic2any` rejects on the bad bytes, error message (b) shown — file/content copy, no mention of Safari |
| 4 | Chrome, `.heic`-renamed non-HEIC file (e.g. a `.txt` renamed to `.heic`) | Same as #3 — message (b), fails promptly, does not hang |
| 5 | Safari (macOS or iOS), real `.heic` file | Unchanged regression check — native decode succeeds, WASM path never triggered (confirm via Network tab: no `heic2any` chunk request) |
| 6 | Chrome/Firefox/Safari, JPEG/PNG/PDF file | Unchanged regression check — no WASM path involvement at all, existing resize/upload behavior intact |
| 7 | Chrome, near-10MB HEIC file | "Preparing photo…" shown during the slow decode, "Uploading receipt…" only appears once the network request actually starts |
| 8 | Chrome, rapid double-pick during an in-flight decode | Input stays disabled through both `"preparing"` and `"uploading"`; second pick is not possible until the first resolves |

## Implementer

**ux-developer.** This is entirely client-side: one new library module
(`src/lib/heic-decode.ts`, mirroring the existing `image-resize.ts`
precedent) plus edits confined to one existing client component
(`receipt-file-input.tsx`) and its tests. No API route, no server action,
no schema — so neither `api-developer` nor `database-admin` has scope here.
`full-stack-developer` is reserved for work spanning server *and* client;
this spans neither server nor a new page, just one component's decode path
and its tightly-coupled support module, which is squarely
`ux-developer`'s "React components... forms" lane per the roster table —
and matches how the original `receipt-file-input.tsx` +
`image-resize.ts` pairing was built.

---

# Phase 4 — Implementation

**Date:** 2026-07-21
**Implemented by:** ux-developer

## Summary

Built exactly per the Phase 3 design: `heic2any` added as a dynamically-imported
dependency, isolated in `src/lib/heic-decode.ts` (dynamic-import seam, defensive
UMD unwrap, failure classifier, message lookup, orchestration function), wired
into `receipt-file-input.tsx`'s `handleChange` so a native HEIC decode failure
(any browser) gets one more attempt through the WASM decoder before the admin
sees an error, and the resulting JPEG flows back through the existing
`resizeImage()` path unchanged. `Status` split into `"preparing"` /
`"uploading"` with matching hint-copy split. All 16 named Vitest tests written
and passing, plus the production build was inspected to confirm the WASM
bundle lands in its own async chunk.

## Files Created

- `src/lib/heic-decode.ts` — dynamic `import("heic2any")` seam,
  `HeicDecodeStageError` (stage `"chunk-load" | "decode"`),
  `classifyHeicDecodeFailure()`, `HEIC_DECODE_FAILURE_MESSAGES` /
  `getHeicDecodeFailureMessage()`, `resolveHeic2AnyExport()` (new — see
  Implementer Notes), and `decodeHeicFileToJpegBlob()`. No `'use client'`
  directive (plain module), mirrors `image-resize.ts`.
- `src/lib/heic-decode.test.ts` — all 16 Vitest tests named in the Phase 3
  design, passing.

## Files Modified

- `src/components/admin/ledger/receipt-file-input.tsx` — `Status` type split
  from `"idle" | "processing" | "error"` to
  `"idle" | "preparing" | "uploading" | "error"`; `handleChange`'s HEIC
  decode-failure branch now attempts `decodeHeicFileToJpegBlob()` before
  giving up (any browser, no UA sniff), feeding the resulting JPEG back
  through the existing `resizeImage()`; `setStatus("uploading")` moved to
  immediately before the upload `fetch`; hint-text ternary split into
  "Preparing photo…" / "Uploading receipt…" / the default hint; `disabled`
  prop updated to cover both `"preparing"` and `"uploading"`; doc comments on
  `isHeicFile` and the component header updated to describe the WASM retry.
  Non-HEIC image decode-failure fallback, the 10 MB cap check, and
  `isImageFile`/`isHeicFile` detection logic are unchanged.
- `package.json` / `pnpm-lock.yaml` — added `heic2any@^0.0.4`
  (`pnpm add heic2any`; resolved `0.0.4`).

## Schema Changes

- None — no `schema.ts` change, no migration file. Confirmed by design
  (Phase 2/3) and unchanged in practice: entirely client-side, server route
  untouched.

## Implementer Notes

**One documented divergence from the design's literal test #11.** The Phase
3 design's test #11 said to mock `import("heic2any")` via `vi.mock`/
`vi.doMock` so the resolved module value is itself a bare callable (no
`.default`), to lock down the UMD-interop fallback branch
`(mod.default ?? mod)`. In practice, this project's Vitest version
(`@vitest/mocker` 4.1.9) enforces `assertValidExports` on every mock factory
return value: it throws unless the returned value is a non-null, non-array
object (`typeof === "object"`) — a bare function fails that check
unconditionally (`typeof fn === "function"`, not `"object"`), so a
mocked-module-is-a-function shape cannot be constructed through `vi.mock` in
this Vitest version at all, regardless of how the test is written. Confirmed
by first reproducing the exact failure (`vi.mock("heic2any", factory?: () =>
unknown) is not returning an object`) before working around it.

Fix: extracted the two-line unwrap (`(mod as { default?: unknown })?.default
?? mod`) out of `decodeHeicFileToJpegBlob` into its own exported pure
function, `resolveHeic2AnyExport(mod: unknown): Heic2AnyFn`, documented
in-file as existing specifically for this test. Test #11 now calls
`resolveHeic2AnyExport(bareCallableFn)` directly and asserts it returns the
function unchanged — same coverage of the fallback branch's logic, just
exercised as a direct pure-function call instead of through a full
`decodeHeicFileToJpegBlob` + mocked-dynamic-import round trip (which the
ESM-shaped case, test #10, already covers end-to-end). All 16 tests from the
design's list are present and passing; only the *mechanism* for test #11
changed, not its intent or coverage. `decodeHeicFileToJpegBlob` itself is
otherwise unchanged from the design's code.

No other divergences. `RECEIPT_IMAGE_JPEG_QUALITY` is imported from
`@/lib/image-resize` as specified, not redefined. The orchestration in
`handleChange` matches the design's control-flow listing exactly, including
wrapping the post-WASM `resizeImage()` call inside the same `try` as
`decodeHeicFileToJpegBlob()` so an unexpected JPEG-decode failure still
falls through to `classifyHeicDecodeFailure`'s `"decode"` default.

**`pnpm lint` is broken repo-wide, unrelated to this change.** Ran it to
check the two touched files and it fails identically on any input with
`SyntaxError: The requested module 'minimatch' does not provide an export
named 'default'` inside ESLint's own config loader (`@eslint/eslintrc`
`override-tester.js`) — an ESLint/`minimatch` ESM-interop break in the
toolchain itself, reproducible on a clean `pnpm lint` with no files changed.
Not something this feature introduced or could fix within its scope;
flagging for the next dependencies review (30-day cadence, owned by
deployment-engineer) rather than silently working around it.

## Gate Results

- `pnpm exec tsc --noEmit`: **PASS**, no errors.
- `pnpm test`: **PASS** — 448/448 tests green across 14 files, including all
  16 new tests in `src/lib/heic-decode.test.ts`
  (`classifyHeicDecodeFailure` x4, message lookup x3, `HeicDecodeStageError`
  x2, `decodeHeicFileToJpegBlob`/`resolveHeic2AnyExport` x7).
- `pnpm build:only`: **PASS.** Production build succeeded
  (`✓ Compiled successfully`). Chunk-splitting verified directly against the
  build output, not assumed:
  - The `heic2any` UMD bundle (containing `libheif`/`gifshot` strings,
    matching DECISION-038's tarball inspection) is isolated in
    `.next/static/chunks/3u8a9v_6h5-v4.js`, **1,351,661 bytes** — matches
    the ~1.36 MB figure from the architect's Phase 2 review.
  - That chunk has **zero** references in `.next/build-manifest.json` (the
    per-page eagerly-loaded script list) — confirmed it is never part of any
    page's initial bundle.
  - The only references to that chunk anywhere else in `.next/` are inside
    two other page-level chunks, each via a Turbopack lazy-chunk-loader stub
    of the shape
    `e.v(t=>Promise.all(["static/chunks/3u8a9v_6h5-v4.js"].map(t=>e.l(t))).then(()=>t(399079)))`
    — i.e., the dynamic `import("heic2any")` call site compiles to a
    runtime-only loader, not an eager `<script>` reference. This is the
    exact code-splitting guarantee Phase 2 required (Safari users and any
    successful-native-decode user never download this chunk).
  - Build also confirmed (via `globalThis.TURBOPACK` markers in output
    chunks) that `next build` in this Next 16 install now runs on Turbopack
    by default — both bundlers named in the Phase 2 review were effectively
    exercised across `build:only` and `pnpm dev`.
- No `console.log`/`console.debug` in `heic-decode.ts` or
  `receipt-file-input.tsx` — checked directly.
- No native browser dialogs introduced — checked directly, none present.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-21
**Verified by:** qa

## Summary

**PASS.** Re-ran every gate independently rather than trusting Phase 4's
report, and all of them are green: `tsc --noEmit` clean, all 448 Vitest
tests pass (16/16 new `heic-decode.test.ts` tests, `heic-decode.ts` at
100% statement/branch/function coverage per `coverage-summary.json`),
`pnpm build:only` succeeds and the `heic2any` chunk (`3u8a9v_6h5-v4.js`,
1,351,661 bytes — exact byte-for-byte match to Phase 4's report) is
confirmed absent from `build-manifest.json`'s eager lists (0 references)
and reachable only via a runtime lazy-chunk-loader stub from two other page
chunks. Went further than a static build check: downloaded three real HEIC
photos from `heic2any`'s own repo (MIT-licensed demo assets), confirmed
this project's Playwright Chromium build does **not** decode HEIC natively
(`createImageBitmap` on the real fixture throws `InvalidStateError`), then
wrote and ran a genuine end-to-end Playwright spec
(`e2e/receipt-heic-upload.spec.ts`) that drives the real admin UI, uploads
a real HEIC file, and watches it go through the actual `heic2any` WASM
decode in a live browser — no mocking at this layer. All 3 new e2e tests
pass, plus the full existing e2e suite (30 tests) passes except one
pre-existing flake unrelated to this feature (see below). Code review
confirms the diff matches the Phase 3 design exactly: unconditional
native-fail → WASM-retry control flow (no UA sniffing), the three-state
`Status` machine, the two distinct failure messages (neither says
"Safari"), the non-HEIC and oversized-file paths byte-for-byte unchanged,
no `console.log`, no native dialogs, and the defensive UMD unwrap
(`resolveHeic2AnyExport`) present and separately unit-tested. The
documented test #11 mechanism divergence is legitimate — the fallback
branch's logic is exercised, `decodeHeicFileToJpegBlob` calls
`resolveHeic2AnyExport` directly with no unrelated logic in between, and
the ESM-shaped case is already covered end-to-end by test #10. Automated
3 of the 8 manual-matrix rows (happy path, corrupt file, fake-extension
file — the three the task flagged as reachable); the remaining 5
(connectivity/offline chunk-load, Safari native-decode regression,
non-HEIC regression, near-cap slow-decode copy timing, rapid double-pick)
are listed below as explicit user follow-ups, not silently skipped.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — no errors.

## Unit Tests

`pnpm test`: **PASS**
Total: 448 | Passed: 448 | Failed: 0
Duration: ~0.3s (14 test files)
Failures: none

All 16 named tests from the Phase 3 design are present in
`src/lib/heic-decode.test.ts` and meaningfully assert (verified by reading
every test body, not just the count): `classifyHeicDecodeFailure` (4),
`getHeicDecodeFailureMessage`/`HEIC_DECODE_FAILURE_MESSAGES` (3),
`HeicDecodeStageError` (2), `decodeHeicFileToJpegBlob` (7, including the
divergent-mechanism test #11 via direct `resolveHeic2AnyExport` calls).
None are vacuous — each asserts a specific return value, thrown-error
shape/stage, or call-argument contract, not just "doesn't throw."

**Test #11 divergence audit (task item 2):** confirmed legitimate, not a
coverage hole. `resolveHeic2AnyExport` is the entire unwrap logic —
`decodeHeicFileToJpegBlob` calls it directly (`heic2any =
resolveHeic2AnyExport(mod)`) with no additional branching around the call.
Testing the function directly with a bare-callable input exercises the
exact same code path decodeHeicFileToJpegBlob would hit for a real UMD
module resolving without `.default`; the only thing not re-proven by test
#11 is the outer plumbing (dynamic import → assignment → later invocation),
and that plumbing is already proven by test #10's ESM-shaped case through
the full `decodeHeicFileToJpegBlob` + `vi.doMock` round trip. Reproduced
the `vi.mock` limitation myself conceptually (Vitest 4.1.9's
`assertValidExports` rejects non-object mock factory returns) by reading
the implementer's note and confirming it against this project's installed
`@vitest/mocker` version — the constraint is real, not a convenience
excuse.

## Production Build

`pnpm build:only`: **PASS** — `✓ Compiled successfully in 6.9s`.

Chunk-splitting independently re-verified (not trusted from Phase 4's
report):
- `heic2any`'s UMD bundle located via `grep -rl "libheif\|gifshot"` across
  `.next/static/chunks/*.js` → exactly one match,
  `.next/static/chunks/3u8a9v_6h5-v4.js`, **1,351,661 bytes** — identical
  byte count to Phase 4's report.
- `grep -c "3u8a9v_6h5-v4" .next/build-manifest.json` → **0** — confirmed
  absent from every page's eager script list.
- The only two other references to that chunk anywhere in `.next/` are
  inside `4252lt51u6ply.js` and `0hghyezg3p8f9.js` (both admin ledger page
  chunks), and both are the exact same runtime-only pattern:
  `e.v(t=>Promise.all(["static/chunks/3u8a9v_6h5-v4.js"].map(t=>e.l(t))).then(()=>t(399079)))`
  — a lazy-chunk-loader stub, not an eager `<script>` reference. This is
  the code-splitting guarantee the architect's Phase 2 review required:
  Safari users and any successful-native-decode user never fetch this
  chunk.

## End-to-End Tests

`pnpm test:e2e` (this feature's new spec + full suite): **PASS** (1
pre-existing unrelated flake, isolated and confirmed not caused by this
change — see below)

**New spec — `e2e/receipt-heic-upload.spec.ts` (written this phase):**
Total: 3 | Passed: 3 | Failed: 0 | Duration: ~4s each

This is a real browser test, not a mock — it signs in as the seeded e2e
admin, opens the "Record Transaction" dialog on `/admin/ledger/all`,
selects "Expense" (the only flow that renders the receipt section), and
feeds real files into the actual `<input type="file">`:
1. **`valid.heic`** (a real HEIC photo pulled from `heic2any`'s own GitHub
   repo demo assets — MIT-licensed project, used strictly as decode-test
   input, not redistributed as product content) → asserts `"ready to
   attach"` appears (the UI state that only renders after the upload
   round-trip to `/api/admin/ledger/transactions/upload` succeeds) and no
   `role="alert"` error appears. Confirmed first, separately, that this
   Playwright Chromium build's native `createImageBitmap()` rejects this
   exact file with `InvalidStateError: The source image could not be
   decoded.` — so this test genuinely proves the WASM (`heic2any`) path
   works end-to-end in a live browser, not that native decode silently
   succeeded.
2. **`corrupt.heic`** (first 8000 bytes of the same valid file — truncated
   HEVC payload behind a valid-looking `ftyp` box) → asserts the alert
   contains "may not be a valid HEIC file" and does **not** contain
   "Safari" or "check your connection" — proving the decode-stage
   classification (not chunk-load) fires correctly for a real
   `heic2any` rejection, not just the mocked-unit-test shape.
3. **`not-actually-heic.heic`** (plain text renamed to `.heic`, Phase 1's
   named gap) → asserts the same "decode" message and resolves within the
   30s bound (in practice ~3s) — confirms it fails cleanly, not a hang.

Fixtures live in `e2e/fixtures/heic/` (`valid.heic`, `corrupt.heic`,
`not-actually-heic.heic`), with provenance documented in the spec file's
header comment.

**Full suite (`pnpm exec playwright test`):** 27 passed, 1 failed, 1
skipped (depends on the failed test), 1 did not run. The one failure —
`recurring-signup-rollup.spec.ts` Test 2, an RSVP-count assertion off by
one ("33 attending" expected, "32 attending" received) — is **not caused
by this feature**. `receipt-heic-upload.spec.ts` never touches events,
RSVPs, or the fixture event `291c76f3-ab75-4c64-8173-ac285345cfe9` that
`admin-security.spec.ts`'s own comments document as shared and
timing-sensitive under parallel workers. Re-ran
`recurring-signup-rollup.spec.ts` alone with `--workers=1`: all 4 tests
passed cleanly. This confirms the failure is the pre-existing
parallel-worker fixture-contention flakiness already called out in this
repo's own e2e comments, not a regression introduced here — flagging for
the next 7-day test-coverage review rather than treating it as this
feature's problem to fix.

## Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **PASS.** Reached and interacted with
`/admin/ledger/all` through the real dialog flow described above (this is
a stronger check than a bare page-load smoke test — it exercised the
Record Transaction dialog, the Expense flow selector, the file input, the
WASM decode, and the upload round-trip, all against the dev server). No
runtime errors observed in server logs or browser console during any of
the three e2e runs. Server started cleanly, served the admin ledger routes
without error, and was killed cleanly after verification
(`lsof -ti:3000 | xargs kill -9`; confirmed down via a follow-up curl).

## Code Review Against Phase 3 Design

- **Control flow — WASM retry on any browser's native failure, no UA
  sniffing:** confirmed. `receipt-file-input.tsx`'s `handleChange` calls
  `resizeImage(file)` unconditionally first; on failure, branches on
  `isHeicFile(file)` only — no `navigator.userAgent` check anywhere in
  either changed file (`grep -n "userAgent" ...` → no matches).
- **`Status` state machine:** confirmed `"idle" | "preparing" |
  "uploading" | "error"`, exactly as designed. `disabled` covers both
  `"preparing"` and `"uploading"`; hint-text ternary is the three-way
  switch from the design, verbatim copy match ("Preparing photo…" /
  "Uploading receipt…").
- **Two failure messages, correct copy:** `HEIC_DECODE_FAILURE_MESSAGES`
  in `heic-decode.ts` matches the design's exact strings for both
  `"chunk-load"` and `"decode"`. Regression-tested (test #7) that neither
  contains "Safari" — and independently re-verified live in the e2e
  corrupt-file test.
- **Non-HEIC fallback unchanged:** confirmed by diff — the `else` branch
  in `handleChange` (fall back to uploading the original file) is
  byte-identical to the pre-feature version; only the `isHeicFile()` arm
  gained the new WASM-retry block.
- **10 MB cap unchanged:** confirmed — the size check at the top of
  `handleChange` (`file.size > MAX_FILE_SIZE_BYTES`) is untouched, still
  runs before `setStatus("preparing")` is ever reached.
- **No `console.log`/`console.debug`:** confirmed via direct grep — zero
  matches in either changed/new file.
- **No native browser dialogs:** confirmed via direct grep — zero
  `alert(`/`confirm(`/`prompt(` matches.
- **Defensive UMD unwrap present:** confirmed —
  `resolveHeic2AnyExport(mod: unknown)` does
  `((mod as { default?: unknown })?.default ?? mod)`, exactly the pattern
  Phase 2's notes required, factored into its own exported function per
  the Phase 4 divergence note, and exercised both in the mocked unit tests
  and implicitly in the live e2e WASM decode (which resolves the real
  `heic2any` module's actual UMD shape in a real browser — the strongest
  possible proof this unwrap works against the real bundle, not just a
  simulated shape).

No divergences found beyond the one Phase 4 already documented and
justified (test #11's mechanism). `RECEIPT_IMAGE_JPEG_QUALITY` is imported
from `@/lib/image-resize`, not redefined, as specified.

**Unrelated working-tree changes noted, not in scope for this
verification:** `src/components/admin/ledger/audit-items-panel.tsx` has an
uncommitted diff (a "View flagged transactions" link) that belongs to the
untracked `docs/work-log/2026-07-21-overview-guardrail-links.md` work-log,
not this feature. Confirmed via `git diff` that it touches no file this
feature's design names. Flagging only so the eventual commit doesn't
conflate two unrelated increments — not this phase's concern to resolve.

## Manual Click-Through Matrix

| # | Case | Result | Notes |
|---|------|--------|-------|
| 1 | Chrome, desktop, real `.heic` file | **Automated — PASS** | `e2e/receipt-heic-upload.spec.ts`, test 1. Real HEIC file, real WASM decode, real browser. |
| 2 | Chrome, devtools "Offline" throttling, real `.heic` file | **Requires manual click-through by user** | Not automated — reliably intercepting the dynamic-import chunk request specifically (vs. every other in-flight request) in dev mode is not a low-risk automation; the classifier logic for `"chunk-load"` is unit-tested (tests #1, #5, #14) but the live network-failure path itself needs a human with devtools. |
| 3 | Chrome, corrupt/truncated `.heic` file | **Automated — PASS** | `e2e/receipt-heic-upload.spec.ts`, test 2. |
| 4 | Chrome, `.heic`-renamed non-HEIC file | **Automated — PASS** | `e2e/receipt-heic-upload.spec.ts`, test 3. |
| 5 | Safari (macOS or iOS), real `.heic` file | **Requires manual click-through by user** | This project's `playwright.config.ts` only configures the `chromium` project (confirmed by reading the file) — there is no `webkit` project to drive, and even if added, Playwright's WebKit does not reproduce real Safari's native OS-level HEIC decode, so a WebKit run would not actually test what this row needs. Genuine Safari (macOS or iOS) required. |
| 6 | Chrome/Firefox/Safari, JPEG/PNG/PDF file | **Code-verified unchanged, not independently re-run this phase** | The non-HEIC fallback branch is byte-identical to the pre-feature code (see Code Review above) and was covered by the prior `receipt-heic-support` feature's own verification; re-deriving it here would be redundant given zero lines changed on that path. Recommend the user spot-check once during their manual pass for rows 2/5/7/8 below, but not blocking. |
| 7 | Chrome, near-10MB HEIC file | **Requires manual click-through by user** | Confirming the "Preparing photo…" → "Uploading receipt…" transition is honestly timed (not instant) needs a large enough real file and visual observation of the copy mid-transition; not meaningfully automatable as a pass/fail assertion beyond "the two strings exist," which is already covered by code review above. |
| 8 | Chrome, rapid double-pick during an in-flight decode | **Requires manual click-through by user** | The `disabled` prop logic is confirmed correct by code review (covers both `"preparing"` and `"uploading"`), but proving the OS file-picker itself can't be re-invoked mid-decode is a real-interaction check, not a DOM-state assertion Playwright's `setInputFiles` (which bypasses the OS picker entirely) can exercise. |

## Coverage on Critical Modules

- `src/lib/heic-decode.ts` (new this feature): **100%** statements,
  **100%** branches, **100%** functions, **100%** lines (from
  `coverage-summary.json`, v8 provider) — exceeds every coverage target in
  this agent's charter.
- `src/lib/permissions.ts`: 100% (unaffected by this feature, pre-existing).
- `src/lib/events.ts`: 94.73% stmts / 85.54% branch (unaffected by this
  feature, pre-existing — branch coverage is just under the 90%+ target;
  flagging for the next 7-day test-coverage review, not this feature's
  scope).
- `src/lib/members.ts`: 0% (unaffected by this feature, pre-existing —
  DB-bound paths, per this repo's own note, covered by e2e rather than
  Vitest; also a pre-existing gap, not introduced or worsened here).

## Feature-Gate Audit (mandatory before PASS)

**No protected routes or server actions touched by this feature.**
Verified by reading the diff directly: the only files changed/added are
`src/lib/heic-decode.ts` (new, plain client-safe module, no route, no
`"use server"`), `src/lib/heic-decode.test.ts` (test file),
`src/components/admin/ledger/receipt-file-input.tsx` (existing client
component, no new server call — still talks to the same
`POST /api/admin/ledger/transactions/upload` route it always did), and
`package.json`/`pnpm-lock.yaml` (dependency addition only). The one server
route this component calls
(`src/app/api/admin/ledger/transactions/upload/route.ts`) is untouched by
this diff — confirmed via `git diff --stat`, it does not appear in the
changed-files list at all. Its existing `auth()` + `hasFeature(...,
FEATURES.LEDGER_RECORD)` gate (established by the prior
`receipt-heic-support` feature) is unmodified and out of scope for
re-auditing here since nothing about this feature changes what the server
receives or how it's gated — the server still only ever sees JPEG/PDF/PNG
bytes, same contract as before this feature and unchanged by it.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/transactions/upload` (unchanged by this feature) | yes (pre-existing, unmodified) | yes (pre-existing, unmodified) | `FEATURES.LEDGER_RECORD` |

## Regression Tests Added

- `neither message contains the substring "Safari" (regression guard)` —
  `src/lib/heic-decode.test.ts:57` — guards against: the Phase 1-identified
  copy bug where the pre-WASM error message told Safari users (who may now
  legitimately reach this code path too, since the WASM retry is
  unconditional on browser) to "use Safari" while already in Safari.
- `shows the file/content-oriented error for a corrupt HEIC file, not the
  connectivity message` — `e2e/receipt-heic-upload.spec.ts:55` — guards
  against: a regression where a genuine file-content failure gets
  misclassified as connectivity ("chunk-load"), which would send an admin
  down a pointless "check your connection" retry loop for a file that will
  never decode.
- `fails cleanly (not a hang) for a .heic-named file that isn't real HEIC`
  — `e2e/receipt-heic-upload.spec.ts:77` — guards against: Phase 1's named
  gap (a `.heic`-extension file with non-HEIC content) causing a hang or
  an unhandled promise rejection instead of a clean, fast error.

## Verdict

**PASS.** All automatable gates are green (typecheck, unit tests including
100% coverage on the new module, production build with independently
re-verified chunk-splitting, and a real end-to-end Playwright run that
exercises the actual WASM decode in a live browser against real HEIC
fixtures — not just mocks). The code matches the Phase 3 design with no
undocumented divergences. Four matrix rows (#2, #5, #7, #8) genuinely
require a human with a real browser/devtools and are listed above as
explicit follow-ups, not silently dropped; row #6 is code-verified
unchanged rather than blindly assumed. None of the four manual rows gate
this PASS per this agent's charter ("rows that require real-browser manual
verification don't block PASS but must be explicitly listed as user
follow-ups").

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-21
**Reviewed by:** analyst

## Summary

Walked the shipped diff (`src/lib/heic-decode.ts`, new; `src/components/admin/ledger/receipt-file-input.tsx`, modified) against my own Phase 1 flows, gaps, and open questions, and against qa's Phase 5 report. Every flow I described in Phase 1 (WASM-success, two-shape WASM-failure, Safari-unchanged, non-HEIC-unchanged, oversized-unchanged) shipped as designed, and every gap I flagged — the latent "use Safari while in Safari" bug, the reused-error-message problem, the honest-copy split, the renamed-non-HEIC test case, the sibling-surface scope question — was resolved, not dropped. Verdict: **SHIP WITH NOTES**. The code is correct and matches intent; the notes are four rows of the Phase 3 manual-test matrix that only a human with a real browser/network/OS picker can exercise, and qa was explicit and correct that these don't gate PASS. They're not code follow-ups — they're verification tasks for the user, and I'm listing them as such rather than inventing code work to "close" them.

## What I Did

- Re-read my own Phase 1 section (verbs, five flows, permissions, five gaps, four open questions) against the shipped `heic-decode.ts` and the diff in `receipt-file-input.tsx`.
- Checked each of Phase 1's five named gaps against the Phase 3 design and the Phase 4/5 implementation notes for evidence of resolution (not just a mention).
- Checked qa's Phase 5 report for the disposition of all 8 manual-matrix rows and cross-referenced against my own Flow descriptions to see which of my flows those rows actually exercise.
- Confirmed the two out-of-scope items I flagged (member reimbursement upload, profile-picture upload) landed in `docs/backlog.md` as B-08/B-09 (`grep` confirmed both present) rather than being silently dropped.
- Confirmed `DECISION-038` exists in `docs/decisions.md` for the `heic2any` dependency call, closing my Phase 1 open question about library choice being explicitly deferred to Phase 2/3.

## Outputs

- `docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md` — this Phase 6 section, Per-Phase Status row updated to `Complete | SHIP WITH NOTES | 2026-07-21`.

## Open questions / handoff notes

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> Chrome/Firefox admins can now attach an AirDropped `.heic` receipt without a Safari/JPEG workaround, the fix incidentally repairs a latent "use Safari" bug for Safari users too, and the only work left is four real-browser checks a human needs to run — not code.

## What's Working

- **The unconditional native→WASM retry, exactly as I recommended in Phase 1's gap analysis.** I flagged that gating the WASM retry on Chrome/Firefox UA-sniffing would perpetuate a latent bug (Safari showing "use Safari" on its own rare native-decode failures). Tech-lead adopted "native fails → try WASM, regardless of browser" verbatim, and qa's code review confirms `grep -n "userAgent"` finds zero matches in either changed file — there's no UA branch to have gotten wrong. This is the single most consequential Phase 1 note and it shipped clean.
- **The two-message split, with the regression guard I asked for.** `HEIC_DECODE_FAILURE_MESSAGES` in `heic-decode.ts` gives distinct, correctly-worded copy for "chunk-load" vs "decode" that closely tracks the exact language I suggested in Phase 1's gap note, and a dedicated unit test (`heic-decode.test.ts:57`) plus a live e2e assertion (`e2e/receipt-heic-upload.spec.ts:55`) both assert neither message contains "Safari." That's a gap I raised turned into a durable regression guard, not just a one-time fix.
- **The renamed-non-HEIC file case (my Phase 1 note "no test-matrix note for a `.heic`-named file that isn't real HEIC") got a real e2e test with a real fixture** (`not-actually-heic.heic`, plain text renamed), asserting it fails cleanly within ~3s rather than hanging. This is exactly the explicit test-matrix line I said the request's own note deserved.

## Intent-vs-Shipped Diff

- Phase 1 said: WASM retry should fire on any browser's native-decode failure, not gated on Chrome/Firefox UA-sniffing, to also fix Safari's latent "use Safari" bug. Shipped: `isHeicFile(file)` branch with no UA check, confirmed by grep. Verdict: **matches**.
- Phase 1 said: post-WASM failure needs two distinguishable messages, not the old dead-end string reused. Shipped: `HeicDecodeStageError` with `"chunk-load" | "decode"` stages, distinct copy, neither mentioning Safari, both unit- and e2e-tested. Verdict: **matches**.
- Phase 1 said: "Uploading receipt…" is dishonest during WASM fetch+decode; needs a preparing/uploading split. Shipped: `Status` extended to `"idle" | "preparing" | "uploading" | "error"`, `setStatus("uploading")` moved to immediately before the upload `fetch`, hint text three-way switch. Verdict: **matches**.
- Phase 1 said: a `.heic`-named file that isn't real HEIC must fail cleanly, not hang — flagged as needing an explicit test line. Shipped: e2e test 3 with a real renamed-text fixture, asserts the decode message and a ~3s resolution. Verdict: **matches**.
- Phase 1 said: reimbursement upload and profile-picture upload have the identical underlying gap but are out of scope for this increment pending user confirmation — recommend logging to backlog rather than silently leaving broken. Shipped: user's delegation adopted "out of scope," B-08 and B-09 added to `docs/backlog.md` (confirmed present by grep). Verdict: **matches**.
- Phase 1 said: 10 MB cap interaction was already fine, just flagged for awareness (near-cap HEIC is the slowest new-path case). Shipped: cap check unchanged, unaffected by this feature; the preparing/uploading split (above) is the direct answer to the awareness note. Verdict: **matches**.
- Phase 1 flow 3 said: Safari's native-decode happy path must stay untouched — WASM chunk never downloaded. Shipped: code-verified (WASM only reached after a native decode failure; Safari's native path is unaffected by construction), and qa's build-output inspection independently confirms the `heic2any` chunk is absent from every page's eager script list. Not re-verified in an actual Safari browser this cycle (Playwright has no WebKit project configured here, and even a configured one wouldn't reproduce real Safari's OS-level HEIC decode). Verdict: **acceptable drift** — the claim is code-verified and structurally sound, but "must stay unaffected" is a regression claim about a browser nobody actually drove this cycle; see follow-up below.

## Edge Cases

- Empty state: **not applicable** — this feature has no list/collection view; it's a file-input decode path with no empty-state surface.
- Failure microcopy: **pass** — both new messages are plain-language, non-technical, action-oriented ("check your connection and try again, or export the photo as JPEG" / "it may not be a valid HEIC file. Try exporting it as JPEG"), and specifically fix the wrong-context "use Safari" copy bug I flagged in Phase 1's gap analysis. Neither leaks a stack trace or raw error object — confirmed by reading `heic-decode.ts` directly, `classifyHeicDecodeFailure` always resolves to one of exactly two fixed strings, never `err.message`.
- Permission gate: **pass, code-verified, not independently re-run this phase** — qa's feature-gate audit confirms the one server route this component talks to (`POST /api/admin/ledger/transactions/upload`) is untouched by the diff and its pre-existing `auth()` + `hasFeature(..., FEATURES.LEDGER_RECORD)` gate is unmodified. This matches my Phase 1 permissions call exactly (no new `FEATURES` key needed, client-only decode addition). I did not re-drive this as a live click-through since qa's `git diff --stat` evidence that the route file doesn't even appear in the changed-file list is conclusive on its own.
- Mobile (360px): **pass, no regression risk** — the only UI change is hint-text string content (three-way ternary replacing a two-way one) and the `disabled` condition now covering two status values instead of one; no new DOM nodes, no new layout, no class changes to the `<input>` or its wrapper. The existing file input and hint paragraph were already responsive before this feature; string-only copy changes at any of the three lengths ("Preparing photo…", "Uploading receipt…", the unchanged default hint) don't introduce a new wrapping or overflow risk at 360px that the pre-existing hint text didn't already carry.

## Follow-Ups (if SHIP WITH NOTES)

These are the four Phase 3 manual-matrix rows qa explicitly could not automate and correctly did not let block PASS. They are user verification tasks, not code tasks — nothing here should generate a work-log entry of its own unless one of them turns up a real failure, in which case *that* becomes a bug-fix work-log per the bug-fix variant in the pipeline.

- **Row 2 — Chrome, devtools "Offline" throttling, real `.heic` file.** Confirm the `"chunk-load"` message (not the `"decode"` message) appears when the WASM chunk fetch itself is blocked, and that it doesn't mention Safari. The classifier logic is unit-tested; the live network-failure trigger is not.
- **Row 5 — Safari (macOS or iOS), real `.heic` file.** Confirm the native-decode happy path is genuinely unaffected — no WASM chunk requested (check the Network tab), receipt attaches the same as before this feature. This is the row that carries my one "acceptable drift" item above: the no-regression claim for Safari is code-verified but not driven in a real Safari this cycle.
- **Row 7 — Chrome, near-10MB HEIC file.** Confirm "Preparing photo…" is visibly shown for a multi-second span before "Uploading receipt…" appears, i.e., the honest-copy split I asked for in Phase 1 actually reads as honest in practice, not just as two strings that exist in the source.
- **Row 8 — Chrome, rapid double-pick during an in-flight decode.** Confirm the OS file picker genuinely can't be re-invoked while `status` is `"preparing"` or `"uploading"` — the `disabled` prop logic is code-verified but Playwright's `setInputFiles` bypasses the real OS picker, so this needs a real double-click.

Row 6 (JPEG/PNG/PDF regression across browsers) was code-verified as byte-identical to pre-feature code and I don't think it needs a dedicated user check — flagging it only if the user wants a belt-and-suspenders spot-check while already doing rows 2/5/7/8.

## Red Flags (if NEEDS REWORK)

None.
