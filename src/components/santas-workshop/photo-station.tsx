"use client";

import { useState } from "react";
import { ArtSlot } from "./art-slot";
import { SCENES } from "./event-facts";
import { SAMPLE_STUFFIES } from "./sample-data";

const focus = "focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2";

export function PhotoStation() {
  const [sceneId, setSceneId] = useState<(typeof SCENES)[number]["id"]>(SCENES[0].id);
  const [tag, setTag] = useState(SAMPLE_STUFFIES[0].tag);
  const [taken, setTaken] = useState<Record<string, string[]>>({});
  const [flash, setFlash] = useState(0);
  const [shot, setShot] = useState(false);

  const scene = SCENES.find((s) => s.id === sceneId)!;
  const stuffy = SAMPLE_STUFFIES.find((s) => s.tag === tag)!;
  const doneHere = taken[sceneId] ?? [];
  const alreadyShot = doneHere.includes(tag);

  function take() {
    setTaken((t) => ({ ...t, [sceneId]: t[sceneId]?.includes(tag) ? t[sceneId] : [...(t[sceneId] ?? []), tag] }));
    setFlash((n) => n + 1);
    setShot(true);
  }

  function done() {
    const idx = SAMPLE_STUFFIES.findIndex((s) => s.tag === tag);
    const next = SAMPLE_STUFFIES[(idx + 1) % SAMPLE_STUFFIES.length];
    setTag(next.tag);
    setShot(false);
  }

  function undo() {
    setTaken((t) => ({ ...t, [sceneId]: (t[sceneId] ?? []).filter((x) => x !== tag) }));
    setShot(false);
  }

  return (
    <div className="space-y-5 bg-gray-50 p-4 md:p-5">
      <fieldset>
        <legend className="text-sm font-semibold text-gray-900">1. Which scene are you at?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sceneId === s.id}
              onClick={() => {
                setSceneId(s.id);
                setShot(false);
              }}
              className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${focus} ${
                sceneId === s.id ? "bg-lions-blue text-white" : "border-2 border-lions-blue/40 bg-white text-lions-blue-dark hover:bg-lions-blue/5"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="sw-tag" className="text-sm font-semibold text-gray-900">
          2. Which stuffy?
        </label>
        <select
          id="sw-tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setShot(false);
          }}
          className="mt-2 min-h-12 w-full rounded-lg border-2 border-lions-blue/40 bg-white px-3 text-gray-900 focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          {SAMPLE_STUFFIES.map((s) => (
            <option key={s.tag} value={s.tag}>
              {s.tag} · {s.name} ({s.kind})
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-900">3. Take the photo</p>
        <div key={flash} className={`mt-2 ${flash > 0 && shot ? "sw-flash" : ""}`}>
          <ArtSlot id={scene.stuffySlot} sizes="360px" />
        </div>
        <p aria-live="polite" className="mt-2 text-sm text-gray-700">
          {shot || alreadyShot
            ? `Photo of ${stuffy.name} at ${scene.title} saved (sample).`
            : `Ready for ${stuffy.name} at ${scene.title}.`}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={take}
            className={`min-h-12 rounded-lg bg-lions-blue px-6 py-3 text-lg font-semibold text-white transition hover:bg-lions-blue-dark ${focus}`}
          >
            {alreadyShot ? "Retake photo" : "Take photo"}
          </button>
          <button
            type="button"
            onClick={done}
            disabled={!alreadyShot}
            className={`min-h-12 rounded-lg border-2 border-lions-blue px-6 py-3 text-lg font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-40 ${focus}`}
          >
            Done, send to next stop
          </button>
        </div>
        {alreadyShot && (
          <button type="button" onClick={undo} className={`mt-3 min-h-11 rounded px-2 font-semibold text-lions-blue underline ${focus}`}>
            Wrong stuffy? Undo this photo
          </button>
        )}
      </div>

      <p aria-live="polite" className="rounded-2xl bg-lions-blue/5 p-4 text-center font-semibold text-lions-blue-dark">
        {doneHere.length} of {SAMPLE_STUFFIES.length} photographed at this scene (sample)
      </p>
    </div>
  );
}
