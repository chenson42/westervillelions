// The page state is a pure function of the Eastern calendar date. Full
// "YYYY-MM-DD" strings (year included) are compared as strings: never
// new Date(str), never a UTC comparison.

import { easternDateString } from "@/lib/eastern-date";
import type { WorkshopFacts } from "./facts";

export const WORKSHOP_STATES = ["before", "open", "closed", "after"] as const;
export type WorkshopState = (typeof WORKSHOP_STATES)[number];

export type FocusDay = "dropoff" | "photos" | "pickup";

export function workshopState(now: Date, facts: WorkshopFacts): WorkshopState {
  const d = easternDateString(now);
  if (d > facts.dates.pickup) return "after";
  if (d > facts.lastSignupDay) return "closed";
  if (d < facts.registrationOpens) return "before";
  return "open";
}

/** Which event day (Eastern) it is right now, if any. */
export function focusDay(now: Date, facts: WorkshopFacts): FocusDay | null {
  const d = easternDateString(now);
  if (d === facts.dates.dropoff) return "dropoff";
  if (d === facts.dates.photos) return "photos";
  if (d === facts.dates.pickup) return "pickup";
  return null;
}
