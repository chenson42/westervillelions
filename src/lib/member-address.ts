/**
 * Shared address-formatting helper for the Printable Member Directory
 * (2026-08-07). Used by both the on-screen directory
 * (member-directory.tsx) and the print-only view
 * (member-directory-print.tsx) so the "never render an empty label or a
 * stray comma" rule from the Phase 1/3 design lives in exactly one place.
 */

export interface MemberAddressFields {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Joins city/state/zip without a stray leading/trailing comma when one or
 * more parts are missing, e.g.:
 *   ("Westerville", "OH", "43081") -> "Westerville, OH 43081"
 *   (null, "OH", "43081")          -> "OH 43081"
 *   ("Westerville", null, null)    -> "Westerville"
 *   (null, null, null)             -> ""
 */
export function formatCityStateZip(
  city: string | null,
  state: string | null,
  zip: string | null,
): string {
  const stateZip = [state, zip].filter(Boolean).join(" ");
  return [city, stateZip].filter(Boolean).join(", ");
}

/** True if any address field is present — the signal for whether a member's
 *  address block should render at all. */
export function hasAnyAddress(member: MemberAddressFields): boolean {
  return Boolean(member.address || member.city || member.state || member.zip);
}
