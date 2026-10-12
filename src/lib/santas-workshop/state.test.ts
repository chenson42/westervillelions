import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WORKSHOP_2026, type WorkshopFacts } from "./facts";
import { WORKSHOP_STATES, focusDay, workshopState } from "./state";

const at = (iso: string) => new Date(iso);
const state = (iso: string, f: WorkshopFacts = WORKSHOP_2026) => workshopState(at(iso), f);

describe("workshopState", () => {
  it("is before at 2026-11-08T04:59:59Z and open at 2026-11-08T05:00:00Z", () => {
    expect(state("2026-11-08T04:59:59Z")).toBe("before");
    expect(state("2026-11-08T05:00:00Z")).toBe("open");
  });

  it("is open at 2026-12-17T04:59:59Z (11:59:59 PM Dec 16 Eastern) and closed at 05:00:00Z", () => {
    expect(state("2026-12-17T04:59:59Z")).toBe("open");
    expect(state("2026-12-17T05:00:00Z")).toBe("closed");
  });

  it("is closed at 2026-12-21T04:59:59Z and after at 2026-12-21T05:00:00Z", () => {
    expect(state("2026-12-21T04:59:59Z")).toBe("closed");
    expect(state("2026-12-21T05:00:00Z")).toBe("after");
  });

  it("is before in October and after in 2027", () => {
    expect(state("2026-10-12T16:00:00Z")).toBe("before");
    expect(state("2027-03-01T16:00:00Z")).toBe("after");
  });

  it("a lastSignupDay of yesterday closes the page at once (manual stop)", () => {
    const stopped = { ...WORKSHOP_2026, lastSignupDay: "2026-11-19" };
    expect(state("2026-11-20T17:00:00Z", stopped)).toBe("closed");
  });

  it("a lastSignupDay later than today reopens it", () => {
    const stopped = { ...WORKSHOP_2026, lastSignupDay: "2026-11-19" };
    const reopened = { ...stopped, lastSignupDay: "2026-12-16" };
    expect(state("2026-11-20T17:00:00Z", reopened)).toBe("open");
  });

  it("an invalid lastSignupDay before registrationOpens degrades to closed, never open", () => {
    const bad = { ...WORKSHOP_2026, lastSignupDay: "2026-11-01" };
    for (const iso of ["2026-10-20T16:00:00Z", "2026-11-05T16:00:00Z", "2026-11-12T16:00:00Z"]) {
      expect(state(iso, bad)).not.toBe("open");
    }
    expect(state("2026-11-12T16:00:00Z", bad)).toBe("closed");
  });

  it("WORKSHOP_STATES is exactly before, open, closed, after in that order", () => {
    expect([...WORKSHOP_STATES]).toEqual(["before", "open", "closed", "after"]);
  });
});

describe("focusDay", () => {
  const f = (iso: string) => focusDay(at(iso), WORKSHOP_2026);
  it("is dropoff, photos, pickup on their Eastern days and null on Dec 17 and Dec 21", () => {
    expect(f("2026-12-18T04:59:59Z")).toBeNull();
    expect(f("2026-12-18T05:00:00Z")).toBe("dropoff");
    expect(f("2026-12-19T05:00:00Z")).toBe("photos");
    expect(f("2026-12-20T05:00:00Z")).toBe("pickup");
    expect(f("2026-12-17T16:00:00Z")).toBeNull();
    expect(f("2026-12-21T05:00:00Z")).toBeNull();
  });
});

describe("source scans", () => {
  const read = (n: string) => readFileSync(path.join(__dirname, n), "utf8");
  it("state.ts and format.ts never pass a string to new Date()", () => {
    for (const n of ["state.ts", "format.ts"]) {
      const code = read(n).replace(/\/\/.*$/gm, "");
      expect(code, n).not.toMatch(/new Date\(\s*(["'`]|(?!Date\.UTC)[A-Za-z])/);
    }
  });
  it("state.ts imports no db, auth, email or next module", () => {
    expect(read("state.ts")).not.toMatch(/from\s+["'](@\/lib\/db|@\/lib\/auth|@\/lib\/email|next)/);
  });
});
