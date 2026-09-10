# Budget Context Panel — Latent React Compiler Findings Behind a Stale Directive

> **Slug:** `2026-09-10-budget-context-panel-compiler-findings`
> **Surface:** (dashboard) admin — The Ledger, transaction budget-context panel
> **Permission(s):** none — existing ledger permissions unchanged
> **Estimated complexity:** small-to-medium (a real refactor, not a lint tidy)
> **Pipeline mode:** Full — NOT STARTED. This entry exists so the finding isn't lost.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Not started | — | — |
| 2 — Architectural review | architect | Not started | — | — |
| 3 — Technical design | tech-lead | Not started | — | — |
| 4 — Implementation | TBD | Not started | — | — |
| 5 — Verification | qa | Not started | — | — |
| 6 — Shipped vs intent | analyst | Not started | — | — |

---

## Why this file is deliberately left alone

`src/components/admin/ledger/budget-context-panel.tsx` line 114 carries

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
```

which ESLint reports as **an unused directive** — the obvious "cleanup" is to delete it.
**Do not just delete it.** Deleting it turns one cosmetic warning into a build-failing
error, because the directive is masking real findings:

1. Remove the directive → the React Compiler starts analysing this component and reports
   `react-hooks/refs` at **line 72**: `currentFiscalYearRef.current = derivedFiscalYear`
   is a ref write in the render body.
2. Fix that by moving the write into a `useEffect` → the compiler proceeds further and
   reports `react-hooks/set-state-in-effect` at **line 85**, the
   `setLoadState({ status: "loading" })` inside the fetch effect.

Verified empirically on 2026-09-10 during the lint-warning cleanup: with the file at
`HEAD`, `pnpm lint` is 0 errors / 1 warning. Delete line 114 and it becomes 1 error.
Apply the `useEffect` fix as well and it is still 1 error, just a different one.

## Why the naive fix is also wrong on the merits

The render-body ref write is **deliberate and documented in the file**: the ref "always
reflects the LATEST derived FY, updated synchronously every render", and is read inside
a fetch's `.then()`/`.catch()` so a resolving *stale* request can be told it is no longer
current even though its own closure captured an older fiscal year.

Moving that write into a `useEffect` changes *when* the guard updates — from during
render to after commit. That is a behaviour change to a staleness guard in the
treasurer's budget tooling, made in service of a lint rule. It may well be safe (a fetch
callback is at least a tick away), but "probably safe" is not the standard for money-
adjacent code, and it was not what the warning asked for.

The `set-state-in-effect` finding at line 85 is likewise the canonical data-fetching
shape — set loading, fetch, set result. Refactoring it to satisfy the rule means
restructuring the component's load lifecycle.

## What a real fix looks like

Either:

- restructure the panel's data loading so the fiscal-year staleness guard doesn't need a
  render-time ref (e.g. key the fetch by fiscal year and discard non-matching responses
  by comparing the captured value against a state value), then re-evaluate whether the
  effect still trips the rule; or
- keep the current behaviour and replace the stale `exhaustive-deps` directive with two
  narrow, *accurate* suppressions naming `react-hooks/refs` and
  `react-hooks/set-state-in-effect`, each with a comment explaining why the rule does
  not apply — which at least makes the suppression honest rather than vestigial.

Either way it needs Phase 1-3 treatment, because option one changes how the panel loads
data and option two is a deliberate, documented rule exception.

## Interim state

The file is left exactly as it was at `HEAD`. `pnpm lint` therefore reports **1 warning,
0 errors** — that single warning is this finding, held open on purpose. Do not silence it
by deleting the directive without doing the work above.

Related: `src/app/(dashboard)/admin/ledger/page.tsx` carries a similar deliberate
suppression for `react-hooks/error-boundaries` — its `try/catch` cannot catch a
render-phase throw inside `<LedgerDashboard>`, and fixing it properly needs a real error
boundary across all three branches. Same shape of problem, also still open.
