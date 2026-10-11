"use client";

import { useLandingState } from "./preview-state";
import { LANDING_STATE_COPY } from "./landing-state";
import { PRICE_DOLLARS, SPOT_CAP, formatDateRange } from "./event-facts";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-2xl bg-white/10 px-5 py-3 ring-1 ring-white/25 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-lions-gold">{label}</p>
      <p className="sw-display text-xl font-semibold text-white">{value}</p>
    </li>
  );
}

export function LandingHero({ art }: { art: React.ReactNode }) {
  const state = useLandingState();
  const copy = LANDING_STATE_COPY[state];
  const showFacts = state !== "after";

  return (
    <section aria-labelledby="sw-title" className="sw-night relative overflow-hidden text-white">
      <div className="sw-snowfall" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl px-4 pt-12 pb-10 text-center md:pt-20">
        <p className="mb-3 text-sm uppercase tracking-widest text-lions-gold">{copy.heroEyebrow}</p>
        <h1
          id="sw-title"
          className="sw-display mx-auto max-w-3xl font-semibold leading-tight text-balance"
          style={{ fontSize: "clamp(2.25rem, 9vw, 4rem)" }}
        >
          {copy.heroTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/90 md:text-xl">
          {copy.heroLead}
        </p>

        {showFacts && (
          <ul className="mt-8 flex flex-wrap items-stretch justify-center gap-3">
            <Fact label="When" value={formatDateRange()} />
            <Fact label="Cost" value={`$${PRICE_DOLLARS} per stuffy`} />
            <Fact label="Spots" value={`${SPOT_CAP} stuffies`} />
          </ul>
        )}

        {copy.ctaLabel &&
          (copy.ctaEnabled ? (
            <div className="mt-8">
              <a
                href="#reserve"
                className="inline-flex min-h-12 transform items-center justify-center rounded-lg bg-lions-gold px-8 py-4 text-lg font-semibold text-gray-900 transition hover:scale-105 hover:bg-lions-gold-dark focus:outline-none focus:ring-2 focus:ring-lions-gold focus:ring-offset-2 focus:ring-offset-lions-blue-dark"
              >
                {copy.ctaLabel}
              </a>
            </div>
          ) : (
            <p
              role="status"
              className="mx-auto mt-8 inline-flex min-h-12 items-center gap-2 rounded-lg border-2 border-white/40 bg-white/10 px-6 py-3 text-lg font-semibold text-white"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {copy.ctaLabel}
            </p>
          ))}

        {showFacts && (
          <p className="mt-4 text-sm text-white/80">
            Dates and times are proposed and may change. This page is always the latest.
          </p>
        )}
      </div>

      <div className="relative mx-auto max-w-5xl px-4 pb-0">{art}</div>
    </section>
  );
}
