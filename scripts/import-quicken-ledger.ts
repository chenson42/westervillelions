/**
 * One-off Quicken register importer — seeds The Ledger from the treasurer's real
 * books (Foundation + Administrative accounts, FY2025–FY2026).
 *
 * Usage:
 *   pnpm exec tsx scripts/import-quicken-ledger.ts            # dry run (default) — parses, maps, verifies, prints. No DB writes.
 *   pnpm exec tsx scripts/import-quicken-ledger.ts --apply     # executes against DATABASE_URL from .env.local
 *
 * Idempotency: every inserted transaction's memo is suffixed with " [quicken-import]".
 * On --apply, the script first deletes any existing ledger_transactions whose memo
 * ends with that marker (and any ledger_acknowledgments referencing them), then
 * re-inserts fresh — safe to re-run.
 *
 * Source CSVs are treasurer financial records and intentionally live OUTSIDE the
 * repo (see paths below). Do not copy them into the repo.
 *
 * Bank Reconciliation inc1 (T-18, DECISION-034): rows now carry a derived
 * `checkNumber` into the insert, so PRODUCTION's still-pending first Quicken
 * seed gets the column for free. Several helpers below are exported so
 * scripts/backfill-check-numbers.ts can reuse them without duplication.
 * IMPORTANT: do NOT re-run this script (even in dry-run-then---apply form)
 * against the already-seeded local dev DB to "pick up" checkNumber — its
 * delete-and-reinsert idempotency model would silently discard any
 * reconciliation/edit state layered on since the 2026-07-20 seed and
 * cascade-delete any ledger_acknowledgments tied to the doomed row IDs.
 * scripts/backfill-check-numbers.ts is the correct (and only) backfill path
 * for local dev.
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import { readFileSync } from "fs";
import { db } from "../src/lib/db";
import {
  ledgerEntities,
  ledgerBankAccounts,
  ledgerFunds,
  ledgerCategories,
  ledgerTransactions,
  ledgerAcknowledgments,
  users,
} from "../src/lib/db/schema";
import { eq, and, like, inArray } from "drizzle-orm";
import { classifyRegisterCheckColumn } from "../src/lib/check-number";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const APPLY = process.argv.includes("--apply");
// Exported so scripts/backfill-check-numbers.ts (Bank Reconciliation inc1,
// DECISION-034) can reuse the exact same idempotency marker without
// duplicating it.
export const IMPORT_MARKER = "[quicken-import]";

// Exported so scripts/backfill-check-numbers.ts can reuse the same source
// paths without re-declaring them (DECISION-034). Do not copy these CSVs
// into the repo.
export const FOUNDATION_CSV =
  "/Users/cshenso/Documents/Treasurer Transfer Documents 07-2024 to 06-2026/Foundation Account/WLCF Quicken Register Export 2024-2026.csv";
export const ADMIN_CSV =
  "/Users/cshenso/Documents/Treasurer Transfer Documents 07-2024 to 06-2026/Administrative Account/WLC Quicken Register Export 2024-2026.csv";

// Opening balances (cents) per Phase-4 spec.
const FOUNDATION_CHARITABLE_OPENING_CENTS = 2_856_930; // 29,569.30 carryover - 1,000.00 (check #8022, pre-window)
const CLUB_ADMINISTRATIVE_OPENING_CENTS = 1_909_010; // register opening 6/30/2024

// Balance targets (cents) the imported data must reconcile to.
const FOUNDATION_TARGET_ENDING_CENTS = 483_657; // $4,836.57
const CLUB_TARGET_ENDING_CENTS = 1_621_864; // $16,218.64 (administrative + activity combined)

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** RFC4180-lite line splitter: handles quoted fields containing commas and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  fields.push(cur);
  return fields;
}

export type RawRow = {
  split: string; // "S" for split-component rows, else ""
  dateRaw: string; // "M/D/YYYY"
  isoDate: string; // "YYYY-MM-DD"
  action: string;
  checkNum: string;
  payeeRaw: string;
  category: string;
  clr: string;
  amountCents: number; // signed
  memo: string;
};

export function parseAmountToCents(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  return Math.round(parseFloat(cleaned) * 100);
}

export function toIsoDate(raw: string): string {
  const [m, d, y] = raw.split("/").map((s) => parseInt(s, 10));
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parses a Quicken register CSV export into raw data rows (skips preamble/footer). */
export function parseRegisterFile(path: string): RawRow[] {
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/);

  const headerIdx = lines.findIndex((l) => l.includes('"Scheduled"'));
  if (headerIdx === -1) throw new Error(`Could not find header row in ${path}`);
  const headerFields = parseCsvLine(lines[headerIdx]);

  const col = (name: string): number => {
    const idx = headerFields.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found in header of ${path}`);
    return idx;
  };

  const idxSplit = col("Split");
  const idxDate = col("Date");
  const idxAction = col("Action");
  const idxCheckNum = col("Check #");
  const idxPayee = col("Payee");
  const idxCategory = col("Category");
  const idxClr = col("Clr");
  const idxAmount = col("Amount");
  const idxMemo = col("Memo/Notes");

  // Data starts two lines after the header (header, then the opening "Balance:" line).
  const dataStart = headerIdx + 2;

  const rows: RawRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;
    const fields = parseCsvLine(line);
    if ((fields[0] ?? "").trim() === "Balance:") break; // closing balance line — stop
    const dateRaw = (fields[idxDate] ?? "").trim();
    if (dateRaw === "") continue; // defensive skip of stray blank lines

    rows.push({
      split: (fields[idxSplit] ?? "").trim(),
      dateRaw,
      isoDate: toIsoDate(dateRaw),
      action: (fields[idxAction] ?? "").trim(),
      checkNum: (fields[idxCheckNum] ?? "").trim(),
      payeeRaw: (fields[idxPayee] ?? "").trim(),
      category: (fields[idxCategory] ?? "").trim(),
      clr: (fields[idxClr] ?? "").trim(),
      amountCents: parseAmountToCents(fields[idxAmount] ?? ""),
      memo: (fields[idxMemo] ?? "").trim(),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function deriveParty(payeeRaw: string, memo: string): string {
  const p = payeeRaw.trim();
  if (p === "" || p === "Deposit" || p === "Withdrawal" || p === "Cash withdrawal") {
    return memo.trim() || "Unknown";
  }
  return p;
}

function buildMemo(memo: string): string {
  return memo.trim() ? `${memo.trim()} ${IMPORT_MARKER}` : IMPORT_MARKER;
}

function fiscalYearOf(isoDate: string): number {
  const [yearStr, monthStr] = isoDate.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  return month >= 7 ? year : year - 1;
}

// ---------------------------------------------------------------------------
// Cause taxonomy — stamps `beneficiaryCause` on Foundation + club-activity
// EXPENSE rows so the /members/impact "Giving by Cause" breakdown is
// meaningful. Applied at row-build time, regardless of whether a given row
// happens to satisfy the app's isGiving() predicate (see CLAUDE.md/decisions
// for that predicate — this script does not read or depend on it).
//
// Rule order matters: payee/memo overrides are checked before the more
// generic register-category fallbacks, because several Foundation categories
// ("Philanthropic donation", "Special Grant", "Miscellaneous") are shared by
// many different beneficiaries and can only be disambiguated by payee/memo.
// ---------------------------------------------------------------------------

const CAUSE_VISION = "Vision & Eye Care";
const CAUSE_YOUTH = "Youth & Education";
const CAUSE_HUNGER = "Hunger & Basic Needs";
const CAUSE_HEALTH = "Health & Disability";
const CAUSE_DISASTER = "Disaster Relief";
const CAUSE_LIONS_INTL = "Lions International Programs";
const CAUSE_CIVIC = "Community & Civic";
const CAUSE_RECYCLING = "Bags to Benches (Recycling)";
const CAUSE_FUNDRAISING = "Fundraising event costs";

/** Register categories mapped to a categoryName that is deliberately cause-less (ops/insurance). */
const NO_CAUSE_CATEGORY_NAMES = new Set(["Operations", "Insurance & bonding"]);

function ci(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Returns the beneficiary cause for a Foundation/club-activity EXPENSE row, or
 * null if the row is deliberately cause-less (operations/insurance) or if it
 * genuinely didn't match any rule (the caller flags the latter for review).
 */
function deriveCause(args: {
  payeeRaw: string;
  category: string; // raw register category (pre-mapping)
  memo: string;
  checkNum: string;
}): string | null {
  const { payeeRaw, category, memo, checkNum } = args;

  if (ci(memo, "arborfest")) return CAUSE_CIVIC;
  if (ci(payeeRaw, "heritage middle school")) return CAUSE_HUNGER;
  if (ci(payeeRaw, "gates at eight") || ci(payeeRaw, "gates at 8")) return CAUSE_YOUTH;
  if (ci(payeeRaw, "qdoba")) return CAUSE_YOUTH;
  if (category === "Boys State/Girls State") return CAUSE_YOUTH;
  if (["Scholarships", "High School Scholarships", "BMX Race Scholarships"].includes(category))
    return CAUSE_YOUTH;
  if (ci(payeeRaw, "westerville area resource ministry")) return CAUSE_HUNGER;
  if (ci(payeeRaw, "westerville caring and sharing")) return CAUSE_HUNGER;
  if (ci(payeeRaw, "cohatch worthington")) return CAUSE_HUNGER;
  if (ci(payeeRaw, "the big bus")) return CAUSE_HUNGER;
  if (ci(payeeRaw, "howard baum") && (ci(memo, "trash bag") || ci(memo, "bags to benches")))
    return CAUSE_RECYCLING;
  if (ci(payeeRaw, "jane enneking")) return CAUSE_RECYCLING;
  if (ci(payeeRaw, "costco") && ci(memo, "trash bag")) return CAUSE_RECYCLING;
  if (["Bags to Benches Expenses", "Bags to Benches", "Bench Plaques", "Plastic Bags"].includes(category))
    return CAUSE_RECYCLING;
  if (ci(payeeRaw, "foundation fighting blindness")) return CAUSE_VISION;
  if (ci(payeeRaw, "vosh")) return CAUSE_VISION;
  if (ci(payeeRaw, "pilot dogs")) return CAUSE_VISION;
  if (ci(payeeRaw, "olf eye care fund")) return CAUSE_VISION;
  if (ci(payeeRaw, "ohio lions eye research foundation")) return CAUSE_VISION;
  if (ci(payeeRaw, "central ohio lions eye bank")) return CAUSE_VISION;
  if (ci(payeeRaw, "ossbpts foundation")) return CAUSE_VISION;
  if (category === "Sensory Garden") return CAUSE_VISION;
  if (ci(payeeRaw, "ohio lions foundation")) return ci(memo, "sensory garden") ? CAUSE_VISION : CAUSE_LIONS_INTL;
  if (ci(payeeRaw, "westerville special olympics")) return CAUSE_HEALTH;
  if (ci(payeeRaw, "central ohio diabetes association")) return CAUSE_HEALTH;
  if (ci(payeeRaw, "ohio lions pediatric cancer foundation")) return CAUSE_HEALTH;
  if (ci(payeeRaw, "camp echoing hills")) return CAUSE_HEALTH;
  if (category === "Special Grant" && (checkNum === "8200" || checkNum === "8201")) return CAUSE_DISASTER;
  if (ci(payeeRaw, "lions clubs international foundation")) return CAUSE_LIONS_INTL;
  if (category === "Special Interest Grants" && ci(payeeRaw, "city of westerville")) return CAUSE_CIVIC;
  if (["Rudolph Run Expenses", "Pancake Breakfast Expenses", "WinterFest"].includes(category))
    return CAUSE_FUNDRAISING;

  return null;
}

// ---------------------------------------------------------------------------
// Mapped transaction shape (entity-agnostic, ready for insertion)
// ---------------------------------------------------------------------------

type MappedTxn = {
  entityKey: "club" | "foundation";
  fundKind: string; // 'administrative' | 'activity' | 'charitable'
  txnDate: string;
  flow: "income" | "expense";
  categoryName: string;
  amountCents: number;
  party: string;
  memo: string; // raw register memo (pre-marker)
  paymentMethod: string;
  reconciled: boolean;
  sourceCheckNum: string;
  sourceCategory: string;
  beneficiaryCause: string | null;
  // Bank Reconciliation inc1 (T-18, DECISION-034): structured check number,
  // derived via the same primary classifier scripts/backfill-check-numbers.ts
  // uses. Null for non-check rows or when the "Check #" column holds a
  // non-numeric marker (e.g. "Card") — see classifyRegisterCheckColumn().
  checkNumber: string | null;
};

type SkippedRow = {
  entityKey: "club" | "foundation";
  date: string;
  category: string;
  checkNum: string;
  payee: string;
  amountCents: number;
  reason: string;
};

// ---------------------------------------------------------------------------
// Foundation mapping
// ---------------------------------------------------------------------------

const FOUNDATION_CHARITABLE_OUT = new Set([
  "Philanthropic donation",
  "Pilot Dogs",
  "Ohio Lions Foundation",
  "OLF Eye Care Fund",
  "Ohio Lions Eye Research Foundation",
  "Ohio Lions Pediatric Cancer Foundation",
  "Lions Clubs International Foundation",
  "Caring and Sharing",
  "Camp Echoing Hills",
  "Westerville Special Olympics",
  "Student VOSH",
  "Diabetes",
  "Sensory Garden",
  "Ohio State School for the Blind",
  "Central Ohio Lions Eye Bank",
  "BMX Sponsorship",
]);
const FOUNDATION_GRANT_OUT = new Set(["Special Interest Grants", "Boys State/Girls State"]);
const FOUNDATION_SCHOLARSHIPS = new Set([
  "High School Scholarships",
  "Scholarships",
  "BMX Race Scholarships",
]);
const FOUNDATION_FUNDRAISING_COST = new Set([
  "Rudolph Run Expenses",
  "Pancake Breakfast Expenses",
  "WinterFest",
]);
const FOUNDATION_RUDOLPH_INCOME = new Set(["Rudolph Run Sponsorship", "Rudolph Run Entry Receipts"]);
const FOUNDATION_OPERATIONS = new Set(["Storage Unit", "Uncategorized", "Membership"]);
const FOUNDATION_SERVICE_PROJECTS = new Set(["Bags to Benches Expenses", "Bench Plaques", "Plastic Bags"]);

export function shouldSkipFoundation(row: RawRow): string | null {
  if (row.amountCents === 0) return "zero-amount (VOIDED / cancelled check)";
  if (row.category === "Carryover from previous fiscal year")
    return "carryover row — folded into opening balance";
  if (row.checkNum === "8022")
    return "check #8022 (4/5/2024) — pre-FY2025 window, folded into opening balance";
  if (row.memo === "Square verify" || row.memo === "Square verify credit")
    return "Square verification pair (nets to $0)";
  return null;
}

function mapFoundation(row: RawRow): { fundKind: string; categoryName: string; partyOverride?: string } {
  const cat = row.category;
  const flow: "income" | "expense" = row.amountCents > 0 ? "income" : "expense";

  if (cat === "Special Grant") {
    if (flow === "income") return { fundKind: "charitable", categoryName: "Grants received" };
    if (row.checkNum === "8200" || row.checkNum === "8201")
      return { fundKind: "charitable", categoryName: "Disaster relief" };
    return { fundKind: "charitable", categoryName: "Grant out" };
  }
  if (FOUNDATION_GRANT_OUT.has(cat)) return { fundKind: "charitable", categoryName: "Grant out" };
  if (FOUNDATION_SCHOLARSHIPS.has(cat)) return { fundKind: "charitable", categoryName: "Scholarships" };
  if (FOUNDATION_FUNDRAISING_COST.has(cat))
    return { fundKind: "charitable", categoryName: "Fundraising event costs" };
  if (FOUNDATION_RUDOLPH_INCOME.has(cat)) return { fundKind: "charitable", categoryName: "Rudolph Run" };
  if (cat === "Pancake Breakfast Receipts") return { fundKind: "charitable", categoryName: "Pancake Breakfast" };
  if (cat === "Restaurant fundraisers") return { fundKind: "charitable", categoryName: "Fundraising events" };
  if (cat === "Cash Donation") return { fundKind: "charitable", categoryName: "Public donations" };
  if (cat === "Miscellaneous") {
    if (flow === "income") {
      if (row.isoDate === "2024-07-08") {
        return {
          fundKind: "charitable",
          categoryName: "Public donations",
          partyOverride: "Westerville Lions Club",
        };
      }
      return { fundKind: "charitable", categoryName: "Public donations" };
    }
    if (row.checkNum === "8245") return { fundKind: "charitable", categoryName: "Charitable donation out" }; // Qdoba
    // Bags to Benches supplies mis-filed as Miscellaneous in the register (9/23/2025
    // Howard Baum $24.99) — belongs with its sibling supply rows in Service projects.
    if (/bags to benches/i.test(row.memo)) {
      return { fundKind: "charitable", categoryName: "Service projects" };
    }
    return { fundKind: "charitable", categoryName: "Operations" };
  }
  if (cat === "Officer Bonding") return { fundKind: "charitable", categoryName: "Insurance & bonding" };
  if (FOUNDATION_OPERATIONS.has(cat)) return { fundKind: "charitable", categoryName: "Operations" };
  if (FOUNDATION_CHARITABLE_OUT.has(cat)) return { fundKind: "charitable", categoryName: "Charitable donation out" };
  if (FOUNDATION_SERVICE_PROJECTS.has(cat)) return { fundKind: "charitable", categoryName: "Service projects" };

  throw new Error(`Unmapped Foundation category "${cat}" (flow=${flow}, date=${row.isoDate})`);
}

export function foundationPaymentMethod(row: RawRow): string {
  if (row.isoDate === "2026-03-09" && row.category === "Miscellaneous" && row.amountCents === 1000) {
    return "zeffy";
  }
  if (row.action === "Check") return "check";
  if (row.action === "Teller") return "cash";
  return "other";
}

// ---------------------------------------------------------------------------
// Club (Administrative register) mapping
// ---------------------------------------------------------------------------

const CLUB_ADMIN_EXPENSE_DIRECT: Record<string, string> = {
  "Meeting Hospitality": "Meals",
  "Mailbox rental": "Postage",
  Marketing: "Marketing",
  "Web hosting": "Web hosting",
  "District Convention": "District & convention",
  "Officer Bonding": "Insurance & bonding",
};

const CLUB_DUES_LIKE = new Set(["Club Dues", "New member fee", "International new member fee"]);

export function shouldSkipClub(row: RawRow): string | null {
  if (row.amountCents === 0) return "zero-amount (VOIDED)";
  if (row.category === "Transfer" && row.payeeRaw === "Opening Balance")
    return "opening balance row — folded into opening balance";
  return null;
}

function mapClub(row: RawRow): { fundKind: string; categoryName: string; partyOverride?: string } {
  const cat = row.category;
  const flow: "income" | "expense" = row.amountCents > 0 ? "income" : "expense";

  // Activity-fund overrides (per Phase-4 spec) take priority.
  if (cat === "Pancake Breakfast Receipts") return { fundKind: "activity", categoryName: "Pancake Breakfast" };
  if (cat === "Donation") return { fundKind: "activity", categoryName: "Public donations" };
  if (cat === "Bags to Benches") return { fundKind: "activity", categoryName: "Service projects" };

  if (cat === "Tailtwisting") {
    if (flow === "income") return { fundKind: "administrative", categoryName: "Tail-twisting" };
    return {
      fundKind: "administrative",
      categoryName: "Donations to Foundation",
      partyOverride: "Westerville Lions Club Foundation",
    };
  }
  if (CLUB_DUES_LIKE.has(cat)) {
    return flow === "income"
      ? { fundKind: "administrative", categoryName: "Club dues" }
      : { fundKind: "administrative", categoryName: "Per-capita tax" };
  }
  if (cat === "Meeting Space Rental") return { fundKind: "administrative", categoryName: "Misc" };
  if (cat === "Uncategorized") return { fundKind: "administrative", categoryName: "Misc" };
  if (cat === "Miscellaneous" || cat === "Lion L Support")
    return { fundKind: "administrative", categoryName: "Miscellaneous" };
  if (CLUB_ADMIN_EXPENSE_DIRECT[cat])
    return { fundKind: "administrative", categoryName: CLUB_ADMIN_EXPENSE_DIRECT[cat] };

  throw new Error(`Unmapped Club category "${cat}" (flow=${flow}, date=${row.isoDate})`);
}

export function clubPaymentMethod(row: RawRow): string {
  if (row.action === "Check") return "check";
  if (row.action === "Teller") return "cash";
  return "other";
}

// ---------------------------------------------------------------------------
// Build mapped + skipped rows for one entity
// ---------------------------------------------------------------------------

function buildEntityRows(
  entityKey: "club" | "foundation",
  rows: RawRow[],
): { mapped: MappedTxn[]; skipped: SkippedRow[] } {
  const mapped: MappedTxn[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const skipReason =
      entityKey === "foundation" ? shouldSkipFoundation(row) : shouldSkipClub(row);
    if (skipReason) {
      skipped.push({
        entityKey,
        date: row.isoDate,
        category: row.category,
        checkNum: row.checkNum,
        payee: row.payeeRaw,
        amountCents: row.amountCents,
        reason: skipReason,
      });
      continue;
    }

    const flow: "income" | "expense" = row.amountCents > 0 ? "income" : "expense";
    const mapping = entityKey === "foundation" ? mapFoundation(row) : mapClub(row);
    const party = mapping.partyOverride ?? deriveParty(row.payeeRaw, row.memo);
    const paymentMethod =
      entityKey === "foundation" ? foundationPaymentMethod(row) : clubPaymentMethod(row);
    const reconciled = row.clr === "C" || row.clr === "R";

    const eligibleForCause =
      flow === "expense" && (mapping.fundKind === "charitable" || mapping.fundKind === "activity");
    const beneficiaryCause = eligibleForCause
      ? deriveCause({ payeeRaw: row.payeeRaw, category: row.category, memo: row.memo, checkNum: row.checkNum })
      : null;
    const checkNumber = classifyRegisterCheckColumn(row.action, row.checkNum).checkNumber;

    mapped.push({
      entityKey,
      fundKind: mapping.fundKind,
      txnDate: row.isoDate,
      flow,
      categoryName: mapping.categoryName,
      amountCents: Math.abs(row.amountCents),
      party,
      memo: row.memo,
      paymentMethod,
      reconciled,
      sourceCheckNum: row.checkNum,
      sourceCategory: row.category,
      beneficiaryCause,
      checkNumber,
    });
  }

  return { mapped, skipped };
}

// ---------------------------------------------------------------------------
// Category upsert list (Phase-4 spec)
// ---------------------------------------------------------------------------

const CATEGORY_UPSERTS: Array<{
  entityKey: "club" | "foundation";
  fundKind: string;
  flow: "income" | "expense";
  name: string;
}> = [
  // club/administrative expense
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "Insurance & bonding" },
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "Marketing" },
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "Web hosting" },
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "District & convention" },
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "Miscellaneous" },
  { entityKey: "club", fundKind: "administrative", flow: "expense", name: "Donations to Foundation" },
  // club/activity expense
  { entityKey: "club", fundKind: "activity", flow: "expense", name: "Service projects" },
  // foundation/charitable expense
  { entityKey: "foundation", fundKind: "charitable", flow: "expense", name: "Scholarships" },
  { entityKey: "foundation", fundKind: "charitable", flow: "expense", name: "Fundraising event costs" },
  { entityKey: "foundation", fundKind: "charitable", flow: "expense", name: "Service projects" },
  { entityKey: "foundation", fundKind: "charitable", flow: "expense", name: "Operations" },
  { entityKey: "foundation", fundKind: "charitable", flow: "expense", name: "Insurance & bonding" },
  // foundation/charitable income
  { entityKey: "foundation", fundKind: "charitable", flow: "income", name: "Rudolph Run" },
  { entityKey: "foundation", fundKind: "charitable", flow: "income", name: "Pancake Breakfast" },
  { entityKey: "foundation", fundKind: "charitable", flow: "income", name: "Fundraising events" },
];

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function printSkipped(skipped: SkippedRow[]) {
  console.log(`\n  Skipped rows (${skipped.length}):`);
  for (const s of skipped) {
    console.log(
      `    [${s.entityKey}] ${s.date}  check#${s.checkNum || "-"}  ${s.payee || "(no payee)"}  ${money(
        s.amountCents,
      )}  category="${s.category}"  — ${s.reason}`,
    );
  }
}

function printReviewLists(mapped: MappedTxn[]) {
  const flagged = mapped.filter((t) =>
    ["Operations", "Miscellaneous", "Misc"].includes(t.categoryName),
  );
  console.log(`\n  Rows mapped to Operations / Miscellaneous / Misc — treasurer review (${flagged.length}):`);
  for (const t of flagged) {
    console.log(
      `    [${t.entityKey}/${t.fundKind}] ${t.txnDate}  ${t.party}  ${money(
        t.flow === "expense" ? -t.amountCents : t.amountCents,
      )}  → "${t.categoryName}"  (source category: "${t.sourceCategory}")`,
    );
  }

  const uncategorizedOrVoided = mapped.filter(
    (t) => t.sourceCategory === "Uncategorized" || t.sourceCategory === "VOIDED",
  );
  console.log(
    `\n  Rows whose register category was Uncategorized/VOIDED (imported; VOIDED rows with $0 were skipped separately) (${uncategorizedOrVoided.length}):`,
  );
  for (const t of uncategorizedOrVoided) {
    console.log(
      `    [${t.entityKey}/${t.fundKind}] ${t.txnDate}  ${t.party}  ${money(
        t.flow === "expense" ? -t.amountCents : t.amountCents,
      )}  source category="${t.sourceCategory}" → "${t.categoryName}"`,
    );
  }
}

/** Rows eligible for a cause (Foundation + club-activity expense) that got null and aren't deliberately cause-less. */
function printCauseReport(mapped: MappedTxn[]) {
  const eligible = mapped.filter(
    (t) => t.flow === "expense" && (t.fundKind === "charitable" || t.fundKind === "activity"),
  );

  const unmatched = eligible.filter(
    (t) => t.beneficiaryCause === null && !NO_CAUSE_CATEGORY_NAMES.has(t.categoryName),
  );
  console.log(`\n  Beneficiary-cause: unmatched public-fund expense rows (${unmatched.length}):`);
  for (const t of unmatched) {
    console.log(
      `    [${t.entityKey}/${t.fundKind}] ${t.txnDate}  ${t.party}  ${money(-t.amountCents)}  category="${t.sourceCategory}"  memo="${t.memo}"`,
    );
  }

  const deliberateNull = eligible.filter(
    (t) => t.beneficiaryCause === null && NO_CAUSE_CATEGORY_NAMES.has(t.categoryName),
  );

  const byCause = new Map<string, { cents: number; count: number }>();
  for (const t of eligible) {
    const key = t.beneficiaryCause ?? "(null — Operations/Insurance)";
    const bucket = byCause.get(key) ?? { cents: 0, count: 0 };
    bucket.cents += t.amountCents;
    bucket.count += 1;
    byCause.set(key, bucket);
  }
  console.log(`\n  Beneficiary-cause totals (Foundation + club-activity expense rows):`);
  const rows = Array.from(byCause.entries()).sort((a, b) => b[1].cents - a[1].cents);
  for (const [cause, bucket] of rows) {
    console.log(`    ${cause.padEnd(35)} ${money(-bucket.cents).padStart(12)}  (${bucket.count} rows)`);
  }
  console.log(
    `    (deliberate-null Operations/Insurance rows included above: ${deliberateNull.length})`,
  );
}

function printTotals(label: string, mapped: MappedTxn[]) {
  console.log(`\n  ${label}`);
  const byFy = new Map<number, { income: number; expense: number }>();
  for (const t of mapped) {
    const fy = fiscalYearOf(t.txnDate);
    const bucket = byFy.get(fy) ?? { income: 0, expense: 0 };
    if (t.flow === "income") bucket.income += t.amountCents;
    else bucket.expense += t.amountCents;
    byFy.set(fy, bucket);
  }
  for (const fy of Array.from(byFy.keys()).sort()) {
    const b = byFy.get(fy)!;
    console.log(
      `    FY${fy}: income ${money(b.income)}  expense ${money(b.expense)}  net ${money(b.income - b.expense)}`,
    );
  }

  const byCategory = new Map<string, number>();
  for (const t of mapped) {
    const key = `${t.fundKind}/${t.flow}/${t.categoryName}`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  console.log(`    Category counts:`);
  for (const key of Array.from(byCategory.keys()).sort()) {
    console.log(`      ${key}: ${byCategory.get(key)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Foundation CSV: ${FOUNDATION_CSV}`);
  console.log(`Admin CSV: ${ADMIN_CSV}`);

  const foundationRaw = parseRegisterFile(FOUNDATION_CSV);
  const adminRaw = parseRegisterFile(ADMIN_CSV);
  console.log(`\nParsed ${foundationRaw.length} Foundation data rows, ${adminRaw.length} Admin data rows.`);

  const foundationResult = buildEntityRows("foundation", foundationRaw);
  const clubResult = buildEntityRows("club", adminRaw);

  console.log(
    `\nMapped: Foundation ${foundationResult.mapped.length} imported / ${foundationResult.skipped.length} skipped.`,
  );
  console.log(`Mapped: Club ${clubResult.mapped.length} imported / ${clubResult.skipped.length} skipped.`);

  // ---- Verification (both modes) ----
  const foundationIncome = foundationResult.mapped
    .filter((t) => t.flow === "income")
    .reduce((s, t) => s + t.amountCents, 0);
  const foundationExpense = foundationResult.mapped
    .filter((t) => t.flow === "expense")
    .reduce((s, t) => s + t.amountCents, 0);
  const foundationEnding =
    FOUNDATION_CHARITABLE_OPENING_CENTS + foundationIncome - foundationExpense;

  const clubIncome = clubResult.mapped.filter((t) => t.flow === "income").reduce((s, t) => s + t.amountCents, 0);
  const clubExpense = clubResult.mapped
    .filter((t) => t.flow === "expense")
    .reduce((s, t) => s + t.amountCents, 0);
  const clubEnding = CLUB_ADMINISTRATIVE_OPENING_CENTS + clubIncome - clubExpense;

  console.log(`\n${"=".repeat(78)}`);
  console.log("VERIFICATION");
  console.log("=".repeat(78));
  console.log(
    `Foundation: opening ${money(FOUNDATION_CHARITABLE_OPENING_CENTS)} + income ${money(
      foundationIncome,
    )} - expense ${money(foundationExpense)} = ${money(foundationEnding)}  (target ${money(
      FOUNDATION_TARGET_ENDING_CENTS,
    )})  ${foundationEnding === FOUNDATION_TARGET_ENDING_CENTS ? "OK" : "MISMATCH"}`,
  );
  console.log(
    `Club (admin+activity): opening ${money(CLUB_ADMINISTRATIVE_OPENING_CENTS)} + income ${money(
      clubIncome,
    )} - expense ${money(clubExpense)} = ${money(clubEnding)}  (target ${money(
      CLUB_TARGET_ENDING_CENTS,
    )})  ${clubEnding === CLUB_TARGET_ENDING_CENTS ? "OK" : "MISMATCH"}`,
  );

  const foundationOk = foundationEnding === FOUNDATION_TARGET_ENDING_CENTS;
  const clubOk = clubEnding === CLUB_TARGET_ENDING_CENTS;

  printTotals("Foundation totals:", foundationResult.mapped);
  printTotals("Club totals:", clubResult.mapped);

  printSkipped([...foundationResult.skipped, ...clubResult.skipped]);
  printReviewLists([...foundationResult.mapped, ...clubResult.mapped]);
  printCauseReport([...foundationResult.mapped, ...clubResult.mapped]);

  if (!foundationOk || !clubOk) {
    console.error(`\n${"!".repeat(78)}`);
    console.error("RECONCILIATION FAILED — not applying. Fix mapping/parse bugs and re-run.");
    console.error("!".repeat(78));
    process.exitCode = 1;
    return;
  }

  console.log(`\nDry-run reconciliation: PASS.`);

  if (!APPLY) {
    console.log(`\n(Dry run complete — no DB writes. Re-run with --apply to execute.)`);
    return;
  }

  // -------------------------------------------------------------------------
  // APPLY
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("APPLYING");
  console.log("=".repeat(78));

  await db.transaction(async (tx) => {
    // Recorder user
    const [recorder] = await tx.select().from(users).where(eq(users.email, "chenson42@gmail.com")).limit(1);
    if (!recorder) throw new Error("Could not find users row for chenson42@gmail.com");

    // Entities
    const entityRows = await tx.select().from(ledgerEntities);
    const clubEntity = entityRows.find((e) => e.slug === "club");
    const foundationEntity = entityRows.find((e) => e.slug === "foundation");
    if (!clubEntity || !foundationEntity) throw new Error("Missing club/foundation ledger_entities rows");

    // --- Pre-step 1: delete test transactions (and their acknowledgments) ---
    const testParties = ["Jane Doe", "Quid Pro Quo Donor", "Small Donor", "A J Westlund"];
    const testTxns = await tx
      .select({ id: ledgerTransactions.id, party: ledgerTransactions.party, txnDate: ledgerTransactions.txnDate })
      .from(ledgerTransactions)
      .where(inArray(ledgerTransactions.party, testParties));

    if (testTxns.length > 0) {
      const testTxnIds = testTxns.map((t) => t.id);
      const deletedAcks = await tx
        .delete(ledgerAcknowledgments)
        .where(inArray(ledgerAcknowledgments.donationTxnId, testTxnIds))
        .returning({ id: ledgerAcknowledgments.id });
      await tx.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, testTxnIds));
      console.log(`\nDeleted ${testTxns.length} test transactions (and ${deletedAcks.length} acknowledgments):`);
      for (const t of testTxns) console.log(`  - ${t.party} (${t.txnDate})`);
    } else {
      console.log(`\nNo test transactions found to delete (already removed).`);
    }

    // --- Pre-step 2: rename placeholder bank accounts, null out institution ---
    const bankAccounts = await tx.select().from(ledgerBankAccounts);
    const clubBank = bankAccounts.find((b) => b.entityId === clubEntity.id);
    const foundationBank = bankAccounts.find((b) => b.entityId === foundationEntity.id);
    if (!clubBank || !foundationBank) throw new Error("Missing club/foundation ledger_bank_accounts rows");

    await tx
      .update(ledgerBankAccounts)
      .set({ name: "Administrative Checking", institution: null, updatedAt: new Date() })
      .where(eq(ledgerBankAccounts.id, clubBank.id));
    await tx
      .update(ledgerBankAccounts)
      .set({ name: "Foundation Checking", institution: null, updatedAt: new Date() })
      .where(eq(ledgerBankAccounts.id, foundationBank.id));
    console.log(`\nRenamed bank accounts: "Administrative Checking" (club), "Foundation Checking" (foundation).`);

    // --- Pre-step 3: upsert new categories ---
    let categoriesCreated = 0;
    for (const c of CATEGORY_UPSERTS) {
      const entityId = c.entityKey === "club" ? clubEntity.id : foundationEntity.id;
      const existing = await tx
        .select({ id: ledgerCategories.id })
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, entityId),
            eq(ledgerCategories.fundKind, c.fundKind),
            eq(ledgerCategories.flow, c.flow),
            eq(ledgerCategories.name, c.name),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(ledgerCategories).values({
          entityId,
          fundKind: c.fundKind,
          flow: c.flow,
          name: c.name,
          sortOrder: 900,
        });
        categoriesCreated++;
      }
    }
    console.log(`\nCategories upserted: ${categoriesCreated} created, ${CATEGORY_UPSERTS.length - categoriesCreated} already existed.`);

    // --- Pre-step 4: set fund opening balances ---
    const funds = await tx.select().from(ledgerFunds);
    const clubAdminFund = funds.find((f) => f.entityId === clubEntity.id && f.slug === "administrative");
    const clubActivityFund = funds.find((f) => f.entityId === clubEntity.id && f.slug === "activity");
    const foundationCharitableFund = funds.find(
      (f) => f.entityId === foundationEntity.id && f.slug === "charitable",
    );
    const foundationScholarshipFund = funds.find(
      (f) => f.entityId === foundationEntity.id && f.slug === "scholarship",
    );
    if (!clubAdminFund || !clubActivityFund || !foundationCharitableFund || !foundationScholarshipFund) {
      throw new Error("Missing one or more ledger_funds rows");
    }

    await tx
      .update(ledgerFunds)
      .set({ openingBalanceCents: CLUB_ADMINISTRATIVE_OPENING_CENTS, updatedAt: new Date() })
      .where(eq(ledgerFunds.id, clubAdminFund.id));
    await tx
      .update(ledgerFunds)
      .set({ openingBalanceCents: FOUNDATION_CHARITABLE_OPENING_CENTS, updatedAt: new Date() })
      .where(eq(ledgerFunds.id, foundationCharitableFund.id));
    console.log(
      `\nOpening balances set: Club Administrative ${money(CLUB_ADMINISTRATIVE_OPENING_CENTS)}, Foundation Charitable ${money(
        FOUNDATION_CHARITABLE_OPENING_CENTS,
      )}. (Club Activity and Foundation Scholarship remain $0.)`,
    );

    // --- Pre-step 0 (idempotency): delete any previously-imported quicken rows ---
    const priorImported = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(like(ledgerTransactions.memo, `%${IMPORT_MARKER}`));
    if (priorImported.length > 0) {
      await tx.delete(ledgerTransactions).where(
        inArray(
          ledgerTransactions.id,
          priorImported.map((r) => r.id),
        ),
      );
    }
    console.log(`\nDeleted ${priorImported.length} previously-imported [quicken-import] rows (idempotent re-import).`);

    // --- Re-fetch categories (now includes newly-created ones) for name → id lookup ---
    const allCategories = await tx.select().from(ledgerCategories);
    function findCategoryId(entityId: string, fundKind: string, flow: string, name: string): string {
      const c = allCategories.find(
        (c) => c.entityId === entityId && c.fundKind === fundKind && c.flow === flow && c.name === name,
      );
      if (!c) throw new Error(`Category not found: entity=${entityId} fundKind=${fundKind} flow=${flow} name="${name}"`);
      return c.id;
    }

    const fundIdByKind: Record<string, string> = {
      "club/administrative": clubAdminFund.id,
      "club/activity": clubActivityFund.id,
      "foundation/charitable": foundationCharitableFund.id,
    };

    // --- Insert transactions ---
    const allMapped = [...foundationResult.mapped, ...clubResult.mapped];
    const insertRows = allMapped.map((t) => {
      const entityId = t.entityKey === "club" ? clubEntity.id : foundationEntity.id;
      const fundId = fundIdByKind[`${t.entityKey}/${t.fundKind}`];
      const bankAccountId = t.entityKey === "club" ? clubBank.id : foundationBank.id;
      const categoryId = findCategoryId(entityId, t.fundKind, t.flow, t.categoryName);
      return {
        entityId,
        fundId,
        bankAccountId,
        txnDate: t.txnDate,
        flow: t.flow,
        categoryId,
        amountCents: t.amountCents,
        party: t.party,
        memo: buildMemo(t.memo),
        beneficiaryCause: t.beneficiaryCause,
        paymentMethod: t.paymentMethod,
        checkNumber: t.checkNumber,
        status: "posted" as const,
        reconciled: t.reconciled,
        reconciledAt: t.reconciled ? new Date() : null,
        recordedByUserId: recorder.id,
        donorId: null,
      };
    });

    if (insertRows.length > 0) {
      await tx.insert(ledgerTransactions).values(insertRows);
    }
    console.log(`\nInserted ${insertRows.length} transactions (${foundationResult.mapped.length} Foundation, ${clubResult.mapped.length} Club).`);
  });

  // ---- Post-apply DB verification ----
  console.log(`\n${"=".repeat(78)}`);
  console.log("POST-APPLY DB VERIFICATION");
  console.log("=".repeat(78));

  const entityRows = await db.select().from(ledgerEntities);
  const clubEntity = entityRows.find((e) => e.slug === "club")!;
  const foundationEntity = entityRows.find((e) => e.slug === "foundation")!;
  const funds = await db.select().from(ledgerFunds);
  const dbClubAdmin = funds.find((f) => f.entityId === clubEntity.id && f.slug === "administrative")!;
  const dbClubActivity = funds.find((f) => f.entityId === clubEntity.id && f.slug === "activity")!;
  const dbFoundationCharitable = funds.find(
    (f) => f.entityId === foundationEntity.id && f.slug === "charitable",
  )!;

  const allTxns = await db.select().from(ledgerTransactions);
  function fundNet(fundId: string): number {
    const txns = allTxns.filter((t) => t.fundId === fundId);
    const inc = txns.filter((t) => t.flow === "income").reduce((s, t) => s + t.amountCents, 0);
    const exp = txns.filter((t) => t.flow === "expense").reduce((s, t) => s + t.amountCents, 0);
    return inc - exp;
  }

  const dbFoundationEnding = dbFoundationCharitable.openingBalanceCents + fundNet(dbFoundationCharitable.id);
  const dbClubEnding =
    dbClubAdmin.openingBalanceCents +
    fundNet(dbClubAdmin.id) +
    dbClubActivity.openingBalanceCents +
    fundNet(dbClubActivity.id);

  console.log(
    `Foundation Charitable fund DB balance: ${money(dbFoundationEnding)}  (target ${money(
      FOUNDATION_TARGET_ENDING_CENTS,
    )})  ${dbFoundationEnding === FOUNDATION_TARGET_ENDING_CENTS ? "OK" : "MISMATCH"}`,
  );
  console.log(
    `Club (Administrative + Activity) DB balance: ${money(dbClubEnding)}  (target ${money(
      CLUB_TARGET_ENDING_CENTS,
    )})  ${dbClubEnding === CLUB_TARGET_ENDING_CENTS ? "OK" : "MISMATCH"}`,
  );

  console.log(`\nApply complete.`);
}

// Guard against auto-execution on import. scripts/backfill-check-numbers.ts
// (Bank Reconciliation inc1, DECISION-034) imports several helpers/constants
// from this module by name — it must NOT trigger this script's own
// destructive-and-total --apply path (or even its dry-run parse/verify
// pass) merely by importing it. Only run main() when this file is the
// actual entry point invoked on the command line.
const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/import-quicken-ledger.ts");
if (invokedDirectly) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
