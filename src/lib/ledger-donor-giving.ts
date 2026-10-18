/**
 * Donor giving totals (B-172, ruling 4). Client-safe and pure. A donor's
 * lifetime total counts only gifts to a tax-deductible entity: a gift keyed
 * into Public Funds is not yet a Foundation gift, and once swept the
 * Foundation copy carries the same donor, so counting both would double it.
 */
export interface GivingRowForTotal {
  amountCents: number;
  entityDonationsDeductible: boolean;
}

export function sumDeductibleGiving(rows: readonly GivingRowForTotal[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.entityDonationsDeductible) total += r.amountCents;
  }
  return total;
}
