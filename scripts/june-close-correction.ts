/**
 * June 2026 close correction — Club/Administrative entity (treasurer-approved
 * 2026-07-28). One additive correction against a row the Chase bank statement
 * (…8338) shows that neither the treasurer's Quicken register (stops
 * 6/10/2026) nor The Ledger has, plus a non-destructive beneficiary_cause fix
 * on two mistagged American Legion Post 171 checks.
 *
 * CORRECTION 1 — INSERT one missing Club/Administrative June 2026 transaction:
 *   - -$319.80 expense, 2026-06-26, party "Eventeny", category "Marketing",
 *     payment_method debit_card, memo notes "Fourth Friday"
 *
 * NOT INCLUDED — the $696.00 "Zeffy" dues deposit dated 2026-06-29 was
 * DELIBERATELY DROPPED from this script's scope after a read-only
 * verification pass (2026-07-28) proved inserting it would DOUBLE-COUNT
 * income. Production already carries 17 individual member
 * payment_method='zeffy' dues rows (already reconciled, ~$120 each,
 * bank_account_id=null — the dues auto-post feature, not the Quicken
 * importer) whose amounts sum with the already-reconciled dues total to
 * exactly the report's twelve-month dues figure ($2,082 + $696 = $2,778):
 * the individual member rows and the $696 bank deposit ARE the same cash,
 * recognized once at the per-member level and remitted to the bank in one
 * lump by Zeffy. The correct fix for the $696 bank-statement line is to
 * RECONCILE the existing 17 zeffy rows against the 2026-06-29 bank deposit
 * via the reconciliation workbench (grouping them to that one statement
 * line), not to insert a 18th row representing the same money again. This
 * script does not touch dues income at all.
 *
 * CORRECTION 2 — UPDATE beneficiary_cause on check #8203 (FY2024) and #8247
 * (FY2026, dated 2026-03-07), both American Legion Post 171 (Foundation
 * entity), from 'Fundraising event costs' to 'Youth & Education'. Scoped
 * STRICTLY by check_number IN ('8203','8247') so the legitimate Legion
 * hall-rental rows (correctly 'Fundraising event costs') are never touched.
 *
 * IDEMPOTENCY MODEL (deliberately NOT the import-quicken-ledger.ts model):
 *   - The Correction 1 row is tagged with memo marker " [june-close-correction]"
 *     — a DIFFERENT marker than " [quicken-import]" on purpose, so this
 *     script's row is never swept up by import-quicken-ledger.ts's
 *     destructive delete-and-reinsert-by-[quicken-import]-marker idempotency
 *     model. On re-run (dry run or --apply), the candidate row is looked up
 *     by (entity_id, txn_date, amount_cents, flow, memo LIKE
 *     '%[june-close-correction]%') — if found, it is reported as
 *     "already present, skipping" and never re-inserted.
 *   - Correction 2 is a plain, idempotent UPDATE: it only touches rows where
 *     check_number IN ('8203','8247') AND beneficiary_cause IS DISTINCT FROM
 *     'Youth & Education'. Once applied, re-running finds nothing left to
 *     update (safe no-op).
 *
 * RECONCILED FLAG: the Correction 1 row is inserted with reconciled=false (see
 * the printed recommendation at the bottom of the dry-run report). This
 * script deliberately does NOT set reconciled=true — that decision is
 * flagged for the treasurer, not made here.
 *
 * Usage:
 *   pnpm exec tsx scripts/june-close-correction.ts                        # dry run against local .env.local DB (default) — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/june-close-correction.ts             # dry run against PRODUCTION — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/june-close-correction.ts --apply     # writes to PRODUCTION
 *
 * Target selection mirrors scripts/backfill-check-numbers.ts: PROD_DATABASE_URL
 * takes priority over DATABASE_URL/DB_URL from .env.local (local dev default).
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, like, inArray } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerTransactions,
  users,
} from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");

const targetUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!targetUrl) {
  throw new Error(
    "No DB target found — set DATABASE_URL/DB_URL in .env.local (local dev) or pass PROD_DATABASE_URL (production).",
  );
}
const usingProd = Boolean(process.env.PROD_DATABASE_URL);

const targetClient = postgres(targetUrl);
const targetDb = drizzle(targetClient, { schema });

// ---------------------------------------------------------------------------
// Constants — idempotency marker + treasurer identity
// ---------------------------------------------------------------------------

const CORRECTION_MARKER = "[june-close-correction]";
const TREASURER_EMAIL = process.env.SCRIPT_OPERATOR_EMAIL ?? (() => {
  throw new Error("Set SCRIPT_OPERATOR_EMAIL in your environment (the users.email row this correction is attributed to).");
})();

// Check numbers for Correction 2 — the ONLY rows this script's UPDATE may touch.
const MISTAGGED_CHECK_NUMBERS = ["8203", "8247"] as const;
const OLD_CAUSE = "Fundraising event costs";
const NEW_CAUSE = "Youth & Education";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Target: ${usingProd ? "PRODUCTION (PROD_DATABASE_URL)" : "local (.env.local DATABASE_URL/DB_URL)"}`);
  console.log(`Idempotency marker: ${CORRECTION_MARKER}`);

  // ---- Resolve fixed references ----
  const [clubEntity] = await targetDb.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "club"));
  if (!clubEntity) throw new Error("Could not resolve 'club' row in ledger_entities on target DB.");

  const [adminFund] = await targetDb
    .select()
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, clubEntity.id), eq(ledgerFunds.slug, "administrative")));
  if (!adminFund) throw new Error("Could not resolve Club Administrative Fund row in ledger_funds on target DB.");

  const [checkingAccount] = await targetDb
    .select()
    .from(ledgerBankAccounts)
    .where(and(eq(ledgerBankAccounts.entityId, clubEntity.id), eq(ledgerBankAccounts.name, "Administrative Checking")));
  if (!checkingAccount) throw new Error("Could not resolve 'Administrative Checking' row in ledger_bank_accounts on target DB.");

  const [marketingCategory] = await targetDb
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, clubEntity.id),
        eq(ledgerCategories.flow, "expense"),
        like(ledgerCategories.name, "Marketing"),
      ),
    );
  if (!marketingCategory) throw new Error("Could not resolve Club Marketing expense category in ledger_categories on target DB.");

  const [treasurer] = await targetDb.select().from(users).where(eq(users.email, TREASURER_EMAIL)).limit(1);
  if (!treasurer) throw new Error(`Could not find users row for ${TREASURER_EMAIL} on target DB.`);

  console.log(`\nResolved references:`);
  console.log(`  Club entity id:        ${clubEntity.id}`);
  console.log(`  Administrative fund:   ${adminFund.id} (${adminFund.name})`);
  console.log(`  Administrative Checking bank account: ${checkingAccount.id}`);
  console.log(`  Marketing category:    ${marketingCategory.id} (${marketingCategory.name})`);
  console.log(`  Recorded-by user:      ${treasurer.id} (${treasurer.email})`);

  // ---------------------------------------------------------------------------
  // CORRECTION 1 — one missing June transaction (Marketing expense only — the
  // $696 Zeffy dues deposit is deliberately NOT inserted here; see the header
  // comment above for why).
  // ---------------------------------------------------------------------------

  type PendingInsert = {
    label: string;
    txnDate: string;
    flow: "income" | "expense";
    amountCents: number;
    party: string;
    memo: string;
    paymentMethod: string;
    categoryId: string;
  };

  const pendingInserts: PendingInsert[] = [
    {
      label: "Eventeny / Fourth Friday",
      txnDate: "2026-06-26",
      flow: "expense",
      amountCents: 31_980, // $319.80
      party: "Eventeny",
      memo: `Fourth Friday — Chase statement …8338 ${CORRECTION_MARKER}`,
      paymentMethod: "debit_card",
      categoryId: marketingCategory.id,
    },
  ];

  console.log(`\n${"=".repeat(78)}`);
  console.log("CORRECTION 1 — missing June transaction (INSERT)");
  console.log("=".repeat(78));

  const toInsert: PendingInsert[] = [];

  for (const p of pendingInserts) {
    const existing = await targetDb
      .select({ id: ledgerTransactions.id, memo: ledgerTransactions.memo })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.entityId, clubEntity.id),
          eq(ledgerTransactions.txnDate, p.txnDate),
          eq(ledgerTransactions.amountCents, p.amountCents),
          eq(ledgerTransactions.flow, p.flow),
          like(ledgerTransactions.memo, `%${CORRECTION_MARKER}%`),
        ),
      );

    if (existing.length > 0) {
      console.log(
        `  ALREADY PRESENT — skipping "${p.label}" (${p.txnDate}, ${money(p.flow === "expense" ? -p.amountCents : p.amountCents)}); id=${existing[0].id}`,
      );
      continue;
    }

    toInsert.push(p);
    console.log(`  WOULD INSERT — "${p.label}"`);
    console.log(`    entity_id:          ${clubEntity.id}  (club / Westerville Lions Club)`);
    console.log(`    fund_id:            ${adminFund.id}  (Administrative Fund)`);
    console.log(`    bank_account_id:    ${checkingAccount.id}  (Administrative Checking)`);
    console.log(`    txn_date:           ${p.txnDate}`);
    console.log(`    flow:               ${p.flow}`);
    console.log(`    category_id:        ${p.categoryId}`);
    console.log(`    amount_cents:       ${p.amountCents}  (${money(p.flow === "expense" ? -p.amountCents : p.amountCents)})`);
    console.log(`    party:              ${p.party}`);
    console.log(`    memo:               ${p.memo}`);
    console.log(`    payment_method:     ${p.paymentMethod}`);
    console.log(`    check_number:       null`);
    console.log(`    beneficiary_cause:  null`);
    console.log(`    status:             posted`);
    console.log(`    reconciled:         false   (see recommendation below — NOT auto-set true)`);
    console.log(`    recorded_by_user_id: ${treasurer.id}  (${treasurer.email})`);
  }

  // ---------------------------------------------------------------------------
  // CORRECTION 2 — beneficiary_cause fix on checks #8203 / #8247
  // ---------------------------------------------------------------------------

  console.log(`\n${"=".repeat(78)}`);
  console.log("CORRECTION 2 — Boys/Girls State cause mis-tag (UPDATE, non-destructive)");
  console.log("=".repeat(78));

  const legionRows = await targetDb
    .select({
      id: ledgerTransactions.id,
      entityId: ledgerTransactions.entityId,
      txnDate: ledgerTransactions.txnDate,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      checkNumber: ledgerTransactions.checkNumber,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
    })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.checkNumber, [...MISTAGGED_CHECK_NUMBERS]));

  if (legionRows.length !== MISTAGGED_CHECK_NUMBERS.length) {
    console.log(
      `  WARNING: expected ${MISTAGGED_CHECK_NUMBERS.length} rows (check_number IN ${JSON.stringify(MISTAGGED_CHECK_NUMBERS)}), found ${legionRows.length}. Reviewing what was found; nothing auto-corrected beyond exact matches below.`,
    );
  }

  const causeUpdates: typeof legionRows = [];

  for (const row of legionRows) {
    console.log(
      `  check #${row.checkNumber}  ${row.txnDate}  ${row.party ?? "(no party)"}  ${money(-Math.abs(row.amountCents))}`,
    );
    if (row.beneficiaryCause === NEW_CAUSE) {
      console.log(`    ALREADY CORRECT — beneficiary_cause is already '${NEW_CAUSE}'. Skipping (idempotent no-op).`);
      continue;
    }
    console.log(`    WOULD UPDATE — beneficiary_cause: '${row.beneficiaryCause ?? "(null)"}'  ->  '${NEW_CAUSE}'`);
    if (row.beneficiaryCause !== OLD_CAUSE) {
      console.log(
        `    NOTE: current value is not the expected '${OLD_CAUSE}' — updating anyway per exact check_number scope, but flagging for treasurer review.`,
      );
    }
    causeUpdates.push(row);
  }

  // ---------------------------------------------------------------------------
  // Reconciled-flag recommendation (report only — never auto-applied here)
  // ---------------------------------------------------------------------------

  console.log(`\n${"=".repeat(78)}`);
  console.log("RECONCILED-FLAG RECOMMENDATION");
  console.log("=".repeat(78));
  console.log(
    [
      "The Correction 1 row (Eventeny/Fourth Friday, $319.80) is inserted with",
      "reconciled=false, reconciled_at=null, reconciled_session_id=null,",
      "status='posted'. This is a deliberate default, not an oversight:",
      "",
      "  - The June member-report reconciliation gate treats a month as GATED when it",
      "    has any status='posted' AND reconciled=false row with txn_date <= month-end.",
      "    Inserting this row un-reconciled means June stays (or becomes) gated until",
      "    reconciliation happens through the normal path.",
      "  - RECOMMENDATION: reconcile June through the bank-reconciliation workbench,",
      "    not by having this script mark the row cleared. The workbench session flow",
      "    (a) lets the treasurer visually match the new row against the actual Chase",
      "    …8338 statement line it was sourced from, (b) sets reconciled_session_id to",
      "    a real session for provenance (this script would otherwise have to leave",
      "    that column null, which is indistinguishable from 'never looked at'), and",
      "    (c) is the same mechanism used to close every other month — a special-cased",
      "    script-side reconciled=true would be the only place in the system where a",
      "    transaction is marked cleared without going through a session.",
      "  - The same workbench pass is also where the $696 Zeffy dues deposit gets",
      "    handled: reconcile the existing 17 unreconciled zeffy dues rows against",
      "    the 2026-06-29 bank statement line as a group, rather than this script",
      "    inserting an 18th row for money that's already recognized (see header",
      "    comment — that insert was deliberately removed to avoid double-counting).",
      "  - COUNTERARGUMENT (for the treasurer to weigh): the amount and date are",
      "    already confirmed against the bank statement (that's the whole basis for",
      "    this correction), so marking it reconciled=true with reconciled_at=now()",
      "    here would be factually defensible and would close out this one row in a",
      "    single step. The tradeoff is losing session provenance and creating one",
      "    inconsistent code path.",
      "  - Net: this script defaults to reconciled=false. If the treasurer prefers the",
      "    one-step close, that's a one-line change (add reconciled: true, reconciledAt:",
      "    new Date() to the insert) made deliberately, not silently.",
    ].join("\n"),
  );

  // ---------------------------------------------------------------------------
  // Apply (or not)
  // ---------------------------------------------------------------------------

  if (!APPLY) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(
      `DRY RUN COMPLETE — no DB writes. Would insert ${toInsert.length} transaction(s) and update ${causeUpdates.length} beneficiary_cause value(s).`,
    );
    console.log(`Re-run with --apply (and PROD_DATABASE_URL set, if targeting production) to write.`);
    await targetClient.end();
    return;
  }

  console.log(`\nApplying ${toInsert.length} insert(s)...`);
  for (const p of toInsert) {
    await targetDb.insert(ledgerTransactions).values({
      entityId: clubEntity.id,
      fundId: adminFund.id,
      bankAccountId: checkingAccount.id,
      txnDate: p.txnDate,
      flow: p.flow,
      categoryId: p.categoryId,
      amountCents: p.amountCents,
      party: p.party,
      memo: p.memo,
      beneficiaryCause: null,
      paymentMethod: p.paymentMethod,
      checkNumber: null,
      status: "posted",
      reconciled: false,
      recordedByUserId: treasurer.id,
    });
    console.log(`  Inserted "${p.label}" (${p.txnDate}, ${money(p.flow === "expense" ? -p.amountCents : p.amountCents)}).`);
  }

  console.log(`\nApplying ${causeUpdates.length} beneficiary_cause update(s)...`);
  for (const row of causeUpdates) {
    await targetDb
      .update(ledgerTransactions)
      .set({ beneficiaryCause: NEW_CAUSE, updatedAt: new Date() })
      .where(eq(ledgerTransactions.id, row.id));
    console.log(`  Updated check #${row.checkNumber} -> beneficiary_cause='${NEW_CAUSE}'.`);
  }

  console.log(`\nApply complete. Inserted ${toInsert.length}, updated ${causeUpdates.length}.`);
  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await targetClient.end();
  process.exit(1);
});
