/**
 * GET /api/members/reimbursements
 *
 * Returns the signed-in member's own reimbursement list, ordered newest first.
 * Ownership enforced: only rows where submittedByMemberId = session.user.memberId.
 *
 * Gate: session.user.memberId (not null)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POST /api/members/reimbursements
 *
 * Submits a new reimbursement request. The member does NOT supply a fundId —
 * the treasurer assigns the fund at pay time (DECISION-018 / R-3).
 *
 * Gate: session.user.memberId (not null)
 *
 * Notification (DECISION-106): the Board-position Treasurer is emailed when
 * they hold ledger.record; otherwise (resolver miss, treasurer is the
 * submitter, treasurer lacks ledger.record) every ledger.record holder except
 * the submitter. Tolerant, never fails the 201. Not a durable-claim path.
 *
 * Body:
 * {
 *   amountCents: number;        // > 0 and <= 1_000_000 ($10,000 ceiling)
 *   description: string;        // required, max 1000 chars
 *   receiptStorageKey: string;  // opaque key from upload route, pattern receipts/<uuid>/<name>
 *   beneficiaryCause?: string;  // optional, max 200 chars
 * }
 *
 * Response 201: { id }
 * Response 409: duplicate submission detected (same member, same amount+description within 60s)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerReimbursements } from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import {
  listReimbursementsForMember,
  getEmailsForFeature,
  getReimbursementWithMember,
} from "@/lib/ledger-queries";
import { pickReimbursementNotifyRecipients } from "@/lib/ledger";
import { resolveTreasurer } from "@/lib/board-positions";
import { sendBulkMemberEmail } from "@/lib/email";
import { escapeHtml, getFromEmail, getAppUrl } from "@/lib/email-compose";
import { FEATURES } from "@/lib/permissions";
import { RECEIPT_KEY_REGEX } from "@/lib/receipt-storage";

const AMOUNT_MAX = 1_000_000; // $10,000 ceiling for a single reimbursement
const DESC_MAX_LEN = 1000;
const CAUSE_MAX_LEN = 200;

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json(
        { error: "Member account required" },
        { status: 403 },
      );
    }

    const reimbursements = await listReimbursementsForMember(session.user.memberId);

    // Strip receiptStorageKey — never returned to the browser
    const safe = reimbursements.map(({ receiptStorageKey: _k, ...rest }) => rest);

    return NextResponse.json({ reimbursements: safe });
  } catch (error) {
    console.error("Error listing member reimbursements:", error);
    return NextResponse.json({ error: "Failed to list reimbursements" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json(
        { error: "Member account required" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Validate amountCents
    const { amountCents } = body;
    if (amountCents === undefined || amountCents === null) {
      return NextResponse.json({ error: "amountCents is required" }, { status: 400 });
    }
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) {
      return NextResponse.json({ error: "amountCents must be an integer" }, { status: 400 });
    }
    if (amountCents <= 0) {
      return NextResponse.json({ error: "amountCents must be greater than 0" }, { status: 400 });
    }
    if (amountCents > AMOUNT_MAX) {
      return NextResponse.json(
        { error: `amountCents must not exceed ${AMOUNT_MAX} ($10,000)` },
        { status: 400 },
      );
    }

    // Validate description
    const rawDescription = body.description;
    if (!rawDescription || typeof rawDescription !== "string" || !rawDescription.trim()) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    const description = rawDescription.trim().slice(0, DESC_MAX_LEN);

    // Validate receiptStorageKey — format check (opaque key, not a URL)
    const rawKey = body.receiptStorageKey;
    if (!rawKey || typeof rawKey !== "string") {
      return NextResponse.json({ error: "receiptStorageKey is required" }, { status: 400 });
    }
    if (!RECEIPT_KEY_REGEX.test(rawKey)) {
      return NextResponse.json(
        { error: "receiptStorageKey format is invalid" },
        { status: 400 },
      );
    }

    // Optional beneficiaryCause
    const rawCause = body.beneficiaryCause;
    const beneficiaryCause =
      rawCause && typeof rawCause === "string" ? rawCause.trim().slice(0, CAUSE_MAX_LEN) || null : null;

    // Duplicate submission guard: same member, same amount+description within 60s
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const dupes = await db
      .select({ id: ledgerReimbursements.id })
      .from(ledgerReimbursements)
      .where(
        and(
          eq(ledgerReimbursements.submittedByMemberId, session.user.memberId),
          eq(ledgerReimbursements.amountCents, amountCents),
          eq(ledgerReimbursements.description, description),
          eq(ledgerReimbursements.status, "submitted"),
          gte(ledgerReimbursements.submittedAt, sixtySecondsAgo),
        ),
      )
      .limit(1);

    if (dupes.length > 0) {
      return NextResponse.json(
        { error: "Duplicate submission detected. Please wait before resubmitting." },
        { status: 409 },
      );
    }

    // Insert
    const [newReimb] = await db
      .insert(ledgerReimbursements)
      .values({
        submittedByMemberId: session.user.memberId,
        submittedByUserId: session.user.id,
        amountCents,
        description,
        beneficiaryCause,
        receiptStorageKey: rawKey,
        status: "submitted",
      })
      .returning({ id: ledgerReimbursements.id });

    // E-2: Notify the treasurer (fallback: other ledger.record holders) that a
    // request is waiting (DECISION-106). Isolated from the DB write: nothing in
    // here may fail the 201. Not a durable-claim path (no sentAt / unique
    // success row), so sendBulkMemberEmail() is correct. No addresses in logs;
    // they are visible at /admin/email-queue.
    try {
      const row = await getReimbursementWithMember(newReimb.id);
      const [treasurer, recordHolderEmails] = await Promise.all([
        resolveTreasurer(),
        getEmailsForFeature(FEATURES.LEDGER_RECORD),
      ]);
      const pick = pickReimbursementNotifyRecipients({
        treasurer,
        recordHolderEmails,
        submitterEmail: session.user.email ?? "",
        submitterMemberId: session.user.memberId,
      });

      if (pick.reason !== "treasurer") {
        console.warn("[Reimbursement notify] fallback recipients", {
          reimbursementId: newReimb.id,
          reason: pick.reason,
        });
      }

      if (pick.recipients.length === 0) {
        console.error("[Reimbursement notify] no recipients", {
          reimbursementId: newReimb.id,
          reason: pick.reason,
        });
      } else {
        const fromEmail = getFromEmail();
        const amountDollars = (amountCents / 100).toFixed(2);
        const appUrl = getAppUrl();
        const submitterName = row
          ? `${row.memberFirstName} ${row.memberLastName}`.trim()
          : "A member";

        // escapeHtml() on every member-supplied field (submitter name,
        // description, cause) — an omitted escaper copy once sent member text
        // unescaped into a board-wide email (CLAUDE.md, Duplication Is a Review
        // Finding). amountDollars and appUrl are codebase-derived (toFixed(2)
        // and an env var), so they are deliberately NOT escaped: escaping would
        // double-encode legitimate punctuation, per html-escape.ts's own note.
        const reimbursementHtml = `<p>${escapeHtml(submitterName)} has submitted a reimbursement request that is waiting for your review.</p>
<ul>
  <li><strong>Submitted by:</strong> ${escapeHtml(submitterName)}</li>
  <li><strong>Amount:</strong> $${amountDollars}</li>
  <li><strong>Description:</strong> ${escapeHtml(description)}</li>
  ${beneficiaryCause ? `<li><strong>Cause:</strong> ${escapeHtml(beneficiaryCause)}</li>` : ""}
</ul>
<p>Review the request, then mark it paid or reject it, at <a href="${appUrl}/admin/ledger/reimbursements">${appUrl}/admin/ledger/reimbursements</a>.</p>`;

        // sendBulkMemberEmail() for one or many recipients: one code path, one
        // email per recipient, never a hand-rolled loop.
        const { results } = await sendBulkMemberEmail({
          from: fromEmail,
          subject: `New reimbursement request — $${amountDollars}`,
          recipients: pick.recipients.map((email) => ({ to: email, html: reimbursementHtml })),
        });
        // sendBulkMemberEmail() does not throw on provider failure: it returns
        // results[] with success:false. Blocked non-production sends return
        // success:true and are correctly not warnings.
        const failed = results.filter((r) => !r.success).length;
        if (failed > 0) {
          console.warn("[Reimbursement notify] send failed", {
            reimbursementId: newReimb.id,
            reason: pick.reason,
            failed,
            total: results.length,
          });
        }
      }
    } catch (e) {
      console.warn("[Reimbursement notify] threw", {
        reimbursementId: newReimb.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    return NextResponse.json({ id: newReimb.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating reimbursement:", error);
    return NextResponse.json({ error: "Failed to submit reimbursement" }, { status: 500 });
  }
}
