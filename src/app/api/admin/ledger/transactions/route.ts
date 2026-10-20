/**
 * POST /api/admin/ledger/transactions
 *
 * Records a new ledger transaction (income or expense) or a transfer pair.
 *
 * Gate: LEDGER_RECORD
 *
 * --- Normal transaction body ---
 * {
 *   entityId: string;
 *   fundId: string;
 *   txnDate: string;           // YYYY-MM-DD
 *   flow: 'income' | 'expense';
 *   amountCents: number;       // positive integer, > 0, <= INT4_MAX
 *   categoryId?: string;
 *   party?: string;            // required when flow='income'
 *   memo?: string;
 *   paymentMethod?: string;    // 'check' | 'cash' | 'zeffy' | 'other'
 *   checkNumber?: string;      // structured check # (T-18); trimmed, capped at 20 chars
 *   bankAccountId: string;     // required — 400 if missing/blank (default-bank-account bug fix)
 *   beneficiaryCause?: string;
 *   publicNote?: string;      // treasurer-curated, member-facing annotation on
 *     // /members/impact; trimmed, capped at 200 chars server-side (400 REJECT
 *     // if over, not truncated), expense-only.
 *   receiptStorageKey?: string;
 *   budgetLineId?: string;     // explicit budget-line link (B-30, DECISION-061);
 *     // expense-only; server-validated against fund/derived-FY/category — 400
 *     // on mismatch, 404 on a nonexistent/malformed id.
 *   donorId?: string | null;   // B-172: income into Public Funds or a Foundation charitable fund only —
 *     // 400 donor_not_applicable elsewhere, 404 donor_not_found for an unknown donor.
 * }
 * Response 201: { id: string; derivedFiscalYear: number }
 *
 * --- Transfer transaction body (DECISION-058) ---
 * {
 *   transfer: true;
 *   sourceFundId: string;
 *   destFundId: string;
 *   sourceBankAccountId: string;   // required — each leg carries its OWN account
 *   destBankAccountId: string;     // required
 *   txnDate: string;
 *   amountCents: number;
 *   memo?: string;
 * }
 * A sweep to the Foundation (Club Public Funds to the Foundation's charitable
 * fund) is no longer accepted here: 400 `use_sweep_batch` (B-172 Increment 2b,
 * DECISION-126). It is recorded through POST /api/admin/ledger/sweep-batches.
 * `entityId` is NOT accepted here — both legs' entities are derived
 * authoritatively from the sourceFundId/destFundId rows themselves (a client
 * can no longer influence the fund lookup by supplying an entityId).
 * Direction is decided by checkTransferDirection() (src/lib/ledger-transfer-policy.ts) —
 * deny-by-default; blocked directions 403 with a specific policy reason.
 * Response 201: { id: string (the expense-leg id); transferGroupId: string; derivedFiscalYear: number; status: 'posted' | 'pending' }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerFunds, ledgerCategories, ledgerBankAccounts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getFiscalYear } from "@/lib/fiscal-year";
import { isUuid } from "@/lib/utils";
import { getSettings, getBudgetLineForLinkValidation, donorExists } from "@/lib/ledger-queries";
import { getFundLabels } from "@/lib/ledger-fund-labels-queries";
import { notifyPendingApprovers } from "@/lib/ledger-approval-notify";
import { normalizeCheckNumber } from "@/lib/ledger";
import { RECEIPT_KEY_REGEX } from "@/lib/receipt-storage";
import { checkTransferDirection } from "@/lib/ledger-transfer-policy";
import { validateBankAccountForEntity } from "@/lib/ledger-transaction-validation";
import { SWEEP_ERROR_COPY } from "@/lib/ledger-sweep";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2_147_483_647;
const VALID_FLOWS = ["income", "expense"] as const;
const VALID_METHODS = ["check", "cash", "zeffy", "debit_card", "bill_pay", "other"] as const;
const PUBLIC_NOTE_MAX_LEN = 200;

type Flow = (typeof VALID_FLOWS)[number];
type PaymentMethod = (typeof VALID_METHODS)[number];

function isValidFlow(v: unknown): v is Flow {
  return typeof v === "string" && (VALID_FLOWS as readonly string[]).includes(v);
}
function isValidMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (VALID_METHODS as readonly string[]).includes(v);
}

/** Parse and validate a YYYY-MM-DD date string. Returns null if invalid. */
function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_REGEX.test(raw)) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return raw;
}

/** Validate amountCents: positive integer, <= INT4_MAX */
function validateAmount(v: unknown): string | null {
  if (v === undefined || v === null) return "amountCents is required";
  if (typeof v !== "number" || !Number.isInteger(v)) return "amountCents must be an integer";
  if (v <= 0) return "amountCents must be greater than 0";
  if (v > INT4_MAX) return `amountCents must not exceed ${INT4_MAX} (~$21.4M)`;
  return null;
}

/**
 * Trim and cap-reject publicNote (Impact Gift Public Note). Unlike memo/
 * beneficiaryCause, this field renders unmoderated on the member-facing
 * `/members/impact` page, so overlong input is REJECTED (400), never
 * silently truncated — a curated public-facing sentence should never be
 * cut off mid-word. Empty-after-trim normalizes to null.
 */
function normalizePublicNote(v: unknown): { value: string | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "publicNote must be a string" };
  const trimmed = v.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > PUBLIC_NOTE_MAX_LEN) {
    return { error: `Keep the public note under ${PUBLIC_NOTE_MAX_LEN} characters.` };
  }
  return { value: trimmed };
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    // ── Transfer path ──────────────────────────────────────────────────────
    if (body.transfer === true) {
      return await handleTransfer(body, session.user.id);
    }

    // ── Normal transaction path ────────────────────────────────────────────
    const {
      entityId,
      fundId,
      txnDate: rawDate,
      flow,
      amountCents,
      categoryId,
      party,
      memo,
      paymentMethod,
      checkNumber,
      bankAccountId,
      beneficiaryCause,
      publicNote,
      receiptStorageKey,
      budgetLineId,
      donorId,
    } = body;

    // Required fields
    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    if (!fundId || typeof fundId !== "string") {
      return NextResponse.json({ error: "fundId is required" }, { status: 400 });
    }
    if (!isValidFlow(flow)) {
      return NextResponse.json(
        { error: "flow must be 'income' or 'expense'" },
        { status: 400 },
      );
    }

    const txnDate = parseDate(rawDate);
    if (!txnDate) {
      return NextResponse.json(
        { error: "txnDate must be a valid date in YYYY-MM-DD format" },
        { status: 400 },
      );
    }

    const amountError = validateAmount(amountCents);
    if (amountError) {
      return NextResponse.json({ error: amountError }, { status: 400 });
    }

    // Bank account is required — every transaction must carry a bank account
    // by construction (default-bank-account bug fix,
    // docs/work-log/2026-07-29-default-bank-account.md). The form pre-fills
    // the entity's default account, so this only rejects a deliberately
    // cleared selection.
    if (!bankAccountId || typeof bankAccountId !== "string") {
      return NextResponse.json(
        { error: "Select a bank account before saving this transaction." },
        { status: 400 },
      );
    }

    // party required for income
    if (flow === "income" && (!party || typeof party !== "string" || !party.trim())) {
      return NextResponse.json(
        { error: "party is required for income transactions" },
        { status: 400 },
      );
    }

    if (paymentMethod !== undefined && paymentMethod !== null && !isValidMethod(paymentMethod)) {
      return NextResponse.json(
        { error: "paymentMethod must be one of: check, cash, zeffy, debit_card, bill_pay, other" },
        { status: 400 },
      );
    }

    const checkNumberResult = normalizeCheckNumber(checkNumber);
    if ("error" in checkNumberResult) {
      return NextResponse.json({ error: checkNumberResult.error }, { status: 400 });
    }

    // publicNote (Impact Gift Public Note): trim/cap-reject, then expense-only
    // guard (belt-and-suspenders — the impact page never renders non-expense
    // rows regardless, but the server enforces the invariant, not just the UI).
    const publicNoteResult = normalizePublicNote(publicNote);
    if ("error" in publicNoteResult) {
      return NextResponse.json({ error: publicNoteResult.error }, { status: 400 });
    }
    if (publicNoteResult.value && flow !== "expense") {
      return NextResponse.json(
        { error: "Public notes can only be attached to expense transactions" },
        { status: 400 },
      );
    }

    // receiptStorageKey (DECISION-035): opaque key minted by the upload route,
    // never a client-supplied URL. Only valid for expense transactions.
    if (receiptStorageKey !== undefined && receiptStorageKey !== null) {
      if (typeof receiptStorageKey !== "string" || !RECEIPT_KEY_REGEX.test(receiptStorageKey)) {
        return NextResponse.json(
          { error: "receiptStorageKey format is invalid" },
          { status: 400 },
        );
      }
      if (flow !== "expense") {
        return NextResponse.json(
          { error: "Receipts can only be attached to expense transactions" },
          { status: 400 },
        );
      }
    }

    // Validate fund belongs to entity
    const fundRows = await db
      .select({ id: ledgerFunds.id, kind: ledgerFunds.kind, entityId: ledgerFunds.entityId })
      .from(ledgerFunds)
      .where(eq(ledgerFunds.id, fundId))
      .limit(1);
    const fund = fundRows[0];
    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }
    if (fund.entityId !== entityId) {
      return NextResponse.json(
        { error: "Fund does not belong to the specified entity" },
        { status: 400 },
      );
    }

    // Donor on a gift (B-172): income into Public Funds or a Foundation
    // charitable fund only. Absent or null is exactly the old behaviour.
    // Everywhere else the donor panel does not exist, so a donorId is refused
    // rather than stored.
    let validatedDonorId: string | null = null;
    if (donorId !== undefined && donorId !== null) {
      if (typeof donorId !== "string" || !isUuid(donorId)) {
        return NextResponse.json({ error: "donorId must be a donor id or null" }, { status: 400 });
      }
      if (flow !== "income" || (fund.kind !== "activity" && fund.kind !== "charitable")) {
        const fundLabels = await getFundLabels();
        return NextResponse.json(
          {
            error: `A donor can only be recorded on income in ${fundLabels.activity} or the Foundation's Charitable fund.`,
            code: "donor_not_applicable",
          },
          { status: 400 },
        );
      }
      if (!(await donorExists(donorId))) {
        return NextResponse.json({ error: "Donor not found", code: "donor_not_found" }, { status: 404 });
      }
      validatedDonorId = donorId;
    }

    // Validate the bank account (DECISION-109): it must exist, belong to the
    // body's entity, and be active. Before this, a cross-entity id was saved
    // silently and a nonexistent one was a foreign-key 500.
    const bankFit = await validateBankAccountForEntity(db, bankAccountId, entityId, {
      requireActive: true,
    });
    if (!bankFit.ok) {
      return NextResponse.json({ error: bankFit.error }, { status: bankFit.status });
    }

    // Validate category if provided
    if (categoryId) {
      const catRows = await db
        .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind, flow: ledgerCategories.flow })
        .from(ledgerCategories)
        .where(eq(ledgerCategories.id, categoryId))
        .limit(1);
      const cat = catRows[0];
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
      if (cat.fundKind !== fund.kind) {
        return NextResponse.json(
          { error: "Category does not match fund type" },
          { status: 400 },
        );
      }
      if (cat.flow !== flow) {
        return NextResponse.json(
          { error: "Category flow does not match transaction flow" },
          { status: 400 },
        );
      }
    }

    // Derive fiscal year from txnDate for client feedback
    const derivedFiscalYear = getFiscalYear(new Date(txnDate + "T00:00:00"));

    // Explicit budget-line link (B-30, DECISION-061) — server-validated
    // regardless of the picker's own client-side filtering (Phase 1
    // adversarial pass: a direct API call must not be able to bypass it).
    // Mirrors the categoryId validation above: fetch -> 404 if missing ->
    // 400 if mismatched.
    let validatedBudgetLineId: string | null = null;
    if (budgetLineId !== undefined && budgetLineId !== null && budgetLineId !== "") {
      if (typeof budgetLineId !== "string") {
        return NextResponse.json({ error: "budgetLineId must be a string" }, { status: 400 });
      }
      const line = await getBudgetLineForLinkValidation(budgetLineId);
      if (!line) {
        return NextResponse.json({ error: "Budget line not found" }, { status: 404 });
      }
      if (
        line.fundId !== fundId ||
        line.fiscalYear !== derivedFiscalYear ||
        line.categoryId !== (categoryId ?? null) ||
        line.flow !== "expense" ||
        flow !== "expense"
      ) {
        return NextResponse.json(
          {
            error:
              "This budget line does not match the transaction's fund, fiscal year, or category.",
          },
          { status: 400 },
        );
      }
      validatedBudgetLineId = line.id;
    }

    // Derive status SERVER-SIDE — ignore any client-supplied `status` field.
    // inc2: expense over disbApprovalThresholdCents → 'pending'; transfers always 'posted'.
    // NEVER trust client input for status (adversarial pass from Phase 3 design).
    const settings = await getSettings();
    const derivedStatus: "pending" | "posted" =
      flow === "expense" && amountCents > settings.disbApprovalThresholdCents
        ? "pending"
        : "posted";

    // Insert
    const [txn] = await db
      .insert(ledgerTransactions)
      .values({
        entityId,
        fundId,
        txnDate,
        flow,
        amountCents,
        categoryId: categoryId ?? null,
        party: party?.trim() ?? null,
        memo: memo?.trim() ?? null,
        paymentMethod: paymentMethod ?? null,
        checkNumber: checkNumberResult.value,
        bankAccountId,
        beneficiaryCause: beneficiaryCause?.trim() ?? null,
        publicNote: publicNoteResult.value,
        receiptStorageKey: receiptStorageKey?.trim() ?? null,
        budgetLineId: validatedBudgetLineId,
        donorId: validatedDonorId,
        status: derivedStatus,
        recordedByUserId: session.user.id,
      })
      .returning({ id: ledgerTransactions.id });

    // E-1: Notify LEDGER_APPROVE holders when a disbursement is pending
    // approval. Best effort and isolated: notifyPendingApprovers() never
    // throws and logs its own failure (ledger-approval-notify.ts).
    if (derivedStatus === "pending") {
      const amountDollars = (amountCents / 100).toFixed(2);
      await notifyPendingApprovers({
        noun: "disbursement",
        subject: `Disbursement pending your approval — $${amountDollars}`,
        amountDollars,
        txnDate,
        party: typeof party === "string" ? party.trim() : null,
        memo: typeof memo === "string" ? memo.trim() : null,
        reviewTxnId: txn.id,
      });
    }

    return NextResponse.json({ id: txn.id, derivedFiscalYear, status: derivedStatus }, { status: 201 });
  } catch (error) {
    console.error("Error creating ledger transaction:", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Transfer handler (two-row atomic insert, DECISION-058). A cross-entity sweep
// is refused here; it is an itemized batch (ledger-sweep-batch.ts).
// ---------------------------------------------------------------------------

async function handleTransfer(
  body: Record<string, unknown>,
  userId: string,
): Promise<NextResponse> {
  const {
    sourceFundId,
    destFundId,
    sourceBankAccountId,
    destBankAccountId,
    txnDate: rawDate,
    amountCents,
    memo,
  } = body;

  if (!sourceFundId || typeof sourceFundId !== "string") {
    return NextResponse.json({ error: "sourceFundId is required" }, { status: 400 });
  }
  if (!destFundId || typeof destFundId !== "string") {
    return NextResponse.json({ error: "destFundId is required" }, { status: 400 });
  }
  if (!sourceBankAccountId || typeof sourceBankAccountId !== "string") {
    return NextResponse.json(
      { error: "Select a source bank account before saving this transaction." },
      { status: 400 },
    );
  }
  if (!destBankAccountId || typeof destBankAccountId !== "string") {
    return NextResponse.json(
      { error: "Select a destination bank account before saving this transaction." },
      { status: 400 },
    );
  }

  const txnDate = parseDate(rawDate);
  if (!txnDate) {
    return NextResponse.json(
      { error: "txnDate must be a valid date in YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  const amountError = validateAmount(amountCents);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  // Fetch both funds by id ALONE — no entity filter. entityId is no longer
  // client-supplied; both legs' entities are derived authoritatively from
  // these rows (closes the adversarial-pass trust gap: a client can no
  // longer influence the fund lookup by supplying an entityId). This is also
  // what allows the two funds to resolve to DIFFERENT entities, which is
  // required to represent a cross-entity Sweep at all.
  const fundRows = await db
    .select({
      id: ledgerFunds.id,
      kind: ledgerFunds.kind,
      entityId: ledgerFunds.entityId,
      name: ledgerFunds.name,
    })
    .from(ledgerFunds)
    .where(inArray(ledgerFunds.id, [sourceFundId, destFundId]));

  const sourceFund = fundRows.find((f) => f.id === sourceFundId);
  const destFund = fundRows.find((f) => f.id === destFundId);

  if (!sourceFund) {
    return NextResponse.json({ error: "Source fund not found" }, { status: 404 });
  }
  if (!destFund) {
    return NextResponse.json({ error: "Destination fund not found" }, { status: 404 });
  }

  // Directional allow-list (DECISION-058) — the single source of truth for
  // every matrix cell. Enforced here, server-side, regardless of what the
  // client's UI does or does not offer (defense in depth).
  const direction = checkTransferDirection(
    { entityId: sourceFund.entityId, fundId: sourceFund.id, kind: sourceFund.kind, name: sourceFund.name },
    { entityId: destFund.entityId, fundId: destFund.id, kind: destFund.kind, name: destFund.name },
  );
  if (!direction.allowed) {
    return NextResponse.json({ error: direction.reason }, { status: 403 });
  }

  // B-172 Inc 2b (B13): the single-amount sweep is closed. Answered right after
  // the direction check, before any other validation or write.
  if (direction.mode === "sweep") {
    const labels = await getFundLabels();
    return NextResponse.json(
      { error: SWEEP_ERROR_COPY.use_sweep_batch(labels), code: "use_sweep_batch" },
      { status: 400 },
    );
  }

  // No-op guard, narrowed to the TRUE no-op (Phase 1 resolved #1): same fund
  // AND same bank account. Same fund + different account is the sanctioned
  // Account-Transfer case (e.g. Admin Checking -> Petty Cash) and must not
  // be blocked here — checked separately from checkTransferDirection(),
  // which never sees bank accounts.
  if (sourceFundId === destFundId && sourceBankAccountId === destBankAccountId) {
    return NextResponse.json(
      { error: "Select a different bank account, or transfer to a different fund." },
      { status: 400 },
    );
  }

  // Bank-account ownership/active validation — new. Previously implicitly
  // safe because one bankAccountId was forced onto both legs of a
  // same-entity pair with no way to select a foreign account; once legs can
  // diverge, this becomes a required check.
  const bankAccountRows = await db
    .select({
      id: ledgerBankAccounts.id,
      entityId: ledgerBankAccounts.entityId,
      isActive: ledgerBankAccounts.isActive,
    })
    .from(ledgerBankAccounts)
    .where(inArray(ledgerBankAccounts.id, [sourceBankAccountId, destBankAccountId]));

  const sourceBankAccount = bankAccountRows.find((b) => b.id === sourceBankAccountId);
  const destBankAccount = bankAccountRows.find((b) => b.id === destBankAccountId);

  if (!sourceBankAccount) {
    return NextResponse.json({ error: "Source bank account not found" }, { status: 404 });
  }
  if (sourceBankAccount.entityId !== sourceFund.entityId) {
    return NextResponse.json(
      { error: "Source bank account does not belong to the source fund's entity" },
      { status: 400 },
    );
  }
  if (!sourceBankAccount.isActive) {
    return NextResponse.json({ error: "Source bank account is inactive" }, { status: 400 });
  }

  if (!destBankAccount) {
    return NextResponse.json({ error: "Destination bank account not found" }, { status: 404 });
  }
  if (destBankAccount.entityId !== destFund.entityId) {
    return NextResponse.json(
      { error: "Destination bank account does not belong to the destination fund's entity" },
      { status: 400 },
    );
  }
  if (!destBankAccount.isActive) {
    return NextResponse.json({ error: "Destination bank account is inactive" }, { status: 400 });
  }

  const derivedFiscalYear = getFiscalYear(new Date(txnDate + "T00:00:00"));
  const transferGroupId = crypto.randomUUID();
  const cleanMemo = memo && typeof memo === "string" ? memo.trim() || null : null;

  // Over-threshold approval gate, applied ONCE to the pair (DECISION-058) —
  // closes the "transfers always post" gap. Both legs carry the same
  // amountCents by construction, so one derivation covers both.
  const settings = await getSettings();
  const derivedStatus: "pending" | "posted" =
    (amountCents as number) > settings.disbApprovalThresholdCents ? "pending" : "posted";

  // Atomic two-row insert (DECISION-016, extended by DECISION-058)
  const insertedLegs = await db.transaction(async (tx) => {
    return tx.insert(ledgerTransactions).values([
      {
        // Debit row: source fund loses money (flow='expense')
        entityId: sourceFund.entityId,
        fundId: sourceFundId,
        txnDate,
        flow: "expense",
        amountCents: amountCents as number,
        categoryId: null,
        transferGroupId,
        memo: cleanMemo,
        bankAccountId: sourceBankAccountId,
        boardMinute: null,
        status: derivedStatus,
        recordedByUserId: userId,
      },
      {
        // Credit row: destination fund gains money (flow='income')
        entityId: destFund.entityId,
        fundId: destFundId,
        txnDate,
        flow: "income",
        amountCents: amountCents as number,
        categoryId: null,
        transferGroupId,
        memo: cleanMemo,
        bankAccountId: destBankAccountId,
        boardMinute: null,
        status: derivedStatus,
        recordedByUserId: userId,
      },
    ]).returning({ id: ledgerTransactions.id, flow: ledgerTransactions.flow });
  });
  // The expense (source) leg's id is the row the Approvals page lists and the
  // deep link targets. Absent only if the insert returned nothing usable; the
  // email then falls back to the plain Approvals URL (the link is a courtesy).
  const expenseLegId = insertedLegs?.find((r) => r.flow === "expense")?.id;

  // E-1: Notify LEDGER_APPROVE holders when a Transfer pair is pending
  // approval. Best effort and isolated (ledger-approval-notify.ts).
  if (derivedStatus === "pending") {
    const amountDollars = ((amountCents as number) / 100).toFixed(2);
    await notifyPendingApprovers({
      noun: "transfer",
      subject: `Transfer pending your approval — $${amountDollars}`,
      amountDollars,
      txnDate,
      party: null,
      memo: cleanMemo,
      reviewTxnId: expenseLegId,
    });
  }

  return NextResponse.json(
    {
      ...(expenseLegId ? { id: expenseLegId } : {}),
      transferGroupId,
      derivedFiscalYear,
      status: derivedStatus,
    },
    { status: 201 },
  );
}
