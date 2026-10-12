import { describe, expect, it } from "vitest";
import {
  buildSessionPatch,
  labelsChanged,
  newWindowId,
  recalculateFromPickup,
  removedWindowIds,
  type EditableSession,
} from "./session-edit-patch";
import { defaultCrewClosesOn, defaultRetention } from "./session-input";

const base: EditableSession = {
  name: "Dry run",
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: [
    { id: "fri-1600", label: "4:00 to 5:00 PM", start: "16:00", end: "17:00" },
    { id: "fri-1700", label: "5:00 to 6:00 PM", start: "17:00", end: "18:00" },
  ],
  crewClosesOn: "2026-12-21",
  purgePersonalOn: "2027-01-19",
  purgePublicOn: "2027-01-31",
};
const copy = (): EditableSession => ({ ...base, windows: base.windows.map((w) => ({ ...w })) });

describe("buildSessionPatch", () => {
  it("is empty when nothing changed", () => {
    expect(buildSessionPatch(base, copy())).toEqual({});
  });

  it("returns only the fields that changed", () => {
    const f = copy();
    f.name = "  Renamed ";
    f.photoDate = "2026-12-20";
    expect(buildSessionPatch(base, f)).toEqual({ name: "Renamed", photoDate: "2026-12-20" });
  });

  it("never includes kind or slug even if they ride along in form state", () => {
    const f = { ...copy(), kind: "real", slug: "hacked", name: "x" } as EditableSession;
    const patch = buildSessionPatch(base, f) as Record<string, unknown>;
    expect(patch).toEqual({ name: "x" });
    expect("kind" in patch || "slug" in patch).toBe(false);
  });

  it("existing windows keep their ids through label and time edits", () => {
    const f = copy();
    f.windows[1] = { ...f.windows[1], label: "5:00 PM – 6:00 PM", start: "17:15" };
    const patch = buildSessionPatch(base, f);
    expect(patch.windows?.map((w) => w.id)).toEqual(["fri-1600", "fri-1700"]);
    expect(patch.windows?.[1]).toMatchObject({ label: "5:00 PM – 6:00 PM", start: "17:15" });
  });

  it("a new window gets a fresh id and removed windows are reported", () => {
    const f = copy();
    f.windows.push({ id: newWindowId(f.windows), label: "Late", start: "19:00", end: "20:00" });
    expect(f.windows[2].id).toBe("window-3");
    f.windows = f.windows.filter((w) => w.id !== "fri-1600");
    expect(removedWindowIds(base, f)).toEqual(["fri-1600"]);
    expect(newWindowId([{ id: "window-3", label: "", start: "", end: "" }, { id: "x", label: "", start: "", end: "" }])).toBe("window-4");
  });
});

describe("labelsChanged", () => {
  it("is true for a label edit or a removal, false for time-only, date-only and added windows", () => {
    const label = copy();
    label.windows[0].label = "Four to five";
    expect(labelsChanged(base, label)).toBe(true);
    const time = copy();
    time.windows[0].start = "16:05";
    expect(labelsChanged(base, time)).toBe(false);
    const added = copy();
    added.windows.push({ id: "window-3", label: "Late", start: "19:00", end: "20:00" });
    expect(labelsChanged(base, added)).toBe(false);
    const removed = copy();
    removed.windows.pop();
    expect(labelsChanged(base, removed)).toBe(true);
    const date = copy();
    date.dropoffDate = "2026-12-17";
    expect(labelsChanged(base, date)).toBe(false);
  });
});

describe("recalculateFromPickup", () => {
  it("proposes worker access and both removal dates from the retention defaults", () => {
    const r = recalculateFromPickup("2026-12-27");
    expect(r.crewClosesOn).toBe(defaultCrewClosesOn("2026-12-27"));
    expect({ purgePersonalOn: r.purgePersonalOn, purgePublicOn: r.purgePublicOn }).toEqual(defaultRetention("2026-12-27"));
    expect(r).toEqual({ crewClosesOn: "2026-12-28", purgePersonalOn: "2027-01-26", purgePublicOn: "2027-01-31" });
  });
});
