/**
 * ledger-sweep-link: the one home of the itemized-sweep link predicates
 * (B-172 Increment 2a, DECISION-126).
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { ledgerTransactions } from "@/lib/db/schema";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  LIVE_COPY_PREDICATE,
  decisionPartnerRowId,
  getSweptSourceReceiptSentAt,
  listSweepBadges,
  listSweepRoles,
  loadSweepRole,
  notSweepCopy,
  sweepCopyCount,
  sweepCopyPredicate,
  sweepLegExists,
  sweptSourceExists,
  sweptSourceHasSentReceipt,
} from "./ledger-sweep-link";

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q).sql;
const root = join(__dirname, "..", "..");

describe("LIVE_COPY_PREDICATE", () => {
  it("is the same text in the migration, schema.ts and this module", () => {
    const migration = readFileSync(
      join(root, "drizzle/migrations/0116_ledger_sweep_batches.sql"),
      "utf8",
    );
    const schema = readFileSync(join(root, "src/lib/db/schema.ts"), "utf8");
    expect(LIVE_COPY_PREDICATE).toBe("status <> 'rejected'");
    expect(migration).toContain(`WHERE swept_from_txn_id IS NOT NULL AND ${LIVE_COPY_PREDICATE};`);
    expect(schema).toContain(`IS NOT NULL AND \${t.status} <> 'rejected'`);
  });
});

describe("fragments", () => {
  it("sweepCopyPredicate is the swept-from not-null test; notSweepCopy the leg-pointer null test", () => {
    expect(render(sweepCopyPredicate())).toBe('("ledger_transactions"."swept_from_txn_id" is not null)');
    expect(render(notSweepCopy())).toBe('("ledger_transactions"."sweep_leg_txn_id" is null)');
  });

  it("sweptSourceExists keys on a live copy's swept_from pointer and the live predicate", () => {
    const text = render(sweptSourceExists(ledgerTransactions.id));
    expect(text).toContain("sw_c.swept_from_txn_id = ");
    expect(text).toContain(`sw_c.${LIVE_COPY_PREDICATE}`);
    expect(text.startsWith("EXISTS")).toBe(true);
  });

  it("sweepLegExists keys on any copy's leg pointer, rejected copies included", () => {
    const text = render(sweepLegExists(ledgerTransactions.id));
    expect(text).toContain("sw_l.sweep_leg_txn_id = ");
    expect(text).not.toContain("rejected");
  });

  it("sweptSourceHasSentReceipt joins the copy's SOURCE to a SENT acknowledgment", () => {
    const text = render(sweptSourceHasSentReceipt(ledgerTransactions.id));
    expect(text).toContain("sw_a.donation_txn_id = sw_s.swept_from_txn_id");
    expect(text).toContain("sw_s.id = ");
    expect(text).toContain("sw_a.sent_at IS NOT NULL");
  });

  it("the partner subselect prefers the pair's income leg, then a copy, and counts copies by leg", () => {
    const outerId = sql.raw('"ledger_transactions"."id"');
    const outerGroup = sql.raw('"ledger_transactions"."transfer_group_id"');
    const text = render(decisionPartnerRowId(outerId, outerGroup));
    expect(text).toContain("COALESCE((SELECT d.id");
    expect(text).toContain("d.flow = 'income'");
    expect(text).toContain("c.sweep_leg_txn_id = \"ledger_transactions\".\"id\"");
    expect(render(sweepCopyCount(outerId))).toContain("b.sweep_leg_txn_id");
  });
});

describe("listSweepRoles / loadSweepRole", () => {
  function fakeExec(rows: { legId: string | null; sourceId: string | null; status: string }[]) {
    let selects = 0;
    const exec = {
      select: () => {
        selects += 1;
        return { from: () => ({ where: () => Promise.resolve(rows) }) };
      },
    } as never;
    return { exec, selects: () => selects };
  }

  it("is one query, with an empty id list making none", async () => {
    const { exec, selects } = fakeExec([]);
    expect((await listSweepRoles(exec, [])).size).toBe(0);
    expect(selects()).toBe(0);
    await listSweepRoles(exec, ["a", "b", "a"]);
    expect(selects()).toBe(1);
  });

  it("a row nothing points at has no role", async () => {
    const { exec } = fakeExec([]);
    expect(await loadSweepRole(exec, { id: "x" })).toEqual({
      isLeg: false,
      hasLiveCopy: false,
      hasAnyCopy: false,
    });
  });

  it("a leg is recognised by copies pointing at it", async () => {
    const { exec } = fakeExec([{ legId: "leg", sourceId: "s1", status: "pending" }]);
    expect((await loadSweepRole(exec, { id: "leg" })).isLeg).toBe(true);
  });

  it("a source with a live copy is hasLiveCopy; one with only rejected copies is hasAnyCopy alone", async () => {
    const live = fakeExec([{ legId: "leg", sourceId: "s1", status: "posted" }]);
    expect(await loadSweepRole(live.exec, { id: "s1" })).toEqual({
      isLeg: false,
      hasLiveCopy: true,
      hasAnyCopy: true,
    });
    const rejected = fakeExec([{ legId: "leg", sourceId: "s1", status: "rejected" }]);
    expect(await loadSweepRole(rejected.exec, { id: "s1" })).toEqual({
      isLeg: false,
      hasLiveCopy: false,
      hasAnyCopy: true,
    });
    const both = fakeExec([
      { legId: "leg", sourceId: "s1", status: "rejected" },
      { legId: "leg2", sourceId: "s1", status: "pending" },
    ]);
    expect((await loadSweepRole(both.exec, { id: "s1" })).hasLiveCopy).toBe(true);
  });

  it("folds several ids from one result", async () => {
    const { exec } = fakeExec([
      { legId: "leg", sourceId: "s1", status: "pending" },
      { legId: "leg", sourceId: "s2", status: "pending" },
    ]);
    const roles = await listSweepRoles(exec, ["leg", "s1", "s2", "other"]);
    expect(roles.get("leg")?.isLeg).toBe(true);
    expect(roles.get("s1")?.hasLiveCopy).toBe(true);
    expect(roles.get("s2")?.hasLiveCopy).toBe(true);
    expect(roles.get("other")?.isLeg).toBe(false);
  });
});

describe("getSweptSourceReceiptSentAt", () => {
  it("returns the sent date, or null when none", async () => {
    const at = new Date("2026-03-04T12:00:00Z");
    const make = (rows: unknown[]) =>
      ({
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
          }),
        }),
      }) as never;
    expect(await getSweptSourceReceiptSentAt(make([{ sentAt: at }]), "copy")).toBe(at);
    expect(await getSweptSourceReceiptSentAt(make([]), "copy")).toBeNull();
  });
});

describe("single-spelling scan", () => {
  function walk(dir: string, out: string[] = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = walk(join(root, "src")).filter(
    (f) => !f.endsWith(`${sep}ledger-sweep-link.ts`) && !f.endsWith(`${sep}db${sep}schema.ts`),
  );

  it("no other file spells the swept-from or leg-pointer null tests", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = strip(readFileSync(f, "utf8"));
      const bad =
        /swept_from_txn_id\s+IS\s+(NOT\s+)?NULL/i.test(text) ||
        /sweep_leg_txn_id\s+IS\s+(NOT\s+)?NULL/i.test(text) ||
        /is(Not)?Null\(\s*[\w.]*sweptFromTxnId/.test(text) ||
        /is(Not)?Null\(\s*[\w.]*sweepLegTxnId/.test(text);
      if (bad) offenders.push(relative(root, f));
    }
    expect(offenders).toEqual([]);
  });

  it("no other file spells the live-copy predicate against the swept-from pointer", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = strip(readFileSync(f, "utf8"));
      if (/swept_from_txn_id[^;]{0,120}status\s*<>\s*'rejected'/i.test(text)) {
        offenders.push(relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("notSweepCopy and sweepCopyPredicate are used (not re-spelled) by the pending-approvals query", () => {
    const q = readFileSync(join(root, "src/lib/ledger-queries.ts"), "utf8");
    expect(q).toContain("notSweepCopy()");
    expect(q).toContain("sweptSourceHasSentReceipt(");
  });
});

describe("listSweepBadges (B11): the register chips in two selects", () => {
  type Row = { id: string; legId: string | null; sourceId: string | null; status: string };
  type Leg = { id: string; txnDate: string; status: string; approvedAt: Date | null };
  function fake(rows: Row[], legs: Leg[]) {
    const queue: unknown[][] = [rows, legs];
    let selects = 0;
    const exec = {
      select: () => {
        selects += 1;
        return { from: () => ({ where: () => Promise.resolve(queue.shift() ?? []) }) };
      },
    } as never;
    return { exec, selects: () => selects };
  }
  const LEG = (over: Partial<Leg> = {}): Leg => ({ id: "leg", txnDate: "2026-10-19", status: "posted", approvedAt: null, ...over });

  it("a plain row has no badge; no ids make no query", async () => {
    const none = fake([], []);
    expect((await listSweepBadges(none.exec, [])).size).toBe(0);
    expect(none.selects()).toBe(0);
    const plain = fake([], []);
    expect((await listSweepBadges(plain.exec, ["x"])).size).toBe(0);
    expect(plain.selects()).toBe(1);
  });

  it("a leg gets a batch badge with its copy count and its own state", async () => {
    const { exec } = fake(
      [
        { id: "c1", legId: "leg", sourceId: "s1", status: "pending" },
        { id: "c2", legId: "leg", sourceId: "s2", status: "pending" },
        { id: "c3", legId: "leg", sourceId: "s3", status: "pending" },
      ],
      [LEG({ status: "pending" })],
    );
    expect((await listSweepBadges(exec, ["leg"])).get("leg")).toEqual({
      kind: "batch", legId: "leg", sweepDate: "2026-10-19", state: "pending", count: 3,
    });
  });

  it("an approved leg reads as approved, whatever its status column says", async () => {
    const { exec } = fake(
      [{ id: "c1", legId: "leg", sourceId: "s1", status: "posted" }],
      [LEG({ approvedAt: new Date("2026-10-20T00:00:00Z") })],
    );
    expect((await listSweepBadges(exec, ["leg"])).get("leg")).toMatchObject({ kind: "batch", state: "approved", count: 1 });
  });

  it("a copy gets a copy badge naming its leg; a source with a live copy gets a source badge", async () => {
    const { exec } = fake(
      [
        { id: "c1", legId: "leg", sourceId: "s1", status: "posted" },
        { id: "c2", legId: "leg", sourceId: "s2", status: "posted" },
      ],
      [LEG()],
    );
    const badges = await listSweepBadges(exec, ["c1", "s2", "plain"]);
    expect(badges.get("c1")).toEqual({ kind: "copy", legId: "leg", sweepDate: "2026-10-19", state: "posted" });
    expect(badges.get("s2")).toEqual({ kind: "source", legId: "leg", sweepDate: "2026-10-19", state: "posted" });
    expect(badges.has("plain")).toBe(false);
    expect(badges.has("s1")).toBe(false);
  });

  it("a source whose only copies were rejected is freed and has NO badge", async () => {
    const { exec } = fake(
      [{ id: "c1", legId: "leg", sourceId: "s1", status: "rejected" }],
      [LEG({ status: "rejected" })],
    );
    const badges = await listSweepBadges(exec, ["s1"]);
    expect(badges.has("s1")).toBe(false);
  });

  it("the copy of a rejected batch keeps a copy badge in the rejected state", async () => {
    const { exec } = fake(
      [{ id: "c1", legId: "leg", sourceId: "s1", status: "rejected" }],
      [LEG({ status: "rejected" })],
    );
    expect((await listSweepBadges(exec, ["c1"])).get("c1")).toMatchObject({ kind: "copy", state: "rejected" });
  });

  it("any number of ids costs two selects, never one per row", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const rows: Row[] = ids.map((id, i) => ({ id: `c${i}`, legId: "leg", sourceId: id, status: "posted" }));
    const { exec, selects } = fake(rows, [LEG()]);
    const badges = await listSweepBadges(exec, [...ids, "leg"]);
    expect(selects()).toBe(2);
    expect(badges.size).toBe(61);
    expect(badges.get("leg")).toMatchObject({ kind: "batch", count: 60 });
  });
});
