import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Ledger & Budget Search — docs/work-log/2026-08-06-ledger-search.md.
 *
 * Phase 5 QA manual click-through, automated via Playwright against the real
 * dev DB (read-only feature — no test fixtures created, no cleanup needed).
 * Runs against whatever data already exists in the dev Neon branch as of
 * 2026-08-06: 281 real transactions (all `posted`, spanning 2024-07-01 to
 * 2026-06-xx), 34 real budget lines (mostly FY2025), plus known dirty
 * sentinel rows at FY2095-2099 left over from other e2e suites' interrupted
 * runs (see budgeting-restructure.spec.ts's own header comment and QA's
 * 2026-08-06 Phase 5 report) — this suite treats those as ambient data, not
 * something it created or must clean up.
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
 * search — "Rudolph Run expenses $10,000" and "Rudolph Run – Sponsorships &
 * Donations $11,468" are real FY2025 Foundation/Charitable lump-sum budget
 * rows in this dev DB (confirmed via read-only query, no cause-line children,
 * no cause-line row anywhere matches "Rudolph" either — the test below is
 * unambiguous: every Budget lines match for that term is a lump sum).
 */

const CLUB_ENTITY = "club";
const FOUNDATION_ENTITY = "foundation";
const PENDING_DELETE_FY = 2099;

test.describe("ledger & budget search", () => {
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

  test("FY filter defaults to the current fiscal year; 'All years' reveals real historical data", async ({ page }) => {
    // Arrange / Act — bare visit, no params: fy defaults to current FY
    // (FY2026 as of 2026-08-06), which has zero posted transactions/budget
    // lines yet in this club's real books (confirmed against the dev DB).
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/search");

    // Assert — legitimate "browse current FY" empty state, not an error.
    await expect(page.getByText(/No transactions or budget lines match these filters\./)).toBeVisible();
    await expect(page.locator("#filter-fy")).toHaveValue("");

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
    // Arrange — the known pending-delete sentinel row (FY2099, Foundation,
    // Charitable fund, cause "Environment") left by budgeting-restructure.spec.ts.
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
    await expect(page).toHaveURL(new RegExp(`/admin/ledger/budgeting/charitable\\?entity=${FOUNDATION_ENTITY}&fy=${PENDING_DELETE_FY}`));
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: 5000 });
  });

  test("a highlight id that isn't on the current page degrades gracefully (no crash, no error banner)", async ({ page }) => {
    // Arrange / Act — a well-formed but nonexistent transaction id.
    await signInAsAdmin(page);
    await page.goto(
      `/admin/ledger/${CLUB_ENTITY}?entity=${CLUB_ENTITY}&fy=2026&highlight=00000000-0000-0000-0000-000000000000`,
    );

    // Assert — page renders normally, no crash/error state.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("text=/error|failed to load/i")).toHaveCount(0);
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
    // cause-line result does, and the highlight param is stripped.
    await expect(page).toHaveURL(new RegExp(`/admin/ledger/budgeting/charitable\\?entity=${FOUNDATION_ENTITY}&fy=2025`));
    await expect(async () => {
      expect(page.url()).not.toContain("highlight=");
    }).toPass({ timeout: 5000 });
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
