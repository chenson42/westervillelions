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
 * }
 * Response 201: { id: string; derivedFiscalYear: number }
 *
 * --- Transfer / Sweep transaction body (DECISION-058) ---
 * {
 *   transfer: true;
 *   sourceFundId: string;
 *   destFundId: string;
 *   sourceBankAccountId: string;   // required — each leg carries its OWN account
 *   destBankAccountId: string;     // required
 *   txnDate: string;
 *   amountCents: number;
 *   memo?: string;
 *   boardMinute?: string;          // required when checkTransferDirection() says requiresBoardMinute
 *   destCategoryId?: string;       // optional — Sweep destination (income) leg only;
 *                                   // defaults to the destination entity's seeded
 *                                   // "Public donations" income category when omitted
 * }
 * `entityId` is NOT accepted here — both legs' entities are derived
 * authoritatively from the sourceFundId/destFundId rows themselves (a client
 * can no longer influence the fund lookup by supplying an entityId).
 * Direction is decided by checkTransferDirection() (src/lib/ledger-transfer-policy.ts) —
 * deny-by-default; blocked directions 403 with a specific policy reason.
 * Response 201: { transferGroupId: string; derivedFiscalYear: number; status: 'posted' | 'pending' }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerFunds, ledgerCategories, ledgerBankAccounts } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getFiscalYear } from "@/lib/fiscal-year";
import { getSettings, getEmailsForFeature, getBudgetLineForLinkValidation } from "@/lib/ledger-queries";
import { sendEmail } from "@/lib/email";
import { RECEIPT_KEY_REGEX } from "@/lib/receipt-storage";
import { checkTransferDirection } from "@/lib/ledger-transfer-policy";
import { resolveTreasurer } from "@/lib/board-positions";

const BOARD_MINUTE_MAX_LEN = 500;
const PUBLIC_DONATIONS_CATEGORY_NAME = "Public donations";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2_147_483_647;
const VALID_FLOWS = ["income", "expense"] as const;
const VALID_METHODS = ["check", "cash", "zeffy", "debit_card", "bill_pay", "other"] as const;
const CHECK_NUMBER_MAX_LEN = 20;
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
 * Trim and length-cap checkNumber (T-18). Free-text identifier, not
 * strict-numeric — a hypothetical future suffixed/lettered check reference
 * (e.g. "1234-R") shouldn't be rejected. Returns `{ error }` on invalid
 * input, or `{ value }` with empty string normalized to null.
 */
function normalizeCheckNumber(v: unknown): { value: string | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== "string") return { error: "checkNumber must be a string" };
  const trimmed = v.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > CHECK_NUMBER_MAX_LEN) {
    return { error: `checkNumber must not exceed ${CHECK_NUMBER_MAX_LEN} characters` };
  }
  return { value: trimmed };
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
        status: derivedStatus,
        recordedByUserId: session.user.id,
      })
      .returning({ id: ledgerTransactions.id });

    // E-1: Notify LEDGER_APPROVE holders when a disbursement is pending
    // approval. Treasury CC rule (DECISION-086): resolved once, reused for
    // every approver in the loop — tolerant failure, never blocks the send.
    if (derivedStatus === "pending") {
      try {
        const approverEmails = await getEmailsForFeature(FEATURES.LEDGER_APPROVE);
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
        const amountDollars = (amountCents / 100).toFixed(2);
        const treasurer = await resolveTreasurer();
        if (!treasurer.ok) {
          console.warn(`[Ledger email] Treasurer CC skipped: ${treasurer.reason}`);
        }
        for (const email of approverEmails) {
          await sendEmail({
            to: email,
            from: fromEmail,
            subject: `Disbursement pending your approval — $${amountDollars}`,
            html: `<p>A disbursement requires board approval before it can be posted.</p>
<ul>
  <li><strong>Amount:</strong> $${amountDollars}</li>
  <li><strong>Date:</strong> ${txnDate}</li>
  ${party ? `<li><strong>Payee:</strong> ${party}</li>` : ""}
  ${memo ? `<li><strong>Memo:</strong> ${memo}</li>` : ""}
</ul>
<p>Please review and approve or reject this disbursement from the <a href="${process.env.NEXTAUTH_URL ?? ""}/admin/ledger/approvals">Approvals screen</a>.</p>`,
            ...(treasurer.ok ? { cc: treasurer.email } : {}),
          });
        }
      } catch {
        // Best-effort — email failure does not block the transaction insert
      }
    }

    return NextResponse.json({ id: txn.id, derivedFiscalYear, status: derivedStatus }, { status: 201 });
  } catch (error) {
    console.error("Error creating ledger transaction:", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Transfer / Sweep handler (two-row atomic insert, DECISION-058)
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
    boardMinute: rawBoardMinute,
    destCategoryId: rawDestCategoryId,
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
    .select({ id: ledgerFunds.id, kind: ledgerFunds.kind, entityId: ledgerFunds.entityId })
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
    { entityId: sourceFund.entityId, fundId: sourceFund.id, kind: sourceFund.kind },
    { entityId: destFund.entityId, fundId: destFund.id, kind: destFund.kind },
  );
  if (!direction.allowed) {
    return NextResponse.json({ error: direction.reason }, { status: 403 });
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

  // Mandatory board-minute reference for any direction the policy flags
  // (today: only the cross-entity Sweep) — required regardless of amount,
  // reusing the approve-route's trim/cap validation shape.
  let boardMinute: string | null = null;
  if (direction.requiresBoardMinute) {
    if (typeof rawBoardMinute !== "string" || !rawBoardMinute.trim()) {
      return NextResponse.json(
        { error: "A board-minute reference is required for a cross-entity sweep." },
        { status: 400 },
      );
    }
    boardMinute = rawBoardMinute.trim().slice(0, BOARD_MINUTE_MAX_LEN);
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

  // Destination-leg categorization — Sweep only (real charitable income for
  // 990 purposes); same-entity Transfer legs stay categoryless, as today.
  let destCategoryId: string | null = null;
  if (direction.mode === "sweep") {
    if (rawDestCategoryId !== undefined && rawDestCategoryId !== null) {
      if (typeof rawDestCategoryId !== "string") {
        return NextResponse.json({ error: "destCategoryId must be a string" }, { status: 400 });
      }
      const catRows = await db
        .select({
          id: ledgerCategories.id,
          entityId: ledgerCategories.entityId,
          fundKind: ledgerCategories.fundKind,
          flow: ledgerCategories.flow,
        })
        .from(ledgerCategories)
        .where(eq(ledgerCategories.id, rawDestCategoryId))
        .limit(1);
      const cat = catRows[0];
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
      if (cat.entityId !== destFund.entityId) {
        return NextResponse.json(
          { error: "Category does not belong to the destination fund's entity" },
          { status: 400 },
        );
      }
      if (cat.fundKind !== destFund.kind) {
        return NextResponse.json({ error: "Category does not match fund type" }, { status: 400 });
      }
      if (cat.flow !== "income") {
        return NextResponse.json(
          { error: "Category flow does not match transaction flow" },
          { status: 400 },
        );
      }
      destCategoryId = cat.id;
    } else {
      // Default: the destination entity's seeded "Public donations" income
      // category (already seeded for both fund kinds — drizzle/migrations/
      // 0044_ledger_books.sql, 0049_ledger_990_lines.sql — resolved by
      // name/kind, never a hard-coded UUID).
      const defaultCatRows = await db
        .select({ id: ledgerCategories.id })
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, destFund.entityId),
            eq(ledgerCategories.fundKind, destFund.kind),
            eq(ledgerCategories.flow, "income"),
            eq(ledgerCategories.name, PUBLIC_DONATIONS_CATEGORY_NAME),
          ),
        )
        .limit(1);
      if (defaultCatRows[0]) {
        destCategoryId = defaultCatRows[0].id;
      } else {
        // Defensive only — confirmed seeded in Phase 3 design. A missing
        // category is a data problem to fix separately, not a reason to
        // block a treasurer from recording a real bank movement that
        // already happened.
        console.error(
          `[ledger-transfer] Default "${PUBLIC_DONATIONS_CATEGORY_NAME}" category not found for entity`,
          destFund.entityId,
        );
      }
    }
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
  await db.transaction(async (tx) => {
    await tx.insert(ledgerTransactions).values([
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
        boardMinute,
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
        categoryId: destCategoryId,
        transferGroupId,
        memo: cleanMemo,
        bankAccountId: destBankAccountId,
        boardMinute,
        status: derivedStatus,
        recordedByUserId: userId,
      },
    ]);
  });

  // E-1: Notify LEDGER_APPROVE holders when a Transfer/Sweep pair is pending
  // approval — same mechanism as an ordinary over-threshold expense.
  // Treasury CC rule (DECISION-086): resolved once, reused for every
  // approver in the loop — tolerant failure, never blocks the send.
  if (derivedStatus === "pending") {
    try {
      const approverEmails = await getEmailsForFeature(FEATURES.LEDGER_APPROVE);
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
      const amountDollars = ((amountCents as number) / 100).toFixed(2);
      const label = direction.mode === "sweep" ? "Sweep" : "Transfer";
      const treasurer = await resolveTreasurer();
      if (!treasurer.ok) {
        console.warn(`[Ledger email] Treasurer CC skipped: ${treasurer.reason}`);
      }
      for (const email of approverEmails) {
        await sendEmail({
          to: email,
          from: fromEmail,
          subject: `${label} pending your approval — $${amountDollars}`,
          html: `<p>A ${label.toLowerCase()} requires board approval before it can be posted.</p>
<ul>
  <li><strong>Amount:</strong> $${amountDollars}</li>
  <li><strong>Date:</strong> ${txnDate}</li>
  ${memo ? `<li><strong>Memo:</strong> ${memo}</li>` : ""}
</ul>
<p>Please review and approve or reject this ${label.toLowerCase()} from the <a href="${process.env.NEXTAUTH_URL ?? ""}/admin/ledger/approvals">Approvals screen</a>.</p>`,
          ...(treasurer.ok ? { cc: treasurer.email } : {}),
        });
      }
    } catch {
      // Best-effort — email failure does not block the transaction insert
    }
  }

  return NextResponse.json(
    { transferGroupId, derivedFiscalYear, status: derivedStatus },
    { status: 201 },
  );
}
