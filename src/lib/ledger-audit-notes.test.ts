import { describe, it, expect } from "vitest";
import { AUDIT_NOTE_ACTIONS, diffChangedFields } from "./ledger-audit-notes";
import { CORRECTION_AUDIT_ACTIONS } from "./ledger-correction";

describe("diffChangedFields", () => {
  const existing = { name: "Admin Fund", openingBalanceCents: 1000, bonded: false };
  const keys = ["name", "openingBalanceCents", "bonded"] as const;

  it("returns null when nothing differs (including a patch that restates stored values)", () => {
    expect(diffChangedFields(existing, {}, keys)).toBeNull();
    expect(diffChangedFields(existing, { name: "Admin Fund", openingBalanceCents: 1000 }, keys)).toBeNull();
  });

  it("returns only changed keys in set, before and after", () => {
    const diff = diffChangedFields(existing, { name: "Admin Fund", openingBalanceCents: 2500 }, keys);
    expect(diff).toEqual({
      set: { openingBalanceCents: 2500 },
      before: { openingBalanceCents: 1000 },
      after: { openingBalanceCents: 2500 },
    });
  });

  it("treats false as a real value and ignores undefined", () => {
    const diff = diffChangedFields({ ...existing, bonded: true }, { bonded: false, name: undefined }, keys);
    expect(diff?.set).toEqual({ bonded: false });
  });

  it("ignores patch keys outside the allowed list", () => {
    expect(diffChangedFields(existing, { name: "X" } as Partial<typeof existing>, ["openingBalanceCents"])).toBeNull();
  });
});

describe("AUDIT_NOTE_ACTIONS", () => {
  it("never overlaps CORRECTION_AUDIT_ACTIONS, so the board-visible corrections reader cannot list them", () => {
    const corrections = new Set<string>(CORRECTION_AUDIT_ACTIONS);
    expect(AUDIT_NOTE_ACTIONS.filter((a) => corrections.has(a))).toEqual([]);
  });

  it("includes the three sweep notes (B-172 Increment 2a, break site 20) and not the void, which is a correction", () => {
    expect(AUDIT_NOTE_ACTIONS).toEqual(
      expect.arrayContaining(["sweep_batch_created", "sweep_closeout_marked", "sweep_closeout_unmarked"]),
    );
    expect((AUDIT_NOTE_ACTIONS as readonly string[]).includes("sweep_batch_voided")).toBe(false);
    expect((CORRECTION_AUDIT_ACTIONS as readonly string[]).includes("sweep_batch_voided")).toBe(true);
  });
});
