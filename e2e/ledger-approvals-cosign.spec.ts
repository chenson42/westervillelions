import { getActivityFundName } from "./helpers/fund-names";
import { test, expect, request as pwRequest, type BrowserContext, type Page, type Locator } from "@playwright/test";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq, ilike, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  emailQueue,
  ledgerFunds,
  ledgerReimbursements,
  ledgerSettings,
  ledgerTransactions,
  ledgerTxnCosigns,
  members,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";
import { loadXmIds, todayIso, type XmIds } from "./helpers/cross-entity-move-fixtures";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Approvals page, Increment 2b: "Add your approval" (informational co-sign)
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3 addendum,
 * "2b qa click-throughs", live checks L6, L7, L8, L10).
 *
 * What this commemorates (regressions):
 *  - a co-sign keyed on the id the caller sent would let one person sign once per
 *    leg of a Transfer/Sweep (the unique key only covers (txn_id, user_id)). Mocked
 *    unit tests cannot prove the normalisation or the row lock; real Postgres can.
 *  - a co-sign must never write the books: the whole ledger_transactions table
 *    digest, the audit log and the email queue are asserted unchanged.
 *  - the lost approve race used to say "Only one approval is needed." and leave the
 *    person on a page with no next step.
 *
 * Fixtures are direct DB inserts on the dev DB (`DATABASE_URL`, never prod), tagged
 * "QATEST E2E Approvals Cosign"; users are example.invalid. Every co-sign, approve
 * and reject under test goes through the real routes. The only rows created through
 * the recording route (which queues approver emails, all blocked_non_production
 * outside production) are in the email test, which asserts every queued row is
 * blocked and deletes them. cleanup() runs before AND after. Serial, one worker:
 * see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });

// The stored public-fund name (DECISION-127), resolved once per run, never a literal.
let activityName = "Public Funds";
test.beforeAll(async () => {
  activityName = await getActivityFundName();
});
test.setTimeout(120_000);

const TAG = "QATEST E2E Approvals Cosign";
const PASSWORD = "E2eApprovalsCosign!2026";
const N = 20; // runs per rate check

const U = {
  poster: { email: "qa-cosign-poster@example.invalid", name: "QA Cosign Poster", role: "board_member" },
  recorder: { email: "qa-cosign-recorder@example.invalid", name: "QA Cosign Recorder", role: "board_member" },
  c1: { email: "qa-cosign-c1@example.invalid", name: "QA Zebrafinch Cosigner", role: "board_member" },
  c2: { email: "qa-cosign-c2@example.invalid", name: "QA Cosign Two", role: "board_member" },
  c3: { email: "qa-cosign-c3@example.invalid", name: "QA Cosign Three", role: "board_member" },
  c4: { email: "qa-cosign-c4@example.invalid", name: "QA Cosign Four", role: "board_member" },
  c5: { email: "qa-cosign-c5@example.invalid", name: "QA Cosign Five", role: "board_member" },
  c6: { email: "qa-cosign-c6@example.invalid", name: "QA Cosign Six", role: "board_member" },
  viewonly: { email: "qa-cosign-viewonly@example.invalid", name: "QA Cosign ViewOnly", role: "budget_committee" },
  treasurer: { email: "qa-cosign-treasurer@example.invalid", name: "QA Cosign Treasurer", role: "treasurer" },
} as const;
type UKey = keyof typeof U;
type Who = UKey | "admin";
const UKEYS = Object.keys(U) as UKey[];
const GHOST_EMAIL = (n: number) => `qa-cosign-ghost${String(n).padStart(2, "0")}@example.invalid`;
const GHOST_NAME = (n: number) => `QA Ghost Signer ${String(n).padStart(2, "0")}`;
const THROWAWAY_SIGNER = { email: "qa-cosign-throwaway-signer@example.invalid", name: "QA Cosign Throwaway Signer" };
const THROWAWAY_POSTER = { email: "qa-cosign-throwaway-poster@example.invalid", name: "QA Cosign Throwaway Poster" };
const ALL_EMAILS = [
  ...UKEYS.map((k) => U[k].email),
  ...Array.from({ length: 13 }, (_, i) => GHOST_EMAIL(i + 1)),
  THROWAWAY_SIGNER.email,
  THROWAWAY_POSTER.email,
];

const uid = {} as Record<UKey, string>;
let adminId = "";
let x: XmIds;
let cents = 0;
let adminFundSlug = "";
const ids = {} as Record<string, string>; // expense-leg ids by fixture key
const incomeIds = {} as Record<string, string>; // income-leg ids for pairs
const ctx = {} as Record<Who, BrowserContext>;
let emailBaseline: string[] = [];

const at = (iso: string) => new Date(iso);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rate = (name: string, text: string) => console.log(`RATE ${name}: ${text}`);

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

async function cleanup(): Promise<void> {
  await db.delete(ledgerReimbursements).where(ilike(ledgerReimbursements.description, `${TAG}%`));
  await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.memo, `${TAG}%`)); // cascades co-signs
  const fx = await db.select({ id: users.id }).from(users).where(inArray(users.email, ALL_EMAILS));
  const fxIds = fx.map((u) => u.id);
  if (fxIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, fxIds));
    await db.delete(users).where(inArray(users.id, fxIds));
  }
}

const drop = (...txnIds: string[]) => db.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, txnIds));

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
}

async function seed(a: SeedArgs): Promise<string> {
  const [row] = await db
    .insert(ledgerTransactions)
    .values({
      entityId: a.entityId ?? x.clubEntityId,
      fundId: a.fundId ?? x.adminFundId,
      bankAccountId: a.bankAccountId ?? x.adminBankId,
      txnDate: todayIso(),
      flow: a.flow ?? "expense",
      amountCents: a.cents ?? cents,
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
    })
    .returning({ id: ledgerTransactions.id });
  return row.id;
}

type PairCommon = Omit<SeedArgs, "label" | "flow" | "fundId" | "entityId" | "bankAccountId" | "groupId" | "party">;

/** A Sweep (Club Activity -> Foundation Charitable) or Transfer (Club Administrative -> Activity) pair. */
async function seedPair(
  kind: "sweep" | "transfer",
  label: string,
  common: PairCommon,
  incomeRecordedBy?: string,
): Promise<{ expense: string; income: string }> {
  const sweep = kind === "sweep";
  const group = randomUUID();
  const expense = await seed({
    ...common,
    label,
    flow: "expense",
    party: null,
    groupId: group,
    entityId: x.clubEntityId,
    fundId: sweep ? x.activityFundId : x.adminFundId,
    bankAccountId: x.adminBankId,
  });
  const income = await seed({
    ...common,
    recordedBy: incomeRecordedBy ?? common.recordedBy,
    label,
    flow: "income",
    party: null,
    groupId: group,
    entityId: sweep ? x.foundationEntityId : x.clubEntityId,
    fundId: sweep ? x.charitableFundId : x.activityFundId,
    bankAccountId: sweep ? x.foundationBankId : x.adminBankId,
  });
  return { expense, income };
}

/** A posted, board-approved expense (the posting approver defaults to the poster). */
function approved(label: string, o: { recordedBy: string; approvedBy?: string | null; approvedAt: string; cents?: number }) {
  return seed({
    label,
    status: "posted",
    recordedBy: o.recordedBy,
    approvedBy: o.approvedBy === undefined ? uid.poster : o.approvedBy,
    approvedAt: at(o.approvedAt),
    boardMinute: `Cosign motion ${label}`,
    cents: o.cents,
  });
}

async function addCosign(txnId: string, userId: string | null, iso: string) {
  await db.insert(ledgerTxnCosigns).values({ txnId, userId, cosignedAt: at(iso) });
}

const cosignRows = (txnId: string) => db.select().from(ledgerTxnCosigns).where(eq(ledgerTxnCosigns.txnId, txnId));
const rowJson = async (id: string) =>
  JSON.stringify((await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0] ?? null);

async function digest(): Promise<string> {
  const r = await db.execute(sql`select md5(string_agg(t::text, ',' order by id)) as d from ledger_transactions t`);
  return (r as unknown as { d: string }[])[0].d;
}

async function counts() {
  const c = async (t: string) =>
    Number(((await db.execute(sql.raw(`select count(*)::int as n from ${t}`))) as unknown as { n: number }[])[0].n);
  return { emails: await c("email_queue"), audit: await c("ledger_audit_log"), txns: await c("ledger_transactions") };
}

interface Api {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
async function post(who: Who, path: string, data?: unknown): Promise<Api> {
  const res = await ctx[who].request.post(path, data === undefined ? {} : { data });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
const cosign = (who: Who, id: string, data?: unknown) => post(who, `/api/admin/ledger/transactions/${id}/cosign`, data);
const decide = (who: Who, id: string, verb: "approve" | "reject") =>
  post(who, `/api/admin/ledger/transactions/${id}/${verb}`, verb === "approve" ? { boardMinute: "Motion QA-cosign-race" } : { reason: "QA cosign race reason" });

const visibleRow = (page: Page, id: string) => page.locator(`[data-row-id="${id}"]:visible`);
const banner = (page: Page) => page.locator('div[role="status"]').first();
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const ROW_URL = (id: string, tab?: "decided" | "pending") => `/admin/ledger/approvals?${tab ? `tab=${tab}&` : ""}txn=${id}`;
const addBtn = (scope: Page | Locator) => scope.getByRole("button", { name: "Add your approval" });
const SHOTS = process.env.QA_SHOTS;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve(undefined));

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
}
async function overflow(page: Page) {
  return page.evaluate(() => ({ inner: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
}
async function pageFor(who: Who, width = 390): Promise<Page> {
  const p = await ctx[who].newPage();
  await p.setViewportSize({ width, height: 844 });
  return p;
}

/** Let a router.refresh() RSC stream finish before the page goes away. Closing mid-stream makes the dev server log "destination stream closed early" (A/B on the stale-dialog tests: 5 of 7 tests without a 3s settle, 0 with it). */
async function settleAndClose(page: Page, settleMs = 0): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  await page.close();
}

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await cleanup();
  emailBaseline = (await db.select({ id: emailQueue.id }).from(emailQueue)).map((r) => r.id);
  x = await loadXmIds();
  adminId = (await one(db.select({ id: users.id }).from(users).where(eq(users.email, process.env.E2E_ADMIN_EMAIL ?? "")), "e2e admin")).id;
  const settings = await one(db.select().from(ledgerSettings), "ledger settings");
  cents = settings.disbApprovalThresholdCents + 12_345;
  adminFundSlug = (await one(db.select({ slug: ledgerFunds.slug }).from(ledgerFunds).where(eq(ledgerFunds.id, x.adminFundId)), "admin fund slug")).slug;

  const hash = await bcrypt.hash(PASSWORD, 10);
  const roleId = async (name: string) => (await one(db.select().from(roles).where(eq(roles.name, name)), `role ${name}`)).id;
  const mk = async (email: string, name: string) =>
    (await db.insert(users).values({ email, name, password: hash, role: "member", isActive: true }).returning({ id: users.id }))[0].id;
  const memberRole = await roleId("member");
  for (const k of UKEYS) {
    uid[k] = await mk(U[k].email, U[k].name);
    await db.insert(userRoles).values([
      { userId: uid[k], roleId: await roleId(U[k].role) },
      { userId: uid[k], roleId: memberRole },
    ]);
  }
  const ghosts: string[] = [];
  for (let n = 1; n <= 13; n++) ghosts.push(await mk(GHOST_EMAIL(n), GHOST_NAME(n)));

  // ---- approved fixtures (decision times in 2090 so they outrank everything in the newest-25 list) ----
  ids.plain = await approved("plain", { recordedBy: uid.recorder, approvedAt: "2090-06-20T16:00:00Z", cents: 227_500 });
  ids.many = await approved("many cosigners", { recordedBy: uid.recorder, approvedAt: "2090-06-19T16:00:00Z" });
  for (let n = 1; n <= 13; n++) await addCosign(ids.many, ghosts[n - 1], `2090-07-${String(n).padStart(2, "0")}T15:00:00Z`);
  const tr = await seedPair("transfer", "transfer", { status: "posted", recordedBy: uid.recorder, approvedBy: uid.poster, approvedAt: at("2090-06-18T16:00:00Z"), boardMinute: "Cosign transfer motion", cents: 150_000 }, adminId);
  ids.transfer = tr.expense;
  incomeIds.transfer = tr.income;
  const sw = await seedPair("sweep", "sweep", { status: "posted", recordedBy: uid.c3, approvedBy: uid.poster, approvedAt: at("2090-06-17T16:00:00Z"), boardMinute: "Cosign sweep motion", cents: 160_000 }, uid.recorder);
  ids.sweep = sw.expense;
  incomeIds.sweep = sw.income;
  ids.adminPosted = await approved("admin posted", { recordedBy: uid.recorder, approvedBy: adminId, approvedAt: "2090-06-16T16:00:00Z" });
  await addCosign(ids.adminPosted, uid.c1, "2090-06-16T18:00:00Z");
  ids.adminCosigned = await approved("admin cosigned", { recordedBy: uid.recorder, approvedAt: "2090-06-15T16:00:00Z" });
  await addCosign(ids.adminCosigned, adminId, "2090-06-15T18:00:00Z");
  await addCosign(ids.adminCosigned, uid.c1, "2090-06-15T19:00:00Z");
  ids.recordedByAdmin = await approved("recorded by admin", { recordedBy: adminId, approvedAt: "2090-06-14T16:00:00Z" });
  ids.rejected = await seed({ label: "rejected", status: "rejected", recordedBy: uid.recorder, rejectedBy: uid.poster, rejectedAt: at("2090-06-13T16:00:00Z"), rejectionReason: "Not in the budget" });

  // ---- not board approvals ----
  ids.reimbursement = await seed({ label: "reimbursement paid", status: "posted", recordedBy: uid.recorder, approvedBy: adminId, approvedAt: at("2090-08-01T16:00:00Z"), boardMinute: "Reimbursement stamp" });
  const member = await one(db.select({ id: members.id }).from(members).limit(1), "any member (read-only lookup)");
  await db.insert(ledgerReimbursements).values({
    submittedByMemberId: member.id,
    submittedByUserId: uid.recorder,
    amountCents: cents,
    description: `${TAG} reimbursement`,
    receiptStorageKey: "receipts/00000000-0000-4000-8000-0000000c0099/qatest.pdf",
    status: "paid",
    ledgerTransactionId: ids.reimbursement,
  });
  const under = await seedPair("sweep", "under-threshold sweep", { status: "posted", recordedBy: uid.recorder, boardMinute: "Creation-time minute", cents: 5_000 });
  ids.under = under.expense;
  incomeIds.under = under.income;

  // ---- pending ----
  ids.pending = await seed({ label: "pending", status: "pending", recordedBy: uid.recorder, cents: 227_500 });

  // ---- one dedicated entry per mutating test ----
  ids.api1 = await approved("api one", { recordedBy: uid.recorder, approvedAt: "2090-05-30T16:00:00Z" });
  ids.api2 = await approved("api two", { recordedBy: uid.recorder, approvedAt: "2090-05-29T16:00:00Z" });
  ids.bodyIgnored = await approved("body ignored", { recordedBy: uid.recorder, approvedAt: "2090-05-28T16:00:00Z" });
  ids.fromBanner = await approved("from banner", { recordedBy: uid.recorder, approvedAt: "2090-05-27T16:00:00Z" });
  ids.orderProbe = await approved("order probe", { recordedBy: uid.recorder, approvedAt: "2090-05-21T16:00:00Z" });
  ids.fromCard = await approved("from card", { recordedBy: uid.recorder, approvedAt: "2090-05-26T16:00:00Z" });
  const leg = await seedPair("sweep", "leg normalisation sweep", { status: "posted", recordedBy: uid.recorder, approvedBy: uid.poster, approvedAt: at("2090-05-25T16:00:00Z"), boardMinute: "Cosign leg motion", cents: 170_000 });
  ids.legSweep = leg.expense;
  incomeIds.legSweep = leg.income;
  const cs = await seedPair("sweep", "card sweep", { status: "posted", recordedBy: uid.recorder, approvedBy: uid.poster, approvedAt: at("2090-05-22T16:00:00Z"), boardMinute: "Cosign card sweep motion", cents: 175_000 });
  ids.cardSweep = cs.expense;
  incomeIds.cardSweep = cs.income;
  ids.lockDelete = await approved("lock delete", { recordedBy: uid.recorder, approvedAt: "2090-05-24T16:00:00Z" });
  await addCosign(ids.lockDelete, uid.c2, "2090-05-24T18:00:00Z");
  const lp = await seedPair("transfer", "lock delete pair", { status: "posted", recordedBy: uid.recorder, approvedBy: uid.poster, approvedAt: at("2090-05-23T16:00:00Z"), boardMinute: "Cosign lock pair", cents: 180_000 });
  ids.lockPair = lp.expense;
  incomeIds.lockPair = lp.income;
  await addCosign(ids.lockPair, uid.c2, "2090-05-23T18:00:00Z");

  // sign-in contexts (the real credentials form)
  for (const k of UKEYS) {
    ctx[k] = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx[k].newPage();
    await signIn(p, U[k].email);
    await p.close();
  }
  ctx.admin = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await ctx.admin.newPage();
  await signInAsAdmin(ap);
  await ap.close();
});

test.afterAll(async () => {
  for (const k of [...UKEYS, "admin" as const]) await ctx[k]?.close().catch(() => undefined);
  await cleanup();
  const created = await emailsSinceBaseline();
  const delivered = created.filter((e) => e.status === "sent");
  if (delivered.length === 0 && created.length > 0) {
    await db.delete(emailQueue).where(inArray(emailQueue.id, created.map((e) => e.id)));
  }
});

// ===========================================================================
// 1. Banner states and the button, by viewer
// ===========================================================================

interface BannerCase {
  title: string;
  viewer: Who;
  entry: string;
  via?: "income";
  text: RegExp[];
  button: boolean;
  link?: RegExp;
}

const BANNER_CASES: BannerCase[] = [
  { title: "show an eligible admin Add your approval on an entry approved by someone else with no co-signs", viewer: "admin", entry: "plain", text: [/Approved by QA Cosign Poster on .+\. It has been posted\. You can add your approval too\./], button: true },
  { title: "show the first three co-signers, an and-10-others tail and a See everyone link on the 13-co-signer entry", viewer: "admin", entry: "many", text: [/Also approved by QA Ghost Signer 01, QA Ghost Signer 02, QA Ghost Signer 03 and 10 others\./, /You can add your approval too\./], button: true, link: /See everyone under Recently decided/ },
  { title: "tell an admin who recorded only the income leg of a Transfer that they recorded it, with no button (expense-leg id)", viewer: "admin", entry: "transfer", text: [/You recorded this transfer, so another board member decides it\./, /Approved by QA Cosign Poster/], button: false },
  { title: "give the same income-leg-only recorder the same banner by the income-leg id", viewer: "admin", entry: "transfer", via: "income", text: [/You recorded this transfer, so another board member decides it\./], button: false },
  { title: "offer an eligible admin Add your approval on a Sweep by the expense-leg id", viewer: "admin", entry: "sweep", text: [/Approved by QA Cosign Poster on .+ You can add your approval too\./], button: true },
  { title: "offer an eligible admin Add your approval on the same Sweep by the income-leg id", viewer: "admin", entry: "sweep", via: "income", text: [/Approved by QA Cosign Poster on .+ You can add your approval too\./], button: true },
  { title: "tell the posting approver You approved this, with the co-signer, and offer no button", viewer: "admin", entry: "adminPosted", text: [/You approved this .+ on .+\. Also approved by QA Zebrafinch Cosigner\./], button: false },
  { title: "tell an admin who already co-signed You added your approval, with the others, and offer no button", viewer: "admin", entry: "adminCosigned", text: [/You added your approval on .+\. Approved by QA Cosign Poster on .+\. Also approved by QA Zebrafinch Cosigner\./], button: false },
  { title: "tell the recorder You recorded this and offer no button", viewer: "admin", entry: "recordedByAdmin", text: [/You recorded this disbursement, so another board member decides it\./], button: false },
  { title: "offer no button on a rejected entry", viewer: "admin", entry: "rejected", text: [/rejected/i], button: false },
  { title: "offer no button on a reimbursement-paid row", viewer: "admin", entry: "reimbursement", text: [/did not need board approval/], button: false },
  { title: "offer no button on an under-threshold Sweep", viewer: "admin", entry: "under", text: [/did not need board approval/], button: false },
  { title: "offer no button on a pending entry", viewer: "admin", entry: "pending", text: [/waiting for a board decision/], button: false },
  { title: "tell the posting approver (a board member) You approved this and offer no button", viewer: "poster", entry: "plain", text: [/You approved this/], button: false },
  { title: "tell the recorder You recorded this disbursement and offer no button", viewer: "recorder", entry: "plain", text: [/You recorded this disbursement/], button: false },
  { title: "offer no button to the recorder of the Transfer expense leg", viewer: "recorder", entry: "transfer", text: [/You recorded this transfer/], button: false },
  { title: "offer no button to the recorder of only the Sweep income leg (income-leg id)", viewer: "recorder", entry: "sweep", via: "income", text: [/You recorded this sweep/], button: false },
  { title: "offer no button to the recorder of only the Sweep expense leg", viewer: "c3", entry: "sweep", text: [/You recorded this sweep/], button: false },
  { title: "offer the button to a board member who recorded neither Transfer leg", viewer: "c3", entry: "transfer", text: [/Approved by QA Cosign Poster/], button: true },
  { title: "show a board member who already co-signed You added your approval and offer no button", viewer: "c1", entry: "adminCosigned", text: [/You added your approval on/], button: false },
  { title: "offer the button to a board member on a plain approved entry", viewer: "c1", entry: "plain", text: [/You can add your approval too\./], button: true },
];

test.describe("Banner states by viewer (2b)", () => {
  for (const c of BANNER_CASES) {
    test(`should ${c.title}`, async () => {
      // Arrange
      const page = await pageFor(c.viewer);
      const id = c.via === "income" ? incomeIds[c.entry] : ids[c.entry];

      // Act
      await load(page, ROW_URL(id));

      // Assert
      const b = banner(page);
      await expect(b).toBeVisible();
      for (const re of c.text) await expect(b).toContainText(re);
      const text = (await b.innerText()).replace(/\s+/g, " ");
      expect(text).not.toMatch(/@|votes?\b|\bof \d+\b|only one approval is needed/i);
      if (c.button) await expect(addBtn(b)).toBeVisible();
      else await expect(addBtn(page)).toHaveCount(0);
      if (c.link) await expect(b.getByRole("link", { name: c.link })).toBeVisible();
      await settleAndClose(page);
    });
  }

  test("should draw Add your approval as a 44px control that fills the banner width on a phone, at 360 and 390", async () => {
    for (const width of [360, 390]) {
      // Arrange
      const page = await pageFor("admin", width);

      // Act
      await load(page, ROW_URL(ids.plain));

      // Assert
      const box = (await addBtn(banner(page)).boundingBox())!;
      const bbox = (await banner(page).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(bbox.width * 0.8);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
      await shot(page, `banner-plain-${width}`);
      await settleAndClose(page);
    }
  });
});

// ===========================================================================
// 2. Add your approval from the banner and from a card
// ===========================================================================

test.describe("Adding your approval (2b)", () => {
  test("should add the viewer's approval from the banner, re-render as You added your approval, and change nothing in the books, audit log, email queue or Pending count", async () => {
    // Arrange
    const page = await pageFor("admin", 360);
    await load(page, ROW_URL(ids.fromBanner));
    const pendingTab = () => page.getByRole("navigation", { name: "Approvals views" }).getByRole("link", { name: /^Pending/ }).innerText();
    const pendingBefore = await pendingTab();
    const overview = await pageFor("admin", 1280);
    await load(overview, "/admin/ledger");
    const pendingLines = async () =>
      (await overview.locator("body").innerText()).split("\n").filter((l) => /pending|approv/i.test(l)).join("|");
    const overviewBefore = await pendingLines();
    const before = { digest: await digest(), counts: await counts(), row: await rowJson(ids.fromBanner) };

    // Act
    await addBtn(banner(page)).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your name will be added to this entry. This does not change the books.");
    await expect(dialog).toContainText("Board minute on file");
    await expect(dialog).toContainText("Cosign motion from banner");
    for (const name of ["Cancel", "Add my approval"]) {
      const box = (await dialog.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    const o = await overflow(page);
    expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
    await shot(page, "dialog-360");
    await dialog.getByRole("button", { name: "Add my approval", exact: true }).click();

    // Assert
    await expect(toast(page, "Your approval was added.")).toBeVisible();
    await expect(banner(page)).toContainText(/You added your approval on/, { timeout: 15_000 });
    await expect(addBtn(page)).toHaveCount(0);
    const rows = await cosignRows(ids.fromBanner);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(adminId);
    expect(Math.abs(rows[0].cosignedAt.getTime() - Date.now())).toBeLessThan(120_000);
    expect(await rowJson(ids.fromBanner)).toBe(before.row);
    expect(await digest()).toBe(before.digest);
    expect(await counts()).toEqual(before.counts);
    expect(await pendingTab()).toBe(pendingBefore);
    await load(overview, "/admin/ledger");
    expect(await pendingLines()).toBe(overviewBefore);
    await settleAndClose(page);
    await overview.close();
  });

  test("should add nothing when the dialog is cancelled", async () => {
    // Arrange
    const page = await pageFor("admin");
    await load(page, ROW_URL(ids.fromCard));

    // Act
    await addBtn(banner(page)).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

    // Assert
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await cosignRows(ids.fromCard)).toHaveLength(0);
    await settleAndClose(page);
  });

  test("should add the viewer's approval from a Recently decided card, which then lists them under Also approved by", async () => {
    // Arrange
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals?tab=decided");
    const card = visibleRow(page, ids.fromCard);
    await expect(page.getByText("These are already posted. You can add your approval to any entry you did not record.")).toBeVisible();
    await expect(card).not.toContainText("Also approved by");
    const before = await digest();

    // Act
    await addBtn(card).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add my approval", exact: true }).click();

    // Assert
    await expect(toast(page, "Your approval was added.")).toBeVisible();
    await expect(card).toContainText("Also approved by:", { timeout: 15_000 });
    await expect(card).toContainText("You (");
    await expect(card).toContainText("You added your approval.");
    await expect(addBtn(card)).toHaveCount(0);
    expect(await cosignRows(ids.fromCard)).toHaveLength(1);
    expect(await digest()).toBe(before);
    await settleAndClose(page);
  });

  test("should not reorder Recently decided when a late co-sign lands on an old entry (ordering stays on the posting decision time)", async () => {
    // Arrange: orderProbe is one of the older cards (decided 2090-05-21); give it a co-sign dated 2095, newer than every decision on the page
    const page = await pageFor("admin");
    const order = () => page.locator("ul > li[data-row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")));
    await load(page, "/admin/ledger/approvals?tab=decided");
    const before = await order();
    expect(before).toContain(ids.orderProbe);

    // Act
    await addCosign(ids.orderProbe, uid.c4, "2095-01-01T12:00:00Z");
    await load(page, "/admin/ledger/approvals?tab=decided");
    const after = await order();

    // Assert
    expect(after).toEqual(before);
    await expect(visibleRow(page, ids.orderProbe)).toContainText("QA Cosign Four");
    await settleAndClose(page);
  });

  test("should add the viewer's approval on a Sweep card keyed on the expense leg, with the Sweep wording and both books named in the dialog", async () => {
    // Arrange
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals?tab=decided");
    const card = visibleRow(page, ids.cardSweep);
    await expect(card).toContainText(`${activityName} (Club)`);
    await expect(card).toContainText("Charitable Fund (Foundation)");
    await expect(page.locator(`[data-row-id="${incomeIds.cardSweep}"]`)).toHaveCount(0); // one card per pair
    const before = await digest();

    // Act
    await addBtn(card).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(activityName);
    await expect(dialog).toContainText("Charitable Fund");
    await expect(dialog).toContainText("Cosign card sweep motion");
    await dialog.getByRole("button", { name: "Add my approval", exact: true }).click();

    // Assert
    await expect(toast(page, "Your approval was added.")).toBeVisible();
    await expect(card).toContainText("You added your approval.", { timeout: 15_000 });
    await expect(addBtn(card)).toHaveCount(0);
    expect((await cosignRows(ids.cardSweep)).map((c) => c.userId)).toEqual([adminId]);
    expect(await cosignRows(incomeIds.cardSweep)).toHaveLength(0);
    expect(await digest()).toBe(before);
    await settleAndClose(page, 2000);
  });

  test("should show a Transfer card the admin half-recorded with You recorded this and no button, and offer the button to a board member who recorded neither leg", async () => {
    // Arrange
    const adminPg = await pageFor("admin");
    const boardPg = await pageFor("c3");

    // Act
    await load(adminPg, "/admin/ledger/approvals?tab=decided");
    await load(boardPg, "/admin/ledger/approvals?tab=decided");

    // Assert
    await expect(visibleRow(adminPg, ids.transfer)).toContainText("You recorded this, so another board member decides it.");
    await expect(addBtn(visibleRow(adminPg, ids.transfer))).toHaveCount(0);
    await expect(visibleRow(boardPg, ids.transfer)).toContainText("Approved by QA Cosign Poster");
    await expect(addBtn(visibleRow(boardPg, ids.transfer))).toBeVisible();
    await expect(addBtn(visibleRow(boardPg, ids.sweep))).toHaveCount(0); // c3 recorded the Sweep's expense leg
    await expect(visibleRow(boardPg, ids.sweep)).toContainText("You recorded this, so another board member decides it.");
    await settleAndClose(adminPg);
    await settleAndClose(boardPg);
  });

  test("should show cards without the button for the poster, the recorder, an existing co-signer and a rejected entry, on the Recently decided tab", async () => {
    // Arrange
    const page = await pageFor("admin");

    // Act
    await load(page, "/admin/ledger/approvals?tab=decided");

    // Assert
    await expect(addBtn(visibleRow(page, ids.plain))).toBeVisible();
    for (const k of ["adminPosted", "adminCosigned", "recordedByAdmin", "rejected", "transfer"]) {
      await expect(visibleRow(page, ids[k]), k).toBeVisible();
      await expect(addBtn(visibleRow(page, ids[k])), k).toHaveCount(0);
    }
    await expect(visibleRow(page, ids.rejected)).not.toContainText("Also approved by");
    await expect(visibleRow(page, ids.recordedByAdmin)).toContainText("You recorded this, so another board member decides it.");
    await expect(visibleRow(page, ids.adminPosted)).toContainText("Approved by You");
    await expect(visibleRow(page, ids.adminPosted)).toContainText("Also approved by: QA Zebrafinch Cosigner (");
    await expect(visibleRow(page, ids.many)).toContainText("Also approved by:");
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body).not.toMatch(/votes?\b|\bof \d+\b/i);
    await settleAndClose(page);
  });
});

// ===========================================================================
// 3. The route: eligibility refusals (L10), gates, leg normalisation, double tap
// ===========================================================================

test.describe("Co-sign route (2b)", () => {
  test("should answer 201 with the expense-leg id and write one row, changing nothing in the books", async () => {
    // Arrange
    const before = { digest: await digest(), counts: await counts() };

    // Act
    const r = await cosign("c1", ids.api1);

    // Assert
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(ids.api1);
    expect(new Date(r.body.cosignedAt).toISOString()).toBe(r.body.cosignedAt);
    const rows = await cosignRows(ids.api1);
    expect(rows.map((c) => c.userId)).toEqual([uid.c1]);
    expect(await digest()).toBe(before.digest);
    expect(await counts()).toEqual(before.counts);
  });

  test("should ignore a request body and sign as the session user", async () => {
    // Act
    const r = await cosign("c2", ids.bodyIgnored, { userId: uid.c3, txnId: ids.api1, user_id: uid.c3 });

    // Assert
    expect(r.status).toBe(201);
    expect((await cosignRows(ids.bodyIgnored)).map((c) => c.userId)).toEqual([uid.c2]);
    expect(await cosignRows(ids.api1)).toHaveLength(1); // the body's txnId was not honoured
  });

  test(`should refuse every ineligible target with its typed body and write no row (live check L10, ${N}/${N} runs each)`, async () => {
    // B-198: ${N} refusals per target against a remote Neon pool overrun the file-level 120 s budget
    // on a slow link (seen 2026-10-19); the assertion set is unchanged.
    test.setTimeout(300_000);
    // Arrange
    const before = await digest();
    const rejectedAt = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.rejected)))[0].rejectedAt!.toISOString();
    const approvedAtPlain = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.plain)))[0].approvedAt!.toISOString();
    const plainBefore = (await cosignRows(ids.plain)).length;
    const cases: { name: string; who: Who; id: string; status: number; code: string; at?: string | null; deciderName?: string | null }[] = [
      { name: "pending", who: "c1", id: ids.pending, status: 409, code: "not_approved", at: null, deciderName: null },
      { name: "rejected", who: "c1", id: ids.rejected, status: 409, code: "rejected", at: rejectedAt, deciderName: "QA Cosign Poster" },
      { name: "reimbursement-paid", who: "c1", id: ids.reimbursement, status: 409, code: "not_board_decision" },
      { name: "under-threshold Sweep, expense leg", who: "c1", id: ids.under, status: 409, code: "not_board_decision" },
      { name: "under-threshold Sweep, income leg", who: "c1", id: incomeIds.under, status: 409, code: "not_board_decision" },
      { name: "recorder of a plain entry", who: "recorder", id: ids.plain, status: 403, code: "recorded_by_you" },
      { name: "recorder of only the Sweep income leg, by that leg", who: "recorder", id: incomeIds.sweep, status: 403, code: "recorded_by_you" },
      { name: "recorder of only the Sweep income leg, by the other leg", who: "recorder", id: ids.sweep, status: 403, code: "recorded_by_you" },
      { name: "recorder of only the Sweep expense leg, by the income leg", who: "c3", id: incomeIds.sweep, status: 403, code: "recorded_by_you" },
      { name: "admin who recorded only the Transfer income leg, by the expense leg", who: "admin", id: ids.transfer, status: 403, code: "recorded_by_you" },
      { name: "admin who recorded only the Transfer income leg, by the income leg", who: "admin", id: incomeIds.transfer, status: 403, code: "recorded_by_you" },
      { name: "admin who recorded the entry", who: "admin", id: ids.recordedByAdmin, status: 403, code: "recorded_by_you" },
      { name: "the posting approver", who: "poster", id: ids.plain, status: 409, code: "already_approved", at: approvedAtPlain },
      { name: "the posting approver (admin) of an entry", who: "admin", id: ids.adminPosted, status: 409, code: "already_approved" },
      { name: "an existing co-signer", who: "admin", id: ids.adminCosigned, status: 409, code: "already_cosigned" },
    ];

    // Act and Assert
    for (const c of cases) {
      for (let i = 0; i < N; i++) {
        const r = await cosign(c.who, c.id);
        expect(r.status, `${c.name} run ${i}`).toBe(c.status);
        expect(r.body.code, `${c.name} run ${i}`).toBe(c.code);
        if (c.status === 409) {
          if (c.at !== undefined) expect(r.body.at, c.name).toBe(c.at);
          if (c.deciderName !== undefined) expect(r.body.deciderName, c.name).toBe(c.deciderName);
          expect(typeof r.body.error).toBe("string");
        }
        expect(JSON.stringify(r.body), c.name).not.toMatch(/@/);
      }
    }
    rate("L10", `${cases.length} refusal kinds x ${N} runs = ${cases.length * N}/${cases.length * N} typed refusals, zero rows written`);
    for (const k of [ids.pending, ids.rejected, ids.reimbursement, ids.under, incomeIds.under, ids.transfer, incomeIds.transfer, ids.sweep, incomeIds.sweep, ids.recordedByAdmin]) {
      expect(await cosignRows(k), k).toHaveLength(0);
    }
    expect(await cosignRows(ids.plain)).toHaveLength(plainBefore);
    expect(await digest()).toBe(before);
  });

  test("should answer 404 for a malformed and an unknown id and write no row", async () => {
    for (let i = 0; i < 10; i++) {
      // Act
      const malformed = await cosign("c1", "not-a-uuid");
      const unknown = await cosign("c1", randomUUID());

      // Assert
      expect(malformed.status).toBe(404);
      expect(malformed.body.code).toBe("not_found");
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe("not_found");
    }
  });

  test("should answer 401 signed out, and 403 with no code for a ledger.view-only user and a treasurer outside the Board", async () => {
    // Arrange
    const anon = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });

    // Act
    const signedOut = await anon.post(`/api/admin/ledger/transactions/${ids.api2}/cosign`);
    const viewOnly = await cosign("viewonly", ids.api2);
    const treasurer = await cosign("treasurer", ids.api2);

    // Assert
    expect(signedOut.status()).toBe(401);
    expect(viewOnly.status).toBe(403);
    expect(viewOnly.body).toEqual({ error: "Forbidden" });
    expect(treasurer.status).toBe(403);
    expect(treasurer.body).toEqual({ error: "Forbidden" });
    expect(await cosignRows(ids.api2)).toHaveLength(0);
    await anon.dispose();
  });

  test("should key a Sweep co-sign on the expense leg: income-leg id then expense-leg id by one user is 201 then 409, one row; a second user adds a second row", async () => {
    // Act
    const viaIncome = await cosign("c1", incomeIds.legSweep);
    const viaExpense = await cosign("c1", ids.legSweep);
    const viaIncomeAgain = await cosign("c1", incomeIds.legSweep);
    const second = await cosign("c2", ids.legSweep);

    // Assert
    expect(viaIncome.status).toBe(201);
    expect(viaIncome.body.id).toBe(ids.legSweep);
    expect(viaExpense.status).toBe(409);
    expect(viaExpense.body.code).toBe("already_cosigned");
    expect(viaExpense.body.at).toBe(viaIncome.body.cosignedAt);
    expect(viaIncomeAgain.status).toBe(409);
    expect(second.status).toBe(201);
    expect((await cosignRows(ids.legSweep)).map((c) => c.userId).sort()).toEqual([uid.c1, uid.c2].sort());
    expect(await cosignRows(incomeIds.legSweep)).toHaveLength(0);
  });

  test("should answer a sequential double tap with 201 then 409 already_cosigned carrying the first time, and keep one row", async () => {
    // Act
    const first = await cosign("c1", ids.api2);
    const second = await cosign("c1", ids.api2);

    // Assert
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already_cosigned");
    expect(second.body.at).toBe(first.body.cosignedAt);
    expect(await cosignRows(ids.api2)).toHaveLength(1);
  });
});

// ===========================================================================
// 4. Losing the approve / reject race
// ===========================================================================

test.describe("Losing the race to a colleague's approval (2b)", () => {
  test("should land the approve loser on ?txn= with the co-sign offered and the new toast, writing nothing for the loser", async () => {
    // Arrange
    const id = await seed({ label: "race approve", status: "pending", recordedBy: uid.recorder });
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals");
    await visibleRow(page, id).getByRole("button", { name: "Approve" }).click();
    await page.fill("#approve-board-minute", "Motion QA loser minute");

    // Act: a colleague approves while the dialog is open
    expect((await decide("poster", id, "approve")).status).toBe(200);
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();

    // Assert
    await expect(toast(page, "QA Cosign Poster already approved this disbursement. You can add your approval too.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`txn=${id}`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(banner(page)).toContainText(/Approved by QA Cosign Poster on/);
    await expect(addBtn(banner(page))).toBeVisible();
    const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
    expect(row.approvedByUserId).toBe(uid.poster);
    expect(row.boardMinute).toBe("Motion QA-cosign-race");
    expect(await cosignRows(id)).toHaveLength(0);

    // Act: the offered next step works
    await addBtn(banner(page)).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add my approval", exact: true }).click();
    await expect(toast(page, "Your approval was added.")).toBeVisible();
    expect((await cosignRows(id)).map((c) => c.userId)).toEqual([adminId]);
    await settleAndClose(page);
    await drop(id);
  });

  test("should name the noun on a lost Sweep approve race", async () => {
    // Arrange
    const sweep = await seedPair("sweep", "race approve sweep", { status: "pending", recordedBy: uid.recorder, boardMinute: "Sweep motion race" });
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals");
    await visibleRow(page, sweep.expense).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("dialog").getByText("Approve Sweep", { exact: true }).first()).toBeVisible();

    // Act
    expect((await decide("poster", sweep.expense, "approve")).status).toBe(200);
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();

    // Assert
    await expect(toast(page, "QA Cosign Poster already approved this sweep. You can add your approval too.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`txn=${sweep.expense}`));
    await expect(banner(page)).toContainText(/Approved by QA Cosign Poster on/);
    await expect(addBtn(banner(page))).toBeVisible();
    await settleAndClose(page);
    await drop(sweep.expense, sweep.income);
  });

  test("should close the reject loser's dialog with the plain toast, no co-sign suffix and no navigation", async () => {
    // Arrange
    const id = await seed({ label: "race reject", status: "pending", recordedBy: uid.recorder });
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals");
    await visibleRow(page, id).getByRole("button", { name: "Reject" }).click();
    await page.fill("#reject-reason", "Rejecting after a colleague approved");
    const urlBefore = page.url();

    // Act
    expect((await decide("poster", id, "approve")).status).toBe(200);
    await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();

    // Assert
    const t = toast(page, "QA Cosign Poster already approved this disbursement.");
    await expect(t).toBeVisible();
    await expect(t).not.toContainText("add your approval");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    expect(page.url()).not.toContain("txn=");
    const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
    expect(row.status).toBe("posted");
    expect(row.approvedByUserId).toBe(uid.poster);
    expect(row.rejectedByUserId).toBeNull();
    expect(await cosignRows(id)).toHaveLength(0);
    await settleAndClose(page);
    await drop(id);
  });
});

// ===========================================================================
// 5. Stale dialog: each typed refusal reaches the person as the designed toast
// ===========================================================================

test.describe("Stale co-sign dialog toasts (2b)", () => {
  interface Stale {
    name: string;
    mutate: (id: string) => Promise<void>;
    toast: RegExp;
    cosignAfter?: number;
  }
  const cases: Stale[] = [
    { name: "403 recorded_by_you", mutate: (id) => db.update(ledgerTransactions).set({ recordedByUserId: adminId }).where(eq(ledgerTransactions.id, id)).then(() => undefined), toast: /You recorded this entry, so another board member needs to approve it\./ },
    { name: "404 deleted", mutate: (id) => drop(id).then(() => undefined), toast: /We can't find that entry\. It may have been deleted\./ },
    { name: "409 already_approved", mutate: (id) => db.update(ledgerTransactions).set({ approvedByUserId: adminId }).where(eq(ledgerTransactions.id, id)).then(() => undefined), toast: /You approved this on .+\./ },
    { name: "409 already_cosigned", mutate: (id) => addCosign(id, adminId, "2091-01-01T12:00:00Z"), toast: /You already added your approval on Jan 1, 2091 at 7:00 AM\./, cosignAfter: 1 },
    { name: "409 not_approved", mutate: (id) => db.update(ledgerTransactions).set({ status: "pending" }).where(eq(ledgerTransactions.id, id)).then(() => undefined), toast: /This entry is still waiting for its first approval\./ },
    { name: "409 rejected", mutate: (id) => db.update(ledgerTransactions).set({ status: "rejected", rejectedByUserId: uid.poster, rejectedAt: at("2091-02-01T12:00:00Z"), rejectionReason: "late rejection" }).where(eq(ledgerTransactions.id, id)).then(() => undefined), toast: /QA Cosign Poster rejected this disbursement on Feb 1, 2091 at 7:00 AM, so it cannot take more approvals\./ },
    { name: "409 not_board_decision", mutate: (id) => db.update(ledgerTransactions).set({ approvedAt: null }).where(eq(ledgerTransactions.id, id)).then(() => undefined), toast: /This entry did not need board approval\./ },
  ];
  for (const c of cases) {
    test(`should explain a ${c.name} refusal with the designed toast, close the dialog and write no new row`, async () => {
      // Arrange
      const id = await approved(`stale ${c.name}`, { recordedBy: uid.recorder, approvedAt: "2091-03-01T16:00:00Z" });
      const page = await pageFor("admin");
      await load(page, "/admin/ledger/approvals?tab=decided");
      await addBtn(visibleRow(page, id)).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      // Act: the world changes under the open dialog
      await c.mutate(id);
      await page.getByRole("dialog").getByRole("button", { name: "Add my approval", exact: true }).click();

      // Assert
      await expect(toast(page, c.toast)).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await cosignRows(id)).toHaveLength(c.cosignAfter ?? 0);
      await settleAndClose(page, 3000);
      await drop(id);
    });
  }
});

// ===========================================================================
// 6. Concurrency and the lock (L6, L7, L8, and races with approve / reject)
// ===========================================================================

test.describe("Co-sign concurrency and locking (2b)", () => {
  const conc = (label: string) => approved(label, { recordedBy: uid.recorder, approvedAt: "2089-01-01T16:00:00Z" });

  test(`L6: two different users co-sign simultaneously, ${N}/${N} runs of two 201 and two rows`, async () => {
    let ok = 0;
    let maxMs = 0;
    for (let i = 0; i < N; i++) {
      // Arrange
      const id = await conc(`conc l6 ${i}`);
      const before = await rowJson(id);

      // Act
      const t0 = Date.now();
      const [a, b] = await Promise.all([cosign("c1", id), cosign("c2", id)]);
      maxMs = Math.max(maxMs, Date.now() - t0);

      // Assert
      expect([a.status, b.status], `run ${i}`).toEqual([201, 201]);
      expect((await cosignRows(id)).map((c) => c.userId).sort(), `run ${i}`).toEqual([uid.c1, uid.c2].sort());
      expect(await rowJson(id)).toBe(before);
      ok++;
      await drop(id);
    }
    rate("L6", `${ok}/${N} runs: two 201, two rows, no deadlock or lock timeout, no 5xx; slowest pair ${maxMs}ms`);
  });

  test("L6b: six different users co-sign one entry at once, 10/10 runs of six 201 and six rows", async () => {
    const six: UKey[] = ["c1", "c2", "c3", "c4", "c5", "c6"];
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const id = await conc(`conc l6b ${i}`);
      const results = await Promise.all(six.map((u) => cosign(u, id)));
      expect(results.map((r) => r.status), `run ${i}`).toEqual([201, 201, 201, 201, 201, 201]);
      expect(await cosignRows(id), `run ${i}`).toHaveLength(6);
      ok++;
      await drop(id);
    }
    rate("L6b", `${ok}/10 runs: six simultaneous co-signers all 201, six rows`);
  });

  test(`L7: one user's double POST yields one 201, one 409 already_cosigned and one row, ${N}/${N} runs; a triple POST yields one 201 and two 409, 10/10`, async () => {
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const id = await conc(`conc l7 ${i}`);
      const [a, b] = await Promise.all([cosign("c1", id), cosign("c1", id)]);
      const sorted = [a, b].sort((p, q) => p.status - q.status);
      expect(sorted.map((r) => r.status), `run ${i}`).toEqual([201, 409]);
      expect(sorted[1].body.code).toBe("already_cosigned");
      expect(sorted[1].body.at, `run ${i}`).toBe(sorted[0].body.cosignedAt);
      expect(await cosignRows(id), `run ${i}`).toHaveLength(1);
      ok++;
      await drop(id);
    }
    let okTriple = 0;
    for (let i = 0; i < 10; i++) {
      const id = await conc(`conc l7t ${i}`);
      const rs = await Promise.all([cosign("c2", id), cosign("c2", id), cosign("c2", id)]);
      expect(rs.map((r) => r.status).sort(), `triple run ${i}`).toEqual([201, 409, 409]);
      expect(await cosignRows(id), `triple run ${i}`).toHaveLength(1);
      okTriple++;
      await drop(id);
    }
    rate("L7", `${ok}/${N} double-POST runs (one 201, one 409, one row) and ${okTriple}/10 triple-POST runs`);
  });

  test(`L8: a Sweep co-signed through both legs: income then expense sequentially (201, 409), in parallel (one 201, one 409), and by two users via different legs (two rows), ${N}/${N} runs each, always keyed on the expense leg`, async () => {
    // B-198: 60 seeds, 60 drops and 120 count queries go from the runner straight to Neon; from a remote
    // machine that alone exceeds the file-level 120 s budget (seen 2026-10-19). Assertions unchanged.
    test.setTimeout(600_000);
    const mk = async (label: string) => seedPair("sweep", label, { status: "posted", recordedBy: uid.recorder, approvedBy: uid.poster, approvedAt: at("2089-01-01T16:00:00Z"), boardMinute: "Cosign L8 motion", cents: 190_000 });
    let seqOk = 0;
    let parOk = 0;
    let twoOk = 0;
    for (let i = 0; i < N; i++) {
      const s = await mk(`conc l8 seq ${i}`);
      const first = await cosign("c1", s.income);
      const second = await cosign("c1", s.expense);
      expect([first.status, second.status], `seq ${i}`).toEqual([201, 409]);
      expect(first.body.id).toBe(s.expense);
      expect(await cosignRows(s.expense), `seq ${i}`).toHaveLength(1);
      expect(await cosignRows(s.income), `seq ${i}`).toHaveLength(0);
      seqOk++;
      await drop(s.expense, s.income);

      const p = await mk(`conc l8 par ${i}`);
      const rs = await Promise.all([cosign("c1", p.income), cosign("c1", p.expense)]);
      expect(rs.map((r) => r.status).sort(), `par ${i}`).toEqual([201, 409]);
      expect(await cosignRows(p.expense), `par ${i}`).toHaveLength(1);
      expect(await cosignRows(p.income), `par ${i}`).toHaveLength(0);
      parOk++;
      await drop(p.expense, p.income);

      const t = await mk(`conc l8 two ${i}`);
      const ts = await Promise.all([cosign("c1", t.income), cosign("c2", t.expense)]);
      expect(ts.map((r) => r.status), `two ${i}`).toEqual([201, 201]);
      expect((await cosignRows(t.expense)).map((c) => c.userId).sort(), `two ${i}`).toEqual([uid.c1, uid.c2].sort());
      expect(await cosignRows(t.income), `two ${i}`).toHaveLength(0);
      twoOk++;
      await drop(t.expense, t.income);
    }
    rate("L8", `sequential ${seqOk}/${N}, parallel same-user ${parOk}/${N}, two users via different legs ${twoOk}/${N}; every row keyed on the expense leg, zero on the income leg`);
  });

  test(`a co-sign racing a reject on a still-pending row never inserts, ${N}/${N} runs`, async () => {
    const tally: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      // Arrange
      const id = await seed({ label: `conc reject ${i}`, status: "pending", recordedBy: uid.recorder });

      // Act
      const [co, rej] = await Promise.all([cosign("c1", id), decide("poster", id, "reject")]);

      // Assert
      expect(rej.status, `run ${i}`).toBe(200);
      expect(co.status, `run ${i}`).toBe(409);
      expect(["not_approved", "rejected"], `run ${i}`).toContain(co.body.code);
      tally[co.body.code] = (tally[co.body.code] ?? 0) + 1;
      expect(await cosignRows(id), `run ${i}`).toHaveLength(0);
      const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
      expect(row.status).toBe("rejected");
      expect(row.rejectedByUserId).toBe(uid.poster);
      expect(row.approvedAt).toBeNull();
      await drop(id);
    }
    rate("co-sign vs reject", `${N}/${N} runs: reject 200, co-sign 409, zero rows; co-sign saw ${JSON.stringify(tally)}`);
  });

  test(`a co-sign racing the first approval is either refused or recorded after the approval, never torn, and the approve path is unchanged, ${N}/${N} runs`, async () => {
    const tally = { refused: 0, recorded: 0 };
    for (let i = 0; i < N; i++) {
      // Arrange
      const id = await seed({ label: `conc approve ${i}`, status: "pending", recordedBy: uid.recorder });

      // Act
      const [co, app] = await Promise.all([cosign("c1", id), decide("poster", id, "approve")]);

      // Assert
      expect(app.status, `run ${i}`).toBe(200);
      const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
      expect(row.status).toBe("posted");
      expect(row.approvedByUserId).toBe(uid.poster);
      expect(row.boardMinute).toBe("Motion QA-cosign-race");
      expect(row.approvedAt).not.toBeNull();
      const rows = await cosignRows(id);
      if (co.status === 201) {
        expect(rows.map((c) => c.userId), `run ${i}`).toEqual([uid.c1]);
        tally.recorded++;
      } else {
        expect(co.status, `run ${i}`).toBe(409);
        expect(co.body.code, `run ${i}`).toBe("not_approved");
        expect(rows, `run ${i}`).toHaveLength(0);
        tally.refused++;
      }
      await drop(id);
    }
    rate("co-sign vs first approval", `${N}/${N} runs consistent; refused ${tally.refused}, recorded after the approval ${tally.recorded}`);
  });

  test(`two approvers racing the first approval while a third co-signs still give exactly one 200 and one not_pending 409, ${N}/${N} runs`, async () => {
    const tally = { posterWon: 0, c2Won: 0 };
    for (let i = 0; i < N; i++) {
      const id = await seed({ label: `conc approve2 ${i}`, status: "pending", recordedBy: uid.recorder });
      const [a, b, co] = await Promise.all([decide("poster", id, "approve"), decide("c2", id, "approve"), cosign("c1", id)]);
      expect([a.status, b.status].sort(), `run ${i}`).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code, `run ${i}`).toBe("not_pending");
      const winner = a.status === 200 ? uid.poster : uid.c2;
      if (winner === uid.poster) tally.posterWon++;
      else tally.c2Won++;
      const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
      expect(row.approvedByUserId, `run ${i}`).toBe(winner);
      expect([201, 409]).toContain(co.status);
      expect(await cosignRows(id), `run ${i}`).toHaveLength(co.status === 201 ? 1 : 0);
      await drop(id);
    }
    rate("approve vs approve + co-sign", `${N}/${N} runs: one 200, one 409 not_pending; winner poster ${tally.posterWon}, c2 ${tally.c2Won}`);
  });

  test("lock probe: a co-sign waits behind a FOR UPDATE holder on the entry and succeeds the moment it is released", async () => {
    // Arrange
    const id = await conc("probe update");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.id, id)).for("update");
      locked();
      await gate;
    });
    await lockedP;

    // Act
    const t0 = Date.now();
    let done = false;
    const req = cosign("c1", id).then((r) => {
      done = true;
      return { r, ms: Date.now() - t0 };
    });
    await sleep(1800);
    const doneWhileHeld = done;
    release();
    await holder;
    const { r, ms } = await req;

    // Assert
    expect(doneWhileHeld).toBe(false);
    expect(r.status).toBe(201);
    expect(ms).toBeGreaterThanOrEqual(1700);
    rate("lock probe 1", `co-sign blocked ${ms}ms behind FOR UPDATE, then 201`);
    await drop(id);
  });

  test("lock probe: the approve path still waits behind a FOR SHARE holder (decideTransaction keeps FOR UPDATE after the helper extraction)", async () => {
    // Arrange
    const id = await seed({ label: "probe share vs approve", status: "pending", recordedBy: uid.recorder });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.id, id)).for("share");
      locked();
      await gate;
    });
    await lockedP;

    // Act
    const t0 = Date.now();
    let done = false;
    const req = decide("poster", id, "approve").then((r) => {
      done = true;
      return { r, ms: Date.now() - t0 };
    });
    await sleep(1800);
    const doneWhileHeld = done;
    release();
    await holder;
    const { r, ms } = await req;

    // Assert
    expect(doneWhileHeld).toBe(false);
    expect(r.status).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(1700);
    rate("lock probe 2", `approve blocked ${ms}ms behind FOR SHARE, then 200`);
    await drop(id);
  });

  test("lock probe: a co-sign does NOT wait behind another FOR SHARE holder (co-signers do not queue)", async () => {
    // Arrange
    const id = await conc("probe share vs share");
    await cosign("c2", id); // warm
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.id, id)).for("share");
      locked();
      await gate;
    });
    await lockedP;

    // Act
    const t0 = Date.now();
    const r = await cosign("c1", id);
    const ms = Date.now() - t0;
    release();
    await holder;

    // Assert
    expect(r.status).toBe(201);
    expect(ms).toBeLessThan(1500);
    rate("lock probe 3", `co-sign completed in ${ms}ms while another FOR SHARE was held`);
    await drop(id);
  });
});

// ===========================================================================
// 7. The lock dependency: approved entries still refuse edit and delete
// ===========================================================================

test.describe("Co-signed entries stay locked (2b)", () => {
  test("should still refuse DELETE and PATCH on a co-signed approved entry, and keep the co-sign", async () => {
    // Act
    const del = await ctx.admin.request.delete(`/api/admin/ledger/transactions/${ids.lockDelete}`, { data: { reason: "QATEST attempt to delete a co-signed entry" } });
    const patch = await ctx.admin.request.patch(`/api/admin/ledger/transactions/${ids.lockDelete}`, { data: { memo: `${TAG} edited` } });

    // Assert
    expect(del.status()).toBe(403);
    expect(patch.status()).toBe(403);
    expect(await rowJson(ids.lockDelete)).not.toBe("null");
    expect(await cosignRows(ids.lockDelete)).toHaveLength(1);
  });

  test("should still refuse DELETE and PATCH on either leg of a co-signed approved Transfer, keeping both legs and the co-sign", async () => {
    for (const leg of [ids.lockPair, incomeIds.lockPair]) {
      // Act
      const del = await ctx.admin.request.delete(`/api/admin/ledger/transactions/${leg}`, { data: { reason: "QATEST attempt to delete a co-signed pair" } });
      const patch = await ctx.admin.request.patch(`/api/admin/ledger/transactions/${leg}`, { data: { memo: `${TAG} edited pair` } });

      // Assert
      expect(del.status(), "delete").toBe(403);
      expect(patch.status(), "patch").toBe(403);
    }
    expect(await rowJson(ids.lockPair)).not.toBe("null");
    expect(await rowJson(incomeIds.lockPair)).not.toBe("null");
    expect(await cosignRows(ids.lockPair)).toHaveLength(1);
  });
});

// ===========================================================================
// 8. Visibility and gates
// ===========================================================================

test.describe("Co-signers are visible on the Approvals page only (2b)", () => {
  test("should never render a co-signer's name on the register, search, overview, reports, compliance or member pages", async () => {
    // Arrange
    const page = await pageFor("admin", 1280);
    const names = ["Zebrafinch", "Ghost Signer"];
    const paths = [
      "/admin/ledger",
      `/admin/ledger/${adminFundSlug}`,
      `/admin/ledger/search?q=${encodeURIComponent(TAG)}`,
      "/admin/ledger/reports",
      "/admin/ledger/compliance",
      "/admin/ledger/reconciliation",
      "/admin/ledger/donors",
      "/admin/ledger/reimbursements",
      "/admin/ledger/budgeting",
      "/members",
      "/members/finances",
      "/members/financial-reports",
      "/members/impact",
      "/members/records",
    ];

    // Act and Assert
    const seen: string[] = [];
    for (const p of paths) {
      const res = await page.goto(p, { waitUntil: "networkidle" });
      expect(res?.status(), p).toBeLessThan(500);
      const html = await page.content();
      for (const n of names) expect(html, `${p} contains ${n}`).not.toContain(n);
      seen.push(`${new URL(page.url()).pathname}:${res?.status()}`);
    }
    rate("visibility", `${paths.length} pages clean: ${seen.join(" ")}`);

    // the same name IS on the Approvals page
    await load(page, "/admin/ledger/approvals?tab=decided");
    await expect(visibleRow(page, ids.adminPosted)).toContainText("QA Zebrafinch Cosigner");
    // the CSV export carries these very fixtures (so the check is not vacuous) and no co-signer name
    let exportedFixtures = 0;
    for (const fy of [2026, 2027]) {
      const api = await ctx.admin.request.get(`/api/admin/ledger/export?entity=club&fy=${fy}&type=transactions`);
      expect(api.status(), `export fy ${fy}`).toBe(200);
      const apiText = await api.text();
      exportedFixtures += apiText.split(TAG).length - 1;
      for (const n of names) expect(apiText, `export fy ${fy} contains ${n}`).not.toContain(n);
    }
    expect(exportedFixtures).toBeGreaterThan(5);
    rate("visibility api", `CSV export (club, fy 2026 and 2027) carried ${exportedFixtures} fixture rows and no co-signer name`);
    await settleAndClose(page);
  });

  test("should keep a ledger.view-only user and a treasurer outside the Board out of the Approvals page and reveal no names", async () => {
    for (const who of ["viewonly", "treasurer"] as const) {
      // Arrange
      const page = await pageFor(who);

      // Act
      await page.goto(ROW_URL(ids.adminPosted, "decided"), { waitUntil: "networkidle" });

      // Assert
      expect(page.url(), who).not.toContain("/admin/ledger/approvals");
      const text = await page.locator("body").innerText();
      expect(text).not.toContain("Zebrafinch");
      expect(text).not.toContain("Cosign motion");
      await settleAndClose(page);
    }
  });
});

// ===========================================================================
// 9. Deleted accounts degrade, never break
// ===========================================================================

test.describe("Deleted accounts (2b)", () => {
  test("should keep a co-sign whose account was deleted, showing a board member in place of the name", async () => {
    // Arrange
    const signer = (await db.insert(users).values({ email: THROWAWAY_SIGNER.email, name: THROWAWAY_SIGNER.name, password: "x", role: "member", isActive: true }).returning({ id: users.id }))[0].id;
    const id = await approved("deleted signer", { recordedBy: uid.recorder, approvedAt: "2091-04-01T16:00:00Z" });
    await addCosign(id, signer, "2091-04-02T16:00:00Z");
    await addCosign(id, uid.c2, "2091-04-03T16:00:00Z");
    const page = await pageFor("admin");
    await load(page, "/admin/ledger/approvals?tab=decided");
    await expect(visibleRow(page, id)).toContainText("QA Cosign Throwaway Signer");

    // Act
    await db.delete(users).where(eq(users.id, signer));
    await load(page, "/admin/ledger/approvals?tab=decided");

    // Assert
    const card = visibleRow(page, id);
    await expect(card).not.toContainText("QA Cosign Throwaway Signer");
    await expect(card).toContainText(/Also approved by: QA Cosign Two \(.+\), a board member \(.+\)|Also approved by: .*QA Cosign Two.*a board member/);
    const rows = await cosignRows(id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.userId === null)).toHaveLength(1);
    await load(page, ROW_URL(id));
    await expect(banner(page)).toContainText(/Also approved by QA Cosign Two and a board member\./);
    await settleAndClose(page);
    await drop(id);
  });

  test("should keep an entry co-signable after its posting approver's account was deleted, showing A board member", async () => {
    // Arrange
    const poster = (await db.insert(users).values({ email: THROWAWAY_POSTER.email, name: THROWAWAY_POSTER.name, password: "x", role: "member", isActive: true }).returning({ id: users.id }))[0].id;
    const id = await approved("deleted poster", { recordedBy: uid.recorder, approvedBy: poster, approvedAt: "2091-05-01T16:00:00Z" });
    await db.delete(users).where(eq(users.id, poster));
    const row = (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
    expect(row.approvedByUserId).toBeNull();
    expect(row.approvedAt).not.toBeNull();
    const page = await pageFor("c1");

    // Act
    await load(page, ROW_URL(id));

    // Assert
    await expect(banner(page)).toContainText(/Approved by A board member on/);
    await expect(addBtn(banner(page))).toBeVisible();
    const r = await cosign("c1", id);
    expect(r.status).toBe(201);
    expect((await cosignRows(id)).map((c) => c.userId)).toEqual([uid.c1]);
    await settleAndClose(page);
    await drop(id);
  });
});

// ===========================================================================
// 10. Layout, widths and the dev "1 Issue" badge
// ===========================================================================

test.describe("Layout and dev diagnostics (2b)", () => {
  test("should wrap thirteen co-signer names at 360px with no horizontal scroll, list them all on the card and link See everyone to the card", async () => {
    // Arrange
    const page = await pageFor("admin", 360);

    // Act
    await load(page, ROW_URL(ids.many));
    const bannerOverflow = await overflow(page);
    await shot(page, "many-banner-360");
    await banner(page).getByRole("link", { name: /See everyone under Recently decided/ }).click();
    await page.waitForURL(/tab=decided/);
    await page.waitForLoadState("networkidle");

    // Assert
    expect(bannerOverflow.scrollWidth).toBeLessThanOrEqual(bannerOverflow.inner);
    const card = visibleRow(page, ids.many);
    for (let n = 1; n <= 13; n++) await expect(card).toContainText(GHOST_NAME(n));
    const o = await overflow(page);
    expect(o.scrollWidth).toBeLessThanOrEqual(o.inner);
    await shot(page, "many-card-360");
    await settleAndClose(page);
  });

  for (const width of [360, 390, 1024, 1279, 1280]) {
    test(`should lay out the banner, button and cards without horizontal overflow at ${width}px, with exactly one visible variant per card`, async () => {
      // Arrange
      const page = await pageFor("admin", width);

      // Act
      await load(page, ROW_URL(ids.plain, "decided"));

      // Assert
      let o = await overflow(page);
      expect(o.scrollWidth, "decided + banner").toBeLessThanOrEqual(o.inner);
      const btn = addBtn(banner(page));
      await expect(btn).toBeVisible();
      expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.locator(`[data-row-id="${ids.plain}"]:visible`).count()).toBe(1);
      const cardBtn = addBtn(visibleRow(page, ids.plain));
      await expect(cardBtn).toBeVisible();
      expect((await cardBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await shot(page, `decided-${width}`);

      await load(page, "/admin/ledger/approvals");
      o = await overflow(page);
      expect(o.scrollWidth, "pending").toBeLessThanOrEqual(o.inner);
      await settleAndClose(page);
    });
  }

  test("should render the banner, the Recently decided tab and the open dialog with no hydration warning or page error", async () => {
    // Arrange
    const page = await pageFor("admin");
    const messages: { type: string; text: string }[] = [];
    const errors: string[] = [];
    page.on("console", (m) => messages.push({ type: m.type(), text: m.text() }));
    page.on("pageerror", (e) => errors.push(e.message));

    // Act
    await load(page, ROW_URL(ids.plain));
    await addBtn(banner(page)).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await load(page, "/admin/ledger/approvals?tab=decided");
    await addBtn(visibleRow(page, ids.plain)).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Assert
    const noisy = messages.filter((m) => m.type === "error" || m.type === "warning");
    rate("console", JSON.stringify(noisy.map((m) => `${m.type}: ${m.text.slice(0, 140)}`)));
    expect(messages.filter((m) => /hydrat|did not match|server rendered HTML/i.test(m.text))).toEqual([]);
    expect(errors).toEqual([]);
    await settleAndClose(page);
  });
});

// ===========================================================================
// 11. The approver email carries the 2b sentence (last: creates pending rows)
// ===========================================================================

test.describe("Approver email (2b)", () => {
  test("should queue approver emails with the 2b sentence and not the 2a sentence, all blocked outside production", async () => {
    // Arrange
    const base = cents + 777;

    // Act
    const created = await ctx.admin.request.post("/api/admin/ledger/transactions", {
      data: {
        entityId: x.clubEntityId,
        fundId: x.adminFundId,
        txnDate: todayIso(),
        flow: "expense",
        amountCents: base,
        party: `${TAG} email ordinary`,
        memo: `${TAG} email ordinary`,
        bankAccountId: x.adminBankId,
      },
    });
    const body = await created.json();
    const mails = (await emailsSinceBaseline()).filter((e) => /pending your approval/.test(e.subject));

    // Assert
    expect(created.status()).toBe(201);
    expect(mails.length).toBeGreaterThan(0);
    for (const m of mails) {
      expect(m.status).toBe("blocked_non_production");
      expect(m.html).toContain(`/admin/ledger/approvals?txn=${body.id}`);
      expect(m.html).toContain("Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too.");
      expect(m.html).not.toContain("If a colleague has already acted, the link will show who.");
    }
    expect((await emailsSinceBaseline()).filter((e) => e.status === "sent")).toHaveLength(0);
    rate("email", `${mails.length} approver rows, all blocked_non_production, 2b sentence present, 2a sentence absent`);
    await drop(body.id);
  });
});
