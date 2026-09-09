# HEIC Receipt Upload Broken by CSP Hardening — Work Log

> **Slug:** `2026-09-09-heic-csp-wasm-regression`
> **Surface:** (dashboard) admin — `/admin/ledger` receipt upload
> **Permission(s):** none new — existing ledger permissions unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped — bug confirmed directly from evidence (see below) | — | 2026-09-09 |
| 2 — Architectural review | architect | Skipped — no invariant changed; CSP posture NARROWED, see note | — | 2026-09-09 |
| 3 — Technical design | tech-lead | Skipped — one-token fix; root cause documented below | — | 2026-09-09 |
| 4 — Implementation | coordinator | Complete | — | 2026-09-09 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Phase skips are deliberate and recorded here per CLAUDE.md** — the root cause was
established by direct evidence (git history + CSP spec behaviour + three failing e2e
tests), not inferred, and the fix is a single CSP token. Phase 5 still runs: the three
`receipt-heic-upload.spec.ts` tests are the reproduction and must flip red → green.

---

## Root Cause

`/admin/ledger` lets the treasurer attach a receipt photo. iPhones shoot HEIC by
default. Chrome and Firefox cannot decode HEIC natively, so DECISION-038 added a
browser-side WASM fallback using `libheif-js/wasm-bundle`, which inlines its WASM as
base64 and instantiates it at runtime.

Commit `4aea4f8` (v1.75.0, 2026-09-04, the site-review overhaul) removed
`'unsafe-eval'` from the CSP `script-src` in `next.config.ts` as security hardening:

```
-  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com …"
+  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com …"
```

Chrome and Firefox refuse to instantiate **any** WebAssembly unless `script-src`
grants `'wasm-unsafe-eval'` or the broader `'unsafe-eval'`. Removing the token
therefore killed the HEIC decoder outright in exactly the browsers that need it.

Nothing in the codebase recorded that the CSP was load-bearing for WASM, so the
dependency was invisible when the CSP was tightened. The v1.75.0 verification pass
checked the homepage for console errors and never exercised the ledger receipt-upload
flow.

**User impact:** any admin uploading a phone photo of a receipt in Chrome or Firefox
since 2026-09-04 got a failure — and the UI misreported it as a *connectivity*
problem, so it would not have been recognised as a decode bug even if reported.

## Reproduction

1. Sign in as an admin in Chrome or Firefox.
2. `/admin/ledger` → record a transaction → attach a real `.heic` receipt photo.
3. The file never reaches "ready to attach"; an error about checking your connection
   appears instead.

Automated: `pnpm test:e2e e2e/receipt-heic-upload.spec.ts` — all three tests fail at
the WASM chunk-load stage. Note that the two tests using deliberately *corrupt* HEIC
fixtures also fail here, which is itself the proof: those should only ever fail later,
at the decode stage. Failing earlier means the WASM module never loaded at all.

## Fix

`next.config.ts` — add `'wasm-unsafe-eval'` to `script-src`, with a comment stating
the dependency so it survives the next hardening pass.

**Deliberately NOT a revert to `'unsafe-eval'`.** `'wasm-unsafe-eval'` permits
WebAssembly compilation only and still forbids `eval()` of JavaScript strings, so
v1.75.0's hardening is preserved while the decoder works again — a strictly narrower
grant than what was there before v1.75.0.

Browser support is adequate for the browsers that need it: Chrome 97+, Firefox 102+.
Safari ignores the token in older versions but has native HEIC decode, so it never
reaches the WASM fallback.

## Follow-Ups

- The failure surfaces to the user as a connectivity message when the real cause is a
  blocked WASM instantiation. That microcopy is misleading for any non-network decode
  failure and deserves its own fix.
- Discovered via the 2026-09-09 test-coverage review
  (`docs/reviews/2026-09-09-test-coverage.md`), which existed only because the e2e
  suite had gone unrun for ~76 days. The suite caught a real production regression
  five days after it shipped; the gap was the cadence, not the coverage.
