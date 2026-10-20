/** B-172 Increment 2b, B11: which register controls a sweep row keeps. */
import { describe, expect, it } from "vitest";
import { sweepRowControls } from "./sweep-row-controls";
import type { SweepRowBadge } from "@/lib/ledger-sweep";

const LEG = "11111111-1111-4111-8111-111111111111";
const batch = (state: SweepRowBadge["state"]): SweepRowBadge => ({ kind: "batch", legId: LEG, sweepDate: "2026-10-12", state, count: 3 });
const copy = (state: SweepRowBadge["state"] = "posted"): SweepRowBadge => ({ kind: "copy", legId: LEG, sweepDate: "2026-10-12", state });
const source = (state: SweepRowBadge["state"] = "posted"): SweepRowBadge => ({ kind: "source", legId: LEG, sweepDate: "2026-10-12", state });

describe("sweepRowControls", () => {
  it("a plain row is unchanged: all row actions, donor actions, no chip, no Batch button", () => {
    for (const badge of [null, undefined]) {
      expect(sweepRowControls(badge, true)).toEqual({
        chip: false, rowActions: true, batchButton: false, donorActions: true, canVoid: false,
      });
    }
  });

  it.each([
    ["a leg", batch("posted")],
    ["a copy", copy()],
    ["a claimed source", source()],
  ])("%s hides Edit, Delete, Split and Move and shows the chip and the Batch button", (_n, badge) => {
    const c = sweepRowControls(badge, false);
    expect(c.rowActions).toBe(false);
    expect(c.chip).toBe(true);
    expect(c.batchButton).toBe(true);
  });

  it("a copy keeps the donor controls; a claimed source and a leg do not offer a donor edit the server would refuse", () => {
    expect(sweepRowControls(copy(), false).donorActions).toBe(true);
    expect(sweepRowControls(source(), false).donorActions).toBe(false);
    expect(sweepRowControls(batch("posted"), false).donorActions).toBe(true); // a leg is an expense; the page never shows donor controls on it
  });

  it("Void is offered only to a manager and only while the batch is posted", () => {
    expect(sweepRowControls(batch("posted"), true).canVoid).toBe(true);
    expect(sweepRowControls(batch("posted"), false).canVoid).toBe(false);
    for (const state of ["pending", "approved", "rejected"] as const) {
      expect(sweepRowControls(batch(state), true).canVoid).toBe(false);
      expect(sweepRowControls(copy(state), true).canVoid).toBe(false);
    }
  });
});
