// The art registry: the only place that knows slot facts. Every slot is
// optional. A slot renders its image only after its file is placed at `path`
// under public/ and its id is added to SUPPLIED below; otherwise it renders
// nothing and the layout collapses around it (the page ships finished with no
// art at all). Pure module. Artist brief: the Phase 3 work-log, Appendix E.

export type ArtSlotId =
  | "hero-scene"
  | "train"
  | "track-tile"
  | "step-dropoff"
  | "step-photos"
  | "step-pickup"
  | "story-art"
  | "og";

export interface ArtSlotSpec {
  id: ArtSlotId;
  label: string;
  aspect: `${number}:${number}`;
  pixels: `${number}x${number}`;
  notes: string;
  /** Where the supplied file goes. */
  path: string;
  /** null until the file is supplied; set to `path` to switch the slot on. */
  src: string | null;
  alt: string;
  decorative: boolean;
}

const DIR = "/images/santas-workshop";

/**
 * Slots whose file is in place. Put the file at the slot's `path` under
 * `public/`, then add the slot id here. A unit test fails if a listed file
 * is missing.
 */
export const SUPPLIED: ReadonlySet<ArtSlotId> = new Set<ArtSlotId>([
  "hero-scene",
  "train",
  "track-tile",
  "step-dropoff",
  "step-photos",
  "step-pickup",
  "story-art",
  "og",
]);

function icon(id: ArtSlotId, label: string): ArtSlotSpec {
  return {
    id,
    label,
    aspect: "1:1",
    pixels: "256x256",
    notes: "Simple icon, works on a light card. Transparent PNG (SVG also accepted).",
    path: `${DIR}/${id}.png`,
    src: null,
    alt: "",
    decorative: true,
  };
}

const RAW_SLOTS: readonly ArtSlotSpec[] = [
  {
    id: "hero-scene",
    label: "Hero scene",
    aspect: "3:2",
    pixels: "2400x1600",
    notes:
      "Night sky or winter town. Keep the focal subject in the center third: the page crops to about 4:5 on phones and 21:9 on wide screens. Stuffies only, no children in frame.",
    path: `${DIR}/hero-scene.webp`,
    src: null,
    alt: "A snowy night with a little train heading toward the North Pole",
    decorative: false,
  },
  {
    id: "train",
    label: "Train (engine and cars)",
    aspect: "3:1",
    pixels: "900x300",
    notes: "Side view, facing right, transparent background (SVG preferred). Replaces the drawn train.",
    path: `${DIR}/train.png`,
    src: null,
    alt: "A small steam train with three cars",
    decorative: true,
  },
  {
    id: "track-tile",
    label: "Track tile",
    aspect: "10:1",
    pixels: "1200x120",
    notes: "A seamless horizontal tile of rails and ties. Optional; the page draws a CSS track.",
    path: `${DIR}/track-tile.png`,
    src: null,
    alt: "",
    decorative: true,
  },
  icon("step-dropoff", "Step icon: drop off"),
  icon("step-photos", "Step icon: photo day"),
  icon("step-pickup", "Step icon: pickup"),
  {
    id: "story-art",
    label: "Story art",
    aspect: "1:1",
    pixels: "512x512",
    notes: "A friendly character or emblem beside the story. Transparent background.",
    path: `${DIR}/story-art.png`,
    src: null,
    alt: "",
    decorative: true,
  },
  {
    id: "og",
    label: "Open Graph card",
    aspect: "40:21",
    pixels: "1200x630",
    notes: "Social share card. Falls back to the site default when absent.",
    path: `${DIR}/og.jpg`,
    src: null,
    alt: "A Visit to Santa's Workshop, from the Westerville Lions Club",
    decorative: false,
  },
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

export function isSupplied(id: ArtSlotId): boolean {
  return getArtSlot(id).src !== null;
}

/** "3:2" -> "3 / 2" for CSS aspect-ratio. */
export function aspectCss(aspect: string): string {
  return aspect.replace(":", " / ");
}
