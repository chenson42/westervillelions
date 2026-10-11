"use client";

import { useState } from "react";

type Option = "paperless" | "hybrid" | "printed";

const OPTIONS: readonly {
  id: Option;
  label: string;
  tag?: string;
  pickup: string;
  good: string;
  watch: string;
}[] = [
  {
    id: "paperless",
    label: "Paperless",
    pickup: "Sunday: families collect their stuffy. The book arrives on their phone.",
    good: "Ready Saturday night, no print cost, easy to share with out-of-town grandparents.",
    watch: "No keepsake in hand at pickup, needs a smartphone, and the club must decide how long to keep the photos.",
  },
  {
    id: "hybrid",
    label: "Paperless plus a keepsake card",
    tag: "Recommended",
    pickup:
      "Sunday: families collect their stuffy and a pre-printed train-ticket card with the stuffy's name written in. The book is on their phone.",
    good: "A small thing to hold at pickup, no photos to print, and the card can be made weeks ahead.",
    watch: "One more item to prepare and hand out. Families without a phone can ask for a print.",
  },
  {
    id: "printed",
    label: "Printed book",
    pickup: "Sunday: families collect their stuffy and a printed photo book.",
    good: "A real keepsake in the child's hands.",
    watch: "Sixty books between Saturday's photos and Sunday's pickup is a production crunch, and the largest cost risk.",
  },
];

export function DeliverySwitch() {
  const [choice, setChoice] = useState<Option>("hybrid");
  const active = OPTIONS.find((o) => o.id === choice)!;
  return (
    <div role="radiogroup" aria-labelledby="sw-delivery-title" className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 id="sw-delivery-title" className="sw-display text-xl font-semibold text-lions-blue-dark">How should the book be delivered?</h2>
      <p className="mt-1 text-sm text-gray-700">For the chair: flip between the three options.</p>
      <div className="mt-3 grid gap-2">
        {OPTIONS.map((o) => (
          <label key={o.id} className="relative block">
            <input
              type="radio"
              name="sw-delivery"
              value={o.id}
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
              className="peer sr-only"
            />
            <span className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-lg border-2 border-lions-blue/30 px-4 py-3 font-semibold text-lions-blue-dark transition hover:bg-lions-blue/5 peer-checked:border-lions-blue peer-checked:bg-lions-blue peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-lions-blue peer-focus-visible:ring-offset-2">
              {o.label}
              {o.tag && (
                <span className="rounded-full bg-lions-gold px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-gray-900">
                  {o.tag}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div aria-live="polite" className="mt-4 space-y-2 rounded-lg bg-gray-50 p-4 text-gray-800">
        <p>{active.pickup}</p>
        <p>
          <span className="font-semibold text-[#1f5c4a]">Good: </span>
          {active.good}
        </p>
        <p>
          <span className="font-semibold text-[#9b1c2e]">Watch for: </span>
          {active.watch}
        </p>
      </div>
    </div>
  );
}
