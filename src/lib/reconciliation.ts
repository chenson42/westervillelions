/**
 * Bank Reconciliation inc2 — pure functions, no DB access, no Next.js import.
 *
 * Mirrors ledger.ts's role as the pure-function/business-logic layer for The
 * Ledger: hand-rolled Chase CSV activity-export parsing (header validation,
 * row normalization, dedupe-key derivation), tie-out arithmetic, and
 * period-overlap/gap validation for reconciliation sessions. See
 * docs/work-log/2026-07-21-ledger-reconciliation-sessions.md (Phase 3 design)
 * and docs/decisions.md DECISION-036.
 *
 * No new npm dependency for CSV parsing (architect's Phase 2 ruling) — a
 * Chase activity export is a small, deterministic, 6-column CSV; club-scale
 * row counts (dozens to low hundreds per statement period) don't justify a
 * streaming parser or a third-party CSV library.
 *
 * All money values are integer cents. Unlike ledger_transactions'
 * positive-only + flow model, ledger_bank_lines.amountCents is SIGNED —
 * Chase's own convention (positive = credit, negative = debit) — since a
 * staged bank line has no flow semantics of its own until matched to a book
 * row (design doc "Edge Cases").
 */

// ---------------------------------------------------------------------------
// CSV line splitting (RFC4180-minimal: handles quoted fields with embedded
// commas/quotes; Chase's own export rarely needs this, but it's cheap
// insurance against a Description field that happens to contain a comma).
// ---------------------------------------------------------------------------

/**
 * Splits one CSV line into its raw cell values. Handles double-quoted fields
 * (with embedded commas, and `""` as an escaped literal quote) per RFC4180.
 * Does not trim cells — callers trim as needed.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

// ---------------------------------------------------------------------------
// validateChaseCsvHeader
// ---------------------------------------------------------------------------

export type CanonicalChaseColumn =
  | "postingDate"
  | "description"
  | "amount"
  | "type"
  | "balance"
  | "checkOrSlipNumber";

export type ChaseCsvColumnIndex = Record<CanonicalChaseColumn, number>;

/** Human display labels — used both for header lookup and the named error. */
const CHASE_COLUMN_LABELS: Record<CanonicalChaseColumn, string> = {
  postingDate: "Posting Date",
  description: "Description",
  amount: "Amount",
  type: "Type",
  balance: "Balance",
  checkOrSlipNumber: "Check or Slip #",
};

// Iteration order determines which column is named first when multiple are
// missing — Posting Date is checked first since it's the most fundamental
// column for a bank statement row.
const CHASE_COLUMN_ORDER: CanonicalChaseColumn[] = [
  "postingDate",
  "description",
  "amount",
  "type",
  "balance",
  "checkOrSlipNumber",
];

function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase();
}

export type ChaseCsvHeaderValidation =
  | { valid: true; columnIndex: ChaseCsvColumnIndex }
  | { valid: false; error: string };

/**
 * Validates a Chase activity-export header row against the six expected
 * columns (Posting Date, Description, Amount, Type, Balance, Check or Slip
 * #). Order-independent (name-keyed lookup) and case/whitespace-tolerant.
 *
 * On failure, names the SPECIFIC missing column in a human error, per Flow
 * A's example: "This file doesn't look like a Chase activity export —
 * missing a Posting Date column." Never a generic "invalid file" message.
 */
export function validateChaseCsvHeader(headerRow: string[]): ChaseCsvHeaderValidation {
  const normalized = headerRow.map(normalizeHeaderCell);
  const columnIndex = {} as ChaseCsvColumnIndex;

  for (const col of CHASE_COLUMN_ORDER) {
    const label = CHASE_COLUMN_LABELS[col];
    const idx = normalized.indexOf(normalizeHeaderCell(label));
    if (idx === -1) {
      return {
        valid: false,
        error: `This file doesn't look like a Chase activity export — missing a ${label} column`,
      };
    }
    columnIndex[col] = idx;
  }

  return { valid: true, columnIndex };
}

// ---------------------------------------------------------------------------
// parseChaseCsvRow
// ---------------------------------------------------------------------------

/** Parses a signed dollar-amount string ("-45.00", "1,234.56", "$12.00")
 *  into integer cents. Returns null when the value cannot be parsed as a
 *  valid amount (never throws, never silently returns 0). */
function parseSignedDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const noCommas = trimmed.replace(/,/g, "");
  const cleaned = noCommas.replace(/^\$/, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** Parses a Chase Posting Date cell (typically "MM/DD/YYYY"; ISO
 *  "YYYY-MM-DD" also accepted) into a "YYYY-MM-DD" string. Returns null on
 *  an unparseable value. */
function parseChaseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return null;
}

export type ParsedChaseRow = {
  /** "YYYY-MM-DD" */
  postingDate: string;
  description: string;
  /** SIGNED — positive = credit, negative = debit (Chase's own convention). */
  amountCents: number;
  /** Chase's raw "Type" column (e.g. "ACH_DEBIT"), or null when blank. */
  rawType: string | null;
  /** Chase's raw "Check or Slip #" column, verbatim — meaning depends on
   *  sign (deposit-slip-vs-check-number split, DECISION-036). null when
   *  blank, never "". */
  checkOrSlipNumber: string | null;
  /** Chase's running balance — display-only, never used in tie-out math. */
  balanceCents: number | null;
};

export type ParseChaseCsvRowResult =
  | { ok: true; row: ParsedChaseRow }
  | { ok: false; rowNumber: number; error: string };

/**
 * Parses one Chase CSV data row (already split into cells) using the column
 * index produced by validateChaseCsvHeader(). A row-level parse failure
 * (e.g. an unparseable Amount) returns a named error identifying the row
 * number and the bad value — never a thrown exception, never a silently
 * substituted 0.
 *
 * @param cells        Raw CSV cell values for this row (same order as the file's header row).
 * @param columnIndex  Canonical-column → cell-index map from validateChaseCsvHeader().
 * @param rowNumber     1-indexed data-row number (for error messages — excludes the header row).
 */
export function parseChaseCsvRow(
  cells: string[],
  columnIndex: ChaseCsvColumnIndex,
  rowNumber: number,
): ParseChaseCsvRowResult {
  const get = (col: CanonicalChaseColumn) => (cells[columnIndex[col]] ?? "").trim();

  const rawPostingDate = get("postingDate");
  const postingDate = parseChaseDate(rawPostingDate);
  if (postingDate === null) {
    return {
      ok: false,
      rowNumber,
      error: `Row ${rowNumber}: could not parse Posting Date value "${rawPostingDate}"`,
    };
  }

  const description = get("description");

  const rawAmount = get("amount");
  const amountCents = parseSignedDollarsToCents(rawAmount);
  if (amountCents === null) {
    return {
      ok: false,
      rowNumber,
      error: `Row ${rowNumber}: could not parse Amount value "${rawAmount}"`,
    };
  }

  const rawType = get("type");
  const rawBalance = get("balance");
  // Balance is display-only — an unparseable/blank value degrades to null,
  // never blocks the row (unlike Amount, which is load-bearing for tie-out).
  const balanceCents = rawBalance === "" ? null : parseSignedDollarsToCents(rawBalance);

  const rawCheckOrSlip = get("checkOrSlipNumber");

  return {
    ok: true,
    row: {
      postingDate,
      description,
      amountCents,
      rawType: rawType === "" ? null : rawType,
      checkOrSlipNumber: rawCheckOrSlip === "" ? null : rawCheckOrSlip,
      balanceCents,
    },
  };
}

// ---------------------------------------------------------------------------
// bankLineDedupeKey
// ---------------------------------------------------------------------------

/**
 * Deterministic dedupe key for a parsed bank line — date + description +
 * signed amount + check/slip number. Backs the
 * `(session_id, dedupe_key)` unique constraint (defense-in-depth against a
 * literally self-duplicated row inside one file; the primary duplicate-
 * upload defense is the session-level one-shot upload gate).
 *
 * checkOrSlipNumber is folded in as "" when null so that two lines
 * identical in every other respect but differing only by check/slip number
 * (e.g. null vs "DEP") never collapse into the same key.
 */
export function bankLineDedupeKey(row: {
  postingDate: string;
  description: string;
  amountCents: number;
  checkOrSlipNumber: string | null;
}): string {
  const desc = row.description.trim().toLowerCase();
  const check = row.checkOrSlipNumber ?? "";
  return `${row.postingDate}|${desc}|${row.amountCents}|${check}`;
}

// ---------------------------------------------------------------------------
// computeTieOut
// ---------------------------------------------------------------------------

export type TieOutParams = {
  openingBalanceCents: number;
  closingBalanceCents: number;
  /** Signed amountCents of every matched, in-period bank line. */
  matchedLineAmountsCents: number[];
  /** Count of in-period bank lines with no match yet — passed through
   *  unchanged into the result for the detail-page tie-out summary. Defaults
   *  to 0 (a caller computing arithmetic-only, e.g. the close route's gate,
   *  can omit it — that gate checks "every in-period line matched" as its
   *  own separate condition, not via this field). */
  unmatchedInPeriodCount?: number;
};

export type TieOutResult = {
  openingBalanceCents: number;
  matchedTotalCents: number;
  closingBalanceCents: number;
  /** closingBalanceCents − (openingBalanceCents + matchedTotalCents).
   *  Positive delta = the stated closing balance EXCEEDS the computed
   *  cleared total (more money than the matched activity accounts for).
   *  Zero delta = balanced. */
  deltaCents: number;
  balanced: boolean;
  unmatchedInPeriodCount: number;
};

/**
 * Computes the reconciliation tie-out: opening balance + net matched,
 * in-period bank-line activity, compared against the stated closing balance.
 *
 * Used both by the close route's hard gate (any non-zero delta blocks close
 * — per the user's 2026-07-21 decision, no discrepancy-note override exists)
 * and by the session detail page's running tie-out summary.
 */
export function computeTieOut(params: TieOutParams): TieOutResult {
  const matchedTotalCents = params.matchedLineAmountsCents.reduce((sum, c) => sum + c, 0);
  const computedCents = params.openingBalanceCents + matchedTotalCents;
  const deltaCents = params.closingBalanceCents - computedCents;

  return {
    openingBalanceCents: params.openingBalanceCents,
    matchedTotalCents,
    closingBalanceCents: params.closingBalanceCents,
    deltaCents,
    balanced: deltaCents === 0,
    unmatchedInPeriodCount: params.unmatchedInPeriodCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Date arithmetic helpers (UTC-safe — operates on "YYYY-MM-DD" date-only
// strings, never on naive-timestamp-as-local-time, per the project's known
// naive-timestamp-as-UTC bug class).
// ---------------------------------------------------------------------------

function daysBetweenUTC(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const fromUTC = Date.UTC(fy, fm - 1, fd);
  const toUTC = Date.UTC(ty, tm - 1, td);
  return Math.round((toUTC - fromUTC) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// validatePeriodOverlap
// ---------------------------------------------------------------------------

export type PeriodRange = { start: string; end: string };
export type ExistingSessionPeriod = PeriodRange & { id: string };

export type PeriodOverlapResult =
  | { overlap: false }
  | { overlap: true; conflictingSessionId: string; conflictingPeriod: PeriodRange };

/**
 * Hard-block overlap check for session creation: does `newPeriod` share even
 * one calendar day with any existing session's period on the same bank
 * account? Boundaries are INCLUSIVE — a single shared day counts as overlap,
 * since one bank-statement day can't belong to two sessions on the same
 * account. Checked against sessions of ANY status (open or closed) — a
 * closed session's claimed days are just as unavailable as an open one's.
 *
 * "YYYY-MM-DD" strings compare correctly with plain string `<=`/`<`
 * operators (lexicographic order matches chronological order for this
 * fixed-width format).
 *
 * @param newPeriod         The period being requested for a new session.
 * @param existingSessions  Every existing session (any status) for the same bank account.
 */
export function validatePeriodOverlap(
  newPeriod: PeriodRange,
  existingSessions: ExistingSessionPeriod[],
): PeriodOverlapResult {
  for (const existing of existingSessions) {
    if (newPeriod.start <= existing.end && existing.start <= newPeriod.end) {
      return {
        overlap: true,
        conflictingSessionId: existing.id,
        conflictingPeriod: { start: existing.start, end: existing.end },
      };
    }
  }
  return { overlap: false };
}

// ---------------------------------------------------------------------------
// computePeriodGapWarning
// ---------------------------------------------------------------------------

/**
 * Soft, non-blocking gap check: does the new session's period start exactly
 * one day after the most recent existing session's period end for this
 * account? If not, returns a warning string naming the gap length — the
 * caller still allows session creation to succeed (a gap is often
 * legitimate: a month with no statement, or working the historical backlog
 * out of strict order).
 *
 * @param newStart        The new session's statementPeriodStart ("YYYY-MM-DD").
 * @param priorPeriodEnd  The most recent existing session's statementPeriodEnd
 *                        for this account ("YYYY-MM-DD"), or null when this is
 *                        the first-ever session for the account (nothing to
 *                        compare against — always returns null in that case).
 */
export function computePeriodGapWarning(
  newStart: string,
  priorPeriodEnd: string | null,
): string | null {
  if (priorPeriodEnd === null) return null;

  const gapDays = daysBetweenUTC(priorPeriodEnd, newStart) - 1;
  if (gapDays <= 0) return null;

  return (
    `Prior session for this account closed ${priorPeriodEnd}; this period starts ${newStart}, ` +
    `leaving a ${gapDays}-day gap. Continue if that's expected.`
  );
}
