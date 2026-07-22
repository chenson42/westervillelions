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
 *   bankAccountId?: string;
 *   beneficiaryCause?: string;
 *   publicNote?: string;      // treasurer-curated, member-facing annotation on
 *     // /members/impact; trimmed, capped at 200 chars server-side (400 REJECT
 *     // if over, not truncated), expense-only.
 *   receiptStorageKey?: string;
 * }
 * Response 201: { id: string; derivedFiscalYear: number }
 *
 * --- Transfer transaction body ---
 * {
 *   transfer: true;
 *   entityId: string;
 *   sourceFundId: string;
 *   destFundId: string;
 *   txnDate: string;
 *   amountCents: number;
 *   memo?: string;
 *   bankAccountId?: string;
 * }
 * Response 201: { transferGroupId: string; derivedFiscalYear: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerFunds, ledgerCategories } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getFiscalYear } from "@/lib/fiscal-year";
import { getSettings, getEmailsForFeature } from "@/lib/ledger-queries";
import { sendEmail } from "@/lib/email";
import { RECEIPT_KEY_REGEX } from "@/lib/receipt-storage";

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
        bankAccountId: bankAccountId ?? null,
        beneficiaryCause: beneficiaryCause?.trim() ?? null,
        publicNote: publicNoteResult.value,
        receiptStorageKey: receiptStorageKey?.trim() ?? null,
        status: derivedStatus,
        recordedByUserId: session.user.id,
      })
      .returning({ id: ledgerTransactions.id });

    // E-1: Notify LEDGER_APPROVE holders when a disbursement is pending approval
    if (derivedStatus === "pending") {
      try {
        const approverEmails = await getEmailsForFeature(FEATURES.LEDGER_APPROVE);
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
        const amountDollars = (amountCents / 100).toFixed(2);
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
// Transfer handler (two-row atomic insert)
// ---------------------------------------------------------------------------

async function handleTransfer(
  body: Record<string, unknown>,
  userId: string,
): Promise<NextResponse> {
  const { entityId, sourceFundId, destFundId, txnDate: rawDate, amountCents, memo, bankAccountId } =
    body;

  if (!entityId || typeof entityId !== "string") {
    return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  }
  if (!sourceFundId || typeof sourceFundId !== "string") {
    return NextResponse.json({ error: "sourceFundId is required" }, { status: 400 });
  }
  if (!destFundId || typeof destFundId !== "string") {
    return NextResponse.json({ error: "destFundId is required" }, { status: 400 });
  }
  if (sourceFundId === destFundId) {
    return NextResponse.json({ error: "Cannot transfer a fund to itself" }, { status: 400 });
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

  // Validate both funds belong to the same entity (cross-entity transfers are rejected)
  const fundRows = await db
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(
      and(
        // Use inArray-style with OR is not available; fetch both individually
        eq(ledgerFunds.entityId, entityId as string),
      ),
    );

  const sourceRow = fundRows.find((f) => f.id === sourceFundId);
  const destRow = fundRows.find((f) => f.id === destFundId);

  if (!sourceRow) {
    return NextResponse.json(
      { error: "Source fund not found or does not belong to the specified entity" },
      { status: 400 },
    );
  }
  if (!destRow) {
    return NextResponse.json(
      { error: "Destination fund not found or does not belong to the specified entity" },
      { status: 400 },
    );
  }
  // Both belong to entityId by construction of the query above

  const derivedFiscalYear = getFiscalYear(new Date(txnDate + "T00:00:00"));
  const transferGroupId = crypto.randomUUID();

  const cleanMemo = memo && typeof memo === "string" ? memo.trim() || null : null;
  const cleanBankAccountId =
    bankAccountId && typeof bankAccountId === "string" ? bankAccountId : null;

  // Atomic two-row insert (DECISION-016)
  await db.transaction(async (tx) => {
    await tx.insert(ledgerTransactions).values([
      {
        // Debit row: source fund loses money (flow='expense')
        entityId: entityId as string,
        fundId: sourceFundId as string,
        txnDate,
        flow: "expense",
        amountCents: amountCents as number,
        transferGroupId,
        memo: cleanMemo,
        bankAccountId: cleanBankAccountId,
        status: "posted",
        recordedByUserId: userId,
      },
      {
        // Credit row: destination fund gains money (flow='income')
        entityId: entityId as string,
        fundId: destFundId as string,
        txnDate,
        flow: "income",
        amountCents: amountCents as number,
        transferGroupId,
        memo: cleanMemo,
        bankAccountId: cleanBankAccountId,
        status: "posted",
        recordedByUserId: userId,
      },
    ]);
  });

  return NextResponse.json({ transferGroupId, derivedFiscalYear }, { status: 201 });
}
