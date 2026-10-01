/**
 * T1-T3 and C1-C6: every cell of the fund-move policy (DECISION-109, extended
 * across the entity boundary by DECISION-112), and its mutual exclusion with
 * the transfer policy.
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

describe("checkFundMove (T1/C1: the matrix)", () => {
  it("exactly these two cells are allowed, enumerated and counted", () => {
    const allowed = cartesian().filter((c) => checkFundMove(c).allowed);
    const cells = allowed
      .map((c) => `${c.flow} ${c.from.kind}->${c.to.kind} ${c.sameEntity ? "same" : "cross"}`)
      .sort();
    expect(allowed).toHaveLength(2);
    expect(cells).toEqual([
      "income administrative->activity same",
      "income charitable->activity cross",
    ]);
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

  it("C2: a different entity stays cross_entity for expenses and unknown kinds, never for the cells with their own code", () => {
    // Cross-entity expense keeps its old code, even for the otherwise-interesting pairs.
    expect(codeOf("expense", "charitable", "activity", false)).toBe("cross_entity");
    expect(codeOf("expense", "activity", "charitable", false)).toBe("cross_entity");
    // Cross-entity income between kinds that have no branch of their own.
    expect(codeOf("income", "administrative", "activity", false)).toBe("cross_entity");
    expect(codeOf("income", "mystery", "activity", false)).toBe("cross_entity");
    expect(codeOf("income", "charitable", "mystery", false)).toBe("cross_entity");
    expect(codeOf("income", "charitable", "scholarship", false)).toBe("cross_entity");
    // An unknown flow across entities is also cross_entity (the entity check precedes the flow check).
    expect(codeOf("transfer", "charitable", "activity", false)).toBe("cross_entity");
  });

  it("C2: the Club-to-Foundation direction is its own code and sentence", () => {
    expect(codeOf("income", "activity", "charitable", false)).toBe("club_to_foundation_not_supported");
    expect(codeOf("income", "administrative", "charitable", false)).toBe(
      "club_to_foundation_not_supported",
    );
    const r = checkFundMove({
      flow: "income",
      from: ref("activity", "entity-a", "f1"),
      to: ref("charitable", "entity-b", "f2"),
    });
    if (r.allowed) throw new Error("expected a denial");
    expect(r.reason).toBe(
      "A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register.",
    );
  });

  it("C2: charitable to administrative across entities is away_from_public without the Activity-Fund clause", () => {
    expect(codeOf("income", "charitable", "administrative", false)).toBe("away_from_public");
    const r = checkFundMove({
      flow: "income",
      from: ref("charitable", "entity-a", "f1"),
      to: ref("administrative", "entity-b", "f2"),
    });
    if (r.allowed) throw new Error("expected a denial");
    expect(r.reason).toBe("Public money cannot be moved into the Administrative Fund.");
    expect(r.reason).not.toContain("Activity Fund");
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
      [
        "away_from_public",
        "club_to_foundation_not_supported",
        "cross_entity",
        "expense_not_supported",
        "not_permitted",
      ].sort(),
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

  it("C3: T3 holds over the cartesian including the flow-aware new cell", () => {
    // The T3 loop above IS the C3 test; this asserts it actually exercised the new cell.
    const newCell = cartesian().filter(
      (c) => c.flow === "income" && c.from.kind === "charitable" && c.to.kind === "activity" && !c.sameEntity,
    );
    expect(newCell).toHaveLength(1);
    expect(checkFundMove(newCell[0]).allowed).toBe(true);
    expect(checkTransferDirection(newCell[0].from, newCell[0].to).allowed).toBe(false);
  });

  it("pinned divergence: administrative to activity is blocked as a transfer but allowed as a move", () => {
    const from = ref("administrative", "entity-a", "fund-from");
    const to = ref("activity", "entity-a", "fund-to");
    expect(checkTransferDirection(from, to).allowed).toBe(false);
    expect(checkFundMove({ flow: "income", from, to }).allowed).toBe(true);
  });
});

describe("C4-C6: the cross-entity cell and the sweep's cell", () => {
  it("C4 pinned divergence: charitable to activity across entities is allowed as a move, denied as a transfer", () => {
    const from = ref("charitable", "entity-foundation", "fund-from");
    const to = ref("activity", "entity-club", "fund-to");
    expect(checkFundMove({ flow: "income", from, to }).allowed).toBe(true);
    const transfer = checkTransferDirection(from, to);
    expect(transfer.allowed).toBe(false);
  });

  it("C5 the move policy never allows a cell the sweep (or any transfer mode) allows", () => {
    for (const c of cartesian()) {
      const transfer = checkTransferDirection(c.from, c.to);
      if (transfer.allowed && transfer.mode === "sweep") {
        expect(checkFundMove(c).allowed, `${c.flow} ${c.from.kind}->${c.to.kind}`).toBe(false);
      }
    }
  });

  it("C5 activity to charitable across entities is denied with exactly club_to_foundation_not_supported", () => {
    const from = ref("activity", "entity-club", "fund-from");
    const to = ref("charitable", "entity-foundation", "fund-to");
    expect(checkTransferDirection(from, to)).toMatchObject({ allowed: true, mode: "sweep" });
    expect(checkFundMove({ flow: "income", from, to })).toMatchObject({
      allowed: false,
      code: "club_to_foundation_not_supported",
    });
  });

  it("C6 same-entity charitable to activity income is denied (a kind-only implementation would open it)", () => {
    const r = checkFundMove({
      flow: "income",
      from: ref("charitable", "entity-a", "fund-from"),
      to: ref("activity", "entity-a", "fund-to"),
    });
    expect(r).toMatchObject({ allowed: false, code: "not_permitted" });
  });
});
