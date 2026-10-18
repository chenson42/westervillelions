/**
 * Server-side fund-name lookup (DECISION-127). DB-importing; the pure module
 * is `ledger-fund-labels.ts`. Callers that already hold fund rows build labels
 * with `buildFundLabels()` instead of paying for this query.
 */
import { cache } from "react";
import { db } from "@/lib/db";
import { ledgerFunds } from "@/lib/db/schema";
import { buildFundLabels, type FundLabels } from "@/lib/ledger-fund-labels";

/** One select, cached per request. Falls back to defaults for any kind with no row. */
export const getFundLabels = cache(async (): Promise<FundLabels> => {
  const rows = await db
    .select({ kind: ledgerFunds.kind, name: ledgerFunds.name, isActive: ledgerFunds.isActive })
    .from(ledgerFunds);
  return buildFundLabels(rows);
});
