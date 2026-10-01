/**
 * T1-T3: every cell of the fund-move policy (DECISION-109), and its mutual
 * exclusion with the transfer policy.
 */
import { describe, it, expect } from "vitest";
import { checkFundMove, type FundMoveDenialCode } from "./ledger-fund-move-policy";
import { checkTransferDirection, type FundRef } from "./ledger-transfer-policy";

const KINDS = ["administrative", "activity", "charitable", "scholarship", "mystery"] as const;
const FLOWS = ["income", "expense"] as const;

function ref(kind: string, entityId: string, fundId: string): FundRef {
  return { entityId, fundId, kind };
}

/** Every (flow, from-kind, to-kind, same-entity?) combination, distinct fund ids. */
function cartesian() {
  const cases: Array<{
    flow: string;
    from: FundRef;
    to: FundRef;
    sameEntity: boolean;
  }> = [];
  for (const flow of FLOWS) {
    for (const fk of KINDS) {
      for (const tk of KINDS) {
        for (const sameEntity of [true, false]) {
          cases.push({
            flow,
            from: ref(fk, "entity-a", "fund-from"),
            to: ref(tk, sameEntity ? "entity-a" : "entity-b", "fund-to"),
            sameEntity,
          });
        }
      }
    }
  }
  return cases;
}

describe("checkFundMove (T1: the matrix)", () => {
  it("exactly one cell is allowed: income, same entity, administrative to activity", () => {
    const allowed = cartesian().filter((c) => checkFundMove(c).allowed);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].flow).toBe("income");
    expect(allowed[0].sameEntity).toBe(true);
    expect(allowed[0].from.kind).toBe("administrative");
    expect(allowed[0].to.kind).toBe("activity");
  });
});

describe("checkFundMove (T2: denial codes)", () => {
  function codeOf(
    flow: string,
    fromKind: string,
    toKind: string,
    sameEntity = true,
  ): FundMoveDenialCode {
    const r = checkFundMove({
      flow,
      from: ref(fromKind, "entity-a", "fund-from"),
      to: ref(toKind, sameEntity ? "entity-a" : "entity-b", "fund-to"),
    });
    if (r.allowed) throw new Error("expected a denial");
    return r.code;
  }

  it("same fund is same_fund", () => {
    const f = ref("administrative", "entity-a", "fund-x");
    const r = checkFundMove({ flow: "income", from: f, to: { ...f } });
    expect(r).toMatchObject({ allowed: false, code: "same_fund" });
  });

  it("a different entity is cross_entity, even for the otherwise-allowed pair", () => {
    expect(codeOf("income", "administrative", "activity", false)).toBe("cross_entity");
    expect(codeOf("income", "activity", "charitable", false)).toBe("cross_entity");
  });

  it("expense activity to administrative is expense_not_supported (its own branch)", () => {
    expect(codeOf("expense", "activity", "administrative")).toBe("expense_not_supported");
  });

  it("away-from-public: income activity to administrative, expense administrative to activity", () => {
    expect(codeOf("income", "activity", "administrative")).toBe("away_from_public");
    expect(codeOf("expense", "administrative", "activity")).toBe("away_from_public");
  });

  it("everything else is not_permitted, including unknown kinds and an unknown flow", () => {
    expect(codeOf("income", "administrative", "scholarship")).toBe("not_permitted");
    expect(codeOf("income", "mystery", "activity")).toBe("not_permitted");
    expect(codeOf("income", "administrative", "mystery")).toBe("not_permitted");
    expect(codeOf("expense", "mystery", "administrative")).toBe("not_permitted");
    expect(codeOf("transfer", "administrative", "activity")).toBe("not_permitted");
    expect(codeOf("", "administrative", "activity")).toBe("not_permitted");
  });

  it("every denial carries a non-empty reason, and reasons are distinct per code", () => {
    const reasonsByCode = new Map<string, Set<string>>();
    for (const c of cartesian()) {
      const r = checkFundMove(c);
      if (r.allowed) continue;
      expect(r.reason.length).toBeGreaterThan(0);
      if (!reasonsByCode.has(r.code)) reasonsByCode.set(r.code, new Set());
      reasonsByCode.get(r.code)!.add(r.reason);
    }
    // Same-flow variants of one code may differ in wording; across codes they must not collide.
    const all = new Map<string, string>();
    for (const [code, reasons] of reasonsByCode) {
      for (const reason of reasons) {
        expect(all.has(reason) && all.get(reason) !== code).toBe(false);
        all.set(reason, code);
      }
    }
    expect([...reasonsByCode.keys()].sort()).toEqual(
      ["away_from_public", "cross_entity", "expense_not_supported", "not_permitted"].sort(),
    );
  });
});

describe("checkFundMove vs checkTransferDirection (T3: mutual exclusion)", () => {
  it("no (from, to) pair is allowed by both policies", () => {
    for (const c of cartesian()) {
      const move = checkFundMove(c).allowed;
      const transfer = checkTransferDirection(c.from, c.to).allowed;
      expect(move && transfer, `${c.flow} ${c.from.kind}->${c.to.kind} sameEntity=${c.sameEntity}`).toBe(false);
    }
  });

  it("same-fund, which the transfer policy allows, the move policy refuses", () => {
    const f = ref("activity", "entity-a", "fund-x");
    expect(checkTransferDirection(f, { ...f }).allowed).toBe(true);
    expect(checkFundMove({ flow: "income", from: f, to: { ...f } }).allowed).toBe(false);
  });

  it("pinned divergence: administrative to activity is blocked as a transfer but allowed as a move", () => {
    const from = ref("administrative", "entity-a", "fund-from");
    const to = ref("activity", "entity-a", "fund-to");
    expect(checkTransferDirection(from, to).allowed).toBe(false);
    expect(checkFundMove({ flow: "income", from, to }).allowed).toBe(true);
  });
});
