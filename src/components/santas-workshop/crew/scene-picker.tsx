"use client";

import type { CrewScene } from "@/lib/santas-workshop/crew-contract";
import { OTHER_CHOICE } from "./scene-store";

export const SCENE_PICK_FIRST = "Pick a scene first.";
export const SCENES_LOADING = "Loading scenes…";
export const SCENES_FAILED = "Scenes didn't load. You can still take the photo; an admin will put it in a scene.";

interface Props {
  scenes: CrewScene[];
  /** A scene id, OTHER_CHOICE, or null when nothing is picked yet. */
  choice: string | null;
  onChoose(choice: string): void;
}

/** Which scene a group photo belongs to. Big thumb targets, one tap; the choice stays until changed. */
export function ScenePicker({ scenes, choice, onChoose }: Props) {
  const options: { value: string; title: string; caption: string | null }[] = [
    ...scenes.map((s) => ({ value: s.id, title: s.title, caption: s.caption })),
    { value: OTHER_CHOICE, title: "Other", caption: "Not part of a scene" },
  ];
  return (
    <fieldset role="radiogroup" className="space-y-2">
      <legend className="mb-1 text-base font-semibold text-gray-900">Which scene is this photo for?</legend>
      {options.map((o) => {
        const on = choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChoose(o.value)}
            className={`block min-h-[56px] w-full rounded-lg border-2 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 ${
              on ? "border-lions-blue bg-lions-blue/10 text-lions-blue-dark" : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
            }`}
          >
            <span className="block text-lg font-semibold">{o.title}</span>
            {o.caption && <span className="block text-sm text-gray-600">{o.caption}</span>}
          </button>
        );
      })}
    </fieldset>
  );
}
