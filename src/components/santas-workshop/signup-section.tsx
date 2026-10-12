import Link from "next/link";
import { toEmbedUrl } from "@/lib/zeffy/embed-url";
import type { WorkshopFacts } from "@/lib/santas-workshop/facts";
import { CONTACT_LINK_LABEL, FORM_CLOSED_LEAD, NEW_TAB_LABEL, NOSCRIPT_TEXT, NOT_READY_HEADLINE, NOT_READY_LEAD, SIGNUP_FRAME_TITLE, ZEFFY_TIP_NOTE, type WorkshopCopy } from "./copy";

const FOCUS = "focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";
const LINK = `font-semibold text-lions-blue underline hover:text-lions-blue-dark ${FOCUS}`;

/**
 * The only place the Zeffy URL is rendered, and only while the page is open
 * (the caller renders this section in the open state only).
 */
export function SignupSection({ facts, c }: { facts: WorkshopFacts; c: WorkshopCopy }) {
  const url = facts.zeffyShareUrl;
  const available = url !== "";

  return (
    <section
      id="signup"
      aria-labelledby="signup-title"
      data-testid="workshop-signup"
      className="sw-snow-bg scroll-mt-4 px-4 py-14 md:py-16"
    >
      <div className="mx-auto max-w-3xl">
        <h2 id="signup-title" className="sw-display text-3xl font-semibold text-lions-blue-dark md:text-4xl">
          {c.signup.heading}
        </h2>

        {available ? (
          <>
            <p className="mt-4 text-lg text-gray-800">{c.signup.priceLine}</p>
            <p className="mt-2 text-gray-700">{c.signup.photosPointer}</p>
            <div className="mt-5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
              >
                {NEW_TAB_LABEL}
              </a>
            </div>
            <div
              data-testid="workshop-signup-frame"
              className="relative mt-5 h-[900px] w-full overflow-hidden rounded-2xl border border-gray-200 bg-white sm:h-[820px]"
            >
              <iframe
                title={SIGNUP_FRAME_TITLE}
                src={toEmbedUrl(url)}
                loading="lazy"
                allow="payment"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
            <p className="mt-4 text-sm text-gray-700">{ZEFFY_TIP_NOTE}</p>
            <p className="mt-2 text-sm text-gray-700">
              {FORM_CLOSED_LEAD}{" "}
              <Link href="/connect" className={LINK}>
                {CONTACT_LINK_LABEL}
              </Link>
              .
            </p>
            <p className="mt-2 text-sm font-semibold text-gray-900">{c.signup.closeLine}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 inline-flex min-h-[44px] items-center ${LINK}`}
            >
              {NEW_TAB_LABEL}
            </a>
            <noscript>
              <p className="mt-3 text-gray-800">
                {NOSCRIPT_TEXT}{" "}
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-lions-blue underline">
                  Open the sign-up form
                </a>
                .
              </p>
            </noscript>
          </>
        ) : (
          <div className="mt-5 rounded-2xl bg-gray-50 p-8 text-center text-gray-700">
            <p className="text-lg font-semibold text-gray-900">{NOT_READY_HEADLINE}</p>
            <p className="mt-2">
              {NOT_READY_LEAD}{" "}
              <Link href="/connect" className={LINK}>
                {CONTACT_LINK_LABEL}
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
