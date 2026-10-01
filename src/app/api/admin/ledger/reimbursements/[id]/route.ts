/**
 * GET /api/admin/ledger/reimbursements/[id]
 *
 * Returns the full reimbursement detail (with member name).
 * receiptStorageKey is NEVER included in the response — access the receipt
 * via the /receipt proxy route.
 *
 * Gate: LEDGER_VIEW
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATCH /api/admin/ledger/reimbursements/[id]
 *
 * State-transition actions on a reimbursement (DECISION-106: no board approval;
 * the treasurer reviews and pays, the board reviews afterward). Two actions,
 * both gated on LEDGER_RECORD. The legacy 'approve' action no longer exists and
 * returns 400. 'approved' is a legacy read-only status from the board-approval
 * era: such rows stay payable and rejectable.
 *
 * Order of checks: auth (401) -> action (400) -> LEDGER_RECORD (403, BEFORE the
 * row read, so there is no 404-vs-403 existence oracle) -> row (404) -> status
 * actionable (409) -> self-action (403) -> body validation (400) -> write.
 *
 * Self-action: the submitter may never pay or reject their own request
 * (isOwnReimbursementRequest — user id OR member id). A second LEDGER_RECORD
 * holder must act.
 *
 * reject:
 *   Body: { action: 'reject', reason: string }.
 *   Atomic UPDATE ... WHERE status IN ('submitted','approved') RETURNING; zero
 *   rows -> 409 "already processed" and no email (a reject can never overwrite
 *   a concurrent pay).
 *
 * pay:
 *   Body: { action: 'pay', fundId, categoryId, paymentDate, paymentMethod,
 *     note?, budgetLineId?, expectedAmountCents: integer, expectedUpdatedAt: ISO }.
 *   expectedAmountCents / expectedUpdatedAt echo the row the treasurer was
 *   looking at; a mismatch is 409 "edited after you opened it" (a member may
 *   edit while status='submitted'). The timestamp is compared in application
 *   code (getTime()), never in SQL: updated_at is written with microseconds and
 *   read back as a millisecond JS Date, so SQL equality would false-409 every
 *   never-edited row. The atomic UPDATE instead pins value columns (amount,
 *   description, receipt key, cause) plus the status set.
 *   categoryId is REQUIRED (B-30, DECISION-061); budgetLineId is OPTIONAL and
 *   server-validated for fund / derived fiscal year / category / flow.
 *   In a DB transaction: inserts the expense ledger_transactions row
 *   (status='posted'), then the atomic reimbursement UPDATE. Zero rows rolls the
 *   insert back (ReimbursementConflictError -> 409).
 *
 * Responses:
 *   200 { id } (reject) | { id, ledgerTransactionId } (pay)
 *   400 validation / unknown action / missing stale tokens
 *   401 not authenticated
 *   403 missing ledger.record / own request
 *   404 not found
 *   409 not actionable / already processed / edited after opened
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ledgerReimbursements,
  ledgerTransactions,
  ledgerFunds,
  ledgerCategories,
} from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReimbursementWithMember,
  getUserEmail,
  getBudgetLineForLinkValidation,
} from "@/lib/ledger-queries";
import {
  REIMBURSEMENT_ACTIONABLE_STATUSES,
  isOwnReimbursementRequest,
  reimbursementTransactionStamp,
} from "@/lib/ledger";
import { sendEmail } from "@/lib/email";
import { escapeHtml, getFromEmail, getAppUrl } from "@/lib/email-compose";
import { getFiscalYear } from "@/lib/fiscal-year";
import { resolveTreasurer } from "@/lib/board-positions";

const REASON_MAX_LEN = 1000;
const NOTE_MAX_LEN = 1000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PAYMENT_METHODS = ["check", "cash", "other"] as const;

const STALE_MESSAGE = "This request was edited after you opened it. Reload and review it again.";
const ALREADY_PROCESSED = "This request was already processed";

/** Thrown inside the pay transaction when the atomic UPDATE matches zero rows. */
class ReimbursementConflictError extends Error {
  constructor() {
    super("REIMBURSEMENT_CONFLICT");
  }
}

function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_REGEX.test(raw)) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return raw;
}

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Treasury CC rule (DECISION-086): any email sent as part of running the
 * club's money CCs the treasurer. Tolerant — a resolver miss never blocks the
 * member's notification; it logs the reason and sends without a CC.
 */
async function sendMemberEmail(
  reimb: { submittedByUserId: string },
  subject: string,
  html: string,
  label: string,
): Promise<void> {
  try {
    const memberEmail = await getUserEmail(reimb.submittedByUserId);
    if (!memberEmail) return;
    const treasurer = await resolveTreasurer();
    if (!treasurer.ok) {
      console.warn(`[Ledger email] Treasurer CC skipped: ${treasurer.reason}`);
    }
    await sendEmail({
      to: memberEmail,
      from: getFromEmail(),
      subject,
      html,
      ...(treasurer.ok ? { cc: treasurer.email } : {}),
    });
  } catch (e) {
    // Best-effort: the state change already committed. No addresses in logs.
    console.warn(`[Reimbursement ${label}] member email failed`, {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_VIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const reimb = await getReimbursementWithMember(id);
    if (!reimb) {
      return NextResponse.json({ error: "Reimbursement not found" }, { status: 404 });
    }

    // Strip receiptStorageKey — access via /receipt proxy only
    const { receiptStorageKey: _k, ...safe } = reimb;
    return NextResponse.json({ reimbursement: safe });
  } catch (error) {
    console.error("Error fetching reimbursement:", error);
    return NextResponse.json({ error: "Failed to fetch reimbursement" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return json("Unauthorized", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const action: unknown = body?.action;

    if (action !== "reject" && action !== "pay") {
      return json("action must be one of: reject, pay", 400);
    }

    // Both actions share the gate; checked before the row read so a caller
    // without the permission learns nothing about whether the id exists.
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return json("Forbidden", 403);
    }

    const reimb = await getReimbursementWithMember(id);
    if (!reimb) {
      return json("Reimbursement not found", 404);
    }

    if (!(REIMBURSEMENT_ACTIONABLE_STATUSES as readonly string[]).includes(reimb.status)) {
      if (reimb.status === "paid") {
        return json("This reimbursement has already been marked paid", 409);
      }
      return json(
        action === "pay"
          ? "This reimbursement was rejected and cannot be paid"
          : "This reimbursement has already been rejected",
        409,
      );
    }

    if (isOwnReimbursementRequest(session.user, reimb)) {
      return json(
        action === "pay"
          ? "You cannot pay your own reimbursement request"
          : "You cannot reject your own reimbursement request",
        403,
      );
    }

    const appUrl = getAppUrl();

    // ── reject ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      const rawReason = body?.reason;
      if (!rawReason || typeof rawReason !== "string" || !rawReason.trim()) {
        return json("reason is required", 400);
      }
      const rejectionReason = rawReason.trim().slice(0, REASON_MAX_LEN);

      // Atomic: only a still-actionable row can be rejected, so a reject can
      // never overwrite a concurrent pay (status paid with a posted txn).
      const updated = await db
        .update(ledgerReimbursements)
        .set({
          status: "rejected",
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          rejectionReason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ledgerReimbursements.id, id),
            inArray(ledgerReimbursements.status, [...REIMBURSEMENT_ACTIONABLE_STATUSES]),
          ),
        )
        .returning({ id: ledgerReimbursements.id });

      if (updated.length === 0) {
        return json(ALREADY_PROCESSED, 409);
      }

      const amountDollars = (reimb.amountCents / 100).toFixed(2);
      await sendMemberEmail(
        reimb,
        "Your reimbursement request has been rejected",
        `<p>Your reimbursement request for <strong>$${amountDollars}</strong> has been rejected.</p>
<p><strong>Description:</strong> ${escapeHtml(reimb.description)}</p>
<p><strong>Reason for rejection:</strong> ${escapeHtml(rejectionReason)}</p>
<p>If you have questions, please contact the treasurer. You may submit a new request at <a href="${appUrl}/members/reimbursements">${appUrl}/members/reimbursements</a>.</p>`,
        "reject",
      );

      return NextResponse.json({ id });
    }

    // ── pay ──────────────────────────────────────────────────────────────────
    const expectedAmountCents: unknown = body?.expectedAmountCents;
    const expectedUpdatedAtRaw: unknown = body?.expectedUpdatedAt;
    if (typeof expectedAmountCents !== "number" || !Number.isInteger(expectedAmountCents)) {
      return json("expectedAmountCents is required and must be an integer", 400);
    }
    const expectedUpdatedAtMs =
      typeof expectedUpdatedAtRaw === "string" ? new Date(expectedUpdatedAtRaw).getTime() : NaN;
    if (Number.isNaN(expectedUpdatedAtMs)) {
      return json("expectedUpdatedAt is required and must be an ISO date string", 400);
    }

    // Stale check, in application code (never SQL timestamp equality).
    if (
      reimb.amountCents !== expectedAmountCents ||
      reimb.updatedAt.getTime() !== expectedUpdatedAtMs
    ) {
      return json(STALE_MESSAGE, 409);
    }

    // Validate required fields
    const fundId = body?.fundId;
    if (!fundId || typeof fundId !== "string") {
      return json("fundId is required", 400);
    }
    const paymentDate = parseDate(body?.paymentDate);
    if (!paymentDate) {
      return json("paymentDate must be a valid date in YYYY-MM-DD format", 400);
    }
    const paymentMethod = body?.paymentMethod;
    if (
      !paymentMethod ||
      !VALID_PAYMENT_METHODS.includes(paymentMethod as (typeof VALID_PAYMENT_METHODS)[number])
    ) {
      return json(`paymentMethod must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, 400);
    }
    const rawNote = body?.note;
    const note =
      rawNote && typeof rawNote === "string" ? rawNote.trim().slice(0, NOTE_MAX_LEN) || null : null;

    // Validate the fund exists and is active
    const fundRows = await db
      .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind, isActive: ledgerFunds.isActive })
      .from(ledgerFunds)
      .where(eq(ledgerFunds.id, fundId))
      .limit(1);
    const fund = fundRows[0];
    if (!fund) {
      return json("Fund not found", 404);
    }
    if (!fund.isActive) {
      return json("The specified fund is not active. Please select an active fund.", 400);
    }

    // categoryId is REQUIRED (B-30, DECISION-061) — a paid reimbursement's
    // transaction must never be born categoryless. Validated identically to the
    // main transaction POST route: exists, fundKind matches, expense-flow.
    const categoryId = body?.categoryId;
    if (!categoryId || typeof categoryId !== "string") {
      return json("categoryId is required", 400);
    }
    const catRows = await db
      .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind, flow: ledgerCategories.flow })
      .from(ledgerCategories)
      .where(eq(ledgerCategories.id, categoryId))
      .limit(1);
    const cat = catRows[0];
    if (!cat) {
      return json("Category not found", 404);
    }
    if (cat.fundKind !== fund.kind) {
      return json("Category does not match fund type", 400);
    }
    if (cat.flow !== "expense") {
      return json("Category flow does not match transaction flow", 400);
    }

    // budgetLineId is OPTIONAL — same server-side link-integrity validation as
    // the main transaction routes (B-30, DECISION-061).
    const rawBudgetLineId = body?.budgetLineId;
    let validatedBudgetLineId: string | null = null;
    if (rawBudgetLineId !== undefined && rawBudgetLineId !== null && rawBudgetLineId !== "") {
      if (typeof rawBudgetLineId !== "string") {
        return json("budgetLineId must be a string", 400);
      }
      const derivedFiscalYear = getFiscalYear(new Date(paymentDate + "T00:00:00"));
      const line = await getBudgetLineForLinkValidation(rawBudgetLineId);
      if (!line) {
        return json("Budget line not found", 404);
      }
      if (
        line.fundId !== fundId ||
        line.fiscalYear !== derivedFiscalYear ||
        line.categoryId !== categoryId ||
        line.flow !== "expense"
      ) {
        return json("This budget line does not match the payment's fund, fiscal year, or category.", 400);
      }
      validatedBudgetLineId = line.id;
    }

    // Atomic DB transaction: insert ledger row + update reimbursement.
    let newTxnId: string | null = null;
    const now = new Date();
    const stamp = reimbursementTransactionStamp(reimb, session.user.id, now);
    const isLegacyApproved = reimb.status === "approved";

    await db.transaction(async (tx) => {
      const [newTxn] = await tx
        .insert(ledgerTransactions)
        .values({
          entityId: fund.entityId,
          fundId,
          txnDate: paymentDate,
          flow: "expense",
          amountCents: reimb.amountCents,
          categoryId,
          party: `${reimb.memberFirstName} ${reimb.memberLastName}`.trim(),
          memo: note ?? reimb.description,
          // Carried over from the reimbursement's own member-supplied
          // beneficiaryCause — not newly collected at pay time (B-30).
          beneficiaryCause: reimb.beneficiaryCause ?? null,
          budgetLineId: validatedBudgetLineId,
          paymentMethod: paymentMethod as string,
          // status 'posted' bypasses disbApprovalThresholdCents — reimbursements
          // carry no board-approval step (DECISION-106). The stamp below IS the
          // lock (see reimbursementTransactionStamp): do not remove or null it.
          status: "posted",
          approvedByUserId: stamp.approvedByUserId,
          approvedAt: stamp.approvedAt,
          boardMinute: stamp.boardMinute,
          recordedByUserId: session.user.id,
        })
        .returning({ id: ledgerTransactions.id });

      newTxnId = newTxn.id;

      // Atomic guard: pins status and every value copied onto the transaction
      // (amount, description, receipt key, cause) to what this handler read, so
      // a member edit between the read and this write cannot post unseen values.
      // No timestamp column appears here (precision trap, see header).
      // Legacy approved rows keep their real reviewer/board history (R-2).
      const updated = await tx
        .update(ledgerReimbursements)
        .set({
          status: "paid",
          paidAt: now,
          ledgerTransactionId: newTxn.id,
          fundId,
          updatedAt: now,
          ...(isLegacyApproved ? {} : { reviewedByUserId: session.user.id, reviewedAt: now }),
        })
        .where(
          and(
            eq(ledgerReimbursements.id, id),
            inArray(ledgerReimbursements.status, [...REIMBURSEMENT_ACTIONABLE_STATUSES]),
            eq(ledgerReimbursements.amountCents, reimb.amountCents),
            eq(ledgerReimbursements.description, reimb.description),
            eq(ledgerReimbursements.receiptStorageKey, reimb.receiptStorageKey),
            reimb.beneficiaryCause === null
              ? isNull(ledgerReimbursements.beneficiaryCause)
              : eq(ledgerReimbursements.beneficiaryCause, reimb.beneficiaryCause),
          ),
        )
        .returning({ id: ledgerReimbursements.id });

      if (updated.length === 0) {
        // Status or values changed between our read and this write: roll back.
        throw new ReimbursementConflictError();
      }
    });

    const amountDollars = (reimb.amountCents / 100).toFixed(2);
    await sendMemberEmail(
      reimb,
      `Your reimbursement request has been paid — $${amountDollars}`,
      `<p>Your reimbursement request for <strong>$${amountDollars}</strong> has been paid.</p>
<p><strong>Description:</strong> ${escapeHtml(reimb.description)}</p>
<p><strong>Payment date:</strong> ${paymentDate}</p>
<p>You can view the full history of your requests at <a href="${appUrl}/members/reimbursements">${appUrl}/members/reimbursements</a>.</p>`,
      "pay",
    );

    return NextResponse.json({ id, ledgerTransactionId: newTxnId });
  } catch (error) {
    if (error instanceof ReimbursementConflictError) {
      // Re-read once to pick the right message.
      try {
        const { id } = await params;
        const fresh = await getReimbursementWithMember(id);
        if (fresh?.status === "paid") {
          return json("This reimbursement has already been marked paid", 409);
        }
        if (fresh?.status === "rejected") {
          return json("This reimbursement was rejected and cannot be paid", 409);
        }
      } catch {
        // fall through to the stale message
      }
      return json(STALE_MESSAGE, 409);
    }
    console.error("Error processing reimbursement action:", error);
    return json("Failed to process reimbursement action", 500);
  }
}
