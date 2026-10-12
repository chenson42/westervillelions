import Image from "next/image";
import { aspectCss, getArtSlot, type ArtSlotId } from "./art-slots";

interface ArtProps {
  id: ArtSlotId;
  className?: string;
  /** Tailwind aspect/crop classes that replace the registry aspect (hero crops). */
  crop?: string;
  sizes?: string;
  priority?: boolean;
}

/** Renders the slot's image, or nothing when the file has not been supplied. */
export function Art({ id, className = "", crop, sizes = "(min-width: 768px) 50vw, 100vw", priority }: ArtProps) {
  const slot = getArtSlot(id);
  if (!slot.src) return null;
  return (
    <div
      className={`relative overflow-hidden ${crop ?? ""} ${className}`}
      style={crop ? undefined : { aspectRatio: aspectCss(slot.aspect) }}
    >
      <Image
        src={slot.src}
        alt={slot.decorative ? "" : slot.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
