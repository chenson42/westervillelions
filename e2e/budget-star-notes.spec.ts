import { test, expect, type Page, type Locator } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Budget Star & Notes — docs/work-log/2026-07-28-budget-star-notes.md,
 * DECISION-057.
 *
 * Covers the Phase 5 QA focus areas named in the api-developer/ux-developer
 * handoff notes — THE landmine (a star-only or note-only PATCH must never
 * zero an existing annualAmountCents or blank an existing note), the
 * un-budgeted-category lazy-create (no fake $0 shown), the lock-interaction
 * exception (annotation controls stay live and functional while amount
 * inputs are disabled), instant sort-to-top at both grains, a never-saved
 * cause line rendering only the reserved/disabled annotation-control
 * footprint (Budgeting UX Polish, 2026-07-30 — no layout jump once it
 * commits) rather than a working star/note pair until its first commit, a
 * soft-deleted/held cause line retaining working controls, and the print
 * worksheet rendering stars/notes compactly with no stray rows for a fund
 * that has none.
 *
 * Runs against the Club entity at a dedicated, never-otherwise-used fiscal
 * year (FY2099) — same isolation pattern as budgeting-restructure.spec.ts.
 * Uses the Activity Fund for every starred/noted fixture and leaves the
 * Administrative Fund (same entity, same FY) completely untouched so it
 * serves as the "zero stars/notes" control for the print-worksheet check.
 *
 * Budgeting Overview/Drill-Down Restructure (2026-07-30): editing now
 * happens on the Activity Fund's own drill-down page (DRILLDOWN_URL, one
 * fund only — several category names like "Program supplies" still exist in
 * BOTH funds' catalogs generally, but only Activity Fund's copy is ever on
 * screen here, so fund-scoping the locators below is now a belt-and-
 * suspenders habit rather than a strict necessity). Approve & lock / Unlock
 * and the print worksheet both moved to the overview (OVERVIEW_URL, shows
 * BOTH funds) — the lock test and the print-worksheet test navigate there
 * explicitly.
 *
 * Unlike budgeting-restructure.spec.ts, this suite DOES exercise the
 * Approve & lock / Unlock flow (needed to verify Decision 6's lock
 * exception) and therefore leaves a real ledger_budget_approvals audit row
 * behind if not cleaned up. QA cleans up FY2099 (both the ledger_budgets /
 * ledger_budget_lines rows this suite creates, via cascade, and the
 * ledger_budget_approvals row) via a direct DB delete after this suite
 * finishes running — see the Phase 5 work-log entry. Do not skip that
 * cleanup step: leaving it would poison budgeting-restructure.spec.ts's own
 * FY2099 fixture on its next run.
 *
 * Serial, not parallel: later tests depend on state earlier tests commit
 * (an already-$500-budgeted, already-noted, already-starred "Event costs"
 * row is the fixture the lock test and the print-worksheet test both read).
 */

const ENTITY_SLUG = "club";
const TEST_FISCAL_YEAR = 2099;
const ACTIVITY_FUND_SLUG = "activity";
const DRILLDOWN_URL = `/admin/ledger/budgeting/${ACTIVITY_FUND_SLUG}?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const OVERVIEW_URL = `/admin/ledger/budgeting?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;

const LANDMINE_CATEGORY = "Event costs"; // Activity Fund, expense — gets amount + star + note
const UNBUDGETED_CATEGORY = "Vision screening"; // Activity Fund, expense — star-only, never gets an amount
const CAUSE_CATEGORY = "Service projects"; // Activity Fund, expense, counts_as_giving=true — cause-line breakdown fixture (must be a giving-eligible category per isCauseEligibleCategory; "Program supplies" is NOT eligible and has no "+ Add cause" control at all)
const ACTIVITY_FUND_NAME = "Activity Fund";
const ADMIN_FUND_NAME = "Administrative Fund";

const NOTE_TEXT = "Confirm with committee before locking";
const CAUSE_NOTE_TEXT = "Board interest — discuss at meeting";

test.describe.configure({ mode: "serial" });

/** Scopes to one fund's whole review card in the interactive editor
 *  (h3 = fund name -> flex row -> header block -> outer card div). */
function fundCard(page: Page, fundName: string): Locator {
  return page.locator("h3", { hasText: fundName }).locator("xpath=ancestor::div[3]");
}

/** Scopes to the outer per-category <div> WITHIN a given fund card. Must use
 *  a dot-relative xpath (".//") — a bare "//" search ignores the scope and
 *  re-searches the whole document, which is exactly the bug this suite hit
 *  when Activity Fund and Administrative Fund both render "Program
 *  supplies" on the same page. */
function categoryRow(fund: Locator, categoryName: string): Locator {
  return fund
    .locator(`xpath=.//span[normalize-space(text())="${categoryName}"]/ancestor::div[2]`)
    .first();
}

/** Scopes to the outer per-cause-group <div> in BudgetCauseEditor, within a given fund card. */
function causeGroup(fund: Locator, cause: string): Locator {
  return fund.locator(`xpath=.//p[normalize-space(text())="${cause}"]/ancestor::div[2]`).first();
}

/** Scopes to one fund's printable worksheet <section> (h2 = fund name). */
function fundWorksheet(page: Page, fundName: string): Locator {
  return page.locator("h2", { hasText: fundName }).locator("xpath=ancestor::section[1]");
}

const CAUSE_LINES_PATCH_URL = "/api/admin/ledger/budgets/cause-lines";

/** Same field-by-field commit helper as budgeting-restructure.spec.ts — each
 *  field commits independently on blur, so waiting for each PATCH in turn
 *  avoids the label-blurs-amount race documented there. */
async function fillAndCommitCauseLine(
  page: Page,
  params: { amountLabel: string; amount: string; labelLabel: string; label: string },
): Promise<void> {
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

test.describe("Budget Star & Notes — /admin/ledger/budgeting", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("starring an un-budgeted category lazy-creates the row without showing a fake amount, and sorts it to the top of its section instantly", async ({
    page,
  }) => {
    // Arrange
    await page.goto(DRILLDOWN_URL);
    const activityFund = fundCard(page, ACTIVITY_FUND_NAME);
    const amountInputs = activityFund.getByLabel(/^Budget for .+ \(expense\)$/);
    const labelsBefore = await amountInputs.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    const indexBefore = labelsBefore.findIndex((l) => l?.includes(UNBUDGETED_CATEGORY));
    expect(indexBefore).toBeGreaterThan(0); // not already first within this fund's expense section

    const row = categoryRow(activityFund, UNBUDGETED_CATEGORY);
    const amountInput = row.getByLabel(`Budget for ${UNBUDGETED_CATEGORY} (expense)`);
    await expect(amountInput).toHaveValue("");

    const starButton = row.getByRole("button", {
      name: `Flag ${UNBUDGETED_CATEGORY} for discussion`,
    });

    // Act
    await starButton.click();

    // Assert — instant, optimistic: flips before any reload, amount stays blank
    await expect(
      row.getByRole("button", { name: `Unflag ${UNBUDGETED_CATEGORY} for discussion` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(amountInput).toHaveValue("");

    const labelsAfter = await amountInputs.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    const indexAfter = labelsAfter.findIndex((l) => l?.includes(UNBUDGETED_CATEGORY));
    expect(indexAfter).toBe(0);

    // Assert — persists after reload, and the lazy-created row still shows
    // no fabricated $0.00 — regression for the lazy-create-visible-$0 bug
    // (Phase 5, 2026-07-29): getFundReport's budgetMap.get(key) ?? null only
    // falls back to null when the row is ABSENT; once the lazy-create
    // insert lands, annualAmountCents: 0 is a real number, so budgetCents
    // comes back as 0 (not null), and budget-editor.tsx's `budgetCents !==
    // null ? ... : ""` seeding treats any non-null value — including a
    // lazily-created 0 — as "0.00". The Phase 3 design and the
    // ux-developer's own Phase 4 manual-check item both require this input
    // to stay blank; it does, right up until the first reload, then shows
    // "0.00". See the Phase 5 work-log entry for the full write-up.
    await page.reload();
    const activityFundAfter = fundCard(page, ACTIVITY_FUND_NAME);
    const rowAfterReload = categoryRow(activityFundAfter, UNBUDGETED_CATEGORY);
    await expect(
      rowAfterReload.getByRole("button", { name: `Unflag ${UNBUDGETED_CATEGORY} for discussion` }),
    ).toBeVisible();
    await expect(
      rowAfterReload.getByLabel(`Budget for ${UNBUDGETED_CATEGORY} (expense)`),
    ).toHaveValue("");
  });

  test("THE LANDMINE (exercised through the UI): star-only and note-only saves never zero an existing amount or blank an existing note", async ({
    page,
  }) => {
    // Arrange — give the category a real, non-zero budgeted amount first
    await page.goto(DRILLDOWN_URL);
    const activityFund = fundCard(page, ACTIVITY_FUND_NAME);
    const row = categoryRow(activityFund, LANDMINE_CATEGORY);
    const amountInput = row.getByLabel(`Budget for ${LANDMINE_CATEGORY} (expense)`);
    await amountInput.fill("500.00");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/ledger/budgets") && r.request().method() === "PATCH",
      ),
      amountInput.blur(),
    ]);
    await expect(amountInput).toHaveValue("500.00");

    // Act 1 — star only
    const starButton = row.getByRole("button", { name: `Flag ${LANDMINE_CATEGORY} for discussion` });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/annotations") &&
          r.request().method() === "PATCH",
      ),
      starButton.click(),
    ]);

    // Assert — amount untouched, immediately (no reload needed)
    await expect(amountInput).toHaveValue("500.00");

    // Assert — persists after reload (server round-trip, not just optimistic UI)
    await page.reload();
    const activityFundAfterStar = fundCard(page, ACTIVITY_FUND_NAME);
    const rowAfterStar = categoryRow(activityFundAfterStar, LANDMINE_CATEGORY);
    await expect(rowAfterStar.getByLabel(`Budget for ${LANDMINE_CATEGORY} (expense)`)).toHaveValue(
      "500.00",
    );
    await expect(
      rowAfterStar.getByRole("button", { name: `Unflag ${LANDMINE_CATEGORY} for discussion` }),
    ).toBeVisible();

    // Act 2 — note only (star already on; saving a note must not touch it)
    await rowAfterStar.getByRole("button", { name: `Add note for ${LANDMINE_CATEGORY}` }).click();
    await page.getByLabel(new RegExp(`Note for ${LANDMINE_CATEGORY}`)).fill(NOTE_TEXT);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/annotations") &&
          r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);

    // Assert — amount AND star both untouched by the note-only save
    await expect(rowAfterStar.getByLabel(`Budget for ${LANDMINE_CATEGORY} (expense)`)).toHaveValue(
      "500.00",
    );
    await expect(
      rowAfterStar.getByRole("button", { name: `Unflag ${LANDMINE_CATEGORY} for discussion` }),
    ).toBeVisible();

    // Assert — persists after reload: amount, star, AND note all present together
    await page.reload();
    const activityFundFinal = fundCard(page, ACTIVITY_FUND_NAME);
    const rowFinal = categoryRow(activityFundFinal, LANDMINE_CATEGORY);
    await expect(rowFinal.getByLabel(`Budget for ${LANDMINE_CATEGORY} (expense)`)).toHaveValue(
      "500.00",
    );
    await expect(
      rowFinal.getByRole("button", { name: `Unflag ${LANDMINE_CATEGORY} for discussion` }),
    ).toBeVisible();
    await expect(
      rowFinal.getByRole("button", { name: `Edit note for ${LANDMINE_CATEGORY}` }),
    ).toBeVisible();

    // Act 3 — toggle the star OFF, confirm the note is untouched (reverse direction)
    await rowFinal.getByRole("button", { name: `Unflag ${LANDMINE_CATEGORY} for discussion` }).click();
    await rowFinal.getByRole("button", { name: `Edit note for ${LANDMINE_CATEGORY}` }).click();
    await expect(page.getByLabel(new RegExp(`Note for ${LANDMINE_CATEGORY}`))).toHaveValue(
      NOTE_TEXT,
    );
    await page.getByRole("button", { name: "Cancel" }).click();

    // Cleanup for later tests (print worksheet expects this category
    // starred + noted + $500): restore the star
    await rowFinal.getByRole("button", { name: `Flag ${LANDMINE_CATEGORY} for discussion` }).click();
    await page.waitForTimeout(300);
  });

  test("cause-line grain: a never-saved row renders the reserved/disabled annotation-control footprint until its first commit; starring sorts within its own cause group; note persists", async ({
    page,
  }) => {
    // Arrange — put Program supplies (Activity Fund) into cause breakdown
    // with two committed lines. Fund-scoped throughout: Administrative
    // Fund has its own, unrelated "Program supplies" category on the same
    // page.
    await page.goto(DRILLDOWN_URL);
    const activityFund = fundCard(page, ACTIVITY_FUND_NAME);
    const row = categoryRow(activityFund, CAUSE_CATEGORY);
    await row.getByRole("button", { name: "+ Add cause" }).click();
    await activityFund.getByRole("button", { name: "Environment", exact: true }).click();
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Environment",
      amount: "30.00",
      labelLabel: "Label for this Environment line",
      label: "E2E QA Line A",
    });

    const envGroup = causeGroup(activityFund, "Environment");
    await envGroup.getByRole("button", { name: "+ Add line item" }).click();
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Environment",
      amount: "20.00",
      labelLabel: "Label for this Environment line",
      label: "E2E QA Line B",
    });

    // Act — add a THIRD, never-saved (uncommitted) row
    await envGroup.getByRole("button", { name: "+ Add line item" }).click();

    // Assert — exactly two star buttons exist in this group (A and B); the
    // brand-new blank row has none, by design (nothing to PATCH against yet)
    await expect(envGroup.getByRole("button", { name: /^Flag "E2E QA Line/ })).toHaveCount(2);

    // Assert (UX Polish, 2026-07-30) — the blank row still renders a
    // star/note control PAIR, in the exact same footprint a committed row
    // uses, just disabled and with a hint — reserved space, not a pop-in
    // once it commits. Exactly one of each (the one uncommitted row);
    // Line A/B's own committed buttons use a different (labeled) name so
    // they don't collide with this generic one.
    const reservedStar = envGroup.getByRole("button", {
      name: "Flag for discussion — save this line first",
    });
    const reservedNote = envGroup.getByRole("button", {
      name: "Add note for discussion — save this line first",
    });
    await expect(reservedStar).toHaveCount(1);
    await expect(reservedNote).toHaveCount(1);
    await expect(reservedStar).toBeDisabled();
    await expect(reservedNote).toBeDisabled();

    // Act — commit the third row; working controls should now appear for
    // it, replacing the reserved placeholder with no other layout change.
    await fillAndCommitCauseLine(page, {
      amountLabel: "Amount for Environment",
      amount: "15.00",
      labelLabel: "Label for this Environment line",
      label: "E2E QA Line C",
    });
    await expect(envGroup.getByRole("button", { name: /^Flag "E2E QA Line/ })).toHaveCount(3);
    await expect(reservedStar).toHaveCount(0);
    await expect(reservedNote).toHaveCount(0);

    // Soft-delete interaction (Decision 7): remove Line C, confirm its
    // annotation controls remain visible AND functional while dead
    await activityFund
      .getByRole("button", { name: "Remove Environment (E2E QA Line C) line" })
      .click();
    const lineCDeadAmount = activityFund.getByLabel(
      "Amount for Environment (E2E QA Line C), marked for removal",
    );
    await expect(lineCDeadAmount).toBeVisible();
    const lineCStarDead = envGroup.getByRole("button", {
      name: 'Flag "E2E QA Line C" for discussion',
    });
    await expect(lineCStarDead).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/cause-lines/annotations") &&
          r.request().method() === "PATCH",
      ),
      lineCStarDead.click(),
    ]);
    await expect(
      envGroup.getByRole("button", { name: 'Unflag "E2E QA Line C" for discussion' }),
    ).toBeVisible();
    // Undo — restore Line C to live before this suite moves on, so no
    // pending-delete row survives into the lock test (locking permanently
    // purges pending-delete lines).
    const lineCUndo = lineCDeadAmount
      .locator("xpath=ancestor::div[contains(@class,'space-y-1')][1]")
      .getByRole("button", { name: "Undo" });
    await lineCUndo.click();
    await expect(activityFund.getByLabel("Amount for Environment (E2E QA Line C)")).toBeVisible();

    // Act — star Line B (not A); confirm instant within-group reorder
    const amountsInGroup = envGroup.getByLabel(/^Amount for Environment \(/);
    const labelsBefore = await amountsInGroup.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    expect(labelsBefore.findIndex((l) => l?.includes("Line A"))).toBeLessThan(
      labelsBefore.findIndex((l) => l?.includes("Line B")),
    );

    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/cause-lines/annotations") &&
          r.request().method() === "PATCH",
      ),
      envGroup.getByRole("button", { name: 'Flag "E2E QA Line B" for discussion' }).click(),
    ]);

    const labelsAfter = await amountsInGroup.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    expect(labelsAfter.findIndex((l) => l?.includes("Line B"))).toBeLessThan(
      labelsAfter.findIndex((l) => l?.includes("Line A")),
    );

    // Act — add a note to Line B
    await envGroup.getByRole("button", { name: 'Add note for "E2E QA Line B"' }).click();
    await page.getByLabel(/Note for this line/).fill(CAUSE_NOTE_TEXT);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/cause-lines/annotations") &&
          r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);

    // Assert — everything survives a reload: amounts, Line B starred+noted,
    // Line A/C plain, sort order preserved
    await page.reload();
    const activityFundAfter = fundCard(page, ACTIVITY_FUND_NAME);
    const envGroupAfter = causeGroup(activityFundAfter, "Environment");
    await expect(envGroupAfter.getByLabel("Amount for Environment (E2E QA Line A)")).toHaveValue(
      "30.00",
    );
    await expect(envGroupAfter.getByLabel("Amount for Environment (E2E QA Line B)")).toHaveValue(
      "20.00",
    );
    await expect(envGroupAfter.getByLabel("Amount for Environment (E2E QA Line C)")).toHaveValue(
      "15.00",
    );
    await expect(
      envGroupAfter.getByRole("button", { name: 'Unflag "E2E QA Line B" for discussion' }),
    ).toBeVisible();
    await expect(
      envGroupAfter.getByRole("button", { name: 'Flag "E2E QA Line A" for discussion' }),
    ).toBeVisible();
    const amountsFinal = envGroupAfter.getByLabel(/^Amount for Environment \(/);
    const labelsFinal = await amountsFinal.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
    expect(labelsFinal.findIndex((l) => l?.includes("Line B"))).toBeLessThan(
      labelsFinal.findIndex((l) => l?.includes("Line A")),
    );
  });

  test("annotation controls stay enabled when the FY budget is Approve-&-locked, while amount inputs are disabled", async ({
    page,
  }) => {
    // Arrange — Approve & Lock now lives on the OVERVIEW only (Budgeting
    // Overview/Drill-Down Restructure, Flow 6: the lock is scoped to
    // (entity, FY), not to a single fund, so the Approve/Unlock panel moved
    // off the per-fund editor entirely).
    await page.goto(OVERVIEW_URL);
    await page.getByLabel("Board minute reference").fill("E2E QA lock test — not a real vote");
    await page.getByRole("button", { name: /Approve & lock for FY2099/ }).click();
    const lockDialog = page.getByRole("alertdialog");
    await expect(lockDialog).toBeVisible();
    await lockDialog.getByRole("button", { name: "Approve & lock", exact: true }).click();
    await expect(page.getByText(`FY${TEST_FISCAL_YEAR} budget locked.`)).toBeVisible({
      timeout: 10_000,
    });

    // Act — the editor itself (amount inputs disabled, annotation controls
    // still enabled) is only checkable on the fund's own drill-down.
    await page.goto(DRILLDOWN_URL);

    // Assert — amount input disabled while locked
    const activityFund = fundCard(page, ACTIVITY_FUND_NAME);
    const row = categoryRow(activityFund, LANDMINE_CATEGORY);
    const amountInput = row.getByLabel(`Budget for ${LANDMINE_CATEGORY} (expense)`);
    await expect(amountInput).toBeDisabled();

    // Assert — star control (the single highest-value manual check per
    // Decision 6) stays enabled and functional — no 409, toggling works
    const starButton = row.getByRole("button", {
      name: `Unflag ${LANDMINE_CATEGORY} for discussion`,
    });
    await expect(starButton).toBeEnabled();
    const [toggleOffResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/annotations") &&
          r.request().method() === "PATCH",
      ),
      starButton.click(),
    ]);
    expect(toggleOffResponse.status()).toBe(200);
    await expect(
      row.getByRole("button", { name: `Flag ${LANDMINE_CATEGORY} for discussion` }),
    ).toBeVisible();

    // Restore star to ON (worksheet fixture expects it starred) — while
    // still locked, proving the toggle works repeatedly under lock
    const [toggleOnResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budgets/annotations") &&
          r.request().method() === "PATCH",
      ),
      row.getByRole("button", { name: `Flag ${LANDMINE_CATEGORY} for discussion` }).click(),
    ]);
    expect(toggleOnResponse.status()).toBe(200);

    // Assert — note editor also stays usable while locked
    await row.getByRole("button", { name: `Edit note for ${LANDMINE_CATEGORY}` }).click();
    const textarea = page.getByLabel(new RegExp(`Note for ${LANDMINE_CATEGORY}`));
    await expect(textarea).toBeEnabled();
    await expect(textarea).toHaveValue(NOTE_TEXT);
    await page.getByRole("button", { name: "Cancel" }).click();

    // Cleanup — unlock is back on the OVERVIEW too
    await page.goto(OVERVIEW_URL);
    await page.getByLabel("Reason for unlocking").fill("E2E QA test cleanup — reopening for QA");
    await page.getByRole("button", { name: "Unlock to amend" }).click();
    const unlockDialog = page.getByRole("alertdialog");
    await expect(unlockDialog).toBeVisible();
    await unlockDialog.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByText(`FY${TEST_FISCAL_YEAR} budget unlocked for editing.`)).toBeVisible(
      { timeout: 10_000 },
    );

    // Assert — amount input re-enabled after unlock, back on the drill-down
    await page.goto(DRILLDOWN_URL);
    await expect(
      categoryRow(fundCard(page, ACTIVITY_FUND_NAME), LANDMINE_CATEGORY).getByLabel(
        `Budget for ${LANDMINE_CATEGORY} (expense)`,
      ),
    ).toBeEnabled();
  });

  test("print worksheet: star glyph + note render at both grains, and a fund with zero stars/notes prints with no stray rows", async ({
    page,
  }) => {
    // Arrange — the print worksheet lives on the OVERVIEW (shows both funds).
    await page.goto(OVERVIEW_URL);
    const activityWorksheet = fundWorksheet(page, ACTIVITY_FUND_NAME);
    const adminWorksheet = fundWorksheet(page, ADMIN_FUND_NAME);

    // Assert — Activity Fund shows the category-grain star + note
    await expect(activityWorksheet).toContainText(`★ ${LANDMINE_CATEGORY}`);
    await expect(activityWorksheet).toContainText(`Note: ${NOTE_TEXT}`);

    // Assert — Activity Fund shows a star-only, note-less un-budgeted category
    await expect(activityWorksheet).toContainText(`★ ${UNBUDGETED_CATEGORY}`);

    // Assert — cause-line grain: Line B (starred + noted) shows both; Line A
    // (plain) shows neither
    await expect(activityWorksheet).toContainText("★ E2E QA Line B");
    await expect(activityWorksheet).toContainText(`Note: ${CAUSE_NOTE_TEXT}`);
    const lineAText = await activityWorksheet
      .locator("td", { hasText: "E2E QA Line A" })
      .first()
      .textContent();
    expect(lineAText?.trim().startsWith("★")).toBe(false);

    // Assert — Administrative Fund has zero stars/notes: no stray glyph or
    // note row anywhere in its section
    await expect(adminWorksheet).not.toContainText("★");
    await expect(adminWorksheet).not.toContainText("Note:");
  });

  test("star/note never appear on the member-facing financial reports or philanthropy dashboard", async ({
    page,
  }) => {
    // Arrange / Act
    await page.goto("/members/financial-reports");
    // Assert — no star glyph, no leaked working-note text anywhere on the page
    await expect(page.locator("body")).not.toContainText("★");
    await expect(page.locator("body")).not.toContainText(NOTE_TEXT);
    await expect(page.locator("body")).not.toContainText(CAUSE_NOTE_TEXT);

    // Act
    await page.goto("/members/impact");
    // Assert
    await expect(page.locator("body")).not.toContainText("★");
    await expect(page.locator("body")).not.toContainText(NOTE_TEXT);
    await expect(page.locator("body")).not.toContainText(CAUSE_NOTE_TEXT);
  });
});
