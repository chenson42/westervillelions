import { getActivityFundName } from "./helpers/fund-names";
import { test, expect, type Page, type APIResponse } from "@playwright/test";
import bcrypt from "bcryptjs";
import { and, eq, ilike, inArray, notInArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  emailQueue,
  ledgerReimbursements,
  ledgerSettings,
  ledgerTransactions,
  members,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";
import { loadXmIds, todayIso, type XmIds } from "./helpers/cross-entity-move-fixtures";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Approvals page, Increment 2a: reject attribution, "Recently decided", the
 * ?txn= deep link, the sign-in callback, and the email link
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3 addendum,
 * "2a qa click-throughs").
 *
 * What this commemorates (regressions):
 *  - a correlated subquery in resolveApprovalTarget bound to the INNER table, so
 *    every pending banner said "You recorded this" and a plain disbursement was
 *    called a transfer. Mocked unit tests cannot see it; only real Postgres does.
 *  - a rejection stamped nobody, so the loser of a race was told "A board member"
 *    and the History could not say who rejected what.
 *  - the signed-out redirect dropped the query string, so an emailed deep link
 *    landed on the bare Approvals page after sign-in.
 *
 * Viewer is the e2e admin (ledger.approve). Other deciders are fixture users
 * (example.invalid) who never sign in. Fixtures are direct DB inserts on the dev DB
 * (`DATABASE_URL`, never prod), tagged "QATEST E2E Approvals History", with
 * far-future decision times (year 2090) so they outrank anything else in the
 * newest-25 list. The only rows that go through the real routes (and therefore
 * queue approver emails, all blocked_non_production outside production) are the
 * three email-link tests, which assert every queued row is blocked. cleanup() runs
 * before AND after and removes the email rows this run created. Serial, one
 * worker: see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });

// The stored public-fund name (DECISION-127), resolved once per run, never a literal.
let activityName = "Public Funds";
test.beforeAll(async () => {
  activityName = await getActivityFundName();
});
test.setTimeout(120_000);

const TAG = "QATEST E2E Approvals History";
const BOARD_EMAIL = "qa-history-board@example.invalid";
const GHOST_EMAIL = "qa-history-ghost@example.invalid";
const VIEWER_EMAIL = "qa-history-viewer@example.invalid";
const PASSWORD = "E2eApprovalsHistory!2026";
const BOARD_NAME = "QA History Board";
const LONG_MINUTE = `MINUTE-${"A".repeat(120)}`;
const LONG_REASON = Array.from({ length: 60 }, (_, i) => `reason${i + 1}`).join(" ");

interface Ids {
  x: XmIds;
  adminUserId: string;
  adminName: string;
  boardUserId: string;
  cents: number;
  // decided
  approvedOther: string;
  approvedMe: string;
  approvedGhost: string;
  approvedFoundation: string;
  rejectedOther: string;
  rejectedMe: string;
  rejectedLegacy: string;
  transferApproved: string;
  transferApprovedIncome: string;
  sweepRejected: string;
  sweepRejectedIncome: string;
  // excluded
  reimbursementPaid: string;
  underSweep: string;
  underSweepIncome: string;
  plainNoMinute: string;
  // pending
  pendingNotOwn: string;
  pendingOwn: string;
  pendingSweep: string;
  pendingTransfer: string;
  pendingApproveFlow: string;
  pendingSweepRejectUi: string;
  pendingSweepDoubleClick: string;
  pendingSweepIncomeOwn: string;
}
const ids = {} as Ids;
let emailBaseline: string[] = [];

const GROUP = (n: number) => `00000000-0000-4000-8000-0000000b00${String(n).padStart(2, "0")}`;
const at = (iso: string) => new Date(iso);

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

async function cleanup(): Promise<void> {
  await db.delete(ledgerReimbursements).where(ilike(ledgerReimbursements.description, `${TAG}%`));
  await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.memo, `${TAG}%`));
  const fixtureUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [BOARD_EMAIL, GHOST_EMAIL, VIEWER_EMAIL]));
  const fixtureIds = fixtureUsers.map((u) => u.id);
  if (fixtureIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, fixtureIds));
    await db.delete(users).where(inArray(users.id, fixtureIds));
  }
}

/** Email rows this run created (everything not in the pre-run id set). */
async function emailsSinceBaseline() {
  return emailBaseline.length > 0
    ? db.select().from(emailQueue).where(notInArray(emailQueue.id, emailBaseline))
    : db.select().from(emailQueue);
}

interface SeedArgs {
  label: string;
  flow?: "expense" | "income";
  entityId?: string;
  fundId?: string;
  bankAccountId?: string;
  cents?: number;
  party?: string | null;
  status: "pending" | "posted" | "rejected";
  recordedBy: string;
  groupId?: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  boardMinute?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  updatedAt?: Date;
}

async function seed(a: SeedArgs): Promise<string> {
  const [row] = await db
    .insert(ledgerTransactions)
    .values({
      entityId: a.entityId ?? ids.x.clubEntityId,
      fundId: a.fundId ?? ids.x.adminFundId,
      bankAccountId: a.bankAccountId ?? ids.x.adminBankId,
      txnDate: todayIso(),
      flow: a.flow ?? "expense",
      amountCents: a.cents ?? ids.cents,
      party: a.party === undefined ? `${TAG} ${a.label} Co` : a.party,
      memo: `${TAG} ${a.label}`,
      status: a.status,
      transferGroupId: a.groupId ?? null,
      recordedByUserId: a.recordedBy,
      approvedByUserId: a.approvedBy ?? null,
      approvedAt: a.approvedAt ?? null,
      boardMinute: a.boardMinute ?? null,
      rejectedByUserId: a.rejectedBy ?? null,
      rejectedAt: a.rejectedAt ?? null,
      rejectionReason: a.rejectionReason ?? null,
      ...(a.updatedAt ? { updatedAt: a.updatedAt } : {}),
    })
    .returning({ id: ledgerTransactions.id });
  return row.id;
}

/** A Sweep (Club Activity -> Foundation Charitable) or Transfer (Club Administrative -> Activity) pair. */
async function seedPair(
  kind: "sweep" | "transfer",
  label: string,
  common: Omit<SeedArgs, "label" | "flow" | "fundId" | "entityId" | "bankAccountId" | "groupId" | "party">,
  group: string,
): Promise<{ expense: string; income: string }> {
  const sweep = kind === "sweep";
  const expense = await seed({
    ...common,
    label,
    flow: "expense",
    party: null,
    groupId: group,
    entityId: ids.x.clubEntityId,
    fundId: sweep ? ids.x.activityFundId : ids.x.adminFundId,
    bankAccountId: ids.x.adminBankId,
  });
  const income = await seed({
    ...common,
    label,
    flow: "income",
    party: null,
    groupId: group,
    entityId: sweep ? ids.x.foundationEntityId : ids.x.clubEntityId,
    fundId: sweep ? ids.x.charitableFundId : ids.x.activityFundId,
    bankAccountId: sweep ? ids.x.foundationBankId : ids.x.adminBankId,
  });
  return { expense, income };
}

const visibleRow = (page: Page, id: string) => page.locator(`[data-row-id="${id}"]:visible`);
const banner = (page: Page) => page.locator('div[role="status"]').first();
const h1 = (page: Page) => page.locator("h1.text-3xl");
const ROW_URL = (id: string, tab?: "decided" | "pending") =>
  `/admin/ledger/approvals?${tab ? `tab=${tab}&` : ""}txn=${id}`;

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
}

async function overflow(page: Page) {
  return page.evaluate(() => ({ inner: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
}

test.beforeAll(async () => {
  await cleanup();
  emailBaseline = (await db.select({ id: emailQueue.id }).from(emailQueue)).map((r) => r.id);
  ids.x = await loadXmIds();
  const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
  const admin = await one(db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, adminEmail)), "e2e admin");
  ids.adminUserId = admin.id;
  ids.adminName = admin.name ?? "";
  if (!ids.adminName) throw new Error("e2e fixture lookup failed: the e2e admin has no name");
  const settings = await one(db.select().from(ledgerSettings), "ledger settings");
  ids.cents = settings.disbApprovalThresholdCents + 12_345;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const role = async (name: string) => (await one(db.select().from(roles).where(eq(roles.name, name)), `role ${name}`)).id;
  const mk = async (email: string, name: string) =>
    (await db.insert(users).values({ email, name, password: passwordHash, role: "member", isActive: true }).returning({ id: users.id }))[0].id;
  ids.boardUserId = await mk(BOARD_EMAIL, BOARD_NAME);
  const ghostId = await mk(GHOST_EMAIL, "QA History Ghost");
  const viewerId = await mk(VIEWER_EMAIL, "QA History Viewer");
  await db.insert(userRoles).values([
    { userId: ids.boardUserId, roleId: await role("board_member") },
    { userId: ids.boardUserId, roleId: await role("member") },
    // budget_committee carries ledger.view but NOT ledger.approve.
    { userId: viewerId, roleId: await role("budget_committee") },
    { userId: viewerId, roleId: await role("member") },
  ]);

  const other = ids.boardUserId;
  const me = ids.adminUserId;

  // ---- decided (timestamps strictly descending in this order) ----
  ids.approvedGhost = await seed({ label: "approved ghost", status: "posted", recordedBy: me, approvedBy: ghostId, approvedAt: at("2090-06-09T16:00:00Z"), boardMinute: "Ghost minute" });
  // the approver account is deleted afterwards: approved_by_user_id goes NULL (ON DELETE SET NULL)
  await db.delete(users).where(eq(users.id, ghostId));
  ids.approvedOther = await seed({ label: "approved other", cents: 227_500, status: "posted", recordedBy: me, approvedBy: other, approvedAt: at("2090-06-08T16:00:00Z"), boardMinute: LONG_MINUTE });
  ids.approvedMe = await seed({ label: "approved me", cents: 345_600, status: "posted", recordedBy: other, approvedBy: me, approvedAt: at("2090-06-07T16:00:00Z"), boardMinute: "Motion QA-me" });
  ids.rejectedOther = await seed({ label: "rejected other", cents: 119_900, status: "rejected", recordedBy: me, rejectedBy: other, rejectedAt: at("2090-06-06T16:00:00Z"), rejectionReason: LONG_REASON });
  ids.rejectedMe = await seed({ label: "rejected me", cents: 120_100, status: "rejected", recordedBy: other, rejectedBy: me, rejectedAt: at("2090-06-05T16:00:00Z"), rejectionReason: "Rejected by the viewer" });
  ids.rejectedLegacy = await seed({ label: "rejected legacy", cents: 120_200, status: "rejected", recordedBy: other, rejectionReason: "Legacy reason", updatedAt: at("2090-06-04T16:00:00Z") });
  const transfer = await seedPair("transfer", "transfer approved", { cents: 150_000, status: "posted", recordedBy: other, approvedBy: me, approvedAt: at("2090-06-03T02:30:00Z"), boardMinute: "Transfer motion" }, GROUP(1));
  ids.transferApproved = transfer.expense;
  ids.transferApprovedIncome = transfer.income;
  const sweep = await seedPair("sweep", "sweep rejected", { cents: 160_000, status: "rejected", recordedBy: me, rejectedBy: other, rejectedAt: at("2090-06-02T16:00:00Z"), rejectionReason: "Sweep not authorised" }, GROUP(2));
  ids.sweepRejected = sweep.expense;
  ids.sweepRejectedIncome = sweep.income;
  ids.approvedFoundation = await seed({ label: "approved foundation", cents: 130_000, status: "posted", recordedBy: other, approvedBy: me, approvedAt: at("2090-06-01T16:00:00Z"), boardMinute: "Foundation motion", entityId: ids.x.foundationEntityId, fundId: ids.x.charitableFundId, bankAccountId: ids.x.foundationBankId });

  // ---- excluded from the board-decision list ----
  ids.reimbursementPaid = await seed({ label: "reimbursement paid", status: "posted", recordedBy: other, approvedBy: me, approvedAt: at("2090-07-01T16:00:00Z"), boardMinute: "Reimbursement stamp", updatedAt: at("2090-07-01T16:00:00Z") });
  const member = await one(db.select({ id: members.id }).from(members).limit(1), "any member (read-only lookup)");
  await db
    .insert(ledgerReimbursements)
    .values({
      submittedByMemberId: member.id,
      submittedByUserId: other,
      amountCents: ids.cents,
      description: `${TAG} reimbursement`,
      receiptStorageKey: "receipts/00000000-0000-4000-8000-0000000b0099/qatest.pdf",
      status: "paid",
      ledgerTransactionId: ids.reimbursementPaid,
    });
  const under = await seedPair("sweep", "under-threshold sweep", { cents: 5_000, status: "posted", recordedBy: other, boardMinute: "Creation-time minute", updatedAt: at("2090-07-02T16:00:00Z") }, GROUP(3));
  ids.underSweep = under.expense;
  ids.underSweepIncome = under.income;
  ids.plainNoMinute = await seed({ label: "plain posted", cents: 4_000, status: "posted", recordedBy: other, updatedAt: at("2090-07-03T16:00:00Z") });

  // ---- pending ----
  ids.pendingNotOwn = await seed({ label: "pending not own", cents: 227_500, status: "pending", recordedBy: other });
  ids.pendingOwn = await seed({ label: "pending own", status: "pending", recordedBy: me });
  ids.pendingSweep = (await seedPair("sweep", "pending sweep", { cents: 227_500, status: "pending", recordedBy: other, boardMinute: "Sweep motion" }, GROUP(4))).expense;
  ids.pendingTransfer = (await seedPair("transfer", "pending transfer", { status: "pending", recordedBy: other }, GROUP(5))).expense;
  ids.pendingApproveFlow = await seed({ label: "pending approve flow", status: "pending", recordedBy: other });
  ids.pendingSweepRejectUi = (await seedPair("sweep", "pending sweep reject ui", { status: "pending", recordedBy: other, boardMinute: "Sweep motion" }, GROUP(6))).expense;
  ids.pendingSweepDoubleClick = (await seedPair("sweep", "pending sweep double click", { status: "pending", recordedBy: other, boardMinute: "Sweep motion" }, GROUP(7))).expense;
  // a pair whose INCOME leg alone was recorded by the viewer (hand-edited data; the either-leg rule must still call it theirs)
  const incomeOwn = await seedPair("sweep", "pending sweep income own", { status: "pending", recordedBy: other, boardMinute: "Sweep motion" }, GROUP(8));
  ids.pendingSweepIncomeOwn = incomeOwn.expense;
  await db.update(ledgerTransactions).set({ recordedByUserId: me }).where(eq(ledgerTransactions.id, incomeOwn.income));
});

test.afterAll(async () => {
  await cleanup();
  const created = await emailsSinceBaseline();
  // Safety: only ever delete rows that were provably never delivered.
  const delivered = created.filter((e) => e.status === "sent");
  if (delivered.length === 0 && created.length > 0) {
    await db.delete(emailQueue).where(inArray(emailQueue.id, created.map((e) => e.id)));
  }
});

test.describe("Approvals page, Increment 2a (admin viewer)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
    await signInAsAdmin(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ---------------------------------------------------------------- tabs

  test("should render Approvals with Pending and Recently decided tabs and fall back to Pending for ?tab=bogus", async () => {
    // Arrange
    const expense = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.status, "pending"), eq(ledgerTransactions.flow, "expense")));
    const n = expense.length; // one Approvals row per pending expense (a pair lists once)
    expect(n).toBeGreaterThanOrEqual(7);

    // Act
    await load(page, "/admin/ledger/approvals?tab=bogus");

    // Assert
    await expect(h1(page)).toHaveText("Approvals");
    const tabs = page.getByRole("navigation", { name: "Approvals views" });
    await expect(tabs.getByRole("link", { name: /^Pending \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Recently decided" })).not.toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: `Pending (${n})` })).toBeVisible();
    await expect(page.getByText(`${n} items awaiting approval`)).toBeVisible();
  });

  test("should list decisions newest first with decision, decider, Eastern time and the full minute or reason — covers the decider label variants", async () => {
    // Arrange / Act
    await load(page, "/admin/ledger/approvals?tab=decided");

    // Assert: order is the fixture order (approved and rejected interleaved; legacy dated by updated_at; a pair is one card)
    const order = await page.locator("ul > li[data-row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")));
    expect(order).toEqual([
      ids.approvedGhost,
      ids.approvedOther,
      ids.approvedMe,
      ids.rejectedOther,
      ids.rejectedMe,
      ids.rejectedLegacy,
      ids.transferApproved,
      ids.sweepRejected,
      ids.approvedFoundation,
    ]);
    await expect(page.locator(`[data-row-id="${ids.transferApprovedIncome}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-row-id="${ids.sweepRejectedIncome}"]`)).toHaveCount(0);

    await expect(h1(page)).toHaveText("Approvals");
    await expect(page.getByRole("navigation", { name: "Approvals views" }).getByRole("link", { name: "Recently decided" })).toHaveAttribute("aria-current", "page");

    const card = (id: string) => page.locator(`[data-row-id="${id}"]`);
    await expect(card(ids.approvedGhost)).toContainText("Approved by a board member");
    await expect(card(ids.approvedOther)).toContainText(`Approved by ${BOARD_NAME}`);
    await expect(card(ids.approvedOther)).toContainText("$2,275.00");
    await expect(card(ids.approvedOther)).toContainText("Jun 8, 2090 at 12:00 PM");
    await expect(card(ids.approvedOther)).toContainText(LONG_MINUTE); // the full minute, not truncated
    await expect(card(ids.approvedMe)).toContainText("Approved by You");
    await expect(card(ids.rejectedOther)).toContainText(`Rejected by ${BOARD_NAME}`);
    await expect(card(ids.rejectedOther)).toContainText(LONG_REASON); // 60 words in full
    await expect(card(ids.rejectedMe)).toContainText("Rejected by You");
    await expect(card(ids.rejectedLegacy)).toContainText("Rejected, decider not on file");
    await expect(card(ids.rejectedLegacy)).toContainText("Jun 4, 2090 at 12:00 PM"); // updated_at, no rejected_at
    await expect(card(ids.transferApproved)).toContainText("Transfer");
    await expect(card(ids.transferApproved)).toContainText("Jun 2, 2090 at 10:30 PM"); // 02:30Z is the previous evening in New York
    await expect(card(ids.sweepRejected)).toContainText("Foundation");
    await expect(card(ids.sweepRejected)).toContainText("Club");
    await expect(card(ids.approvedFoundation)).toContainText("Foundation"); // both entities appear
    await expect(card(ids.approvedMe)).toContainText("Recorded by");
    const o = await overflow(page);
    expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
  });

  test("should leave reimbursement-stamped, under-threshold-Sweep and no-minute rows out of Recently decided", async () => {
    // Arrange / Act
    await load(page, "/admin/ledger/approvals?tab=decided");

    // Assert
    for (const id of [ids.reimbursementPaid, ids.underSweep, ids.underSweepIncome, ids.plainNoMinute]) {
      await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(0);
    }
    await expect(page.getByText("Showing the 25 most recent decisions.")).toBeVisible();
  });

  // ------------------------------------------------------------ ?txn= banners

  const banners: Array<{ name: string; id: () => string; text: (string | RegExp)[]; tone?: string; link?: boolean }> = [
    {
      name: "pending, recorded by someone else",
      id: () => ids.pendingNotOwn,
      text: ["This is the disbursement from your email. It is waiting for a board decision."],
    },
    {
      name: "pending, recorded by the viewer",
      id: () => ids.pendingOwn,
      text: ["You recorded this disbursement, so another board member needs to decide it."],
    },
    {
      name: "pending Sweep, expense-leg id",
      id: () => ids.pendingSweep,
      text: ["This is the sweep from your email. It is waiting for a board decision."],
    },
    {
      name: "pending Transfer, expense-leg id",
      id: () => ids.pendingTransfer,
      text: ["This is the transfer from your email. It is waiting for a board decision."],
    },
    {
      name: "pending Sweep whose income leg alone the viewer recorded",
      id: () => ids.pendingSweepIncomeOwn,
      text: ["You recorded this sweep, so another board member needs to decide it."],
    },
    {
      // 2b replaced the 2a "Already approved ... nothing more to do" row (Phase 3 addendum B6, ruling 3):
      // the viewer recorded this entry, so the banner says so and names the approver.
      name: "approved by someone else, recorded by the viewer",
      id: () => ids.approvedOther,
      text: [`You recorded this disbursement, so another board member decides it. Approved by ${BOARD_NAME} on Jun 8, 2090 at 12:00 PM.`],
      link: true,
    },
    {
      name: "approved by the viewer",
      id: () => ids.approvedMe,
      text: [`You approved this $3,456.00 disbursement to ${TAG} approved me Co on Jun 7, 2090 at 12:00 PM.`],
      link: true,
    },
    {
      name: "approved by an account since deleted, recorded by the viewer",
      id: () => ids.approvedGhost,
      text: ["You recorded this disbursement, so another board member decides it. Approved by A board member on Jun 9, 2090 at 12:00 PM."],
      link: true,
    },
    {
      name: "rejected by someone else, with the reason",
      id: () => ids.rejectedOther,
      text: [`Rejected. ${BOARD_NAME} rejected this $1,199.00 disbursement on Jun 6, 2090 at 12:00 PM. Reason: ${LONG_REASON}.`],
      link: true,
    },
    {
      name: "rejected by the viewer",
      id: () => ids.rejectedMe,
      text: ["You rejected this $1,201.00 disbursement on Jun 5, 2090 at 12:00 PM. Reason: Rejected by the viewer."],
      link: true,
    },
    {
      name: "legacy rejection with no stamp",
      id: () => ids.rejectedLegacy,
      text: ["This disbursement was rejected on Jun 4, 2090 at 12:00 PM. Reason: Legacy reason."],
      link: true,
    },
    {
      name: "approved Transfer, expense-leg id",
      id: () => ids.transferApproved,
      text: ["You approved this $1,500.00 transfer on Jun 2, 2090 at 10:30 PM."],
      link: true,
    },
    {
      name: "approved Transfer, INCOME-leg id resolves to its pair",
      id: () => ids.transferApprovedIncome,
      text: ["You approved this $1,500.00 transfer on Jun 2, 2090 at 10:30 PM."],
      link: true,
    },
    {
      name: "rejected Sweep, expense-leg id",
      id: () => ids.sweepRejected,
      text: [`Rejected. ${BOARD_NAME} rejected this $1,600.00 sweep on Jun 2, 2090 at 12:00 PM. Reason: Sweep not authorised.`],
      link: true,
    },
    {
      name: "rejected Sweep, INCOME-leg id resolves to its pair",
      id: () => ids.sweepRejectedIncome,
      text: [`Rejected. ${BOARD_NAME} rejected this $1,600.00 sweep on Jun 2, 2090 at 12:00 PM.`],
      link: true,
    },
    {
      name: "a reimbursement-paid row (stamped, but not a board decision)",
      id: () => ids.reimbursementPaid,
      text: ["This entry did not need board approval, so there is nothing for you to do."],
    },
    {
      name: "an under-threshold Sweep (creation-time minute, no approval stamp)",
      id: () => ids.underSweep,
      text: ["This entry did not need board approval, so there is nothing for you to do."],
    },
    {
      name: "a posted expense with no board decision",
      id: () => ids.plainNoMinute,
      text: ["This entry did not need board approval, so there is nothing for you to do."],
    },
    {
      name: "an id that does not exist (deleted)",
      id: () => "00000000-0000-4000-8000-00000000dead",
      text: ["We can't find that disbursement. It may have been deleted after it was recorded."],
    },
  ];

  for (const b of banners) {
    test(`should show the right banner for ?txn= ${b.name} — regression for the pending banner that always said "You recorded this"`, async () => {
      // Arrange
      await page.setViewportSize({ width: 390, height: 844 });

      // Act
      const response = await page.goto(ROW_URL(b.id()), { waitUntil: "networkidle" });

      // Assert
      expect(response?.status()).toBe(200);
      for (const t of b.text) await expect(banner(page)).toContainText(t);
      if (b.link) {
        const link = banner(page).getByRole("link", { name: /See it under Recently decided/ });
        await expect(link).toBeVisible();
        const href = await link.getAttribute("href");
        expect(href).toMatch(/^\/admin\/ledger\/approvals\?tab=decided&txn=[0-9a-f-]{36}$/);
      } else {
        await expect(banner(page).getByRole("link")).toHaveCount(0);
      }
      await expect(banner(page)).not.toContainText("@");
      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
    });
  }

  test("should show a pending banner that distinguishes a plain disbursement from a transfer — regression for the correlated-subquery partner lookup", async () => {
    // Arrange / Act
    await load(page, ROW_URL(ids.pendingNotOwn));

    // Assert: before the fix a plain row matched ANY income row and read "the transfer from your email"
    await expect(banner(page)).toContainText("the disbursement from your email");
    await expect(banner(page)).not.toContainText("transfer");
    await expect(banner(page)).not.toContainText("sweep");
  });

  for (const [label, raw] of [
    ["not-a-uuid", "not-a-uuid"],
    ["an injection string", "'; select 1 --"],
    ["a 5,000-character value", "x".repeat(5_000)],
    ["an HTML string", "<script>window.__pwned=1</script>"],
  ] as const) {
    test(`should answer ?txn=${label} with the not-found banner and echo nothing — no 500`, async () => {
      // Arrange / Act
      const response = await page.goto(`/admin/ledger/approvals?txn=${encodeURIComponent(raw)}`, { waitUntil: "networkidle" });

      // Assert
      expect(response?.status()).toBe(200);
      await expect(banner(page)).toContainText("We can't find that disbursement.");
      const body = await page.locator("body").innerText();
      expect(body).not.toContain(raw.slice(0, 20));
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    });
  }

  // ------------------------------------------------------------- highlight

  for (const width of [390, 1280]) {
    test(`should scroll to, focus and keep the ring on the ?txn= pending row at ${width}px past 3 seconds`, async () => {
      // Arrange: pick the last pending row in the visible list so a scroll is required on a phone
      await page.setViewportSize({ width, height: 500 });
      await load(page, "/admin/ledger/approvals");
      const lastId = await page.locator("[data-row-id]:visible").evaluateAll((els) => els[els.length - 1].getAttribute("data-row-id")!);

      // Act
      await load(page, ROW_URL(lastId));
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-row-id"))).toBe(lastId);
      await page.waitForTimeout(3_500);

      // Assert
      const row = visibleRow(page, lastId);
      await expect(row).toHaveClass(/ring-2/);
      await expect(row).toHaveClass(/ring-lions-gold/);
      const box = await row.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeLessThan(500);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect(page.url()).toContain(`txn=${lastId}`); // no router.replace stripped it
      await page.screenshot({ path: process.env.QA_SHOTS ? `${process.env.QA_SHOTS}/highlight-${width}.png` : undefined });
    });
  }

  test("should highlight the row on the Recently decided tab when the deep link names a decided id", async () => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 500 });

    // Act
    await load(page, ROW_URL(ids.approvedFoundation, "decided"));
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-row-id"))).toBe(ids.approvedFoundation);
    await page.waitForTimeout(3_500);

    // Assert
    await expect(visibleRow(page, ids.approvedFoundation)).toHaveClass(/ring-2/);
    await expect(page.locator("[data-row-id].ring-2")).toHaveCount(1);
    await expect(banner(page)).toContainText("approved this $1,300.00 disbursement");
  });

  test("should not highlight any row when a decided id is viewed on the Pending tab", async () => {
    // Arrange / Act
    await load(page, ROW_URL(ids.approvedOther));

    // Assert
    await expect(page.locator("[data-row-id].ring-2")).toHaveCount(0);
    await expect(banner(page).getByRole("link", { name: /See it under Recently decided/ })).toBeVisible();
  });

  test("should render the Pending tab, the Recently decided tab and a deep link with no hydration warning and no uncaught page error", async () => {
    // Arrange: the Next dev "1 Issue" badge is the CSP eval() message; a hydration mismatch is the thing to rule out
    const problems: string[] = [];
    page.on("console", (m) => {
      if (/hydrat/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
    await page.setViewportSize({ width: 390, height: 844 });

    // Act
    for (const url of [
      "/admin/ledger/approvals",
      "/admin/ledger/approvals?tab=decided",
      ROW_URL(ids.pendingNotOwn),
      ROW_URL(ids.approvedOther, "decided"),
    ]) {
      await load(page, url);
      await page.waitForTimeout(500);
    }

    // Assert
    expect(problems).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  });

  // ------------------------------------------------ dialogs, amounts, F1 to F3

  test("should word the Transfer and Sweep dialogs with the right noun and show both books on a Sweep card", async () => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "/admin/ledger/approvals");

    // Assert: Sweep card names both entities (F2)
    await expect(visibleRow(page, ids.pendingSweep)).toContainText(`${activityName} (Club) → Charitable Fund (Foundation)`);
    await expect(visibleRow(page, ids.pendingNotOwn)).toContainText("Club");

    // Act / Assert: Sweep approve dialog
    await visibleRow(page, ids.pendingSweep).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("dialog").getByText("Approve Sweep", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("isbursement");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Transfer approve dialog
    await visibleRow(page, ids.pendingTransfer).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("dialog").getByText("Approve Transfer", { exact: true }).first()).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Sweep reject dialog placeholder
    await visibleRow(page, ids.pendingSweep).getByRole("button", { name: "Reject" }).click();
    await expect(page.getByRole("dialog").getByText("Reject Sweep", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#reject-reason")).toHaveAttribute("placeholder", "Explain why this sweep is being rejected…");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // nothing changed
    const rows = await db.select({ status: ledgerTransactions.status }).from(ledgerTransactions).where(inArray(ledgerTransactions.id, [ids.pendingSweep, ids.pendingTransfer]));
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
  });

  test("should show $2,275.00 with a thousands separator on the phone card, the desktop table and the History", async () => {
    // Arrange / Act / Assert: card
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "/admin/ledger/approvals");
    await expect(visibleRow(page, ids.pendingNotOwn)).toContainText("$2,275.00");
    await expect(visibleRow(page, ids.pendingNotOwn)).not.toContainText("$2275.00");

    // table
    await page.setViewportSize({ width: 1280, height: 900 });
    await load(page, "/admin/ledger/approvals");
    expect(await page.locator("table").first().isVisible()).toBe(true);
    await expect(visibleRow(page, ids.pendingNotOwn)).toContainText("$2,275.00");

    // History
    await load(page, "/admin/ledger/approvals?tab=decided");
    await expect(visibleRow(page, ids.approvedOther)).toContainText("$2,275.00");
  });

  // ------------------------------------------- decide from the page, end to end

  test("should keep the You approved banner after approving from the card (router.refresh)", async () => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, ROW_URL(ids.pendingApproveFlow));
    await expect(banner(page)).toContainText("It is waiting for a board decision.");

    // Act
    await visibleRow(page, ids.pendingApproveFlow).getByRole("button", { name: "Approve" }).click();
    await page.fill("#approve-board-minute", "Motion QA-2a-flow");
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();

    // Assert
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Disbursement approved." })).toBeVisible();
    await expect(banner(page)).toContainText("You approved this", { timeout: 15_000 });
    expect(page.url()).toContain(`txn=${ids.pendingApproveFlow}`);
    const [row] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.pendingApproveFlow));
    expect(row.status).toBe("posted");
    expect(row.approvedByUserId).toBe(ids.adminUserId);
    expect(row.rejectedByUserId).toBeNull();
    expect(row.rejectedAt).toBeNull();
  });

  test("should stamp BOTH legs of a Sweep with the rejector and time when rejected from the page, leave approvedAt null, and show it under Recently decided", async () => {
    // Arrange
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "/admin/ledger/approvals");
    const before = new Date();

    // Act
    await visibleRow(page, ids.pendingSweepRejectUi).getByRole("button", { name: "Reject" }).click();
    await page.fill("#reject-reason", LONG_REASON);
    await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();

    // Assert: toast uses the noun; DB has both legs stamped, no approval stamp
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Sweep rejected." })).toBeVisible();
    await expect(page.locator(`[data-row-id="${ids.pendingSweepRejectUi}"]`)).toHaveCount(0);
    const legs = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.memo, `${TAG} pending sweep reject ui`));
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg.status).toBe("rejected");
      expect(leg.rejectedByUserId).toBe(ids.adminUserId);
      expect(leg.rejectedAt).not.toBeNull();
      expect(Math.abs(leg.rejectedAt!.getTime() - before.getTime())).toBeLessThan(120_000);
      expect(leg.approvedAt).toBeNull();
      expect(leg.approvedByUserId).toBeNull();
      expect(leg.rejectionReason).toBe(LONG_REASON);
    }
    expect(legs[0].rejectedAt!.getTime()).toBe(legs[1].rejectedAt!.getTime());

    // History: one card for the pair, "Rejected by You", reason in full
    await load(page, ROW_URL(ids.pendingSweepRejectUi, "decided"));
    await expect(page.locator(`ul > li[data-row-id="${ids.pendingSweepRejectUi}"]`)).toHaveCount(1);
    const card = visibleRow(page, ids.pendingSweepRejectUi);
    await expect(card).toContainText("Rejected by You");
    await expect(card).toContainText(LONG_REASON);
    await expect(card).toContainText("Foundation");
    await expect(banner(page)).toContainText("You rejected this");
  });

  test("should answer a reject double-click with a 409 toast that reads You already rejected this sweep", async () => {
    // Arrange: open the dialog on a pending Sweep, then the same user rejects it through the API (the first click)
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "/admin/ledger/approvals");
    await visibleRow(page, ids.pendingSweepDoubleClick).getByRole("button", { name: "Reject" }).click();
    await page.fill("#reject-reason", "double click reason");
    const first = await page.request.post(`/api/admin/ledger/transactions/${ids.pendingSweepDoubleClick}/reject`, { data: { reason: "first click" } });
    expect(first.status()).toBe(200);

    // Act: the second click
    await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();

    // Assert
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "You already rejected this sweep." })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const legs = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.memo, `${TAG} pending sweep double click`));
    for (const leg of legs) {
      expect(leg.rejectionReason).toBe("first click"); // the second click wrote nothing
      expect(leg.rejectedByUserId).toBe(ids.adminUserId);
    }
  });

  test("should answer 5 of 5 parallel same-user reject double-posts with one 200 and one typed 409 naming the rejector, both legs stamped (live check L5)", async () => {
    const results: string[] = [];
    for (let i = 1; i <= 5; i++) {
      // Arrange
      const sweep = await seedPair("sweep", `l5 sweep ${i}`, { status: "pending", recordedBy: ids.boardUserId, boardMinute: "Sweep motion" }, GROUP(20 + i));

      // Act: two simultaneous POSTs from one session
      const [a, b] = await Promise.all([
        page.request.post(`/api/admin/ledger/transactions/${sweep.expense}/reject`, { data: { reason: `L5 reason ${i}` } }),
        page.request.post(`/api/admin/ledger/transactions/${sweep.expense}/reject`, { data: { reason: `L5 reason ${i}` } }),
      ]);

      // Assert
      const statuses = [a.status(), b.status()].sort();
      expect(statuses).toEqual([200, 409]);
      const loser: APIResponse = a.status() === 409 ? a : b;
      const body = await loser.json();
      expect(body).toMatchObject({ code: "not_pending", decision: "rejected", decidedByViewer: true, deciderName: ids.adminName });
      expect(JSON.stringify(body)).not.toContain("@");
      const legs = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.memo, `${TAG} l5 sweep ${i}`));
      expect(legs).toHaveLength(2);
      for (const leg of legs) {
        expect(leg.status).toBe("rejected");
        expect(leg.rejectedByUserId).toBe(ids.adminUserId);
        expect(leg.rejectedAt).not.toBeNull();
        expect(leg.approvedAt).toBeNull();
        expect(leg.approvedByUserId).toBeNull();
      }
      results.push("ok");
    }
    test.info().annotations.push({ type: "L5", description: `${results.length}/5` });
    expect(results).toHaveLength(5);
  });

  // ------------------------------------------------------------------ widths

  for (const width of [360, 390, 1024, 1279, 1280]) {
    test(`should fit the banner, the tabs and the History cards at ${width}px with no horizontal scroll`, async () => {
      // Arrange
      await page.setViewportSize({ width, height: 900 });

      // Act / Assert: Pending + banner
      await load(page, ROW_URL(ids.pendingNotOwn));
      let o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
      const visibleVariant = await page.evaluate((id) => {
        const vis = (el: Element) => el.getClientRects().length > 0;
        return [...document.querySelectorAll(`[data-row-id="${id}"]`)].filter(vis).length;
      }, ids.pendingNotOwn);
      expect(visibleVariant).toBe(1);
      expect((await visibleRow(page, ids.pendingNotOwn).evaluate((el) => el.tagName)) === (width >= 1280 ? "TR" : "LI")).toBe(true);

      // Recently decided + banner (the longest minute and reason)
      for (const id of [ids.approvedOther, ids.rejectedOther]) {
        await load(page, ROW_URL(id, "decided"));
        o = await overflow(page);
        expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
        const bannerBox = await banner(page).boundingBox();
        expect(bannerBox!.x + bannerBox!.width).toBeLessThanOrEqual(width + 1);
      }
      await page.screenshot({ path: process.env.QA_SHOTS ? `${process.env.QA_SHOTS}/decided-${width}.png` : undefined, fullPage: false });
    });
  }

  // ----------------------------------------------------- the 26-decision cap

  test("should show exactly the newest 25 decisions in (time desc, id desc) order when 26 exist, with equal timestamps stable", async () => {
    // Arrange: 26 approved rows in 2099, two per timestamp so ties are exercised; explicit ids fix the tie order
    const rows: { id: string; ts: Date }[] = [];
    for (let i = 0; i < 26; i++) {
      const id = `00000000-0000-4000-8000-0000000c${String(i).padStart(4, "0")}`;
      const ts = new Date(Date.UTC(2099, 0, 1, 12, 0, 0) + Math.floor(i / 2) * 60_000);
      await db.insert(ledgerTransactions).values({
        id,
        entityId: ids.x.clubEntityId,
        fundId: ids.x.adminFundId,
        bankAccountId: ids.x.adminBankId,
        txnDate: todayIso(),
        flow: "expense",
        amountCents: ids.cents,
        party: `${TAG} cap ${i}`,
        memo: `${TAG} cap ${i}`,
        status: "posted",
        recordedByUserId: ids.boardUserId,
        approvedByUserId: ids.boardUserId,
        approvedAt: ts,
        boardMinute: `cap minute ${i}`,
      });
      rows.push({ id, ts });
    }
    const expected = [...rows]
      .sort((a, b) => b.ts.getTime() - a.ts.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 25)
      .map((r) => r.id);

    // Act
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, "/admin/ledger/approvals?tab=decided");
    const order = await page.locator("ul > li[data-row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")));

    // Assert
    expect(order).toHaveLength(25);
    expect(order).toEqual(expected);
    expect(order).not.toContain(rows[0].id); // the oldest of the 26 is cut
    await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.memo, `${TAG} cap %`));
  });

  // ---------------------------------------------------------- email queue

  test("should queue approver emails whose link is ?txn=<expense-leg id> with the one-approval sentence, all blocked outside production, readable in the queue view (live check L3)", async () => {
    // Arrange: three real recordings. Amounts are distinct so each email is findable by subject.
    const base = ids.cents;
    const ordinary = await page.request.post("/api/admin/ledger/transactions", {
      data: {
        entityId: ids.x.clubEntityId,
        fundId: ids.x.adminFundId,
        txnDate: todayIso(),
        flow: "expense",
        amountCents: base + 11,
        party: `${TAG} email ordinary`,
        memo: `${TAG} email ordinary`,
        bankAccountId: ids.x.adminBankId,
      },
    });
    const transfer = await page.request.post("/api/admin/ledger/transactions", {
      data: {
        transfer: true,
        sourceFundId: ids.x.adminFundId,
        destFundId: ids.x.adminFundId,
        sourceBankAccountId: ids.x.adminBankId,
        destBankAccountId: ids.x.pettyCashBankId,
        txnDate: todayIso(),
        amountCents: base + 22,
        memo: `${TAG} email transfer`,
      },
    });
    const [o, t] = [await ordinary.json(), await transfer.json()];
    expect([ordinary.status(), transfer.status()]).toEqual([201, 201]);
    expect(typeof o.id).toBe("string");
    expect(t.status).toBe("pending");
    expect(typeof t.id).toBe("string"); // the Transfer 201 carries the expense-leg id
    // The sweep email case moved to ledger-sweep-batch-api.spec.ts: the lump sweep route is retired (B-172 Inc 2b).

    // Act
    const created = await emailsSinceBaseline();
    const approvalMails = created.filter((e) => /pending your approval/.test(e.subject));

    // Assert: provably never delivered
    expect(approvalMails.length).toBeGreaterThan(0);
    expect(created.filter((e) => e.status === "sent")).toHaveLength(0);
    for (const e of approvalMails) expect(e.status).toBe("blocked_non_production");
    const money = (cents: number) => (cents / 100).toFixed(2);
    const bySubject = (needle: string) => approvalMails.filter((e) => e.subject.includes(needle));
    // 2b replaced the 2a sentence (Phase 3 addendum B7): one approval posts, a colleague can add theirs.
    const sentence = "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too.";
    const cases = [
      { label: "ordinary", subject: `Disbursement pending your approval — $${money(base + 11)}`, id: o.id as string },
      { label: "transfer", subject: `Transfer pending your approval — $${money(base + 22)}`, id: t.id as string },
    ];
    for (const c of cases) {
      const mails = bySubject(c.subject);
      expect(mails.length, `${c.label} email rows`).toBeGreaterThan(0);
      for (const m of mails) {
        expect(m.html).toContain(`/admin/ledger/approvals?txn=${c.id}`);
        expect(m.html).toContain(sentence);
      }
    }

    // L3: the queue view leaves the UUID readable (a transaction id is not a credential)
    await page.setViewportSize({ width: 1280, height: 900 });
    await load(page, "/admin/email-queue");
    const row = page.locator("tr", { hasText: cases[1].subject }).first();
    await row.getByRole("button", { name: "View" }).click();
    const srcdoc = await page.locator(`iframe[title="Rendered preview: ${cases[1].subject}"]`).getAttribute("srcdoc");
    expect(srcdoc).toContain(`?txn=${cases[1].id}`);
    expect(srcdoc).not.toMatch(/redacted|\[hidden\]/i);
    expect(srcdoc).toContain(sentence);
  });
});

// ------------------------------------------------------------ gates + sign-in

test.describe("Approvals deep link, gates and callback (2a)", () => {
  test("should keep a ledger.approve-less user out and reveal nothing about the transaction", async ({ page }) => {
    // Arrange
    await page.goto("/signin");
    await page.fill('input[type="email"]', VIEWER_EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 20_000 });

    // Act
    await page.goto(ROW_URL(ids.approvedOther, "decided"));

    // Assert
    expect(page.url()).not.toContain("/admin/ledger/approvals");
    const text = await page.locator("body").innerText();
    expect(text).not.toContain(BOARD_NAME);
    expect(text).not.toContain(LONG_MINUTE);
  });

  test("should carry ?txn= through the sign-in redirect and land on the page with the banner after a password sign-in", async ({ page }) => {
    // Arrange / Act: signed out
    await page.goto(ROW_URL(ids.pendingNotOwn), { waitUntil: "domcontentloaded" });

    // Assert: the redirect keeps the whole path and query, encoded once
    await page.waitForURL(/\/signin/);
    const signin = new URL(page.url());
    expect(signin.searchParams.get("callbackUrl")).toBe(`/admin/ledger/approvals?txn=${ids.pendingNotOwn}`);
    expect(signin.search).toContain(`callbackUrl=%2Fadmin%2Fledger%2Fapprovals%3Ftxn%3D${ids.pendingNotOwn}`);

    // Act: sign in through the real credentials form
    await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL ?? "");
    await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD ?? "");
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith("/admin/ledger/approvals"), { timeout: 30_000 });

    // Assert
    expect(new URL(page.url()).searchParams.get("txn")).toBe(ids.pendingNotOwn);
    await expect(banner(page)).toContainText("It is waiting for a board decision.", { timeout: 20_000 });
  });

  for (const hostile of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    test(`should land on /members, not off-site, after a password sign-in with callbackUrl=${hostile}`, async ({ page }) => {
      // Arrange
      await page.goto(`/signin?callbackUrl=${encodeURIComponent(hostile)}`);

      // Act
      await page.fill('input[type="email"]', process.env.E2E_ADMIN_EMAIL ?? "");
      await page.fill('input[type="password"]', process.env.E2E_ADMIN_PASSWORD ?? "");
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 20_000 });

      // Assert
      const landed = new URL(page.url());
      expect(landed.origin).toBe(new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").origin);
      expect(landed.pathname.startsWith("/members") || landed.pathname === "/access-pending").toBe(true);
    });
  }

  for (const path of ["/signin", "/register"]) {
    test(`should hand NextAuth a same-origin callback from the Google button on ${path}, never the hostile value (Google round trip itself is manual)`, async ({ page }) => {
      // Arrange: never reach Google
      await page.route(/accounts\.google\.com/, (route) => route.abort());

      for (const [given, expected] of [
        [`/admin/ledger/approvals?txn=${ids.pendingNotOwn}`, `/admin/ledger/approvals?txn=${ids.pendingNotOwn}`],
        ["//evil.example", "/members"],
        ["https://evil.example", "/members"],
      ] as const) {
        await page.context().clearCookies();
        await page.goto(`${path}?callbackUrl=${encodeURIComponent(given)}`, { waitUntil: "networkidle" });

        // Act
        await page.getByRole("button", { name: /google/i }).first().click();
        const callbackTarget = async () => {
          const cookie = (await page.context().cookies()).find((c) => /callback-url/.test(c.name));
          if (!cookie) return null;
          const u = new URL(decodeURIComponent(cookie.value));
          return `${u.host}${u.pathname}${u.search}`;
        };

        // Assert: the cookie NextAuth will redirect to after the Google round trip
        await expect.poll(callbackTarget, { timeout: 15_000 }).toBe(`localhost:3000${expected}`);
      }
    });
  }
});

// Last on purpose: it deletes this suite's pending fixtures to reach the empty state.
test.describe("Approvals empty state (2a)", () => {
  test("should offer See recently decided from the Pending empty state and read Approvals", async ({ page }) => {
    await signInAsAdmin(page);
    // Arrange: remove this suite's pending rows; the empty state needs the dev DB to hold no others
    await db.delete(ledgerTransactions).where(and(ilike(ledgerTransactions.memo, `${TAG}%`), eq(ledgerTransactions.status, "pending")));
    const others = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.status, "pending"));
    test.skip(others.length > 0, "other pending rows exist in the dev DB; the empty state cannot be asserted");
    await page.setViewportSize({ width: 390, height: 844 });

    // Act
    await load(page, "/admin/ledger/approvals");

    // Assert
    await expect(h1(page)).toHaveText("Approvals");
    await expect(page.getByText("Nothing is waiting for approval")).toBeVisible();
    await page.getByRole("link", { name: "See recently decided" }).click();
    await expect(page).toHaveURL(/tab=decided/);
    await expect(page.getByRole("navigation", { name: "Approvals views" }).getByRole("link", { name: "Recently decided" })).toHaveAttribute("aria-current", "page");
  });
});
