"use client";

import { useMemo, useState } from "react";
import { countBoarded, filterRoster, toggleBoarded } from "./check-in";
import { DROPOFF_WINDOWS, windowLabel, type DropoffWindowId } from "./event-facts";
import { SAMPLE_STUFFIES, type SampleStuffy } from "./sample-data";

const focus = "focus:outline-none focus:ring-2 focus:ring-lions-gold focus:ring-offset-2 focus:ring-offset-[#001a3d]";

export function ConductorList() {
  const [roster, setRoster] = useState<SampleStuffy[]>([...SAMPLE_STUFFIES]);
  const [query, setQuery] = useState("");
  const [win, setWin] = useState<DropoffWindowId | "all">("all");
  const [walkUp, setWalkUp] = useState(false);

  const visible = useMemo(
    () => filterRoster(roster, query).filter((r) => win === "all" || r.windowId === win),
    [roster, query, win],
  );
  const boarded = countBoarded(roster);

  return (
    <div className="sw-night min-h-[40rem] px-4 pb-8 pt-6 text-white">
      <p className="text-xs font-semibold uppercase tracking-widest text-lions-gold">Conductor</p>
      <p aria-live="polite" className="mt-1">
        <span className="sw-display text-5xl font-semibold">{boarded}</span>
        <span className="ml-2 text-lg text-white/90">of {roster.length} checked in (sample)</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
        <div className="h-full rounded-full bg-lions-gold transition-all" style={{ width: `${(boarded / roster.length) * 100}%` }} />
      </div>

      <div className="mt-5">
        <label htmlFor="sw-search" className="block text-sm font-semibold text-white">
          Find a stuffy
        </label>
        <input
          id="sw-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, kind or tag, like Pip or B-07"
          className="mt-1 min-h-12 w-full rounded-lg border-2 border-white/30 bg-white px-4 text-gray-900 placeholder:text-gray-600 focus:border-lions-gold focus:outline-none focus:ring-2 focus:ring-lions-gold"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Drop-off window">
        {([{ id: "all", label: "All" }, ...DROPOFF_WINDOWS] as { id: DropoffWindowId | "all"; label: string }[]).map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={win === w.id}
            onClick={() => setWin(w.id)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${focus} ${
              win === w.id ? "bg-lions-gold text-gray-900" : "bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white/10 p-6 text-center text-white">
          No stuffies match &ldquo;{query}&rdquo;. Try a name, kind or tag, or add a walk-up below.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {visible.map((r) => (
            <li key={r.tag} className="rounded-2xl bg-white p-4 text-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-widest text-lions-blue">
                    Tag {r.tag} · {r.familyLabel}
                  </p>
                  <p className="sw-display text-xl font-semibold text-gray-900">{r.name}</p>
                  <p className="text-sm text-gray-700">
                    {r.kind}, {r.color}
                  </p>
                  <p className="text-sm text-gray-700">{windowLabel(r.windowId)}</p>
                  {r.careNote && (
                    <p className="mt-1 text-sm font-semibold text-[#9b1c2e]">Care: {r.careNote}</p>
                  )}
                </div>
                {r.boarded ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#1f5c4a] px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" /></svg>
                    Boarded
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-gray-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-800">
                    Waiting
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRoster((cur) => toggleBoarded(cur, r.tag))}
                aria-label={`${r.boarded ? "Undo check in" : "Check in"} for ${r.name}, tag ${r.tag}`}
                className={`mt-3 min-h-12 w-full rounded-lg px-4 py-3 text-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 ${
                  r.boarded
                    ? "border-2 border-lions-blue text-lions-blue hover:bg-lions-blue/5"
                    : "bg-lions-blue text-white hover:bg-lions-blue-dark"
                }`}
              >
                {r.boarded ? "Undo" : "Check in"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 rounded-2xl border-2 border-dashed border-white/40 p-4">
        <button
          type="button"
          aria-expanded={walkUp}
          aria-controls="sw-walkup"
          onClick={() => setWalkUp((v) => !v)}
          className={`min-h-11 w-full rounded-lg text-left font-semibold text-white ${focus}`}
        >
          {walkUp ? "Hide" : "Show"}: walk-up, not on the list
        </button>
        {walkUp && (
          <div id="sw-walkup" className="mt-3 space-y-2 rounded-lg bg-white/10 p-4 text-white">
            <p className="font-semibold">Sample walk-up panel</p>
            <p className="text-white/90">
              Here the conductor would enter a stuffy&rsquo;s name and kind, pick a window, and hand over a new tag. In
              the prototype nothing is saved.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
