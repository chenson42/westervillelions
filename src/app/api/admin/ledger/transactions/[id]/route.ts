/**
 * PATCH /api/admin/ledger/transactions/[id]
 *
 * Edit an existing posted transaction.
 * Gate: LEDGER_RECORD
 *
 * For transfer rows (transferGroupId non-null), the client may pass ?both=true
 * to update the paired row symmetrically (amount + date). For memo-only edits,
 * only the requested row is updated regardless.
 *
 * Guard: if txn.approvedAt is set, returns 403 (inc2 immutability). Also 403
 * if txn.reconciledSessionId is set (Bank Reconciliation inc2 — the row was
 * cleared by a closed reconciliation session; reopen it first).
 *
 * Body (all fields optional):
 * {
 *   txnDate?: string;          // YYYY-MM-DD
 *   flow?: 'income' | 'expense';
 *   amountCents?: number;      // positive integer
 *   categoryId?: string | null;
 *   party?: string | null;
 *   memo?: string | null;
 *   paymentMethod?: string | null;
 *   checkNumber?: string | null;  // structured check # (T-18); trimmed, capped at 20 chars
 *   bankAccountId?: string;  // required if present — null/blank 400s (default-bank-account bug fix); omit to leave unchanged.
 *     // DECISION-058: IGNORED (not 400ed) for any row with a non-null transferGroupId —
 *     // per-leg bank account is immutable post-creation for a Transfer/Sweep pair;
 *     // a wrong choice is corrected by delete+recreate.
 *   beneficiaryCause?: string | null;
 *   publicNote?: string | null;  // treasurer-curated, member-facing annotation
 *     // on /members/impact; null clears; non-null trims/caps at 200 chars
 *     // server-side (400 REJECT if over, not truncated), expense-only.
 *   receiptStorageKey?: string | null;  // DECISION-035: null clears (does NOT
 *     // waive — re-flags the row); non-null attaches/replaces (regex-
 *     // validated, expense-only) and CLEARS any existing waiver in the same
 *     // UPDATE (a real receipt supersedes an administrative excuse).
 *   budgetLineId?: string | null;  // explicit budget-line link (B-30,
 *     // DECISION-061); null/empty clears (always valid, no staleness
 *     // check). A value that DIFFERS from the row's current budgetLineId is
 *     // treated as a genuinely new pick — server-validated against the
 *     // effective fund/derived-FY/category (400 on mismatch, 404 on a
 *     // nonexistent/malformed id). If OMITTED, or resent UNCHANGED from the
 *     // row's current value (the real client always includes this key on
 *     // an expense edit, touched or not), but an edited txnDate/categoryId/
 *     // flow has moved the transaction's EXISTING link out of range, the
 *     // server auto-clears it rather than rejecting the edit — see
 *     // budgetLineLinkCleared below.
 * }
 * Response 200: { id: string; budgetLineLinkCleared?: true }  // the latter
 *   only present when an existing budget-line link was auto-cleared by this
 *   edit (B-30, DECISION-061) — the client should toast this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE /api/admin/ledger/transactions/[id]
 *
 * Hard-delete a posted transaction.
 * Gate: LEDGER_RECORD
 *
 * If the row is part of a transfer pair (transferGroupId non-null), BOTH rows
 * are deleted atomically.
 *
 * Guard: if txn.approvedAt is set, returns 403. Also 403 if
 * txn.reconciledSessionId is set (Bank Reconciliation inc2 — reopen the
 * closed session first).
 *
 * Response 200: { deleted: number }  (1 for single row, 2 for transfer pair)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerFunds, ledgerCategories, ledgerDonors } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { RECEIPT_KEY_REGEX, getReceiptStorage } from "@/lib/receipt-storage";
import { getFiscalYear } from "@/lib/fiscal-year";
import { getBudgetLineForLinkValidation } from "@/lib/ledger-queries";
import { shouldClearBudgetLineLink } from "@/lib/ledger";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INT4_MAX = 2_147_483_647;
const VALID_FLOWS = ["income", "expense"] as const;
const VALID_METHODS = ["check", "cash", "zeffy", "debit_card", "bill_pay", "other"] as const;
const CHECK_NUMBER_MAX_LEN = 20;
const PUBLIC_NOTE_MAX_LEN = 200;

function isValidFlow(v: unknown): boolean {
  return typeof v === "string" && (VALID_FLOWS as readonly string[]).includes(v);
}
function isValidMethod(v: unknown): boolean {
  return typeof v === "string" && (VALID_METHODS as readonly string[]).includes(v);
}
function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_REGEX.test(raw)) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return raw;
}

/**
 * Trim and length-cap checkNumber (T-18). Free-text identifier, not
 * strict-numeric. Returns `{ error }` on invalid input, or `{ value }` with
 * empty string normalized to null.
 */
function normalizeCheckNumber(v: unknown): { value: string | null } | { error: string } {
  if (v === null) return { value: null };
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
 * silently truncated. `null` clears; empty-after-trim also normalizes to
 * `null` (matches the memo/beneficiaryCause empty-string-to-null convention
 * in this same handler).
 */
function normalizePublicNote(v: unknown): { value: string | null } | { error: string } {
  if (v === null) return { value: null };
  if (typeof v !== "string") return { error: "publicNote must be a string" };
  const trimmed = v.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > PUBLIC_NOTE_MAX_LEN) {
    return { error: `Keep the public note under ${PUBLIC_NOTE_MAX_LEN} characters.` };
  }
  return { value: trimmed };
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/ledger/transactions/[id]
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
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const updateBoth = searchParams.get("both") === "true";

    // Fetch the target row
    const existing = await db.query.ledgerTransactions.findFirst({
      where: eq(ledgerTransactions.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // inc2 guard: approved transactions are immutable
    if (existing.approvedAt) {
      return NextResponse.json(
        { error: "Approved transactions cannot be edited" },
        { status: 403 },
      );
    }

    // inc2 guard: rejected transactions are immutable (preserves audit trail)
    if (existing.status === "rejected") {
      return NextResponse.json(
        { error: "Rejected transactions cannot be edited" },
        { status: 403 },
      );
    }

    // Bank Reconciliation inc2 guard: a row cleared by a closed reconciliation
    // session is a FULL lock — structurally identical to the approvedAt guard
    // above — consistent with this feature's hard-tie-out-with-no-override
    // decision (silently degrading a closed session's arithmetic via an
    // unflagged edit would contradict that decision's spirit).
    if (existing.reconciledSessionId) {
      return NextResponse.json(
        {
          error:
            "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Build validated update payload
    type UpdatePayload = Partial<{
      txnDate: string;
      flow: string;
      amountCents: number;
      categoryId: string | null;
      party: string | null;
      memo: string | null;
      paymentMethod: string | null;
      checkNumber: string | null;
      bankAccountId: string | null;
      beneficiaryCause: string | null;
      publicNote: string | null;
      receiptStorageKey: string | null;
      receiptWaivedAt: Date | null;
      receiptWaivedByUserId: string | null;
      receiptWaiverReason: string | null;
      donorId: string | null;
      budgetLineId: string | null;
      updatedAt: Date;
    }>;

    const update: UpdatePayload = { updatedAt: new Date() };

    if (body.txnDate !== undefined) {
      const d = parseDate(body.txnDate);
      if (!d) {
        return NextResponse.json(
          { error: "txnDate must be a valid date in YYYY-MM-DD format" },
          { status: 400 },
        );
      }
      update.txnDate = d;
    }

    if (body.flow !== undefined) {
      if (!isValidFlow(body.flow)) {
        return NextResponse.json(
          { error: "flow must be 'income' or 'expense'" },
          { status: 400 },
        );
      }
      update.flow = body.flow;
    }

    if (body.amountCents !== undefined) {
      if (
        typeof body.amountCents !== "number" ||
        !Number.isInteger(body.amountCents) ||
        body.amountCents <= 0
      ) {
        return NextResponse.json(
          { error: "amountCents must be a positive integer" },
          { status: 400 },
        );
      }
      if (body.amountCents > INT4_MAX) {
        return NextResponse.json(
          { error: `amountCents must not exceed ${INT4_MAX}` },
          { status: 400 },
        );
      }
      update.amountCents = body.amountCents;
    }

    // Validate category if being changed
    const newFlow = (update.flow ?? existing.flow) as string;
    if (body.categoryId !== undefined) {
      if (body.categoryId === null) {
        update.categoryId = null;
      } else {
        const fundRows = await db
          .select({ kind: ledgerFunds.kind })
          .from(ledgerFunds)
          .where(eq(ledgerFunds.id, existing.fundId))
          .limit(1);
        const fund = fundRows[0];
        if (!fund) {
          return NextResponse.json({ error: "Associated fund not found" }, { status: 500 });
        }

        const catRows = await db
          .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind, flow: ledgerCategories.flow })
          .from(ledgerCategories)
          .where(eq(ledgerCategories.id, body.categoryId))
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
        if (cat.flow !== newFlow) {
          return NextResponse.json(
            { error: "Category flow does not match transaction flow" },
            { status: 400 },
          );
        }
        update.categoryId = body.categoryId;
      }
    }

    // party: required for income if being set
    if (body.party !== undefined) {
      if (body.party === null || (typeof body.party === "string" && !body.party.trim())) {
        if (newFlow === "income") {
          return NextResponse.json(
            { error: "party is required for income transactions" },
            { status: 400 },
          );
        }
        update.party = null;
      } else {
        update.party = typeof body.party === "string" ? body.party.trim() : null;
      }
    }

    if (body.memo !== undefined) {
      update.memo =
        body.memo === null ? null : typeof body.memo === "string" ? body.memo.trim() || null : null;
    }

    if (body.paymentMethod !== undefined) {
      if (body.paymentMethod !== null && !isValidMethod(body.paymentMethod)) {
        return NextResponse.json(
          { error: "paymentMethod must be one of: check, cash, zeffy, debit_card, bill_pay, other" },
          { status: 400 },
        );
      }
      update.paymentMethod = body.paymentMethod ?? null;
    }

    if (body.checkNumber !== undefined) {
      const checkNumberResult = normalizeCheckNumber(body.checkNumber);
      if ("error" in checkNumberResult) {
        return NextResponse.json({ error: checkNumberResult.error }, { status: 400 });
      }
      update.checkNumber = checkNumberResult.value;
    }

    // Bank account is required — every transaction must carry a bank account
    // by construction (default-bank-account bug fix). Unlike most optional
    // PATCH fields, an explicit null/blank here is REJECTED, not cleared —
    // clearing it would silently reintroduce the reconciliation-invisibility
    // bug this fix exists to close. Omitting the field entirely (not present
    // in the body) still leaves the existing value untouched, as before.
    //
    // DECISION-058: per-leg bank account is IMMUTABLE post-creation for any
    // Transfer/Sweep pair (transferGroupId set) — a wrong choice is corrected
    // by delete+recreate, not edit. A bankAccountId in the body is silently
    // ignored for a pair leg (rather than 400ing) so the rest of an
    // otherwise-valid edit (amount/date/memo) can still go through.
    if (body.bankAccountId !== undefined && !existing.transferGroupId) {
      if (!body.bankAccountId || typeof body.bankAccountId !== "string") {
        return NextResponse.json(
          { error: "Select a bank account before saving this transaction." },
          { status: 400 },
        );
      }
      update.bankAccountId = body.bankAccountId;
    }
    if (body.beneficiaryCause !== undefined) {
      update.beneficiaryCause =
        body.beneficiaryCause === null
          ? null
          : typeof body.beneficiaryCause === "string"
            ? body.beneficiaryCause.trim() || null
            : null;
    }
    // publicNote (Impact Gift Public Note): trim/cap-reject, then expense-only
    // guard against the *effective* flow (existing flow, or the new flow value
    // if changing it in the same request — reuses `newFlow` above, the same
    // pattern already used for category/receipt validation in this handler).
    if (body.publicNote !== undefined) {
      const publicNoteResult = normalizePublicNote(body.publicNote);
      if ("error" in publicNoteResult) {
        return NextResponse.json({ error: publicNoteResult.error }, { status: 400 });
      }
      if (publicNoteResult.value && newFlow !== "expense") {
        return NextResponse.json(
          { error: "Public notes can only be attached to expense transactions" },
          { status: 400 },
        );
      }
      update.publicNote = publicNoteResult.value;
    }
    // receiptStorageKey (DECISION-035): null → remove (Flow D — does NOT touch
    // waiver fields, a removed receipt should re-flag the row). Non-null →
    // attach/replace (Flow B/C) — regex-validated, expense-only, and clears
    // any existing waiver in the same UPDATE (a real receipt supersedes an
    // administrative excuse; no dual state).
    if (body.receiptStorageKey !== undefined) {
      if (body.receiptStorageKey === null) {
        update.receiptStorageKey = null;
      } else {
        if (
          typeof body.receiptStorageKey !== "string" ||
          !RECEIPT_KEY_REGEX.test(body.receiptStorageKey)
        ) {
          return NextResponse.json(
            { error: "receiptStorageKey format is invalid" },
            { status: 400 },
          );
        }
        if (newFlow !== "expense") {
          return NextResponse.json(
            { error: "Receipts can only be attached to expense transactions" },
            { status: 400 },
          );
        }
        update.receiptStorageKey = body.receiptStorageKey;
        update.receiptWaivedAt = null;
        update.receiptWaivedByUserId = null;
        update.receiptWaiverReason = null;
      }
    }
    // DECISION-040 defect fix (a): capture the previous receipt key so its bytes
    // can be deleted after a successful remove/replace. Only fires when
    // receiptStorageKey is actually changing to a *different* value than what's
    // already stored — an idempotent resubmit of the same key must not delete
    // the very bytes it's pointing at.
    const oldReceiptKeyToDelete =
      body.receiptStorageKey !== undefined &&
      existing.receiptStorageKey &&
      existing.receiptStorageKey !== update.receiptStorageKey
        ? existing.receiptStorageKey
        : null;
    // Link/unlink a donor (inc6a). Validate the donor exists before linking so
    // the LinkDonorDialog can't silently no-op against a bad id.
    if (body.donorId !== undefined) {
      if (body.donorId === null) {
        update.donorId = null;
      } else if (typeof body.donorId === "string") {
        const donorRows = await db
          .select({ id: ledgerDonors.id })
          .from(ledgerDonors)
          .where(eq(ledgerDonors.id, body.donorId))
          .limit(1);
        if (donorRows.length === 0) {
          return NextResponse.json({ error: "Donor not found" }, { status: 400 });
        }
        update.donorId = body.donorId;
      } else {
        return NextResponse.json({ error: "donorId must be a string or null" }, { status: 400 });
      }
    }

    // Explicit budget-line link (B-30, DECISION-061). Two cases, keyed on
    // whether the payload represents a genuinely NEW pick — NOT merely on
    // whether the `budgetLineId` key is present. Phase 5 QA finding: the
    // real client (transaction-form.tsx) always includes `budgetLineId` in
    // an expense edit's payload, touched or not (`budgetLineId: budgetLineId
    // || null`), so "key present" alone can't distinguish "the treasurer
    // just picked/changed the line" from "the picker was never touched and
    // its current value is simply being resent unchanged." Keying on
    // presence-of-key made case 2 (auto-clear) unreachable from the real UI
    // and made a stale-but-unchanged link 400-reject the whole edit.
    //  1. The submitted budgetLineId genuinely DIFFERS from
    //     existing.budgetLineId (a new pick, a change to a different line) —
    //     validate the NEW value against the EFFECTIVE fund (immutable —
    //     fund is never editable via this route), FY (derived from
    //     update.txnDate ?? existing.txnDate), and category
    //     (update.categoryId if being changed, else existing.categoryId).
    //     Mismatch -> 400 (Phase 1 adversarial pass: a direct PATCH must not
    //     bypass the picker's client-side filtering).
    //  2. The submitted budgetLineId is null/empty (explicit clear — always
    //     valid, no staleness check needed), OR it's UNCHANGED from
    //     existing.budgetLineId (including the common real-UI case where the
    //     client resent the same value because the picker itself was never
    //     touched), OR the key was omitted entirely — in the latter two
    //     sub-cases, an edited txnDate/categoryId (or a flow change away
    //     from 'expense') may have moved the transaction's EXISTING link out
    //     of range. Auto-clear rather than reject (silently-stale would be
    //     worse; a hard reject would block an otherwise-valid date/category
    //     correction just because an old link no longer applies —
    //     DECISION-061 #3). Response flags budgetLineLinkCleared: true so
    //     the client can toast it.
    let budgetLineLinkCleared = false;
    const effectiveTxnDate = update.txnDate ?? existing.txnDate;
    const effectiveFiscalYear = getFiscalYear(new Date(effectiveTxnDate + "T00:00:00"));
    const effectiveCategoryId =
      "categoryId" in update ? (update.categoryId ?? null) : (existing.categoryId ?? null);

    const isNewBudgetLinePick =
      body.budgetLineId !== undefined &&
      body.budgetLineId !== null &&
      body.budgetLineId !== "" &&
      body.budgetLineId !== existing.budgetLineId;

    if (isNewBudgetLinePick) {
      if (typeof body.budgetLineId !== "string") {
        return NextResponse.json({ error: "budgetLineId must be a string" }, { status: 400 });
      }
      const line = await getBudgetLineForLinkValidation(body.budgetLineId);
      if (!line) {
        return NextResponse.json({ error: "Budget line not found" }, { status: 404 });
      }
      if (
        line.fundId !== existing.fundId ||
        line.fiscalYear !== effectiveFiscalYear ||
        line.categoryId !== effectiveCategoryId ||
        line.flow !== "expense" ||
        newFlow !== "expense"
      ) {
        return NextResponse.json(
          {
            error:
              "This budget line does not match the transaction's fund, fiscal year, or category.",
          },
          { status: 400 },
        );
      }
      update.budgetLineId = line.id;
    } else if (body.budgetLineId === null || body.budgetLineId === "") {
      // Explicit clear — always valid, no staleness check needed.
      update.budgetLineId = null;
    } else if (existing.budgetLineId) {
      // Key omitted entirely, or the client resent the row's CURRENT
      // budgetLineId unchanged — either way, the link itself wasn't touched
      // by this edit. Check whether it's now stale relative to the
      // effective FY/category and auto-clear if so.
      if (newFlow !== "expense") {
        update.budgetLineId = null;
        budgetLineLinkCleared = true;
      } else {
        const linkedLine = await getBudgetLineForLinkValidation(existing.budgetLineId);
        if (
          !linkedLine ||
          shouldClearBudgetLineLink(linkedLine, effectiveFiscalYear, effectiveCategoryId)
        ) {
          update.budgetLineId = null;
          budgetLineLinkCleared = true;
        }
      }
    }

    // For transfer pairs with ?both=true, update both rows symmetrically
    // (amount and date changes are symmetric; category/party/flow changes only apply to requested row)
    if (updateBoth && existing.transferGroupId) {
      // Find the partner row
      const partnerRows = await db
        .select({
          id: ledgerTransactions.id,
          approvedAt: ledgerTransactions.approvedAt,
          reconciledSessionId: ledgerTransactions.reconciledSessionId,
        })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.transferGroupId, existing.transferGroupId),
          ),
        );

      const partner = partnerRows.find((r) => r.id !== id);
      const partnerId = partner?.id;

      if (partner?.approvedAt) {
        return NextResponse.json(
          { error: "The paired transfer transaction is approved and cannot be edited" },
          { status: 403 },
        );
      }
      if (partner?.reconciledSessionId) {
        return NextResponse.json(
          {
            error:
              "The paired transfer transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
          },
          { status: 403 },
        );
      }

      // For symmetric transfer updates, only apply amount and date — not
      // flow/category/party. bankAccountId is deliberately NOT propagated
      // (DECISION-058 bug fix) — per-leg bank account is immutable
      // post-creation for a pair, and `update.bankAccountId` can never be
      // set here anyway now that the guard above skips it for any row with
      // a transferGroupId.
      const symmetricUpdate: UpdatePayload = { updatedAt: new Date() };
      if (update.amountCents !== undefined) symmetricUpdate.amountCents = update.amountCents;
      if (update.txnDate !== undefined) symmetricUpdate.txnDate = update.txnDate;
      if (update.memo !== undefined) symmetricUpdate.memo = update.memo;

      await db.transaction(async (tx) => {
        await tx
          .update(ledgerTransactions)
          .set(update)
          .where(eq(ledgerTransactions.id, id));

        if (partnerId) {
          await tx
            .update(ledgerTransactions)
            .set(symmetricUpdate)
            .where(eq(ledgerTransactions.id, partnerId));
        }
      });
    } else {
      await db
        .update(ledgerTransactions)
        .set(update)
        .where(eq(ledgerTransactions.id, id));
    }

    // Best-effort cleanup, deliberately AFTER the DB write succeeds — the DB row
    // is the source of truth for which key is "live"; only delete bytes once
    // nothing references them anymore. (Differs from the acknowledgment-letter
    // route's delete-BEFORE-save: that route is uploading new bytes in the same
    // request, so it must free the old key before writing the new one; this
    // route only ever receives an already-uploaded key, so there's no ordering
    // hazard — deleting after is strictly safer here.) Non-fatal: an orphan is
    // a recoverable data-hygiene issue, not worth failing the edit over.
    if (oldReceiptKeyToDelete) {
      try {
        await getReceiptStorage().delete(oldReceiptKeyToDelete);
      } catch (err) {
        console.error(
          "[transaction-receipt] Failed to delete old receipt key:",
          oldReceiptKeyToDelete,
          err,
        );
      }
    }

    return NextResponse.json(
      budgetLineLinkCleared ? { id, budgetLineLinkCleared: true } : { id },
    );
  } catch (error) {
    console.error("Error updating ledger transaction:", error);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/ledger/transactions/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Fetch the target row
    const existing = await db.query.ledgerTransactions.findFirst({
      where: eq(ledgerTransactions.id, id),
      columns: {
        id: true,
        approvedAt: true,
        transferGroupId: true,
        status: true,
        reconciledSessionId: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // inc2 guard: approved transactions are immutable
    if (existing.approvedAt) {
      return NextResponse.json(
        { error: "Approved transactions cannot be deleted" },
        { status: 403 },
      );
    }

    // inc2 guard: rejected transactions are immutable (preserves audit trail)
    if (existing.status === "rejected") {
      return NextResponse.json(
        { error: "Rejected transactions cannot be deleted" },
        { status: 403 },
      );
    }

    // Bank Reconciliation inc2 guard: a row cleared by a closed reconciliation
    // session is a FULL lock — see the matching guard in PATCH above.
    if (existing.reconciledSessionId) {
      return NextResponse.json(
        {
          error:
            "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
        },
        { status: 403 },
      );
    }

    // If part of a transfer pair, delete both rows atomically
    if (existing.transferGroupId) {
      // Find all rows in the transfer group
      const pairRows = await db
        .select({
          id: ledgerTransactions.id,
          approvedAt: ledgerTransactions.approvedAt,
          reconciledSessionId: ledgerTransactions.reconciledSessionId,
        })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.transferGroupId, existing.transferGroupId));

      // If any row in the pair is approved, reject the delete
      if (pairRows.some((r) => r.approvedAt)) {
        return NextResponse.json(
          { error: "Cannot delete a transfer where one or both rows are approved" },
          { status: 403 },
        );
      }
      // If any row in the pair was cleared by a closed reconciliation session,
      // reject the delete — same full-lock rule as the single-row guard above.
      if (pairRows.some((r) => r.reconciledSessionId)) {
        return NextResponse.json(
          {
            error:
              "Cannot delete a transfer where one or both rows were cleared by a closed reconciliation session — reopen it first",
          },
          { status: 403 },
        );
      }

      await db.transaction(async (tx) => {
        for (const row of pairRows) {
          await tx.delete(ledgerTransactions).where(eq(ledgerTransactions.id, row.id));
        }
      });

      return NextResponse.json({ deleted: pairRows.length });
    }

    // Single row — hard delete
    await db.delete(ledgerTransactions).where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ deleted: 1 });
  } catch (error) {
    console.error("Error deleting ledger transaction:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
