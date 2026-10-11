"use client";

import Link from "next/link";
import { useState } from "react";
import { useLandingState } from "./preview-state";
import {
  FORM_QUESTIONS,
  MAX_PER_ORDER,
  PRICE_DOLLARS,
  REGISTRATION_OPENS,
  SPOT_CAP,
  formatLongDate,
} from "./event-facts";
import { PREVIEW_BASE } from "./screens";

const focus = "focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2";

function Stub({
  children,
  label,
  head,
}: {
  children: React.ReactNode;
  label: string;
  head?: React.ReactNode;
}) {
  return (
    <div className="sw-ticket-wrap mx-auto w-full max-w-xl" role="group" aria-label={label}>
      {head ? (
        <>
          <div className="sw-ticket-top sw-paper-bg rounded-t-2xl text-gray-800">{head}</div>
          <div className="sw-ticket-bottom sw-paper-bg rounded-b-2xl text-gray-800">
            <div className="sw-perforation mx-6" aria-hidden="true" />
            {children}
          </div>
        </>
      ) : (
        <div className="sw-paper-bg rounded-2xl text-gray-800">{children}</div>
      )}
    </div>
  );
}

function QuantityRow() {
  const [qty, setQty] = useState(1);
  const total = qty * PRICE_DOLLARS;
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p id="sw-qty-label" className="font-semibold text-gray-900">Stuffies</p>
        <p className="text-sm text-gray-700">Up to {MAX_PER_ORDER} per order</p>
      </div>
      <div className="flex items-center gap-1" role="group" aria-labelledby="sw-qty-label">
        <button
          type="button"
          aria-label="One fewer stuffy"
          disabled={qty <= 1}
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-lg border-2 border-lions-blue text-xl font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-40 ${focus}`}
        >
          &minus;
        </button>
        <output aria-live="polite" className="min-w-[5.5rem] text-center">
          <span className="sw-display block text-2xl font-semibold text-gray-900">{qty}</span>
          <span className="block text-xs text-gray-700">${total} total</span>
        </output>
        <button
          type="button"
          aria-label="One more stuffy"
          disabled={qty >= MAX_PER_ORDER}
          onClick={() => setQty((q) => Math.min(MAX_PER_ORDER, q + 1))}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-lg border-2 border-lions-blue text-xl font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-40 ${focus}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function OpenCard() {
  return (
    <Stub
      label="Sign-up form placeholder"
      head={
      <div className="p-6 pb-8 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold uppercase tracking-widest text-lions-blue">Boarding pass</p>
          <span className="rounded-full border border-dashed border-lions-blue/50 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-lions-blue-dark">
            Zeffy form goes here
          </span>
        </div>
        <h2 id="reserve-title" className="sw-display mt-2 text-3xl font-semibold text-lions-blue-dark">
          Reserve your spot
        </h2>
        <p className="mt-1 text-gray-700">${PRICE_DOLLARS} per stuffy. One ticket per stuffy.</p>
      </div>
      }
    >
      <div className="space-y-6 p-6 sm:p-8">
        <QuantityRow />

        <div>
          <h3 className="font-semibold text-gray-900">What the form will ask</h3>
          <p className="text-sm text-gray-700">
            Sample list, to confirm with the chair which belong on the form.
          </p>
          <ul className="mt-3 divide-y divide-lions-blue/10 rounded-lg border border-lions-blue/15 bg-white">
            {FORM_QUESTIONS.map((q) => (
              <li key={q.id} className="px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">
                  {q.label}
                  {q.required ? (
                    <span className="ml-2 text-xs font-bold uppercase tracking-wider text-[#9b1c2e]">Required</span>
                  ) : (
                    <span className="ml-2 text-xs uppercase tracking-wider text-gray-600">Optional</span>
                  )}
                </p>
                {q.helper && <p className="text-sm text-gray-700">{q.helper}</p>}
                {q.options && <p className="text-sm text-gray-700">Choose one: {q.options.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-lions-blue/15">
          <p className="font-semibold text-gray-900">Payment</p>
          <p>Apple Pay, Google Pay or card, handled securely by Zeffy.</p>
        </div>

        <Link
          href={`${PREVIEW_BASE}/confirmed`}
          className={`flex min-h-12 w-full items-center justify-center rounded-lg bg-lions-blue px-6 py-3 text-center text-lg font-semibold text-white transition hover:bg-lions-blue-dark ${focus}`}
        >
          Reserve (sample, takes you to the next screen)
        </Link>
        <p className="text-center text-sm text-gray-700">
          Having trouble? Open the sign-up form in a new tab. <span className="italic">(sample text, not a link)</span>
        </p>
      </div>
    </Stub>
  );
}

function OpensSoonCard() {
  return (
    <Stub label="Registration opens soon">
      <div className="p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-lions-blue">Boarding soon</p>
        <h2 id="reserve-title" className="sw-display mt-2 text-3xl font-semibold text-lions-blue-dark">
          Registration opens soon
        </h2>
        <p className="sw-display mt-4 text-4xl font-semibold text-[#9b1c2e]">{formatLongDate(REGISTRATION_OPENS)}</p>
        <p className="mx-auto mt-4 max-w-sm text-gray-700">
          Scan the QR code again then, or save this page. Have a look around in the meantime.
        </p>
      </div>
    </Stub>
  );
}

function FullCard() {
  return (
    <Stub label="The train is full">
      <div className="p-8 text-center">
        <p className="inline-flex items-center gap-2 rounded-full bg-[#9b1c2e] px-4 py-1 text-sm font-bold uppercase tracking-wider text-white">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 11H9v-2h2v2Zm0-4H9V6h2v3Z" /></svg>
          Full
        </p>
        <h2 id="reserve-title" className="sw-display mt-3 text-3xl font-semibold text-lions-blue-dark">
          The train is full this year
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-gray-700">
          All {SPOT_CAP} spots are taken. Thank you for the warm welcome. We would love to see you next December.
        </p>
        <Link
          href="/contact"
          className={`mt-6 inline-flex min-h-11 items-center rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 ${focus}`}
        >
          Questions? Contact the club
        </Link>
      </div>
    </Stub>
  );
}

function ThanksCard({ strip }: { strip: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl text-center text-white">
      <h2 id="reserve-title" className="sw-display text-3xl font-semibold md:text-4xl">
        Thank you for riding with us
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-lg text-white/90">
        A few moments from the weekend. See you next December.
      </p>
      <div className="mt-8 text-left">{strip}</div>
    </div>
  );
}

export function ZeffyFormCard({ afterStrip }: { afterStrip: React.ReactNode }) {
  const state = useLandingState();
  return (
    <section
      id="reserve"
      aria-labelledby="reserve-title"
      className="sw-night relative scroll-mt-20 overflow-hidden px-4 py-14 md:py-20"
    >
      <div className="sw-snowfall" aria-hidden="true" />
      <div className="relative">
        {state === "open" && <OpenCard />}
        {state === "before" && <OpensSoonCard />}
        {state === "full" && <FullCard />}
        {state === "after" && <ThanksCard strip={afterStrip} />}
      </div>
    </section>
  );
}
