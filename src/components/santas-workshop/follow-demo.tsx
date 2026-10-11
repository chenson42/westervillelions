"use client";

import { useState } from "react";
import { ArtSlot } from "./art-slot";
import { JourneyTrack } from "./journey-track";
import { formatWallClock, type Journey } from "./journey";
import { PICKUP_WINDOW, formatLongDate, EVENT_DATES } from "./event-facts";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50";

export function FollowDemo({ journey }: { journey: Journey }) {
  const last = journey.stops.length - 1;
  const [current, setCurrent] = useState(4);
  const { stuffy } = journey;
  const notBoarded = current < 0;
  const atEnd = current >= last;

  return (
    <div>
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 shrink-0">
            <ArtSlot id="conductor-stamp" compact sizes="64px" />
          </div>
          <div>
            <h2 className="sw-display text-2xl font-semibold text-lions-blue-dark">{stuffy.name}&rsquo;s journey</h2>
            <p className="text-gray-700">
              {stuffy.kind}, {stuffy.color} · {stuffy.familyLabel} · tag {stuffy.tag}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-700" aria-live="polite">
          Last updated {formatWallClock(journey.updatedAt)}. Pickup {formatLongDate(EVENT_DATES.pickup)},{" "}
          {PICKUP_WINDOW.label}.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border-2 border-dashed border-lions-blue/40 bg-lions-blue/5 p-4 sm:flex-row sm:items-center">
        <span className="w-fit rounded-full bg-lions-blue px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
          Demo
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCurrent((c) => Math.min(last, c + 1))}
            disabled={atEnd}
            className={`${btn} bg-lions-blue text-white hover:bg-lions-blue-dark`}
          >
            Move {stuffy.name} to the next stop
          </button>
          <button
            type="button"
            onClick={() => setCurrent(-1)}
            className={`${btn} border-2 border-lions-blue text-lions-blue hover:bg-lions-blue/5`}
          >
            Before check-in
          </button>
          <button
            type="button"
            onClick={() => setCurrent(4)}
            className={`${btn} border-2 border-lions-blue text-lions-blue hover:bg-lions-blue/5`}
          >
            Reset
          </button>
        </div>
      </div>

      {notBoarded && (
        <p role="status" className="mt-4 rounded-2xl bg-gray-50 p-5 text-gray-700">
          {stuffy.name} hasn&rsquo;t boarded yet. Check back after Friday check-in.
        </p>
      )}
      {atEnd && (
        <p role="status" className="mt-4 rounded-2xl bg-[#1f5c4a] p-5 font-semibold text-white">
          {stuffy.name} is ready for pickup on {formatLongDate(EVENT_DATES.pickup)}, {PICKUP_WINDOW.label}.
        </p>
      )}

      <div className="mt-6">
        <JourneyTrack journey={journey} currentOrder={current} />
      </div>

      <details className="mt-8 rounded-2xl border border-gray-200 bg-white px-5">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
          What if the link is wrong?
        </summary>
        <p className="pb-4 text-gray-700">
          We can&rsquo;t find that journey. Please check the card you were given at check-in, or ask the club. (Sample
          wording. It never says whether anyone else&rsquo;s page exists.)
        </p>
      </details>
    </div>
  );
}
