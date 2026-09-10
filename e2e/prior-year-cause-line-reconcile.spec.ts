import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { cleanupBudgetFixture } from "./helpers/ledger-fixture-cleanup";

/**
 * Regression test for the 2026-07-30 loop-back bug fix — see
 * docs/work-log/2026-07-30-prior-year-line-items.md (Bug Finding) and
 * docs/work-log/2026-07-28-causeline-prior-year-reference.md (Phase 4
 * loop-back increment).
 *
 * BUG: a cause/beneficiary budget line item added or edited in the CURRENT
 * browser session always showed "—" for Prior Budget / Prior Actual, even
 * when a matching prior-FY value existed — only a hard, full-page reload
 * picked it up. Root cause: BudgetCauseEditor's local `rows` state seeded
 * priorBudgetCents/priorActualCents once at mount (and always `null` for a
 * brand-new row via addRowForCause), with no effect reconciling them
 * against the fresh, server-recomputed `initialLines` prop that arrives
 * after commitCreate's own `router.refresh()`.
 *
 * FIX: BudgetCauseEditor now reconciles each committed row's read-only
 * priorBudgetCents/priorActualCents against `initialLines` whenever that
 * prop's identity changes (i.e. after any router.refresh()), matched by the
 * row's own committed `id`. This test proves the live-update path end to
 * end WITHOUT ever calling page.reload() — that's the whole point.
 *
 * Uses a dedicated, never-otherwise-used fiscal-year pair (FY2097 = the
 * seeded "prior" year, FY2098 = the "current" year under test) on the
 * Foundation entity's Charitable fund, so this test never touches real
 * treasurer data or the FY2099 fixture budgeting-restructure.spec.ts owns.
 * Same rationale as that suite: there is no destructive cleanup path for
 * this data through the UI short of finalizing the budget or reaching into
 * the DB directly. 2026-09-09 remediation (docs/reviews/2026-09-09-test-
 * coverage.md): "left in place" was a real cleanup gap — this suite's own
 * Step 1 assumed FY2097 started with no "E2E QA Prior-Ref Pilot Dogs" line
 * under Vision & Eye Care, which stopped being true the second time this
 * suite ever ran. beforeAll/afterAll below now delete the FY2097/FY2098
 * budget fixture directly.
 */

const FOUNDATION_ENTITY_SLUG = "foundation";
// Static catalog reference id (ledger_entities.id for the Foundation entity
// — same id transaction-budget-line-link.spec.ts hardcodes as
// FOUNDATION_ENTITY_ID) — needed by the beforeAll/afterAll fixture cleanup.
const FOUNDATION_ENTITY_ID = "8a27091d-ae9b-4c58-bff3-a633c418ee21";
const CHARITABLE_FUND_SLUG = "charitable";
const PRIOR_FY = 2097;
const CURRENT_FY = 2098;
const CATEGORY_NAME = "Charitable donation out";
const CAUSE = "Vision & Eye Care";
const LABEL = "E2E QA Prior-Ref Pilot Dogs";
const CAUSE_LINES_PATCH_URL = "/api/admin/ledger/budgets/cause-lines";

/**
 * 2026-09-09 remediation (docs/reviews/2026-09-09-test-coverage.md): points
 * at the FUND's own drill-down, not the bare `/admin/ledger/budgeting`
 * overview. This test predates the Budgeting Overview/Drill-Down
 * Restructure (2026-07-30, same day as the bug this test guards against)
 * and was never updated for it — budgeting-restructure.spec.ts,
 * budget-star-notes.spec.ts, and transaction-budget-line-link.spec.ts all
 * document the same move ("the full editor... now lives [on the
 * drill-down]... the overview is read-only by design"). The bare overview
 * URL renders a read-only summary with no category-level detail at all —
 * no "Charitable donation out" text, no "+ Add cause" button anywhere on
 * the page — so this test's very first interaction always timed out
 * waiting for a control the current page can never show. The original
 * diagnosis attributed this failure to fixture pollution (a leftover cause
 * group from a prior run); the DB evidence was real, but the deeper cause
 * is this stale URL — confirmed by checking the live page directly: even
 * with FY2097/2098 fully cleaned, `/admin/ledger/budgeting?entity=
 * foundation&fy=2097` still never renders "Charitable donation out".
 */
function budgetingUrl(fy: number): string {
  return `/admin/ledger/budgeting/${CHARITABLE_FUND_SLUG}?entity=${FOUNDATION_ENTITY_SLUG}&fy=${fy}`;
}

/** Scopes to the OUTER per-category <div> — mirrors budgeting-restructure.spec.ts's own helper. */
function categoryRow(page: Page, categoryName: string) {
  return page
    .locator(`xpath=//span[normalize-space(text())="${categoryName}"]/ancestor::div[2]`)
    .first();
}

/** Scopes to the OUTER per-cause-group <div> — mirrors budgeting-restructure.spec.ts's own helper. */
function causeGroup(page: Page, cause: string) {
  return page.locator(`xpath=//p[normalize-space(text())="${cause}"]/ancestor::div[2]`).first();
}

/** Fills a never-saved cause-line row's amount then label, awaiting each
 *  field's own blur-triggered PATCH before moving on — see
 *  budgeting-restructure.spec.ts's fillAndCommitCauseLine for why the order
 *  and the wait both matter (the blur-vs-focus race between fields). */
async function fillAndCommitCauseLine(
  page: Page,
  params: { amount: string; label: string },
): Promise<void> {
  await page.getByLabel(`Amount for ${CAUSE}`, { exact: true }).fill(params.amount);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_PATCH_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);
  await page.getByLabel(`Label for this ${CAUSE} line`).last().fill(params.label);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_PATCH_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);
}

test.describe("Prior-year cause-line reference reconciles live, no reload required", () => {
  test.beforeAll(async () => {
    await cleanupBudgetFixture({ entityId: FOUNDATION_ENTITY_ID, fiscalYears: [PRIOR_FY, CURRENT_FY] });
  });

  test.afterAll(async () => {
    await cleanupBudgetFixture({ entityId: FOUNDATION_ENTITY_ID, fiscalYears: [PRIOR_FY, CURRENT_FY] });
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("a cause line added this session shows its Prior Budget value immediately after commit", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    // --- Step 1: seed FY2097 ("prior") with a committed cause line under
    // Charitable donation out / Vision & Eye Care, labeled to match what
    // Step 2 will add for FY2098. ---
    await page.goto(budgetingUrl(PRIOR_FY));
    await categoryRow(page, CATEGORY_NAME)
      .getByRole("button", { name: "+ Add cause" })
      .click();
    await page.getByRole("button", { name: CAUSE, exact: true }).click();
    await fillAndCommitCauseLine(page, { amount: "1000.00", label: LABEL });

    await expect(causeGroup(page, CAUSE)).toContainText("Subtotal: $1000.00", {
      timeout: 10_000,
    });

    // --- Step 2: FY2098 ("current") — add a NEW line under the same
    // category/cause with the SAME label. Before the fix, Prior Budget
    // stayed "—" here for the rest of the browser session even after the
    // commit landed; only a hard page.reload() would pick it up. This test
    // never calls page.reload() after this point. ---
    await page.goto(budgetingUrl(CURRENT_FY));
    await categoryRow(page, CATEGORY_NAME)
      .getByRole("button", { name: "+ Add cause" })
      .click();
    await page.getByRole("button", { name: CAUSE, exact: true }).click();

    const currentGroup = causeGroup(page, CAUSE);
    const priorBudgetValue = currentGroup
      .locator("p", { hasText: "Prior Budget" })
      .locator("xpath=following-sibling::p[1]");

    // Sanity check: before the label matches anything, Prior Budget is
    // correctly "—" (nothing to match yet — this is not the bug).
    await expect(priorBudgetValue).toHaveText("—");

    await fillAndCommitCauseLine(page, { amount: "1200.00", label: LABEL });

    // THE FIX: once the label commits and matches FY2097's line by
    // (category, cause, label), Prior Budget updates to $1000.00 in this
    // same session — no page.reload() anywhere in this test.
    await expect(priorBudgetValue).toHaveText("$1000.00", { timeout: 10_000 });

    // The line's own amount is untouched by the reconcile (only the
    // read-only reference fields are ever synced by the fix).
    await expect(page.getByLabel(`Amount for ${CAUSE} (${LABEL})`)).toHaveValue("1200.00");
  });
});
