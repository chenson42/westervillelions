# Dependencies Review — 2026-09-10

**Owner:** deployment-engineer
**Cadence:** 30 days — this run is 44 days after the last one (2026-07-28), 14 over.
**Mode:** Report-only. No `package.json` / `pnpm-lock.yaml` changes, no install, per explicit instruction (concurrent agents in the tree). Every command below is read-only: `pnpm audit`, `pnpm outdated`, `pnpm why`, `pnpm licenses`, `pnpm lint`, plus `npm view` for upstream metadata.

## Headline

`pnpm audit --prod --audit-level=high` **exits 0** — the required gate is clean. But the full-severity `--prod` audit (no `--audit-level` filter) turns up one **moderate finding that is a live, ineffective override**, not a new advisory: `pnpm.overrides["qs"]` was set to `>=6.15.2`, which is satisfied by 6.15.3 — a version still inside the vulnerable range of GHSA-x5fp-wj9c-mxmx (`>=6.14.2 <=6.15.3`, patched `>=6.16.0`). `qs` currently resolves to 6.15.3 everywhere in the tree. This is the same failure class as the `@auth/core` and `brace-expansion` overrides the last two reviews found — see the override audit below and the generalization at the end of this doc.

Two things that changed since the last review are both good news and confirmed working:
- **Next.js CVE gate**: `next` is now `16.3.4` (bumped 2026-09-09), clear of the `>=16.0.0 <16.3.3` critical unauthenticated-RCE range. `eslint-config-next` is lockstep at `16.3.4`. No newer patch exists (`pnpm outdated` doesn't list `next` — it's current).
- **The minimatch/lint incident**: `pnpm lint` runs clean (0 errors, 1 unrelated warning, exit 0). The scoped override `"@eslint/eslintrc>minimatch": "^3.1.2"` is resolving correctly against the blanket `"minimatch": "^10"` — verified below with `pnpm why minimatch`, which shows `@eslint/eslintrc` alone pinned to `3.1.5` while every other path resolves `10.2.5`. The fix holds.

## Prior-cycle recommendations — status

| Item | Source | Status |
|---|---|---|
| `next-themes` dead dependency | 2026-06-26 review, cited in task | **Actioned.** Not in `package.json`, not in `pnpm-lock.yaml`, zero references in `src/`. Fully removed. |
| `xlsx` unfixable CVEs → replace with `exceljs` | 2026-05-27 review | **Actioned.** `xlsx` is gone from `package.json`. `exceljs@^4.4.0` is the only spreadsheet library in the tree, used in both export routes (`src/app/api/admin/members/export/route.ts`, `src/app/api/admin/newsletter/export/route.ts`) and both roster scripts (`scripts/import-roster.ts`, `scripts/update-member-details.ts`). |
| `@auth/core` pinned to vulnerable `0.41.1` | 2026-07-28 finding, fixed same cycle | **Holding.** Now `0.41.3`, and `pnpm why @auth/core` shows both `@auth/drizzle-adapter` and `next-auth` resolving `0.41.3` natively — the override may now be redundant (see override table). Not broken either way. |
| `brace-expansion` range that didn't reach the patch | 2026-07-28 finding, fixed same cycle | **Holding.** Resolves `5.0.9` (blanket path) / `1.1.18` (`@eslint/eslintrc` path, untouched by the selector since `<5.0.9` doesn't match it) — `pnpm audit` shows zero `brace-expansion` findings at any severity. |
| `@types/bcryptjs` deprecated stub | 2026-05-27 review | Not re-verified this cycle (not in current `devDependencies` — appears to have been dropped already; `bcryptjs@3.0.3` ships its own types). |

## Override audit — every entry in `pnpm.overrides`

9 entries. Verdict format: what it's for, what it actually resolves to (via `pnpm why`), and whether that's what the advisory needs.

| # | Override | Resolves to (verified) | Verdict |
|---|---|---|---|
| 1 | `"@auth/core": "0.41.3"` | `0.41.3` everywhere (`@auth/drizzle-adapter`, `next-auth`) | **Correct, likely redundant.** Both direct consumers now natively request `0.41.3` since the `next-auth`/`@auth/drizzle-adapter` bump that fixed this last cycle. Not broken — but worth testing removal next cycle to shrink the override surface (see "why fewer overrides is safer" below). |
| 2 | `"sharp@<0.35.4": ">=0.35.4"` | `0.35.4` (via `next`, `next-auth`) | **Correct and effective.** Selector range and floor both match the advisory's fixed version. |
| 3 | `"minimatch": "^10"` | `10.2.5` on every path *except* the one carved out by #4 | **Correct as a blanket, and intentionally overridden by #4 for the one path that can't take v10.** This is the pairing that failed silently before (v10 forced into `@eslint/eslintrc`'s default-import consumption of minimatch, which only ships CJS-compatible shapes on 3.x) — now scoped away from that path. Confirmed live via `pnpm lint` (clean exit 0). |
| 4 | `"@eslint/eslintrc>minimatch": "^3.1.2"` | `3.1.5` | **Correct and effective — this is the fix for the incident described in the task brief.** `pnpm why minimatch` shows exactly one occurrence at `3.1.5` (under `@eslint/eslintrc`) with everything else at `10.2.5`. `pnpm lint` runs to completion, confirming the ESM/default-import mismatch that crashed lint for weeks is resolved. |
| 5 | `"postcss": ">=8.5.10"` | `8.5.24` everywhere | **Correct, likely redundant.** The direct `devDependencies["postcss"]` is already `^8.5.24`, which alone would converge every transitive request to the same version under pnpm's resolver in this tree (confirmed: every `postcss` consumer — `next`, `next-auth`, `tailwindcss`, `autoprefixer`, `vite`, `postcss-*` plugins — resolves `8.5.24`, not just `>=8.5.10`). Candidate for removal next cycle; verify the direct devDep alone still converges everything before deleting. |
| 6 | `"qs": ">=6.15.2"` | `6.15.3` (via `googleapis` → `googleapis-common` → `qs`) | **INEFFECTIVE — same failure class as the two overrides the last two reviews found broken.** The floor `>=6.15.2` is satisfied by `6.15.3`, which is *inside* the vulnerable range for GHSA-x5fp-wj9c-mxmx (`>=6.14.2 <=6.15.3`) and GHSA-4mjr-xmp4-gh2g (`>=2.2.5 <6.16.0`). Both are patched only at `>=6.16.0`. **Apply now** — see recommendations. |
| 7 | `"brace-expansion@>=3.0.0 <5.0.9": ">=5.0.9"` | `5.0.9` (blanket path), `1.1.18` (`@eslint/eslintrc` path, outside the selector's matched range) | **Correct and effective.** Zero `brace-expansion` findings in `pnpm audit` at any severity — confirms both the selector's upper bound and the replacement floor land past GHSA-mh99-v99m-4gvg's patched version. |
| 8 | `"nanoid@<3.3.17": ">=3.3.17 <4"` | `3.3.18` everywhere | **Correct and effective.** |
| 9 | `"browserslist@<4.28.7": ">=4.28.7"` | `4.28.8` everywhere | **Correct and effective.** |

**Score: 7 of 9 correct and effective, 2 correct-but-likely-redundant (candidates to remove, not urgent), 1 actively ineffective (`qs` — apply now).** This is the third review cycle in a row that found an override silently not doing what its author believed — see the generalized fix at the end of this document.

## `pnpm audit` — full picture

**`--prod --audit-level=high`: exit 0.** This is the gate CLAUDE.md requires; it passes.

**`--prod` (all severities): exit 1** — 4 findings, none `high`/`critical`:

| Severity | Package | Path | Patched at | Notes |
|---|---|---|---|---|
| moderate | `qs` | `googleapis>googleapis-common>qs` | `>=6.16.0` | Override target wrong — see above. **Apply now.** |
| moderate | `uuid` | `exceljs>uuid` | `>=11.1.1` | `exceljs` pins `uuid@8.3.2` directly; no override path exists without forking exceljs's own dependency. Build/script-time surface only (report generation, roster import), not a request-time path. Watch — re-check if `exceljs` ever bumps its own `uuid` floor. |
| low | `@babel/core` | `next>styled-jsx>@babel/core` | `>=7.29.6` | Bundled inside Next's own `styled-jsx`, dev/build-time only. Watch — resolves itself on Next's next patch. |

(The 4th line is the low `@babel/core` finding counted twice in the summary tally — same advisory, two paths; see the dev-only table below for the second occurrence.)

**Full `pnpm audit` (prod + dev): exit 0 from the `--prod --audit-level=high` gate is unaffected**, but the unfiltered count is 23 findings — **8 high, 12 moderate, 3 low**. All 8 high findings are dev-tooling-only (eslint's cache chain, tailwind's build chain, vite/vitest's dev server), unreachable from the shipped app and from the required gate. Table:

| Severity | Package | Path | Patched at | Real-world exposure here |
|---|---|---|---|---|
| high ×2 | `flatted` | `eslint>file-entry-cache>flat-cache>flatted` | `>=3.4.2` | ESLint's own on-disk lint cache, local dev/CI only. |
| high | `picomatch` | `eslint-config-next>...>fast-glob>micromatch>picomatch` | `>=2.3.2` | Lint-time glob matching. |
| high | `picomatch` | `tailwindcss>sucrase>tinyglobby>picomatch` | `>=4.0.4` | Tailwind's build-time glob matching (different major line — see recommendations, needs two separate fixes, not one). |
| high | `vite` | `vite-tsconfig-paths>vite` (also vitest's own vite peer) | `>=8.0.16` | `server.fs.deny` bypass on Windows — Vitest's dev server, local test runs only. |
| high ×3 | `js-yaml` | `@eslint/eslintrc>js-yaml` | `>=4.3.2` | ESLint config parsing, local/CI only. |
| moderate | `@vitest/mocker` | `vitest>@vitest/mocker` | `>=4.1.11` | Vitest mock path-traversal, local test runs only. |
| low | `esbuild` | `tsx>esbuild` (also drizzle-kit, tailwind's postcss-load-config chains) | `>=0.28.1` | Dev-server arbitrary file read, Windows-only, local dev only. |
| low | `@babel/core` | `eslint-config-next>eslint-plugin-react-hooks>@babel/core` | `>=7.29.6` | Same advisory as the prod-path one above, lint-time copy. |
| low | `postcss-selector-parser` | `tailwindcss>postcss-selector-parser` | `>=6.1.3` | Build-time CSS selector parsing. |

None of these are exploitable by an end user of the deployed site — they're all lint/build/test tooling run by trusted maintainers on trusted input. None gate a push per CLAUDE.md's rule (`--prod --audit-level=high` only). Still worth clearing so `pnpm audit`'s full output stays a signal, not noise — see "next cycle" recommendations.

## `pnpm outdated`

| Package | Current | Latest | Type | Notes |
|---|---|---|---|---|
| `next` | 16.3.4 | 16.3.4 | prod | Not listed by `pnpm outdated` — already current. CVE gate confirmed clear. |
| `googleapis` | 173.0.0 | 178.1.1 | prod | 5 majors behind. Powers `src/lib/google-groups.ts` (Admin SDK) and the `qs`/`brace-expansion`/`minimatch` transitive chain above. Worth a dedicated review of the Admin SDK changelog before bumping — not evaluated line-by-line this cycle; flagging as next-cycle work, not routine. |
| `resend` | 6.16.0 | 6.27.0 | prod | 11 minor releases behind. No CVE angle found in this review; email SDK, used at ~18 `sendEmail()` call sites plus `sendBulkMemberEmail()`. Review changelog before bumping given the blast radius (every outbound email path) — next cycle. |
| `react` / `react-dom` | 19.2.7 | 19.3.0 | prod | Minor bump, low risk, batch together. |
| `lucide-react` | 0.562.0 | 1.44.0 | prod | Still 0.x→1.x major, carried forward from 2026-05-27 and 2026-07-28 without action. Low risk per prior reviews' assessment (stable icon-naming convention) — still not urgent, but this is now a 3rd-cycle carry-forward with no blocker identified. Worth just doing it next cycle rather than deferring again. |
| `@marsidev/react-turnstile` | 1.5.3 | 1.6.1 | prod | Minor, Turnstile widget. Low risk. |
| `react-hook-form` | 7.80.0 | 7.87.0 | prod | 7 minors behind, changelog-safe pattern historically. |
| `react-image-crop`, `sonner`, `date-fns` (via other Radix bumps) | — | — | prod | All within normal patch/minor drift, no CVE angle. |
| Radix UI primitives (`react-alert-dialog`, `react-dialog`, `react-dropdown-menu`) | various | various | prod | Several point releases behind, no CVE. Low priority — see dead-dependency finding below for the 6 *unused* Radix/CVA packages, which is the more important Radix-related finding this cycle. |
| `typescript` | 5.9.3 | 7.0.2 | dev | Major ×2 behind (6 was skipped entirely upstream). Carried forward from 2026-05-27 as planned tech-debt — still correct to defer, run a full `tsc --noEmit` pass in a dedicated low-churn window. |
| `tailwindcss` | 3.4.19 | 4.3.3 | dev | v3→v4 rewrite, carried forward as planned tech-debt from 2026-05-27. No change in posture — do not bundle with routine bumps. Also currently at the latest available 3.4.x (3.4.19), so nothing safer to grab in the meantime. |
| `eslint` | 9.39.2 | 10.10.0 | dev | Major behind, carried forward. `eslint-config-next@16.3.4` — check upstream for ESLint 10 support before bumping. |
| `@types/node` | 20.19.33 | 22.20.2 | dev | **Do not bump past what matches the deployed Node line** (see Node version section — this cycle's ceiling is 20.x, not 22.x, until the runtime itself moves). |
| `vitest` / `@vitest/coverage-v8` | 4.1.9 | 5.0.0 (major) | dev | `pnpm outdated` only surfaces the dist-tag latest (5.0.0) and hides the in-line patch. **`4.1.11` exists within the current major** and specifically fixes the `@vitest/mocker` moderate finding above — bump to `^4.1.11`, a plain semver-compatible update, no override needed, independent of any 5.0.0 decision. |
| `@eslint/eslintrc` | 3.3.3 | 3.3.7 | dev | Patch bump. Pulls `js-yaml@^4.3.2`, which clears all 3 high `js-yaml` findings. **Re-run `pnpm lint` after bumping** to confirm the `@eslint/eslintrc>minimatch` scoped override still resolves cleanly against the new version — this exact package is the one that broke lint before. |
| `tsx` | 4.22.4 | 4.23.13 | dev | Both declare `esbuild: ~0.28.0`; the resolved `esbuild` is pinned at `0.28.0` in the lockfile (one patch below the fix). A plain `pnpm update esbuild` — no override — should move it to `0.28.1+` within the already-declared range. Low urgency: the finding is a Windows-only dev-server file-read, and this is a local dev tool, not a deployed surface. |

## Dead dependencies (new finding this cycle)

Confirmed via `grep -rn` across the entire repo (`src/`, `scripts/`, excluding `node_modules`) — six packages in `dependencies` have **zero references anywhere**:

- `@radix-ui/react-avatar`
- `@radix-ui/react-label`
- `@radix-ui/react-separator`
- `@radix-ui/react-slot`
- `@radix-ui/react-tabs`
- `class-variance-authority`

`src/components/ui/` contains exactly two files that import Radix primitives — `confirm-dialog.tsx` (`@radix-ui/react-alert-dialog`) and `dropdown-menu.tsx` (`@radix-ui/react-dropdown-menu`) — both of which are used elsewhere and correctly kept. The other six read like shadcn/ui scaffolding that was never built out (or was built and later deleted) while the dependency stayed in `package.json`. Same class of finding as the `next-themes` dead dependency the 2026-06-26 review caught and that's now been cleaned up — recommend the same treatment.

## Node version

`.nvmrc` = `20`, `engines.node` = `>=20.9.0`, local `node -v` = `v20.20.2`. Node 20 ("Iron") is in **Maintenance LTS**, scheduled to go fully end-of-life **2026-04-30** — about 7 months from today. Nothing currently in the dependency tree demands a newer Node line (no `engines` conflicts surfaced by `pnpm outdated`/`pnpm why`). Not urgent this cycle, but with ~7 months of runway this is the point to schedule the Node 22 migration (bump `.nvmrc`, `engines.node`, and the Vercel project's Node runtime setting together) rather than reacting to it in Q1 2027.

## Licence check

`pnpm licenses list --prod` shows nothing outside the standard MIT/Apache-2.0/BSD/ISC/0BSD family, with one dual-license entry worth a one-line note: `jszip` is `(MIT OR GPL-3.0-or-later)` — pulled in transitively via `exceljs`. MIT is the selectable branch and that's what a consumer defaults to; no action needed, just flagging since it's the one non-permissive-by-default entry in the tree.

---

## Ranked recommendations

### Apply now

1. **Fix the `qs` override**: `"qs": ">=6.15.2"` → `"qs": ">=6.16.0"`. Currently ineffective — resolves to `6.15.3`, which is inside the vulnerable range for both `qs` advisories in the `googleapis` chain. This is a `moderate` finding in the required `--prod` audit surface (not blocked by `--audit-level=high`, but it is the one thing in this review that's a genuine live gap, not a housekeeping item).
   - **What could break**: `qs` is used by `googleapis-common` for query-string serialization in Google Admin SDK / OAuth calls (consumed by `src/lib/google-groups.ts`). 6.15.3 → 6.16.0 is a same-major patch-level security release per `qs`'s own versioning discipline; no API changes expected.
   - **Verify**: `pnpm why qs` shows `6.16.0` (or higher) on every path; `pnpm audit --prod` no longer lists GHSA-x5fp-wj9c-mxmx or GHSA-4mjr-xmp4-gh2g; smoke-test the Google Group sync admin flow (the actual consumer of this chain) after the next install.

### Next cycle

2. **Remove 6 dead dependencies**: `@radix-ui/react-avatar`, `@radix-ui/react-label`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `class-variance-authority`. Zero references confirmed by repo-wide grep.
   - **What could break**: Nothing — unreferenced code has no runtime path. Re-run the grep sweep immediately before removal (in case a same-cycle feature branch added a new use), then `pnpm exec tsc --noEmit` and `pnpm build:only` after.
3. **Bump `@eslint/eslintrc` 3.3.3 → 3.3.7** (patch). Clears all 3 high `js-yaml` findings via its own dependency bump to `js-yaml@^4.3.2`.
   - **What could break**: This exact package's minimatch consumption is what the scoped override (`@eslint/eslintrc>minimatch: ^3.1.2`) was built to protect. **Mandatory verification step, not optional**: run `pnpm lint` after bumping and confirm exit 0 before trusting the result — this is the one dependency in the whole tree with a documented history of breaking lint silently.
4. **Bump `vitest` + `@vitest/coverage-v8` to `^4.1.11`** (same-major patch, not the 5.0.0 the `pnpm outdated` table implies is the only option). Clears the moderate `@vitest/mocker` path-traversal finding. Low risk — verify with `pnpm test`.
5. **Add `"vite": ">=8.0.16"` override** (or confirm it's picked up once `vitest`/`vite-tsconfig-paths` next resolve) — clears the high `server.fs.deny` bypass. Vitest's own peer range (`^6||^7||^8`) and `vite-tsconfig-paths`'s (`*`) both accept it.
6. **Two scoped `picomatch` overrides**, not one blanket one (the two vulnerable paths are on different major lines and a single override would force one consumer onto an API it doesn't expect — the exact minimatch mistake, avoided this time by scoping up front):
   - `"@next/eslint-plugin-next>fast-glob>micromatch>picomatch": ">=2.3.2 <3"`
   - `"tailwindcss>sucrase>tinyglobby>picomatch": ">=4.0.4"`
7. **Add `"flatted": ">=3.4.2"` override** — clears 2 high findings reached via `eslint>file-entry-cache>flat-cache>flatted`; `eslint@9.39.2`'s own `file-entry-cache` range (`^8.0.0`) won't naturally reach the fixed `flatted` version, so this needs a direct override rather than a transitive bump.
8. **Add `"@babel/core": ">=7.29.6"` and `"postcss-selector-parser": ">=6.1.3"` overrides** — clear the two remaining low findings (one of which also shows in the `--prod` audit via `next>styled-jsx>@babel/core`).
9. **Test removing the now-likely-redundant `@auth/core` and `postcss` overrides.** Both currently resolve correctly, but both look like they'd resolve the same way from the direct dependency/devDependency alone (see override table). Fewer overrides is directly safer per this review's own finding — every override is a thing that can silently drift out of sync with its target the way `qs` just did. Verify by removing one at a time, re-running `pnpm why <pkg>` and `pnpm audit`, and confirming the resolution is unchanged before committing to drop it for good.
10. **Plain semver update, no override needed**: `esbuild` is pinned at `0.28.0` in the lockfile though `tsx` already declares `~0.28.0` (which permits `0.28.1`). A routine `pnpm update esbuild` clears the low Windows-only finding.
11. **`lucide-react` 0.x → 1.x**: 3rd cycle carried forward with no blocker ever identified across three reviews. Recommend just doing it next cycle instead of deferring a 4th time — scan for renamed icon exports first (same check as 2026-05-27 recommended), but there's no remaining reason to keep pushing this out.

### Watch

- **Node 20 → 22 migration.** ~7 months of runway before Node 20 Maintenance LTS ends (2026-04-30). Nothing forces this today; schedule it, don't react to it.
- **`googleapis` 173 → 178** (5 majors). Powers Admin SDK sync; review the changelog for breaking changes in the Admin SDK surface `src/lib/google-groups.ts` actually uses before bumping. Not a CVE-driven bump (the transitive `qs`/`minimatch`/`brace-expansion` CVEs are already handled via overrides, not by this major bump) — pure staleness.
- **`resend` 6.16 → 6.27.** No CVE angle found. Given ~18 `sendEmail()` call sites plus `sendBulkMemberEmail()`, review the changelog for any request/response shape changes before batching this in.
- **`exceljs`'s bundled `uuid@8.3.2`** (moderate, `>=11.1.1` patched) — no override path without forking `exceljs`'s own pin. Re-check next cycle whether `exceljs` has bumped its own floor.
- **`typescript` 5→7, `eslint` 9→10, `tailwindcss` 3→4** — all correctly deferred as planned tech-debt across multiple cycles now; no new information this cycle that changes that call.

---

## How to verify an override actually did what it claims (mechanical procedure)

This is the third review in a row to find an override that wasn't doing its job (`@auth/core` pinned to the vulnerable version — 2026-07-28; `brace-expansion`'s replacement floor one patch short — 2026-07-28; `qs`'s floor one minor short — this cycle). Follow this every time an override is added, changed, or reviewed:

1. **Pull the advisory's patched-version floor fresh, don't rely on memory of "the fix version."** Open the GHSA/NVD link and read the "Patched versions" field at the moment you write the override. Ranges get revised and off-by-one floors (`6.15.2` vs. the actual `6.16.0`) are exactly how this keeps happening.
2. **Run `pnpm why <package>`** (read-only, safe anytime) and check **every** line in the output against the floor from step 1 — not just the first one. A blanket override with no selector must be satisfied on every path; a scoped override (`parent>child>package`) only needs to be satisfied on the specific chain it names — other paths for the same package name may legitimately resolve elsewhere (this is intentional, see the minimatch pairing above).
3. **Run `pnpm audit` (both `--prod` and full)** and confirm the *specific advisory ID* named in your override's justification is absent from the output — not just that the total finding count dropped. A count going down can mask one advisory clearing while a different one on the same package stays open.
4. **If the override crosses a major-version boundary for a package the code consumes directly or whose consumer is shape-sensitive** (not just walking globs internally) — **smoke-test the actual consumer**, not just the audit output. The minimatch incident is the reference case: the override resolved cleanly, the audit went green, and `pnpm lint` still crashed with exit 2 for weeks because `@eslint/eslintrc` imports minimatch as a CJS default export that v10's ESM-only build doesn't provide. `pnpm why` and `pnpm audit` cannot see that failure mode — only running the consumer can.
5. **Re-run steps 2–4 after any adjacent package bump**, not just when the override itself changes. `@eslint/eslintrc` 3.3.3→3.3.7 (recommended above) touches the exact dependency the minimatch override was built to protect; that bump is the next natural point for this override to silently stop resolving the way it's supposed to, and it should be re-verified in the same cycle it's applied, not assumed.
6. **Prefer removing an override over adding a new one when a direct dependency bump reaches the same target.** Every override is a second place the same fact ("this package needs to be at least version X") can drift out of sync with reality. The `@auth/core` and `postcss` overrides in this review are flagged for exactly this reason — both look redundant now that their consumers request the fixed version natively.
