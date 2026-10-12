// All page prose that more than one place prints, plus every metadata string.
// Pure (no JSX). Dates, times and price are rendered from the facts, never typed
// here. copy.test.ts scans every string for banned words (donation, tax,
// scarcity, and the rest); workshop-page.test.tsx scans the rendered text.

import { formatDateRange, formatLongDate, formatMonthDay, formatShortDate, formatTimeRange, formatWeekday } from "@/lib/santas-workshop/format";
import type { WorkshopFacts } from "@/lib/santas-workshop/facts";

// ---- Verbatim strings shared with the Zeffy form and /privacy ----

export const PROMISE = "We photograph stuffies only, never the children.";

export const PHOTO_BOX_LABEL =
  "Yes, you may show my stuffy's portrait in the public photo collage. Anyone with the collage link can see it. The collage shows stuffies, never children, and never a child's name.";

export const PHOTO_BOX_HELPER =
  "If you leave this unchecked, your stuffy's portrait goes only on your own printed frame. Your stuffy may still appear in group pictures with other stuffies.";

export const SNACK =
  "We will offer a snack at drop-off and pickup. This is a preference, not a medical request, and we cannot promise that any snack is free of allergens.";

export const SNACK_CHOICES = "Choices on the form are regular, nut-free, dairy-free, gluten-free or no snack.";

export const ZEFFY_TIP_NOTE =
  "At checkout, Zeffy, the platform that processes tickets, offers an optional tip to itself. You can set it to $0 and your ticket is still $15.";

export const REMOVAL_SENTENCE = "Changed your mind? Contact the club and we will take it down.";

export const COLLAGE_KEEPING =
  "The collage and portraits stay online through the end of January 2027, and sooner if you ask us to take your stuffy down.";

export const SIGNUP_FRAME_TITLE = "Sign-up form for A Visit to Santa's Workshop, powered by Zeffy";

export const CONTACT_EMAIL = "info@westervillelions.org";

export const LOSS_NOTE =
  "Please leave behind any accessory that cannot be replaced. The Lions take great care, but cannot be responsible for loss or damage.";

export const PHOTO_STORAGE =
  "Photos will be kept in the club's own online storage, and frames are printed at a photo printing service.";

export const NOT_READY_HEADLINE = "The sign-up form is not ready yet.";
export const NOT_READY_LEAD = "Please check back soon, or";
export const FORM_CLOSED_LEAD = "If the form says sign-ups are closed,";
export const CONTACT_LINK_LABEL = "contact the club";
export const NOSCRIPT_TEXT = "The sign-up form needs JavaScript. Open it in a browser that allows it, or contact the club.";
export const NEW_TAB_LABEL = "Open the sign-up form in a new tab";

export const STORY: readonly string[] = [
  "Every December, a little train sets out for the North Pole. This year it has room for your child's favorite stuffy.",
  "On Friday evening you drop your stuffy off at IHOP. On Saturday it has its portrait taken with Santa and Mrs. Claus, along with a crowd of other stuffies. On Sunday you pick it up with a printed frame of its picture.",
  "It is a small way to make the season feel big, from your neighbors at the Westerville Lions Club.",
];

export const WHAT_TO_BRING: readonly string[] = [
  "One stuffy for each ticket, clean and ready to travel.",
  "Nothing else. A receipt is handy but not required; we find you by the name on the order.",
  "Anything we should know, like a loose eye or a favorite night-light, goes in the care note on the sign-up form.",
];

export const AUDIENCE = "Made for young children and their favorite stuffy. Anyone is welcome to send a stuffy.";

export const PRIVACY_ASKED =
  "When you sign up, Zeffy asks for your name, email and mobile number, your stuffy's name and what it is, and a snack preference. A child's first name, a care note and a note to Santa are optional.";
export const PRIVACY_USE =
  "We use these only to run the weekend: to find your stuffy, to reach you about it, and to offer a snack. We never sell or rent them.";
export const PRIVACY_WHO =
  "Zeffy takes your payment and keeps its own record of your order. The club's volunteers see your answers. " + PHOTO_STORAGE;

// ---- Facts-derived copy ----

export interface Faq {
  q: string;
  a: string;
}

export interface DayCard {
  key: "dropoff" | "photos" | "pickup";
  date: string;
  title: string;
  body: string;
}

export function workshopCopy(f: WorkshopFacts) {
  const place = `${f.place.name}, ${f.place.town}`;
  const price = `$${f.priceDollars}`;
  const dropoffRange = formatTimeRange(f.windows[0].start, f.windows[f.windows.length - 1].end);
  const windowLabels = f.windows.map((w) => formatTimeRange(w.start, w.end));
  const pickupRange = formatTimeRange(f.pickup.start, f.pickup.end);
  const dropoffDay = formatLongDate(f.dates.dropoff);
  const pickupDay = formatLongDate(f.dates.pickup);
  const windowList = `${windowLabels.slice(0, -1).join(", ")} or ${windowLabels[windowLabels.length - 1]}`;
  const dropoffBetween = dropoffRange.replace(" to ", " and ");
  const pickupBetween = pickupRange.replace(" to ", " and ");
  const opensLong = formatLongDate(f.registrationOpens);
  const lastDayLong = formatLongDate(f.lastSignupDay);

  const description = `Bring your favorite stuffy to meet Santa and Mrs. Claus. Drop off ${formatWeekday(f.dates.dropoff)}, ${formatMonthDay(f.dates.dropoff)} and pick up ${formatWeekday(f.dates.pickup)}, ${formatMonthDay(f.dates.pickup)} at ${f.place.name} in ${f.place.town}. ${price} per stuffy, from the ${f.host}.`;

  const days: DayCard[] = [
    {
      key: "dropoff",
      date: formatShortDate(f.dates.dropoff),
      title: "Drop off your stuffy",
      body: `Come to ${place}, between ${dropoffBetween}. When you sign up you pick one of ${f.windows.length === 3 ? "three" : String(f.windows.length)} one-hour windows: ${windowList}. Running late within those hours? Come anyway. We check your stuffy in with a quick photo.`,
    },
    {
      key: "photos",
      date: formatShortDate(f.dates.photos),
      title: "Photo day",
      body: "Your stuffy has its portrait taken with Santa and Mrs. Claus and joins group pictures with other stuffies. You do not need to be there. The pictures go online that evening.",
    },
    {
      key: "pickup",
      date: formatShortDate(f.dates.pickup),
      title: "Pick up your stuffy",
      body: `Come to ${place}, between ${pickupBetween}. Give the name on the order and we will find your stuffy. It comes home with a printed 4x6 frame of its portrait.`,
    },
  ];

  const afterYouRegister: readonly string[] = [
    "Zeffy emails your receipt to the address you gave. No email within an hour? Check your spam folder, then write to the club.",
    `${formatLongDate(f.dates.dropoff)}: drop off at ${place}, in the window you chose, between ${dropoffBetween}.`,
    "Bring one stuffy for each ticket. You do not need to bring your receipt.",
    `${formatLongDate(f.dates.photos)}: your stuffy has its portrait taken. You do not need to be there.`,
    `${pickupDay}, ${pickupRange}: pick up at ${place}. Give the name on the order.`,
    "Questions? Contact the club.",
  ];

  const faqs: Faq[] = [
    { q: "How much does it cost?", a: `${price} per stuffy. Each ticket is for one stuffy.` },
    { q: "Who is it for?", a: AUDIENCE },
    {
      q: "How many stuffies can I send?",
      a: "As many as you like. Buy one ticket for each and fill in the details for each stuffy.",
    },
    { q: "What if I lose my receipt?", a: "You do not need it. Give the name on the order at pickup." },
    { q: "What about snacks?", a: `${SNACK} ${SNACK_CHOICES}` },
    {
      q: "Will my stuffy's picture be online?",
      a: "Your stuffy's portrait appears in the public photo collage only if you say yes on the sign-up form. Group pictures show whoever is in them. The details are under Your privacy.",
    },
  ];

  return {
    title: f.title,
    host: f.host,
    place,
    price,
    pricePerStuffy: `${price} per stuffy`,
    dateRange: formatDateRange(f.dates),
    windowLabels,
    pickupRange,
    dropoffRange,
    meta: {
      title: f.title,
      description,
      ogTitle: `${f.title} | ${f.host}`,
    },
    hero: {
      eyebrow: `${f.host} presents`,
      leadOpen: `Bring your favorite stuffy to meet Santa and Mrs. Claus. You drop it off on ${dropoffDay}, and pick it up on ${pickupDay}.`,
      leadClosed: "Thank you for the warm welcome. Sign-ups for this year are closed. Here is how the weekend works.",
      leadAfter: "The stuffies are home and Santa says thank you.",
      titleAfter: "Thank you for riding with us",
      statusBefore: `Registration opens ${opensLong}`,
      ctaOpen: `Sign up, ${price} per stuffy`,
      statusClosed: "Sign-ups for this year are closed",
      statusNotReady: "The sign-up form is coming soon",
    },
    signup: {
      heading: "Sign up for the weekend",
      priceLine: `${price} per stuffy. Each ticket is for one stuffy: for two stuffies, buy two tickets and fill in the details for each.`,
      closeLine: `Sign-ups close ${lastDayLong}.`,
      photosPointer: "Before you sign up, read how we handle photos under Your privacy.",
    },
    days,
    afterYouRegister,
    faqs,
    privacy: {
      keeping: `${COLLAGE_KEEPING} We delete sign-up details from the club's records by ${formatMonthDay(f.signupDataDeletedBy)}, ${f.signupDataDeletedBy.slice(0, 4)}.`,
    },
    thanks: {
      collageLink: "See the photos from the weekend",
      noCollage: "Photos: contact the club and we will point you to them.",
      closing: "We hope to see you again.",
    },
    presentedBy: "Neighbors serving Westerville since 1928.",
  };
}

export type WorkshopCopy = ReturnType<typeof workshopCopy>;
