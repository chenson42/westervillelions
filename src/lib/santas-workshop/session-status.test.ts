import { describe, expect, it } from "vitest";
import { SESSION_STATUSES } from "./session-vocabulary";
import { SETTABLE_STATUSES, STORAGE_TEST_FRESH_MS, checkStatusChange, isSettableStatus, storageTestFresh } from "./session-status";

describe("status transitions", () => {
  const allowed: [string, string][] = [
    ["draft", "active"],
    ["draft", "closed"],
    ["active", "closed"],
    ["active", "draft"],
    ["closed", "active"],
  ];

  it.each(allowed)("%s -> %s is allowed", (from, to) => {
    expect(checkStatusChange(from as never, to as never)).toEqual({ ok: true, noop: false });
  });

  it("every other change between distinct settable statuses is refused", () => {
    for (const from of SESSION_STATUSES) {
      for (const to of SETTABLE_STATUSES) {
        if (from === to || from === "purged") continue;
        const legal = allowed.some(([a, b]) => a === from && b === to);
        expect(checkStatusChange(from, to).ok, `${from} -> ${to}`).toBe(legal);
      }
    }
    expect(checkStatusChange("closed", "draft")).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("the same status is an idempotent no-op", () => {
    for (const s of SETTABLE_STATUSES) expect(checkStatusChange(s, s)).toEqual({ ok: true, noop: true });
  });

  it("purged is terminal", () => {
    for (const to of SETTABLE_STATUSES) expect(checkStatusChange("purged", to)).toEqual({ ok: false, reason: "purged" });
  });

  it("only draft, active and closed are settable; paused is not a status", () => {
    expect(SETTABLE_STATUSES).toEqual(["draft", "active", "closed"]);
    expect(isSettableStatus("paused")).toBe(false);
    expect(isSettableStatus("purged")).toBe(false);
    expect(isSettableStatus("active")).toBe(true);
  });
});

describe("storage test freshness for a real session", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  it("a passing test inside 10 minutes counts", () => {
    expect(storageTestFresh({ at: new Date(now.getTime() - 9 * 60 * 1000), ok: true }, now)).toBe(true);
    expect(storageTestFresh({ at: new Date(now.getTime() - STORAGE_TEST_FRESH_MS), ok: true }, now)).toBe(true);
  });
  it("an old, failed or missing test does not", () => {
    expect(storageTestFresh({ at: new Date(now.getTime() - 11 * 60 * 1000), ok: true }, now)).toBe(false);
    expect(storageTestFresh({ at: new Date(now.getTime() - 60 * 1000), ok: false }, now)).toBe(false);
    expect(storageTestFresh(null, now)).toBe(false);
  });
});
