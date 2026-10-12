import {
  CAMPAIGN_WINDOW,
  ZEFFY_FORM_URL,
  type CampaignState,
} from "./campaign-facts";

/** Eastern calendar day of an instant as "YYYY-MM-DD" (a string, so no local-time Date hazard). */
export function easternDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * closed: the Eastern month-day is outside [opens, end] (takes precedence), so the
 * page shows a thank-you from Nov 1 until Sep 15 of the next year without a deploy.
 * pre-form: no Zeffy link yet. live: otherwise. The Oct 15 start is copy, not a gate.
 */
export function campaignState(
  now: Date,
  formUrl: string = ZEFFY_FORM_URL,
  window: { opens: string; end: string } = CAMPAIGN_WINDOW,
): CampaignState {
  const monthDay = easternDateString(now).slice(5); // "MM-DD"
  if (monthDay < window.opens || monthDay > window.end) return "closed";
  if (formUrl.trim() === "") return "pre-form";
  return "live";
}
