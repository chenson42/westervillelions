/**
 * Pure, client-safe copy and view logic for the family page
 * (`/santas-workshop/f/[token]`). No React, no db. Every sentence the page
 * prints is here so one test can scan it; the only registrant-supplied text on
 * the page is the stuffy's own name, passed in separately and never stored here.
 */

import type { FamilyView } from "./family-contract";
import { CAPTION_LINES } from "./frame-layout";
import { COLLAGE_COPY, pendingBody, pendingHeadline } from "./collage-ui";

export const FAMILY_COPY = {
  title: "Your stuffy's photo page",
  fallbackName: "Your stuffy",
  portraitOnItsWay: "Your stuffy's portrait is on its way",
  portraitOnItsWayBody: "It will appear here as soon as the photos are ready.",
  portraitUnavailable: "This photo isn't available",
  portraitUnavailableBody: "The club has set this picture aside. Please ask a member of the crew.",
  portraitMissing: "Photo not available right now",
  download: "Save this portrait",
  print: "Print this page",
  collageLink: "See the whole day's photos",
  collageLead: "Group pictures and stuffy portraits from the day.",
  practice: "PRACTICE page: sample photos only",
  removed: "These photos have been removed",
  removedBody: "The Westerville Lions Club has taken these photos down. Thank you for joining us.",
  printScan: CAPTION_LINES[0],
  printSite: CAPTION_LINES[1],
} as const;

export type FamilyBlock =
  | { kind: "portrait"; version: string }
  | { kind: "message"; headline: string; body: string };

export type FamilyCollage = { kind: "link"; path: string } | { kind: "note"; headline: string; body: string } | { kind: "none" };

export interface FamilyModel {
  heading: string;
  practice: boolean;
  block: FamilyBlock;
  collage: FamilyCollage;
}

function portraitBlock(view: FamilyView): FamilyBlock {
  switch (view.portrait.state) {
    case "available":
      return { kind: "portrait", version: view.portrait.version };
    case "unavailable":
      return { kind: "message", headline: FAMILY_COPY.portraitUnavailable, body: FAMILY_COPY.portraitUnavailableBody };
    case "none":
      return { kind: "message", headline: FAMILY_COPY.portraitOnItsWay, body: FAMILY_COPY.portraitOnItsWayBody };
    default: {
      const never: never = view.portrait;
      return never;
    }
  }
}

/**
 * What the page shows for a view (S5-D1). The portrait follows the portrait state alone; only the
 * collage link follows the collage state. `todayEastern` only picks the wording of the pending note.
 */
export function familyModel(view: FamilyView, todayEastern: string): FamilyModel {
  const heading = view.stuffyName?.trim() || FAMILY_COPY.fallbackName;
  const base = { heading, practice: view.practice };
  switch (view.collage) {
    case "removed":
      return { ...base, block: { kind: "message", headline: FAMILY_COPY.removed, body: FAMILY_COPY.removedBody }, collage: { kind: "none" } };
    case "pending":
      return {
        ...base,
        block: portraitBlock(view),
        collage: { kind: "note", headline: pendingHeadline(view.arrivesOn, todayEastern), body: pendingBody(view.arrivesOn, todayEastern) },
      };
    case "live":
      return { ...base, block: portraitBlock(view), collage: view.collagePath ? { kind: "link", path: view.collagePath } : { kind: "none" } };
    default: {
      const never: never = view.collage;
      return never;
    }
  }
}

/** The fixed lines under every state. */
export const FAMILY_FOOTER = { stuffiesOnly: COLLAGE_COPY.stuffiesOnly, removalLead: COLLAGE_COPY.removalLead, removalTail: COLLAGE_COPY.removalTail } as const;
