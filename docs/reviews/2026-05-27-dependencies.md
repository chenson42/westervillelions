# Dependencies Review — 2026-05-27

**Outcome:** 9 patch / 14 minor / 3 major outdated; 0 critical CVEs, 14 high CVEs in production (next ×8, xlsx ×2, drizzle-orm ×1, minimatch transitive via googleapis ×3).

---

## Summary

`pnpm outdated` found 26 packages behind (excluding the deprecated `@types/bcryptjs` stub).
`pnpm audit --prod` reported **29 vulnerabilities: 14 high, 12 moderate, 3 low** across production dependencies.
`pnpm audit` (all deps) reported **42 vulnerabilities: 21 high, 18 moderate, 3 low**.

The most urgent items are:
1. **`next` 16.1.6 → 16.2.6** — 8 high CVEs and several moderate CVEs all fixed at 16.2.5+. This is a minor bump that is a security necessity.
2. **`drizzle-orm` 0.45.1 → 0.45.2** — direct SQL injection CVE, patch bump, trivial to apply.
3. **`xlsx` 0.18.5** — 2 high CVEs, no patched version available in the 0.x series. Requires evaluation of alternatives.

---

## CVEs in Production — By Severity

### HIGH (14 in prod)

| Package | Current | Fixed At | CVE / Advisory | Notes |
|---------|---------|----------|----------------|-------|
| `next` | 16.1.6 | 16.2.5 | GHSA-26hh-7cqf-hhc6 — DoS via Server Components | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-mg66-mrh9-m8jx — DoS via Cache Components connection exhaustion | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-c4j6-fc7j-m34r — SSRF via WebSocket upgrades | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-492v-c6pp-mqqv — Middleware/Proxy bypass via dynamic route injection | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-267c-6grr-h53f — Middleware/Proxy bypass via segment-prefetch routes | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-3g8h-86w9-wvmq (Pages Router Middleware bypass) | fix: bump to 16.2.6 |
| `next` | 16.1.6 | 16.2.5 | GHSA-xxx (two additional high Middleware bypass advisories) | fix: bump to 16.2.6 |
| `drizzle-orm` | 0.45.1 | 0.45.2 | SQL injection via improperly escaped SQL identifiers | fix: patch bump |
| `xlsx` | 0.18.5 | none (0.x) | GHSA-4r6h-8v6p-xvw6 — Prototype Pollution | no fix in 0.x series |
| `xlsx` | 0.18.5 | none (0.x) | GHSA-5pgg-2g8v-p4x9 — ReDoS | no fix in 0.x series |
| `minimatch` (transitive) | via `googleapis` | n/a | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-xxx — ReDoS (3 advisories) | fixed by bumping `googleapis` to 172.x |

### MODERATE (12 in prod)

| Package | Advisory summary | Fix path |
|---------|-----------------|----------|
| `next` ×9 | HTTP request smuggling, CSRF bypass, XSS, DoS (image), cache poisoning (multiple) | bump to 16.2.6 |
| `postcss` (transitive via `next`) | XSS via unescaped `</style>` | resolved inside next 16.2.6 |
| `uuid` (transitive via `resend>svix`) | Missing buffer bounds check in v3/v5/v6 | bump `resend`; transitive fix |
| `qs` (transitive via `googleapis`) | DoS via `qs.stringify` | bump `googleapis` to 172.x |
| `brace-expansion` (transitive via `googleapis`) | Zero-step sequence DoS | bump `googleapis` to 172.x |

### LOW (3 in prod)

All three are `next`-specific (dev HMR CSRF, redirect bypass, cache poisoning via RSC). Fixed at next 16.2.5.

---

## Patch Bumps (Z only changed) — Safe to batch

| Package | Current | Latest | Type |
|---------|---------|--------|------|
| `@auth/drizzle-adapter` | 1.11.1 | 1.11.2 | prod |
| `@types/react` | 19.2.14 | 19.2.15 | dev |
| `@vitest/coverage-v8` | 4.1.6 | 4.1.7 | dev |
| `postcss` | 8.5.6 | 8.5.15 | dev |
| `postgres` | 3.4.8 | 3.4.9 | prod |
| `react` | 19.2.3 | 19.2.6 | prod |
| `react-dom` | 19.2.3 | 19.2.6 | prod |
| `vitest` | 4.1.6 | 4.1.7 | dev |
| `drizzle-kit` | 0.31.9 | 0.31.10 | dev |
| `drizzle-orm` | 0.45.1 | 0.45.2 | prod — **has HIGH CVE, elevate priority** |

All safe to bump in a single commit. Verify build passes. Note: `react`/`react-dom` patch bumps are low-risk but worth smoke-testing the portal after.

---

## Minor Bumps (Y changed) — Review before bumping

| Package | Current | Latest | Type | Notes |
|---------|---------|--------|------|-------|
| `next` | 16.1.6 | 16.2.6 | prod | **HIGH CVEs — must upgrade.** `eslint-config-next` must bump in lockstep. |
| `eslint-config-next` | 16.1.1 | 16.2.6 | dev | Bump with `next`. |
| `@marsidev/react-turnstile` | 1.4.2 | 1.5.2 | prod | Cloudflare Turnstile widget; review changelog for API changes before bumping. |
| `autoprefixer` | 10.4.24 | 10.5.0 | dev | PostCSS plugin; low risk, no behavior change expected. |
| `date-fns` | 4.1.0 | 4.3.0 | prod | Utility library; changelog shows minor additions only. Safe. |
| `googleapis` | 169.0.0 | 172.0.0 | prod | Fixes transitive `minimatch`/`qs`/`brace-expansion` CVEs. Review changelog for Admin SDK breaking changes. |
| `react-hook-form` | 7.71.1 | 7.76.1 | prod | Multiple minor releases; changelog shows bug fixes and minor API additions. Safe. |
| `resend` | 6.9.2 | 6.12.4 | prod | Email SDK; changelog shows new features. Safe; fixes transitive `uuid` CVE. |
| `tailwind-merge` | 3.4.0 | 3.6.0 | prod | Utility; changelog shows rule additions. Safe. |
| `tsx` | 4.21.0 | 4.22.3 | dev | TypeScript runner; safe. |

---

## Major Bumps (X changed) — Flag individually

### `lucide-react` 0.562.0 → 1.16.0
**Major (0.x → 1.x).** Lucide-react has been in a 0.x pre-release cadence for years; 1.0 is the first stable release. The API surface (named icon exports) is identical, but icon names occasionally change between releases. Before bumping: scan for any renamed icons since 0.562. Low risk in practice because lucide uses a stable naming convention, but the version jump looks alarming — assess after a quick changelog scan. Not urgent.

### `tailwindcss` 3.4.19 → 4.3.0
**Major (v3 → v4).** Tailwind v4 is a ground-up rewrite: CSS-first configuration, no `tailwind.config.js`, different plugin API, changed utility names. The project currently uses v3 syntax throughout all components. **Do not bump without a dedicated migration effort.** This is a planned tech-debt item, not a routine bump.

### `typescript` 5.9.3 → 6.0.3
**Major (5 → 6).** TypeScript 6.0 is a new stable release as of this review. It drops older `lib.d.ts` targets (ES5/ES3) and tightens some inference. The project targets modern targets. Risk is moderate — a full `pnpm exec tsc --noEmit` pass after bumping is required. Defer until a low-churn sprint.

### `eslint` 9.39.2 → 10.4.0
**Major (9 → 10).** ESLint 10 drops legacy flat-config compatibility shims. The project already uses flat config (`eslint.config.mjs`). Check if any plugins (`eslint-config-next`, etc.) are compatible with ESLint 10 before bumping. Defer until `eslint-config-next` publishes ESLint 10 support.

### `@types/node` 20.19.33 → 25.9.1
**Major (20 → 25).** The `@types/node` version tracks the Node.js API surface. The project's `engines` field requires `>=20.9.0` and Vercel deploys on Node 20. Bumping `@types/node` to 25 would expose Node 25 APIs that don't exist in the runtime. **Do not bump past the Node 20 series** until the runtime is confirmed upgraded. Stay at `^20`.

---

## Special: `@types/bcryptjs` — Deprecated

The stub package `@types/bcryptjs@3.0.0` is deprecated. `bcryptjs` 3.0.3 bundles its own `.d.ts` types. Remove `@types/bcryptjs` from `devDependencies` — it is a dead dependency.

---

## Recommended Action Plan (Priority Order)

1. **Immediate — security:** Bump `next` 16.1.6 → 16.2.6 and `eslint-config-next` 16.1.1 → 16.2.6 in lockstep. Eight high CVEs resolved.
2. **Immediate — security:** Bump `drizzle-orm` 0.45.1 → 0.45.2. Direct SQL injection CVE, one-line patch.
3. **Near-term — security:** Bump `googleapis` 169 → 172. Resolves three transitive `minimatch` ReDoS high CVEs and two moderate CVEs (`qs`, `brace-expansion`).
4. **Near-term — security:** Bump `resend` 6.9.2 → 6.12.4. Resolves transitive `uuid` moderate CVE.
5. **Near-term — routine:** Batch all confirmed patch bumps (see Patch Bumps table above). Run `pnpm build:only` and smoke-test the member portal.
6. **Near-term — routine:** Bump remaining minor packages (`date-fns`, `react-hook-form`, `tailwind-merge`, `tsx`, `autoprefixer`, `@marsidev/react-turnstile`).
7. **Short-term — housekeeping:** Remove `@types/bcryptjs` from `devDependencies`.
8. **Planned tech-debt:** `lucide-react` 0.x → 1.x — assess icon renames, then bump.
9. **Planned tech-debt:** `tailwindcss` v3 → v4 — dedicated migration effort required; do not bundle with routine bumps.
10. **Planned tech-debt:** `typescript` 5 → 6 — run full typecheck after bumping; defer to a low-churn sprint.
11. **Planned tech-debt:** `eslint` 9 → 10 — verify plugin compatibility first; defer until `eslint-config-next` supports ESLint 10.
12. **Do not touch:** `@types/node` — keep pinned to `^20` to match the Vercel/production Node runtime.
13. **Blocked/No fix:** `xlsx` — no patched 0.x release exists. Both high CVEs affect the production export endpoints (`/api/admin/members/export`, `/api/admin/newsletter/export`). These are admin-only, authenticated routes, which limits blast radius, but the risk is real. Options: (a) migrate to `exceljs` which is actively maintained, (b) restrict to CSV-only export and remove `xlsx`. Create a tracked work item.

---

## Notes on Auth Stack and Test Runners

- **`next-auth` 5.0.0-beta.30** — no newer beta available via `pnpm outdated`; unchanged. The `@auth/core` override is pinned to `0.41.1` in `pnpm.overrides`. No action needed this cycle.
- **`@auth/drizzle-adapter` 1.11.1 → 1.11.2** — patch bump, safe.
- **`vitest` 4.1.6 → 4.1.7** and **`@vitest/coverage-v8` 4.1.6 → 4.1.7** — patch bumps. No Node 18 rolldown incompatibility concern at these patch levels (the incompatibility noted in memory was between vitest 4.x and Node 18; this project now uses Node 20+ on Vercel).
- **`@playwright/test` 1.60.0** — not reported as outdated; no action needed.
