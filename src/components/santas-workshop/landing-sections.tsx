import Link from "next/link";
import { ArtSlot } from "./art-slot";
import type { ArtSlotId } from "./art-slots";
import {
  DROPOFF_PLACE,
  DROPOFF_WINDOWS,
  EVENT_DATES,
  HOST_NAME,
  MAX_PER_ORDER,
  PICKUP_WINDOW,
  PRICE_DOLLARS,
  SCENES,
  formatLongDate,
} from "./event-facts";

const focus = "focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

export function Story() {
  return (
    <section aria-labelledby="story-title" className="sw-snow-bg px-4 py-16 md:py-20">
      <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[1fr_auto]">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-lions-blue">The story</p>
          <h2 id="story-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
            A long train ride, a very special guest
          </h2>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-gray-700 md:text-lg">
            <p>
              Every December, a little train sets out for the North Pole. This year it has room for your child&rsquo;s
              favorite stuffed animal.
            </p>
            <p>
              Your stuffy checks in with the conductor on Friday evening, rides through the snowy night, and wakes up in
              Santa&rsquo;s workshop. There is wrapping to help with, toys to build, cookies to share, and a bedtime
              story to hear. Then it comes home with a memory book of the whole adventure.
            </p>
            <p>
              It is a small way to make the season feel big, from your neighbors at the {HOST_NAME}.
            </p>
          </div>
        </div>
        <div className="mx-auto w-40 md:w-52">
          <ArtSlot id="conductor-stamp" sizes="208px" />
        </div>
      </div>
    </section>
  );
}

function Step({
  n,
  day,
  title,
  slot,
  children,
}: {
  n: number;
  day: string;
  title: string;
  slot: ArtSlotId;
  children: React.ReactNode;
}) {
  return (
    <li className="relative rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="w-16 shrink-0">
          <ArtSlot id={slot} compact sizes="64px" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9b1c2e]">
            Step {n} · {day}
          </p>
          <h3 className="sw-display text-xl font-semibold text-lions-blue-dark">{title}</h3>
        </div>
      </div>
      <div className="mt-4 space-y-2 text-gray-700">{children}</div>
    </li>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="bg-white px-4 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-lions-blue">How it works</p>
        <h2 id="how-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
          Three days, three easy steps
        </h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          <Step n={1} day={formatLongDate(EVENT_DATES.dropoff)} title="Drop off at the station" slot="step-dropoff">
            <p>
              Meet the train conductor at {DROPOFF_PLACE}. Choose a window when you sign up:{" "}
              {DROPOFF_WINDOWS.map((w) => w.label).join(" or ")}.
            </p>
            <p>The conductor checks your stuffy in and stamps its ticket.</p>
          </Step>
          <Step n={2} day={formatLongDate(EVENT_DATES.photos)} title="The journey" slot="step-journey">
            <p>
              Your stuffy visits five stops: Mrs. Claus&rsquo;s wrapping room, Santa&rsquo;s workshop, the cookie
              table, story time, and the reindeer.
            </p>
            <p>We take photos of the stuffies only, never the children.</p>
          </Step>
          <Step n={3} day={formatLongDate(EVENT_DATES.pickup)} title="Pickup with a memory book" slot="step-pickup">
            <p>
              Collect your stuffy at {DROPOFF_PLACE}, {PICKUP_WINDOW.label}. Its memory book is ready to flip through
              on your phone.
            </p>
          </Step>
        </ol>

        {/* Phase 2 idea: remove this whole block unless following the journey is committed. */}
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border-2 border-dashed border-lions-blue/40 bg-lions-blue/5 p-5 sm:flex-row sm:items-center">
          <span className="w-fit rounded-full bg-lions-blue px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Phase 2 idea
          </span>
          <p className="text-gray-800">
            You will get a card at check-in with a private link to follow your stuffy&rsquo;s journey, stop by stop,
            all weekend.{" "}
            <Link href="/santas-workshop/preview/follow" className={`font-semibold text-lions-blue underline ${focus}`}>
              See what that looks like
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

export function Scenes() {
  return (
    <section aria-labelledby="scenes-title" className="sw-snow-bg px-4 py-16 md:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-lions-blue">Saturday at the North Pole</p>
        <h2 id="scenes-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
          Five stops on the journey
        </h2>
        <ul
          tabIndex={0}
          aria-label="Photo scenes, scroll sideways"
          className={`sw-scroller -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-5 ${focus}`}
        >
          {SCENES.map((s) => (
            <li
              key={s.id}
              className="w-[72%] shrink-0 snap-start overflow-hidden rounded-2xl bg-white shadow-sm sm:w-[45%] md:w-auto"
            >
              <ArtSlot id={s.sceneSlot} sizes="(min-width: 1024px) 20vw, 72vw" />
              <div className="p-4">
                <h3 className="sw-display text-lg font-semibold text-lions-blue-dark">{s.title}</h3>
                <p className="mt-1 text-sm text-gray-700">{s.blurb}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function WhatToBring() {
  return (
    <section aria-labelledby="bring-title" className="bg-white px-4 py-16 md:py-20">
      <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
        <div>
          <h2 id="bring-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
            What to bring
          </h2>
          <ul className="mt-5 space-y-3 text-gray-700">
            {[
              "One stuffed animal for each ticket, clean and ready to travel.",
              "Your confirmation, on your phone is fine.",
              "Anything the conductor should know, like a loose eye or a favorite night-light.",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0 fill-[#1f5c4a]">
                  <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
                </svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-gray-700">
            Please leave behind any accessory that cannot be replaced. The Lions take great care, but cannot be
            responsible for loss or damage.
          </p>
        </div>
        <Faq />
      </div>
    </section>
  );
}

const FAQS: readonly { q: string; a: string }[] = [
  {
    q: "How much does it cost?",
    a: `$${PRICE_DOLLARS} per stuffy. You can sign up to ${MAX_PER_ORDER} stuffies in one order.`,
  },
  {
    q: "Who is it for?",
    a: "Preschoolers and their favorite stuffed animals.",
  },
  {
    q: "Where is the Saturday house?",
    a: "Only the stuffies go there. Registered families get the details, and children do not need to attend.",
  },
  {
    q: "What if the dates change?",
    a: "These dates are proposed. If anything moves, this page is always the latest.",
  },
];

export function Faq() {
  return (
    <div>
      <h2 className="sw-display text-3xl font-semibold text-lions-blue-dark">Good to know</h2>
      <div className="mt-5 divide-y divide-gray-200 rounded-2xl border border-gray-200">
        {FAQS.map((f) => (
          <details key={f.q} className="group px-5">
            <summary
              className={`flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-gray-900 ${focus}`}
            >
              {f.q}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-5 w-5 shrink-0 fill-lions-blue transition group-open:rotate-180"
              >
                <path d="M5.3 7.3 10 12l4.7-4.7 1.4 1.4L10 14.8 3.9 8.7z" />
              </svg>
            </summary>
            <p className="pb-4 text-gray-700">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function PrivacyLine() {
  return (
    <section aria-label="Privacy" className="px-4 pb-4 pt-12 sw-snow-bg">
      <div className="mx-auto flex max-w-3xl gap-4 rounded-2xl bg-white p-6 shadow-sm">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-1 h-6 w-6 shrink-0 fill-none stroke-lions-blue" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
        </svg>
        <p className="text-gray-700">
          <span className="font-semibold text-gray-900">Our promise. </span>
          We only photograph stuffed animals. We ask for your child&rsquo;s first name so Santa and the conductor can
          say hello; it is never posted, and we never photograph children.
        </p>
      </div>
    </section>
  );
}

export function PresentedBy() {
  return (
    <section aria-label="Presented by" className="sw-snow-bg px-4 pb-16 pt-8 text-center">
      <p className="text-gray-700">Presented by the</p>
      <p className="sw-display text-2xl font-semibold text-lions-blue-dark">{HOST_NAME}</p>
      <p className="mt-2 text-gray-700">Neighbors serving Westerville since 1928.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link
          href="/about"
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          About the club
        </Link>
        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          Contact us
        </Link>
      </div>
    </section>
  );
}

/** Photo strip for the "after the event" state. */
export function AfterStrip() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {SCENES.map((s) => (
        <li key={s.id} className="overflow-hidden rounded-2xl bg-white/10 p-2 ring-1 ring-white/25">
          <ArtSlot id={s.stuffySlot} tone="night" compact sizes="(min-width: 1024px) 20vw, 50vw" />
          <p className="px-1 pt-2 text-sm font-semibold text-white">{s.title}</p>
        </li>
      ))}
    </ul>
  );
}
