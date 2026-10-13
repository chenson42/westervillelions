/**
 * CARRIER for the FAMILY page (`/santas-workshop/f/[token]`). Client-safe: no
 * database, server-only or Node imports. A family reaches the page by scanning
 * the QR on the worker's phone at pickup; the 128-bit token is the whole
 * credential. The DTO is the smallest thing that can draw the page: the stuffy's
 * own name, the state, and whether its portrait can be shown. It carries NO
 * parent or child data, no contact detail, no note, no sticker code and no
 * storage key (family-contract-no-contact.test.ts scans it and the query).
 *
 * The check-in photo (the condition record) never appears here. The family sees
 * its own current, unhidden portrait whatever the photo-sharing choice was: that
 * choice governs only the public collage.
 */

/**
 * The COLLAGE's state as the family sees it (S5-D1). The portrait is independent of it: a family sees its
 * own current, unhidden portrait from the moment it exists, even while the collage is `pending`.
 * pending: not published yet. live: published. removed: the public purge has run (the portrait is gone too).
 */
export const FAMILY_COLLAGE_STATES = ["pending", "live", "removed"] as const;
export type FamilyCollageState = (typeof FAMILY_COLLAGE_STATES)[number];

/**
 * none: no portrait was taken (yet). unavailable: one exists but an admin withheld it ("This photo isn't available").
 * available: show it; `version` is the photo id, used only to change the image URL after a retake.
 */
export const FAMILY_PORTRAIT_STATES = ["none", "unavailable", "available"] as const;
export type FamilyPortraitState = (typeof FAMILY_PORTRAIT_STATES)[number];

export type FamilyPortrait = { state: "none" } | { state: "unavailable" } | { state: "available"; version: string };

export interface FamilyView {
  collage: FamilyCollageState;
  /** Practice sessions show a PRACTICE banner. */
  practice: boolean;
  /** The stuffy's own name as registered; null when it was never given. */
  stuffyName: string | null;
  /** collage pending only: the Eastern calendar day ("YYYY-MM-DD") the photos are expected. Null otherwise. */
  arrivesOn: string | null;
  /** Present whenever the portrait exists and is not hidden, whatever the collage state; always none when removed. */
  portrait: FamilyPortrait;
  /** collage live only: the same-origin path of the collage ("anyone with the link" page). Null while pending or removed. */
  collagePath: string | null;
}

/** An unknown, malformed or withdrawn token is `null` from getFamilyView(): the page answers one identical 404. */
export type FamilyLookup = FamilyView | null;

/** The family portrait door. Same-origin; `download` sends it as an attachment with a neutral file name. */
export function familyPortraitPath(token: string, variant: "thumb" | "full", options: { download?: boolean; version?: string } = {}): string {
  const q = new URLSearchParams({ v: variant });
  if (options.download) q.set("download", "1");
  if (options.version) q.set("p", options.version);
  return `/api/santas-workshop/family/${token}/portrait?${q.toString()}`;
}
