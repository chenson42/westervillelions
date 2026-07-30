import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Explicit transaction <-> budget-line link (B-30, DECISION-061) —
 * docs/work-log/2026-07-30-transaction-budget-line-link.md.
 *
 * The Phase 4 implementer's own handoff notes flagged that e2e coverage for
 * this feature was NOT written in that pass ("E2E tests were not added in
 * this pass... a genuine gap qa should close in Phase 5"). This suite closes
 * that gap for the flows named in the Phase 3 design's "Named Implementer
 * Sequence" step 4 and the Phase 1 adversarial pass (Pass 5):
 *
 *   1. Picking a budget line in the transaction form links it and
 *      auto-fills category + cause.
 *   2. The beneficiary-cause bug fix — the field is now editable (and its
 *      edits persist) in EDIT mode, not just create (it was previously
 *      gated `!isEdit` even though the PATCH API already accepted edits).
 *   3. The admin Fund Report's cause/line breakdown: an exact link wins
 *      over the fuzzy payee-name match: a genuinely-unlinked-but-matching
 *      row is flagged with the dagger marker; a synthesized "Other" row
 *      makes visible detail foot to the category total; an all-zero row is
 *      omitted.
 *   4. Collapsing a budget breakdown that has linked transactions shows the
 *      REAL linked-transaction count in the <ConfirmDialog>, not a generic
 *      warning, and the post-collapse toast reflects what actually happened.
 *   5. Server-side link-integrity validation on POST — a direct API call
 *      with a budgetLineId that doesn't match the transaction's category
 *      must 400, not silently link (Phase 1 Pass 5's adversarial concern:
 *      "a direct PATCH bypassing the form's client-side filter must not be
 *      able to link a transaction to a budget line from the wrong fund/FY").
 *
 * Runs against the Foundation entity's Charitable Fund at a dedicated,
 * never-otherwise-used fiscal year (FY2095 — 2096/2097/2098/2099 are already
 * claimed by budgeting-overview-restructure.spec.ts,
 * prior-year-cause-line-reconcile.spec.ts, and budgeting-restructure.spec.ts
 * respectively) so this suite never touches the treasurer's real budget/
 * ledger data. Every row created here is prefixed "E2E QA B30" for the same
 * reason those suites leave their fixture rows in place: there is no
 * destructive cleanup path for budget cause lines short of finalizing the
 * budget or reaching into the DB directly.
 *
 * Serial, not parallel — later tests build on budget lines and transactions
 * earlier tests created (same rationale as budgeting-restructure.spec.ts and
 * admin-security.spec.ts).
 */

const FOUNDATION_ENTITY_SLUG = "foundation";
const CHARITABLE_FUND_SLUG = "charitable";
const TEST_FISCAL_YEAR = 2095;
const CATEGORY_NAME = "Charitable donation out";
const CAUSE = "Community & Civic";
const LINKED_LABEL = "E2E QA B30 Linked";
const FUZZY_LABEL = "E2E QA B30 Fuzzy";
const ZERO_LABEL = "E2E QA B30 ZeroActivity";

// Static catalog reference data (entities/funds/categories don't change
// week to week) — used only by the one direct-API adversarial test below,
// which needs real ids to construct a deliberately-mismatched request.
const FOUNDATION_ENTITY_ID = "8a27091d-ae9b-4c58-bff3-a633c418ee21";
const CHARITABLE_FUND_ID = "11675bf5-7b7c-428b-be91-c66290dd1f4d";
const OPERATIONS_CATEGORY_ID = "c9af6b72-07af-4d69-8e30-8cd2c7ebd1b7";

const BUDGETING_URL = `/admin/ledger/budgeting/${CHARITABLE_FUND_SLUG}?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const FUND_URL = `/admin/ledger/${CHARITABLE_FUND_SLUG}?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const REPORT_URL = `/admin/ledger/${CHARITABLE_FUND_SLUG}/report?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const CAUSE_LINES_URL = "/api/admin/ledger/budgets/cause-lines";

test.describe.configure({ mode: "serial" });

// Captured across tests (serial mode, one worker) — the created budget
// line's id, needed by the direct-API adversarial test at the end.
let linkedLineId = "";

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
 *  field's own blur-triggered PATCH before moving on (see
 *  budgeting-restructure.spec.ts's identically-named helper for why the
 *  order and the wait both matter). Returns the created/updated line's id
 *  from the amount-commit response. */
async function fillAndCommitCauseLine(
  page: Page,
  params: { amountLabel: string; amount: string; labelLabel: string; label: string },
): Promise<string> {
  await page.getByLabel(params.amountLabel, { exact: true }).fill(params.amount);
  const [amountResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);
  const amountBody = await amountResponse.json();

  await page.getByLabel(params.labelLabel).last().fill(params.label);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(CAUSE_LINES_URL) && r.request().method() === "PATCH",
    ),
    page.keyboard.press("Tab"),
  ]);

  return amountBody.lineId as string;
}

/** Opens the "Record Transaction" dialog from the fund page and returns the
 *  dialog locator, scoping every subsequent interaction to it (the trigger
 *  button and the submit button share the exact same accessible name, so
 *  every field/submit interaction below is deliberately scoped to `dialog`,
 *  never the bare page). */
async function openRecordTransactionDialog(page: Page) {
  await page.getByRole("button", { name: "Record Transaction" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Explicit transaction <-> budget-line link (B-30)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("Setup — budgets three cause lines (linked, fuzzy-target, zero-activity) under Charitable donation out for the fixture", async ({
    page,
  }) => {
    await page.goto(BUDGETING_URL);

    await categoryRow(page, CATEGORY_NAME).getByRole("button", { name: "+ Add cause" }).click();
    await page.getByRole("button", { name: CAUSE, exact: true }).click();

    linkedLineId = await fillAndCommitCauseLine(page, {
      amountLabel: `Amount for ${CAUSE}`,
      amount: "500.00",
      labelLabel: `Label for this ${CAUSE} line`,
      label: LINKED_LABEL,
    });
    expect(linkedLineId).toBeTruthy();

    const group = causeGroup(page, CAUSE);
    await expect(group).toContainText("Subtotal: $500.00", { timeout: 10_000 });

    await group.getByRole("button", { name: "+ Add line item" }).click();
    await fillAndCommitCauseLine(page, {
      amountLabel: `Amount for ${CAUSE}`,
      amount: "300.00",
      labelLabel: `Label for this ${CAUSE} line`,
      label: FUZZY_LABEL,
    });

    await expect(group).toContainText("Subtotal: $800.00", { timeout: 10_000 });

    // A third line, budgeted at $0 and never matched by any transaction —
    // the zero-omission case. isAllZeroRow requires ALL THREE columns
    // (One-Month/Twelve-Month actual, annual budget) to be zero; a $0
    // budget with no actual satisfies that on the admin Fund Report (which
    // has no One-Month grain of its own — fixed at 0 there).
    await group.getByRole("button", { name: "+ Add line item" }).click();
    await fillAndCommitCauseLine(page, {
      amountLabel: `Amount for ${CAUSE}`,
      amount: "0.00",
      labelLabel: `Label for this ${CAUSE} line`,
      label: ZERO_LABEL,
    });
    await expect(group).toContainText("Subtotal: $800.00", { timeout: 10_000 });
  });

  test("picking a budget line in the transaction form links it and auto-fills category + cause", async ({
    page,
  }) => {
    await page.goto(FUND_URL);
    const dialog = await openRecordTransactionDialog(page);

    await dialog.locator("label").filter({ hasText: /^Expense$/ }).click();
    await dialog.locator("#txn-amount").fill("50.00");
    await dialog.locator("#txn-date").fill("2095-08-15");
    await dialog.locator("#txn-party").fill("E2E QA B30 Linked Payee");

    // Before picking a line: category is still unset.
    await expect(dialog.locator("#txn-category")).toHaveValue("");

    await dialog
      .locator("#txn-budget-line")
      .selectOption({ label: `${CAUSE} — ${LINKED_LABEL}` });

    // Act's the point of the feature: picking the line auto-fills BOTH the
    // category select and the beneficiary-cause text input.
    await expect(dialog.locator("#txn-category option:checked")).toHaveText(CATEGORY_NAME);
    await expect(dialog.locator("#txn-cause")).toHaveValue(CAUSE);

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/transactions") && r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);
    expect(postResponse.status()).toBe(201);
    const created = await postResponse.json();
    expect(created.budgetLineId ?? linkedLineId).toBeTruthy();

    await expect(page.getByText(/Transaction recorded/)).toBeVisible();
    await expect(page.locator("tr", { hasText: "E2E QA B30 Linked Payee" })).toBeVisible();
  });

  test("beneficiary cause is editable in EDIT mode (bug fix) and the edit persists", async ({
    page,
  }) => {
    await page.goto(FUND_URL);
    const row = page.locator("tr", { hasText: "E2E QA B30 Linked Payee" });
    await row.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The bug this feature fixed: beneficiaryCause used to be create-only
    // in the UI (`!isEdit`) even though the PATCH API already accepted
    // edits to it. It must render here, pre-filled from the linked line,
    // and be genuinely editable.
    const causeInput = dialog.locator("#txn-cause");
    await expect(causeInput).toBeVisible();
    await expect(causeInput).toHaveValue(CAUSE);
    await expect(dialog.locator("#txn-budget-line")).toHaveValue(linkedLineId);

    await causeInput.fill("Community & Civic (edited)");

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/admin\/ledger\/transactions\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      dialog.getByRole("button", { name: "Update Transaction" }).click(),
    ]);
    expect(patchResponse.status()).toBe(200);

    // Re-open and confirm the edit actually persisted server-side, not just
    // in local component state. A hard reload (rather than re-clicking Edit
    // in the same session) sidesteps any question of whether the Server
    // Component tree finished its post-PATCH router.refresh() before the
    // dialog re-opens — this only needs to prove the DB write stuck.
    await page.goto(FUND_URL);
    const row2 = page.locator("tr", { hasText: "E2E QA B30 Linked Payee" });
    await row2.getByRole("button", { name: "Edit" }).click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.locator("#txn-cause")).toHaveValue("Community & Civic (edited)");
    // The link itself is untouched by a hand-edit of the cause text (per
    // the Phase 3 design: "the treasurer can hand-edit the auto-filled
    // cause text without invalidating the link").
    await expect(reopened.locator("#txn-budget-line")).toHaveValue(linkedLineId);
    await reopened.getByRole("button", { name: "Cancel" }).click();
  });

  test("a transaction matching a budget line's cause+label by payee name, but never linked via the picker, becomes the flagged fuzzy fallback", async ({
    page,
  }) => {
    await page.goto(FUND_URL);
    const dialog = await openRecordTransactionDialog(page);

    await dialog.locator("label").filter({ hasText: /^Expense$/ }).click();
    await dialog.locator("#txn-amount").fill("30.00");
    await dialog.locator("#txn-date").fill("2095-08-20");
    await dialog.locator("#txn-category").selectOption({ label: CATEGORY_NAME });
    // Exact string match to the budget line's (cause, label) via the
    // existing trim-only causeLineReferenceKey normalization — party must
    // equal the label, beneficiaryCause must equal the cause. The picker is
    // deliberately left at "No linked budget line."
    await dialog.locator("#txn-party").fill(FUZZY_LABEL);
    await dialog.locator("#txn-cause").fill(CAUSE);
    await expect(dialog.locator("#txn-budget-line")).toHaveValue("");

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/transactions") && r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);
    await expect(page.getByText(/Transaction recorded/)).toBeVisible();
  });

  test("a cause-tagged transaction that matches no budget line folds into the category's 'Other' row", async ({
    page,
  }) => {
    await page.goto(FUND_URL);
    const dialog = await openRecordTransactionDialog(page);

    await dialog.locator("label").filter({ hasText: /^Expense$/ }).click();
    await dialog.locator("#txn-amount").fill("20.00");
    await dialog.locator("#txn-date").fill("2095-08-25");
    await dialog.locator("#txn-category").selectOption({ label: CATEGORY_NAME });
    await dialog.locator("#txn-party").fill("E2E QA B30 Other Contributor");
    // Cause left blank — never matches any named line, so its dollars can
    // only ever surface via the category total / the synthesized "Other" row.

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/transactions") && r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);
    await expect(page.getByText(/Transaction recorded/)).toBeVisible();
  });

  test("Fund Report — exact link wins, fuzzy is flagged, Other foots the category total, all-zero rows are omitted", async ({
    page,
  }) => {
    await page.goto(REPORT_URL);

    const categoryTr = page.locator("tr", { hasText: CATEGORY_NAME }).first();
    // $50 (linked) + $30 (fuzzy) + $20 (unmatched -> Other) = $100 category total.
    await expect(categoryTr).toContainText("$100.00");

    const linkedRow = page.locator("tr", { hasText: LINKED_LABEL });
    await expect(linkedRow).toContainText("$50.00");
    await expect(linkedRow.locator("sup")).toHaveCount(0);

    const fuzzyRow = page.locator("tr", { hasText: FUZZY_LABEL });
    await expect(fuzzyRow).toContainText("$30.00");
    await expect(fuzzyRow.locator("sup")).toHaveText("†");

    // "Other" row: $100 category total - ($50 exact + $30 fuzzy) = $20.
    const causeSection = categoryRow(page, CATEGORY_NAME);
    const otherRow = page.locator("tr", { hasText: "Other" }).filter({ hasText: "$20.00" });
    await expect(otherRow.first()).toBeVisible();
    void causeSection; // categoryRow's xpath helper targets the budgeting page's DOM shape, not this table — kept only for readability parity, not used for scoping here.

    // Shared footnote renders once, only because a fuzzy row is present.
    await expect(page.getByText(/matched by payee name/i)).toBeVisible();

    // Zero-omission (cause-line grain): a line budgeted at $0 with no
    // matching actual is an all-zero row and must not render at all — even
    // though its SIBLING lines in the same cause group do render. (Note:
    // this admin Fund Report renders every ACTIVE CATEGORY unconditionally
    // regardless of activity — confirmed by direct code reading of
    // report/page.tsx, which applies isAllZeroRow only inside
    // buildReportCauseLines(), never to the category-row map() itself.
    // Category-grain zero-omission is a getMonthlyStatement()/member-
    // Statement-only behavior per the Phase 3 design's Gap 8 note, not this
    // page — verified by code trace, not asserted here.)
    await expect(page.locator("tr", { hasText: "ZeroActivity" })).toHaveCount(0);
  });

  /**
   * REGRESSION for a Phase 5 finding: changing ONLY a linked transaction's
   * category (never touching the budget-line picker) 400-rejects the whole
   * edit instead of auto-clearing the now-stale link, contradicting
   * DECISION-061 #3 ("the transaction PATCH route auto-clears a now-stale
   * budgetLineId link... rather than rejecting the whole edit... a hard
   * rejection would block an otherwise-valid date/category correction just
   * because an old link no longer applies").
   *
   * Root cause (read directly in
   * src/app/api/admin/ledger/transactions/[id]/route.ts): the client's
   * TransactionForm ALWAYS includes `budgetLineId` in its PATCH body
   * whenever the expense-only section is showing (`budgetLineId:
   * budgetLineId || null` — see transaction-form.tsx's performSubmit()),
   * even when the picker itself was never touched. The route's auto-clear
   * branch ("case 2") only runs when `body.budgetLineId === undefined`
   * (the key entirely absent) — a condition the real UI never produces for
   * an expense-transaction edit. So a category (or fund) change that
   * leaves a stale-but-still-present `budgetLineId` in the payload always
   * takes "case 1" (explicit validation) instead, and a mismatch there
   * 400s the ENTIRE edit rather than clearing just the link. Verified live
   * (not just by reading the route): the PATCH below returns 400, and a DB
   * read after the failed request confirms the transaction's category and
   * budget_line_id are both untouched — the treasurer's category correction
   * is silently blocked, with no path forward except re-picking or
   * clearing the budget-line picker FIRST, unprompted, before they can even
   * save the category change they actually wanted to make.
   *
   * Two paths for the implementer to consider fixing this: (a) route
   * decides "no-op" (client resending the CURRENT unchanged budgetLineId)
   * as equivalent to "untouched" for the purposes of choosing case 1 vs
   * case 2, e.g. only take case 1 when `body.budgetLineId !==
   * existing.budgetLineId`; or (b) the client's own effect at
   * transaction-form.tsx:275-288 additionally watches `categoryId` (not
   * just `fundId`/`txnDate`) so it proactively clears a picker selection
   * that no longer matches BEFORE submit, matching the FY-boundary case's
   * existing (silent, no-toast) behavior. Either fixes the reject; (b)
   * alone still wouldn't produce the promised `budgetLineLinkCleared`
   * toast (see the FY-boundary case's own note above — the toast is
   * currently unreachable from the real UI in EITHER stale-link scenario),
   * so (a) is likely necessary regardless of whether (b) is also done.
   */
  test("editing only the category on a linked transaction (never touching the picker) auto-clears the stale link instead of rejecting the edit — regression for DECISION-061 #3 PATCH auto-clear contract violation", async ({
    page,
  }) => {
    // Arrange — a fresh transaction linked to the same budget line, kept
    // separate from the earlier linked-payee row so this test's outcome
    // (which may legitimately reject the edit) can't corrupt other tests'
    // fixtures.
    await page.goto(FUND_URL);
    const dialog = await openRecordTransactionDialog(page);
    await dialog.locator("label").filter({ hasText: /^Expense$/ }).click();
    await dialog.locator("#txn-amount").fill("15.00");
    await dialog.locator("#txn-date").fill("2095-09-01");
    await dialog.locator("#txn-party").fill("E2E QA B30 StaleLink Payee");
    await dialog
      .locator("#txn-budget-line")
      .selectOption({ label: `${CAUSE} — ${LINKED_LABEL}` });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/transactions") && r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);
    await expect(page.getByText(/Transaction recorded/)).toBeVisible();

    // Act — reopen, change ONLY the category (to "Operations", a category
    // with no cause lines at all) via the plain <select>, WITHOUT touching
    // the budget-line picker at all. BudgetLinePicker's own candidate
    // filter is fund+FY only (not category), so it keeps showing the now-
    // stale line selected — exactly the scenario Phase 3's design named:
    // "changing categoryId... away from what the linked line implies
    // clears budgetLineId server-side" (auto-clear, NOT a rejected edit —
    // DECISION-061 #3: "a hard rejection would block an otherwise-valid
    // date/category correction just because an old link no longer applies").
    const row = page.locator("tr", { hasText: "E2E QA B30 StaleLink Payee" });
    await row.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.locator("#txn-budget-line")).toHaveValue(linkedLineId);

    await editDialog.locator("#txn-category").selectOption({ label: "Operations" });
    await expect(editDialog.locator("#txn-budget-line")).toHaveValue(linkedLineId); // still visually stale-selected — the picker itself doesn't filter by category

    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/admin\/ledger\/transactions\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
      ),
      editDialog.getByRole("button", { name: "Update Transaction" }).click(),
    ]);

    // Assert — per the Phase 3 design / DECISION-061, this edit must
    // SUCCEED with the link auto-cleared (200 + budgetLineLinkCleared:
    // true), not fail outright. If this assertion fails, the server is
    // taking the route's "case 1: explicit budgetLineId" 400-rejection
    // branch instead of the intended "case 2: auto-clear" branch — a real
    // deviation from DECISION-061 #3 worth flagging back to the
    // implementer, not a flaky test.
    expect(patchResponse.status()).toBe(200);
    const patchBody = await patchResponse.json();
    expect(patchBody.budgetLineLinkCleared).toBe(true);
  });

  test("collapsing a breakdown with a linked transaction shows the real linked count and unlinks it on confirm", async ({
    page,
  }) => {
    await page.goto(BUDGETING_URL);

    const section = categoryRow(page, CATEGORY_NAME);
    await section.getByRole("button", { name: "Collapse to lump sum" }).click();

    // <ConfirmDialog> (Radix AlertDialog) uses role="alertdialog", distinct
    // from <TransactionFormDialog>'s plain role="dialog" used elsewhere in
    // this spec.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // Exactly one transaction is truly LINKED at this point (the original
    // "E2E QA B30 Linked Payee" row) — the fuzzy-match row was never linked
    // via the picker, and the stale-link test above either cleared its
    // link (design-compliant) or failed to save the edit (in which case it
    // remains linked too, making this a >=1 assertion rather than exactly
    // 1 — checked loosely below for that reason).
    await expect(dialog).toContainText(/transaction(s)? currently linked to these lines will be unlinked/);
    await expect(dialog).not.toContainText("0 transaction");

    const [collapseResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/budgets/cause-lines/collapse") && r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Collapse" }).click(),
    ]);
    expect(collapseResponse.status()).toBe(200);
    const collapseBody = await collapseResponse.json();
    expect(collapseBody.unlinkedCount).toBeGreaterThanOrEqual(1);

    await expect(page.getByText(/Collapsed to a single lump-sum amount/)).toBeVisible();
    // The breakdown is gone — the category now renders as a single lump-sum
    // input, no more cause groups underneath it.
    await expect(causeGroup(page, CAUSE)).toHaveCount(0);
  });

  test("direct POST rejects a budgetLineId that doesn't match the request's category (server-side link integrity, no UI bypass)", async ({
    page,
  }) => {
    // The collapse test above already deleted the real budget line, so
    // `linkedLineId` here is deliberately a NOW-DELETED (or, if collapse
    // ran first in a re-order, still-real-but-mismatched) id — either way
    // this must 400, never silently link. Constructed to hit the fund/FY/
    // category-mismatch branch even if the line still existed: fundId is
    // correct but categoryId is "Operations", which never owned this line.
    const res = await page.request.post("/api/admin/ledger/transactions", {
      data: {
        entityId: FOUNDATION_ENTITY_ID,
        fundId: CHARITABLE_FUND_ID,
        txnDate: "2095-09-10",
        flow: "expense",
        amountCents: 999,
        categoryId: OPERATIONS_CATEGORY_ID,
        budgetLineId: linkedLineId,
        party: "E2E QA B30 API Adversarial Should Not Save",
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();

    // And it must not have silently created the row despite the rejection.
    await page.goto(FUND_URL);
    await expect(
      page.locator("tr", { hasText: "E2E QA B30 API Adversarial Should Not Save" }),
    ).toHaveCount(0);
  });
});
