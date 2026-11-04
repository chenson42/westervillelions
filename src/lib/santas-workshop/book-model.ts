/**
 * Page model for the storybook (`/santas-workshop/c/[token]/book`). Pure: it reads
 * the approved collage view and nothing else. Scenes only, group pictures only; the
 * unscened "Other" pictures and every portrait stay on the collage (DECISION-128, T5).
 */
import type { CollageScene, CollageView } from "./collage-contract";

export interface BookPage {
  title: string;
  caption: string | null;
  /** Photo ids, in the order shown. */
  photoIds: string[];
  /** Ordinal of this page's first picture across the whole book (for unique alt text). */
  startIndex: number;
}

/** True when the book can be shown: live, with at least one scene. */
export function bookAvailable(view: Pick<CollageView, "state" | "scenes">): boolean {
  return view.state === "live" && view.scenes.length > 0;
}

export function bookPages(scenes: CollageScene[]): BookPage[] {
  let start = 0;
  const pages: BookPage[] = [];
  for (const s of scenes) {
    const photoIds = s.tiles.filter((t) => t.kind === "group").map((t) => t.id);
    if (photoIds.length === 0) continue;
    pages.push({ title: s.title, caption: s.caption, photoIds, startIndex: start });
    start += photoIds.length;
  }
  return pages;
}
