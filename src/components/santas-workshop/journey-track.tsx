import { ArtSlot } from "./art-slot";
import { formatWallClock, stopStatus, type Journey, type JourneyPlace } from "./journey";

const PLACE_LABEL: Record<JourneyPlace, string> = {
  ihop: "At IHOP",
  train: "On the train",
  "north-pole": "At the North Pole",
};

function Node({ status }: { status: "done" | "current" | "upcoming" }) {
  if (status === "done") {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1f5c4a] text-white ring-4 ring-white">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
          <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
        </svg>
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="sw-pulse flex h-9 w-9 items-center justify-center rounded-full bg-lions-gold text-gray-900 ring-4 ring-white">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-current">
          <path d="M10 2 12.4 7.4 18 8l-4.2 3.9L15 17.5 10 14.6 5 17.5l1.2-5.6L2 8l5.600-.6z" />
        </svg>
      </span>
    );
  }
  return <span className="h-9 w-9 rounded-full border-2 border-gray-300 bg-white ring-4 ring-white" />;
}

/** The route as an ordered list first, a drawing second. */
export function JourneyTrack({ journey, currentOrder }: { journey: Journey; currentOrder: number }) {
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="sw-track-v absolute bottom-4 left-[0.5rem] top-4 opacity-60"
        style={{ left: "calc(1.125rem - 10px)" }}
      />
      {journey.stops.map((stop) => {
        const status = stopStatus(stop, currentOrder);
        const showPhoto = stop.photoSlot !== null && status !== "upcoming";
        return (
          <li
            key={stop.id}
            aria-current={status === "current" ? "step" : undefined}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            <div className="relative z-10 shrink-0">
              <Node status={status} />
            </div>
            <div
              className={`min-w-0 flex-1 rounded-2xl p-4 ${
                status === "current"
                  ? "bg-white shadow-lg ring-2 ring-lions-gold"
                  : status === "done"
                    ? "bg-white shadow-sm"
                    : "bg-gray-50 text-gray-600"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-700">
                {status === "current" && <span className="mr-2 rounded-full bg-lions-gold px-2 py-0.5 text-gray-900">Now:</span>}
                {status === "done" && <span className="mr-2">Done</span>}
                {status === "upcoming" && <span className="mr-2">Coming up</span>}
                {PLACE_LABEL[stop.place]}
                {status !== "upcoming" && <> · {formatWallClock(stop.at)}</>}
              </p>
              <h3 className="sw-display mt-1 text-lg font-semibold text-lions-blue-dark">{stop.title}</h3>
              {status !== "upcoming" && <p className="mt-1 text-gray-700">{stop.caption}</p>}
              {showPhoto && stop.photoSlot && (
                <div className="mt-3 max-w-xs">
                  <ArtSlot id={stop.photoSlot} sizes="320px" />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
