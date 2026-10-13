import { describe, expect, it } from "vitest";
import type { CrewRosterRow, ScanResult } from "@/lib/santas-workshop/crew-contract";
import { STUFFY_STATES } from "@/lib/santas-workshop/crew-contract";
import { canRevert } from "@/lib/santas-workshop/state-machine";
import { pickupControls, CREW_STATE_LABELS, ROSTER_FILTERS, ROSTER_FILTER_LABELS, crewDisplayName, describeScan, filterRoster, nextStep, previousState, rowMatchesQuery, showRevert, tagText, updatedAgoText, windowLabelFor } from "./crew-ui";

function row(id: string, over: Partial<CrewRosterRow> = {}): CrewRosterRow {
  return { id, name: id, description: null, state: "registered", windowId: "w1", orderId: "o1", orderSize: 1, last4: null, refundBadge: false, detailsBeingChecked: false, hasCheckInPhoto: false, hasPortrait: false, ...over };
}

describe("crew roster logic", () => {
  it("labels an unnamed stuffy with its order size", () => {
    expect(crewDisplayName(null, 3)).toBe("Unnamed stuffy, order of 3");
    expect(crewDisplayName("  ", 2)).toBe("Unnamed stuffy, order of 2");
    expect(crewDisplayName("Pip", 1)).toBe("Pip");
  });

  it("has a label for every state and every filter", () => {
    for (const s of STUFFY_STATES) expect(CREW_STATE_LABELS[s]).toBeTruthy();
    for (const f of ROSTER_FILTERS) expect(ROSTER_FILTER_LABELS[f]).toBeTruthy();
  });

  it("searches name, description and the sticker's last four, ignoring case", () => {
    const r = row("Pip", { description: "Brown BEAR with a bow", last4: "ZX81" });
    expect(rowMatchesQuery(r, "pip")).toBe(true);
    expect(rowMatchesQuery(r, "bear")).toBe(true);
    expect(rowMatchesQuery(r, "zx8")).toBe(true);
    expect(rowMatchesQuery(r, "giraffe")).toBe(false);
    expect(rowMatchesQuery(r, "  ")).toBe(true);
    expect(rowMatchesQuery(row("x", { name: null, orderSize: 3 }), "order of 3")).toBe(true);
  });

  it("filters by step and keeps family-name matches the server found", () => {
    const rows = [row("Pip", { state: "tagged" }), row("Bella", { state: "registered" }), row("Max", { state: "tagged" })];
    expect(filterRoster(rows, { query: "", filter: "tagged" }).map((r) => r.id)).toEqual(["Pip", "Max"]);
    expect(filterRoster(rows, { query: "ell", filter: "all" }).map((r) => r.id)).toEqual(["Bella"]);
    // "smi" matched a parent named Smith on the server; the row's own text does not contain it.
    expect(filterRoster(rows, { query: "smi", filter: "all", serverMatches: [rows[2]] }).map((r) => r.id)).toEqual(["Max"]);
    // A server match still respects the step filter.
    expect(filterRoster(rows, { query: "smi", filter: "registered", serverMatches: [rows[2]] })).toEqual([]);
  });

  it("opens each state on its own step", () => {
    expect(nextStep("registered").screen).toBe("tag");
    expect(nextStep("tagged").screen).toBe("checkin");
    expect(nextStep("checked_in").screen).toBe("portrait");
    expect(nextStep("portrait_taken").screen).toBe("pickup");
    expect(nextStep("picked_up").screen).toBe("done");
    for (const s of STUFFY_STATES) expect(nextStep(s).label).toBeTruthy();
  });

  it("turns a scan result into a directive for every result", () => {
    const found: ScanResult = { result: "found", stuffy: row("Pip") };
    expect(describeScan(found)).toEqual({ kind: "open", row: found.stuffy });
    expect(describeScan({ result: "not_tagged" }).kind).toBe("not_tagged");
    expect(describeScan({ result: "retired" })).toMatchObject({ kind: "retired" });
    expect(describeScan({ result: "withdrawn" })).toMatchObject({ kind: "withdrawn" });
    for (const r of ["not_tagged", "retired", "withdrawn"] as const) {
      const d = describeScan({ result: r });
      expect("message" in d && d.message).not.toMatch(/drive|error/i);
    }
  });

  it("finds a window label, or null", () => {
    const s = { windows: [{ id: "w1", label: "5:00 PM", start: "17:00", end: "18:00" }] };
    expect(windowLabelFor(s, "w1")).toBe("5:00 PM");
    expect(windowLabelFor(s, "nope")).toBeNull();
    expect(windowLabelFor(s, null)).toBeNull();
  });

  it("says how old the list is", () => {
    expect(updatedAgoText(null, 1000)).toBe("Not loaded yet");
    expect(updatedAgoText(1000, 2000)).toBe("Updated just now");
    expect(updatedAgoText(0, 12_000)).toBe("Updated 12 s ago");
    expect(updatedAgoText(0, 180_000)).toBe("Updated 3 min ago");
  });

  it("offers going back a step on practice sessions only, one step at a time", () => {
    expect(showRevert({ kind: "practice" })).toBe(true);
    expect(showRevert({ kind: "real" })).toBe(false);
    expect(showRevert({ kind: "real" })).toBe(canRevert("crew", "real"));
    expect(previousState("registered")).toBeNull();
    expect(previousState("tagged")).toBe("registered");
    expect(previousState("checked_in")).toBe("tagged");
    expect(previousState("portrait_taken")).toBe("checked_in");
    expect(previousState("picked_up")).toBe("portrait_taken");
    expect(previousState("picked_up", false)).toBe("checked_in");
  });

  it("shows a sticker as its last four only, never a link", () => {
    expect(tagText("AB12")).toBe("Sticker ending AB12");
    expect(tagText(null)).toBe("No sticker yet");
    expect(tagText("AB12")).not.toMatch(/https?:/);
  });

  it("offers the verdict only after the name is shown, and Mark picked up only after a verdict", () => {
    expect(pickupControls(false, null)).toEqual({ showVerdictButtons: false, canMarkPickedUp: false });
    expect(pickupControls(true, null)).toEqual({ showVerdictButtons: true, canMarkPickedUp: false });
    expect(pickupControls(true, "matched").canMarkPickedUp).toBe(true);
    expect(pickupControls(true, "someone_else").canMarkPickedUp).toBe(true);
  });
});
