# HEIC Decode Fails on Modern iPhone Photos — Work Log (Bug-Fix Variant)

> **Slug:** `2026-07-21-heic-modern-iphone-decode`
> **Surface:** (dashboard) admin — Ledger receipt upload
> **Permission(s):** unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (defect in v1.33.0's `receipt-heic-wasm-fallback`)

## Phase 1 — Bug Confirmation (evidence gathered by orchestrator; analyst phase folded in)

**Reported:** Minutes after the v1.33.0 deploy, the user's real receipt photo
(desktop Chrome) hit "This photo couldn't be converted — it may not be a valid
HEIC file. Try exporting it as JPEG." — and "came back fast."

**Reproduction (confirmed):** `~/Downloads/IMG_3755.HEIC` (2.7 MB, 5712×4284 —
a 48 MP, 10-bit, HDR gain-map iPhone photo; ftyp brands `heic` +
`mif1 MiHB MiHA heix MiHE MiPr miaf tmap`) driven through the actual receipt
input via a temporary Playwright spec: decode-stage failure in **201 ms**, page
console shows libheif's underlying error: `Could not parse HEIF file`.

**Root cause (one line):** `heic2any@0.0.4` (unmaintained since ~2021) embeds a
libheif build that predates modern iPhone HEIC variants (10-bit `heix`, HDR
gain-map `tmap`), so it rejects exactly the files the feature was built for;
the v1.33.0 e2e fixture (an older-format HEIC from heic2any's own demo assets)
decodes fine, which is why every gate passed.

**Not the cause (ruled out empirically):** production-bundle UMD interop (the
full HEIC e2e suite passes against `pnpm build:only` + `next start`), CSP
(unconditional, identical dev/prod), our stage classification (correct — the
decode stage genuinely failed).

**Fix direction (verified before design):** `libheif-js@1.19.8` (current
libheif line, actively maintained) decodes IMG_3755.HEIC in Node in ~766 ms
with correct dimensions and non-blank pixel data. Swap the decoder dependency;
API differs (raw RGBA out, needs canvas glue to JPEG) — amend DECISION-038.

## Phase 2 — Architectural Review (architect)

**Verdict: Approved.** Swap `heic2any` for `libheif-js@1.19.8`, imported at the
`libheif-js/wasm-bundle` subpath, decode on the main thread for now, remove
`heic2any` outright (no dual-decoder fallback). Full ruling below; see
DECISION-039 for the decision-log entry.

### 1. Entry point: `libheif-js/wasm-bundle`

Unpacked the real npm tarball into a scratch install
(`scratchpad/heif-test`, `libheif-js@1.19.8`) rather than trusting the
README, and inspected all three shipped entry points:

| Entry | Resolves to | Size (raw / gzip) | WASM delivery |
|---|---|---|---|
| `libheif-js` (default) | `libheif/libheif.js` | 2.1 MB / — | "classic pure-JS" build (largest, back-compat path, not the one we want) |
| `libheif-js/wasm` | `libheif-wasm/libheif.js` + `.wasm` | 80 KB + 1.0 MB | **split asset** — glue does `fs.readFileSync('./libheif-wasm/libheif.wasm')`, Node-only; README says "you are on your own" bundling this |
| **`libheif-js/wasm-bundle`** | `libheif-wasm/libheif-bundle.js` | **1.4 MB / ~521 KB gzip** | **base64-inlined in the JS**, same Emscripten inlining pattern `heic2any` used |

Confirmed by grep that `libheif-bundle.js` embeds the WASM as a base64
string (no `wasmBinaryFile` fetch reference) — same "no separate asset,
no CSP change" property that made `heic2any` viable under DECISION-038.
The split `wasm` entry is disqualified outright: it's a Node-`fs` pattern,
not a browser one, and would need real asset-pipeline/webpack config this
project doesn't have. `package.json` has no `"exports"` map, so the
`libheif-js/wasm-bundle` subpath resolves under Next.js's bundler via
plain Node module resolution — confirmed by requiring it directly in the
scratch install and in a standalone script.

**Size delta vs. heic2any:** 1.4 MB raw / ~521 KB gzip vs. heic2any's
1.3 MB raw / ~343 KB gzip — a modest ~180 KB gzip increase. Still a single
lazy `import()`-only async chunk gated identically (only after a native
`createImageBitmap()` failure on a HEIC file; Safari and every successful
native-decode path never fetch it). Acceptable — no invariant changes.

**No `next.config.ts` change.** Verified directly: the existing CSP
(`script-src ... 'unsafe-eval' ...`) already permits Emscripten's
eval-based WASM instantiation, and there's no separate `.wasm` URL to
allow-list. `worker-src 'self' blob:` becomes unused by this path (see
§2) but there's no reason to remove it — out of scope for this fix.

### 2. Worker: main-thread decode, ship now; Worker wrapper deferred

`libheif-js`'s bundle runs decode on the calling thread — no internal
Worker (unlike `heic2any`, which spun up its own Blob-backed Worker
internally). Independently re-verified against the user's real
`IMG_3755.HEIC` (48 MP, 10-bit `heix` + `tmap`) with a script run in this
scratch install: **787 ms** wall-clock decode (`decoder.decode()` +
`image.display()`), RGBA out (`bytesPerPixel: 4`), non-blank pixel
samples — consistent with the previously reported ~766 ms Node figure and
confirming the API shape independently.

**Ruling: main-thread decode is acceptable for this admin flow, ship it.**
The receipt upload UI already shows a "Preparing photo…" state and
disables the file input during decode (existing behavior from
`receipt-heic-wasm-fallback`), so ~0.8 s of main-thread block reads as
"a beat longer than usual," not a freeze — this is an authenticated
treasurer uploading a receipt photo occasionally, not a public,
high-frequency, or latency-sensitive path. A Worker wrapper would add
real complexity (structured-clone the File across the boundary, or
transfer the ArrayBuffer; marshal the RGBA buffer back) for a UX
improvement that isn't needed yet.

**Backlog, not blocking:** if decode times grow (higher-megapixel
sensors, larger HDR variants) or this starts contending with other
main-thread work during upload, revisit wrapping `decodeHeicFileToJpegBlob`
in a dedicated Worker. Not filed as a `B-nn` backlog item by this phase —
noted here for the implementer/qa to flag forward if it resurfaces.

### 3. License / provenance

- `libheif-js`'s own `package.json` now declares `"license": "LGPL-3.0"`
  directly (one level stricter than `heic2any`'s MIT-wrapper-around-LGPL
  shape — the wrapper code itself is LGPL-3.0 here, not MIT). The embedded
  compiled `libheif` is LGPL-3.0 either way; both packages have carried
  the same underlying LGPL-3.0 `libheif` binary. DECISION-038's
  acceptability reasoning (unmodified npm consumption, not
  modify-and-redistribute; client-side, decode-only; small nonprofit's
  internal admin tool used by an authenticated treasurer on a receipt
  they already possess; not a commercial product, not redistributed as a
  standalone artifact) applies unchanged to a slightly-stricter-but-same-
  family license. Judged acceptable on the same basis.
- **Zero transitive runtime dependencies** — confirmed by inspecting the
  installed `package.json`: no `"dependencies"` key at all. Matches (does
  not regress) `heic2any`'s zero-dep property, and is strictly better than
  the `heic-decode` candidate DECISION-038 rejected partly for carrying
  `libheif-js` as a transitive dependency (we're now taking it directly
  instead, one hop shorter).
- **Maintenance:** last published version `1.19.8` on 2025-06-12 (per npm
  registry metadata), steady version history back to 2020
  (`catdad-experiments/libheif-js`), and the README documents an explicit
  policy of tracking upstream `libheif`'s major/minor. Actively
  maintained, unlike `heic2any` (unmaintained since ~2021, confirmed no
  newer release exists).

### 4. Glue seam: RGBA→JPEG lives inside `heic-decode.ts`, not `image-resize.ts`

Confirmed: `src/lib/heic-decode.ts` keeps its exact public contract —
`decodeHeicFileToJpegBlob(file: File): Promise<Blob>`,
`HeicDecodeStageError`, stages `"chunk-load"` / `"decode"`,
`classifyHeicDecodeFailure`, `HEIC_DECODE_FAILURE_MESSAGES` all unchanged.
`receipt-file-input.tsx` needs **zero changes**.

The new RGBA→JPEG canvas encode step (`libheif-js` hands back raw pixel
data via `image.display()`, not a Blob) belongs **inside
`heic-decode.ts`**, not in `image-resize.ts` and not in the component.
Rationale: `image-resize.ts` owns *resizing* an already-decoded image
(canvas-based downscale of an existing bitmap/Blob) — that's a different
concern from *encoding a raw pixel buffer produced by a specific decoder*.
Folding the RGBA→JPEG step into `image-resize.ts` would leak a
decoder-specific data shape (raw `Uint8ClampedArray` + width/height) into
a module that otherwise only ever sees images/Blobs, and would break the
"resize an already-valid image" contract that module's callers rely on.
Keeping it in `heic-decode.ts` preserves the module's job description
exactly as already documented: "give me a JPEG Blob from a HEIC File,"
full stop — the caller still runs the result back through the existing
`resizeImage()` pipeline afterward, unchanged, same as it did with
`heic2any`'s output.

### 5. Removal of `heic2any`: yes, outright, no fallback

Remove `heic2any` from `package.json` entirely. No dual-decoder chain.
Its only advantage was packaging convenience (JPEG Blob out directly),
which is now replicated as glue inside `heic-decode.ts`; keeping both
would mean shipping two separate WASM `libheif` builds (defeats the
bundle-size discipline this whole review is about), two license postures
to track going forward, and directly contradicts the reason this bug-fix
exists — `heic2any` is confirmed, reproducibly, unable to decode the
exact class of file (modern 10-bit/HDR-gain-map iPhone HEIC) this feature
was built to support. A try-`heic2any`-then-`libheif-js` fallback would
double the download on every failure path and add stage-classification
ambiguity for no verified benefit — `libheif-js` is a strict superset,
capability-wise, per the reproduction in Phase 1.

## Phase 3 — Technical Design

_(brief; folded into architect/implementer handoff — bug-fix variant, per
CLAUDE.md's Bug-Fix Variant table. Control flow in
`decodeHeicFileToJpegBlob` is unchanged — try/catch around module load
classifies `"chunk-load"`, try/catch around the actual decode classifies
`"decode"` — only the decoder call and a new RGBA→JPEG glue step change.)_

**Implementation sketch for the implementer (api-developer or
full-stack-developer — this is a client-only `src/lib` module, no
server/schema surface, so either fits; pick full-stack-developer given
the total diff is small):**

1. `package.json`: remove `"heic2any"`, add `"libheif-js": "^1.19.8"`.
2. `src/lib/heic-decode.ts`:
   - Replace `import("heic2any")` with `import("libheif-js/wasm-bundle")`.
     The required module's `module.exports` is already the *invocation
     result* of the internal factory (`require(...)()`), which resolves
     to a Promise of the `libheif` namespace (`{ HeifDecoder, ... }`) —
     confirmed directly: `const mod = await import(...); const inner =
     (mod as any).default ?? mod; const libheif = await inner;`. Replace
     `resolveHeic2AnyExport` with an equivalent two-step unwrap helper
     (interop unwrap is sync/pure and testable without WASM; the `await`
     of the resulting promise is the one untestable-without-a-browser
     seam, same split as before). Wrap the whole load+unwrap+await in the
     existing `"chunk-load"` try/catch.
   - Inside the existing `"decode"` try/catch: `new
     Uint8Array(await file.arrayBuffer())` → `decoder.decode(bytes)` →
     take `images[0]`; if `images.length === 0`, throw
     `HeicDecodeStageError("decode")` (same "decoder returned no image"
     case as today, now checked before `.display()` instead of after a
     Blob-array check).
   - New step, still inside the `"decode"` try/catch: build `{ data: new
     Uint8ClampedArray(width*height*4), width, height }`, call
     `image.display(imageData, callback)` (Promise-wrap it — callback
     fires with `false`/`undefined` on failure per the library's own
     documented usage), then draw to a `document.createElement("canvas")`
     (sized `width`×`height`) via `putImageData`, and
     `canvas.toBlob(cb, "image/jpeg", RECEIPT_IMAGE_JPEG_QUALITY)`
     Promise-wrapped to produce the returned JPEG `Blob`. Any failure in
     this chain still throws `HeicDecodeStageError("decode")` — it's all
     part of "turn HEIC bytes into a JPEG Blob."
   - Doc comment at the top of the file: update to describe `libheif-js`
     instead of `heic2any`, and note the new RGBA→JPEG canvas step.
3. No changes to `receipt-file-input.tsx`, `image-resize.ts`, or any
   route/schema/permission surface.

**Unit-test deltas for `heic-decode.test.ts` (implementer writes these,
not qa, per the Phase 4 gate):**
- Rename the `vi.mock` target from `"heic2any"` to
  `"libheif-js/wasm-bundle"`.
- Replace the `resolveHeic2AnyExport` test block with tests for the new
  unwrap helper, covering: (a) ESM-shaped export (`{ default: <promise or
  namespace> }`), (b) bare-namespace/bare-promise interop shape (no
  `.default`) — mirrors the two cases already covered for `heic2any`.
- New coverage for the decode path using a mocked `libheif.HeifDecoder`
  (mock `decode()` returning a fake image object exposing `get_width` /
  `get_height` / `display`): (a) happy path calls `image.display()` with
  a correctly-shaped `{ data, width, height }` object and the module
  returns a `Blob`; (b) `decode()` returning an empty array throws
  `HeicDecodeStageError("decode")`; (c) `display()`'s callback firing with
  a falsy value throws `HeicDecodeStageError("decode")`.
- Keep unchanged: `classifyHeicDecodeFailure` tests, message-lookup tests,
  `"chunk-load"` failure test (import rejects).
- Canvas/`toBlob` isn't available in Vitest's Node environment — mock
  `document.createElement`/canvas 2D context the same lightweight way
  DOM-only seams are already isolated elsewhere in this module, or accept
  that the final `canvas.toBlob` encode step is covered by qa's Phase 5
  manual click-through (real HEIC fixture, real browser) rather than a
  jsdom-mocked unit test — either is fine as long as the decode-stage
  control flow (mock `HeifDecoder`) has unit coverage.
- Reminder carried from Phase 1: the user's real photo must not be
  committed as a fixture. Existing small HEIC fixtures
  (`scratchpad/heic-fixtures/*.heic`, or equivalent committed test
  fixtures) exercise wiring; real-format coverage of the *original bug*
  (10-bit `heix` + `tmap`) is a qa/Phase 5 concern already flagged in this
  work-log, not this phase's job to solve.

## Phase 4 — Implementation

**Owner:** ux-developer
**Status:** complete

### Summary

Swapped the receipt-upload HEIC decoder from `heic2any` to `libheif-js@1.19.8`
(`libheif-js/wasm-bundle` subpath) per the architect's Phase 2 ruling and
DECISION-039. `decodeHeicFileToJpegBlob`'s public contract, stage
classification, and error copy are byte-for-byte unchanged;
`receipt-file-input.tsx` required zero edits, confirmed by `git status`.
Verified against the production build and, critically, against the user's
real defect-triggering photo (`IMG_3755.HEIC`, 48 MP, 10-bit `heix` + HDR
gain-map `tmap`) driven through the actual UI — decodes and reaches "ready
to attach" in ~1 second.

### What I did

- `pnpm remove heic2any && pnpm add libheif-js@^1.19.8`.
- Rewrote `src/lib/heic-decode.ts`'s decoder internals:
  - `resolveHeic2AnyExport` → `resolveLibheifModule`: unwraps
    `import("libheif-js/wasm-bundle")`'s `.default` (or the bare module),
    then handles both "already a Promise" and "bare factory function"
    interop shapes before awaiting — verified against the real 1.19.8
    tarball, whose `module.exports = require('./libheif-wasm/libheif-
    bundle.js')()` resolves to a Promise (the factory-function branch is a
    defensive fallback for other bundler interop shapes, not something the
    real package exercises today).
  - Decode stage: `new libheif.HeifDecoder()` →
    `decoder.decode(new Uint8Array(await file.arrayBuffer()))` → take
    `images[0]` (first image of a multi-image container); `images.length
    === 0` still throws `HeicDecodeStageError("decode")`, same case as
    before, just checked earlier in the flow.
  - New RGBA→JPEG glue, still inside the "decode" try/catch: get a 2D
    canvas context sized to the image, `ctx.createImageData(width,
    height)`, Promise-wrap the callback-based `image.display(imageData,
    cb)` (falsy callback result → decode-stage failure), `ctx.putImageData`,
    then `canvas.toBlob("image/jpeg", RECEIPT_IMAGE_JPEG_QUALITY)`
    Promise-wrapped to produce the returned Blob.
  - Every image handle `decoder.decode()` returns (not just the one used)
    is freed via `image.free?.()` in a `finally` — confirmed `HeifImage`
    exposes `free()` by reading the unminified property name
    (`Q.prototype.free=function(){this.handle&&(r.heif_image_handle_release
    (this.handle),this.handle=null)}`) directly out of the shipped
    `libheif-bundle.js`, not the README.
  - Doc comment at the top rewritten for `libheif-js` + the new canvas step.
- `src/types/libheif-js-wasm-bundle.d.ts` (new): minimal ambient module
  declaration for `libheif-js/wasm-bundle` (`HeifDecoder`, `HeifImage`,
  the `display()` callback shape) — the package has no `"exports"` map or
  `"types"` field pointing bundler-style subpath imports at its own
  `libheif-wasm/libheif.d.ts` (which only covers the low-level Emscripten
  `_heif_*` cwrap bindings anyway, not the `HeifDecoder`/`HeifImage`
  wrapper classes actually used). Shape confirmed against the real bundled
  JS in the scratch install, not the README.
- `src/lib/heic-decode.test.ts`: renamed the `vi.mock` target to
  `"libheif-js/wasm-bundle"`; replaced the UMD-unwrap tests with
  `resolveLibheifModule` tests (ESM-shaped `{default: Promise}`, bare
  namespace, bare-factory-function); added decode-path coverage with a
  mocked `HeifDecoder`/`HeifImage` covering: empty-array → "decode" error,
  multi-image container (first image's `display()` called, both handles
  freed), correctly-shaped `{data, width, height}` target passed to
  `display()`, falsy `display()` callback → "decode" error, and
  `decoder.decode()` throwing synchronously → "decode" error. Kept the
  classifier/message-lookup/`HeicDecodeStageError`/"chunk-load" tests
  unchanged. The canvas encode step (`encodeRgbaToJpegBlob`) is
  deliberately NOT unit-tested — canvas isn't available in Vitest's Node
  environment (`environment: "node"` in vitest.config.ts, no jsdom) — its
  real-canvas behavior is covered by the e2e run below instead, per the
  Phase 3 sketch's explicit either/or.
  - One implementation wrinkle not in the sketch: mocked `HeifDecoder`
    constructors must use `vi.fn().mockImplementation(function () {...})`
    (a real `function`, not an arrow) — `decodeHeicFileToJpegBlob` calls
    `new libheif.HeifDecoder()`, and Vitest silently drops an arrow-function
    mock implementation's return value on `new` (logs a warning, returns an
    empty object), which surfaced as two failing tests before the fix.
- `e2e/receipt-heic-upload.spec.ts`: updated the top-of-file and
  corrupt-file-test comments to describe `libheif-js` instead of
  `heic2any` as the decoder behind the WASM fallback path; left the
  fixtures-provenance list and all assertions untouched (fixtures are
  unchanged and still pass).
- No changes to `receipt-file-input.tsx`, `image-resize.ts`, or any
  route/schema/permission surface — confirmed via `git status`.

### Outputs

- `package.json` / `pnpm-lock.yaml` — `heic2any` removed, `libheif-js@^1.19.8` added.
- `src/lib/heic-decode.ts` — decoder swap + RGBA→JPEG canvas glue.
- `src/lib/heic-decode.test.ts` — updated/expanded unit coverage (18 tests in this file; 450 total in the suite).
- `src/types/libheif-js-wasm-bundle.d.ts` — new ambient type declaration.
- `e2e/receipt-heic-upload.spec.ts` — comment updates only, no assertion changes.
- `e2e/tmp-repro-img3755.spec.ts` — untracked temporary repro spec, left in place for qa per instructions; not committed.

### Gate results (in order)

1. `pnpm exec tsc --noEmit` — clean, no errors.
2. `pnpm test` — **450/450 passed** (14 test files).
3. `pnpm build:only` — production build succeeded (Turbopack). Chunk
   evidence:
   - The WASM-bearing async chunk is `.next/static/chunks/0ixch5jwoq1r_.js`
     — **1,424.8 KB raw / ~506.5 KB gzip**, contains the inlined base64
     WASM payload (verified via the `AGFzbQ` WASM magic-number base64
     prefix), and appears **zero times** in `.next/build-manifest.json`'s
     eager script lists (grepped every chunk filename against the
     manifest — 0 matches for all three HEIC-related client chunks).
     Matches DECISION-039's ~1.4 MB raw / ~521 KB gzip estimate closely.
   - Two smaller per-page chunks (`0w3cdza0l0pe5.js` ~66 KB,
     `13dm7pqruqjm-.js` ~25 KB) also reference `HeifDecoder` as a property
     name (from `heic-decode.ts`'s own code, bundled per-page alongside
     unrelated Radix `AlertDialog` code) but contain **no** inlined WASM
     (`AGFzbQ` absent) — confirming the actual 1.4 MB payload is isolated
     to its own async chunk, not duplicated per page.
   - This repo builds with Next 16's Turbopack by default; there is no
     `app-build-manifest.json` (Webpack-era artifact) — eager-vs-lazy was
     confirmed against `.next/build-manifest.json` instead, which still
     enumerates every page's eagerly-loaded scripts under Turbopack.
4. **Production server + e2e (the gate missed in v1.33.0):**
   - `pnpm exec dotenv -e .env.local -- pnpm exec next start` on port 3000
     (confirmed free beforehand), served HTTP 200.
   - `pnpm test:e2e -- e2e/receipt-heic-upload.spec.ts --workers=1` against
     that production server: **3/3 passed** (Chrome WASM happy path,
     corrupt-file decode error, non-HEIC-content `.heic`-named file decode
     error) — all against the real production bundle, not dev.
   - `pnpm test:e2e -- e2e/tmp-repro-img3755.spec.ts --workers=1` against
     the same production server, driving the user's actual
     `~/Downloads/IMG_3755.HEIC` through the real UI:
     **`OUTCOME=SUCCESS elapsedMs=1023`** — the receipt reached "ready to
     attach". (Page console showed only pre-existing, unrelated Google
     Fonts CSP warnings — no HEIC-decode errors.) This is the actual
     defect artifact from Phase 1; it now succeeds.
   - Production server killed afterward; port 3000 confirmed free again.
5. No `console.log` in `heic-decode.ts`. No native dialogs (none were ever
   in scope for this module). No changes to migrations, schema, or auth/
   permission surfaces — this is a client-only `src/lib` module swap.

### Divergence from the Phase 3 sketch

- **Canvas target construction:** the sketch describes building the RGBA
  target as a raw `{ data: new Uint8ClampedArray(...), width, height }`
  object passed directly to `image.display()`. Implemented instead via
  `ctx.createImageData(width, height)` (matching libheif-js's own README
  browser example) so the same object can be handed straight to
  `ctx.putImageData()` afterward without a second allocation, and so the
  unit-test mock for `display()`'s target only needs to match a
  `{data, width, height}` shape either way — behaviorally identical, no
  contract change.
- **Freed all decoded image handles, not just the used one:** the sketch
  only mentions freeing "if the API exposes free()" without specifying
  scope; implemented as freeing every `HeifImage` `decoder.decode()`
  returns (multi-image containers can return several), not just
  `images[0]`, to avoid leaking WASM-side memory for burst-shot HEIC
  files. Covered by a dedicated unit test.
- **Mock construction style:** the sketch didn't anticipate the
  arrow-function-vs-`new` Vitest pitfall noted above; documented inline in
  the test file's header comment for future maintainers.
- Everything else (entry point, trigger condition, stage-error contract,
  removal of `heic2any` outright, glue location inside `heic-decode.ts`)
  matches the sketch and DECISION-039 as written.

### Open questions / handoff notes

- **Next: qa (Phase 5).** Suggested click-through beyond the gates already
  run: `/admin/ledger/all` → Record Transaction → Expense → attach a HEIC
  receipt in Chrome, confirm "Preparing photo…" appears then the receipt
  shows "ready to attach"; also spot-check that a non-HEIC image (JPEG/PNG)
  upload still works unaffected (it never touches this module).
- `e2e/tmp-repro-img3755.spec.ts` is left in place, untracked, per
  instructions — it depends on `~/Downloads/IMG_3755.HEIC` existing
  locally and will fail/hang on any machine without that file. qa should
  either delete it once satisfied or confirm it stays gitignored-by-absence
  (it's untracked, `git status` shows it as `??`, so a stray `git add -A`
  would pick it up — worth a reminder not to commit it or the photo).
- No new user-facing copy — all four `HEIC_DECODE_FAILURE_MESSAGES` /
  success-state strings are byte-identical to before the swap.
- Backlog reminder carried from Phase 2 (not blocking, not filed as a
  `B-nn` item): main-thread decode is intentional for now; revisit a
  Worker wrapper if decode times grow or start contending with other
  main-thread work during upload.

## Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All gates re-run independently (not trusted from Phase
4's report). The pre-fix baseline — `heic2any` failing on the user's real
`IMG_3755.HEIC` in 201 ms with `Could not parse HEIF file` (Phase 1 of
this work-log) — is cited, not re-reproduced (the working tree was not
reverted). Post-fix, the same file decodes successfully in ~1.0–1.5 s
against both a production build and the dev server, driven through the
actual admin UI. Typecheck, unit tests (450/450), and production build
all pass; `heic2any` is fully gone from `package.json`,
`pnpm-lock.yaml`, and all source (only historical doc references and
in-code comments describing the swap remain). One pre-existing,
unrelated e2e flake surfaced in the full suite and was confirmed to pass
in isolation — not a regression from this change.

### What I did

1. **Diff review.** Read `src/lib/heic-decode.ts`,
   `src/lib/heic-decode.test.ts`, `src/types/libheif-js-wasm-bundle.d.ts`,
   the `package.json`/`pnpm-lock.yaml` diff, the `e2e/receipt-heic-upload.spec.ts`
   comment-only diff, and `docs/decisions.md`'s new DECISION-039 entry
   against the architect's Phase 2 ruling. Confirmed: public contract of
   `decodeHeicFileToJpegBlob` unchanged (`Promise<Blob>` signature,
   `HeicDecodeStageError`, stages `"chunk-load"`/`"decode"`,
   `classifyHeicDecodeFailure`, `HEIC_DECODE_FAILURE_MESSAGES` byte-for-byte
   identical); `receipt-file-input.tsx` and `image-resize.ts` untouched
   (`git status --porcelain` shows neither); every decoded `HeifImage`
   handle is freed in a `finally` (not just the used one); no
   `console.log`; no native dialogs; the ambient `.d.ts` types match what
   Phase 4 verified against the real tarball (not the README).
2. **Typecheck.** `pnpm exec tsc --noEmit` — clean.
3. **Unit tests.** `pnpm test` — **450/450 passed**, 14 files, 301 ms.
4. **Grep sweep.** `grep -ri heic2any package.json pnpm-lock.yaml` — zero
   hits. `grep -ril heic2any src/ e2e/` — hits only in
   `src/lib/heic-decode.ts` and `e2e/receipt-heic-upload.spec.ts`, both
   historical/comment references describing the swap (verified by
   reading the surrounding lines), not live imports or dependency
   entries.
5. **Production build.** `rm -rf .next && pnpm build:only` — succeeded
   (Turbopack). Verified the chunk evidence independently rather than
   trusting Phase 4's numbers:
   - `grep -rl "HeifDecoder" .next/static/chunks/*.js` found three
     chunks. Only `0ixch5jwoq1r_.js` (1.4 MB) contains the WASM magic-number
     base64 prefix (`AGFzbQ`); the other two (`0w3cdza0l0pe5.js` ~68 KB,
     `13dm7pqruqjm-.js` ~28 KB) reference `HeifDecoder` as a bundled
     property name only, no inlined WASM — matches Phase 4's claim that
     the 1.4 MB payload isn't duplicated per page.
   - None of the three chunk filenames appear anywhere in
     `.next/build-manifest.json` (`grep -c <chunk> .next/build-manifest.json`
     → 0 for all three) — confirms the WASM-bearing chunk is lazy-loaded,
     not eagerly shipped to every page load.
6. **Production-server runtime verification (the gate v1.33.0 missed).**
   - Confirmed port 3000 free, started
     `pnpm exec dotenv -e .env.local -- pnpm exec next start -p 3000` in
     the background, confirmed HTTP 200 on `/`.
   - `pnpm exec dotenv -e .env.local -- pnpm exec playwright test
     e2e/receipt-heic-upload.spec.ts --workers=1` → **3/3 passed** (real
     serialized run — the `pnpm test:e2e --` wrapper's arg-forwarding
     swallowed `--workers=1` on a first attempt, confirmed by the "using 3
     workers" header on that run; re-ran via the direct `playwright test`
     binary to get genuine `--workers=1`, confirmed by "using 1 worker" in
     the output).
   - `pnpm exec dotenv -e .env.local -- pnpm exec playwright test
     e2e/tmp-repro-img3755.spec.ts --workers=1` against the same
     production server, driving the user's actual
     `~/Downloads/IMG_3755.HEIC` through the real admin UI:
     **`OUTCOME=SUCCESS elapsedMs=1019`**. Page console showed only the
     pre-existing, unrelated Google Fonts CSP warning — no HEIC-decode
     errors. This is the exact artifact that failed in Phase 1's
     baseline; confirmed independently (not re-trusting Phase 4's number)
     that it now succeeds.
   - Killed the production server; confirmed port 3000 free again.
7. **Full e2e suite against the dev server** (the normal gate, per
   CLAUDE.md's verification stack). Started `pnpm dev`, confirmed HTTP
   200, ran `pnpm test:e2e`: **31 tests, 28 passed, 1 failed, 1 skipped, 1
   did not run.** All four HEIC-related tests in this run passed (3/3 in
   `receipt-heic-upload.spec.ts` + the tmp repro spec, `OUTCOME=SUCCESS
   elapsedMs=1508`). The one failure —
   `recurring-signup-rollup.spec.ts:203` ("cancelled occurrence excluded
   from list count and detail rollup header") — is unrelated to this
   change (a different module, RSVP rollup counts, no HEIC/decode/upload
   surface). Re-ran `e2e/recurring-signup-rollup.spec.ts --workers=1` in
   isolation: **4/4 passed**, confirming a shared-fixture flake under
   parallel workers, not a regression introduced by the decoder swap.
   Killed the dev server (and a lingering `next-server` child process
   still holding port 3000) afterward; confirmed port free.
8. **Cleanup.** Deleted `e2e/tmp-repro-img3755.spec.ts` (untracked,
   referenced the user's personal file path — must never be committed).
   Confirmed `git status --porcelain` shows only the intended changed/new
   files, no strays.

### Outputs

- No test files added — Phase 4's unit-test deltas
  (`src/lib/heic-decode.test.ts`) already cover the decode-stage control
  flow with a mocked `HeifDecoder`/`HeifImage` (empty-array, multi-image
  first-image selection + handle-freeing, correctly-shaped `display()`
  target, falsy display callback, `decode()` throwing synchronously) per
  the Phase 3 sketch; qa's job here was to verify that coverage is real
  (read, not inferred) and to close the one gap Phase 3 explicitly
  deferred to qa — real-canvas, real-WASM behavior in an actual browser
  — via the e2e runs above.
- `e2e/tmp-repro-img3755.spec.ts` — deleted (was untracked, temporary,
  user-machine-specific; served its purpose confirming the real-photo
  fix twice: once against the production server, once inside the full
  dev-server e2e run).
- `docs/work-log/2026-07-21-heic-modern-iphone-decode.md` — this Phase 5
  section appended.

### Gate results (summary)

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `pnpm test`: **PASS** — 450/450, 14 files, 301 ms.
- `pnpm build:only`: **PASS** — WASM chunk (`0ixch5jwoq1r_.js`, 1.4 MB
  raw, contains `AGFzbQ`) absent from all `build-manifest.json` eager
  lists; two smaller chunks reference `HeifDecoder` as a symbol but carry
  no inlined WASM.
- Production server + targeted e2e: **PASS** — `receipt-heic-upload.spec.ts`
  3/3 (serialized, `--workers=1`), real-photo repro `OUTCOME=SUCCESS
  elapsedMs=1019`.
- Full e2e suite (dev server): **PASS with known flake** — 28/31 passed,
  1 failed (`recurring-signup-rollup.spec.ts:203`, confirmed pre-existing
  shared-fixture flake, 4/4 in isolation), 1 skipped, 1 did-not-run
  (Playwright's own cascade behavior after the one failure in that spec
  file — not a second independent failure). No HEIC-related test failed
  in either the full run or isolation.
- `heic2any` fully removed: zero hits in `package.json`,
  `pnpm-lock.yaml`; source hits are historical/comment-only, verified by
  reading context.
- Feature-gate audit: **no protected routes touched.** This bug fix is
  confined to a client-only `src/lib` module
  (`decodeHeicFileToJpegBlob`'s decoder internals) plus its ambient type
  declaration; no route handler, server action, schema, or `FEATURES`
  key changed. The existing admin-ledger-receipt-upload permission
  surface this module sits behind was established (and already audited)
  under `docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md`.

### Regression coverage carried by this fix

- The 10-bit `heix` + HDR gain-map `tmap` failure class itself has no
  *committed* unit-test fixture (per Phase 3's explicit ruling — the
  user's real photo must not be committed, and no small representative
  fixture of that exact format was produced this round). Real-format
  coverage lives in the manual/e2e verification above, re-run twice
  today (production server + full dev-server suite), both against the
  actual defect artifact. Flagging forward per Phase 3's own note: if a
  small, non-personal fixture exhibiting the same `heix`/`tmap` container
  shape becomes available later, it should be added to
  `e2e/fixtures/heic/` and wired into `receipt-heic-upload.spec.ts` as a
  committed regression test — today's verification is real but
  machine-dependent (needs the user's `~/Downloads/IMG_3755.HEIC` to
  exist), not repeatable in CI.

### Open questions / handoff notes

- **Next: analyst for Phase 6.** Suggested framing for the shipped-vs-intent
  check: does the user's real photo now upload successfully in their own
  browser? qa's automated + production-server verification against that
  exact file both say yes, but Phase 1's bug report came from the user
  directly, so a quick user-side confirmation in an actual Chrome tab
  closes the loop cleanly.
- Backlog reminder carried from Phase 2/4 (not blocking, not a `B-nn`
  item): main-thread decode is intentional for now; revisit a Worker
  wrapper if decode times grow or start contending with other
  main-thread work during upload.
- CI-repeatability gap noted above: today's real-format verification
  depends on a file that only exists on this machine. Worth a follow-up
  decision (own work item, not this one) on whether to source or
  synthesize a small non-personal `heix`/`tmap` fixture for permanent CI
  coverage.

## Phase 6 — Shipped vs Intent

**Explicit notation (bug-fix variant, no silent skip):** the analyst phase here
is user confirmation that the bug no longer manifests — the defect was reported
by the user against production with their own photo, and the fix was verified
against that exact photo (`OUTCOME=SUCCESS`, ~1.0–1.5 s, three independent
runs across Phase 4 and Phase 5, production and dev builds). Closing condition:
user retries the same photo on production after the v1.33.1 deploy. If it
fails there, this work-log reopens at Phase 4.

**Follow-up flagged by qa (not blocking):** real modern-format HEIC coverage
currently depends on the user's personal photo, which exists only on this
machine and must never be committed — a small non-personal `heix`/`tmap`
fixture should be sourced or generated so CI can cover this class of file.
Logged to `docs/backlog.md` as B-10.
