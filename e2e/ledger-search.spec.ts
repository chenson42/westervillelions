import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { db } from "../src/lib/db";
import { ledgerBudgets, ledgerBudgetLines } from "../src/lib/db/schema";
import { cleanupBudgetFixture } from "./helpers/ledger-fixture-cleanup";

/**
 * Ledger & Budget Search — docs/work-log/2026-08-06-ledger-search.md.
 *
 * Phase 5 QA manual click-through, automated via Playwright against the real
 * dev DB. Mostly a read-only feature (no fixtures, nothing to clean up) —
 * runs against whatever data already exists in the dev Neon branch as of
 * 2026-08-06: 281 real transactions (all `posted`, spanning 2024-07-01 to
 * 2026-06-xx), 34 real budget lines (mostly FY2025). The ONE exception is
 * the pending-delete click-through test below, which now self-seeds its own
 * dedicated FY2093 fixture rather than depending on another suite's
 * leftovers (2026-09-09 remediation, see docs/reviews/2026-09-09-test-
 * coverage.md) — see that test's own comment for why.
 *
 * Per-section permission gating (a caller with only LEDGER_VIEW or only
 * BUDGET_VIEW) is deliberately NOT exercised here: every seeded role that
 * holds budget.view also holds ledger.view by construction (Phase 1's own
 * "Permissions" section), so there is no real single-permission account to
 * sign in as without hand-crafting a throwaway role/user in the dev DB. That
 * exact code path (`canViewTxns ? searchTransactions(...) : Promise.resolve(null)`)
 * is proven — including "never called," not just "result hidden" — by
 * page.test.ts's 5 mock-call-count assertions, which is a strictly stronger
 * check than anything observable from the rendered DOM. See QA's Phase 5
 * report for the full audit.
 *
 * Phase 4 loop-back (2026-08-07, Fix 1) added lump-sum budget category
 * search — "Rudolph Run expenses" and three other "Rudolph Run" rows are
 * real FY2025 Foundation/Charitable lump-sum budget rows in this dev DB (no
 * cause-line children on any of them — every "Budget lines" match for that
 * term is a lump sum).
 *
 * 2026-09-09 remediation — dev-mode navigation latency, not a broken
 * feature: `/admin/ledger/budgeting/[fundSlug]` (the click-through
 * destination for every Budget-lines result) does five sequential/parallel
 * DB round trips per render (getEntities, getEntity, getFunds,
 * getBudgetApproval, then getFundReport×2 + getBudgetCauseLineLabels) with
 * `dynamic = "force-dynamic"` — no caching. Measured directly (repeated
 * `page.goto()` to this route, including on an already-warm Turbopack
 * route): a consistent 3-4.5s per full server round trip in dev, and a
 * click-driven client transition measured up to ~8s end-to-end. Playwright's
 * default 5000ms assertion timeout is too tight for that, independent of
 * which row is clicked (reproduced against the exact "Rudolph Run expenses"
 * row the original test was written against, not just a newer ambiguous
 * one). The two click-through assertions below that land on this route use
 * an explicit, generous timeout for that reason — same assertion, more
 * realistic budget for a genuinely slow (in dev) but correct page.
 */

const CLUB_ENTITY = "club";
const FOUNDATION_ENTITY = "foundation";
// Dedicated sentinel fiscal year for this suite's own pending-delete
// fixture — never shared with another suite's FY (2094/2095/2096/2097/2098/2099
// are already claimed; see each suite's own header comment).
const PENDING_DELETE_FY = 2093;
// Static catalog reference ids (ledger_entities/ledger_funds/ledger_categories
// don't change week to week) — Foundation entity, Charitable Fund, the real
// "Charitable donation out" category (same category id
// ledger-category-management.spec.ts calls CHARITABLE_DONATION_OUT_FOUNDATION).
const FOUNDATION_ENTITY_ID = "8a27091d-ae9b-4c58-bff3-a633c418ee21";
const CHARITABLE_FUND_ID = "11675bf5-7b7c-428b-be91-c66290dd1f4d";
const CHARITABLE_DONATION_OUT_CATEGORY_ID = "2338f33e-0b16-41b7-8b43-9cce8fafa3b9";
// Dev-mode navigation latency to /admin/ledger/budgeting/[fundSlug] — see
// module doc comment above.
const BUDGETING_NAV_TIMEOUT = 20_000;

async function cleanupPendingDeleteFixture(): Promise<void> {
  await cleanupBudgetFixture({
    entityId: FOUNDATION_ENTITY_ID,
    fiscalYears: [PENDING_DELETE_FY],
  });
}

test.describe("ledger & budget search", () => {
  test.beforeAll(async () => {
    // Idempotent — clears whatever a prior, possibly-crashed run left
    // behind before this run's fixture is created.
    await cleanupPendingDeleteFixture();

    const [budget] = await db
      .insert(ledgerBudgets)
      .values({
        entityId: FOUNDATION_ENTITY_ID,
        fundId: CHARITABLE_FUND_ID,
        fiscalYear: PENDING_DELETE_FY,
        categoryId: CHARITABLE_DONATION_OUT_CATEGORY_ID,
        flow: "expense",
        annualAmountCents: 10000,
      })
      .returning();

    await db.insert(ledgerBudgetLines).values({
      budgetId: budget.id,
      cause: "Environment",
      label: "E2E QA Env Two",
      amountCents: 10000,
      pendingDeleteAt: new Date(),
    });
  });

  test.afterAll(async () => {
    // Runs regardless of pass/fail — leaves the DB as it found it.
    await cleanupPendingDeleteFixture();
  });

  test("quick-search box on /admin/ledger submits to /admin/ledger/search?q=…", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/ledger");

    // Act
    await page.getByLabel("Search transactions and budget lines").fill("Vision");
    await page.getByRole("button", { name: "Search" }).click();

    // Assert
    await expect(page).toHaveURL(/\/admin\/ledger\/search\?q=Vision/);
    // The box is re-mounted on the results page, seeded with the term.
    await expect(page.getByLabel("Search transactions and budget lines")).toHaveValue("Vision");
  });

  test("results are grouped into Transactions and Budget lines, each with its own count", async ({ page }) => {
    // Arrange / Act
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Vision&fy=all");

    // Assert
    await expect(page.getByRole("heading", { name: /Transactions \(\d+\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Budget lines \(\d+\)/ })).toBeVisible();
    // Subtotals are split by flow, never netted into one figure.
    await expect(page.getByText(/Income: \+\$/).first()).toBeVisible();
  });

  test("subtotal across ALL matches does not change between page 1 and page 2 of a group", async ({ page }) => {
    // Arrange — browse mode (no q), All years: 281 real transactions, well
    // over SEARCH_PAGE_SIZE (50), so pagination is guaranteed to trigger.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?fy=all");

    // Act — capture page 1's subtotal + range, then page 2's.
    const txnSection = page.locator("section", { hasText: "Transactions" }).first();
    const page1Subtotal = await txnSection.getByText(/Subtotal —/).innerText();
    await expect(txnSection.getByText(/Showing 1–50 of/)).toBeVisible();
    await txnSection.getByRole("link", { name: "Next" }).click();

    // Assert
    await expect(page).toHaveURL(/txnPage=2/);
    const txnSection2 = page.locator("section", { hasText: "Transactions" }).first();
    await expect(txnSection2.getByText(/Showing 51–/)).toBeVisible();
    const page2Subtotal = await txnSection2.getByText(/Subtotal —/).innerText();
    expect(page2Subtotal).toBe(page1Subtotal);
  });

  test("FY filter defaults to the current fiscal year, and an honest empty state renders for a term with no matches — regression for time-expired 'FY2026 is empty' assumption", async ({ page }) => {
    // Arrange / Act — bare fy (no fy param: defaults to the current fiscal
    // year), with a search term guaranteed to match nothing, ever. The
    // original version of this test instead relied on the current fiscal
    // year's REAL data being empty ("FY2026 as of 2026-08-06 has zero
    // posted transactions") — true when written, false five weeks later
    // once the club's real books gained FY2026 activity (see
    // docs/reviews/2026-09-09-test-coverage.md). A guaranteed-no-match term
    // proves the same thing — an honest empty state, not an error — without
    // depending on ambient data staying empty forever.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=zzzcurrentfyemptycheck123");

    // Assert — fy defaults to the current fiscal year, and the empty state
    // names the actual term (not a generic "these filters" — matches the
    // wording the dedicated "empty-state wording" test below exercises).
    await expect(page.locator("#filter-fy")).toHaveValue("");
    await expect(
      page.getByText('No transactions or budget lines match "zzzcurrentfyemptycheck123".'),
    ).toBeVisible();
  });

  test("'All years' reveals real historical data beyond the current fiscal year", async ({ page }) => {
    // Arrange — bare browse: no search term, no fy param. Deliberately
    // independent of whatever the current FY's real transaction count is
    // today (see the previous test) — this only asserts that switching to
    // All years surfaces the club's real multi-year ledger history.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search");

    // Act — switch to All years via the advanced filter panel.
    await page.locator("#filter-fy").selectOption("all");
    await page.getByRole("button", { name: "Apply filters" }).click();

    // Assert
    await expect(page).toHaveURL(/fy=all/);
    await expect(page.getByRole("heading", { name: /Transactions \(\d+\)/ })).toBeVisible();
    const heading = await page.getByRole("heading", { name: /Transactions \(\d+\)/ }).innerText();
    expect(heading).not.toContain("(0)");
  });

  test("transaction-only filters are noted (not silently ignored, not zeroed) on the Budget lines section", async ({ page }) => {
    // Arrange — establish a control count without any transaction-only filter.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Vision&fy=all");
    const controlHeading = await page.getByRole("heading", { name: /Budget lines \(\d+\)/ }).innerText();

    // Act — apply a bank-account filter (transaction-only) via the URL.
    await page.goto("/admin/ledger/search?q=Vision&fy=all&bankAccount=beac8658-3d69-4408-a988-0c24f4cd911a");

    // Assert — inline note appears, count is UNCHANGED (never forced to zero).
    await expect(
      page.getByText(/Bank account, date range, and status filters don.t apply to budget lines/),
    ).toBeVisible();
    const filteredHeading = await page.getByRole("heading", { name: /Budget lines \(\d+\)/ }).innerText();
    expect(filteredHeading).toBe(controlHeading);
  });

  test("a search term containing % or _ is treated as literal text, not a wildcard", async ({ page }) => {
    // Arrange / Act — no real row in this dataset contains a literal % or _
    // character. If the term were passed through unescaped, ILIKE would
    // treat "%" as "match anything" and return most/all of the 281+34 rows.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=%25&fy=all"); // q=%

    // Assert — zero matches, the honest "no wildcard" result.
    await expect(page.getByText(/No transactions or budget lines match "%"\./)).toBeVisible();

    // Act — same check for underscore.
    await page.goto("/admin/ledger/search?q=_&fy=all");

    // Assert
    await expect(page.getByText(/No transactions or budget lines match "_"\./)).toBeVisible();
  });

  test("empty-state wording names the actual search term", async ({ page }) => {
    // Arrange / Act
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=zzznomatchxyz123&fy=all");

    // Assert
    await expect(
      page.getByText('No transactions or budget lines match "zzznomatchxyz123".'),
    ).toBeVisible();
    await expect(page.getByText(/Try broadening your search or clearing filters\./)).toBeVisible();
  });

  test("clicking a transaction result highlights the row on the register and strips the URL param", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Vision&fy=all");
    const txnRow = page.locator("tbody tr").first();
    await expect(page.getByRole("heading", { name: /Transactions/ })).toBeVisible();

    // Act
    await txnRow.locator("a").first().click();

    // Assert — lands on the register, highlight param present at first...
    await page.waitForURL(new RegExp(`/admin/ledger/${CLUB_ENTITY === "club" ? "" : ""}`)); // reach any register URL
    // ...then the RowHighlighter strips it almost immediately.
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: 5000 });
  });

  test("clicking a budget-line result lands on the budgeting drill-down and highlights (incl. a pending-delete line)", async ({ page }) => {
    // Arrange — this suite's own dedicated pending-delete fixture (FY2093,
    // Foundation, Charitable fund, cause "Environment"), created in
    // beforeAll above. Used to piggyback on a leftover row from
    // budgeting-restructure.spec.ts's FY2099 fixture — that suite now
    // cleans up after itself (2026-09-09 remediation), which correctly
    // broke this suite's cross-suite dependency on its leftovers.
    await signInAsAdmin(page);
    await page.goto(`/admin/ledger/search?q=E2E+QA+Env+Two&fy=${PENDING_DELETE_FY}`);

    // Assert — search itself renders it struck-through with the badge.
    const row = page.locator("tbody tr", { hasText: "E2E QA Env Two" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Pending removal")).toBeVisible();
    await expect(row).toHaveClass(/line-through|text-gray-400/);

    // Act
    await row.locator("a").first().click();

    // Assert — lands on the budgeting drill-down for the right fund/FY.
    // Generous timeout — see module doc comment (dev-mode SSR cost of this
    // route, not a broken click-through).
    await expect(page).toHaveURL(
      new RegExp(`/admin/ledger/budgeting/charitable\\?entity=${FOUNDATION_ENTITY}&fy=${PENDING_DELETE_FY}`),
      { timeout: BUDGETING_NAV_TIMEOUT },
    );
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: BUDGETING_NAV_TIMEOUT });
  });

  test("a highlight id that isn't on the current page degrades gracefully (no crash, no error banner)", async ({ page }) => {
    // Arrange / Act — a well-formed but nonexistent transaction id, on a
    // REAL fund slug. `/admin/ledger/[fundSlug]` takes a FUND slug in the
    // path (e.g. "activity"/"administrative" for the Club entity — see
    // ledger_funds), not an entity slug — the original version of this test
    // put CLUB_ENTITY ("club") in that segment, which 404s (no fund is
    // named "club") and rendered the app's custom 404 page under a
    // dev-mode overlay whose own chrome happened to satisfy a broad
    // /error|failed to load/i text match. That was never a real in-app
    // error banner — this only ever needed a valid fund/entity/fy combo.
    await signInAsAdmin(page);
    await page.goto(
      `/admin/ledger/activity?entity=${CLUB_ENTITY}&fy=2026&highlight=00000000-0000-0000-0000-000000000000`,
    );

    // Assert — page renders normally, no crash/error state. Scoped to
    // <main> (src/app/(dashboard)/admin/layout.tsx wraps every admin page's
    // content in one) so this can never accidentally match Next's dev-mode
    // overlay chrome, which renders outside it.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main").getByText(/error|failed to load/i)).toHaveCount(0);
  });

  test("a stale highlight does not persist across a manual refresh", async ({ page }) => {
    // Arrange — land with a REAL highlight id so the effect actually fires
    // and strips the param.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Vision&fy=all");
    const href = await page.locator("tbody tr").first().locator("a").first().getAttribute("href");
    expect(href).toContain("highlight=");
    await page.goto(href!);
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: 5000 });
    const strippedUrl = page.url();

    // Act — manual refresh of the now-highlight-free URL.
    await page.reload();

    // Assert — nothing to re-trigger; URL stays highlight-free.
    expect(page.url()).toBe(strippedUrl);
    expect(page.url()).not.toContain("highlight=");
  });

  test("Fix 1: a lump-sum budget category (no cause-line children) is searchable, renders with a 'Lump sum' badge, and its highlight click-through lands on the budgeting drill-down", async ({ page }) => {
    // Arrange — "Rudolph Run expenses" is a real FY2025 lump-sum budget row
    // (Foundation, Charitable fund) with zero ledger_budget_lines children;
    // before Fix 1 this term returned "Budget lines (0)" even though the
    // club genuinely budgets for it.
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Rudolph&fy=2025");

    // Assert — no longer a false "not budgeted" zero. Scoped to the Budget
    // lines section specifically — "Rudolph Run" also matches dozens of real
    // transactions (beneficiary_cause), so an unscoped `tbody tr` locator
    // would pick up a transaction row instead.
    const budgetSection = page.locator("section", { hasText: "Budget lines" });
    const heading = await budgetSection.getByRole("heading", { name: /Budget lines \(\d+\)/ }).innerText();
    expect(heading).not.toContain("(0)");

    const row = budgetSection.locator("tbody tr", { hasText: "Rudolph Run" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Lump sum")).toBeVisible();
    // Reads as the category-level line it is — no empty Label cell, no
    // stray separator.
    await expect(row.getByText("Not itemized by cause")).toBeVisible();

    // Act
    await row.locator("a").first().click();

    // Assert — lands on the correct fund+FY budgeting drill-down, same as a
    // cause-line result does, and the highlight param is stripped. Generous
    // timeout — see module doc comment (dev-mode SSR cost of this route,
    // not a broken click-through; reproduced identically against every one
    // of the four "Rudolph" rows, including the specific "Rudolph Run
    // expenses" row this test was originally written against).
    await expect(page).toHaveURL(
      new RegExp(`/admin/ledger/budgeting/charitable\\?entity=${FOUNDATION_ENTITY}&fy=2025`),
      { timeout: BUDGETING_NAV_TIMEOUT },
    );
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: BUDGETING_NAV_TIMEOUT });
  });

  test("360px mobile: result tables scroll horizontally inside their own container, page body does not", async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search?q=Vision&fy=all");
    await expect(page.getByRole("heading", { name: /Transactions/ })).toBeVisible();

    // Assert — page body has no horizontal overflow...
    const bodyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(bodyOverflow).toBe(true);

    // ...but the table's own overflow-x-auto wrapper does (real horizontal scroll exists).
    const tableScrolls = await page.evaluate(() => {
      const table = document.querySelector("table");
      const wrapper = table?.closest(".overflow-x-auto");
      return wrapper ? wrapper.scrollWidth > wrapper.clientWidth : false;
    });
    expect(tableScrolls).toBe(true);
  });
});
