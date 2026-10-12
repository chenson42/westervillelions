import {
  CAMPAIGN_WINDOW,
  ZEFFY_FORM_URL,
  type CampaignState,
} from "./campaign-facts";
import { easternDateString } from "@/lib/eastern-date";

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
