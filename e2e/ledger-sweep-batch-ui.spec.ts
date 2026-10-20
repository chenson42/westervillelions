import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { and, eq, gte, inArray, like, notInArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  emailQueue,
  ledgerAuditLog,
  ledgerBankLines,
  ledgerCategories,
  ledgerDonors,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReconciliationSessions,
  ledgerSettings,
  ledgerTransactions,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";
import { loadXmIds, todayIso, type XmIds } from "./helpers/cross-entity-move-fixtures";
import { signInAsAdmin } from "./helpers/auth";

/**
 * The read surfaces of an itemized sweep (B-172 Increment 2b, pass 2).
 * docs/work-log/2026-10-17-itemized-sweep-inc2b-sweep-batch-ui.md.
 *
 * Covers: Approvals shows ONE batch row at 1280 and cards at 1279 and 360 with a
 * summary and no party, memo or donor; a second user approves with the
 * whole-batch wording and another rejects (freeing the gifts); the register
 * chips on the leg, the source gift and the Foundation copy with Edit, Delete,
 * Split and Move hidden and the Batch dialog open; Void of a posted batch and the
 * server's `reconciled` refusal shown in the dialog; an approved batch offers no
 * Void; "Match this batch" in the reconciliation picker; the donor-page labels;
 * the Treasury guide section; 360px with no horizontal scroll.
 *
 * Fixtures are direct DB inserts on the dev DB (never prod), tagged
 * "QATEST E2E Sweep UI"; users are example.invalid. A pending batch queues
 * approver mails that are `blocked_non_production`; the new ones are deleted in
 * cleanup. Serial, one worker (see playwright.config.ts).
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const TAG = "QATEST E2E Sweep UI";
const SESSION_CSV = "qatest-e2e-sweep-ui.csv";
const PASSWORD = "E2eSweepUi!2026";
const APPROVER = { email: "qa-sweepui-approver@example.invalid", name: "QA SweepUI Approver" };
const DONOR_NAME = `${TAG} Donor Person`;

let x: XmIds;
let adminId = "";
let approverId = "";
let thresholdCents = 0;
let giftDate = "";
let startedAt = new Date();
let emailBaseline: string[] = [];
let mirroredCategoryId: string | null = null;
let activityFundName = "";
let seq = 0;
let approverCtx: BrowserContext;
let approverPage: Page;
let adminCtx: BrowserContext;
let adminPage: Page;

// State carried between the serial tests.
let approvedLeg = "";
let approvedSources: string[] = [];
let approvedCopies: string[] = [];

async function cleanup(): Promise<void> {
  const copies = await db
    .select({ leg: ledgerTransactions.sweepLegTxnId })
    .from(ledgerTransactions)
    .where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweepLegTxnId} is not null`));
  const legs = [...new Set(copies.map((c) => c.leg).filter((v): v is string => !!v))];
  const sessions = await db
    .select({ id: ledgerReconciliationSessions.id })
    .from(ledgerReconciliationSessions)
    .where(eq(ledgerReconciliationSessions.csvFilename, SESSION_CSV));
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    await db.delete(ledgerReconciliationMatches).where(inArray(ledgerReconciliationMatches.sessionId, sessionIds));
    await db.delete(ledgerBankLines).where(inArray(ledgerBankLines.sessionId, sessionIds));
    await db.delete(ledgerReconciliationSessions).where(inArray(ledgerReconciliationSessions.id, sessionIds));
  }
  await db.delete(ledgerAuditLog).where(and(like(ledgerAuditLog.action, "sweep_%"), gte(ledgerAuditLog.createdAt, startedAt)));
  await db.delete(ledgerTransactions).where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweptFromTxnId} is not null`));
  if (legs.length > 0) await db.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, legs));
  await db.delete(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`));
  await db.delete(ledgerDonors).where(like(ledgerDonors.name, `${TAG}%`));
  const fx = await db.select({ id: users.id }).from(users).where(eq(users.email, APPROVER.email));
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

async function gifts(n: number, cents: number, extra: { donorId?: string } = {}): Promise<{ ids: string[]; total: number }> {
  const rows = await db
    .insert(ledgerTransactions)
    .values(
      Array.from({ length: n }, (_, i) => ({
        entityId: x.clubEntityId,
        fundId: x.activityFundId,
        bankAccountId: x.adminBankId,
        txnDate: giftDate,
        flow: "income",
        amountCents: cents + i,
        categoryId: mirroredCategoryId,
        party: `${TAG} Donor ${++seq}`,
        memo: `${TAG} gift ${seq}`,
        status: "posted",
        recordedByUserId: adminId,
        donorId: extra.donorId ?? null,
      })),
    )
    .returning({ id: ledgerTransactions.id, amountCents: ledgerTransactions.amountCents });
  return { ids: rows.map((r) => r.id), total: rows.reduce((s, r) => s + r.amountCents, 0) };
}

/** Creates a batch through the real route as the admin. */
async function sweep(ids: string[], total: number): Promise<{ legId: string; status: string }> {
  const res = await adminPage.request.post("/api/admin/ledger/sweep-batches", {
    data: {
      sourceIds: ids,
      sourceBankAccountId: x.adminBankId,
      destBankAccountId: x.foundationBankId,
      sweepDate: todayIso(),
      boardMinute: `${TAG} minute`,
      bankAmountCents: total,
    },
    timeout: 120_000,
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { legId: body.legId, status: body.status };
}

async function pendingBatch(): Promise<{ legId: string; ids: string[] }> {
  const each = Math.floor(thresholdCents / 2) + 100;
  const g = await gifts(2, each);
  const { legId } = await sweep(g.ids, g.total);
  return { legId, ids: g.ids };
}

const legRow = async (id: string) => (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
const copiesOf = (legId: string) => db.select().from(ledgerTransactions).where(eq(ledgerTransactions.sweepLegTxnId, legId));
const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  startedAt = new Date(Date.now() - 1000);
  x = await loadXmIds();
  adminId = x.adminUserId;
  emailBaseline = (await db.select({ id: emailQueue.id }).from(emailQueue)).map((r) => r.id);
  await cleanup();
  thresholdCents = (await db.select().from(ledgerSettings))[0].disbApprovalThresholdCents;
  const d = new Date(todayIso() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  giftDate = d.toISOString().slice(0, 10);
  const cat = x.clubActivityPublicDonationsId
    ? (await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, x.clubActivityPublicDonationsId)))[0]
    : undefined;
  mirroredCategoryId = cat?.mirrorsCategoryId ? cat.id : null;
  activityFundName = (await db.select().from(ledgerFunds).where(eq(ledgerFunds.id, x.activityFundId)))[0].name;

  const hash = await bcrypt.hash(PASSWORD, 10);
  const boardRole = (await db.select().from(roles).where(eq(roles.name, "board_member")))[0];
  const memberRole = (await db.select().from(roles).where(eq(roles.name, "member")))[0];
  approverId = (
    await db
      .insert(users)
      .values({ email: APPROVER.email, name: APPROVER.name, password: hash, role: "member", isActive: true })
      .returning({ id: users.id })
  )[0].id;
  await db.insert(userRoles).values([
    { userId: approverId, roleId: boardRole.id },
    { userId: approverId, roleId: memberRole.id },
  ]);

  adminCtx = await browser.newContext();
  adminPage = await adminCtx.newPage();
  await signInAsAdmin(adminPage);
  approverCtx = await browser.newContext();
  approverPage = await approverCtx.newPage();
  await approverPage.goto("/signin");
  await approverPage.fill('input[type="email"]', APPROVER.email);
  await approverPage.fill('input[type="password"]', PASSWORD);
  await approverPage.click('button[type="submit"]');
  await approverPage.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30_000 });
});

test.afterAll(async () => {
  await adminCtx?.close();
  await approverCtx?.close();
  await cleanup();
});

test.describe("sweep batch read surfaces (Increment 2b, pass 2)", () => {
  test.beforeEach(({}, info) => {
    info.skip(!mirroredCategoryId, "needs a Club Public donations category with a Foundation counterpart on this database");
  });

  test("should show a pending batch as one row at 1280 and one card at 1279 and 360, summary only, no party, memo or donor", async () => {
    const batch = await pendingBatch();
    approvedLeg = batch.legId;
    approvedSources = batch.ids;
    const page = approverPage;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/ledger/approvals");
    const row = page.locator(`tr[data-row-id="${batch.legId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`li[data-row-id="${batch.legId}"]`)).toBeHidden();
    await expect(row).toContainText("Itemized sweep: 2 gifts");
    await expect(row).toContainText(/Gifts? dated/);
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Reject" })).toBeVisible();
    // One row for the batch, never one per gift.
    await expect(page.locator(`[data-row-id]:visible`).filter({ hasText: "Itemized sweep" })).toHaveCount(1);

    for (const width of [1279, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/ledger/approvals");
      const card = page.locator(`li[data-row-id="${batch.legId}"]`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`tr[data-row-id="${batch.legId}"]`)).toBeHidden();
      await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Reject" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      const text = (await page.locator("#main-content").innerText()) + (await card.innerText());
      expect(text).not.toContain(`${TAG} Donor`);
      expect(text).not.toContain(`${TAG} gift`);
    }
  });

  test("should let a second user approve the whole batch, with the whole-batch wording", async () => {
    const page = approverPage;
    await page.setViewportSize({ width: 1279, height: 900 });
    await page.goto("/admin/ledger/approvals");
    const card = page.locator(`li[data-row-id="${approvedLeg}"]`);
    await card.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("This decides the whole batch of 2 gifts");
    await expect(dialog).toContainText("individual gifts cannot be decided separately");
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Sweep approved.")).toBeVisible({ timeout: 30_000 });

    const leg = await legRow(approvedLeg);
    expect(leg.approvedAt).not.toBeNull();
    approvedCopies = (await copiesOf(approvedLeg)).map((c) => c.id);
    expect(approvedCopies).toHaveLength(2);
    expect((await copiesOf(approvedLeg)).every((c) => c.status === "posted")).toBe(true);
  });

  test("should let a second user reject another batch, which frees its gifts", async () => {
    const batch = await pendingBatch();
    const page = approverPage;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/ledger/approvals");
    const row = page.locator(`tr[data-row-id="${batch.legId}"]`);
    await row.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("This decides the whole batch of 2 gifts");
    await expect(dialog).toContainText("Rejecting frees all of them to be swept again");
    await dialog.getByLabel(/Reason for rejection/).fill("Rejected by the QA run.");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Sweep rejected.")).toBeVisible({ timeout: 30_000 });

    const copies = await copiesOf(batch.legId);
    expect(copies.every((c) => c.status === "rejected")).toBe(true);
    // Freed: a fresh preview offers the same sources again (no live copy claims them).
    const live = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(and(inArray(ledgerTransactions.sweptFromTxnId, batch.ids), sql`${ledgerTransactions.status} <> 'rejected'`));
    expect(live).toHaveLength(0);
  });

  test("should chip the leg, the source gift and the Foundation copy, hide Edit, Delete, Split and Move, and open the Batch dialog", async () => {
    const page = adminPage;
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/admin/ledger/activity?entity=club");
    const leg = page.locator(`#txn-${approvedLeg}`);
    await expect(leg).toBeVisible({ timeout: 30_000 });
    await expect(leg).toContainText("Sweep of 2 gifts to the Foundation (approved)");
    const source = page.locator(`#txn-${approvedSources[0]}`);
    await expect(source).toContainText("Swept to the Foundation on");
    for (const row of [leg, source]) {
      await expect(row.getByRole("button", { name: "Batch" })).toBeVisible();
      for (const name of ["Edit", "Edit transfer", "Delete", "Split", "Move"]) {
        await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
    }

    await page.goto("/admin/ledger/charitable?entity=foundation");
    const copy = page.locator(`#txn-${approvedCopies[0]}`);
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await expect(copy).toContainText(`Swept from ${activityFundName} on`);
    await expect(copy.getByRole("button", { name: "Batch" })).toBeVisible();
    for (const name of ["Edit", "Delete", "Split", "Move"]) {
      await expect(copy.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    // A copy keeps its donor control.
    await expect(copy.getByRole("button", { name: /donor/i }).first()).toBeVisible();

    // The dialog on an approved batch: summary and the locked wording, no Void.
    await page.goto("/admin/ledger/activity?entity=club");
    await page.locator(`#txn-${approvedLeg}`).getByRole("button", { name: "Batch" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Itemized sweep: 2 gifts", { timeout: 20_000 });
    await expect(dialog).toContainText("Approved by the board");
    await expect(dialog).toContainText("it is locked");
    await expect(dialog.getByRole("button", { name: "Void this batch" })).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("should void a posted batch from the dialog and show the server's refusal while a copy is reconciled", async () => {
    const page = adminPage;
    await page.setViewportSize({ width: 1440, height: 900 });
    const g = await gifts(2, 1_000);
    const { legId, status } = await sweep(g.ids, g.total);
    expect(status).toBe("posted");
    const copy = (await copiesOf(legId))[0];
    await db.update(ledgerTransactions).set({ reconciled: true, reconciledAt: new Date() }).where(eq(ledgerTransactions.id, copy.id));

    await page.goto("/admin/ledger/activity?entity=club");
    await page.locator(`#txn-${legId}`).getByRole("button", { name: "Batch" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Posted", { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Void this batch" }).click();
    await dialog.getByLabel(/^Reason/).fill("Entered against the wrong deposit.");
    await dialog.getByRole("button", { name: "Void batch" }).click();
    await expect(dialog.getByRole("alert")).toContainText("cleared on a bank statement");
    await expect(dialog.getByRole("alert")).toContainText("Reopen the reconciliation session");
    expect(await legRow(legId)).toBeDefined();

    await db.update(ledgerTransactions).set({ reconciled: false, reconciledAt: null }).where(eq(ledgerTransactions.id, copy.id));
    await dialog.getByRole("button", { name: "Void batch" }).click();
    await expect(page.getByText(/Batch voided\. 2 gifts are free to sweep again/)).toBeVisible({ timeout: 30_000 });
    expect(await legRow(legId)).toBeUndefined();
    expect(await copiesOf(legId)).toHaveLength(0);
    expect((await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.id, g.ids))).length).toBe(2);
  });

  test("should select exactly a batch's copies with Match this batch and match them to one bank line", async () => {
    const page = adminPage;
    await page.setViewportSize({ width: 1440, height: 900 });
    const g = await gifts(2, 2_000);
    const { legId } = await sweep(g.ids, g.total);
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const start = `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
    const end = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}`;
    const session = (
      await db
        .insert(ledgerReconciliationSessions)
        .values({
          bankAccountId: x.foundationBankId,
          statementPeriodStart: start,
          statementPeriodEnd: end,
          openingBalanceCents: 0,
          closingBalanceCents: g.total,
          status: "open",
          csvFilename: SESSION_CSV,
        })
        .returning({ id: ledgerReconciliationSessions.id })
    )[0];
    await db.insert(ledgerBankLines).values({
      sessionId: session.id,
      bankAccountId: x.foundationBankId,
      postingDate: todayIso(),
      description: `${TAG} sweep deposit`,
      amountCents: g.total,
      dedupeKey: `${SESSION_CSV}-${session.id}`,
    });

    await page.goto(`/admin/ledger/reconciliation/${session.id}`);
    const line = page.locator("tr", { hasText: `${TAG} sweep deposit` });
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.getByRole("button", { name: "Match", exact: true }).click();
    const picker = page.getByRole("dialog");
    // Other batches on the same account (the approved one from earlier) group separately.
    const header = `Sweep of 2 gifts, $${(g.total / 100).toFixed(2)},`;
    const group = picker.getByRole("listitem").filter({ hasText: header });
    await expect(group).toContainText(/gifts? dated/);
    await group.getByRole("button", { name: "Match this batch" }).click();
    await expect(picker).toContainText("balanced");
    await picker.getByRole("button", { name: "Match selected" }).click();
    await expect(page.getByText(/Balanced\./)).toBeVisible({ timeout: 20_000 });
    const matches = await db.select().from(ledgerReconciliationMatches).where(eq(ledgerReconciliationMatches.sessionId, session.id));
    expect(matches.map((m) => m.transactionId).sort()).toEqual((await copiesOf(legId)).map((c) => c.id).sort());
  });

  test("should label a swept gift's source and copy on the donor page", async () => {
    const page = adminPage;
    const donor = (await db.insert(ledgerDonors).values({ name: DONOR_NAME, emails: [] }).returning({ id: ledgerDonors.id }))[0];
    const g = await gifts(1, 3_000, { donorId: donor.id });
    await sweep(g.ids, g.total);
    await page.goto(`/admin/ledger/donors/${donor.id}`);
    await expect(page.getByText(/Swept to the Foundation on/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`Swept from ${activityFundName} on`))).toBeVisible();
    await expect(page.getByText(/not yet a Foundation gift/)).toHaveCount(0);
  });

  test("should document the itemized sweep in the Treasury guide and say nothing of a single lump amount anywhere on it", async () => {
    const page = adminPage;
    await page.goto("/admin/ledger/guide");
    await expect(page.getByRole("heading", { name: "Sweeping to the Foundation" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Sweeping to the Foundation" })).toBeVisible();
    const text = await page.locator("#main-content").innerText();
    expect(text).toContain("An approved batch cannot be voided");
    expect(text).not.toMatch(/lump sweep|one lump amount|lump amount/i);
    await page.goto("/admin/ledger/settings/categories");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("#main-content").innerText()).not.toMatch(/lump sweep|one lump amount/i);
  });
});
