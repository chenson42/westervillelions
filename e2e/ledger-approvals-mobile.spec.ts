import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  ledgerBankAccounts,
  ledgerEntities,
  ledgerFunds,
  ledgerSettings,
  ledgerTransactions,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";

/**
 * Approvals page on a phone, Increment 1 —
 * docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 5.
 *
 * The bug this commemorates: on a 390px viewport the pending list was a six-column
 * table inside `overflow-x-auto`, so Approve / Reject sat off-screen to the right
 * with no scroll cue and a board member concluded she had no permission to approve.
 *
 * Covers, as a board-only user (board_member + member; no admin, no ledger.record):
 *   1. 390px and 360px: cards visible / table hidden, no horizontal overflow, Approve
 *      and Reject on screen and >= 44px tall; Transfer chip and From -> To; the row
 *      the viewer recorded shows the "You recorded this" line and no buttons.
 *   2. Approve dialog at 360px fits, shows fund / memo / recorder, explains why
 *      Approve is disabled, enables once a minute is typed, Cancel changes nothing.
 *   3. The race: another approver wins while the dialog is open -> dialog closes,
 *      the toast names that approver, and the loser wrote nothing.
 *   4. Approve end to end (single row, and a Transfer where BOTH legs post).
 *   5. Widths 1024 / 1279 (cards) and 1280 / 1440 (table): no overflow, exactly one
 *      visible variant per row, no duplicate DOM ids, Actions not clipped.
 *   6. The routes still refuse a self-decision (403) when forced.
 *   7. A ledger.view-only user never reaches the page.
 *   8. Empty state copy.
 *
 * Fixtures: direct DB inserts on the dev DB (`DATABASE_URL`, never prod). Rows are
 * tagged "E2E QA Approvals Mobile"; users are example.invalid. Rows are inserted
 * directly, so NO notification email is created or sent. cleanup() runs before AND
 * after. Serial, single worker: see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const TAG = "E2E QA Approvals Mobile";
const BOARD_EMAIL = "qa-approvals-board@example.invalid";
const VIEWER_EMAIL = "qa-approvals-viewer@example.invalid";
const PASSWORD = "E2eApprovalsMobile!2026";

interface Ids {
  adminUserId: string;
  adminName: string;
  boardUserId: string;
  clubEntityId: string;
  adminFundId: string;
  activityFundId: string;
  adminBankId: string;
  cents: number;
  plainId: string;
  selfId: string;
  transferExpenseId: string;
  transferIncomeId: string;
}
const ids = {} as Ids;
const TRANSFER_GROUP = "00000000-0000-4000-8000-0000000a9901";

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

async function cleanup(): Promise<void> {
  await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.memo, `${TAG}%`));
  const fixtureUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [BOARD_EMAIL, VIEWER_EMAIL]));
  const fixtureIds = fixtureUsers.map((u) => u.id);
  if (fixtureIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, fixtureIds));
    await db.delete(users).where(inArray(users.id, fixtureIds));
  }
}

async function seedPending(args: {
  party: string | null;
  memo: string;
  flow: "expense" | "income";
  fundId: string;
  recordedBy: string;
  transferGroupId?: string;
  cents?: number;
}): Promise<string> {
  const [row] = await db
    .insert(ledgerTransactions)
    .values({
      entityId: ids.clubEntityId,
      fundId: args.fundId,
      bankAccountId: ids.adminBankId,
      txnDate: new Date().toISOString().slice(0, 10),
      flow: args.flow,
      amountCents: args.cents ?? ids.cents,
      party: args.party,
      memo: `${TAG} ${args.memo}`,
      status: "pending",
      transferGroupId: args.transferGroupId ?? null,
      recordedByUserId: args.recordedBy,
    })
    .returning({ id: ledgerTransactions.id });
  return row.id;
}

async function seedPendingRows(): Promise<void> {
  ids.plainId = await seedPending({
    party: `${TAG} Plumbing & Heating Supply Company of Westerville`,
    memo: "boiler replacement memo with a very long unbroken token AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    flow: "expense",
    fundId: ids.adminFundId,
    recordedBy: ids.adminUserId,
  });
  ids.selfId = await seedPending({
    party: `${TAG} Self Recorded`,
    memo: "recorded by the board user",
    flow: "expense",
    fundId: ids.adminFundId,
    recordedBy: ids.boardUserId,
  });
  ids.transferExpenseId = await seedPending({
    party: null,
    memo: "transfer Administrative to Activity",
    flow: "expense",
    fundId: ids.adminFundId,
    recordedBy: ids.adminUserId,
    transferGroupId: TRANSFER_GROUP,
  });
  ids.transferIncomeId = await seedPending({
    party: null,
    memo: "transfer Administrative to Activity",
    flow: "income",
    fundId: ids.activityFundId,
    recordedBy: ids.adminUserId,
    transferGroupId: TRANSFER_GROUP,
  });
}

async function resetPending(txnIds: string[]): Promise<void> {
  await db
    .update(ledgerTransactions)
    .set({ status: "pending", approvedByUserId: null, approvedAt: null, boardMinute: null, rejectionReason: null })
    .where(inArray(ledgerTransactions.id, txnIds));
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 20_000 });
}

/** Both the card list and the table mount (CSS hides one), so scope to what is visible. */
const visibleRow = (page: Page, id: string) => page.locator(`[data-row-id="${id}"]:visible`);

async function layout(page: Page) {
  return page.evaluate((rowIds) => {
    const vis = (el: Element) => el.getClientRects().length > 0;
    const idCounts: Record<string, number> = {};
    document.querySelectorAll("[id]").forEach((e) => (idCounts[e.id] = (idCounts[e.id] ?? 0) + 1));
    const wrap = document.querySelector(".overflow-x-auto");
    return {
      inner: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      duplicateIds: Object.entries(idCounts).filter(([, n]) => n > 1).map(([k]) => k),
      visiblePerRow: rowIds.map((id) => [...document.querySelectorAll(`[data-row-id="${id}"]`)].filter(vis).length),
      cardsVisible: [...document.querySelectorAll("ul.grid")].some(vis),
      tableVisible: [...document.querySelectorAll("table")].some(vis),
      tableClipped: wrap && vis(wrap) ? wrap.scrollWidth > wrap.clientWidth : false,
      buttons: [...document.querySelectorAll("[data-row-id] button")].filter(vis).map((b) => {
        const r = b.getBoundingClientRect();
        return { label: (b.textContent ?? "").trim(), row: b.closest("[data-row-id]")?.getAttribute("data-row-id"), height: Math.round(r.height), left: r.left, right: r.right };
      }),
    };
  }, [ids.plainId, ids.selfId, ids.transferExpenseId]);
}

test.beforeAll(async () => {
  await cleanup();
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
  const admin = await one(db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, adminEmail)), "e2e admin");
  ids.adminUserId = admin.id;
  ids.adminName = admin.name ?? "";
  if (!ids.adminName) throw new Error("e2e fixture lookup failed: the e2e admin user has no name");
  const club = await one(db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "club")), "club entity");
  ids.clubEntityId = club.id;
  const fund = (slug: string) =>
    db.select().from(ledgerFunds).where(and(eq(ledgerFunds.entityId, club.id), eq(ledgerFunds.slug, slug)));
  ids.adminFundId = (await one(fund("administrative"), "administrative fund")).id;
  ids.activityFundId = (await one(fund("activity"), "activity fund")).id;
  ids.adminBankId = (
    await one(
      db.select().from(ledgerBankAccounts).where(and(eq(ledgerBankAccounts.entityId, club.id), eq(ledgerBankAccounts.name, "Administrative Checking"))),
      "administrative bank account",
    )
  ).id;
  const settings = await one(db.select().from(ledgerSettings), "ledger settings");
  ids.cents = settings.disbApprovalThresholdCents + 12_345;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const role = async (name: string) => (await one(db.select().from(roles).where(eq(roles.name, name)), `role ${name}`)).id;
  const [board] = await db
    .insert(users)
    .values({ email: BOARD_EMAIL, name: "QA Approvals Board", password: passwordHash, role: "member", isActive: true })
    .returning({ id: users.id });
  ids.boardUserId = board.id;
  const [viewer] = await db
    .insert(users)
    .values({ email: VIEWER_EMAIL, name: "QA Approvals Viewer", password: passwordHash, role: "member", isActive: true })
    .returning({ id: users.id });
  await db.insert(userRoles).values([
    { userId: board.id, roleId: await role("board_member") },
    { userId: board.id, roleId: await role("member") },
    // budget_committee carries ledger.view but NOT ledger.approve or admin.dashboard.
    { userId: viewer.id, roleId: await role("budget_committee") },
    { userId: viewer.id, roleId: await role("member") },
  ]);
  await seedPendingRows();
});

test.afterAll(async () => {
  await cleanup();
});

test.describe("Approvals page, Increment 1", () => {
  for (const width of [390, 360]) {
    test(`should show Approve and Reject on screen as 44px targets at ${width}px — regression for the off-screen Approve button on phones`, async ({ page }) => {
      // Arrange
      await page.setViewportSize({ width, height: 844 });
      await signIn(page, BOARD_EMAIL);

      // Act
      await page.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });
      const m = await layout(page);

      // Assert
      expect(m.cardsVisible).toBe(true);
      expect(m.tableVisible).toBe(false);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.inner);
      expect(m.duplicateIds).toEqual([]);
      expect(m.visiblePerRow).toEqual([1, 1, 1]);
      for (const id of [ids.plainId, ids.transferExpenseId]) {
        for (const label of ["Approve", "Reject"]) {
          const b = m.buttons.find((x) => x.row === id && x.label === label);
          expect(b, `${label} button for ${id}`).toBeDefined();
          expect(b!.height).toBeGreaterThanOrEqual(44);
          expect(b!.left).toBeGreaterThanOrEqual(0);
          expect(b!.right).toBeLessThanOrEqual(m.inner);
        }
      }
      // the row the viewer recorded: no buttons at all, an explanation instead
      expect(m.buttons.some((b) => b.row === ids.selfId)).toBe(false);
      await expect(visibleRow(page, ids.selfId)).toContainText("You recorded this, so another board member must decide it.");
      // Transfer chip and From -> To; the income leg is not listed separately
      await expect(visibleRow(page, ids.transferExpenseId)).toContainText("Transfer");
      await expect(visibleRow(page, ids.transferExpenseId)).toContainText("Administrative Fund → Activity Fund");
      await expect(page.locator(`[data-row-id="${ids.transferIncomeId}"]`)).toHaveCount(0);
    });
  }

  test("should fit the Approve dialog at 360px and explain the disabled Approve button", async ({ page }) => {
    // Arrange: touch emulation, so the on-screen keyboard must not be summoned on open
    const context = await page.context().browser()!.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const touchPage = await context.newPage();
    await signIn(touchPage, BOARD_EMAIL);
    await touchPage.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });

    // Act
    await visibleRow(touchPage, ids.plainId).getByRole("button", { name: "Approve" }).click();
    const dialog = touchPage.getByRole("dialog");
    await dialog.waitFor();

    // Assert
    const box = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: window.innerWidth };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.vw);
    await expect(dialog).toContainText("Administrative Fund");
    await expect(dialog).toContainText("boiler replacement");
    await expect(dialog).toContainText(ids.adminName);
    await expect(dialog.getByText("Recorded by", { exact: false }).first()).toBeVisible();
    const approve = dialog.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute("aria-describedby", "approve-hint");
    await expect(touchPage.locator("#approve-hint")).toHaveText("Add a minute reference to enable Approve.");
    expect(await touchPage.evaluate(() => document.activeElement?.id)).not.toBe("approve-board-minute");

    await touchPage.fill("#approve-board-minute", "Motion QA, Oct 2026");
    await expect(touchPage.locator("#approve-hint")).toHaveCount(0);
    await expect(approve).toBeEnabled();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(touchPage.getByRole("dialog")).toHaveCount(0);
    const [still] = await db.select({ status: ledgerTransactions.status }).from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.plainId));
    expect(still.status).toBe("pending");
    await context.close();
  });

  test("should close the dialog and name the other approver when someone else decides first — regression for the silent lost race", async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, BOARD_EMAIL);
    await page.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });
    await visibleRow(page, ids.plainId).getByRole("button", { name: "Approve" }).click();
    await page.fill("#approve-board-minute", "Motion QA-race");

    // Act: another approver wins while this dialog is open
    await db
      .update(ledgerTransactions)
      .set({ status: "posted", approvedByUserId: ids.adminUserId, approvedAt: new Date(), boardMinute: "Other approver minute" })
      .where(eq(ledgerTransactions.id, ids.plainId));
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();

    // Assert
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /already approved this disbursement\. You can add your approval too\./ })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(`[data-row-id="${ids.plainId}"]`)).toHaveCount(0);
    const [row] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.plainId));
    expect(row.approvedByUserId).toBe(ids.adminUserId);
    expect(row.boardMinute).toBe("Other approver minute");
    await resetPending([ids.plainId]);
  });

  test("should approve a pending disbursement and post BOTH legs of a Transfer", async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, BOARD_EMAIL);
    await page.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });

    // Act: the single row
    await visibleRow(page, ids.plainId).getByRole("button", { name: "Approve" }).click();
    await page.fill("#approve-board-minute", "Motion QA-real, Oct 2026");
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Disbursement approved." })).toBeVisible();
    await expect(page.locator(`[data-row-id="${ids.plainId}"]`)).toHaveCount(0);

    // Act: the Transfer
    await visibleRow(page, ids.transferExpenseId).getByRole("button", { name: "Approve" }).click();
    await page.fill("#approve-board-minute", "Motion QA-transfer");
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(`[data-row-id="${ids.transferExpenseId}"]`)).toHaveCount(0);

    // Assert
    const [plain] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.plainId));
    expect(plain.status).toBe("posted");
    expect(plain.approvedByUserId).toBe(ids.boardUserId);
    expect(plain.boardMinute).toBe("Motion QA-real, Oct 2026");
    const legs = await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.id, [ids.transferExpenseId, ids.transferIncomeId]));
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg.status).toBe("posted");
      expect(leg.approvedByUserId).toBe(ids.boardUserId);
    }
    await resetPending([ids.plainId, ids.transferExpenseId, ids.transferIncomeId]);
  });

  for (const [width, wantTable] of [[1024, false], [1279, false], [1280, true], [1440, true]] as const) {
    test(`should render ${wantTable ? "the table" : "cards"} without clipping at ${width}px`, async ({ page }) => {
      // Arrange
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, BOARD_EMAIL);

      // Act
      await page.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });
      const m = await layout(page);

      // Assert
      expect(m.tableVisible).toBe(wantTable);
      expect(m.cardsVisible).toBe(!wantTable);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.inner);
      expect(m.tableClipped).toBe(false);
      expect(m.duplicateIds).toEqual([]);
      expect(m.visiblePerRow).toEqual([1, 1, 1]);
      for (const id of [ids.plainId, ids.transferExpenseId]) {
        for (const label of ["Approve", "Reject"]) {
          const b = m.buttons.find((x) => x.row === id && x.label === label);
          expect(b, `${label} for ${id}`).toBeDefined();
          expect(b!.height).toBeGreaterThanOrEqual(44);
          expect(b!.right).toBeLessThanOrEqual(m.inner);
        }
      }
    });
  }

  test("should still refuse a forced approve or reject of a row the viewer recorded (403)", async ({ page }) => {
    // Arrange
    await signIn(page, BOARD_EMAIL);

    // Act
    const approve = await page.request.post(`/api/admin/ledger/transactions/${ids.selfId}/approve`, { data: { boardMinute: "x" } });
    const reject = await page.request.post(`/api/admin/ledger/transactions/${ids.selfId}/reject`, { data: { reason: "x" } });

    // Assert
    expect(approve.status()).toBe(403);
    expect(reject.status()).toBe(403);
    const [row] = await db.select({ status: ledgerTransactions.status }).from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.selfId));
    expect(row.status).toBe("pending");
  });

  test("should keep a ledger.view-only user away from the Approvals page and the approve route", async ({ page }) => {
    // Arrange
    await signIn(page, VIEWER_EMAIL);

    // Act
    await page.goto("/admin/ledger/approvals");
    const api = await page.request.post(`/api/admin/ledger/transactions/${ids.plainId}/approve`, { data: { boardMinute: "x" }, maxRedirects: 0 });

    // Assert
    expect(page.url()).not.toContain("/admin/ledger/approvals");
    expect(api.status()).toBe(403);
  });

  test("should say nothing is waiting for approval when no pending rows exist", async ({ page }) => {
    // Arrange: needs the dev DB to hold no pending rows other than this suite's own
    await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.memo, `${TAG}%`));
    const others = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.status, "pending"));
    test.skip(others.length > 0, "other pending rows exist in the dev DB; empty state cannot be asserted");
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, BOARD_EMAIL);

    // Act
    await page.goto("/admin/ledger/approvals", { waitUntil: "networkidle" });

    // Assert
    await expect(page.getByText("Nothing is waiting for approval")).toBeVisible();
    await expect(page.getByText("All expenditures are approved")).toHaveCount(0);
  });
});
