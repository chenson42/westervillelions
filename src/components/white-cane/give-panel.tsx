import Link from "next/link";
import { toEmbedUrl } from "@/lib/zeffy/embed-url";
import { ZEFFY_FORM_URL, type CampaignState } from "./campaign-facts";

const FOCUS = "focus:outline-none focus:ring-2 rounded";

export function GivePanel({
  state,
  variant,
}: {
  state: CampaignState;
  variant: "hero" | "closing" | "inline";
}) {
  const onDark = variant === "hero";
  const textLink = onDark
    ? `text-white underline hover:text-lions-gold focus:ring-white ${FOCUS}`
    : `text-lions-blue underline hover:text-lions-blue-dark focus:ring-lions-blue ${FOCUS}`;
  const outlined = onDark
    ? `border-2 border-white text-white hover:bg-white/10 focus:ring-white ${FOCUS}`
    : `border-2 border-lions-blue text-lions-blue hover:bg-lions-blue/5 focus:ring-lions-blue ${FOCUS}`;
  const btn = `inline-flex items-center justify-center min-h-[44px] px-6 py-3 rounded-lg font-semibold transition ${outlined}`;
  const solid = `inline-flex items-center justify-center min-h-[44px] px-6 py-3 rounded-lg font-semibold transition bg-lions-gold text-gray-900 hover:bg-lions-gold-dark focus:ring-lions-blue ${FOCUS}`;
  const newTab = (
    <a
      href={ZEFFY_FORM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-3 inline-flex items-center min-h-[44px] ${textLink}`}
    >
      Open the donation form in a new tab
    </a>
  );

  switch (state) {
    case "live":
      if (variant === "inline") {
        // The form itself, embedded without Zeffy's script: the iframe is all the
        // snippet's fallback block does, and our CSP already allows Zeffy frames.
        return (
          <div data-testid="white-cane-give-inline" className="max-w-2xl">
            <div className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white h-[760px]">
              <iframe
                title="Donation form powered by Zeffy"
                src={toEmbedUrl(ZEFFY_FORM_URL)}
                className="absolute inset-0 h-full w-full border-0"
                allow="payment"
              />
            </div>
            {newTab}
          </div>
        );
      }
      return (
        <div data-testid="white-cane-give" className="max-w-md">
          <a href="#give" className={solid}>
            Give to the White Cane campaign
          </a>
          <br />
          {newTab}
          {variant === "hero" && (
            <noscript>
              <p className="mt-2 text-sm">
                JavaScript is off, so use the link above to give. To give by check instead, see{" "}
                <Link href="/donate#other-ways-to-give" className="underline">
                  other ways to give
                </Link>
                .
              </p>
            </noscript>
          )}
        </div>
      );
    case "pre-form":
      return (
        <div
          data-testid="white-cane-give"
          className={`max-w-md rounded-2xl p-5 ${
            onDark ? "bg-white/10 border border-white/30" : "bg-gray-50 border border-gray-200"
          }`}
        >
          <p className="font-semibold text-lg">Our giving form opens soon</p>
          <p className={`mt-1 text-sm ${onDark ? "text-blue-100" : "text-gray-600"}`}>
            Check back in a few days. In the meantime you can give to the club&apos;s general fund.
          </p>
          <Link href="/donate" className={`mt-4 ${btn}`}>
            Give to our general fund
          </Link>
        </div>
      );
    case "closed":
      return (
        <div
          data-testid="white-cane-give"
          className={`max-w-md rounded-2xl p-5 ${
            onDark ? "bg-white/10 border border-white/30" : "bg-gray-50 border border-gray-200"
          }`}
        >
          <p className="font-semibold text-lg">This year’s campaign has closed. Thank you. The page opens again each September.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/donate" className={btn}>
              Visit our donate page
            </Link>
            <Link href="/join" className={btn}>
              Join the club
            </Link>
          </div>
        </div>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
