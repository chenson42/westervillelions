/**
 * Ledger helper utilities — pure functions, no DB access.
 *
 * All money values are integer cents (positive). Flow direction is encoded by
 * the `flow` field ('income' | 'expense'). Transfer rows use flow='expense' on
 * the debit side and flow='income' on the credit side (DECISION-016 / DECISION-017);
 * there is no 'transfer' flow value.
 *
 * The fiscal year runs Jul 1 – Jun 30, labeled by its starting year. FY helpers
 * live in src/lib/fiscal-year.ts and are the single source of truth (DECISION-015).
 *
 * Guardrails active in inc1: negative fund (HIGH), reserves threshold (WARN),
 * treasurer not bonded (WARN), income without party (WARN), cash disbursements (WARN),
 * expenses without receipt URL (INFO).
 *
 * Guardrails activated in inc2: two-fund firewall (HIGH), unapproved disbursements
 * over threshold (WARN), unreconciled transactions from prior months (WARN).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowRow = {
  flow: string; // 'income' | 'expense'
  amountCents: number;
};

export type FundState = {
  id: string;
  kind: string;
  balanceCents: number;
};

export type GuardrailSeverity = "ok" | "info" | "warn" | "high";

export type GuardrailFlag = {
  severity: GuardrailSeverity;
  title: string;
  detail: string;
  policyCite?: string;
};

export type BudgetVarianceResult = {
  varianceCents: number | null;
  pct: number | null;
};

export type Determine990Params = {
  taxClassification: string;
  charityStatus: string | null;
  grossReceiptsCents: number;
  assetsCents: number;
};

export type Determine990Result = {
  form: string;
  why: string;
};

// ---------------------------------------------------------------------------
// fundBalanceCents
// ---------------------------------------------------------------------------

/**
 * Computes the ending balance for a fund.
 *
 * Single-pass over the fund's own posted rows:
 *   income → +amountCents
 *   expense → −amountCents
 *
 * Transfer rows (flow='income' on credit side, flow='expense' on debit side)
 * are handled identically to regular income/expense because the two-row design
 * (DECISION-016) encodes the correct sign in the flow column. A 'transfer'
 * literal flow value will never appear (DECISION-017); if one does, it is
 * treated as neutral (returns sum unchanged) with a comment explaining why.
 *
 * @param openingCents  The fund's opening balance in cents
 * @param postedTxns    Rows belonging to this fund (already filtered to the fund)
 */
export function fundBalanceCents(
  openingCents: number,
  postedTxns: Array<FlowRow>,
): number {
  return postedTxns.reduce((sum, txn) => {
    if (txn.flow === "income") return sum + txn.amountCents;
    if (txn.flow === "expense") return sum - txn.amountCents;
    // 'transfer' as a literal flow value must never appear (DECISION-017).
    // If it does, treat it as neutral so the balance is not corrupted.
    return sum;
  }, openingCents);
}

// ---------------------------------------------------------------------------
// entityBalanceCents
// ---------------------------------------------------------------------------

/**
 * Computes the total balance across all funds for an entity.
 *
 * Each fund contributes its own opening balance plus its net transactions.
 *
 * @param funds  Array of { openingCents, postedTxns } — one entry per fund
 */
export function entityBalanceCents(
  funds: Array<{ openingCents: number; postedTxns: Array<FlowRow> }>,
): number {
  return funds.reduce((sum, f) => sum + fundBalanceCents(f.openingCents, f.postedTxns), 0);
}

// ---------------------------------------------------------------------------
// grossReceiptsCents
// ---------------------------------------------------------------------------

/**
 * Total gross receipts: sum of amountCents for all income rows.
 *
 * Used for the entity overview and 990 form selection. Expense and transfer
 * rows should NOT be passed here — caller is responsible for filtering to
 * income-only rows.
 *
 * @param incomeRows  Array of income transaction rows (flow='income')
 */
export function grossReceiptsCents(incomeRows: Array<{ amountCents: number }>): number {
  return incomeRows.reduce((sum, r) => sum + r.amountCents, 0);
}

// ---------------------------------------------------------------------------
// budgetVariance
// ---------------------------------------------------------------------------

/**
 * Computes the budget variance for a single category line.
 *
 * Returns { varianceCents: null, pct: null } when no budget is set (caller
 * renders "—" for both columns instead of a $0 variance).
 *
 * When budgetCents is 0, varianceCents is the negative of actualCents and pct
 * is null (avoid division-by-zero).
 *
 * Convention: positive variance = under budget (good); negative = over budget.
 *
 * @param actualCents   Actual YTD spend/receipt in cents
 * @param budgetCents   Annual budget in cents, or null if not set
 */
export function budgetVariance(
  actualCents: number,
  budgetCents: number | null,
): BudgetVarianceResult {
  if (budgetCents === null) {
    return { varianceCents: null, pct: null };
  }
  if (budgetCents === 0) {
    return { varianceCents: -actualCents, pct: null };
  }
  const varianceCents = budgetCents - actualCents;
  const pct = (varianceCents / budgetCents) * 100;
  return { varianceCents, pct };
}

// ---------------------------------------------------------------------------
// determine990
// ---------------------------------------------------------------------------

/**
 * Selects the IRS 990 form this entity should file based on classification,
 * gross receipts, and estimated assets.
 *
 * Logic from Lions_Financial_Transparency.pdf §5:
 *   - 501c4 / non-public-charity: 990 or 990-EZ based on receipts/assets
 *   - Public charity: 990-N (e-postcard) if receipts < $50k; 990-EZ if
 *     receipts < $200k and assets < $500k; otherwise 990
 *   - Private foundation: 990-PF always
 *
 * NOTE: `assetsCents` in inc1 is a proxy (entityBalanceCents). The full assets
 * calculation (inc3/inc4) will use a more accurate figure.
 */
export function determine990(params: Determine990Params): Determine990Result {
  const { taxClassification, charityStatus, grossReceiptsCents: receipts, assetsCents } = params;

  if (charityStatus === "private_foundation") {
    return { form: "990-PF", why: "Private foundations always file Form 990-PF." };
  }

  if (taxClassification === "501c3" && charityStatus === "public_charity") {
    // 990-N: gross receipts ≤ $50,000
    if (receipts <= 50_000 * 100) {
      return {
        form: "990-N",
        why: "Public charity with gross receipts ≤ $50,000 may file Form 990-N (e-Postcard).",
      };
    }
    // 990-EZ: gross receipts < $200,000 AND total assets < $500,000
    if (receipts < 200_000 * 100 && assetsCents < 500_000 * 100) {
      return {
        form: "990-EZ",
        why: "Public charity with gross receipts < $200,000 and assets < $500,000 may file Form 990-EZ.",
      };
    }
    return {
      form: "990",
      why: "Public charity with gross receipts ≥ $200,000 or assets ≥ $500,000 must file Form 990.",
    };
  }

  // 501c4 (social welfare) — not a public charity
  if (receipts <= 50_000 * 100) {
    return {
      form: "990-N",
      why: "501(c)(4) with gross receipts ≤ $50,000 may file Form 990-N.",
    };
  }
  if (receipts < 200_000 * 100 && assetsCents < 500_000 * 100) {
    return {
      form: "990-EZ",
      why: "501(c)(4) with gross receipts < $200,000 and assets < $500,000 may file Form 990-EZ.",
    };
  }
  return { form: "990", why: "Must file Form 990 based on gross receipts or total assets." };
}

// ---------------------------------------------------------------------------
// guardrails
// ---------------------------------------------------------------------------

export type GuardrailsInput = {
  funds: Array<FundState>;
  entityBalanceCents: number;
  settings: {
    reserveWarnThresholdCents: number;
    treasurerBonded: boolean;
    retentionYears: number;
  };
  /** Count of income transactions where party is null or blank */
  incomeWithoutParty: number;
  /** Count of expense transactions where paymentMethod = 'cash' */
  cashDisbursements: number;
  /** Count of expense transactions where receiptUrl is null */
  txnsWithoutReceipt: number;
  // ---------------------------------------------------------------------------
  // inc2 fields — all required in inc2+; callers on inc1 paths that cannot
  // supply these should pass 0 / 0 / 0 until they are updated.
  // ---------------------------------------------------------------------------
  /** Count of expense transactions with status='pending' (over-threshold disbursements awaiting approval) */
  pendingDisbursements: number;
  /**
   * Count of posted transactions where reconciled=false and txnDate is before
   * the first day of the current calendar month.
   */
  unreconciledPriorMonth: number;
  /**
   * Count of distinct transferGroupId values where one row's fund has kind='activity'
   * and the paired row's fund has kind='administrative' — Activity→Admin firewall.
   */
  firewallViolations: number;
};

/**
 * Evaluates all active guardrail checks and returns a list of flags.
 *
 * Active checks:
 *   inc1 — negative fund balance (HIGH), reserves threshold (WARN),
 *           treasurer not bonded (WARN), income without party (WARN),
 *           cash disbursements (WARN), expenses without receipt URL (INFO)
 *   inc2 — unapproved disbursements (WARN), unreconciled prior-month (WARN),
 *           two-fund firewall violation (HIGH)
 *
 * Inactive checks: compliance filing status (inc3 — ledger_filings table).
 *
 * Returns an empty array when all checks are clear.
 *
 * Severity levels:
 *   ok   — no issue (not returned in the array; only used internally)
 *   info — worth reviewing but not urgent
 *   warn — should be addressed soon
 *   high — requires immediate attention
 *
 * @param state  Aggregated entity state computed by getOverview()
 */
export function guardrails(state: GuardrailsInput): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];

  // Check 6: Negative fund balance (HIGH)
  for (const fund of state.funds) {
    if (fund.balanceCents < 0) {
      flags.push({
        severity: "high",
        title: `Negative fund balance: ${fund.kind}`,
        detail: `The ${fund.kind} fund has a negative balance. Review recent transactions immediately.`,
        policyCite: "Lions Financial Transparency Policy §6",
      });
    }
  }

  // Check 4: Reserves below warning threshold (WARN)
  if (state.entityBalanceCents < state.settings.reserveWarnThresholdCents) {
    const thresholdDollars = (state.settings.reserveWarnThresholdCents / 100).toFixed(2);
    const actualDollars = (state.entityBalanceCents / 100).toFixed(2);
    flags.push({
      severity: "warn",
      title: "Reserves below minimum threshold",
      detail: `Entity balance ($${actualDollars}) is below the $${thresholdDollars} reserve warning threshold.`,
      policyCite: "Lions Financial Transparency Policy §4",
    });
  }

  // Check 7: Treasurer not bonded (WARN)
  if (!state.settings.treasurerBonded) {
    flags.push({
      severity: "warn",
      title: "Treasurer not bonded",
      detail: "The treasurer has not been confirmed as bonded. Update the ledger settings when the bond is in place.",
      policyCite: "Lions Financial Transparency Policy §7",
    });
  }

  // Check 8: Income transactions missing party / itemized source (WARN)
  if (state.incomeWithoutParty > 0) {
    flags.push({
      severity: "warn",
      title: "Income entries missing itemized source",
      detail: `${state.incomeWithoutParty} income transaction${state.incomeWithoutParty === 1 ? "" : "s"} ${state.incomeWithoutParty === 1 ? "is" : "are"} missing a party (payer). Add the source for each to comply with itemized-receipt requirements.`,
      policyCite: "Lions Financial Transparency Policy §8",
    });
  }

  // Check 9: Cash disbursements present (WARN)
  if (state.cashDisbursements > 0) {
    flags.push({
      severity: "warn",
      title: "Cash disbursements recorded",
      detail: `${state.cashDisbursements} expense transaction${state.cashDisbursements === 1 ? "" : "s"} used cash as payment method. Cash payments reduce audit traceability — consider check or electronic payment.`,
      policyCite: "Lions Financial Transparency Policy §9",
    });
  }

  // Check 11: Expenses missing receipt URL (INFO)
  if (state.txnsWithoutReceipt > 0) {
    flags.push({
      severity: "info",
      title: "Expenses missing receipt documentation",
      detail: `${state.txnsWithoutReceipt} expense transaction${state.txnsWithoutReceipt === 1 ? "" : "s"} ${state.txnsWithoutReceipt === 1 ? "has" : "have"} no receipt URL attached. Retain receipts for ${state.settings.retentionYears} years per policy.`,
      policyCite: "Lions Financial Transparency Policy §11",
    });
  }

  // Check: unapproved disbursements over threshold (WARN) — inc2
  if (state.pendingDisbursements > 0) {
    const n = state.pendingDisbursements;
    flags.push({
      severity: "warn",
      title: "Disbursements pending board approval",
      detail: `${n} disbursement${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} awaiting board approval and excluded from posted balances. Review the Approvals screen.`,
      policyCite: "Lions Financial Transparency Policy §5",
    });
  }

  // Check: unreconciled transactions from prior months (WARN) — inc2
  if (state.unreconciledPriorMonth > 0) {
    const n = state.unreconciledPriorMonth;
    const now = new Date();
    const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    flags.push({
      severity: "warn",
      title: "Unreconciled transactions from prior months",
      detail: `${n} posted transaction${n === 1 ? "" : "s"} dated before ${monthName} ${n === 1 ? "has" : "have"} not been reconciled. Mark them reconciled after reviewing your bank statement.`,
      policyCite: "Lions Financial Transparency Policy §8",
    });
  }

  // Check: two-fund firewall violations (HIGH) — inc2
  if (state.firewallViolations > 0) {
    const n = state.firewallViolations;
    flags.push({
      severity: "high",
      title: "Two-fund firewall violation",
      detail: `${n} transfer${n === 1 ? "" : "s"} move${n === 1 ? "s" : ""} money from an Activity fund to the Administrative fund. Activity fund money must remain in activity accounts. Reverse or reclassify these transfers immediately.`,
      policyCite: "Lions Financial Transparency Policy §6 — Two-Fund Firewall",
    });
  }

  // TODO inc3: compliance filing status check (ledger_filings table)

  return flags;
}
