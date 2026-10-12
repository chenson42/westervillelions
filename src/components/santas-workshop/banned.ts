// Banned patterns for the page's visible text, metadata and events-row text.
// A test table, so a failure names the reason. Not imported by app code.

export const BANNED: readonly [RegExp, string][] = [
  [/donat/i, "this is a ticket, never a donation"],
  [/\btax/i, "no tax claims"],
  [/deductible/i, "no deductibility claims"],
  [/\bgifts?\b/i, "ticket, not gift"],
  [/contribut/i, "ticket, not contribution"],
  [/sold out/i, "no cap, so no scarcity"],
  [/\blimited\b/i, "no cap, so no scarcity"],
  [/\bspots?\b/i, "no cap, so no spots"],
  [/\bfull\b/i, "no cap, so never full"],
  [/capacity/i, "no cap"],
  [/waitlist/i, "no cap"],
  [/hurry/i, "no false urgency"],
  [/last chance/i, "no false urgency"],
  [/filling fast/i, "no false urgency"],
  [/\bonly \d+ left/i, "no false urgency"],
  [/all proceeds/i, "beneficiaries sentence is net of costs"],
  [/100\s*%/i, "beneficiaries sentence is net of costs"],
  [/in partnership/i, "organizations have not agreed to this"],
  [/\bbenefit/i, "beneficiaries sentence is net of costs"],
  [/memory book/i, "superseded plan"],
  [/preschool/i, "no preschools"],
  [/stuffed animal/i, "say stuffy"],
  [/\bproposed\b/i, "dates are decided"],
  [/conductor/i, "superseded prototype wording"],
  [/\bstamp/i, "no stamp is promised"],
  [/train ticket/i, "not promised"],
  [/your confirmation/i, "the name on the order is the key"],
  [/show your ticket/i, "the name on the order is the key"],
  [/QR card/i, "not promised"],
  [/follow your stuffy/i, "not in year one"],
  [/allerg(y|ies)|allergen-free/i, "snack is a preference, not a medical request"],
  [/\bsafe(ly)?\b/i, "no safety promise about snacks"],
];

export function bannedHits(text: string): string[] {
  return BANNED.filter(([re]) => re.test(text)).map(([re, why]) => `${re} (${why})`);
}
