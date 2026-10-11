import Image from "next/image";
import { aspectCss, getArtSlot, type ArtSlotId, type ArtSlotKind } from "./art-slots";

function Glyph({ kind }: { kind: ArtSlotKind }) {
  const common = {
    viewBox: "0 0 64 64",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-10 w-10 opacity-70",
  };
  switch (kind) {
    case "train":
      return (
        <svg {...common}>
          <rect x="8" y="26" width="30" height="16" rx="3" />
          <rect x="38" y="20" width="14" height="22" rx="2" />
          <circle cx="18" cy="46" r="4" />
          <circle cx="32" cy="46" r="4" />
          <circle cx="46" cy="46" r="4" />
        </svg>
      );
    case "track":
      return (
        <svg {...common}>
          <path d="M4 26h56M4 40h56M12 22v22M26 22v22M40 22v22M54 22v22" />
        </svg>
      );
    case "icon":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="18" />
          <path d="M32 22v10l7 5" />
        </svg>
      );
    case "stamp":
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="20" />
          <path d="m22 33 7 7 13-15" />
        </svg>
      );
    case "portrait":
      return (
        <svg {...common}>
          <rect x="14" y="8" width="36" height="48" rx="3" />
          <path d="M22 44h20" />
        </svg>
      );
    case "stuffy":
      return (
        <svg {...common}>
          <circle cx="32" cy="34" r="14" />
          <circle cx="20" cy="18" r="6" />
          <circle cx="44" cy="18" r="6" />
          <circle cx="27" cy="32" r="1.5" />
          <circle cx="37" cy="32" r="1.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="6" y="12" width="52" height="40" rx="4" />
          <circle cx="22" cy="26" r="5" />
          <path d="m8 46 16-14 12 10 8-6 12 10" />
        </svg>
      );
  }
}

interface ArtSlotProps {
  id: ArtSlotId;
  className?: string;
  /** Tailwind aspect/crop classes that replace the registry aspect (hero crops). */
  crop?: string;
  /** Visual tone for the placeholder. */
  tone?: "light" | "night";
  sizes?: string;
  priority?: boolean;
  /** Hide the verbose spec text (tiny slots). */
  compact?: boolean;
}

export function ArtSlot({
  id,
  className = "",
  crop,
  tone = "light",
  sizes = "(min-width: 768px) 50vw, 100vw",
  priority,
  compact,
}: ArtSlotProps) {
  const slot = getArtSlot(id);
  const style = crop ? undefined : { aspectRatio: aspectCss(slot.aspect) };
  const sizing = crop ?? "";

  if (slot.src) {
    return (
      <div className={`relative overflow-hidden ${sizing} ${className}`} style={style}>
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

  const night = tone === "night";
  return (
    <div
      role="img"
      aria-label={`Placeholder for ${slot.label}`}
      className={`relative flex flex-col items-center justify-center gap-1 overflow-hidden border-2 border-dashed p-2 text-center ${
        night
          ? "sw-hatch-night border-white/40 text-white/90"
          : "sw-hatch border-lions-blue/40 text-lions-blue-dark"
      } ${sizing} ${className}`}
      style={style}
    >
      <Glyph kind={slot.kind} />
      {!compact && (
        <>
          <span className="text-[0.7rem] font-bold uppercase tracking-widest sm:text-xs">
            Art slot
          </span>
          <span className="text-xs font-semibold leading-tight sm:text-sm">{slot.label}</span>
          <span className="text-[0.7rem] leading-tight opacity-80 sm:text-xs">
            {slot.aspect} · {slot.pixels}
          </span>
        </>
      )}
    </div>
  );
}
