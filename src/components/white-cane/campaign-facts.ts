// Everything on the White Cane page that changes before launch or next year
// lives in this one module The page
// reads no database; edit this file and redeploy.

/** Zeffy share link, e.g. https://www.zeffy.com/donation-form/<id>. Empty until the form exists. */
export const ZEFFY_FORM_URL: string =
  "https://www.zeffy.com/en-US/donation-form/white-cane-2026-westerville-lions-club";

export const CAMPAIGN_NAME = "White Cane";

/**
 * The page is reused every year, so the window is month-day only ("MM-DD",
 * Eastern calendar, never parsed with new Date). `opens` is when the page
 * stops showing last year's thank-you and shows the form again (so it can be
 * proofed before the poster goes up); `start` is copy only; `end` closes it.
 */
export const CAMPAIGN_WINDOW = { opens: "09-15", start: "10-15", end: "10-31" } as const;

export const CAMPAIGN_DATES_LABEL = "October 15 through October 31";

/** Shown only when set. The thermometer itself belongs to Zeffy. */
export const GOAL_DOLLARS: number | null = null;

/** Board-named recipients. Empty renders the generic sentence and names nobody. */
export const FUNDED_PROJECTS: readonly { name: string; blurb: string }[] = [];

export const GENERIC_PURPOSE = "Your gift supports the Lions' sight projects.";

export type CampaignState = "pre-form" | "live" | "closed";

export type ReceiptVariant = "foundation" | "club" | "unknown";

/** The single selector for what the page may say about receipts and deductibility. */
// Confirmed by the user 2026-10-12: the same Zeffy account as /donate, registered to the Foundation.
export const RECEIPT_VARIANT: ReceiptVariant = "foundation";

export const RECEIPT_COPY: Record<ReceiptVariant, { trust: string; receipt: string }> = {
  foundation: {
    trust:
      "Gifts are received by the Westerville Lions Club Foundation, a 501(c)(3) nonprofit, and are tax-deductible as allowed by law. EIN 32-0467239.",
    receipt: "Zeffy emails you a receipt for your records.",
  },
  club: {
    trust:
      "Gifts go to the Westerville Lions Club and are not tax-deductible as charitable contributions.",
    receipt: "",
  },
  unknown: {
    trust: "Gifts are processed by Zeffy, a donation platform for nonprofits.",
    receipt: "",
  },
};

export const ZEFFY_TIP_NOTE =
  "At checkout, Zeffy, the platform that processes gifts, offers an optional contribution to itself. You can set it to $0 and your gift to the Lions is unchanged.";

export const HERO_IMAGE: { src: string; alt: string } | null = {
  src: "/images/white-cane/hero.jpg",
  alt: "Illustration of a white cane with a red band on a brick sidewalk in autumn.",
};

export const HISTORY: readonly { year: string; text: string }[] = [
  {
    year: "1930",
    text: "In Peoria, Illinois, the Lions Club, led by its president George A. Bonham, painted canes white with a red band after Bonham watched a blind man cross the street with a black cane no driver could see. On December 9, 1930, Peoria passed the first white cane right-of-way ordinance.",
  },
  {
    year: "1931",
    text: "Lions Clubs International adopted the white cane program at its convention in Toronto.",
  },
  {
    year: "1964",
    text: "Public Law 88-628, signed October 6, 1964, set aside October 15 as White Cane Safety Day, proclaimed by the President each year.",
  },
  {
    year: "2011",
    text: "October 15 also became Blind Americans Equality Day.",
  },
  {
    year: "In Ohio",
    text: "Ohio Revised Code 4511.47 requires drivers to yield to a pedestrian who is using a guide dog or a predominantly white or metallic cane.",
  },
];

export const SOURCES: readonly { label: string; href: string }[] = [
  {
    label: "Lions Clubs International, White Cane Safety Day",
    href: "https://www.lionsclubs.org/en/resources-for-members/resource-center/white-cane-safety-day",
  },
  { label: "American Council of the Blind", href: "https://www.acb.org/node/7481" },
  {
    label: "Ohio Revised Code 4511.47",
    href: "https://codes.ohio.gov/ohio-revised-code/section-4511.47",
  },
];
