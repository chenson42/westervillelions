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
import { eq, and, gte, sql } from "drizzle-orm";
import {
  listReimbursementsForMember,
  getEmailsForFeature,
} from "@/lib/ledger-queries";
import { sendEmail } from "@/lib/email";
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

    // E-2: Notify LEDGER_APPROVE holders of new submission
    try {
      const approverEmails = await getEmailsForFeature(FEATURES.LEDGER_APPROVE);
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
      const amountDollars = (amountCents / 100).toFixed(2);
      const appUrl = process.env.NEXTAUTH_URL ?? "";

      for (const email of approverEmails) {
        await sendEmail({
          to: email,
          from: fromEmail,
          subject: `New reimbursement request — $${amountDollars}`,
          html: `<p>A new reimbursement request has been submitted and requires board review.</p>
<ul>
  <li><strong>Amount:</strong> $${amountDollars}</li>
  <li><strong>Description:</strong> ${description}</li>
  ${beneficiaryCause ? `<li><strong>Cause:</strong> ${beneficiaryCause}</li>` : ""}
</ul>
<p>Review the request at <a href="${appUrl}/admin/ledger/reimbursements">${appUrl}/admin/ledger/reimbursements</a>.</p>`,
        });
      }
    } catch {
      // Best-effort — email failure does not block the submission
    }

    return NextResponse.json({ id: newReimb.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating reimbursement:", error);
    return NextResponse.json({ error: "Failed to submit reimbursement" }, { status: 500 });
  }
}
