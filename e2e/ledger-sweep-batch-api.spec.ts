import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { and, eq, gte, inArray, like, notInArray, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  emailQueue,
  ledgerAuditLog,
  ledgerCategories,
  ledgerSettings,
  ledgerTransactions,
  roles,
  userRoles,
  users,
} from "../src/lib/db/schema";
import { loadXmIds, todayIso, type XmIds } from "./helpers/cross-entity-move-fixtures";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Itemized sweep batch core, API round trip (B-172 Increment 2a, DECISION-126).
 * docs/work-log/2026-10-17-itemized-sweep-inc2a-sweep-batch-core.md, Phase 5.
 *
 * What this commemorates (regressions to keep out):
 *  - the claim on a source gift is the partial unique index plus the FOR UPDATE
 *    lock: two creates over the same source must give exactly one 201 and one
 *    409 `rows_claimed` (live check S3; the 10-pass loop is a one-off QA run, a
 *    single pass is pinned here).
 *  - a copy is the Foundation's ordinary income row (gift date, no transfer
 *    group, both pointers, never `approved_at`), the leg is the Club's single
 *    expense row (sweep date, a fresh group, the generated memo).
 *  - the three lock kinds (leg, copy, source) refuse every edit except donor
 *    and memo on a copy, on a posted AND an approved batch.
 *  - approve stamps the LEG only; reject frees the sources; void refuses an
 *    approved or pending batch and deletes a posted one with an audit row that
 *    carries no party, memo or donor.
 *  - the lump Transfer/Sweep route refuses a sweep (400 `use_sweep_batch`, no rows)
 *    and still posts a same-fund Transfer (B-172 Inc 2b).
 *  - a sweep date after today is refused by preview and create (`future_date`);
 *    a preview above INT4_MAX answers `canPost: false`.
 *  - the pending-batch approval email queues blocked, links `?txn=<leg id>`, carries
 *    the one-approval sentence and no party or memo (moved here from the L3 spec).
 *
 * Fixtures are direct DB inserts on the dev DB (`DATABASE_URL`, never prod),
 * tagged "QATEST E2E Sweep Batch"; users are example.invalid. A pending batch
 * queues approver notification emails, which are `blocked_non_production`
 * outside production; they are deleted in cleanup (rows newer than the baseline
 * with the sweep subject). Serial, one worker: see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const TAG = "QATEST E2E Sweep Batch";
const PASSWORD = "E2eSweepBatch!2026";
const U = {
  approver: { email: "qa-sweep-approver@example.invalid", name: "QA Sweep Approver", role: "board_member" },
  viewonly: { email: "qa-sweep-viewonly@example.invalid", name: "QA Sweep ViewOnly", role: "budget_committee" },
} as const;
type UKey = keyof typeof U;
type Who = UKey | "admin";
const EMAILS = Object.values(U).map((u) => u.email);

const B = "/api/admin/ledger/sweep-batches";
const ctx = {} as Record<Who, BrowserContext>;
const uid = {} as Record<UKey, string>;
let x: XmIds;
let adminId = "";
let thresholdCents = 0;
let giftDate = "";
let startedAt = new Date();
let emailBaseline: string[] = [];
let mirroredCategoryId: string | null = null;
const legIds: string[] = [];

interface Api {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
async function call(who: Who, method: "get" | "post" | "patch" | "delete", path: string, data?: unknown): Promise<Api> {
  const req = ctx[who].request;
  const res =
    method === "get"
      ? await req.get(path)
      : await req[method](path, data === undefined ? {} : { data });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30_000 });
}

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

async function cleanup(): Promise<void> {
  // Copies carry the source's tag (memo), the leg does not: collect legs first.
  const copies = await db
    .select({ leg: ledgerTransactions.sweepLegTxnId })
    .from(ledgerTransactions)
    .where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweepLegTxnId} is not null`));
  const legs = [...new Set([...legIds, ...copies.map((c) => c.leg).filter((v): v is string => !!v)])];
  await db
    .delete(ledgerAuditLog)
    .where(and(like(ledgerAuditLog.action, "sweep_%"), gte(ledgerAuditLog.createdAt, startedAt)));
  await db
    .delete(ledgerTransactions)
    .where(and(like(ledgerTransactions.memo, `${TAG}%`), sql`${ledgerTransactions.sweptFromTxnId} is not null`));
  if (legs.length > 0) await db.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, legs));
  await db.delete(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`));
  const fx = await db.select({ id: users.id }).from(users).where(inArray(users.email, EMAILS));
  const fxIds = fx.map((u) => u.id);
  if (fxIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.userId, fxIds));
    await db.delete(users).where(inArray(users.id, fxIds));
  }
  const queued = emailBaseline.length > 0
    ? await db.select({ id: emailQueue.id, subject: emailQueue.subject }).from(emailQueue).where(notInArray(emailQueue.id, emailBaseline))
    : [];
  const ours = queued.filter((q) => q.subject.startsWith("Sweep pending your approval")).map((q) => q.id);
  if (ours.length > 0) await db.delete(emailQueue).where(inArray(emailQueue.id, ours));
}

let seq = 0;
async function gifts(n: number, cents: number): Promise<{ ids: string[]; total: number }> {
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
      })),
    )
    .returning({ id: ledgerTransactions.id, amountCents: ledgerTransactions.amountCents });
  return { ids: rows.map((r) => r.id), total: rows.reduce((s, r) => s + r.amountCents, 0) };
}

const createBody = (ids: string[], total: number, extra: Record<string, unknown> = {}) => ({
  sourceIds: ids,
  sourceBankAccountId: x.adminBankId,
  destBankAccountId: x.foundationBankId,
  sweepDate: todayIso(),
  boardMinute: `${TAG} minute`,
  bankAmountCents: total,
  ...extra,
});

const row = async (id: string) => (await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, id)))[0];
const copiesOf = (legId: string) =>
  db.select().from(ledgerTransactions).where(eq(ledgerTransactions.sweepLegTxnId, legId));

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  startedAt = new Date(Date.now() - 1000);
  x = await loadXmIds();
  adminId = x.adminUserId;
  emailBaseline = (await db.select({ id: emailQueue.id }).from(emailQueue)).map((r) => r.id);
  await cleanup();
  const settings = await one(db.select().from(ledgerSettings), "ledger settings");
  thresholdCents = settings.disbApprovalThresholdCents;
  const d = new Date(todayIso() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  giftDate = d.toISOString().slice(0, 10);

  // The Club public-fund income category that has a Foundation counterpart.
  const cat = x.clubActivityPublicDonationsId
    ? (await db.select().from(ledgerCategories).where(eq(ledgerCategories.id, x.clubActivityPublicDonationsId)))[0]
    : undefined;
  mirroredCategoryId = cat?.mirrorsCategoryId ? cat.id : null;

  const hash = await bcrypt.hash(PASSWORD, 10);
  const roleId = async (name: string) => (await one(db.select().from(roles).where(eq(roles.name, name)), `role ${name}`)).id;
  const memberRole = await roleId("member");
  for (const k of Object.keys(U) as UKey[]) {
    uid[k] = (
      await db
        .insert(users)
        .values({ email: U[k].email, name: U[k].name, password: hash, role: "member", isActive: true })
        .returning({ id: users.id })
    )[0].id;
    await db.insert(userRoles).values([
      { userId: uid[k], roleId: await roleId(U[k].role) },
      { userId: uid[k], roleId: memberRole },
    ]);
  }
  for (const k of Object.keys(U) as UKey[]) {
    ctx[k] = await browser.newContext();
    const p = await ctx[k].newPage();
    await signIn(p, U[k].email);
    await p.close();
  }
  ctx.admin = await browser.newContext();
  const ap = await ctx.admin.newPage();
  await signInAsAdmin(ap);
  await ap.close();
});

test.afterAll(async () => {
  for (const k of ["approver", "viewonly", "admin"] as const) await ctx[k]?.close().catch(() => undefined);
  await cleanup();
});

test.describe("sweep batch API (Increment 2a)", () => {
  test.beforeEach(() => {
    test.skip(!mirroredCategoryId, "needs a Club Public donations category with a Foundation counterpart on this database");
  });

  test("should answer 401 signed out and 403 without the feature, identically for an unknown id", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL: baseURL ?? "http://localhost:3000" });
    const ghost = "11111111-1111-4111-8111-111111111111";
    for (const [method, path] of [
      ["post", `${B}/preview`],
      ["post", B],
      ["get", `${B}/${ghost}`],
      ["post", `${B}/${ghost}/void`],
      ["post", `${B}/closeouts`],
    ] as const) {
      const res = method === "get" ? await anon.get(path) : await anon.post(path, { data: {} });
      expect(res.status(), `${method} ${path} signed out`).toBe(401);
    }
    await anon.dispose();

    const a = await call("viewonly", "post", `${B}/${ghost}/void`, { reason: "A reason long enough" });
    const b = await call("viewonly", "post", `${B}/22222222-2222-4222-8222-222222222222/void`, { reason: "A reason long enough" });
    expect(a.status).toBe(403);
    expect(b).toEqual(a);
    expect((await call("viewonly", "post", `${B}/preview`, {})).status).toBe(403);
    expect((await call("approver", "post", `${B}/preview`, {})).status, "approver holds view+approve, not record").toBe(403);
    expect((await call("approver", "post", `${B}/closeouts`, {})).status).toBe(403);
  });

  test("should refuse a wrong typed total and write nothing", async () => {
    const g = await gifts(2, 1_000);
    const res = await call("admin", "post", B, createBody(g.ids, g.total + 1));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("total_mismatch");
    expect(res.body.derivedCents).toBe(g.total);
    expect(res.body.typedCents).toBe(g.total + 1);
    const written = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(inArray(ledgerTransactions.sweptFromTxnId, g.ids));
    expect(written).toHaveLength(0);
  });

  test("should post a small batch as one leg and N copies with the designed shapes, then refuse a second claim", async () => {
    const g = await gifts(3, 1_500);
    const pre = await call("admin", "post", `${B}/preview`, { ...createBody(g.ids, g.total), boardMinute: undefined });
    expect(pre.status).toBe(200);
    expect(pre.body.totalCents).toBe(g.total);
    expect(pre.body.status).toBe("posted");
    expect(pre.body.canPost).toBe(true);

    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("posted");
    expect(res.body.count).toBe(3);
    legIds.push(res.body.legId);

    const leg = await row(res.body.legId);
    expect(leg.flow).toBe("expense");
    expect(leg.entityId).toBe(x.clubEntityId);
    expect(leg.fundId).toBe(x.activityFundId);
    expect(leg.amountCents).toBe(g.total);
    expect(leg.txnDate).toBe(todayIso());
    expect(leg.memo).toBe("Itemized sweep: 3 gifts");
    expect(leg.transferGroupId).toBeTruthy();
    expect(leg.sweptFromTxnId).toBeNull();
    expect(leg.sweepLegTxnId).toBeNull();

    const copies = await copiesOf(res.body.legId);
    expect(copies).toHaveLength(3);
    for (const c of copies) {
      expect(c.flow).toBe("income");
      expect(c.entityId).toBe(x.foundationEntityId);
      expect(c.fundId).toBe(x.charitableFundId);
      expect(c.bankAccountId).toBe(x.foundationBankId);
      expect(c.txnDate, "copies keep the GIFT date").toBe(giftDate);
      expect(c.transferGroupId, "a copy is ordinary income, not a transfer leg").toBeNull();
      expect(c.approvedAt).toBeNull();
      expect(c.status).toBe("posted");
      expect(c.sweptFromTxnId && g.ids.includes(c.sweptFromTxnId)).toBeTruthy();
      expect(c.checkNumber).toBeNull();
      expect(c.receiptStorageKey).toBeNull();
    }

    const again = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("rows_claimed");

    const detail = await call("admin", "get", `${B}/${res.body.legId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.count).toBe(3);
    expect(detail.body.totalCents).toBe(g.total);
    const text = JSON.stringify(detail.body);
    expect(text, "no donor name").not.toContain(`${TAG} Donor`);
    expect(text, "no gift memo").not.toContain(`${TAG} gift`);
    for (const k of ["party", "memo", "donor"]) expect(Object.keys(detail.body).join()).not.toContain(k);
    expect((await call("approver", "get", `${B}/${res.body.legId}`)).status, "ledger.approve may read the detail").toBe(200);
    expect((await call("viewonly", "get", `${B}/${res.body.legId}`)).status, "ledger.view may read the detail").toBe(200);
  });

  test("should give exactly one 201 and one 409 rows_claimed when two creates race on one source", async () => {
    const g = await gifts(1, 2_100);
    const [a, b] = await Promise.all([
      call("admin", "post", B, createBody(g.ids, g.total)),
      call("admin", "post", B, createBody(g.ids, g.total)),
    ]);
    const outcomes = [a, b].map((r) => `${r.status} ${r.body?.code ?? ""}`.trim()).sort();
    expect(outcomes).toEqual(["201", "409 rows_claimed"]);
    const win = [a, b].find((r) => r.status === 201)!;
    legIds.push(win.body.legId);
    const live = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(and(eq(ledgerTransactions.sweptFromTxnId, g.ids[0]), sql`${ledgerTransactions.status} <> 'rejected'`));
    expect(live).toHaveLength(1);
  });

  test("should refuse every edit but donor and memo on a copy, and every edit on the leg and the source", async () => {
    const g = await gifts(2, 1_700);
    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    legIds.push(res.body.legId);
    const [copy] = await copiesOf(res.body.legId);
    const source = copy.sweptFromTxnId!;
    const T = "/api/admin/ledger/transactions";

    const amount = await call("admin", "patch", `${T}/${copy.id}`, { amountCents: 1 });
    expect([amount.status, amount.body.code]).toEqual([403, "swept_copy"]);
    const mixed = await call("admin", "patch", `${T}/${copy.id}`, { memo: "ok", amountCents: 2 });
    expect([mixed.status, mixed.body.code]).toEqual([403, "swept_copy"]);
    const del = await call("admin", "delete", `${T}/${copy.id}`, { reason: "A reason long enough" });
    expect([del.status, del.body.code]).toEqual([403, "swept_copy"]);
    const split = await call("admin", "post", `${T}/${copy.id}/split`, { amountCents: 100 });
    expect([split.status, split.body.code]).toEqual([403, "swept_copy"]);
    const move = await call("admin", "post", `${T}/${copy.id}/move`, {
      destFundId: x.activityFundId,
      categoryId: null,
      reason: "A reason long enough",
      expectedFundId: x.charitableFundId,
      destBankAccountId: x.adminBankId,
    });
    expect([move.status, move.body.code]).toEqual([403, "swept_copy"]);

    const legPatch = await call("admin", "patch", `${T}/${res.body.legId}`, { memo: "x" });
    expect([legPatch.status, legPatch.body.code]).toEqual([403, "sweep_batch"]);
    const legDel = await call("admin", "delete", `${T}/${res.body.legId}`, { reason: "A reason long enough" });
    expect([legDel.status, legDel.body.code]).toEqual([403, "sweep_batch"]);

    const srcPatch = await call("admin", "patch", `${T}/${source}`, { amountCents: 1 });
    expect([srcPatch.status, srcPatch.body.code]).toEqual([403, "swept_source"]);
    const srcDel = await call("admin", "delete", `${T}/${source}`, { reason: "A reason long enough" });
    expect([srcDel.status, srcDel.body.code]).toEqual([403, "swept_source"]);

    const memo = await call("admin", "patch", `${T}/${copy.id}`, { memo: `${TAG} edited memo` });
    expect(memo.status).toBe(200);
    expect((await row(copy.id)).memo).toBe(`${TAG} edited memo`);
    expect((await row(copy.id)).amountCents, "the copy's amount is untouched").toBe(copy.amountCents);
  });

  test("should void a posted batch, write a no-PII audit row, free the sources, and refuse to void twice", async () => {
    const g = await gifts(2, 1_900);
    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    const legId: string = res.body.legId;
    expect((await call("viewonly", "post", `${B}/${legId}/void`, { reason: "A reason long enough" })).status).toBe(403);
    expect((await call("admin", "post", `${B}/${legId}/void`, { reason: "x" })).status).toBe(400);

    const voided = await call("admin", "post", `${B}/${legId}/void`, { reason: "QATEST void of a posted batch" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ voided: true, copiesRemoved: 2 });
    expect(await row(legId)).toBeUndefined();
    expect(await copiesOf(legId)).toEqual([]);
    expect((await call("admin", "post", `${B}/${legId}/void`, { reason: "QATEST void a second time" })).status).toBe(404);

    const audit = await db
      .select()
      .from(ledgerAuditLog)
      .where(and(eq(ledgerAuditLog.action, "sweep_batch_voided"), gte(ledgerAuditLog.createdAt, startedAt)));
    expect(audit.length).toBeGreaterThan(0);
    const snapshot = audit.map((a) => a.before ?? "").join("");
    expect(snapshot).not.toContain(TAG);
    for (const k of ['"party"', '"memo"', '"donor']) expect(snapshot).not.toContain(k);

    const again = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(again.status, "voided sources are claimable again").toBe(201);
    legIds.push(again.body.legId);
  });

  test("should hold a large batch pending, let a second user approve it with the leg stamped only, and then refuse to void it", async () => {
    const half = Math.ceil((thresholdCents + 12_345) / 2);
    const g = await gifts(2, half);
    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    const legId: string = res.body.legId;
    legIds.push(legId);

    expect((await call("admin", "post", `${B}/${legId}/void`, { reason: "QATEST void a pending batch" })).body.code).toBe("pending_use_reject");
    const [copy] = await copiesOf(legId);
    const onCopy = await call("approver", "post", `/api/admin/ledger/transactions/${copy.id}/approve`, { boardMinute: "x" });
    expect([onCopy.status, onCopy.body.code]).toEqual([400, "decide_the_batch"]);
    const self = await call("admin", "post", `/api/admin/ledger/transactions/${legId}/approve`, { boardMinute: "x" });
    expect(self.status, "the recorder cannot approve their own batch").toBe(403);

    const ok = await call("approver", "post", `/api/admin/ledger/transactions/${legId}/approve`, { boardMinute: `${TAG} approver minute` });
    expect(ok.status).toBe(200);
    const leg = await row(legId);
    expect(leg.status).toBe("posted");
    expect(leg.approvedAt).not.toBeNull();
    for (const c of await copiesOf(legId)) {
      expect(c.status).toBe("posted");
      expect(c.approvedAt, "a copy never carries the approval lock marker").toBeNull();
      expect(c.boardMinute).toBe(`${TAG} approver minute`);
    }
    const voidApproved = await call("admin", "post", `${B}/${legId}/void`, { reason: "QATEST void an approved batch" });
    expect([voidApproved.status, voidApproved.body.code]).toEqual([409, "approved"]);
    const patchApproved = await call("admin", "patch", `/api/admin/ledger/transactions/${copy.id}`, { amountCents: 1 });
    expect([patchApproved.status, patchApproved.body.code]).toEqual([403, "swept_copy"]);
  });

  test("should free the sources when the batch is rejected and keep the rejected copies", async () => {
    const half = Math.ceil((thresholdCents + 12_345) / 2);
    const g = await gifts(2, half + 7);
    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    legIds.push(res.body.legId);
    const rej = await call("approver", "post", `/api/admin/ledger/transactions/${res.body.legId}/reject`, { reason: "QATEST reject the batch" });
    expect(rej.status).toBe(200);
    const all = [await row(res.body.legId), ...(await copiesOf(res.body.legId))];
    expect(new Set(all.map((r) => r.status))).toEqual(new Set(["rejected"]));
    expect(all.every((r) => r.rejectedAt !== null)).toBe(true);
    const srcDel = await call("admin", "delete", `/api/admin/ledger/transactions/${g.ids[0]}`, { reason: "QATEST delete a freed source" });
    expect([srcDel.status, srcDel.body.code], "rejected copies are kept, so a deleted source would orphan them").toEqual([409, "sweep_history"]);

    const again = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(again.status, "rejection frees the sources").toBe(201);
    legIds.push(again.body.legId);
  });

  test("should refuse a lump sweep with 400 use_sweep_batch and write no rows, and still post a same-fund Transfer", async () => {
    const before = (await db.select().from(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`))).length;
    const lump = await call("admin", "post", "/api/admin/ledger/transactions", {
      transfer: true,
      sourceFundId: x.activityFundId,
      destFundId: x.charitableFundId,
      sourceBankAccountId: x.adminBankId,
      destBankAccountId: x.foundationBankId,
      txnDate: todayIso(),
      amountCents: 1_234,
      memo: `${TAG} lump`,
      boardMinute: `${TAG} lump minute`,
    });
    expect([lump.status, lump.body.code]).toEqual([400, "use_sweep_batch"]);
    expect(lump.body.error).toMatch(/itemized batch/);
    expect(await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.memo, `${TAG} lump`))).toHaveLength(0);
    expect((await db.select().from(ledgerTransactions).where(like(ledgerTransactions.memo, `${TAG}%`))).length).toBe(before);

    const transfer = await call("admin", "post", "/api/admin/ledger/transactions", {
      transfer: true,
      sourceFundId: x.adminFundId,
      destFundId: x.adminFundId,
      sourceBankAccountId: x.adminBankId,
      destBankAccountId: x.pettyCashBankId,
      txnDate: todayIso(),
      amountCents: 1_234,
      memo: `${TAG} transfer`,
    });
    expect([transfer.status, transfer.body.status]).toEqual([201, "posted"]);
    const rows = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.memo, `${TAG} transfer`));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.transferGroupId)).size).toBe(1);
    expect(rows.every((r) => r.sweptFromTxnId === null && r.sweepLegTxnId === null)).toBe(true);
  });

  test("should refuse a future sweep date on preview and on create, and accept a past date", async () => {
    const g = await gifts(1, 1_111);
    const tomorrow = new Date(todayIso() + "T00:00:00Z");
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
    const future = tomorrow.toISOString().slice(0, 10);
    const body = createBody(g.ids, g.total, { sweepDate: future });
    const preview = await call("admin", "post", `${B}/preview`, body);
    expect([preview.status, preview.body.code]).toEqual([400, "future_date"]);
    const create = await call("admin", "post", B, body);
    expect([create.status, create.body.code]).toEqual([400, "future_date"]);
    expect(await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.sweptFromTxnId, g.ids[0]))).toHaveLength(0);
    const okPreview = await call("admin", "post", `${B}/preview`, createBody(g.ids, g.total, { sweepDate: giftDate }));
    expect(okPreview.status).toBe(200);
  });

  test("should answer canPost false from a preview whose total exceeds INT4_MAX, and total_too_large from create", async () => {
    const g = await gifts(2, 2_000_000_000);
    // The typed amount is optional on preview and is itself capped at INT4 by the parser
    // (`invalid_amount`), so send a typeable amount: canPost must come from the derived total.
    const preview = await call("admin", "post", `${B}/preview`, createBody(g.ids, 1_000));
    expect(preview.status).toBe(200);
    expect(preview.body.rows.every((r: { refusal: string | null }) => r.refusal === null)).toBe(true);
    expect(preview.body.totalCents).toBeGreaterThan(2_147_483_647);
    expect(preview.body.canPost).toBe(false);
    const create = await call("admin", "post", B, createBody(g.ids, 1_000));
    expect([create.status, create.body.code]).toEqual([400, "total_too_large"]);
  });

  test("should return the gift-date span on the detail and queue a blocked approval email that links the leg and names no party or memo", async () => {
    const half = Math.ceil((thresholdCents + 12_345) / 2);
    const g = await gifts(2, half + 31);
    const res = await call("admin", "post", B, createBody(g.ids, g.total));
    expect(res.status).toBe(201);
    legIds.push(res.body.legId);
    const detail = await call("admin", "get", `${B}/${res.body.legId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.earliestGiftDate).toBe(giftDate);
    expect(detail.body.latestGiftDate).toBe(giftDate);
    // The detail legitimately returns the typed board minute (which carries the fixture tag);
    // what it must never carry is a gift's party or memo.
    const detailText = JSON.stringify(detail.body);
    expect(detailText).not.toContain(`${TAG} Donor`);
    expect(detailText).not.toContain(`${TAG} gift`);

    const queued = (await db.select().from(emailQueue)).filter(
      (q) => !emailBaseline.includes(q.id) && q.subject.startsWith("Sweep pending your approval"),
    );
    expect(queued.length).toBeGreaterThan(0);
    for (const q of queued) {
      expect(q.status).toBe("blocked_non_production");
      expect(q.html).toContain(`/admin/ledger/approvals?txn=${res.body.legId}`);
      expect(q.html).toContain("Only one board approval is needed to post this.");
      expect(q.html).not.toContain(`${TAG} Donor`);
      expect(q.html).not.toContain(`${TAG} gift`);
    }
  });
});
