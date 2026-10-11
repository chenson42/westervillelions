/**
 * ledger-approval-queries: History + ?txn= resolver
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3 addendum A4).
 * Hermetic: @/lib/db is a recording chain whose awaited result comes from a FIFO queue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Wrap (not replace) cosignEligibility so tests can count calls.
vi.mock("@/lib/ledger-approval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ledger-approval")>();
  return { ...actual, cosignEligibility: vi.fn(actual.cosignEligibility) };
});

const { st } = vi.hoisted(() => ({
  st: {
    queue: [] as unknown[],
    selects: 0,
    wheres: [] as unknown[],
    orders: [] as unknown[][],
    limits: [] as number[],
    selectLists: [] as Record<string, unknown>[],
    /** Per select(): every table passed to from() / leftJoin(). */
    tables: [] as unknown[][],
  },
}));

vi.mock("@/lib/db", () => {
  function chain(tables: unknown[]): unknown {
    const obj: Record<string, unknown> = {
      from: (t: unknown) => (tables.push(t), obj),
      leftJoin: (t: unknown) => (tables.push(t), obj),
      where: (c: unknown) => (st.wheres.push(c), obj),
      orderBy: (...a: unknown[]) => (st.orders.push(a), obj),
      limit: (n: number) => (st.limits.push(n), obj),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const next = st.queue.shift();
        if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
        return Promise.resolve(next ?? []).then(resolve, reject);
      },
    };
    return obj;
  }
  return {
    db: {
      select: (list: Record<string, unknown>) => {
        st.selects += 1;
        st.selectLists.push(list);
        const tables: unknown[] = [];
        st.tables.push(tables);
        return chain(tables);
      },
    },
  };
});

import {
  getRecentDecisions,
  resolveApprovalTarget,
} from "./ledger-approval-queries";
import { RECENT_DECISIONS_LIMIT } from "./ledger-approval";
import { cosignEligibility } from "@/lib/ledger-approval";
import { ledgerTxnCosigns } from "@/lib/db/schema";

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECORDER = "99999999-9999-4999-8999-999999999999";
const ID = "00000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: "posted",
    approvedAt: new Date("2026-10-10T19:00:00Z"),
    rejectedAt: null as Date | null,
    updatedAt: new Date("2026-10-10T19:00:00Z"),
    boardMinute: "Sep minutes",
    rejectionReason: null as string | null,
    amountCents: 227500,
    txnDate: "2026-10-09",
    party: "Acme Hall",
    memo: null,
    entityId: "e1",
    fundName: "Admin Fund",
    partnerFundName: null,
    partnerEntityId: null,
    entityName: "Club",
    partnerEntityName: null,
    recorderName: "Rita Recorder",
    deciderName: "Pat Example" as string | null,
    deciderId: OTHER as string | null,
    recorderId: RECORDER as string | null,
    destRecorderId: null as string | null,
    approvedById: OTHER as string | null,
    ...over,
  };
}
const cosignRow = (over: Record<string, unknown> = {}) => ({
  txnId: ID,
  cosignedAt: new Date("2026-10-11T10:00:00Z"),
  userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as string | null,
  name: "Ann Example" as string | null,
  ...over,
});

beforeEach(() => {
  st.queue = [];
  st.selects = 0;
  st.wheres = [];
  st.orders = [];
  st.limits = [];
  st.selectLists = [];
  st.tables = [];
  vi.mocked(cosignEligibility).mockClear();
});

describe("getRecentDecisions query shape", () => {
  it("filters with the board-decision predicate, orders by coalesce then id desc, limits to 25, no entity filter", async () => {
    st.queue.push([]);
    await getRecentDecisions(VIEWER);
    const where = dialect.sqlToQuery(st.wheres[0] as SQL);
    expect(where.params).toEqual(expect.arrayContaining(["expense", "rejected", "posted"]));
    expect(where.sql.toLowerCase()).toContain("not exists");
    expect(where.sql).not.toContain("entity_id");
    const order = st.orders[0].map((o) => dialect.sqlToQuery(o as SQL).sql.toLowerCase());
    expect(order[0]).toContain("coalesce(");
    expect(order[0]).toContain("desc");
    expect(order[0]).toContain("approved_at");
    expect(order[0]).toContain("rejected_at");
    expect(order[0]).toContain("updated_at");
    expect(order[1]).toContain('"id"');
    expect(order[1]).toContain("desc");
    expect(st.limits).toEqual([RECENT_DECISIONS_LIMIT]);
    expect(RECENT_DECISIONS_LIMIT).toBe(25);
  });

  it("rejects when the query fails", async () => {
    st.queue.push(new Error("db down"));
    await expect(getRecentDecisions(VIEWER)).rejects.toThrow("db down");
  });
});

describe("getRecentDecisions row mapping", () => {
  it("approved with a null decider name: deciderName null", async () => {
    st.queue.push([dbRow({ deciderName: null, deciderId: null })]);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r).toMatchObject({ decision: "approved", deciderName: null, deciderIsViewer: false, boardMinute: "Sep minutes" });
  });
  it("rejected with null rejected_at: deciderOnFile false, falls back to updated_at", async () => {
    const upd = new Date("2026-10-01T10:00:00Z");
    st.queue.push([
      dbRow({ status: "rejected", approvedAt: null, rejectedAt: null, updatedAt: upd, rejectionReason: "No", deciderName: null, deciderId: null }),
    ]);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r).toMatchObject({ decision: "rejected", deciderOnFile: false, rejectionReason: "No", decidedAt: upd.toISOString() });
  });
  it("rejected with a stamp: deciderOnFile true, dated by rejected_at", async () => {
    const rej = new Date("2026-10-05T10:00:00Z");
    st.queue.push([dbRow({ status: "rejected", approvedAt: null, rejectedAt: rej, rejectionReason: "No" })]);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r).toMatchObject({ deciderOnFile: true, decidedAt: rej.toISOString() });
  });
  it("drops an email-shaped decider or recorder name", async () => {
    st.queue.push([dbRow({ deciderName: "x@example.com", recorderName: "y@example.com" })]);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r.deciderName).toBeNull();
    expect(r.recorderName).toBeNull();
  });
  it("deciderIsViewer only when the decider is the viewer", async () => {
    st.queue.push([dbRow({ deciderId: VIEWER }), dbRow({ id: "x", deciderId: OTHER })]);
    const rows = await getRecentDecisions(VIEWER);
    expect(rows.map((r) => r.deciderIsViewer)).toEqual([true, false]);
  });
  it("a Transfer/Sweep pair is one row with its kind and both entity names", async () => {
    st.queue.push([
      dbRow({ partnerFundName: "Activity Fund", partnerEntityId: "e2", partnerEntityName: "Foundation", fundName: "Charitable" }),
    ]);
    const rows = await getRecentDecisions(VIEWER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "sweep", entityName: "Club", partnerEntityName: "Foundation" });
  });
  it("no returned key (at any depth) is a user id", async () => {
    st.queue.push([dbRow(), dbRow({ status: "rejected", approvedAt: null, rejectedAt: new Date() })]);
    const rows = await getRecentDecisions(VIEWER);
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
      }
    };
    walk(rows);
    expect(keys.filter((k) => /userid$/i.test(k) || k === "deciderId")).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(OTHER);
  });
});

describe("co-signers on Recently decided (2b B5)", () => {
  it("the History statement does not reference the co-sign table", async () => {
    st.queue.push([dbRow()], [cosignRow()]);
    await getRecentDecisions(VIEWER);
    expect(st.tables[0]).not.toContain(ledgerTxnCosigns);
    const where = dialect.sqlToQuery(st.wheres[0] as SQL).sql.toLowerCase();
    expect(where).not.toContain("cosign");
    // ordering cannot be bumped by a late co-sign
    for (const o of st.orders[0]) {
      expect(dialect.sqlToQuery(o as SQL).sql.toLowerCase()).not.toContain("cosign");
    }
  });

  it("issues ONE second statement for all rows: IN (...), ordered cosigned_at then id", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => dbRow({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
    st.queue.push(rows, []);
    await getRecentDecisions(VIEWER);
    expect(st.selects).toBe(2);
    expect(st.tables[1]).toContain(ledgerTxnCosigns);
    const where = dialect.sqlToQuery(st.wheres[1] as SQL);
    expect(where.sql.toLowerCase()).toContain(" in (");
    expect(where.params).toContain(rows[0].id);
    expect(where.params).toContain(rows[24].id);
    const order = st.orders[1].map((o) => dialect.sqlToQuery(o as SQL).sql.toLowerCase());
    expect(order[0]).toContain("cosigned_at");
    expect(order[1]).toContain('"id"');
  });

  it("is skipped when there are no approved rows (empty, or only rejected)", async () => {
    st.queue.push([]);
    await getRecentDecisions(VIEWER);
    expect(st.selects).toBe(1);
    st.selects = 0;
    st.queue.push([dbRow({ status: "rejected", approvedAt: null, rejectedAt: new Date() })]);
    await getRecentDecisions(VIEWER);
    expect(st.selects).toBe(1);
  });

  it("a failing second query makes getRecentDecisions() throw", async () => {
    st.queue.push([dbRow()], new Error("cosign query failed"));
    await expect(getRecentDecisions(VIEWER)).rejects.toThrow("cosign query failed");
  });

  it("carries co-signers in time order, deleted accounts as name null, the viewer flagged", async () => {
    st.queue.push(
      [dbRow()],
      [
        cosignRow({ name: "Ann Example" }),
        cosignRow({ userId: null, name: null }),
        cosignRow({ userId: VIEWER, name: "Viewer Example" }),
        cosignRow({ name: "x@example.com", userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
      ],
    );
    const [r] = await getRecentDecisions(VIEWER);
    expect(r.decision === "approved" && r.cosigners.map((c) => [c.name, c.isViewer])).toEqual([
      ["Ann Example", false],
      [null, false],
      ["Viewer Example", true],
      [null, false],
    ]);
  });

  it("groups co-signers by entry and gives an entry with none an empty list", async () => {
    const ID2 = "00000000-0000-4000-8000-000000000002";
    st.queue.push([dbRow(), dbRow({ id: ID2 })], [cosignRow({ txnId: ID2 })]);
    const rows = await getRecentDecisions(VIEWER);
    expect(rows.map((r) => r.decision === "approved" && r.cosigners.length)).toEqual([0, 1]);
  });

  it("canCosign is true for a stranger and false for the recorder of EITHER leg, the poster and an existing co-signer", async () => {
    const run = async (viewer: string, over: Record<string, unknown>, signed: unknown[] = []) => {
      st.queue.push([dbRow(over)], signed);
      const [r] = await getRecentDecisions(viewer);
      return r.decision === "approved" ? r : null;
    };
    const stranger = await run(VIEWER, {});
    expect(stranger).toMatchObject({ canCosign: true, viewerHasCosigned: false, viewerRecorded: false });
    expect(await run(VIEWER, { recorderId: VIEWER })).toMatchObject({ canCosign: false, viewerRecorded: true });
    expect(await run(VIEWER, { destRecorderId: VIEWER })).toMatchObject({ canCosign: false, viewerRecorded: true });
    expect(await run(VIEWER, { approvedById: VIEWER, deciderId: VIEWER })).toMatchObject({
      canCosign: false,
      viewerHasCosigned: false,
      viewerRecorded: false,
    });
    expect(await run(VIEWER, {}, [cosignRow({ userId: VIEWER, name: "Me" })])).toMatchObject({
      canCosign: false,
      viewerHasCosigned: true,
    });
  });

  it("a deleted posting approver (approvedById null) still leaves the entry co-signable", async () => {
    st.queue.push([dbRow({ approvedById: null, deciderId: null, deciderName: null })], []);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r).toMatchObject({ canCosign: true });
  });

  it("calls cosignEligibility() once per approved row and derives all three booleans from it", async () => {
    const ID2 = "00000000-0000-4000-8000-000000000002";
    const ID3 = "00000000-0000-4000-8000-000000000003";
    st.queue.push(
      [dbRow(), dbRow({ id: ID2, recorderId: VIEWER }), dbRow({ id: ID3, status: "rejected", approvedAt: null, rejectedAt: new Date() })],
      [],
    );
    await getRecentDecisions(VIEWER);
    expect(cosignEligibility).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cosignEligibility).mock.calls[0][0]).toMatchObject({
      viewerId: VIEWER,
      recorderIds: [RECORDER, null],
      approvedByUserId: OTHER,
    });
  });

  it("rejected rows carry no co-sign fields", async () => {
    st.queue.push([dbRow({ status: "rejected", approvedAt: null, rejectedAt: new Date() })]);
    const [r] = await getRecentDecisions(VIEWER);
    expect(r).not.toHaveProperty("cosigners");
    expect(r).not.toHaveProperty("canCosign");
  });

  it("no *UserId / recorderId / approvedById key (at any depth) reaches a returned object", async () => {
    st.queue.push([dbRow()], [cosignRow()]);
    const rows = await getRecentDecisions(VIEWER);
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
      }
    };
    walk(rows);
    expect(keys.filter((k) => /userid$|^recorderid$|^destrecorderid$|^approvedbyid$|^deciderid$/i.test(k))).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("dddddddd-dddd");
    expect(JSON.stringify(rows)).not.toContain(RECORDER);
  });

  it("the resolver's decided approved row carries cosigners through the same mapper", async () => {
    st.queue.push(
      [{ id: ID, flow: "expense", status: "posted", entityId: "e1", isBoardDecision: true, partnerEntityId: null, viewerRecorded: false }],
      [dbRow()],
      [cosignRow()],
    );
    const res = await resolveApprovalTarget(ID, VIEWER);
    expect(res).toMatchObject({
      state: "decided",
      row: { decision: "approved", canCosign: true, cosigners: [{ name: "Ann Example", isViewer: false }] },
    });
  });
});

describe("resolveApprovalTarget", () => {
  const cls = (over: Record<string, unknown> = {}) => ({
    id: ID,
    flow: "expense",
    status: "posted",
    entityId: "e1",
    isBoardDecision: true,
    partnerEntityId: null,
    viewerRecorded: false,
    ...over,
  });

  it("returns not_found for a non-UUID without touching the database, never echoing it", async () => {
    for (const bad of ["not-a-uuid", "1; drop table x", "a".repeat(5000), ""]) {
      const res = await resolveApprovalTarget(bad, VIEWER);
      expect(res).toEqual({ state: "not_found" });
      expect(JSON.stringify(res)).not.toContain("drop");
    }
    expect(st.selects).toBe(0);
  });

  it("unknown id: not_found", async () => {
    st.queue.push([]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toEqual({ state: "not_found" });
  });

  it("pending, not own and own (including a viewer who recorded only the income leg)", async () => {
    st.queue.push([cls({ status: "pending", isBoardDecision: false, viewerRecorded: false })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toEqual({ state: "pending", rowId: ID, kind: "disbursement", isOwn: false });
    st.queue.push([cls({ status: "pending", isBoardDecision: false, viewerRecorded: true, partnerEntityId: "e2" })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toEqual({ state: "pending", rowId: ID, kind: "sweep", isOwn: true });
  });

  it("an income-leg id resolves to the pair's expense leg", async () => {
    st.queue.push([cls({ id: ID, status: "pending", partnerEntityId: "e1" })]);
    const res = await resolveApprovalTarget("00000000-0000-4000-8000-0000000000ff", VIEWER);
    expect(res).toMatchObject({ state: "pending", rowId: ID, kind: "transfer" });
  });

  it("a lone income row is not a board decision", async () => {
    st.queue.push([cls({ flow: "income", isBoardDecision: false })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toEqual({ state: "not_board_decision", kind: "disbursement" });
  });

  it("posted without a board decision: not_board_decision", async () => {
    st.queue.push([cls({ isBoardDecision: false })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toEqual({ state: "not_board_decision", kind: "disbursement" });
    expect(st.selects).toBe(1);
  });

  it("decided approved by other / by viewer", async () => {
    st.queue.push([cls()], [dbRow()]);
    const other = await resolveApprovalTarget(ID, VIEWER);
    expect(other).toMatchObject({ state: "decided", row: { decision: "approved", deciderIsViewer: false, deciderName: "Pat Example" } });
    st.queue.push([cls()], [dbRow({ deciderId: VIEWER })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toMatchObject({ state: "decided", row: { deciderIsViewer: true } });
  });

  it("decided rejected by other / by viewer / legacy", async () => {
    const rej = (o = {}) =>
      dbRow({ status: "rejected", approvedAt: null, rejectedAt: new Date("2026-10-05T10:00:00Z"), rejectionReason: "No", ...o });
    st.queue.push([cls({ status: "rejected" })], [rej()]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toMatchObject({ row: { decision: "rejected", deciderIsViewer: false, deciderOnFile: true } });
    st.queue.push([cls({ status: "rejected" })], [rej({ deciderId: VIEWER })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toMatchObject({ row: { decision: "rejected", deciderIsViewer: true } });
    st.queue.push([cls({ status: "rejected" })], [rej({ rejectedAt: null, deciderName: null, deciderId: null })]);
    expect(await resolveApprovalTarget(ID, VIEWER)).toMatchObject({ row: { decision: "rejected", deciderOnFile: false, deciderName: null } });
  });

  it("the decided state's row has the same shape getRecentDecisions returns", async () => {
    st.queue.push([cls()], [dbRow()]);
    const res = await resolveApprovalTarget(ID, VIEWER);
    st.queue.push([dbRow()]);
    const [hist] = await getRecentDecisions(VIEWER);
    expect(res.state === "decided" && Object.keys(res.row).sort()).toEqual(Object.keys(hist).sort());
  });

  it("the classification evaluates the predicate in SQL and orders the expense leg first", async () => {
    st.queue.push([]);
    await resolveApprovalTarget(ID, VIEWER);
    const list = st.selectLists[0];
    const rendered = dialect.sqlToQuery(list.isBoardDecision as SQL).sql.toLowerCase();
    expect(rendered).toContain("not exists");
    const order = dialect.sqlToQuery(st.orders[0][0] as SQL).sql.toLowerCase();
    expect(order).toContain("'expense' desc");
    expect(st.limits).toEqual([1]);
  });
});

describe("importer allow-list and R9 scan", () => {
  const src = join(__dirname, "..");
  function walk(dir: string, out: string[] = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  it("only the Approvals page imports ledger-approval-queries", () => {
    const importers = walk(src)
      .filter((f) => /ledger-approval-queries["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(src, f).split(sep).join("/"))
      .filter((f) => f !== "lib/ledger-approval-queries.ts");
    // Strict now that the page imports it (ux-developer step): exactly one importer.
    expect(importers).toEqual(["app/(dashboard)/admin/ledger/approvals/page.tsx"]);
  });
  it("uses boardDecisionPredicate and never re-states paidReimbursementExists (R9)", () => {
    const text = readFileSync(join(__dirname, "ledger-approval-queries.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).toContain("boardDecisionPredicate(");
    expect(text).not.toContain("paidReimbursementExists(");
  });
  it("qualifies the outer table in the resolver's correlated subqueries", () => {
    // drizzle renders a top-level column in a single-table select unqualified, which
    // inside `FROM ledger_transactions d` binds to the INNER table: EXISTS became
    // always true (every pending row "recorded by you") and the partner lookup
    // matched any income row. Found in the live browser pass; mocks cannot see it.
    const text = readFileSync(join(__dirname, "ledger-approval-queries.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).toContain('"ledger_transactions"."transfer_group_id"');
    expect(text).toContain('"ledger_transactions"."id"');
    expect(text).not.toMatch(/\$\{t\.transferGroupId\}\s*(AND|\)|OR)/);
    expect(text).not.toMatch(/= \$\{t\.id\}/);
  });
});
