// The Santa's Workshop facts: data only. Prose lives in copy.ts and the
// components. Pure and client-safe. The page reads these through the async
// loader in public-facts.ts, so a later swap to another source is one function.
//
// To stop sign-ups early, set lastSignupDay to yesterday's date and deploy
// (and end ticket sales in Zeffy first: the page cannot see Zeffy's window).

import { weekdayIndex } from "./format";

export interface DropoffWindow {
  id: string;
  /** "HH:mm" 24h wall clock. The label is derived, never stored. */
  start: string;
  end: string;
}

export interface WorkshopFacts {
  title: string;
  host: string;
  priceDollars: number;
  /** Eastern calendar days, "YYYY-MM-DD". */
  dates: { dropoff: string; photos: string; pickup: string };
  /** Sign-ups are open from 00:00 Eastern on this day. */
  registrationOpens: string;
  /** Last Eastern day sign-ups are open, inclusive. */
  lastSignupDay: string;
  windows: readonly DropoffWindow[];
  pickup: { start: string; end: string };
  place: { name: string; town: string };
  /** The Zeffy public share link. "" until the form exists. */
  zeffyShareUrl: string;
  beneficiaries: { names: readonly string[]; sentence: string };
  /** Sign-up details are deleted from the club's records by this Eastern day. */
  signupDataDeletedBy: string;
  /** Path of the published photo collage, or null until one exists. */
  collagePath: string | null;
}

export const COLLAGE_PATH_PREFIX = "/santas-workshop/c/";

export const WORKSHOP_2026: WorkshopFacts = {
  title: "A Visit to Santa's Workshop",
  host: "Westerville Lions Club",
  priceDollars: 15,
  dates: { dropoff: "2026-12-18", photos: "2026-12-19", pickup: "2026-12-20" },
  registrationOpens: "2026-11-08",
  lastSignupDay: "2026-12-16",
  windows: [
    { id: "fri-1600", start: "16:00", end: "17:00" },
    { id: "fri-1700", start: "17:00", end: "18:00" },
    { id: "fri-1800", start: "18:00", end: "19:00" },
  ],
  pickup: { start: "13:00", end: "15:00" },
  place: { name: "IHOP", town: "Westerville" },
  zeffyShareUrl: "",
  beneficiaries: {
    names: ["Central Ohio Diabetes Association", "Ohio Lions Pediatric Cancer Foundation"],
    sentence:
      "What is left after the cost of the event supports the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation.",
  },
  signupDataDeletedBy: "2027-01-31",
  collagePath: null,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function nextDay(s: string): string {
  const dt = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + 1));
  return dt.toISOString().slice(0, 10);
}

/** Problems with a facts object; an empty array means valid. Enforced in CI, not at runtime. */
export function validateWorkshopFacts(f: WorkshopFacts): string[] {
  const problems: string[] = [];

  const dayFields: [string, string][] = [
    ["dates.dropoff", f.dates.dropoff],
    ["dates.photos", f.dates.photos],
    ["dates.pickup", f.dates.pickup],
    ["registrationOpens", f.registrationOpens],
    ["lastSignupDay", f.lastSignupDay],
    ["signupDataDeletedBy", f.signupDataDeletedBy],
  ];
  let datesOk = true;
  for (const [name, v] of dayFields) {
    if (!isRealDay(v)) {
      problems.push(`${name} is not a real YYYY-MM-DD date`);
      datesOk = false;
    }
  }

  if (datesOk) {
    if (weekdayIndex(f.dates.dropoff) !== 5) problems.push("dates.dropoff is not a Friday");
    if (weekdayIndex(f.dates.photos) !== 6) problems.push("dates.photos is not a Saturday");
    if (weekdayIndex(f.dates.pickup) !== 0) problems.push("dates.pickup is not a Sunday");
    if (nextDay(f.dates.dropoff) !== f.dates.photos || nextDay(f.dates.photos) !== f.dates.pickup) {
      problems.push("the event days are not consecutive");
    }
    if (f.lastSignupDay < f.registrationOpens) problems.push("lastSignupDay is before registrationOpens");
    if (f.lastSignupDay >= f.dates.dropoff) problems.push("lastSignupDay is not before the drop-off day");
    if (f.signupDataDeletedBy <= f.dates.pickup) problems.push("signupDataDeletedBy is not after pickup");
  }

  if (f.windows.length === 0) problems.push("there are no drop-off windows");
  f.windows.forEach((w, i) => {
    if (!HHMM.test(w.start) || !HHMM.test(w.end)) problems.push(`window ${w.id} has a malformed time`);
    else if (w.start >= w.end) problems.push(`window ${w.id} does not start before it ends`);
    const prev = f.windows[i - 1];
    if (prev && HHMM.test(prev.end) && HHMM.test(w.start) && prev.end !== w.start) {
      problems.push(`windows ${prev.id} and ${w.id} overlap or leave a gap`);
    }
  });

  if (!HHMM.test(f.pickup.start) || !HHMM.test(f.pickup.end) || f.pickup.start >= f.pickup.end) {
    problems.push("pickup does not start before it ends");
  }

  if (!Number.isInteger(f.priceDollars) || f.priceDollars <= 0) {
    problems.push("priceDollars is not a positive integer");
  }

  if (f.zeffyShareUrl !== "") {
    let url: URL | null = null;
    try {
      url = new URL(f.zeffyShareUrl);
    } catch {
      problems.push("zeffyShareUrl is not a URL");
    }
    if (url) {
      if (url.protocol !== "https:" || url.hostname !== "www.zeffy.com") {
        problems.push("zeffyShareUrl is not an https://www.zeffy.com/ URL");
      }
      if (/\/donation-form\//.test(url.pathname)) {
        problems.push("zeffyShareUrl is a donation-form link, not a ticketing link");
      }
      if (url.search !== "" || url.hash !== "") {
        problems.push("zeffyShareUrl must not carry a query string or fragment");
      }
    }
  }

  if (f.collagePath !== null && !f.collagePath.startsWith(COLLAGE_PATH_PREFIX)) {
    problems.push(`collagePath must start with ${COLLAGE_PATH_PREFIX}`);
  }

  if (f.beneficiaries.names.length === 0) problems.push("beneficiaries has no names");
  for (const n of f.beneficiaries.names) {
    if (!f.beneficiaries.sentence.includes(n)) problems.push(`beneficiary "${n}" is missing from the sentence`);
  }

  return problems;
}
