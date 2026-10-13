/**
 * Pure, client-safe logic behind the collage: the admin photos page and the public
 * page. No React, no db, no fetch. Types come from the two carriers, never redefined.
 * The public strings live here so one test can scan them for registrant text.
 */

import type { AdminPhotoDto, CollageAdminInfo, PhotoCounts } from "./admin-contract";
import { formatLongDate } from "./format";

/** Every sentence the public collage prints. None of it comes from a registrant. */
export const COLLAGE_COPY = {
  siteName: "Westerville Lions Club",
  title: "Santa's Workshop photos",
  stuffiesOnly: "We photograph stuffies only, never children.",
  removalLead: "Changed your mind, or see someone who should not be in a picture? Email",
  removalTail: "and we will take it down.",
  removalLink: "Or use the contact form",
  removed: "These photos have been removed",
  removedBody: "The Westerville Lions Club has taken this collage down. Thank you for joining us.",
  groupHeading: "Group pictures",
  portraitHeading: "Stuffy portraits",
  emptyLive: "No photos have been added yet. Please check back soon.",
  practice: "PRACTICE collage: sample photos only",
  tileMissing: "Photo not available right now",
  close: "Close",
} as const;

export const COLLAGE_REMOVAL_HREF = "/connect";

/** "The photos arrive on Saturday, Dec 19" (the photo day, in the evening). */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True when the photo day (an Eastern "YYYY-MM-DD") is before today (also Eastern). A past date is never shown. */
export function photoDayPassed(arrivesOn: string | null, todayEastern: string): boolean {
  return arrivesOn !== null && ISO_DAY.test(arrivesOn) && ISO_DAY.test(todayEastern) && arrivesOn < todayEastern;
}

export function pendingHeadline(arrivesOn: string | null, todayEastern?: string): string {
  if (todayEastern && photoDayPassed(arrivesOn, todayEastern)) return "The photos are being prepared";
  return arrivesOn && ISO_DAY.test(arrivesOn) ? `The photos arrive on ${formatLongDate(arrivesOn)}` : "The photos are not here yet";
}

export function pendingBody(arrivesOn: string | null, todayEastern?: string): string {
  if (todayEastern && photoDayPassed(arrivesOn, todayEastern)) return "They will be right here soon. Please check back.";
  return arrivesOn ? "Check back in the evening. The stuffy pictures will be right here." : "Check back soon. The stuffy pictures will be right here.";
}

/** Shown after an un-hide when the server says the picture is not public until the next publish. */
export const UNHIDE_NEEDS_PUBLISH = "This picture returns to the collage when you press Publish late photos.";

/** "N pictures taken since the last publish are not yet public." */
export function latePicturesSentence(n: number): string {
  return `${n} ${n === 1 ? "picture" : "pictures"} taken since the last publish ${n === 1 ? "is" : "are"} not yet public.`;
}

/** What the admin is told to look for while reviewing group pictures. */
export const REVIEW_INSTRUCTION = "Hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies.";

/** The sentence shown when Publish is refused, with the count the server reported. */
export function publishRefusedText(count?: number): string {
  const lead =
    typeof count === "number" && count > 0
      ? `${count} group photo${count === 1 ? " has" : "s have"} not been reviewed yet.`
      : "Some group photos have not been reviewed yet.";
  return `${lead} Look through them (hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies), mark them reviewed, then publish.`;
}

/** The QR code encodes exactly the server's payload, byte for byte (the frame slice reuses it). */
export function qrText(collage: Pick<CollageAdminInfo, "qrPayload">): string {
  return collage.qrPayload;
}

/** Why "Mark group photos reviewed" is unavailable, or null when it can run. */
export function reviewDisabledReason(counts: Pick<PhotoCounts, "groupUnreviewed" | "newestGroupPhotoId">): string | null {
  if (counts.newestGroupPhotoId === null) return "There are no group photos to review yet.";
  if (counts.groupUnreviewed === 0) return "Every group photo has been reviewed.";
  return null;
}

/** A one-line status above the Publish control. */
export function publishStatusLine(collage: Pick<CollageAdminInfo, "published">, counts: Pick<PhotoCounts, "groupUnreviewed">): string {
  if (collage.published) return "The collage is live. Anyone with the link can see it.";
  if (counts.groupUnreviewed > 0) return publishRefusedText(counts.groupUnreviewed);
  return "Not published. The link shows \"The photos arrive on\" until you publish.";
}

export interface PhotoMarkers {
  hidden: boolean;
  /** Portraits only. */
  consentLabel: string | null;
  consentTone: "green" | "amber" | null;
  /** Group photos only. */
  reviewLabel: string | null;
  /** "Visible to a stranger" marker. */
  visibleLabel: string | null;
}

export function photoMarkers(photo: Pick<AdminPhotoDto, "kind" | "hidden" | "consent" | "reviewed" | "onCollage">): PhotoMarkers {
  const portrait = photo.kind === "portrait";
  return {
    hidden: photo.hidden,
    consentLabel: portrait ? (photo.consent ? "On the collage: family agreed" : "Not on the collage: no consent") : null,
    consentTone: portrait ? (photo.consent ? "green" : "amber") : null,
    reviewLabel: !portrait && photo.reviewed !== null ? (photo.reviewed ? "Reviewed" : "Not reviewed yet") : null,
    visibleLabel: photo.onCollage ? "Visible to anyone with the link" : null,
  };
}

/** Alt text for an admin tile. Portraits name the stuffy (admin-only surface); group photos are described. */
export function adminTileAlt(photo: Pick<AdminPhotoDto, "kind" | "stuffyName">, index: number): string {
  return photo.kind === "portrait" ? `Portrait of ${photo.stuffyName ?? "a stuffy"}` : `Group photo ${index + 1}`;
}

/** Alt text on the PUBLIC page: never a name. */
export function publicTileAlt(kind: "group" | "portrait", index: number): string {
  return kind === "group" ? `Group picture ${index + 1}` : `Stuffy portrait ${index + 1}`;
}
