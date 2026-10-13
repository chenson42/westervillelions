import { describe, expect, it } from "vitest";
import { SESSION_STATUSES, STUFFY_STATES, type RegistrantDto } from "./admin-contract";
import { codeCardStatus, codeShownText, crewInvitation, devicesActiveText, REVERT_HISTORY_NOTE, refundResolutionText, registrantActions, revertButtonLabel, revertTargets, statusActionsFor, statusDoneText, statusHelp, storageCheckText, storageModeText } from "./admin-actions-ui";
import { SETTABLE_STATUSES, checkStatusChange } from "./session-status";

describe("status buttons", () => {
  it("offer exactly the moves the server allows, for every status", () => {
    for (const from of SESSION_STATUSES) {
      const offered = statusActionsFor(from).map((a) => a.to).sort();
      const allowed = SETTABLE_STATUSES.filter((to) => {
        const c = checkStatusChange(from, to);
        return c.ok && !c.noop;
      }).sort();
      expect(offered, from).toEqual(allowed);
    }
  });

  it("asks before closing and before going back to draft, never before activating", () => {
    const active = statusActionsFor("active");
    expect(active.find((a) => a.to === "closed")?.confirm?.destructive).toBe(true);
    expect(active.find((a) => a.to === "draft")?.confirm).not.toBeNull();
    for (const a of statusActionsFor("draft").filter((x) => x.to === "active")) expect(a.confirm).toBeNull();
    for (const a of statusActionsFor("closed")) expect(a.confirm).toBeNull();
  });

  it("offers nothing on a purged session", () => {
    expect(statusActionsFor("purged")).toEqual([]);
  });

  it("has plain help and result text for every status", () => {
    for (const s of SESSION_STATUSES) {
      expect(statusHelp(s, "real")).toBeTruthy();
      expect(statusHelp(s, "practice")).toBeTruthy();
    }
    for (const to of SETTABLE_STATUSES) expect(statusDoneText(to, false)).toBeTruthy();
    expect(statusHelp("draft", "real")).toMatch(/storage test/);
    expect(statusHelp("draft", "practice")).not.toMatch(/storage test/);
  });
});

describe("worker code card", () => {
  it("describes each situation", () => {
    expect(codeCardStatus({ issued: false, paused: false }, "draft").tone).toBe("gray");
    expect(codeCardStatus({ issued: true, paused: false }, "active").tone).toBe("green");
    expect(codeCardStatus({ issued: true, paused: true }, "active").text).toMatch(/Paused/);
    expect(codeCardStatus({ issued: true, paused: false }, "closed").tone).toBe("amber");
  });

  it("warns with the count before a rotate, singular and plural", () => {
    expect(devicesActiveText(1)).toMatch(/^1 phone used/);
    expect(devicesActiveText(3)).toMatch(/^3 phones used/);
  });

  it("explains an unreadable or missing code", () => {
    const base = { code: null, formatted: null, unreadable: false, version: 1, paused: false, activeDevicesLastHour: 0 };
    expect(codeShownText({ ...base, unreadable: true })).toMatch(/Rotate/);
    expect(codeShownText(base)).toMatch(/No code/);
    expect(codeShownText({ ...base, code: "ABCDEF23", formatted: "ABCD-EF23", activeDevicesLastHour: 2 })).toMatch(/2 phones/);
  });

  it("builds the message for the crew from the link and the formatted code", () => {
    const text = crewInvitation("https://westervillelions.org", "workshop-2026", "ABCD-EF23");
    expect(text).toContain("https://westervillelions.org/santas-workshop/crew/workshop-2026");
    expect(text).toContain("ABCD-EF23");
    expect(crewInvitation("https://x.test", "s", null)).toBe("https://x.test/santas-workshop/crew/s");
  });
});

describe("storage text", () => {
  it("names no vendor and is honest about development stores", () => {
    expect(storageModeText("drive")).not.toMatch(/drive|google/i);
    expect(storageModeText("local")).toMatch(/development/);
    expect(storageModeText("memory")).toMatch(/tests/);
  });
  it("sums up a check", () => {
    const clean = { orphanFiles: [], orphanCount: 0, missingFiles: [], missingCount: 0, deleted: 0, complete: true };
    expect(storageCheckText(clean)).toBe("No stray files. No photo is missing its file.");
    expect(storageCheckText({ ...clean, orphanCount: 2, missingCount: 1, complete: false })).toMatch(/2 stray files.*1 photo missing its file.*cut short/);
  });
});

describe("registrant actions", () => {
  const base: Pick<RegistrantDto, "state" | "withdrawn" | "needsAttention" | "refund"> = { state: "registered", withdrawn: false, needsAttention: false, refund: "none" };

  it("offers Withdraw only before custody", () => {
    expect(registrantActions(base, "real", "active").withdraw).toBe(true);
    expect(registrantActions({ ...base, state: "tagged" }, "real", "active").withdraw).toBe(true);
    expect(registrantActions({ ...base, state: "checked_in" }, "real", "active").withdraw).toBe(false);
    expect(registrantActions({ ...base, withdrawn: true }, "real", "active").withdraw).toBe(false);
  });

  it("offers Dismiss only on a flagged, live row", () => {
    expect(registrantActions({ ...base, needsAttention: true }, "real", "active").dismissAttention).toBe(true);
    expect(registrantActions(base, "real", "active").dismissAttention).toBe(false);
    expect(registrantActions({ ...base, needsAttention: true, withdrawn: true }, "real", "active").dismissAttention).toBe(false);
  });

  it("offers Keep / Withdraw on any refund flag", () => {
    expect(registrantActions({ ...base, refund: "refunded" }, "real", "active").refund).toBe(true);
    expect(registrantActions({ ...base, refund: "partial_flag" }, "real", "active").refund).toBe(true);
    expect(registrantActions(base, "real", "active").refund).toBe(false);
  });

  it("offers revert on practice AND real sessions, never from registered", () => {
    for (const kind of ["practice", "real"] as const) {
      expect(registrantActions({ ...base, state: "tagged" }, kind, "active").revert, kind).toBe(true);
      expect(registrantActions({ ...base, state: "picked_up" }, kind, "closed").revert, kind).toBe(true);
      expect(registrantActions(base, kind, "active").revert, kind).toBe(false);
    }
  });

  it("a real session reverts only the last step; practice may pick any earlier step", () => {
    expect(revertTargets("portrait_taken", "real")).toEqual(["checked_in"]);
    expect(revertTargets("tagged", "real")).toEqual(["registered"]);
    expect(revertTargets("registered", "real")).toEqual([]);
    expect(revertTargets("portrait_taken", "practice")).toEqual(["registered", "tagged", "checked_in"]);
    expect(revertButtonLabel("real")).toBe("Revert last step");
    expect(REVERT_HISTORY_NOTE).toMatch(/recorded in the history/);
  });

  it("offers nothing once the session is purged", () => {
    const a = registrantActions({ ...base, state: "tagged", needsAttention: true, refund: "refunded" }, "practice", "purged");
    expect(Object.values(a).every((v) => v === false)).toBe(true);
  });

  it("lists only earlier states as revert targets", () => {
    expect(revertTargets("registered")).toEqual([]);
    expect(revertTargets("checked_in")).toEqual(["registered", "tagged"]);
    expect(revertTargets("picked_up")).toEqual(STUFFY_STATES.slice(0, 4));
  });

  it("reports a refund resolution in plain words", () => {
    expect(refundResolutionText({ orderId: "o", withdrawn: 0, stillInCustody: 0, resolved: true }, "keep")).toMatch(/Kept/);
    expect(refundResolutionText({ orderId: "o", withdrawn: 1, stillInCustody: 2, resolved: false }, "withdraw")).toBe("1 stuffy withdrawn. 2 already in custody stay flagged: they cannot be withdrawn.");
    expect(refundResolutionText({ orderId: "o", withdrawn: 3, stillInCustody: 0, resolved: true }, "withdraw")).toBe("3 stuffies withdrawn.");
  });
});
