// One source of truth for the event facts. Every date, window, price and cap
// shown anywhere in the prototype comes from here. ALL OF IT IS PROPOSED and
// will change; edit it here and every screen follows.

import type { ArtSlotId } from "./art-slots";

export const EVENT_TITLE = "A Visit to Santa's Workshop";
export const HOST_NAME = "Westerville Lions Club";
export const PRICE_DOLLARS = 15;
export const SPOT_CAP = 60;
export const MAX_PER_ORDER = 3;

export const EVENT_DATES = {
  dropoff: "2026-12-11",
  photos: "2026-12-12",
  pickup: "2026-12-13",
} as const;

export const REGISTRATION_OPENS = "2026-11-08";

export interface DropoffWindow {
  id: "fri-early" | "fri-late";
  label: string;
  /** 24h wall-clock "HH:mm" */
  start: string;
  end: string;
}

export const DROPOFF_WINDOWS: readonly DropoffWindow[] = [
  { id: "fri-early", label: "5:30 to 6:15 PM", start: "17:30", end: "18:15" },
  { id: "fri-late", label: "6:15 to 7:00 PM", start: "18:15", end: "19:00" },
];

export type DropoffWindowId = DropoffWindow["id"];

export const PICKUP_WINDOW = { label: "1:00 to 3:00 PM", start: "13:00", end: "15:00" } as const;

export const DROPOFF_PLACE = "IHOP";

export interface SceneDef {
  id: "wrapping" | "workshop" | "cookies" | "story" | "reindeer";
  title: string;
  blurb: string;
  sceneSlot: ArtSlotId;
  stuffySlot: ArtSlotId;
}

export const SCENES: readonly SceneDef[] = [
  {
    id: "wrapping",
    title: "Mrs. Claus's wrapping room",
    blurb: "Ribbons, bows and a very busy Mrs. Claus.",
    sceneSlot: "scene-wrapping",
    stuffySlot: "stuffy-wrapping",
  },
  {
    id: "workshop",
    title: "Santa's workshop",
    blurb: "Hammers, gears and a toy or two taking shape.",
    sceneSlot: "scene-workshop",
    stuffySlot: "stuffy-workshop",
  },
  {
    id: "cookies",
    title: "Cookies and cocoa",
    blurb: "A well-earned snack for a long trip.",
    sceneSlot: "scene-cookies",
    stuffySlot: "stuffy-cookies",
  },
  {
    id: "story",
    title: "The Night Before Christmas",
    blurb: "Santa reads the classic, one page at a time.",
    sceneSlot: "scene-story",
    stuffySlot: "stuffy-story",
  },
  {
    id: "reindeer",
    title: "Feeding the reindeer",
    blurb: "An elf shows your stuffy how it's done.",
    sceneSlot: "scene-reindeer",
    stuffySlot: "stuffy-reindeer",
  },
];

export type FormQuestionKind = "zeffy" | "text" | "select" | "textarea" | "checkbox";

export interface FormQuestion {
  id: string;
  label: string;
  kind: FormQuestionKind;
  required: boolean;
  helper?: string;
  options?: readonly string[];
}

// Confirm with the chair which of these belong on the Zeffy form.
export const FORM_QUESTIONS: readonly FormQuestion[] = [
  { id: "buyer", label: "Parent name and email", kind: "zeffy", required: true, helper: "Zeffy asks for these itself." },
  { id: "mobile", label: "Parent mobile", kind: "text", required: true, helper: "Only used if we need to reach you that weekend." },
  { id: "child-first", label: "Child's first name", kind: "text", required: true, helper: "First name only. It is never posted." },
  { id: "stuffy-name", label: "Stuffy's name", kind: "text", required: true },
  { id: "stuffy-kind", label: "What is your stuffy?", kind: "text", required: true, helper: "Type and color, like \"brown bear, red scarf\". It helps the conductor find it." },
  { id: "window", label: "Friday drop-off window", kind: "select", required: true, options: DROPOFF_WINDOWS.map((w) => w.label) },
  { id: "preschool", label: "Preschool", kind: "select", required: false, options: ["Sample Preschool A", "Sample Preschool B", "Other or none"] },
  { id: "care", label: "Care note", kind: "textarea", required: false, helper: "\"One loose eye, sleeps with a night-light.\" No medical details, no last names." },
  { id: "santa", label: "A note to Santa", kind: "textarea", required: false },
  { id: "ack", label: "The Lions will take great care of your stuffy, but cannot be responsible for loss or damage.", kind: "checkbox", required: true },
  { id: "photos", label: "OK to share stuffy-only photos on the club's social pages", kind: "checkbox", required: false },
];

// ---- Formatting (slice-based; nothing calls new Date(str) to render) ----

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** Weekday index (0 = Sunday) of a date-only ISO string. UTC arithmetic on the parts only. */
export function weekdayIndex(iso: string): number {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Friday, Dec 11" */
export function formatLongDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${WEEKDAYS[weekdayIndex(iso)]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Fri, Dec 11" */
export function formatShortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${WEEKDAYS[weekdayIndex(iso)].slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

/** "Dec 11 to 13" */
export function formatDateRange(): string {
  const a = parts(EVENT_DATES.dropoff);
  const b = parts(EVENT_DATES.pickup);
  return `${MONTHS[a.m - 1]} ${a.d} to ${b.d}`;
}

export function windowLabel(id: DropoffWindowId): string {
  return DROPOFF_WINDOWS.find((w) => w.id === id)?.label ?? "";
}
