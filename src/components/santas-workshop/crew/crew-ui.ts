/**
 * Pure presentation logic for the crew app: labels, roster filtering, the next
 * step for a stuffy, what a scan result means, and small formatters. No React,
 * no fetch. Types and vocabularies come from crew-contract.ts.
 */

import type { CrewRosterRow, CrewSessionSummary, ScanResult, StuffyState } from "@/lib/santas-workshop/crew-contract";
import { canRevert } from "@/lib/santas-workshop/state-machine";

export function crewDisplayName(name: string | null, orderSize: number): string {
  return name && name.trim() ? name : `Unnamed stuffy, order of ${orderSize}`;
}

export const CREW_STATE_LABELS: Record<StuffyState, string> = {
  registered: "To tag",
  tagged: "Tagged",
  checked_in: "Checked in",
  portrait_taken: "Portrait done",
  picked_up: "Picked up",
};

export const ROSTER_FILTERS = ["all", "registered", "tagged", "checked_in", "portrait_taken", "picked_up"] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const ROSTER_FILTER_LABELS: Record<RosterFilter, string> = {
  all: "All",
  registered: CREW_STATE_LABELS.registered,
  tagged: CREW_STATE_LABELS.tagged,
  checked_in: CREW_STATE_LABELS.checked_in,
  portrait_taken: CREW_STATE_LABELS.portrait_taken,
  picked_up: CREW_STATE_LABELS.picked_up,
};

/** Name, description and the last four of the sticker, case-insensitive. The parent's name is never on a row. */
export function rowMatchesQuery(row: CrewRosterRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [crewDisplayName(row.name, row.orderSize), row.description ?? "", row.last4 ?? ""].join(" ").toLowerCase();
  return hay.includes(needle);
}

/**
 * Applies the state filter and the search. `serverMatches` are rows the server found by
 * family name (it returns the stuffy, never the parent name); they are kept when they also
 * pass the state filter, even though the typed text is not in their own fields.
 */
export function filterRoster(
  rows: readonly CrewRosterRow[],
  options: { query: string; filter: RosterFilter; serverMatches?: readonly CrewRosterRow[] },
): CrewRosterRow[] {
  const byFilter = (r: CrewRosterRow) => options.filter === "all" || r.state === options.filter;
  const query = options.query.trim();
  if (!query) return rows.filter(byFilter);
  const serverIds = new Set((options.serverMatches ?? []).map((r) => r.id));
  return rows.filter((r) => byFilter(r) && (rowMatchesQuery(r, query) || serverIds.has(r.id)));
}

export type StepScreen = "tag" | "checkin" | "portrait" | "pickup" | "done";

/** The screen a stuffy opens on, and the label of the big button on its roster row. */
export function nextStep(state: StuffyState): { screen: StepScreen; label: string } {
  switch (state) {
    case "registered":
      return { screen: "tag", label: "Tag it" };
    case "tagged":
      return { screen: "checkin", label: "Check in" };
    case "checked_in":
      return { screen: "portrait", label: "Portrait" };
    case "portrait_taken":
      return { screen: "pickup", label: "Hand over" };
    case "picked_up":
      return { screen: "done", label: "Picked up" };
    default: {
      const never: never = state;
      return { screen: "done", label: String(never) };
    }
  }
}

export type ScanDirective =
  | { kind: "open"; row: CrewRosterRow }
  | { kind: "not_tagged"; message: string }
  | { kind: "retired"; message: string }
  | { kind: "withdrawn"; message: string };

/** What a scan result means for the screen. Exhaustive: a new result breaks `tsc`. */
export function describeScan(result: ScanResult): ScanDirective {
  switch (result.result) {
    case "found":
      return { kind: "open", row: result.stuffy };
    case "not_tagged":
      return { kind: "not_tagged", message: "This sticker isn't on a stuffy yet." };
    case "retired":
      return { kind: "retired", message: "This sticker was replaced by a newer one. Use the stuffy's new sticker, or find it by name." };
    case "withdrawn":
      return { kind: "withdrawn", message: "This registration was withdrawn. Ask the event chair before going on." };
    default: {
      const never: never = result;
      return { kind: "withdrawn", message: String(never) };
    }
  }
}

export function windowLabelFor(session: Pick<CrewSessionSummary, "windows">, windowId: string | null): string | null {
  if (!windowId) return null;
  return session.windows.find((w) => w.id === windowId)?.label ?? null;
}

/** "Updated 12 s ago" / "Updated 3 min ago". */
export function updatedAgoText(lastMs: number | null, nowMs: number): string {
  if (lastMs === null) return "Not loaded yet";
  const s = Math.max(0, Math.round((nowMs - lastMs) / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return `Updated ${s} s ago`;
  return `Updated ${Math.floor(s / 60)} min ago`;
}

/** The practice-only "go back a step" control: shown only on a practice session. */
export function showRevert(session: Pick<CrewSessionSummary, "kind">): boolean {
  return canRevert("crew", session.kind);
}

/** The step a revert goes back to (one step, never past `registered`; a pickup with no portrait goes back to checked in). */
export function previousState(state: StuffyState, hasPortrait: boolean = true): StuffyState | null {
  switch (state) {
    case "registered":
      return null;
    case "tagged":
      return "registered";
    case "checked_in":
      return "tagged";
    case "portrait_taken":
      return "checked_in";
    case "picked_up":
      return hasPortrait ? "portrait_taken" : "checked_in";
    default: {
      const never: never = state;
      return String(never) as StuffyState;
    }
  }
}

/** A sticker shows as its last four characters only; never a link. */
export function tagText(last4: string | null): string {
  return last4 ? `Sticker ending ${last4}` : "No sticker yet";
}

export type PickupVerdict = "matched" | "someone_else" | null;

/** What the pickup panel offers: the verdict buttons only once the name is on screen, and Mark picked up only after a verdict was recorded. */
export function pickupControls(nameShown: boolean, verdict: PickupVerdict): { showVerdictButtons: boolean; canMarkPickedUp: boolean } {
  return { showVerdictButtons: nameShown, canMarkPickedUp: nameShown && verdict !== null };
}
