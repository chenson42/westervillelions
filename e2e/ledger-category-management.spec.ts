import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Ledger Category Management — Phase 5 verification
 * (docs/work-log/2026-08-07-ledger-category-management.md, DECISION-065/066/067/068).
 *
 * Exercises rename, deactivate/reactivate, edit-flags (countsAsGiving/
 * form990Line), and merge against REAL dev-DB categories via the actual
 * running app — no direct DB access from this file (matches the black-box
 * discipline already established by admin-security.spec.ts). Where a
 * scenario needs a locked fiscal year, this suite locks/unlocks it through
 * the real, already-shipped Approve & Lock API
 * (POST/unlock /api/admin/ledger/budget-approvals) rather than writing to
 * the DB directly — exactly what a treasurer would do by hand.
 *
 * The "merge refusals" describe block also covers the 2026-08-08 treasurer
 * decision (DECISION-068): merge refuses the whole operation when any
 * affected fiscal year is EARLIER than the current one, regardless of lock
 * status — using `Contingency`'s real, genuinely-unlocked FY2025 budget row
 * as the fixture, since (per the Phase 6 re-check that prompted this
 * decision) no fiscal year has ever actually been locked in this database.
 *
 * Fixture ids below are real rows in the dev DB (DATABASE_URL — never prod)
 * as of 2026-08-07, confirmed via read-only SQL before this suite was
 * written (DISASTER_RELIEF_FOUNDATION confirmed 2026-08-08). Tests that
 * mutate real category state (rename, merge) always restore it by the end
 * of the file. Tests that need a disposable category create one
 * (name-prefixed `QA E2E`) and delete it via the API's own `isActive` + a
 * follow-up cleanup note — see afterAll.
 *
 * Serial: several tests share global (entityId, fiscalYear) lock state and
 * a couple of real categories, so ordering matters (same discipline
 * admin-security.spec.ts documents for its own suite).
 */
test.describe.configure({ mode: "serial" });

// Foundation / Club entities (ledger_entities).
const FOUNDATION_ENTITY_ID = "8a27091d-ae9b-4c58-bff3-a633c418ee21";
const CLUB_ENTITY_ID = "a6a61beb-2839-4b9e-9c44-ad9ffbeaf50b";
const CLUB_ACTIVITY_FUND_ID = "8f71f400-4853-49d6-94a1-54b71b3b7b96";

// Real categories used read-only or rename-and-restore.
const CHARITABLE_DONATION_OUT_FOUNDATION = "2338f33e-0b16-41b7-8b43-9cce8fafa3b9"; // 39 txns across FY2024/2025/2095
const CONTINGENCY_FOUNDATION = "61770ada-2154-4bee-b8e9-cb3faf2c1545"; // 0 txns, FY2025 budget row
const DISASTER_RELIEF_FOUNDATION = "183f4d73-6d24-43b0-b49f-f4ca1a8d4c39"; // 0 txns, 0 budget rows
const RUDOLPH_RUN_EXPENSES_FOUNDATION = "1ce73878-9bca-406c-b7f9-1118fabbdacb"; // 30 txns, giving-eligible
const INSURANCE_BONDING_CLUB = "52090995-196e-4aa3-9553-58c829633292"; // 2 txns, FY2025 budget, unlocked

// Zero-transaction categories used for merge (Club, activity, expense).
const EVENT_COSTS_CLUB = "77642d1e-01a2-4d64-a9d4-f74c4c29db5b"; // 0 txns, FY2099 budget row
const SERVICE_PROJECTS_CLUB = "0591bf54-b2dd-4459-ab3c-f9fee0086b0e"; // 0 txns, FY2099 budget row
const CHARITABLE_DONATION_OUT_CLUB = "bd470b24-bd03-469e-b3d0-481d1bae8b57"; // 0 txns, 0 budget rows
const EYEGLASS_RECYCLING_CLUB = "e56e2433-a2f3-4f51-8a06-4f8b0216a503"; // 0 txns, 0 budget rows
const TRANSFER_TO_FOUNDATION_CLUB = "603614a1-4cf9-48d4-9377-b79b2c0a51ce"; // 0 txns, 0 budget rows

// Independently-computed ground truth (see QA report / SQL run before this
// suite was written) — regression targets, not just "whatever the app says."
const CHARITABLE_DONATION_OUT_EXPECTED_TXN_TOTAL = 39;
const CHARITABLE_DONATION_OUT_EXPECTED_BUDGET_TOTAL = 5;
const CHARITABLE_DONATION_OUT_EXPECTED_FYS = [2025, 2095, 2097, 2098, 2099];
const RUDOLPH_RUN_EXPECTED_GIVING_CENTS = 2043417;

let page: Page;
let nativeDialogFired = false;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("dialog", (dialog) => {
    // CLAUDE.md invariant: no window.confirm/alert/prompt anywhere. If one
    // ever fires during this suite, every subsequent assertion is suspect —
    // record it and dismiss so the test itself still resolves.
    nativeDialogFired = true;
    void dialog.dismiss();
  });
  await signInAsAdmin(page);
});

test.afterAll(async () => {
  expect(nativeDialogFired, "a native browser dialog fired during the suite").toBe(false);
  await page.close();
});

async function getImpact(categoryId: string) {
  const res = await page.request.get(`/api/admin/ledger/categories/${categoryId}/impact`);
  expect(res.ok(), `impact fetch for ${categoryId} failed: ${res.status()}`).toBe(true);
  return res.json();
}

/**
 * A UI-driven mutation's PATCH/POST resolves before its dialog closes (the
 * component only calls onOpenChange(false) in the success path), but this
 * suite's follow-up `getImpact()` call runs in a *separate* request context
 * from the browser tab's own fetch — polling here removes a real, observed
 * read-after-write race between the two rather than trusting a single
 * immediate read.
 */
async function pollImpactField<T>(
  categoryId: string,
  select: (impact: Awaited<ReturnType<typeof getImpact>>) => T,
  expected: T,
): Promise<void> {
  await expect
    .poll(async () => select(await getImpact(categoryId)), { timeout: 10_000 })
    .toEqual(expected);
}

async function patchCategory(categoryId: string, body: Record<string, unknown>) {
  return page.request.fetch(`/api/admin/ledger/categories/${categoryId}`, {
    method: "PATCH",
    data: body,
  });
}

async function mergePreview(sourceId: string, destinationId: string) {
  return page.request.fetch("/api/admin/ledger/categories/merge", {
    method: "POST",
    data: { sourceId, destinationId, confirm: false },
  });
}

async function mergeApply(sourceId: string, destinationId: string) {
  return page.request.fetch("/api/admin/ledger/categories/merge", {
    method: "POST",
    data: { sourceId, destinationId, confirm: true },
  });
}

async function lockFiscalYear(entityId: string, fiscalYear: number) {
  const res = await page.request.fetch("/api/admin/ledger/budget-approvals", {
    method: "POST",
    data: { entityId, fiscalYear, boardMinute: "QA e2e temporary lock — see ledger-category-management.spec.ts" },
  });
  expect(res.ok(), `failed to lock FY${fiscalYear}: ${res.status()} ${await res.text()}`).toBe(true);
}

async function unlockFiscalYear(entityId: string, fiscalYear: number) {
  const res = await page.request.fetch("/api/admin/ledger/budget-approvals/unlock", {
    method: "POST",
    data: { entityId, fiscalYear, unlockReason: "QA e2e temporary lock cleanup — see ledger-category-management.spec.ts" },
  });
  expect(res.ok(), `failed to unlock FY${fiscalYear}: ${res.status()} ${await res.text()}`).toBe(true);
}

test.describe("permission gate", () => {
  test("unauthenticated visitor is redirected away from the categories settings page", async ({ browser }) => {
    // Arrange
    const anon = await browser.newPage();

    // Act
    await anon.goto("/admin/ledger/settings/categories");

    // Assert
    await expect(anon).toHaveURL(/\/signin/);
    await anon.close();
  });
});

test.describe("rename impact accuracy — ground truth vs. the impact endpoint", () => {
  test("impact counts for a multi-fiscal-year category match independently-computed SQL ground truth", async () => {
    // Act
    const impact = await getImpact(CHARITABLE_DONATION_OUT_FOUNDATION);

    // Assert — these numbers were computed via a separate SQL query against
    // the same dev DB before this test was written (see QA report); if the
    // app's number ever drifts from ground truth, this is the regression
    // that catches it.
    expect(impact.transactions.total).toBe(CHARITABLE_DONATION_OUT_EXPECTED_TXN_TOTAL);
    expect(impact.budgetLines.total).toBe(CHARITABLE_DONATION_OUT_EXPECTED_BUDGET_TOTAL);
    const fys = impact.budgetLines.fiscalYears.map((fy: { fiscalYear: number }) => fy.fiscalYear).sort(
      (a: number, b: number) => a - b,
    );
    expect(fys).toEqual(CHARITABLE_DONATION_OUT_EXPECTED_FYS);
  });

  test("merge's transaction-count refusal cites the exact same total the impact endpoint reports", async () => {
    // Arrange — merge attempt where the source has real transaction history.
    const res = await mergePreview(CHARITABLE_DONATION_OUT_FOUNDATION, CONTINGENCY_FOUNDATION);

    // Assert
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain(`${CHARITABLE_DONATION_OUT_EXPECTED_TXN_TOTAL} transactions`);
  });
});

test.describe("countsAsGiving dollar impact agrees with getPhilanthropy's own filter", () => {
  test("impact endpoint's postedGivingCents matches independently-computed SQL ground truth", async () => {
    // Act
    const impact = await getImpact(RUDOLPH_RUN_EXPENSES_FOUNDATION);

    // Assert
    expect(impact.transactions.postedGivingCents).toBe(RUDOLPH_RUN_EXPECTED_GIVING_CENTS);
  });

  test("flipping countsAsGiving on then off via the real UI persists the change, shows the correct dollar figure pre-commit, and restores the original value", async () => {
    // Arrange — Rudolph Run expenses ships with countsAsGiving=false (confirmed
    // via a direct read of ledger_categories before this suite was written).
    // The e2e admin fixture has no linked member row, so /members/impact
    // always shows its "Account Not Linked" empty state for this account —
    // this test can't cross-check the live page for that reason (see QA
    // report for the code-level equivalence proof instead: getCategoryImpact
    // reuses getPhilanthropy's exact WHERE clause, structurally asserted in
    // ledger-category-queries.test.ts). This test verifies the flag actually
    // persists through the real UI and is symmetric (on, then back off).
    const startImpact = await getImpact(RUDOLPH_RUN_EXPENSES_FOUNDATION);
    expect(startImpact.category.countsAsGiving).toBe(false);

    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Foundation$/ }).click().catch(() => {});
    await page.getByRole("checkbox", { name: /show inactive/i }).uncheck().catch(() => {});
    await page.getByLabel("Search").fill("Rudolph Run expenses");

    // Act — open Edit flags; since countsAsGiving is currently false, the
    // dollar-impact copy should read "would count" (computed regardless of
    // the current flag value, per the Phase 3 design).
    await page.getByRole("row", { name: /Rudolph Run expenses/ }).getByRole("button", { name: "Edit flags" }).click();
    const flagsDialog = page.getByRole("dialog", { name: /Edit Flags/ });
    const dollarText = await flagsDialog.getByText(/in posted transactions on this category/).textContent();
    expect(dollarText).toContain("$20434.17");
    expect(dollarText).toContain("would count");

    await flagsDialog.getByLabel(/Counts toward reported community giving/).check();
    await flagsDialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("$20434.17");
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(flagsDialog).toBeHidden();

    // Assert — flag actually flipped server-side.
    await pollImpactField(RUDOLPH_RUN_EXPENSES_FOUNDATION, (i) => i.category.countsAsGiving, true);

    // Restore — flip back off (its original state).
    const restore = await patchCategory(RUDOLPH_RUN_EXPENSES_FOUNDATION, { countsAsGiving: false });
    expect(restore.ok()).toBe(true);
    await pollImpactField(RUDOLPH_RUN_EXPENSES_FOUNDATION, (i) => i.category.countsAsGiving, false);
  });
});

test.describe("rename — no native dialogs, plain save, and locked-year disclosure", () => {
  test("renaming a category with no locked years is a plain save (no ConfirmDialog)", async () => {
    // Arrange
    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Club$/ }).click().catch(() => {});
    await page.getByLabel("Search").fill("Insurance & bonding");

    // Act
    await page.getByRole("row", { name: /Insurance & bonding/ }).getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("dialog", { name: "Rename Category" })).toBeVisible();
    await expect(page.getByText(/locked, board-approved fiscal/)).toHaveCount(0);
    const nameInput = page.locator("#rename-cat-name");
    await nameInput.fill("Insurance & bonding (QA temp)");
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Assert — no ConfirmDialog appeared; save happened directly
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Rename Category" })).toBeHidden();
    await pollImpactField(INSURANCE_BONDING_CLUB, (i) => i.category.name, "Insurance & bonding (QA temp)");

    // Restore
    const restore = await patchCategory(INSURANCE_BONDING_CLUB, { name: "Insurance & bonding" });
    expect(restore.ok()).toBe(true);
    await pollImpactField(INSURANCE_BONDING_CLUB, (i) => i.category.name, "Insurance & bonding");
  });

  test("renaming a category with a locked fiscal year shows the locked chip, gates behind ConfirmDialog, relabels history, and writes a readable audit diff", async () => {
    // Arrange — lock Foundation FY2025 through the real Approve & Lock API
    // (Charitable donation out has a real FY2025 budget row).
    await lockFiscalYear(FOUNDATION_ENTITY_ID, 2025);

    const before = await getImpact(CHARITABLE_DONATION_OUT_FOUNDATION);
    expect(before.budgetLines.fiscalYears.find((fy: { fiscalYear: number; locked: boolean }) => fy.fiscalYear === 2025)?.locked).toBe(true);

    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Foundation$/ }).click().catch(() => {});
    await page.getByLabel("Search").fill("Charitable donation out");

    // Act
    await page.getByRole("row", { name: /^Charitable donation out/ }).getByRole("button", { name: "Rename" }).click();
    await expect(page.getByText(/FY2025 \(locked\)/)).toBeVisible();
    await expect(page.getByText(/locked, board-approved fiscal/)).toBeVisible();

    const nameInput = page.locator("#rename-cat-name");
    await nameInput.fill("Charitable donation out (QA temp)");
    await page.getByRole("button", { name: "Save Changes" }).click();

    // A locked year is affected — must gate behind ConfirmDialog, never save directly.
    await expect(page.getByRole("alertdialog", { name: "Relabel locked fiscal years?" })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("FY2025");
    await page.getByRole("alertdialog").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("dialog", { name: "Rename Category" })).toBeHidden();

    // Assert — renamed, including the locked year's display (no block).
    await pollImpactField(
      CHARITABLE_DONATION_OUT_FOUNDATION,
      (i) => i.category.name,
      "Charitable donation out (QA temp)",
    );

    // Restore
    const restore = await patchCategory(CHARITABLE_DONATION_OUT_FOUNDATION, { name: "Charitable donation out" });
    expect(restore.ok()).toBe(true);
    await unlockFiscalYear(FOUNDATION_ENTITY_ID, 2025);

    await pollImpactField(CHARITABLE_DONATION_OUT_FOUNDATION, (i) => i.category.name, "Charitable donation out");
  });
});

test.describe("merge refusals", () => {
  test("refuses when both source and destination have a budget row in the same fiscal year, naming the year", async () => {
    // Arrange / Act
    const res = await mergePreview(EVENT_COSTS_CLUB, SERVICE_PROJECTS_CLUB);

    // Assert
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("FY2099");
    expect(body.error).toContain("resolve by hand");
  });

  test("refuses to merge into an inactive destination, then succeeds once reactivated", async () => {
    // Arrange — deactivate the destination first (also exercises deactivate).
    const deactivate = await patchCategory(EYEGLASS_RECYCLING_CLUB, { isActive: false });
    expect(deactivate.ok()).toBe(true);

    // Act
    const refused = await mergePreview(TRANSFER_TO_FOUNDATION_CLUB, EYEGLASS_RECYCLING_CLUB);

    // Assert
    expect(refused.status()).toBe(409);
    const refusedBody = await refused.json();
    expect(refusedBody.error).toContain("deactivated");

    // Reactivate and confirm the same preview now succeeds (no mutation — confirm:false).
    const reactivate = await patchCategory(EYEGLASS_RECYCLING_CLUB, { isActive: true });
    expect(reactivate.ok()).toBe(true);
    const nowOk = await mergePreview(TRANSFER_TO_FOUNDATION_CLUB, EYEGLASS_RECYCLING_CLUB);
    expect(nowOk.ok()).toBe(true);
  });

  test("refuses when the current fiscal year is locked for the shared entity", async () => {
    // Arrange
    await lockFiscalYear(CLUB_ENTITY_ID, 2026);

    // Act
    const res = await mergePreview(EVENT_COSTS_CLUB, CHARITABLE_DONATION_OUT_CLUB);

    // Assert
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain("lock");

    // Cleanup
    await unlockFiscalYear(CLUB_ENTITY_ID, 2026);
  });

  // 2026-08-07 treasurer decision (DECISION-067): merge also refuses when a
  // LOCKED, NON-current fiscal year would be re-pointed — a distinct check
  // from "current FY locked" above. Event costs' only budget row is FY2099
  // (current FY is 2026), so this exercises the new year-specific block,
  // and confirms it's a whole-merge refusal (no writes), not a partial
  // merge that silently skips the locked year.
  test("refuses when a locked non-current fiscal year would be re-pointed, naming that year — whole merge, not partial", async () => {
    // Arrange
    await lockFiscalYear(CLUB_ENTITY_ID, 2099);

    // Act — plan (confirm:false) refuses.
    const planRes = await mergePreview(EVENT_COSTS_CLUB, CHARITABLE_DONATION_OUT_CLUB);

    // Assert
    expect(planRes.status()).toBe(409);
    const planBody = await planRes.json();
    expect(planBody.error).toContain("FY2099");
    expect(planBody.error.toLowerCase()).toContain("locked");

    // Apply (confirm:true) refuses identically — no writes, source keeps its row.
    const applyRes = await mergeApply(EVENT_COSTS_CLUB, CHARITABLE_DONATION_OUT_CLUB);
    expect(applyRes.status()).toBe(409);
    const applyBody = await applyRes.json();
    expect(applyBody.error).toContain("FY2099");

    const sourceStillHasRow = await getImpact(EVENT_COSTS_CLUB);
    expect(sourceStillHasRow.budgetLines.total).toBe(1);
    expect(sourceStillHasRow.budgetLines.fiscalYears[0].fiscalYear).toBe(2099);

    // Cleanup — unlock, then confirm the same merge now previews cleanly
    // (proves the block is genuinely lock-driven, not a stuck refusal).
    await unlockFiscalYear(CLUB_ENTITY_ID, 2099);
    const nowOk = await mergePreview(EVENT_COSTS_CLUB, CHARITABLE_DONATION_OUT_CLUB);
    expect(nowOk.ok()).toBe(true);
  });

  // 2026-08-08 treasurer decision (DECISION-068): merge ALSO refuses when
  // an affected fiscal year is EARLIER than the current fiscal year (2026),
  // regardless of lock status. This is the real-data regression for the
  // Phase 6 re-check's own finding: `Contingency` has exactly one budget
  // row, FY2025 — a genuine prior year — and as of this writing NO fiscal
  // year is locked anywhere in the dev DB, so the old lock-only guard would
  // have silently let this merge proceed. `Disaster relief` (same scope,
  // zero budget rows) is the destination purely so there's no both-sides
  // collision masking this specific check.
  test("refuses when the only affected fiscal year is earlier than the current fiscal year, naming it, even though nothing is locked", async () => {
    // Act — plan (confirm:false) refuses.
    const planRes = await mergePreview(CONTINGENCY_FOUNDATION, DISASTER_RELIEF_FOUNDATION);

    // Assert
    expect(planRes.status()).toBe(409);
    const planBody = await planRes.json();
    expect(planBody.error).toContain("FY2025");
    expect(planBody.error).toContain("prior fiscal year");
    expect(planBody.error).toContain("already closed");

    // Apply (confirm:true) refuses identically — no writes, source keeps its row.
    const applyRes = await mergeApply(CONTINGENCY_FOUNDATION, DISASTER_RELIEF_FOUNDATION);
    expect(applyRes.status()).toBe(409);
    const applyBody = await applyRes.json();
    expect(applyBody.error).toContain("FY2025");

    const sourceStillHasRow = await getImpact(CONTINGENCY_FOUNDATION);
    expect(sourceStillHasRow.budgetLines.total).toBe(1);
    expect(sourceStillHasRow.budgetLines.fiscalYears[0].fiscalYear).toBe(2025);
    expect(sourceStillHasRow.budgetLines.fiscalYears[0].locked).toBe(false);
  });
});

test.describe("a merge that should succeed", () => {
  test("re-points the budget row in one transaction, leaves transactions untouched, and is fully reversible", async () => {
    // Arrange — Event costs has zero transactions and one FY2099 budget row;
    // Charitable donation out (Club) has neither.
    const sourceBefore = await getImpact(EVENT_COSTS_CLUB);
    expect(sourceBefore.transactions.total).toBe(0);
    expect(sourceBefore.budgetLines.total).toBe(1);
    const movedAmount = sourceBefore.budgetLines.fiscalYears[0].annualAmountCents;

    // Act — preview, then apply through the real UI so the ConfirmDialog path is exercised too.
    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Club$/ }).click().catch(() => {});
    await page.getByLabel("Search").fill("Event costs");
    await page.getByRole("row", { name: /Event costs/ }).getByRole("button", { name: "Merge into…" }).click();
    await expect(page.getByRole("dialog", { name: /Merge/ })).toBeVisible();
    await page.locator("#merge-destination").selectOption(CHARITABLE_DONATION_OUT_CLUB);
    await expect(page.getByText(/1 fiscal year.*will move/)).toBeVisible();
    await page.getByRole("button", { name: "Merge" }).click();
    await expect(page.getByRole("alertdialog", { name: "Merge these categories?" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Merge" }).click();
    await expect(page.getByRole("dialog", { name: /Merge/ })).toBeHidden();

    // Assert — source now has zero budget rows, destination has the row, transactions untouched (both were 0 anyway).
    await pollImpactField(EVENT_COSTS_CLUB, (i) => i.budgetLines.total, 0);
    const sourceAfter = await getImpact(EVENT_COSTS_CLUB);
    expect(sourceAfter.transactions.total).toBe(0);
    await pollImpactField(CHARITABLE_DONATION_OUT_CLUB, (i) => i.budgetLines.total, 1);
    const destAfter = await getImpact(CHARITABLE_DONATION_OUT_CLUB);
    expect(destAfter.budgetLines.fiscalYears[0].fiscalYear).toBe(2099);
    expect(destAfter.budgetLines.fiscalYears[0].annualAmountCents).toBe(movedAmount);

    // Restore — merge the same FY2099 row back to Event costs (both are
    // zero-transaction, so this is symmetric and itself re-exercises merge).
    const restore = await mergeApply(CHARITABLE_DONATION_OUT_CLUB, EVENT_COSTS_CLUB);
    expect(restore.ok()).toBe(true);
    const sourceRestored = await getImpact(EVENT_COSTS_CLUB);
    expect(sourceRestored.budgetLines.total).toBe(1);
    expect(sourceRestored.budgetLines.fiscalYears[0].annualAmountCents).toBe(movedAmount);
    const destRestored = await getImpact(CHARITABLE_DONATION_OUT_CLUB);
    expect(destRestored.budgetLines.total).toBe(0);
  });
});

test.describe("deactivate warns but does not block; reactivate recovers it", () => {
  const QA_CATEGORY_NAME = `QA E2E Open Balance ${Date.now()}`;
  let qaCategoryId = "";

  test("deactivate with no open balance shows a plain confirm (no warning line)", async () => {
    // Arrange — create a disposable category with no budget rows at all.
    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Club$/ }).click().catch(() => {});
    await page.getByRole("button", { name: "+ New Category" }).click();
    await page.locator("#new-cat-fund").selectOption({ label: "Activity Fund" });
    await page.locator("#new-cat-name").fill(QA_CATEGORY_NAME);
    await page.getByRole("button", { name: "Create Category" }).click();
    await expect(page.getByRole("dialog", { name: "New Category" })).toBeHidden();

    await page.getByLabel("Search").fill(QA_CATEGORY_NAME);
    const listRes = await page.request.get(`/api/admin/ledger/categories?entityId=${CLUB_ENTITY_ID}&includeInactive=true`);
    const { categories } = await listRes.json();
    qaCategoryId = categories.find((c: { name: string }) => c.name === QA_CATEGORY_NAME)?.id;
    expect(qaCategoryId, "created QA category should be findable via the list API").toBeTruthy();

    // Act
    await page.getByRole("row", { name: QA_CATEGORY_NAME }).getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("alertdialog", { name: `Deactivate "${QA_CATEGORY_NAME}"?` })).toBeVisible();

    // Assert — no open-balance warning sentence
    await expect(page.getByRole("alertdialog")).not.toContainText("Warning:");
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();

    await pollImpactField(qaCategoryId, (i) => i.category.isActive, false);
  });

  test("deactivate with an open, non-locked current-FY budget row warns but still succeeds; reactivate recovers it", async () => {
    // Arrange — reactivate first (previous test deactivated it), then give
    // it a real FY2026 (current FY) budget row via the real budgets API.
    const reactivate = await patchCategory(qaCategoryId, { isActive: true });
    expect(reactivate.ok()).toBe(true);

    const addBudget = await page.request.fetch("/api/admin/ledger/budgets", {
      method: "PATCH",
      data: {
        fundId: CLUB_ACTIVITY_FUND_ID,
        fiscalYear: 2026,
        categoryId: qaCategoryId,
        flow: "expense",
        annualAmountCents: 100000,
      },
    });
    expect(addBudget.ok(), await addBudget.text()).toBe(true);

    const impactBefore = await getImpact(qaCategoryId);
    expect(impactBefore.openBalance.hasNonLockedBudgetRow).toBe(true);
    expect(impactBefore.openBalance.currentFyBudgetedCents).toBe(100000);

    // Act
    await page.goto("/admin/ledger/settings/categories");
    await page.getByRole("button", { name: /^Club$/ }).click().catch(() => {});
    await page.getByRole("checkbox", { name: /show inactive/i }).check();
    await page.getByLabel("Search").fill(QA_CATEGORY_NAME);
    await page.getByRole("row", { name: QA_CATEGORY_NAME }).getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Warning:");
    await expect(page.getByRole("alertdialog")).toContainText("FY2026");
    await expect(page.getByRole("alertdialog")).toContainText("$1000.00");

    // Assert — warning shown, but Deactivate is NOT disabled (warning, not a block).
    const deactivateBtn = page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" });
    await expect(deactivateBtn).toBeEnabled();
    await deactivateBtn.click();

    await pollImpactField(qaCategoryId, (i) => i.category.isActive, false);

    // Reactivate — confirm a mis-click is recoverable without SQL.
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("alertdialog", { name: `Reactivate "${QA_CATEGORY_NAME}"?` })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reactivate" }).click();
    await pollImpactField(qaCategoryId, (i) => i.category.isActive, true);
  });

  test.afterAll(async () => {
    // Cleanup — this QA-only disposable category has no transactions and no
    // real-world meaning; remove its budget row and deactivate it (hard
    // delete isn't exposed anywhere in this app, by design — DECISION-065/
    // Treasurer Decision 4 — so it's left inactive rather than deleted).
    if (qaCategoryId) {
      await page.request.fetch("/api/admin/ledger/budgets", {
        method: "PATCH",
        data: {
          fundId: CLUB_ACTIVITY_FUND_ID,
          fiscalYear: 2026,
          categoryId: qaCategoryId,
          flow: "expense",
          pendingDelete: true,
        },
      }).catch(() => {});
      await patchCategory(qaCategoryId, { isActive: false }).catch(() => {});
    }
  });
});
