/**
 * Eastern calendar day of an instant as "YYYY-MM-DD". A string on purpose: callers
 * compare it as a string, so no local-time Date hazard and no UTC off-by-five-hours.
 * Shared by the White Cane campaign window and the Santa's Workshop sign-up state.
 */
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
