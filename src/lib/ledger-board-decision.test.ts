import { describe, it, expect } from "vitest";
import type { SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  boardApprovalPredicate,
  boardDecisionPredicate,
  lockDecisionPair,
} from "./ledger-board-decision";

const dialect = new PgDialect();
const render = (q: ReturnType<typeof boardDecisionPredicate>) => {
  const r = dialect.sqlToQuery(q);
  return { text: r.sql.toLowerCase(), params: r.params };
};
const root = join(__dirname);
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("boardDecisionPredicate", () => {
  const { text, params } = render(boardDecisionPredicate());
  it("covers expense, rejected, and the posted half", () => {
    expect(text).toContain('"flow" = $');
    expect(params).toContain("expense");
    expect(params).toContain("rejected");
    expect(params).toContain("posted");
    expect(text).toContain('"approved_at" is not null');
    expect(text).toContain('"board_minute" is not null');
  });
  it("excludes reimbursement-derived rows", () => {
    expect(text).toContain("not exists");
    expect(text).toContain("ledger_reimbursements");
    expect(text).toContain("status\" = 'paid'");
  });
  it("is keyed on approved_at, never the approver id", () => {
    expect(text).not.toContain("approved_by_user_id");
  });
});

describe("boardApprovalPredicate", () => {
  const { text, params } = render(boardApprovalPredicate());
  it("is the posted half plus expense, without the rejected branch", () => {
    expect(params).toContain("expense");
    expect(params).toContain("posted");
    expect(params).not.toContain("rejected");
    expect(text).toContain('"approved_at" is not null');
    expect(text).toContain("not exists");
  });
});

describe("single definition and boundaries", () => {
  const src = strip(readFileSync(join(root, "ledger-board-decision.ts"), "utf8"));
  it("states approved_at, board_minute and paidReimbursementExists( once each", () => {
    expect(src.match(/approvedAt/g)).toHaveLength(1);
    expect(src.match(/boardMinute/g)).toHaveLength(1);
    expect(src.match(/paidReimbursementExists\(/g)).toHaveLength(1);
  });
  it("has no runtime @/lib/db import", () => {
    // `import type { db }` (the executor type) is allowed; a runtime import is not.
    const runtime = src.split("\n").filter((l) => /from\s+["']@\/lib\/db["']/.test(l) && !/^\s*import\s+type\b/.test(l));
    expect(runtime).toEqual([]);
  });
  it("is not redefined in the approval queries module (R9)", () => {
    const file = join(root, "ledger-approval-queries.ts");
    let q: string;
    try {
      q = strip(readFileSync(file, "utf8"));
    } catch {
      return; // module lands in a later step of the same delivery
    }
    expect(q).not.toContain("paidReimbursementExists(");
    expect(q).toContain("boardDecisionPredicate(");
  });
});

describe("lockDecisionPair", () => {
  function fakeTx(rows: { id: string }[]) {
    const seen: { where?: SQL; orderBy?: unknown; mode?: string } = {};
    const chain = {
      from: () => chain,
      where: (w: SQL) => {
        seen.where = w;
        return chain;
      },
      orderBy: (o: unknown) => {
        seen.orderBy = o;
        return chain;
      },
      for: (mode: string) => {
        seen.mode = mode;
        return Promise.resolve(rows);
      },
    };
    return { tx: { select: () => chain } as never, seen };
  }
  const ID = "11111111-1111-4111-8111-111111111111";

  it('"update" calls .for("update")', async () => {
    const { tx, seen } = fakeTx([{ id: ID }]);
    await lockDecisionPair(tx, ID, "update");
    expect(seen.mode).toBe("update");
  });
  it('"share" calls .for("share")', async () => {
    const { tx, seen } = fakeTx([{ id: ID }]);
    await lockDecisionPair(tx, ID, "share");
    expect(seen.mode).toBe("share");
  });
  it("orders by id", async () => {
    const { tx, seen } = fakeTx([]);
    await lockDecisionPair(tx, ID, "share");
    const r = dialect.sqlToQuery(seen.orderBy as SQL);
    expect(r.sql.toLowerCase()).toMatch(/"id" asc/);
  });
  it("renders id = ... OR transfer_group_id = (select transfer_group_id ...)", async () => {
    const { tx, seen } = fakeTx([]);
    await lockDecisionPair(tx, ID, "update");
    const r = dialect.sqlToQuery(seen.where as SQL);
    const text = r.sql.toLowerCase();
    expect(text).toContain('"id" = $');
    expect(text).toContain(" or ");
    expect(text).toContain('"transfer_group_id" = (select transfer_group_id from ledger_transactions where id = $');
    expect(r.params).toContain(ID);
  });
  it("returns the locked rows in the order the database gave them", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const { tx } = fakeTx(rows);
    expect(await lockDecisionPair(tx, ID, "share")).toEqual(rows);
  });
});

describe("R9 source scan (co-sign and queries modules)", () => {
  const read = (f: string) => {
    try {
      return strip(readFileSync(join(root, f), "utf8"));
    } catch {
      return null;
    }
  };
  it("ledger-cosign.ts uses boardApprovalPredicate( and not paidReimbursementExists(", () => {
    const src = read("ledger-cosign.ts");
    expect(src).not.toBeNull();
    expect(src).toContain("boardApprovalPredicate(");
    expect(src).not.toContain("paidReimbursementExists(");
  });
  it("ledger-approval-queries.ts keeps boardDecisionPredicate( and no paidReimbursementExists(", () => {
    const src = read("ledger-approval-queries.ts");
    expect(src).toContain("boardDecisionPredicate(");
    expect(src).not.toContain("paidReimbursementExists(");
  });
});
