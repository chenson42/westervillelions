// The four landing-page states. State lives in client context, never in the URL.

import { formatLongDate, PRICE_DOLLARS, REGISTRATION_OPENS, SPOT_CAP } from "./event-facts";

export const LANDING_STATES = ["before", "open", "full", "after"] as const;
export type LandingState = (typeof LANDING_STATES)[number];

export type FormCardKind = "opens-soon" | "form" | "full" | "thanks";

export interface LandingStateCopy {
  label: string;
  heroEyebrow: string;
  heroTitle: string;
  heroLead: string;
  /** null = no call to action at all */
  ctaLabel: string | null;
  ctaEnabled: boolean;
  formCard: FormCardKind;
  pinnedReserve: boolean;
}

const TITLE = "A Visit to Santa's Workshop";

export const LANDING_STATE_COPY: Record<LandingState, LandingStateCopy> = {
  before: {
    label: "Before it opens",
    heroEyebrow: "Westerville Lions Club presents",
    heroTitle: TITLE,
    heroLead:
      "Your favorite stuffed animal is invited on a train ride to the North Pole. Have a look around; sign-ups open soon.",
    ctaLabel: `Registration opens ${formatLongDate(REGISTRATION_OPENS)}`,
    ctaEnabled: false,
    formCard: "opens-soon",
    pinnedReserve: false,
  },
  open: {
    label: "Open",
    heroEyebrow: "Westerville Lions Club presents",
    heroTitle: TITLE,
    heroLead:
      "Send your favorite stuffed animal on a train ride to the North Pole. It will meet Santa, help in the workshop, and come home with a memory book.",
    ctaLabel: `Reserve a spot, $${PRICE_DOLLARS} per stuffy`,
    ctaEnabled: true,
    formCard: "form",
    pinnedReserve: true,
  },
  full: {
    label: "Full",
    heroEyebrow: "Westerville Lions Club presents",
    heroTitle: TITLE,
    heroLead:
      "Every seat on this year's train has been claimed. Thank you for the warm welcome, and please come back next December.",
    ctaLabel: `All ${SPOT_CAP} spots are taken, thank you`,
    ctaEnabled: false,
    formCard: "full",
    pinnedReserve: false,
  },
  after: {
    label: "After the event",
    heroEyebrow: "Westerville Lions Club presents",
    heroTitle: "Thank you for riding with us",
    heroLead:
      "The stuffies are home, the reindeer are resting, and Santa says thank you. See you next December.",
    ctaLabel: null,
    ctaEnabled: false,
    formCard: "thanks",
    pinnedReserve: false,
  },
};

export function isLandingState(x: unknown): x is LandingState {
  return typeof x === "string" && (LANDING_STATES as readonly string[]).includes(x);
}
