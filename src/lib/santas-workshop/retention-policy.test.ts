import { describe, expect, it } from "vitest";
import { defaultRetention } from "./session-input";
import { describeBlockers, parseForce, retentionScopeStatus, retentionStatusFor } from "./retention-policy";

describe("defaultRetention (DECISION-125 dates)", () => {
  it("personal data goes 30 days after pickup day; portraits and group photos stay through January 31 of the following year", () => {
    expect(defaultRetention("2026-12-20")).toEqual({ purgePersonalOn: "2027-01-19", purgePublicOn: "2027-01-31" });
  });
});

describe("retentionScopeStatus", () => {
  const base = { scope: "personal", status: "closed", pickupDate: "2026-12-20", dueOn: "2027-01-19", purgedAt: null } as const;

  it("is due only when the session is closed and the Eastern day is on or after the date (a string compare, never UTC)", () => {
    expect(retentionScopeStatus({ ...base, today: "2027-01-19" })).toMatchObject({ state: "due", blockers: [] });
    expect(retentionScopeStatus({ ...base, today: "2027-01-18" })).toMatchObject({ state: "blocked", blockers: ["before_date"] });
  });

  it("an unclosed session is eligible once the pickup day is at least a day in the past (S5-N3), not before", () => {
    expect(retentionScopeStatus({ ...base, status: "active", today: "2027-01-19" })).toMatchObject({ state: "due", blockers: [] });
    expect(retentionScopeStatus({ ...base, status: "active", pickupDate: "2027-01-19", today: "2027-01-19" }).blockers).toEqual(["session_open"]);
    expect(retentionScopeStatus({ ...base, status: "active", pickupDate: "2027-01-18", today: "2027-01-19" }).blockers).toEqual([]);
    expect(retentionScopeStatus({ ...base, status: "draft", today: "2026-12-20" }).blockers).toEqual(["session_open", "before_date"]);
  });

  it("the date rule per scope still holds for an unclosed session whose event is over", () => {
    expect(retentionScopeStatus({ ...base, status: "active", today: "2027-01-18" }).blockers).toEqual(["before_date"]);
  });

  it("a finished scope is purged whatever else is true", () => {
    const at = new Date("2027-01-20T15:00:00Z");
    expect(retentionScopeStatus({ ...base, status: "purged", purgedAt: at, today: "2026-01-01" })).toMatchObject({ state: "purged", blockers: [], purgedAt: at.toISOString() });
  });
});

describe("retentionStatusFor", () => {
  it("carries both scopes and only a practice session can be reset", () => {
    const row = { kind: "real", status: "closed", pickupDate: "2026-12-20", purgePersonalOn: "2027-01-19", purgePublicOn: "2027-01-31", personalPurgedAt: new Date("2027-01-20T00:00:00Z"), publicPurgedAt: null };
    const s = retentionStatusFor(row, "2027-01-25");
    expect(s.personal.state).toBe("purged");
    expect(s.public).toMatchObject({ state: "blocked", blockers: ["before_date"] });
    expect(s.canReset).toBe(false);
    expect(retentionStatusFor({ ...row, kind: "practice" }, "2027-01-25").canReset).toBe(true);
  });
});

describe("describeBlockers / parseForce", () => {
  it("names each blocker", () => {
    expect(describeBlockers(["session_open", "before_date"], "2027-01-19")).toBe("the event has not finished yet and the date is 2027-01-19");
  });

  it("force needs a trimmed reason of 1 to 500 characters; no force ignores any reason", () => {
    expect(parseForce({})).toEqual({ ok: true, force: false, reason: null });
    expect(parseForce({ force: false, reason: "x" })).toEqual({ ok: true, force: false, reason: null });
    expect(parseForce({ force: true })).toMatchObject({ ok: false, field: "reason" });
    expect(parseForce({ force: true, reason: "   " })).toMatchObject({ ok: false, field: "reason" });
    expect(parseForce({ force: true, reason: "x".repeat(501) })).toMatchObject({ ok: false, field: "reason" });
    expect(parseForce({ force: true, reason: "  Chair asked  " })).toEqual({ ok: true, force: true, reason: "Chair asked" });
    expect(parseForce({ force: "yes" })).toMatchObject({ ok: false, field: "force" });
  });
});
