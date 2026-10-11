// Pure journey model for the "follow your stuffy" screen.

import type { ArtSlotId } from "./art-slots";
import { SAMPLE_JOURNEY_STUFFY, type SampleStuffy } from "./sample-data";

export type JourneyStopId =
  | "checked-in"
  | "boarded"
  | "arrived"
  | "wrapping"
  | "workshop"
  | "cookies"
  | "story"
  | "reindeer"
  | "ready";

export type JourneyPlace = "ihop" | "train" | "north-pole";
export type StopStatus = "done" | "current" | "upcoming";

export interface JourneyStop {
  id: JourneyStopId;
  order: number;
  title: string;
  place: JourneyPlace;
  /** Wall-clock "YYYY-MM-DDTHH:mm", no zone. Never passed to new Date() for display. */
  at: string;
  photoSlot: ArtSlotId | null;
  caption: string;
}

export interface Journey {
  stuffy: SampleStuffy;
  stops: readonly JourneyStop[];
  updatedAt: string;
}

export const JOURNEY_STOPS: readonly JourneyStop[] = [
  { id: "checked-in", order: 0, title: "Checked in with the conductor", place: "ihop", at: "2026-12-11T18:20", photoSlot: null, caption: "The conductor stamped the ticket and tucked Pip in." },
  { id: "boarded", order: 1, title: "Boarded the train", place: "train", at: "2026-12-11T19:05", photoSlot: null, caption: "All aboard! The whistle blew and the snow began to fall." },
  { id: "arrived", order: 2, title: "Arrived at the North Pole", place: "north-pole", at: "2026-12-12T08:30", photoSlot: null, caption: "Pip woke up to lanterns, snow and the smell of gingerbread." },
  { id: "wrapping", order: 3, title: "Mrs. Claus's wrapping room", place: "north-pole", at: "2026-12-12T10:15", photoSlot: "stuffy-wrapping", caption: "Helping with ribbons and bows." },
  { id: "workshop", order: 4, title: "Santa's workshop", place: "north-pole", at: "2026-12-12T11:00", photoSlot: "stuffy-workshop", caption: "Learning how toys are made." },
  { id: "cookies", order: 5, title: "Cookies and cocoa", place: "north-pole", at: "2026-12-12T12:30", photoSlot: "stuffy-cookies", caption: "A snack break, with extra sprinkles." },
  { id: "story", order: 6, title: "The Night Before Christmas", place: "north-pole", at: "2026-12-12T14:00", photoSlot: "stuffy-story", caption: "Story time with Santa." },
  { id: "reindeer", order: 7, title: "Feeding the reindeer", place: "north-pole", at: "2026-12-12T15:15", photoSlot: "stuffy-reindeer", caption: "Carrots for everyone." },
  { id: "ready", order: 8, title: "Ready for pickup", place: "ihop", at: "2026-12-13T13:00", photoSlot: null, caption: "Back at IHOP with a memory book to share." },
];

export const SAMPLE_JOURNEY: Journey = {
  stuffy: SAMPLE_JOURNEY_STUFFY,
  stops: JOURNEY_STOPS,
  updatedAt: "2026-12-12T11:42",
};

export function stopStatus(stop: JourneyStop, currentOrder: number): StopStatus {
  if (stop.order < currentOrder) return "done";
  if (stop.order === currentOrder) return "current";
  return "upcoming";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-12-11T18:20" -> "Fri 6:20 PM". Slice-based; independent of the machine's time zone. */
export function formatWallClock(at: string): string {
  const y = Number(at.slice(0, 4));
  const m = Number(at.slice(5, 7));
  const d = Number(at.slice(8, 10));
  const hh = Number(at.slice(11, 13));
  const mm = at.slice(14, 16);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} ${h12}:${mm} ${hh < 12 ? "AM" : "PM"}`;
}
