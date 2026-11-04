import { Art } from "../art";
import type { ArtSlotId } from "../art-slots";
import { TrainMotif } from "../train-motif";

/**
 * Decorative picture-book art for the public collage, reusing the sign-up page's slots.
 * Every piece is empty-alt and hidden in print (`sw-noprint`), so the printable family
 * page and a printed collage are unchanged. Server components, no client JS.
 */

/** The little train on its track along the foot of the blue header. */
export function CollageHeaderTrain() {
  return (
    <div className="sw-noprint pt-2" data-testid="collage-header-train">
      <TrainMotif tone="night" />
    </div>
  );
}

/** The train on its track above the footer text. */
export function CollageFooterTrain() {
  return (
    <div className="sw-noprint mt-12" data-testid="collage-footer-train">
      <TrainMotif tone="light" />
    </div>
  );
}

/** A small picture-book icon above a state message (collapses if the file is not supplied). */
export function CollageStateArt({ id }: { id: Extract<ArtSlotId, "step-photos" | "step-pickup" | "story-art"> }) {
  return (
    <div className="sw-noprint mx-auto mb-4 w-24 empty:hidden sm:w-28" aria-hidden="true">
      <Art id={id} sizes="112px" />
    </div>
  );
}
