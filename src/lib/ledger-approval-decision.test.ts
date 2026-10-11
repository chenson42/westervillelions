/**
 * Unit tests for decideTransaction() — the race-safe approve / reject helper
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3).
 *
 * Hermetic: @/lib/db is mocked. The mock supports the lock chain
 * `.select().from().where().orderBy().for("update")`, the name lookup
 * `.select().from().where().limit(1)` and
 * `.update().set().where().returning()`. A thrown error inside
 * `db.transaction` discards the updates recorded during it, mirroring a real
 * rollback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { st } = vi.hoisted(() => ({
  st: {
    lockQueue: [] as unknown[][],
    /** Answers every `.where().limit(1)`: name lookups and the post-rollback re-read, in order. */
    limitQueue: [] as unknown[][],
    returningQueue: [] as ({ id: string }[] | "all")[],
    forArgs: [] as string[],
    orderByCalls: 0,
    lastLockIds: [] as string[],
    updates: [] as { set: Record<string, unknown>; where: unknown }[],
    committed: [] as { set: Record<string, unknown>; where: unknown }[],
  },
}));

vi.mock("@/lib/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => {
          st.orderByCalls += 1;
          return {
            for: (mode: string) => {
              st.forArgs.push(mode);
              const rows = (st.lockQueue.shift() ?? []) as { id: string }[];
              st.lastLockIds = rows.map((r) => r.id);
              return Promise.resolve(rows);
            },
          };
        },
        limit: () => Promise.resolve(st.limitQueue.shift() ?? []),
      }),
    }),
  });
  const update = () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: unknown) => ({
        returning: () => {
          st.updates.push({ set, where });
          const next = st.returningQueue.shift() ?? "all";
          return Promise.resolve(next === "all" ? st.lastLockIds.map((id) => ({ id })) : next);
        },
      }),
    }),
  });
  return {
    db: {
      select,
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const before = st.updates.length;
        try {
          const out = await cb({ select, update });
          st.committed.push(...st.updates.slice(before));
          return out;
        } catch (e) {
          st.updates.length = before + 0; // rolled back: stamps do not survive
          throw e;
        }
      }),
    },
  };
});

import {
  conflictFromRow,
  decideTransaction,
  lookupDeciderName,
} from "./ledger-approval-decision";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function row(over: Record<string, unknown> = {}) {
  return {
    id: A,
    transferGroupId: null,
    status: "pending",
    recordedByUserId: RECORDER,
    boardMinute: null as string | null,
    approvedByUserId: null as string | null,
    approvedAt: null as Date | null,
    rejectedByUserId: null as string | null,
    rejectedAt: null as Date | null,
    updatedAt: new Date("2026-10-09T12:00:00Z"),
    ...over,
  };
}
const legA = (over = {}) => row({ id: A, transferGroupId: GROUP, ...over });
const legB = (over = {}) => row({ id: B, transferGroupId: GROUP, ...over });

function dialect(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}

beforeEach(() => {
  st.lockQueue = [];
  st.limitQueue = [];
  st.returningQueue = [];
  st.forArgs = [];
  st.orderByCalls = 0;
  st.lastLockIds = [];
  st.updates = [];
  st.committed = [];
});

const approve = (id = A, boardMinute: unknown = "Minute 4", actor = ACTOR) =>
  decideTransaction({ id, actorUserId: actor, input: { kind: "approve", boardMinute } });
const reject = (id = A, reason: unknown = "Not budgeted", actor = ACTOR) =>
  decideTransaction({ id, actorUserId: actor, input: { kind: "reject", reason } });

describe("decideTransaction — approve", () => {
  it("ordinary row: one pinned UPDATE sets the approval stamps, under FOR UPDATE ORDER BY id", async () => {
    st.lockQueue.push([row()]);
    const now = new Date("2026-10-10T15:00:00Z");
    const res = await decideTransaction({
      id: A,
      actorUserId: ACTOR,
      input: { kind: "approve", boardMinute: "  Minute 4  " },
      now,
    });
    expect(res).toEqual({ ok: true, id: A });
    expect(st.forArgs).toEqual(["update"]);
    expect(st.orderByCalls).toBe(1);
    expect(st.updates).toHaveLength(1);
    expect(st.updates[0].set).toEqual({
      status: "posted",
      approvedByUserId: ACTOR,
      approvedAt: now,
      boardMinute: "Minute 4",
      updatedAt: now,
    });
    const q = dialect(st.updates[0].where);
    expect(q.sql).toContain('"status" = $');
    expect(q.params).toContain("pending");
    expect(q.params).toContain(A);
  });

  it("pair: one UPDATE covers both ids with identical stamps", async () => {
    st.lockQueue.push([legA(), legB()]);
    const res = await approve(A);
    expect(res).toEqual({ ok: true, id: A });
    expect(st.updates).toHaveLength(1);
    const q = dialect(st.updates[0].where);
    expect(q.params).toEqual(expect.arrayContaining([A, B, "pending"]));
  });

  it("blank minute on a row with none: 400 and no UPDATE", async () => {
    st.lockQueue.push([row()]);
    const res = await approve(A, "   ");
    expect(res).toMatchObject({ ok: false, status: 400, body: { error: "boardMinute is required" } });
    expect(st.updates).toHaveLength(0);
  });

  it("non-string minute is treated as blank", async () => {
    st.lockQueue.push([row()]);
    const res = await approve(A, 42);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("a Sweep that already has a minute keeps it when the request is blank", async () => {
    st.lockQueue.push([legA({ boardMinute: "Creation minute" }), legB({ boardMinute: "Creation minute" })]);
    const res = await approve(A, "");
    expect(res.ok).toBe(true);
    expect(st.updates[0].set.boardMinute).toBe("Creation minute");
  });

  it("truncates the minute to 500 characters", async () => {
    st.lockQueue.push([row()]);
    await approve(A, "x".repeat(600));
    expect((st.updates[0].set.boardMinute as string).length).toBe(500);
  });

  it("unknown id: 404 with code not_found", async () => {
    st.lockQueue.push([]);
    const res = await approve();
    expect(res).toMatchObject({ ok: false, status: 404, body: { code: "not_found" } });
  });

  it("malformed id: 404 without touching the database", async () => {
    const res = await approve("not-a-uuid");
    expect(res).toMatchObject({ ok: false, status: 404, body: { code: "not_found" } });
    expect(st.forArgs).toHaveLength(0);
  });
});

describe("decideTransaction — self rule", () => {
  it("403 when the actor recorded the target; no UPDATE", async () => {
    st.lockQueue.push([row({ recordedByUserId: ACTOR })]);
    const res = await approve();
    expect(res).toMatchObject({
      ok: false,
      status: 403,
      body: { error: "You cannot approve a transaction you recorded" },
    });
    expect(st.updates).toHaveLength(0);
  });

  it("403 when the actor recorded only the destination leg of a pair", async () => {
    st.lockQueue.push([legA(), legB({ recordedByUserId: ACTOR })]);
    const res = await approve(A);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(st.updates).toHaveLength(0);
  });

  it("reject uses the reject wording and the same either-leg rule", async () => {
    st.lockQueue.push([legA(), legB({ recordedByUserId: ACTOR })]);
    const res = await reject(A);
    expect(res).toMatchObject({
      ok: false,
      status: 403,
      body: { error: "You cannot reject a transaction you recorded" },
    });
    expect(st.updates).toHaveLength(0);
  });
});

describe("decideTransaction — not pending (409)", () => {
  it("approved by a named user", async () => {
    const when = new Date("2026-10-10T15:42:00Z");
    st.lockQueue.push([row({ status: "posted", approvedAt: when, approvedByUserId: OTHER })]);
    st.limitQueue.push([{ name: "Pat Example" }]);
    const res = await approve();
    expect(res).toEqual({
      ok: false,
      status: 409,
      body: {
        error: "Transaction is no longer pending",
        code: "not_pending",
        decision: "approved",
        deciderName: "Pat Example",
        decidedAt: when.toISOString(),
        decidedByViewer: false,
      },
    });
    expect(st.updates).toHaveLength(0);
  });

  it("approved, approver account deleted: decision approved, name null", async () => {
    st.lockQueue.push([row({ status: "posted", approvedAt: new Date(), approvedByUserId: null })]);
    const res = await approve();
    expect(res).toMatchObject({ status: 409, body: { decision: "approved", deciderName: null } });
  });

  it("rejected with a stamp: names the rejector, decidedAt = rejectedAt", async () => {
    const rej = new Date("2026-10-09T18:00:00Z");
    st.lockQueue.push([
      row({ status: "rejected", rejectedByUserId: RECORDER, rejectedAt: rej, updatedAt: new Date("2026-10-09T18:00:05Z") }),
    ]);
    st.limitQueue.push([{ name: "Pat Example" }]);
    const res = await approve();
    expect(res).toMatchObject({
      status: 409,
      body: { decision: "rejected", deciderName: "Pat Example", decidedAt: rej.toISOString(), decidedByViewer: false },
    });
  });

  it("rejected, legacy (no stamp): name null, decidedAt = updatedAt, no name lookup", async () => {
    const upd = new Date("2026-10-09T18:00:00Z");
    st.lockQueue.push([row({ status: "rejected", updatedAt: upd })]);
    const res = await approve();
    expect(res).toMatchObject({
      status: 409,
      body: { decision: "rejected", deciderName: null, decidedAt: upd.toISOString(), decidedByViewer: false },
    });
  });

  it("rejected by the actor: decidedByViewer true (a reject double-click)", async () => {
    st.lockQueue.push([row({ status: "rejected", rejectedByUserId: ACTOR, rejectedAt: new Date() })]);
    st.limitQueue.push([{ name: "Me" }]);
    const res = await reject();
    expect(res).toMatchObject({ status: 409, body: { decision: "rejected", decidedByViewer: true, deciderName: "Me" } });
  });

  it("posted with no approvedAt: decision null", async () => {
    st.lockQueue.push([row({ status: "posted" })]);
    const res = await approve();
    expect(res).toMatchObject({ status: 409, body: { decision: null, decidedAt: null } });
  });

  it("the actor is the decider: decidedByViewer true", async () => {
    st.lockQueue.push([row({ status: "posted", approvedAt: new Date(), approvedByUserId: ACTOR })]);
    st.limitQueue.push([{ name: "Me Myself" }]);
    const res = await approve();
    expect(res).toMatchObject({ status: 409, body: { decidedByViewer: true } });
  });

  it("a decider whose stored name is an email address is never exposed", async () => {
    st.lockQueue.push([row({ status: "posted", approvedAt: new Date(), approvedByUserId: OTHER })]);
    st.limitQueue.push([{ name: "someone@example.com" }]);
    const res = await approve();
    expect(res).toMatchObject({ status: 409, body: { deciderName: null } });
  });

  it("partner not pending (target pending): partner message, no UPDATE", async () => {
    st.lockQueue.push([legA(), legB({ status: "posted", approvedAt: new Date(), approvedByUserId: null })]);
    const res = await approve(A);
    expect(res).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "The paired transaction is no longer pending" },
    });
    expect(st.updates).toHaveLength(0);
  });

  it("a pair with an unexpected number of rows is refused without writing", async () => {
    st.lockQueue.push([legA()]);
    const res = await approve(A);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(st.updates).toHaveLength(0);
  });
});

describe("decideTransaction — rollback sentinel", () => {
  it("a pinned UPDATE that returns fewer ids than locked rows rolls back and answers 409", async () => {
    st.lockQueue.push([legA(), legB()]);
    st.returningQueue.push([{ id: A }]); // 1 of 2
    // re-read after the rollback: the target is now approved by someone else
    st.limitQueue.push(
      [row({ id: A, transferGroupId: GROUP, status: "posted", approvedAt: new Date(), approvedByUserId: OTHER })],
      [{ name: "Pat Example" }],
    );
    const res = await approve(A);
    expect(res).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "not_pending", decision: "approved", deciderName: "Pat Example" },
    });
    expect(st.committed).toHaveLength(0);
    expect(st.updates).toHaveLength(0);
  });

  it("a row deleted before the re-read is a 404", async () => {
    st.lockQueue.push([row()]);
    st.returningQueue.push([]);
    st.limitQueue.push([]);
    const res = await approve();
    expect(res).toMatchObject({ ok: false, status: 404, body: { code: "not_found" } });
  });
});

describe("decideTransaction — races", () => {
  it("two sequential approvals: the first wins, the second 409s naming the first approver", async () => {
    st.lockQueue.push([row()]);
    expect((await approve()).ok).toBe(true);
    const winnerAt = new Date("2026-10-10T16:00:00Z");
    st.lockQueue.push([row({ status: "posted", approvedAt: winnerAt, approvedByUserId: OTHER })]);
    st.limitQueue.push([{ name: "Pat Example" }]);
    const second = await approve(A, "Minute 4", B);
    expect(second).toMatchObject({
      ok: false,
      status: 409,
      body: { decision: "approved", deciderName: "Pat Example" },
    });
    expect(st.committed).toHaveLength(1);
  });

  it("approve then reject: the loser's UPDATE never runs, so no approver stamp lands on a rejected row", async () => {
    st.lockQueue.push([row()]);
    expect((await approve()).ok).toBe(true);
    st.lockQueue.push([row({ status: "posted", approvedAt: new Date(), approvedByUserId: ACTOR })]);
    st.limitQueue.push([{ name: "Me" }]);
    const loser = await reject(A, "Too late", OTHER);
    expect(loser).toMatchObject({ ok: false, status: 409, body: { decision: "approved" } });
    expect(st.committed).toHaveLength(1);
    expect(st.committed[0].set.status).toBe("posted");
  });

  it("reject then approve: the loser gets the rejected decision and no UPDATE", async () => {
    st.lockQueue.push([row()]);
    expect((await reject()).ok).toBe(true);
    st.lockQueue.push([row({ status: "rejected", rejectedByUserId: ACTOR, rejectedAt: new Date(), updatedAt: new Date() })]);
    st.limitQueue.push([{ name: "Rejector Name" }]);
    const loser = await approve(A, "Minute", OTHER);
    expect(loser).toMatchObject({ ok: false, status: 409, body: { decision: "rejected", deciderName: "Rejector Name" } });
    expect(st.committed).toHaveLength(1);
    expect(st.committed[0].set.status).toBe("rejected");
    expect(st.committed[0].set).not.toHaveProperty("approvedByUserId");
  });
});

describe("decideTransaction — reject", () => {
  it("blank or non-string reason: 400, no UPDATE", async () => {
    for (const bad of ["", "   ", undefined, 7]) {
      st.lockQueue.push([row()]);
      const res = await decideTransaction({
        id: A,
        actorUserId: ACTOR,
        input: { kind: "reject", reason: bad },
      });
      expect(res).toMatchObject({ ok: false, status: 400, body: { error: "reason is required" } });
    }
    expect(st.updates).toHaveLength(0);
  });

  it("trims, truncates to 1000, and stamps both legs of a pair in one UPDATE", async () => {
    st.lockQueue.push([legA(), legB()]);
    const res = await reject(A, `  ${"r".repeat(1200)}  `);
    expect(res.ok).toBe(true);
    expect(st.updates).toHaveLength(1);
    expect((st.updates[0].set.rejectionReason as string).length).toBe(1000);
    expect(st.updates[0].set.status).toBe("rejected");
    expect(st.updates[0].set).not.toHaveProperty("approvedAt");
    expect(st.updates[0].set).not.toHaveProperty("approvedByUserId");
    expect(st.updates[0].set.rejectedByUserId).toBe(ACTOR);
    expect(st.updates[0].set.rejectedAt).toBeInstanceOf(Date);
    expect(st.updates[0].set.rejectedAt).toBe(st.updates[0].set.updatedAt);
    const q = dialect(st.updates[0].where);
    expect(q.params).toEqual(expect.arrayContaining([A, B, "pending"]));
  });
});

describe("conflictFromRow", () => {
  const viewer = ACTOR;
  const base = {
    id: A,
    approvedByUserId: null,
    approvedAt: null,
    rejectedByUserId: null as string | null,
    rejectedAt: null as Date | null,
    updatedAt: new Date("2026-10-09T00:00:00Z"),
  };
  it("classifies approved, rejected and neither", () => {
    const when = new Date("2026-10-10T10:00:00Z");
    expect(conflictFromRow({ ...base, status: "posted", approvedAt: when, approvedByUserId: OTHER }, "Pat", viewer)).toMatchObject({
      decision: "approved",
      decidedAt: when.toISOString(),
      deciderName: "Pat",
      decidedByViewer: false,
    });
    expect(conflictFromRow({ ...base, status: "rejected" }, null, viewer)).toMatchObject({
      decision: "rejected",
      decidedAt: base.updatedAt.toISOString(),
    });
    expect(conflictFromRow({ ...base, status: "posted" }, null, viewer)).toMatchObject({
      decision: null,
      decidedAt: null,
    });
  });
  it("rejected with a stamp: decidedAt is rejectedAt and the rejector is the viewer only for the rejector", () => {
    const rej = new Date("2026-10-10T09:00:00Z");
    const r = { ...base, status: "rejected", rejectedAt: rej, rejectedByUserId: viewer };
    expect(conflictFromRow(r, "Me", viewer)).toMatchObject({ decidedAt: rej.toISOString(), decidedByViewer: true });
    expect(conflictFromRow(r, "Me", OTHER)).toMatchObject({ decidedAt: rej.toISOString(), decidedByViewer: false });
  });
  it("rejected with no stamp falls back to updatedAt with a null name", () => {
    expect(conflictFromRow({ ...base, status: "rejected" }, null, viewer)).toMatchObject({
      decidedAt: base.updatedAt.toISOString(),
      deciderName: null,
      decidedByViewer: false,
    });
  });
  it("an email-shaped rejector name becomes null", () => {
    expect(
      conflictFromRow({ ...base, status: "rejected", rejectedAt: new Date(), rejectedByUserId: OTHER }, "a@example.com", viewer).deciderName,
    ).toBeNull();
  });
  it("an email-shaped name becomes null", () => {
    expect(
      conflictFromRow({ ...base, status: "posted", approvedAt: new Date(), approvedByUserId: OTHER }, "a@example.com", viewer).deciderName,
    ).toBeNull();
  });
});

describe("lookupDeciderName", () => {
  const lookup = (r: Record<string, unknown>) =>
    lookupDeciderName(
      { select: () => dbSelect() } as never,
      r as never,
    );
  let selects = 0;
  const dbSelect = () => {
    selects += 1;
    return { from: () => ({ where: () => ({ limit: () => Promise.resolve(st.limitQueue.shift() ?? []) }) }) };
  };
  beforeEach(() => { selects = 0; });

  it("returns the rejector for a rejected row", async () => {
    st.limitQueue.push([{ name: "Rej" }]);
    expect(await lookup(row({ status: "rejected", rejectedByUserId: OTHER }))).toBe("Rej");
    expect(selects).toBe(1);
  });
  it("returns the approver for an approved row", async () => {
    st.limitQueue.push([{ name: "App" }]);
    expect(await lookup(row({ status: "posted", approvedAt: new Date(), approvedByUserId: OTHER }))).toBe("App");
  });
  it("issues no select for a pending row, a null id, or a posted row without approvedAt", async () => {
    expect(await lookup(row())).toBeNull();
    expect(await lookup(row({ status: "rejected" }))).toBeNull();
    expect(await lookup(row({ status: "posted", approvedAt: new Date() }))).toBeNull();
    expect(await lookup(row({ status: "posted", approvedByUserId: OTHER }))).toBeNull();
    expect(selects).toBe(0);
  });
});

describe("lock helper extraction (2b B2)", () => {
  it("imports lockDecisionPair and has no inline row lock", () => {
    const src = readFileSync(join(__dirname, "ledger-approval-decision.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain("lockDecisionPair");
    expect(src).not.toContain('.for("update")');
  });
});
