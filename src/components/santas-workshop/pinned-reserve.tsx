"use client";

import { useEffect, useState } from "react";
import { useLandingState } from "./preview-state";
import { LANDING_STATE_COPY } from "./landing-state";
import { PRICE_DOLLARS } from "./event-facts";

/** Phone-only bar pinned to the bottom while the page is open for sign-ups. Hides over the form and from the page end onward. */
export function PinnedReserve() {
  const state = useLandingState();
  const wanted = LANDING_STATE_COPY[state].pinnedReserve;
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!wanted) return;
    // Hidden while the form is on screen, and for good once the page end
    // (flow footer) has come into view or been scrolled past, so the bar can
    // never sit on top of the site footer.
    const update = () => {
      const form = document.getElementById("reserve");
      const end = document.getElementById("sw-end");
      const vh = window.innerHeight;
      let hide = false;
      if (form) {
        const r = form.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) hide = true;
      }
      if (end && end.getBoundingClientRect().top < vh) hide = true;
      setCovered(hide);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [wanted]);

  if (!wanted || covered) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-6px_18px_rgba(0,30,70,0.12)] backdrop-blur md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="text-sm font-semibold text-gray-800">${PRICE_DOLLARS} per stuffy</p>
        <a
          href="#reserve"
          className="inline-flex min-h-11 items-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Reserve a spot
        </a>
      </div>
    </div>
  );
}
