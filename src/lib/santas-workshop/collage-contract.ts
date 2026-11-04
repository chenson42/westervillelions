/**
 * CARRIER for the PUBLIC collage (`/santas-workshop/c/[token]`). Client-safe: no
 * database, server-only or Node imports. The collage is "anyone with the link", so
 * this DTO is deliberately the smallest thing that can draw the page: a photo id and
 * a kind per tile, plus, per storyline scene that has a visible picture, its
 * admin-typed title and caption (plain text, rendered as text nodes; DECISION-128).
 * It carries NO stuffy name, no child or parent data, no per-family count, no scene
 * id and no storage key (collage-contract-no-pii.test.ts scans it).
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

/** A storyline scene with at least one approved group picture. Exactly these three fields; no id. */
export interface CollageScene {
  title: string;
  caption: string | null;
  tiles: CollageTile[];
}

export interface CollageView {
  state: CollageState;
  /** Practice sessions show a PRACTICE banner. */
  practice: boolean;
  /** pending only: the Eastern calendar day ("YYYY-MM-DD") the photos are expected. Null otherwise. */
  arrivesOn: string | null;
  /** live only: scenes that have a visible group picture, in storyline order. Empty when there is no storyline, and always empty unless live. */
  scenes: CollageScene[];
  /** live only: everything NOT in a scene: unscened group pictures first (taken order), then consented portraits (taken order). Empty otherwise. */
  tiles: CollageTile[];
}

/** An unknown, malformed or otherwise unavailable token is `null` from getCollage(): the page answers one identical 404. */
export type CollageLookup = CollageView | null;

export function collagePhotoPath(photoId: string, variant: "thumb" | "full"): string {
  return `/api/santas-workshop/photos/${photoId}?v=${variant}`;
}
