import { ArtSlot } from "./art-slot";
import { getArtSlot } from "./art-slots";
import { InView } from "./in-view";

/** Stand-in locomotive and cars, drawn inline. The supplied "train" art replaces it. */
function StandInTrain() {
  return (
    <svg viewBox="0 0 900 300" role="img" aria-label="A small steam train with three cars" className="h-full w-full">
      <title>A small steam train with three cars</title>
      {/* steam */}
      <g fill="#fff" opacity="0.85">
        <circle className="sw-steam" cx="738" cy="70" r="14" />
        <circle className="sw-steam" cx="738" cy="70" r="11" />
        <circle className="sw-steam" cx="738" cy="70" r="9" />
      </g>
      {/* cars */}
      {[40, 250, 460].map((x, i) => (
        <g key={x}>
          <rect x={x} y="150" width="190" height="90" rx="10" fill={i === 1 ? "#1f5c4a" : "#9b1c2e"} />
          <rect x={x} y="150" width="190" height="14" rx="6" fill="#F9B222" />
          <rect x={x + 22} y="176" width="40" height="34" rx="5" fill="#fff8ec" />
          <rect x={x + 75} y="176" width="40" height="34" rx="5" fill="#fff8ec" />
          <rect x={x + 128} y="176" width="40" height="34" rx="5" fill="#fff8ec" />
          <circle cx={x + 45} cy="250" r="16" fill="#2b3550" />
          <circle cx={x + 145} cy="250" r="16" fill="#2b3550" />
          <rect x={x + 190} y="214" width="20" height="8" fill="#c3cbe0" />
        </g>
      ))}
      {/* engine */}
      <rect x="670" y="140" width="130" height="100" rx="10" fill="#003F87" />
      <rect x="760" y="110" width="80" height="130" rx="10" fill="#9b1c2e" />
      <rect x="772" y="124" width="56" height="40" rx="6" fill="#fff8ec" />
      <rect x="715" y="86" width="44" height="64" rx="6" fill="#2b3550" />
      <rect x="708" y="78" width="58" height="12" rx="6" fill="#2b3550" />
      <path d="M800 240h72l-28-28h-44z" fill="#F9B222" />
      <circle cx="710" cy="250" r="20" fill="#2b3550" />
      <circle cx="790" cy="250" r="20" fill="#2b3550" />
      <circle cx="710" cy="250" r="7" fill="#F9B222" />
      <circle cx="790" cy="250" r="7" fill="#F9B222" />
      <circle cx="868" cy="212" r="7" fill="#F9B222" />
    </svg>
  );
}

interface TrainMotifProps {
  tone?: "light" | "night";
  className?: string;
}

/** The journey motif: a train rolling in over a track. Decorative. */
export function TrainMotif({ tone = "light", className = "" }: TrainMotifProps) {
  const supplied = getArtSlot("train").src !== null;
  return (
    <div className={`overflow-hidden ${className}`} aria-hidden={supplied ? undefined : "true"}>
      <InView className="mx-auto w-full max-w-md px-4 sm:max-w-lg">
        {supplied ? (
          <ArtSlot id="train" tone={tone} sizes="512px" />
        ) : (
          <div style={{ aspectRatio: "3 / 1" }}>
            <StandInTrain />
          </div>
        )}
      </InView>
      <div className={`sw-track -mt-1 ${tone === "night" ? "sw-track-on-night" : ""}`} />
    </div>
  );
}
