import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { GivePanel } from "@/components/white-cane/give-panel";
import { CaneHistory, CaneSources } from "@/components/white-cane/cane-history";
import { campaignState } from "@/components/white-cane/campaign-state";
import {
  CAMPAIGN_DATES_LABEL,
  FUNDED_PROJECTS,
  GENERIC_PURPOSE,
  GOAL_DOLLARS,
  HERO_IMAGE,
  RECEIPT_COPY,
  RECEIPT_VARIANT,
  ZEFFY_TIP_NOTE,
  type CampaignState,
} from "@/components/white-cane/campaign-facts";

export const revalidate = 300;

const TITLE = "White Cane Safety Day | Westerville Lions Club";
const DESCRIPTION =
  "Read the story of the white cane and the Lions, and give online to support the Westerville Lions Club's sight projects.";

export const metadata: Metadata = {
  // The root layout's title template appends " | Westerville Lions Club"; TITLE (with the suffix) is for Open Graph only.
  title: "White Cane Safety Day",
  description: DESCRIPTION,
  alternates: { canonical: "https://westervillelions.org/white-cane" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://westervillelions.org/white-cane",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/white-cane/og.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["https://westervillelions.org/images/white-cane/og.jpg"],
  },
};

function askLine(state: CampaignState): string {
  switch (state) {
    case "live":
    case "pre-form":
      return `Lions have backed the white cane since 1930. For White Cane Safety Day, give to the Westerville Lions Club's sight projects, ${CAMPAIGN_DATES_LABEL}.`;
    case "closed":
      return "Thank you for helping the Westerville Lions Club mark White Cane Safety Day. This page opens again each September.";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export default function WhiteCanePage() {
  const state = campaignState(new Date());
  const copy = RECEIPT_COPY[RECEIPT_VARIANT];
  const closed = state === "closed";

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">
            White Cane Safety Day
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
            In Ohio, drivers must yield to a white cane.
          </h1>
          <p className="text-xl text-blue-100 max-w-2xl leading-relaxed mb-6">{askLine(state)}</p>
          <GivePanel state={state} variant="hero" />
          {!closed && <p className="mt-4 text-sm text-blue-100 max-w-xl">{copy.trust}</p>}
          {HERO_IMAGE && (
            <div className="relative mt-8 aspect-[16/9] max-w-xl rounded-2xl overflow-hidden">
              <Image
                src={HERO_IMAGE.src}
                alt={HERO_IMAGE.alt}
                fill
                sizes="(min-width: 768px) 576px, 100vw"
                className="object-cover"
                priority
              />
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-4xl">
        {state === "live" && (
          <section id="give" aria-labelledby="give-heading" className="py-12 scroll-mt-4">
            <h2 id="give-heading" className="text-3xl font-bold text-lions-blue mb-6">
              Give to the White Cane campaign
            </h2>
            <GivePanel state={state} variant="inline" />
            <div className="mt-6 space-y-2 text-gray-700 max-w-2xl">
              <p>{ZEFFY_TIP_NOTE}</p>
              {copy.receipt && <p>{copy.receipt}</p>}
            </div>
          </section>
        )}

        <CaneHistory />

        <section aria-labelledby="gift-heading" className="py-12 border-t border-gray-100">
          <h2 id="gift-heading" className="text-3xl font-bold text-lions-blue mb-6">
            {closed ? "What gifts supported" : "What your gift does"}
          </h2>
          {FUNDED_PROJECTS.length === 0 ? (
            <p className="text-gray-700 text-lg leading-relaxed">
              {closed ? "Gifts supported the Lions' sight projects." : GENERIC_PURPOSE}
            </p>
          ) : (
            <ul className="space-y-4">
              {FUNDED_PROJECTS.map((p) => (
                <li key={p.name} className="bg-white rounded-2xl shadow-sm p-5">
                  <p className="font-bold text-lions-blue">{p.name}</p>
                  <p className="text-gray-700 mt-1">{p.blurb}</p>
                </li>
              ))}
            </ul>
          )}
          {GOAL_DOLLARS !== null && (
            <p className="mt-4 text-gray-700">
              Our goal is ${GOAL_DOLLARS.toLocaleString("en-US")}.
            </p>
          )}
        </section>

        <section aria-labelledby="club-heading" className="py-12 border-t border-gray-100">
          <h2 id="club-heading" className="text-3xl font-bold text-lions-blue mb-6">
            About the Westerville Lions Club
          </h2>
          <p className="text-gray-700 text-lg leading-relaxed mb-4">
            We are neighbors serving Westerville, Ohio since 1928, through youth programs, hunger
            relief and community projects as well as sight. Every month we collect used eyeglasses
            for people who need them.
          </p>
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <Link
              href="/about"
              className="inline-flex items-center min-h-[44px] font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              About the club
            </Link>
            <Link
              href="/programs"
              className="inline-flex items-center min-h-[44px] font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              Our programs
            </Link>
          </p>
        </section>

        <section aria-labelledby="give-again-heading" className="py-12 border-t border-gray-100">
          <h2 id="give-again-heading" className="text-3xl font-bold text-lions-blue mb-6">
            {closed ? "Thank you" : "Ready to give?"}
          </h2>
          <GivePanel state={state} variant="closing" />
          {!closed && (
            <div className="mt-6 space-y-2 text-gray-700 max-w-2xl">
              {state !== "live" && <p>{ZEFFY_TIP_NOTE}</p>}
              {state !== "live" && copy.receipt && <p>{copy.receipt}</p>}
              <p>
                <Link
                  href="/donate#other-ways-to-give"
                  className="inline-flex items-center min-h-[44px] text-lions-blue underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  Prefer to give by check?
                </Link>
              </p>
            </div>
          )}
        </section>

        <footer className="py-8 border-t border-gray-100 space-y-3">
          <CaneSources />
          <p className="text-sm text-gray-600">
            Questions about a gift?{" "}
            <Link
              href="/connect"
              className="text-lions-blue underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              Contact the club
            </Link>
            . See our{" "}
            <Link
              href="/privacy"
              className="text-lions-blue underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              privacy policy
            </Link>
            .
          </p>
        </footer>
      </div>
    </div>
  );
}
