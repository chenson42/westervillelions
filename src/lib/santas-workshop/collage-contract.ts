/**
 * CARRIER for the PUBLIC collage (`/santas-workshop/c/[token]`). Client-safe: no
 * database, server-only or Node imports. The collage is "anyone with the link", so
 * this DTO is deliberately the smallest thing that can draw the page: photo ids and
 * a kind. It carries NO stuffy name, no caption, no child or parent data, no
 * per-family count and no storage key (collage-contract-no-pii.test.ts scans it).
 * Images are fetched through the photo door by id, never by a storage address.
 */

export const COLLAGE_STATES = ["pending", "removed", "live"] as const;
export type CollageState = (typeof COLLAGE_STATES)[number];

export const COLLAGE_TILE_KINDS = ["group", "portrait"] as const;
export type CollageTileKind = (typeof COLLAGE_TILE_KINDS)[number];

export interface CollageTile {
  /** The photo id; the image is `collagePhotoPath(id, variant)`. */
  id: string;
  kind: CollageTileKind;
}

export interface CollageView {
  state: CollageState;
  /** Practice sessions show a PRACTICE banner. */
  practice: boolean;
  /** pending only: the Eastern calendar day ("YYYY-MM-DD") the photos are expected. Null otherwise. */
  arrivesOn: string | null;
  /** live only: group photos first (taken order), then consented portraits (taken order). Empty otherwise. */
  tiles: CollageTile[];
}

/** An unknown, malformed or otherwise unavailable token is `null` from getCollage(): the page answers one identical 404. */
export type CollageLookup = CollageView | null;

export function collagePhotoPath(photoId: string, variant: "thumb" | "full"): string {
  return `/api/santas-workshop/photos/${photoId}?v=${variant}`;
}
