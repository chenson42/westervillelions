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
 * State-transition actions on a reimbursement. Three mutually exclusive actions:
 *
 * approve:
 *   Gate: LEDGER_APPROVE. Body: { action: 'approve', boardMinute: string }.
 *   Requires status='submitted'. Blocks self-approval (session.user.memberId === submittedByMemberId).
 *   Sets status='approved', reviewedByUserId, reviewedAt, boardMinute.
 *   Sends E-3 email to the submitting member.
 *
 * reject:
 *   Gate: LEDGER_APPROVE. Body: { action: 'reject', reason: string }.
 *   Requires status='submitted'. Blocks self-approval.
 *   Sets status='rejected', reviewedByUserId, reviewedAt, rejectionReason.
 *   Sends E-3 email to the submitting member with the rejection reason.
 *
 * pay:
 *   Gate: LEDGER_RECORD. Body: { action: 'pay', fundId: string, categoryId: string,
 *     paymentDate: string, paymentMethod: string, note?: string, budgetLineId?: string }.
 *   Requires status='approved'.
 *   categoryId is REQUIRED (B-30, DECISION-061) — the pay action used to create a
 *     categoryless, cause-less transaction, permanently invisible to every
 *     budget-vs-actual view; a category is now a mandatory fourth field alongside
 *     fund/date/method, validated the same way the main transaction POST route
 *     validates categoryId (exists, fundKind matches, flow='expense').
 *   budgetLineId is OPTIONAL — server-validated (fund/derived-FY/category must
 *     match the line's budget row) exactly like the main transaction routes; 400
 *     on mismatch, 404 on a nonexistent/malformed id.
 *   In a DB transaction:
 *     1. Inserts a ledger_transactions row (flow='expense', status='posted', bypasses
 *        disbApprovalThresholdCents — board already approved). categoryId is set;
 *        beneficiaryCause is carried over from the reimbursement's own (member-
 *        supplied, optional) beneficiaryCause — not newly collected here.
 *     2. Updates the reimbursement to status='paid', paidAt, ledgerTransactionId, fundId.
 *   Double-pay guard: checks status='approved' atomically using .returning().
 *   Sends E-4 email to the submitting member.
 *
 * Responses:
 *   200 { id }   — success
 *   400          — validation error
 *   401          — not authenticated
 *   403          — forbidden / self-approval
 *   404          — not found
 *   409          — race condition (already reviewed / paid)
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
import { eq, and } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReimbursementWithMember,
  getUserEmail,
  getBudgetLineForLinkValidation,
} from "@/lib/ledger-queries";
import { sendEmail } from "@/lib/email";
import { getFiscalYear } from "@/lib/fiscal-year";

const BOARD_MINUTE_MAX_LEN = 500;
const REASON_MAX_LEN = 1000;
const NOTE_MAX_LEN = 1000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PAYMENT_METHODS = ["check", "cash", "other"] as const;

function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_REGEX.test(raw)) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return raw;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const action: unknown = body?.action;

    if (action !== "approve" && action !== "reject" && action !== "pay") {
      return NextResponse.json(
        { error: "action must be one of: approve, reject, pay" },
        { status: 400 },
      );
    }

    // Fetch the reimbursement with member info
    const reimb = await getReimbursementWithMember(id);
    if (!reimb) {
      return NextResponse.json({ error: "Reimbursement not found" }, { status: 404 });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
    const appUrl = process.env.NEXTAUTH_URL ?? "";

    // ── approve ──────────────────────────────────────────────────────────────
    if (action === "approve") {
      if (!(await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (reimb.status !== "submitted") {
        return NextResponse.json(
          { error: "Reimbursement is no longer in submitted status" },
          { status: 409 },
        );
      }
      // Self-approval block
      if (
        session.user.memberId &&
        reimb.submittedByMemberId &&
        session.user.memberId === reimb.submittedByMemberId
      ) {
        return NextResponse.json(
          { error: "You cannot approve your own reimbursement request" },
          { status: 403 },
        );
      }
      const rawBoardMinute = body?.boardMinute;
      if (!rawBoardMinute || typeof rawBoardMinute !== "string" || !rawBoardMinute.trim()) {
        return NextResponse.json({ error: "boardMinute is required" }, { status: 400 });
      }
      const boardMinute = rawBoardMinute.trim().slice(0, BOARD_MINUTE_MAX_LEN);

      await db
        .update(ledgerReimbursements)
        .set({
          status: "approved",
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          boardMinute,
          updatedAt: new Date(),
        })
        .where(eq(ledgerReimbursements.id, id));

      // E-3: Notify the submitting member
      try {
        const memberEmail = await getUserEmail(reimb.submittedByUserId);
        if (memberEmail) {
          const amountDollars = (reimb.amountCents / 100).toFixed(2);
          await sendEmail({
            to: memberEmail,
            from: fromEmail,
            subject: "Your reimbursement request has been approved",
            html: `<p>Your reimbursement request for <strong>$${amountDollars}</strong> has been approved.</p>
<p><strong>Description:</strong> ${reimb.description}</p>
<p>The treasurer will process payment shortly. You can track the status of your request at <a href="${appUrl}/members/reimbursements">${appUrl}/members/reimbursements</a>.</p>`,
          });
        }
      } catch {
        // Best-effort email — do not fail the request
      }

      return NextResponse.json({ id });
    }

    // ── reject ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      if (!(await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (reimb.status !== "submitted") {
        return NextResponse.json(
          { error: "Reimbursement is no longer in submitted status" },
          { status: 409 },
        );
      }
      // Self-rejection block
      if (
        session.user.memberId &&
        reimb.submittedByMemberId &&
        session.user.memberId === reimb.submittedByMemberId
      ) {
        return NextResponse.json(
          { error: "You cannot reject your own reimbursement request" },
          { status: 403 },
        );
      }
      const rawReason = body?.reason;
      if (!rawReason || typeof rawReason !== "string" || !rawReason.trim()) {
        return NextResponse.json({ error: "reason is required" }, { status: 400 });
      }
      const rejectionReason = rawReason.trim().slice(0, REASON_MAX_LEN);

      await db
        .update(ledgerReimbursements)
        .set({
          status: "rejected",
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(ledgerReimbursements.id, id));

      // E-3: Notify the submitting member
      try {
        const memberEmail = await getUserEmail(reimb.submittedByUserId);
        if (memberEmail) {
          const amountDollars = (reimb.amountCents / 100).toFixed(2);
          await sendEmail({
            to: memberEmail,
            from: fromEmail,
            subject: "Your reimbursement request has been rejected",
            html: `<p>Your reimbursement request for <strong>$${amountDollars}</strong> has been rejected.</p>
<p><strong>Description:</strong> ${reimb.description}</p>
<p><strong>Reason for rejection:</strong> ${rejectionReason}</p>
<p>If you have questions, please contact the treasurer. You may submit a new request at <a href="${appUrl}/members/reimbursements">${appUrl}/members/reimbursements</a>.</p>`,
          });
        }
      } catch {
        // Best-effort email
      }

      return NextResponse.json({ id });
    }

    // ── pay ──────────────────────────────────────────────────────────────────
    if (action === "pay") {
      if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (reimb.status !== "approved") {
        return NextResponse.json(
          { error: "Reimbursement must be approved before it can be paid" },
          { status: 409 },
        );
      }

      // Validate required fields
      const fundId = body?.fundId;
      if (!fundId || typeof fundId !== "string") {
        return NextResponse.json({ error: "fundId is required" }, { status: 400 });
      }
      const rawPaymentDate = body?.paymentDate;
      const paymentDate = parseDate(rawPaymentDate);
      if (!paymentDate) {
        return NextResponse.json(
          { error: "paymentDate must be a valid date in YYYY-MM-DD format" },
          { status: 400 },
        );
      }
      const paymentMethod = body?.paymentMethod;
      if (
        !paymentMethod ||
        !VALID_PAYMENT_METHODS.includes(paymentMethod as (typeof VALID_PAYMENT_METHODS)[number])
      ) {
        return NextResponse.json(
          { error: `paymentMethod must be one of: ${VALID_PAYMENT_METHODS.join(", ")}` },
          { status: 400 },
        );
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
        return NextResponse.json({ error: "Fund not found" }, { status: 404 });
      }
      if (!fund.isActive) {
        return NextResponse.json(
          { error: "The specified fund is not active. Please select an active fund." },
          { status: 400 },
        );
      }

      // categoryId is REQUIRED (B-30, DECISION-061) — closes the permanent
      // blind spot where a paid reimbursement's transaction was born with no
      // category and no way to link a budget line. Validated identically to
      // the main transaction POST route: exists, fundKind matches, expense-flow.
      const categoryId = body?.categoryId;
      if (!categoryId || typeof categoryId !== "string") {
        return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
      }
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
        return NextResponse.json({ error: "Category does not match fund type" }, { status: 400 });
      }
      if (cat.flow !== "expense") {
        return NextResponse.json(
          { error: "Category flow does not match transaction flow" },
          { status: 400 },
        );
      }

      // budgetLineId is OPTIONAL — same server-side link-integrity validation
      // as the main transaction routes (B-30, DECISION-061).
      const rawBudgetLineId = body?.budgetLineId;
      let validatedBudgetLineId: string | null = null;
      if (rawBudgetLineId !== undefined && rawBudgetLineId !== null && rawBudgetLineId !== "") {
        if (typeof rawBudgetLineId !== "string") {
          return NextResponse.json({ error: "budgetLineId must be a string" }, { status: 400 });
        }
        const derivedFiscalYear = getFiscalYear(new Date(paymentDate + "T00:00:00"));
        const line = await getBudgetLineForLinkValidation(rawBudgetLineId);
        if (!line) {
          return NextResponse.json({ error: "Budget line not found" }, { status: 404 });
        }
        if (
          line.fundId !== fundId ||
          line.fiscalYear !== derivedFiscalYear ||
          line.categoryId !== categoryId ||
          line.flow !== "expense"
        ) {
          return NextResponse.json(
            {
              error:
                "This budget line does not match the payment's fund, fiscal year, or category.",
            },
            { status: 400 },
          );
        }
        validatedBudgetLineId = line.id;
      }

      // Atomic DB transaction: insert ledger row + update reimbursement
      // Double-pay guard: update WHERE status='approved' and check rowsAffected
      let newTxnId: string | null = null;

      await db.transaction(async (tx) => {
        // Insert the expense transaction (bypasses threshold — board already approved)
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
            // beneficiaryCause — not newly collected at pay time (B-30,
            // DECISION-061).
            beneficiaryCause: reimb.beneficiaryCause ?? null,
            budgetLineId: validatedBudgetLineId,
            paymentMethod: paymentMethod as string,
            status: "posted", // always posted — board already approved the reimbursement
            approvedByUserId: reimb.reviewedByUserId ?? null,
            approvedAt: reimb.reviewedAt ?? null,
            boardMinute: reimb.boardMinute ?? null,
            recordedByUserId: session.user.id,
          })
          .returning({ id: ledgerTransactions.id });

        newTxnId = newTxn.id;

        // Update reimbursement — double-pay guard: WHERE status='approved'
        const updated = await tx
          .update(ledgerReimbursements)
          .set({
            status: "paid",
            paidAt: new Date(),
            ledgerTransactionId: newTxn.id,
            fundId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ledgerReimbursements.id, id),
              eq(ledgerReimbursements.status, "approved"), // atomic double-pay guard
            ),
          )
          .returning({ id: ledgerReimbursements.id });

        if (updated.length === 0) {
          // Status changed between our check and this update — rollback
          throw new Error("DOUBLE_PAY");
        }
      });

      // E-4: Notify the submitting member
      try {
        const memberEmail = await getUserEmail(reimb.submittedByUserId);
        if (memberEmail) {
          const amountDollars = (reimb.amountCents / 100).toFixed(2);
          await sendEmail({
            to: memberEmail,
            from: fromEmail,
            subject: `Your reimbursement request has been paid — $${amountDollars}`,
            html: `<p>Your reimbursement request for <strong>$${amountDollars}</strong> has been paid.</p>
<p><strong>Description:</strong> ${reimb.description}</p>
<p><strong>Payment date:</strong> ${paymentDate}</p>
<p>You can view the full history of your requests at <a href="${appUrl}/members/reimbursements">${appUrl}/members/reimbursements</a>.</p>`,
          });
        }
      } catch {
        // Best-effort email — payment already processed
      }

      return NextResponse.json({ id, ledgerTransactionId: newTxnId });
    }

    // Should never reach here (action is validated above)
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "DOUBLE_PAY") {
      return NextResponse.json(
        { error: "This reimbursement has already been marked paid" },
        { status: 409 },
      );
    }
    console.error("Error processing reimbursement action:", error);
    return NextResponse.json({ error: "Failed to process reimbursement action" }, { status: 500 });
  }
}
