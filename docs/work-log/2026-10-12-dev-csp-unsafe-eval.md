# Dev-only CSP: allow eval() under `next dev` — Work Log

> **Slug:** `2026-10-12-dev-csp-unsafe-eval`
> **Surface:** development only (no production change)
> **Permission(s):** none
> **Estimated complexity:** trivial
> **Pipeline mode:** Bug-fix variant; Phases 1-3 and 6 skipped (one-line config change, dev-only), Phase 4 by the orchestrator, Phase 5 by the orchestrator's checks below

## Root cause

The user saw on every localhost page: "eval() is not supported in this environment. If this page was served with a `Content-Security-Policy` header, make sure that `unsafe-eval` is included. React requires eval() in development mode for various debugging features like reconstructing callstacks". The CSP in `next.config.ts` grants `'wasm-unsafe-eval'` only (v1.75.0 hardening, kept on purpose). React's dev tooling needs `'unsafe-eval'`; production React never calls eval().

## Fix

`script-src` gains `'unsafe-eval'` only when `process.env.NODE_ENV === "development"` (that is, under `next dev`). The production header is byte-for-byte unchanged. The comment block above the directive explains both tokens.

## Reproduction

Run `pnpm dev`, open any page, note the red "1 Issue" badge with the eval message. After the fix (the dev server restarts itself on a `next.config.ts` change) the header carries the token and the badge no longer shows this error.

## Checks

Recorded by the orchestrator below.

- `tsc` clean; `pnpm lint` 0 errors (the pre-existing warning); `pnpm build:only` PASS.
- Dev header (`curl -I localhost:3000/white-cane`): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval' …`.
- Production header from the build's `.next/routes-manifest.json`: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' …` with no `'unsafe-eval'`, i.e. unchanged from v1.92.0.
- Full e2e not re-run: the production policy is unchanged and the suite runs against the dev server, whose only difference is the added token; the redirect config unit test still passes. Release notes 1.92.1 (Infrastructure), `package.json` 1.92.1.
