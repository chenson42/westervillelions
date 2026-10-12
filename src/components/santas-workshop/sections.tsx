import Link from "next/link";
import type { FocusDay } from "@/lib/santas-workshop/state";
import type { WorkshopFacts } from "@/lib/santas-workshop/facts";
import { Art } from "./art";
import type { ArtSlotId } from "./art-slots";
import {
  CONTACT_EMAIL,
  LOSS_NOTE,
  PHOTO_BOX_HELPER,
  PHOTO_BOX_LABEL,
  PRIVACY_ASKED,
  PRIVACY_USE,
  PRIVACY_WHO,
  PROMISE,
  REMOVAL_SENTENCE,
  STORY,
  WHAT_TO_BRING,
  type WorkshopCopy,
} from "./copy";

const FOCUS = "focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";
const TEXT_LINK = `font-semibold text-lions-blue underline hover:text-lions-blue-dark ${FOCUS}`;
const OUTLINE_BTN =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue";

export function Story() {
  return (
    <section aria-labelledby="story-title" className="sw-snow-bg px-4 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="grid items-center gap-10 md:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-lions-blue">The story</p>
            <h2 id="story-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
              A long train ride, a very special guest
            </h2>
            <div className="mt-5 space-y-4 text-base leading-relaxed text-gray-700 md:text-lg">
              {STORY.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
          <div className="mx-auto w-40 empty:hidden md:w-52">
            <Art id="story-art" sizes="208px" />
          </div>
        </div>
      </div>
    </section>
  );
}

const DAY_ART: Record<FocusDay, ArtSlotId> = {
  dropoff: "step-dropoff",
  photos: "step-photos",
  pickup: "step-pickup",
};

export function Weekend({ c, focus }: { c: WorkshopCopy; focus: FocusDay | null }) {
  const ordered = focus ? [...c.days].sort((a, b) => Number(b.key === focus) - Number(a.key === focus)) : c.days;
  return (
    <section aria-labelledby="weekend-title" className="bg-white px-4 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-lions-blue">The weekend</p>
        <h2 id="weekend-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
          Three days, three easy steps
        </h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {ordered.map((d) => (
            <li
              key={d.key}
              data-day={d.key}
              data-focus={d.key === focus ? "true" : undefined}
              className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100"
            >
              <div className="flex items-center gap-4">
                <div className="w-16 shrink-0 empty:hidden">
                  <Art id={DAY_ART[d.key]} sizes="64px" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#9b1c2e]">
                    {d.date}
                    {d.key === focus && (
                      <span className="ml-2 rounded-lg bg-lions-gold px-2 py-0.5 text-gray-900">Today</span>
                    )}
                  </p>
                  <h3 className="sw-display text-xl font-semibold text-lions-blue-dark">{d.title}</h3>
                </div>
              </div>
              <p className="mt-4 text-gray-700">
                {d.body}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-6">
          <Link href="/events" className={TEXT_LINK}>
            See drop-off and pickup on the events calendar
          </Link>
        </p>
      </div>
    </section>
  );
}

export function AfterYouRegister({ c }: { c: WorkshopCopy }) {
  return (
    <section
      id="after-you-register"
      aria-labelledby="after-title"
      data-testid="workshop-after-you-register"
      className="bg-white px-4 py-14 md:py-16"
    >
      <div className="mx-auto max-w-3xl rounded-2xl bg-lions-blue/5 p-6 md:p-8">
        <h2 id="after-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
          After you register
        </h2>
        <ul className="mt-5 space-y-3 text-gray-800">
          {c.afterYouRegister.map((line) => (
            <li key={line} className="flex gap-3">
              <Check />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5">
          <Link href="/connect" className={TEXT_LINK}>
            Contact the club
          </Link>{" "}
          or write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0 fill-[#1f5c4a]">
      <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
    </svg>
  );
}

export function WhatToBring() {
  return (
    <section aria-labelledby="bring-title" className="sw-snow-bg px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 id="bring-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
          What to bring
        </h2>
        <ul className="mt-5 space-y-3 text-gray-700">
          {WHAT_TO_BRING.map((t) => (
            <li key={t} className="flex gap-3">
              <Check />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-gray-700">{LOSS_NOTE}</p>
      </div>
    </section>
  );
}

export function GoodToKnow({ c }: { c: WorkshopCopy }) {
  return (
    <section aria-labelledby="faq-title" className="bg-white px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 id="faq-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
          Good to know
        </h2>
        <div className="mt-5 divide-y divide-gray-200 rounded-2xl border border-gray-200">
          {c.faqs.map((f) => (
            <details key={f.q} className="group px-5">
              <summary
                className={`flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-gray-900 ${FOCUS}`}
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
    </section>
  );
}

export function YourPrivacy({ c }: { c: WorkshopCopy }) {
  return (
    <section id="privacy" aria-labelledby="privacy-title" className="sw-snow-bg scroll-mt-4 px-4 py-14 md:py-16">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm md:p-8">
        <h2 id="privacy-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
          Your privacy
        </h2>
        <p className="mt-4 text-lg font-bold text-gray-900">{PROMISE}</p>
        <div className="mt-4 space-y-3 text-gray-700">
          <p>{PRIVACY_ASKED}</p>
          <p>{PRIVACY_USE}</p>
          <p>{PRIVACY_WHO}</p>
          <p>
            On the form, one optional box reads: &ldquo;{PHOTO_BOX_LABEL}&rdquo; {PHOTO_BOX_HELPER}
          </p>
          <p>{c.privacy.keeping}</p>
          <p>{REMOVAL_SENTENCE}</p>
        </div>
        <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className={`inline-flex min-h-[44px] items-center ${TEXT_LINK}`}>
            Read the privacy policy
          </Link>
          <Link href="/connect" className={`inline-flex min-h-[44px] items-center ${TEXT_LINK}`}>
            Contact the club
          </Link>
        </p>
      </div>
    </section>
  );
}

export function WhereTheMoneyGoes({ facts }: { facts: WorkshopFacts }) {
  return (
    <section aria-labelledby="money-title" className="bg-white px-4 py-14 md:py-16">
      <div className="mx-auto max-w-3xl">
        <h2 id="money-title" className="sw-display text-3xl font-semibold text-lions-blue-dark">
          Where the money goes
        </h2>
        <p className="mt-4 text-gray-700">{facts.beneficiaries.sentence}</p>
      </div>
    </section>
  );
}

export function CollageLink({ c, collagePath }: { c: WorkshopCopy; collagePath: string }) {
  return (
    <section aria-label="Photos" className="bg-white px-4 py-8 text-center">
      <Link
        href={collagePath}
        className="inline-flex min-h-[44px] items-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
      >
        {c.thanks.collageLink}
      </Link>
    </section>
  );
}

export function ThankYou({ c, collagePath }: { c: WorkshopCopy; collagePath: string | null }) {
  return (
    <section aria-label="Thank you" className="bg-white px-4 py-14 text-center md:py-16">
      <div className="mx-auto max-w-3xl">
        {collagePath ? (
          <p>
            <Link
              href={collagePath}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
            >
              {c.thanks.collageLink}
            </Link>
          </p>
        ) : (
          <p className="text-gray-700">{c.thanks.noCollage}</p>
        )}
        <p className="mt-5 text-gray-700">{c.thanks.closing}</p>
      </div>
    </section>
  );
}

export function Questions() {
  return (
    <section aria-labelledby="questions-title" className="sw-snow-bg px-4 pb-6 pt-14 text-center">
      <h2 id="questions-title" className="sw-display text-2xl font-semibold text-lions-blue-dark">
        Questions?
      </h2>
      <p className="mt-2 text-gray-700">
        <Link href="/connect" className={TEXT_LINK}>
          Contact the club
        </Link>{" "}
        or write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}

export function PresentedBy({ c, host }: { c: WorkshopCopy; host: string }) {
  return (
    <section aria-label="Presented by" className="sw-snow-bg px-4 pb-16 pt-8 text-center">
      <p className="text-gray-700">Presented by the</p>
      <p className="sw-display text-2xl font-semibold text-lions-blue-dark">{host}</p>
      <p className="mt-2 text-gray-700">{c.presentedBy}</p>
      <div className="mt-5 flex justify-center">
        <Link href="/about" className={OUTLINE_BTN}>
          About the club
        </Link>
      </div>
    </section>
  );
}
