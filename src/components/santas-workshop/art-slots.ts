// The art-slot registry: the only place that knows slot facts. A slot renders
// as a labelled placeholder until its id is added to SUPPLIED below, after the
// file is placed at the slot's `path` under public/.
// Pure module (type-only import of screens would be circular-free, but the
// "used on" hrefs are plain strings checked by a test).

import { PREVIEW_BASE } from "./screens";

export type ArtSlotId =
  | "hero-scene"
  | "train"
  | "track-tile"
  | "scene-wrapping"
  | "scene-workshop"
  | "scene-cookies"
  | "scene-story"
  | "scene-reindeer"
  | "step-dropoff"
  | "step-journey"
  | "step-pickup"
  | "conductor-stamp"
  | "book-cover"
  | "stuffy-wrapping"
  | "stuffy-workshop"
  | "stuffy-cookies"
  | "stuffy-story"
  | "stuffy-reindeer";

export type ArtSlotKind = "scene" | "train" | "track" | "icon" | "stamp" | "portrait" | "stuffy";

export interface ArtSlotSpec {
  id: ArtSlotId;
  kind: ArtSlotKind;
  label: string;
  aspect: `${number}:${number}`;
  pixels: `${number}x${number}`;
  usedOn: readonly string[];
  notes: string;
  /** Where the supplied file goes. */
  path: string;
  /** null until the artist supplies the file; set to `path` to switch the slot on. */
  src: string | null;
  alt: string;
  decorative: boolean;
}

const DIR = "/images/santas-workshop";

/**
 * Slots whose file is in place. Put the file at the slot's `path` under
 * `public/`, add the slot id here, and the placeholder becomes the image.
 * Kept as a plain list so the artist edits one line and nothing else.
 */
export const SUPPLIED: ReadonlySet<ArtSlotId> = new Set<ArtSlotId>([
  // "hero-scene",
]);
const LANDING = PREVIEW_BASE;
const FOLLOW = `${PREVIEW_BASE}/follow`;
const BOOK = `${PREVIEW_BASE}/book`;
const CHECKIN = `${PREVIEW_BASE}/check-in`;
const CONFIRMED = `${PREVIEW_BASE}/confirmed`;
const PHOTO = `${PREVIEW_BASE}/photo-station`;

function scene(
  id: ArtSlotId,
  label: string,
  alt: string,
  notes: string,
): ArtSlotSpec {
  return {
    id,
    kind: "scene",
    label,
    aspect: "4:3",
    pixels: "1200x900",
    usedOn: [LANDING],
    notes,
    path: `${DIR}/${id}.webp`,
    src: null,
    alt,
    decorative: false,
  };
}

function stuffy(id: ArtSlotId, label: string, alt: string): ArtSlotSpec {
  return {
    id,
    kind: "stuffy",
    label,
    aspect: "4:3",
    pixels: "1200x900",
    usedOn: [FOLLOW, BOOK, PHOTO, LANDING],
    notes:
      "One recognizable plush (or a placeholder silhouette) in this scene. Stuffies only, no children in frame.",
    path: `${DIR}/${id}.webp`,
    src: null,
    alt,
    decorative: false,
  };
}

function step(id: ArtSlotId, label: string, alt: string): ArtSlotSpec {
  return {
    id,
    kind: "icon",
    label,
    aspect: "1:1",
    pixels: "256x256",
    usedOn: [LANDING],
    notes: "Simple SVG icon, works on a light card. Transparent background.",
    path: `${DIR}/${id}.svg`,
    src: null,
    alt,
    decorative: true,
  };
}

const RAW_SLOTS: readonly ArtSlotSpec[] = [
  {
    id: "hero-scene",
    kind: "scene",
    label: "Hero scene",
    aspect: "3:2",
    pixels: "2400x1600",
    usedOn: [LANDING],
    notes:
      "Night sky / winter town. Keep the focal subject in the center third: the page crops to about 4:5 on phones and 21:9 on wide screens.",
    path: `${DIR}/hero-scene.webp`,
    src: null,
    alt: "A snowy night with a little train heading toward the North Pole",
    decorative: false,
  },
  {
    id: "train",
    kind: "train",
    label: "Train (engine and cars)",
    aspect: "3:1",
    pixels: "900x300",
    usedOn: [LANDING, CONFIRMED],
    notes:
      "Side view, facing right, transparent background (SVG preferred). The page already draws a stand-in train; yours replaces it.",
    path: `${DIR}/train.svg`,
    src: null,
    alt: "A small steam train with three cars",
    decorative: true,
  },
  {
    id: "track-tile",
    kind: "track",
    label: "Track tile",
    aspect: "10:1",
    pixels: "1200x120",
    usedOn: [LANDING, FOLLOW],
    notes:
      "A seamless horizontal tile of rails and ties. The page draws a CSS track today; this is optional if you like that one.",
    path: `${DIR}/track-tile.svg`,
    src: null,
    alt: "",
    decorative: true,
  },
  scene(
    "scene-wrapping",
    "Scene: Mrs. Claus wrapping presents",
    "Mrs. Claus wrapping presents",
    "Illustration or photo of Mrs. Claus wrapping presents.",
  ),
  scene(
    "scene-workshop",
    "Scene: Santa in the workshop",
    "Santa building toys in the workshop",
    "Santa building toys at the workbench.",
  ),
  scene(
    "scene-cookies",
    "Scene: cookies",
    "A plate of cookies and a mug of cocoa",
    "A plate of cookies and cocoa.",
  ),
  scene(
    "scene-story",
    "Scene: The Night Before Christmas",
    "Santa reading The Night Before Christmas",
    "Santa reading The Night Before Christmas in an armchair.",
  ),
  scene(
    "scene-reindeer",
    "Scene: an elf feeding the reindeer",
    "An elf feeding the reindeer",
    "An elf feeding the reindeer.",
  ),
  step("step-dropoff", "Step icon: drop off", "Drop off"),
  step("step-journey", "Step icon: the journey", "The journey"),
  step("step-pickup", "Step icon: pickup", "Pickup"),
  {
    id: "conductor-stamp",
    kind: "stamp",
    label: "Conductor character / stamp",
    aspect: "1:1",
    pixels: "512x512",
    usedOn: [CONFIRMED, CHECKIN, FOLLOW, BOOK],
    notes: "Reused as the check-in badge and the certificate stamp. Transparent background.",
    path: `${DIR}/conductor-stamp.svg`,
    src: null,
    alt: "The Westerville Lions conductor",
    decorative: true,
  },
  {
    id: "book-cover",
    kind: "portrait",
    label: "Memory-book cover",
    aspect: "4:5",
    pixels: "1200x1500",
    usedOn: [BOOK],
    notes:
      "Reserve a name-plate area: about 70% of the width and 12% of the height, near the bottom. The stuffy's name is typed into it.",
    path: `${DIR}/book-cover.webp`,
    src: null,
    alt: "Cover of the memory book",
    decorative: false,
  },
  stuffy(
    "stuffy-wrapping",
    "Stuffy photo: wrapping room",
    "The stuffed animal in Mrs. Claus's wrapping room",
  ),
  stuffy(
    "stuffy-workshop",
    "Stuffy photo: workshop",
    "The stuffed animal in Santa's workshop",
  ),
  stuffy(
    "stuffy-cookies",
    "Stuffy photo: cookies",
    "The stuffed animal beside a plate of cookies",
  ),
  stuffy(
    "stuffy-story",
    "Stuffy photo: bedtime story",
    "The stuffed animal listening to the bedtime story",
  ),
  stuffy(
    "stuffy-reindeer",
    "Stuffy photo: reindeer",
    "The stuffed animal meeting the reindeer",
  ),
] as const;

export const ART_SLOTS: readonly ArtSlotSpec[] = RAW_SLOTS.map((s) =>
  SUPPLIED.has(s.id) ? { ...s, src: s.path } : s,
);

const BY_ID = new Map<ArtSlotId, ArtSlotSpec>(ART_SLOTS.map((s) => [s.id, s]));

export function getArtSlot(id: ArtSlotId): ArtSlotSpec {
  const slot = BY_ID.get(id);
  if (!slot) throw new Error(`Unknown art slot: ${id}`);
  return slot;
}

export function isArtSlotId(x: unknown): x is ArtSlotId {
  return typeof x === "string" && BY_ID.has(x as ArtSlotId);
}

/** "3:2" -> "3 / 2" for CSS aspect-ratio. */
export function aspectCss(aspect: string): string {
  return aspect.replace(":", " / ");
}
