import { test, expect, type Page, type Request } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Budgeting Page Restructure — docs/work-log/2026-07-29-budgeting-restructure.md.
 *
 * Covers the Phase 5 QA focus areas named in the API/UI implementers'
 * handoff notes: the blur-vs-click race fix (the whole reason for this
 * feature), lump-sum <-> cause-breakdown transitions, delayed-commit
 * line-item Undo, cause-group remove/restore, category remove-in-breakdown
 * (Flow 6, deliberately unconfirmed per Phase 3's override of Phase 1),
 * live-total bookkeeping, the print worksheet's cause/line detail, and
 * mobile tap targets.
 *
 * Runs against the Foundation entity's Charitable Fund at a dedicated,
 * never-otherwise-used fiscal year (FY2099) so this suite never touches the
 * treasurer's real FY2026 budget data. Every row this suite creates is
 * prefixed "E2E QA" for the same reason admin-security.spec.ts leaves its
 * marker rows behind: there is no destructive cleanup path for this data
 * short of finalizing the budget (which would create a real board-approval
 * audit record) or reaching into the DB directly, so the FY2099 fixture is
 * intentionally left in place — not a cleanup gap.
 *
 * IMPORTANT DISCOVERY baked into this suite's design: getFundReport()
 * returns a line for EVERY active category in the entity's catalog,
 * regardless of whether a real ledger_budgets row exists yet for the
 * target FY (see the page.tsx comment: "In practice getFundReport already
 * returns every active category as a line, so [unbudgetedCategories] is
 * usually empty"). That means (a) the "Charitable donation out" category
 * is ALREADY present as a blank lump-sum row the moment FY2099 loads — no
 * "+ Add category" interaction is needed to reach it — and (b) the
 * true literal "zero categories in this flow" empty state (Flow 7) isn't
 * reachable through the existing category catalog, since every fund_kind
 * in this system already has categories in both flows. Flow 7's structural
 * guarantee (each section renders its own header/add-control independent
 * of the other) is verified by a lighter assertion here and confirmed by
 * code review of renderFlowSection in guided-budget-setup.tsx.
 *
 * Serial, not parallel: every test after the first builds on state the
 * previous test left behind (two cause groups under one category, several
 * lines) — this mirrors admin-security.spec.ts's own documented rationale
 * for serial mode and is the only practical way to exercise a multi-step
 * treasurer workflow against a real server without re-deriving the whole
 * setup in every test.
 */

const FOUNDATION_ENTITY_SLUG = "foundation";
const TEST_FISCAL_YEAR = 2099;
const BUDGETING_URL = `/admin/ledger/budgeting?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const CATEGORY_NAME = "Charitable donation out";

test.describe.configure({ mode: "serial" });

/** Scopes to the OUTER per-category <div> — 2 ancestor <div>s up from the
 *  categoryName <span>, a structure verified identical across all three of
 *  BudgetEditor's render branches (lump-sum, breakdown, pending-delete). */
function categoryRow(page: Page, categoryName: string) {
  return page
    .locator(`xpath=//span[normalize-space(text())="${categoryName}"]/ancestor::div[2]`)
    .first();
}

/** Scopes to the OUTER per-cause-group <div> in BudgetCauseEditor — 2
 *  ancestor <div>s up from the cause-name <p>. Needed because "+ Add line
 *  item" has no distinguishing aria-label and canonical ALL_CAUSES order
 *  (Youth & Education before Environment) doesn't match insertion order. */
function causeGroup(page: Page, cause: string) {
  return page.locator(`xpath=//p[normalize-space(text())="${cause}"]/ancestor::div[2]`).first();
}

const CAUSE_LINES_PATCH_URL = "/api/admin/ledger/budgets/cause-lines";

/**
 * Fills a never-saved cause-line row's amount then label, waiting for each
 * field's own blur-triggered PATCH to actually resolve before moving to the
 * next field. Required, not just belt-and-suspenders: each field commits
 * independently on blur (`commitRow`), so filling amount then label without
 * waiting lets the label-field's focus (which blurs the amount field) race
 * the amount commit's in-flight fetch — and that commit's own success
 * handler unconditionally overwrites `row.label` from the server response,
 * silently wiping out a label typed in the meantime. Awaiting each PATCH in
 * turn is what a real treasurer's actual typing cadence (pause between
 * fields) already avoids in practice; this just makes the test do the same.
 */
async function fillAndCommitCauseLine(
  page: Page,
  params: { amountLabel: string; amount: string; labelLabel: string; label: string },
): Promise<void> {
  // exact: true — getByLabel does substring matching by default, and a
  // bare "Amount for Environment" (blank/never-labeled row) is itself a
  // substring of an already-labeled sibling row's aria-label ("Amount for
  // Environment (E2E QA Env One)"), so an inexact match is ambiguous the
  // moment a group has more than one row.
  await page.getByLabel(params.amountLabel, { exact: true }).fill(params.amount);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_PATCH_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);
  await page.getByLabel(params.labelLabel).last().fill(params.label);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_PATCH_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);
}

test.describe("Budgeting page restructure — /admin/ledger/budgeting", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("unauthenticated visitor is redirected away from the budgeting page", async ({
    browser,
  }) => {
    // Arrange — a fresh, unauthenticated context (not the signed-in `page` fixture)
    const context = await browser.newContext();
    const page = await context.newPage();

    // Act
    await page.goto(BUDGETING_URL);

    // Assert
    await expect(page).toHaveURL(/\/signin/);
    await context.close();
  });

  test("Flow 7 — each flow's section renders its own header + add-category control independently", async ({
    page,
  }) => {
    // Arrange / Act
    await page.goto(BUDGETING_URL);

    // Assert — both sections' add-category triggers are present
    // independently (renderFlowSection is called once per flow per fund,
    // per guided-budget-setup.tsx). The literal "zero categories at all"
    // empty-state text isn't reachable here since every fund_kind in this
    // catalog already has categories in both flows (verified via code
    // review of the "usually empty" unbudgetedCategories comment in
    // page.tsx) — this asserts the structural guarantee instead.
    await expect(page.getByRole("button", { name: "+ Add income category" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add expense category" })).toBeVisible();
    await expect(page.getByLabel(`Budget for ${CATEGORY_NAME} (expense)`)).toBeVisible();
  });

  test("'+ Add cause' on an already-listed lump-sum category enters breakdown pre-filled to the CHOSEN cause (not the old hard default)", async ({
    page,
  }) => {
    // Arrange — the category is already listed as a blank lump-sum row;
    // no "+ Add category" step is needed (see file-level doc comment)
    await page.goto(BUDGETING_URL);
    const row = categoryRow(page, CATEGORY_NAME);
    await expect(row.getByLabel(`Budget for ${CATEGORY_NAME} (expense)`)).toBeVisible();

    // Act — first "+ Add cause" pick
    await row.getByRole("button", { name: "+ Add cause" }).click();
    await expect(page.getByRole("button", { name: "Environment", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Environment", exact: true }).click();

    // Assert — breakdown entered, pre-filled to the CHOSEN cause, not
    // "Other community support" (the old hard-defaulted fallback this
    // feature retired)
    await expect(page.locator("p", { hasText: "Environment" })).toBeVisible();
    await expect(page.getByText("Other community support")).toHaveCount(0);

    // Act — fill and commit the first line (amount then label, each
    // blur-committed and awaited in turn — see fillAndCommitCauseLine's
    // doc comment for why this order/wait matters)
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Environment",
      amount: "100.00",
      labelLabel: "Label for this Environment line",
      label: "E2E QA Env One",
    });

    // Assert — persisted (subtotal reflects the final commit)
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $100.00", {
      timeout: 10_000,
    });
  });

  test("'+ Add cause' stays visible after first use and adds a second, independent group", async ({
    page,
  }) => {
    // Arrange
    await page.goto(BUDGETING_URL);
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $100.00");
    const row = categoryRow(page, CATEGORY_NAME);

    // Act — second cause pick on the SAME category, already in breakdown
    await row.getByRole("button", { name: "+ Add cause" }).click();
    await expect(page.getByRole("button", { name: "Environment", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Youth & Education", exact: true }).click();
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Youth & Education",
      amount: "50.00",
      labelLabel: "Label for this Youth & Education line",
      label: "E2E QA Youth One",
    });

    // Assert — new group appended without disturbing the first group
    await expect(causeGroup(page, "Youth & Education")).toContainText("Subtotal: $50.00", {
      timeout: 10_000,
    });
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $100.00");
    await expect(page.getByLabel("Amount for Environment (E2E QA Env One)")).toHaveValue("100.00");
  });

  test("'+ Add line item' appends a second line to an existing group with no cause dropdown", async ({
    page,
  }) => {
    // Arrange
    await page.goto(BUDGETING_URL);
    const envGroup = causeGroup(page, "Environment");

    // Act — Environment's own "+ Add line item" (scoped to its group
    // container, not positional — canonical ALL_CAUSES order renders Youth
    // & Education before Environment, the opposite of insertion order)
    await envGroup.getByRole("button", { name: "+ Add line item" }).click();

    // Assert — no per-line cause <select> within this cause group (the
    // dropdown this feature removed entirely). Scoped to the group, not the
    // whole page, since the page's own Fiscal Year picker is a real
    // <select> too; the label input's "combobox" ARIA role comes from its
    // <datalist> autocomplete, not a cause picker, so this checks for an
    // actual <select> tag rather than the ARIA combobox role.
    await expect(envGroup.locator("select")).toHaveCount(0);
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Environment",
      amount: "40.00",
      labelLabel: "Label for this Environment line",
      label: "E2E QA Env Two",
    });

    // Assert — Environment subtotal now reflects both lines
    await expect(envGroup).toContainText("Subtotal: $140.00", { timeout: 10_000 });
  });

  test("regression: a single click on a different row's remove control always registers — no second click required (Gap 4)", async ({
    page,
  }) => {
    // Arrange — focus a committed row's amount input and type a NEW value
    // without blurring (the exact repro named in the work-log: "focus any
    // amount input, type a value, then — without blurring first — click a
    // different row's remove control").
    await page.goto(BUDGETING_URL);
    const envOneAmount = page.getByLabel("Amount for Environment (E2E QA Env One)");
    await envOneAmount.click();
    await envOneAmount.fill("150.00");
    await expect(envOneAmount).toBeFocused();

    const youthRemove = page.getByRole("button", {
      name: "Remove Youth & Education (E2E QA Youth One) line",
    });

    // Act — ONE click on a different row's remove control
    await youthRemove.click();

    // Assert (mechanism) — the mousedown preventDefault fix means the
    // browser never shifted focus off the still-dirty Environment input, so
    // no racing blur-commit was ever queued in the first place.
    await expect(envOneAmount).toBeFocused();

    // Assert (user-visible outcome) — the click registered immediately;
    // the row is dead (holdingForDelete) after exactly one click, not two.
    await expect(page.getByText('Removed "E2E QA Youth One"')).toBeVisible();
    const youthAmountDead = page.getByLabel(
      "Amount for Youth & Education (E2E QA Youth One), marked for removal",
    );
    await expect(youthAmountDead).toBeVisible();

    // Act — Undo within the hold window (same control the toast's own
    // Undo action would have used — cancelHold either way)
    const youthRowUndo = youthAmountDead
      .locator("xpath=ancestor::div[contains(@class,'space-y-1')][1]")
      .getByRole("button", { name: "Undo" });
    await youthRowUndo.click();

    // Assert — Undo-in-time reverses cleanly, row is live again
    await expect(page.getByLabel("Amount for Youth & Education (E2E QA Youth One)")).toBeVisible();

    // Cleanup: put Environment's amount back to its committed value so
    // later steps' subtotal math stays predictable. Waits for the PATCH to
    // actually resolve (not just the optimistic client-side subtotal) —
    // the subtotal reflects typed-but-uncommitted state too, and this test
    // ending before the commit lands would race the NEXT test's page load.
    await envOneAmount.fill("100.00");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(CAUSE_LINES_PATCH_URL) && r.request().method() === "PATCH",
      ),
      page.keyboard.press("Tab"),
    ]);
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $140.00", {
      timeout: 10_000,
    });
  });

  test("delayed-commit Undo: clicking Undo in time fires zero network calls; letting the hold expire commits the flag-flip", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    // --- Part 1: Undo in time = zero network calls ---
    await page.goto(BUDGETING_URL);
    const causeLinePatches: Request[] = [];
    const trackPatches = (req: Request) => {
      if (
        req.method() === "PATCH" &&
        req.url().endsWith("/api/admin/ledger/budgets/cause-lines")
      ) {
        causeLinePatches.push(req);
      }
    };
    page.on("request", trackPatches);

    const envTwoRemove = page.getByRole("button", {
      name: "Remove Environment (E2E QA Env Two) line",
    });
    await envTwoRemove.click();
    await expect(page.getByText('Removed "E2E QA Env Two"').last()).toBeVisible();

    const envTwoDead = page.getByLabel(
      "Amount for Environment (E2E QA Env Two), marked for removal",
    );
    await expect(envTwoDead).toBeVisible();
    const envTwoUndo = envTwoDead
      .locator("xpath=ancestor::div[contains(@class,'space-y-1')][1]")
      .getByRole("button", { name: "Undo" });
    await envTwoUndo.click();
    await expect(page.getByLabel("Amount for Environment (E2E QA Env Two)")).toBeVisible();

    // Assert — Undo-in-time never touched the network at all
    expect(causeLinePatches.length).toBe(0);
    page.off("request", trackPatches);

    // --- Part 2: letting the hold expire commits the PATCH ---
    const patchesAfterExpiry: Request[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "PATCH" &&
        req.url().endsWith("/api/admin/ledger/budgets/cause-lines")
      ) {
        patchesAfterExpiry.push(req);
      }
    });
    await page.getByRole("button", { name: "Remove Environment (E2E QA Env Two) line" }).click();
    await expect(page.getByText('Removed "E2E QA Env Two"').last()).toBeVisible();

    // Do NOT click Undo — wait past the hold window (HOLD_MS = 6000ms)
    await page.waitForTimeout(7_000);
    expect(patchesAfterExpiry.some((r) => r.postDataJSON()?.pendingDelete === true)).toBe(true);

    // Assert — live totals already reflect the pending-delete line's
    // subtraction (causeLinePendingCents third arg) without a page reload
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $100.00", {
      timeout: 10_000,
    });

    // Assert — persisted server-side: after a full reload the line is still
    // Restore-able (not just a client-only hold that would have reset)
    await page.reload();
    const envTwoAfterReload = page.getByLabel(
      "Amount for Environment (E2E QA Env Two), marked for removal",
    );
    await expect(envTwoAfterReload).toBeVisible();
    const restoreBtn = envTwoAfterReload
      .locator("xpath=ancestor::div[contains(@class,'space-y-1')][1]")
      .getByRole("button", { name: "Restore" });
    await expect(restoreBtn).toBeVisible();
  });

  test("cause-group remove/restore: confirm dialog copy, mixed committed + uncommitted rows, group Restore", async ({
    page,
  }) => {
    // Arrange — add an uncommitted (never-saved) row to the Youth &
    // Education group, on top of its one committed line
    await page.goto(BUDGETING_URL);
    const youthGroup = causeGroup(page, "Youth & Education");
    await youthGroup.getByRole("button", { name: "+ Add line item" }).click();
    // Leave the new row blank/uncommitted on purpose.

    // Act — group remove
    await page
      .getByRole("button", { name: "Remove Youth & Education and its line items" })
      .click();

    // Assert — ConfirmDialog copy names the cause and the line count
    // (2: one committed + one uncommitted, per setGroupRemoveConfirm's
    // indices.length)
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Remove this cause group?")).toBeVisible();
    await expect(
      dialog.getByText(/Remove "Youth & Education" and its 2 line items\?/),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Remove", exact: true }).click();

    // Assert — the committed row goes dead as a unit; the uncommitted row
    // is dropped locally, not shown at all
    await expect(
      page.getByLabel("Amount for Youth & Education (E2E QA Youth One), marked for removal"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Label for this Youth & Education line")).toHaveCount(0);

    // Assert — persistent "Restore group" control (no time limit, distinct
    // from the per-line toast-Undo)
    const restoreGroup = page.getByRole("button", { name: "Restore group" });
    await expect(restoreGroup).toBeVisible();

    // Act — restore
    await restoreGroup.click();

    // Assert — back to normal, live
    await expect(
      page.getByLabel("Amount for Youth & Education (E2E QA Youth One)"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(causeGroup(page, "Youth & Education")).toContainText("Subtotal: $50.00");
  });

  test("Flow 6: category remove-in-breakdown opens a ConfirmDialog naming what it takes, then removes (Chris's decision 2026-07-29, restoring Phase 1's ask)", async ({
    page,
  }) => {
    // Arrange
    await page.goto(BUDGETING_URL);
    await expect(causeGroup(page, "Youth & Education")).toContainText("Subtotal: $50.00");

    // Act — category-level remove while in breakdown mode (Flow 6). This
    // used to 409 with has_cause_breakdown; the server guard is gone now.
    const categoryRemove = page.getByRole("button", {
      name: `Remove ${CATEGORY_NAME} (expense) from this year's budget`,
    });
    await categoryRemove.click();

    // Assert — a ConfirmDialog appears (unlike lump-sum removal), naming the
    // category and the cause / line-item count it will take with it. Chris
    // chose the confirm over unconfirmed-with-Restore in the Phase 6 review,
    // restoring his original Phase 1 Flow 6 ask.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(CATEGORY_NAME);
    await expect(confirm).toContainText(/line item/);

    // Act — confirm the removal
    await confirm.getByRole("button", { name: "Remove" }).click();

    // Assert — immediate "Deleted" treatment with the cause-line count hint.
    // At this point: Environment has 2 stored lines (E2E QA Env One live +
    // E2E QA Env Two individually pending-delete from the prior test) and
    // Youth & Education has 1 (E2E QA Youth One, restored) = 3 total.
    await expect(
      page.getByText(/Deleted — removed when finalized \(3 cause lines\)/),
    ).toBeVisible({ timeout: 10_000 });

    // Act — Restore the category
    const categoryRestore = page.getByRole("button", {
      name: `Restore ${CATEGORY_NAME} (expense) to this year's budget`,
    });
    await categoryRestore.click();

    // Assert — breakdown view returns with both groups intact
    await expect(causeGroup(page, "Environment")).toContainText("Subtotal: $100.00", {
      timeout: 10_000,
    });
    await expect(causeGroup(page, "Youth & Education")).toContainText("Subtotal: $50.00");
  });

  test("live totals: the fund card's Expenses total already excludes a pending-delete cause line before any reload", async ({
    page,
  }) => {
    // Arrange — Environment carries E2E QA Env One ($100, live) and E2E QA
    // Env Two ($40, individually pending-delete since the earlier expiry
    // test); Youth & Education carries E2E QA Youth One ($50, live). Every
    // OTHER category on this fund is still a blank/null placeholder ($0).
    // Expected live expense total: 100 + 50 = 150 (Env Two's $40 must NOT
    // be counted).
    await page.goto(BUDGETING_URL);

    // The <dl> has three <dt>/<dd> pairs (Income, Expenses, Net/Banked-used);
    // filtering the <dl> for "Expenses" text then grabbing the first "$..."
    // <dd> would actually grab Income's (first in DOM order), so target the
    // "Expenses" <dt>'s own sibling <dd> specifically.
    const expensesValue = page.locator(
      `xpath=//dt[normalize-space(text())="Expenses"]/following-sibling::dd[1]`,
    );

    // Assert — matches the live-only sum, not the stale annualAmountCents
    // total that would include the pending-delete line
    await expect(expensesValue).toHaveText("$150.00", { timeout: 10_000 });
  });

  test("print worksheet renders live cause/line detail compactly and excludes the pending-delete line", async ({
    page,
  }) => {
    // Arrange
    await page.goto(BUDGETING_URL);
    const worksheet = page.locator("h1:has-text('Budget Worksheet')").locator("..").locator("..");

    // Assert — live detail present (category, both live cause groups, live labels)
    await expect(worksheet).toContainText(CATEGORY_NAME);
    await expect(worksheet).toContainText("Environment");
    await expect(worksheet).toContainText("E2E QA Env One");
    await expect(worksheet).toContainText("Youth & Education");
    await expect(worksheet).toContainText("E2E QA Youth One");

    // Assert — the individually pending-delete line is excluded entirely
    await expect(worksheet).not.toContainText("E2E QA Env Two");
  });

  test("mobile at 360px: controls hit the 44px tap-target minimum and the page doesn't overflow horizontally", async ({
    page,
  }) => {
    // Arrange
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(BUDGETING_URL);

    // Assert — no horizontal overflow
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    // Assert — a sample of new controls this feature added meet the 44px minimum
    const row = categoryRow(page, CATEGORY_NAME);
    const addCauseButtonBox = await row.getByRole("button", { name: "+ Add cause" }).boundingBox();
    expect(addCauseButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    const removeButtonBox = await page
      .getByRole("button", {
        name: `Remove ${CATEGORY_NAME} (expense) from this year's budget`,
      })
      .boundingBox();
    expect(removeButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(removeButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("'+ Add category' creates a brand-new category (the 'new' mode, since 'existing' is unreachable while every catalog category is already listed)", async ({
    page,
  }) => {
    // Arrange
    await page.goto(BUDGETING_URL);
    await page.getByRole("button", { name: "+ Add income category" }).click();

    // Assert — no "Use an existing category" select renders (catalog-driven
    // fund/flow combos in this system always leave unbudgetedCategories
    // empty — see file-level doc comment) — goes straight to "new" mode
    await expect(page.getByLabel("Use an existing category")).toHaveCount(0);

    // Act
    await page.getByLabel("Category name").fill("E2E QA New Category");
    await page.getByRole("button", { name: "Create category" }).click();

    // Assert
    await expect(page.getByLabel("Budget for E2E QA New Category (income)")).toBeVisible({
      timeout: 10_000,
    });
  });
});
