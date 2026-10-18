/**
 * Resolve the Club's public fund display name from the database, so a spec never
 * hard-codes it (DECISION-127). The stored `ledger_funds.name` is the one source:
 * a long-lived dev database still reads "Activity Fund" until someone renames it
 * in the fund editor, a fresh install (migration 0044) seeds "Public Funds", and
 * a QA run may have renamed it to anything. A spec that typed either literal broke
 * on the other.
 *
 * Uses the same `buildFundLabels()` the app uses (first active row per kind wins,
 * default when no row), so the spec and the page agree on the name by construction.
 */
import { db } from "../../src/lib/db";
import { ledgerFunds } from "../../src/lib/db/schema";
import { buildFundLabels, type FundLabels } from "../../src/lib/ledger-fund-labels";

export async function getFundLabels(): Promise<FundLabels> {
  const rows = await db
    .select({ kind: ledgerFunds.kind, name: ledgerFunds.name, isActive: ledgerFunds.isActive })
    .from(ledgerFunds);
  return buildFundLabels(rows);
}

/** The Club's public (activity-kind) fund's stored display name. */
export async function getActivityFundName(): Promise<string> {
  return (await getFundLabels()).activity;
}
