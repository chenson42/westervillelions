# Zeffy connect picker shows no ticket rates — Work Log

> **Slug:** `2026-11-04-zeffy-connect-rates`
> **Surface:** (dashboard) admin
> **Permission(s):** existing `santas_workshop.manage` covers this
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

## Root cause

`GET /api/v1/campaigns` (list) returns campaigns without a `rates` key; only `GET /api/v1/campaigns/{id}` includes `rates`. `toSummary()` in `src/lib/zeffy/client.ts` read `rates` from the list, so every form showed "This form lists no ticket rates." and could not be connected on `/admin/santas-workshop/<id>/connect`.

## Reproduction

Open `/admin/santas-workshop/<id>/connect`, pick any Zeffy form: "This form lists no ticket rates." Verified live against the Zeffy API on 2026-11-04 (list keys have no `rates`; single read has `rates: [{id, title, amount (cents), is_add_on, ...}]`). The "Enter the form by hand" fallback works; the user is connecting today via that fallback.

## Phases

| Phase | Status |
|-------|--------|
| 1 Analyst | Skipped by orchestrator: bug confirmed live, behavior otherwise unchanged |
| 2 Architect | Skipped: no invariant touched, no schema/API/permission change, not a durable-claim path |
| 3 Tech-lead | Skipped: trivial fix, root cause documented here |
| 4 Implementation | Complete (below) |
| 5 Verification | Reduced at the user's request ("run it through with minimal testing"): unit tests + tsc + lint + `pnpm build:only`; no e2e, no browser click-through |
| 6 Analyst | Pending |

## Phase 4 — Implementation

`listCampaigns()` now hydrates `rates` for `type === "ticketing"` campaigns by calling the (extracted, otherwise unchanged) `getCampaign()` per campaign, sequentially through the existing rate limiter. A failure on one campaign leaves its rates empty; the list still returns. The dev allowlist logic is untouched (hydration only runs for campaigns that passed the list filter, and `getCampaign` re-checks it). All rates, including add-ons, are still shown.

Files: `src/lib/zeffy/client.ts`, `src/lib/zeffy/client.test.ts` (two new tests with real response shapes, no PII).

## Phase 5 — Verification (reduced)

See orchestrator report for gate results (tsc, lint, test, build:only).
