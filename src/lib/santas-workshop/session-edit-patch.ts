/**
 * Pure logic for the session edit form: which fields changed (the PATCH sends
 * only those, so a second admin's unrelated edit is never overwritten), window
 * id handling, and the "Recalculate" proposal. Client-safe. `kind` and `slug`
 * are not part of the editable state at all, so they can never be sent.
 */

import type { SessionDto, SessionWindow, UpdateSessionRequest } from "./admin-contract";
import { defaultCrewClosesOn, defaultRetention } from "./session-input";

export interface EditableSession {
  name: string;
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  windows: SessionWindow[];
  crewClosesOn: string;
  purgePersonalOn: string;
  purgePublicOn: string;
}

export function editableOf(s: SessionDto): EditableSession {
  return {
    name: s.name,
    dropoffDate: s.dropoffDate,
    photoDate: s.photoDate,
    pickupDate: s.pickupDate,
    windows: s.windows.map((w) => ({ ...w })),
    crewClosesOn: s.crewClosesOn,
    purgePersonalOn: s.purgePersonalOn,
    purgePublicOn: s.purgePublicOn,
  };
}

export function windowsEqual(a: readonly SessionWindow[], b: readonly SessionWindow[]): boolean {
  return a.length === b.length && a.every((w, i) => w.id === b[i].id && w.label === b[i].label && w.start === b[i].start && w.end === b[i].end);
}

const SCALARS = ["name", "dropoffDate", "photoDate", "pickupDate", "crewClosesOn", "purgePersonalOn", "purgePublicOn"] as const;

/** Only the fields that differ from `original`. An empty object means nothing to save. */
export function buildSessionPatch(original: EditableSession, form: EditableSession): UpdateSessionRequest {
  const patch: UpdateSessionRequest = {};
  for (const key of SCALARS) {
    const next = key === "name" ? form.name.trim() : form[key];
    if (next !== original[key]) patch[key] = next;
  }
  if (!windowsEqual(original.windows, form.windows)) patch.windows = form.windows.map((w) => ({ ...w, label: w.label.trim() }));
  return patch;
}

/** Ids of windows present in the original but gone from the form. */
export function removedWindowIds(original: EditableSession, form: EditableSession): string[] {
  const keep = new Set(form.windows.map((w) => w.id));
  return original.windows.filter((w) => !keep.has(w.id)).map((w) => w.id);
}

/** True when any surviving window's label differs from the original (existing registrants then need Remap). */
export function labelsChanged(original: EditableSession, form: EditableSession): boolean {
  const before = new Map(original.windows.map((w) => [w.id, w.label.trim()]));
  return form.windows.some((w) => before.has(w.id) && before.get(w.id) !== w.label.trim()) || removedWindowIds(original, form).length > 0;
}

/** A fresh id that no current window uses. Existing ids are never re-keyed. */
export function newWindowId(windows: readonly SessionWindow[]): string {
  let n = windows.length + 1;
  while (windows.some((w) => w.id === `window-${n}`)) n += 1;
  return `window-${n}`;
}

/** Worker-access and removal dates proposed from the pickup day, for the admin to review. */
export function recalculateFromPickup(pickupDate: string): Pick<EditableSession, "crewClosesOn" | "purgePersonalOn" | "purgePublicOn"> {
  return { crewClosesOn: defaultCrewClosesOn(pickupDate), ...defaultRetention(pickupDate) };
}
