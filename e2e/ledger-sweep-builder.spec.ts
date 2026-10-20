import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { and, eq, gte, inArray, like, notInArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  emailQueue,
  ledgerAuditLog,
  ledgerCategories,
  ledgerSettings,
  ledgerSweepCloseouts,
  ledgerTransactions,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";
import { loadXmIds, todayIso, type XmIds } from "./helpers/cross-entity-move-fixtures";
import { signInAsAdmin } from "./helpers/auth";

/**
 * The sweep builder UI (B-172 Increment 2b, pass 1).
 * docs/work-log/2026-10-17-itemized-sweep-inc2b-sweep-batch-ui.md.
 *
 * Covers: a record user's select, review and post (posts now, and goes pending
 * over the threshold); a wrong typed amount blocks Post and shows the
 * difference; a future date is refused; `?sweep=` preselects; a prior-year gift
 * asks for a reason; a manage user marks and unmarks a closeout; a user without
 * `ledger.record` is redirected; 360px has no horizontal page scroll.
 *
 * Fixtures are direct DB inserts on the dev DB (never prod), tagged
 * "QATEST E2E Sweep Builder"; the one extra user is example.invalid. A pending
 * batch queues approver mails that are `blocked_non_production`; the new ones
 * are deleted in cleanup. Serial, one worker (see playwright.config.ts).
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const TAG = "QATEST E2E Sweep Builder";
const PASSWORD = "E2eSweepBuilder!2026";
const VIEWONLY = { email: "qa-sweepbuilder-viewonly@example.invalid", name: "QA Builder ViewOnly" };

let x: XmIds;
let adminId = "";
let thresholdCents = 0;
let giftDate = "";
let startedAt = new Date();
let emailBaseline: string[] = [];
let mirroredCategoryId: string | null = null;
let seq = 0;

async function cleanup(): Promise<void> {
  const copies = await db
    .select({ leg: ledgerTransactions.sweepLegTxnId })
    .from(ledgerTransactions)
    .where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweepLegTxnId} is not null`));
  const legs = [...new Set(copies.map((c) => c.leg).filter((v): v is string => !!v))];
  const gifts = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`));
  if (gifts.length > 0) {
    await db.delete(ledgerSweepCloseouts).where(inArray(ledgerSweepCloseouts.txnId, gifts.map((g) => g.id)));
  }
  await db.delete(ledgerAuditLog).where(and(like(ledgerAuditLog.action, "sweep_%"), gte(ledgerAuditLog.createdAt, startedAt)));
  await db.delete(ledgerTransactions).where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweptFromTxnId} is not null`));
  if (legs.length > 0) await db.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, legs));
  await db.delete(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`));
  const fx = await db.select({ id: users.id }).from(users).where(eq(users.email, VIEWONLY.email));
  if (fx.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, fx.map((u) => u.id)));
    await db.delete(users).where(inArray(users.id, fx.map((u) => u.id)));
  }
  const queued = emailBaseline.length > 0
    ? await db.select({ id: emailQueue.id, subject: emailQueue.subject }).from(emailQueue).where(notInArray(emailQueue.id, emailBaseline))
    : [];
  const ours = queued.filter((q) => q.subject.startsWith("Sweep pending your approval")).map((q) => q.id);
  if (ours.length > 0) await db.delete(emailQueue).where(inArray(emailQueue.id, ours));
}

async function gifts(n: number, cents: number, opts: { date?: string } = {}): Promise<{ ids: string[]; total: number }> {
  const rows = await db
    .insert(ledgerTransactions)
    .values(
      Array.from({ length: n }, (_, i) => ({
        entityId: x.clubEntityId,
        fundId: x.activityFundId,
        bankAccountId: x.adminBankId,
        txnDate: opts.date ?? giftDate,
        flow: "income",
        amountCents: cents + i,
        categoryId: mirroredCategoryId,
        party: `${TAG} Donor ${++seq}`,
        memo: `${TAG} gift ${seq}`,
        status: "posted",
        recordedByUserId: adminId,
      })),
    )
    .returning({ id: ledgerTransactions.id, amountCents: ledgerTransactions.amountCents });
  return { ids: rows.map((r) => r.id), total: rows.reduce((s, r) => s + r.amountCents, 0) };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

async function review(page: Page, ids: string[]) {
  await page.goto(`/admin/ledger/sweep?sweep=${ids.join(",")}`);
  await expect(page.getByText(`${ids.length} ${ids.length === 1 ? "gift" : "gifts"} selected`).first()).toBeVisible();
  await page.getByRole("button", { name: "Review sweep" }).click();
  await expect(page.getByRole("heading", { name: "Review the sweep" })).toBeVisible();
  await expect(page.getByText("Checking the gifts…")).toHaveCount(0);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  startedAt = new Date(Date.now() - 1000);
  x = await loadXmIds();
  adminId = x.adminUserId;
  emailBaseline = (await db.select({ id: emailQueue.id }).from(emailQueue)).map((r) => r.id);
  await cleanup();
  const settings = (await db.select().from(ledgerSettings))[0];
  thresholdCents = settings.disbApprovalThresholdCents;
  const d = new Date(todayIso() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  giftDate = d.toISOString().slice(0, 10);
  const cat = x.clubActivityPublicDonationsId
    ? (await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, x.clubActivityPublicDonationsId)))[0]
    : undefined;
  mirroredCategoryId = cat?.mirrorsCategoryId ? cat.id : null;
});

test.afterAll(async () => {
  await cleanup();
});

test.describe("sweep builder (Increment 2b)", () => {
  test.beforeEach(({}, info) => {
    info.skip(!mirroredCategoryId, "needs a Club Public donations category with a Foundation counterpart on this database");
  });

  test("should preselect from ?sweep=, review, and post a small batch right away", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(2, 1_000);
    await review(page, g.ids);

    await expect(page.getByText("posts right away")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeDisabled();
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeEnabled();

    await page.getByRole("button", { name: "Post sweep" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Post sweep" }).click();
    await expect(page.getByRole("heading", { name: "Sweep posted" })).toBeVisible({ timeout: 60_000 });

    const copies = await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.sweptFromTxnId, g.ids));
    expect(copies).toHaveLength(2);
    const leg = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, copies[0].sweepLegTxnId!)))[0];
    expect(leg.status).toBe("posted");
    expect(leg.amountCents).toBe(g.total);
  });

  test("should send a batch over the approval threshold to the board as pending", async ({ page }) => {
    await signInAsAdmin(page);
    const each = Math.floor(thresholdCents / 2) + 100;
    const g = await gifts(2, each);
    await review(page, g.ids);
    await expect(page.getByText("goes to the board")).toBeVisible();
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await page.getByRole("button", { name: "Post sweep" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Post sweep" }).click();
    await expect(page.getByRole("heading", { name: "Sent to the board for approval" })).toBeVisible({ timeout: 90_000 });
    const copies = await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.sweptFromTxnId, g.ids));
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.status === "pending")).toBe(true);
  });

  test("should send exactly one create when Post is double-clicked, and never read as a failure", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(2, 1_000);
    const creates: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/admin/ledger/sweep-batches") creates.push(req.url());
    });
    await review(page, g.ids);
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await page.getByRole("button", { name: "Post sweep" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Post sweep" }).dblclick();
    await expect(page.getByRole("heading", { name: "Sweep posted" })).toBeVisible({ timeout: 60_000 });
    expect(creates).toHaveLength(1);
    const copies = await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.sweptFromTxnId, g.ids));
    expect(copies).toHaveLength(2);
    await expect(page.getByText(/failed|could not/i)).toHaveCount(0);
  });

  test("should write nothing and say so when a counterpart changes between review and Post (B7)", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(1, 1_000);
    const own = (await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, mirroredCategoryId!)))[0];
    const other = (
      await db
        .select()
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, x.foundationEntityId),
            eq(ledgerCategories.flow, "income"),
            eq(ledgerCategories.isActive, true),
            sql`${ledgerCategories.id} <> ${own.mirrorsCategoryId}`,
          ),
        )
    )[0];
    test.skip(!other, "needs a second active Foundation income category");
    await review(page, g.ids);
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await db.update(ledgerCategories).set({ mirrorsCategoryId: other.id }).where(eq(ledgerCategories.id, own.id));
    try {
      await page.getByRole("button", { name: "Post sweep" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Post sweep" }).click();
      await expect(page.getByText("The list changed while you were reviewing. Check it and post again.")).toBeVisible({ timeout: 60_000 });
      const written = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(inArray(ledgerTransactions.sweptFromTxnId, g.ids));
      expect(written).toHaveLength(0);
      await expect(page.getByText(other.name).first()).toBeVisible();
    } finally {
      await db.update(ledgerCategories).set({ mirrorsCategoryId: own.mirrorsCategoryId }).where(eq(ledgerCategories.id, own.id));
    }
  });

  test("should block Post on a wrong amount and show the difference", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(2, 1_000);
    await review(page, g.ids);
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await page.locator("#sweep-bank-amount").fill(dollars(g.total + 100));
    await expect(page.getByText("That is $1.00 more than the selected gifts total.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeDisabled();
    await page.locator("#sweep-bank-amount").fill(dollars(g.total - 100));
    await expect(page.getByText("That is $1.00 less than the selected gifts total.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeDisabled();
  });

  test("should limit the sweep date to today and refuse a future date", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(1, 1_000);
    await review(page, g.ids);
    const max = await page.locator("#sweep-date").getAttribute("max");
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tomorrow = new Date(`${max}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await page.locator("#sweep-date").fill(tomorrow.toISOString().slice(0, 10));
    await expect(page.getByRole("alert").filter({ hasText: "cannot be in the future" })).toBeVisible();
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeDisabled();
  });

  test("should ask a manage user for a reason on a prior-year gift", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(1, 1_000, { date: "2024-01-15" });
    await review(page, g.ids);
    await expect(page.getByText("Manage Ledger permission and a reason").first()).toBeVisible();
    await page.locator("#sweep-bank-amount").fill(dollars(g.total));
    await page.locator("#sweep-board-minute").fill(`${TAG} minute`);
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeDisabled();
    await page.locator("#sweep-prior-year-reason").fill("These gifts were missed in the last cycle.");
    await expect(page.getByRole("button", { name: "Post sweep" })).toBeEnabled();
  });

  test("should let a manage user mark a gift as already handled and unmark it", async ({ page }) => {
    await signInAsAdmin(page);
    const g = await gifts(1, 1_000);
    const id = g.ids[0];
    await page.goto("/admin/ledger/sweep");
    await page.locator(`#sweep-gift-${id}`).check();
    await page.getByRole("button", { name: "Mark as already handled" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Mark as already handled" })).toBeDisabled();
    await dialog.locator("#closeout-reason").fill("Covered by the October transfer.");
    await dialog.getByRole("button", { name: "Mark as already handled" }).click();
    await expect(page.locator(`#sweep-gift-${id}`)).toHaveCount(0, { timeout: 30_000 });

    await page.getByText(/Marked as already handled \(\d+\)/).click();
    await page.getByRole("button", { name: /^Unmark / }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Unmark" }).click();
    await expect(page.locator(`#sweep-gift-${id}`)).toBeVisible({ timeout: 30_000 });
  });

  test("should redirect a user without ledger.record away from the builder", async ({ browser }) => {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const role = (await db.select().from(roles).where(eq(roles.name, "budget_committee")))[0];
    const member = (await db.select().from(roles).where(eq(roles.name, "member")))[0];
    const u = (
      await db.insert(users).values({ email: VIEWONLY.email, name: VIEWONLY.name, password: hash, role: "member", isActive: true }).returning({ id: users.id })
    )[0];
    await db.insert(userRoles).values([{ userId: u.id, roleId: role.id }, { userId: u.id, roleId: member.id }]);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/signin");
    await page.fill('input[type="email"]', VIEWONLY.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30_000 });
    await page.goto("/admin/ledger/sweep");
    await expect(page).not.toHaveURL(/\/admin\/ledger\/sweep/);
    await context.close();
  });

  test("should have no horizontal page scroll at 360px on the list and the review", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAsAdmin(page);
    const g = await gifts(2, 1_000);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(`/admin/ledger/sweep?sweep=${g.ids.join(",")}`);
    await expect(page.getByRole("button", { name: "Review sweep" })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Review sweep" }).click();
    await expect(page.getByRole("heading", { name: "Review the sweep" })).toBeVisible();
    await expect(page.getByText("Checking the gifts…")).toHaveCount(0);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
