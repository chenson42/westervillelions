"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArtSlot } from "./art-slot";
import { SCENES } from "./event-facts";
import { SAMPLE_BOOK_CAPTIONS, SAMPLE_JOURNEY_STUFFY } from "./sample-data";

const focus = "focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2";
const PAGE_COUNT = 1 + SCENES.length + 2;
const stuffy = SAMPLE_JOURNEY_STUFFY;

function Page({ children, label, index }: { children: React.ReactNode; label: string; index: number }) {
  return (
    <div
      data-page={index}
      role="group"
      aria-roledescription="page"
      aria-label={`${label}, page ${index + 1} of ${PAGE_COUNT}`}
      className="sw-paper-bg flex w-full shrink-0 snap-center flex-col justify-center p-6 text-gray-800 shadow-[inset_-10px_0_14px_-12px_rgba(0,0,0,0.35)]"
      style={{ minHeight: "30rem" }}
    >
      {children}
    </div>
  );
}

function Cover() {
  return (
    <Page index={0} label="Cover">
      <div className="sw-nudge relative mx-auto w-full max-w-xs">
        <ArtSlot id="book-cover" sizes="320px" />
        <div className="absolute inset-x-[15%] bottom-[10%] flex h-[12%] items-center justify-center rounded-lg bg-[#fff8ec] px-2 shadow ring-2 ring-lions-gold">
          <span className="sw-display truncate text-xl font-semibold text-lions-blue-dark">{stuffy.name}</span>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-700">{stuffy.name}&rsquo;s trip to Santa&rsquo;s Workshop</p>
    </Page>
  );
}

function ScenePage({ i, sceneIndex }: { i: number; sceneIndex: number }) {
  const s = SCENES[sceneIndex];
  return (
    <Page index={i} label={s.title}>
      <ArtSlot id={s.stuffySlot} sizes="360px" />
      <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[#9b1c2e]">Stop {sceneIndex + 1}</p>
      <h2 className="sw-display text-2xl font-semibold text-lions-blue-dark">{s.title}</h2>
      <p className="mt-2 text-gray-700">{SAMPLE_BOOK_CAPTIONS[s.id]}</p>
    </Page>
  );
}

function Certificate({ i }: { i: number }) {
  return (
    <Page index={i} label="Certificate">
      <div className="rounded-2xl border-4 border-double border-lions-blue/60 p-6 text-center">
        <div className="mx-auto w-20">
          <ArtSlot id="conductor-stamp" compact sizes="80px" />
        </div>
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-[#9b1c2e]">Official passenger</p>
        <h2 className="sw-display mt-1 text-2xl font-semibold text-lions-blue-dark">Certificate of a Very Good Trip</h2>
        <p className="mt-3 text-gray-700">
          This certifies that <strong>{stuffy.name}</strong> rode the train to the North Pole and was a wonderful guest.
        </p>
        <p className="mt-4 text-sm italic text-gray-700">Signed, the Conductor</p>
      </div>
    </Page>
  );
}

function Closing({ i }: { i: number }) {
  return (
    <Page index={i} label="The end">
      <div className="text-center">
        <p className="sw-display text-3xl font-semibold text-lions-blue-dark">The End</p>
        <p className="mx-auto mt-3 max-w-xs text-gray-700">
          Thank you for riding with us. Merry everything from your friends at the Westerville Lions Club.
        </p>
      </div>
    </Page>
  );
}

function Disabled({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
        className={`min-h-11 w-full rounded-lg border-2 border-lions-blue px-4 py-3 font-semibold text-lions-blue opacity-70 ${focus}`}
      >
        {children}
      </button>
      <span className="mx-auto w-fit rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
        Not wired in the prototype
      </span>
    </div>
  );
}

export function MemoryBook() {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setPage(Number((e.target as HTMLElement).dataset.page ?? 0));
        }
      },
      { root: el, threshold: 0.6 },
    );
    el.querySelectorAll("[data-page]").forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, []);

  const go = useCallback((delta: number) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: delta * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, []);

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
        <div
          ref={scroller}
          role="region"
          aria-label="Memory book"
          tabIndex={0}
          className={`sw-scroller flex snap-x snap-mandatory overflow-x-auto ${focus}`}
        >
          <Cover />
          {SCENES.map((s, n) => (
            <ScenePage key={s.id} i={n + 1} sceneIndex={n} />
          ))}
          <Certificate i={SCENES.length + 1} />
          <Closing i={SCENES.length + 2} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={page === 0}
            className={`min-h-11 rounded-lg px-4 font-semibold text-lions-blue hover:bg-lions-blue/5 disabled:opacity-40 ${focus}`}
          >
            &larr; Prev
          </button>
          <p aria-live="polite" className="text-center text-sm font-semibold text-gray-800">
            Page {page + 1} of {PAGE_COUNT}
          </p>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={page === PAGE_COUNT - 1}
            className={`min-h-11 rounded-lg px-4 font-semibold text-lions-blue hover:bg-lions-blue/5 disabled:opacity-40 ${focus}`}
          >
            Next &rarr;
          </button>
        </div>
        <div aria-hidden="true" className="flex justify-center gap-1.5 pb-3">
          {Array.from({ length: PAGE_COUNT }, (_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i === page ? "bg-lions-blue" : "bg-gray-300"}`} />
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Disabled>Save as PDF</Disabled>
        <Disabled>Share with grandparents</Disabled>
      </div>
    </div>
  );
}
