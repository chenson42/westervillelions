import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { duesPayments, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature, hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { currentFiscalYear } from "@/lib/dues";
import { getMemberPaymentLog } from "@/lib/dues-queries";

const VALID_METHODS = ["check", "cash", "zeffy", "other"] as const;
type PaymentMethod = (typeof VALID_METHODS)[number];

function isValidMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (VALID_METHODS as readonly string[]).includes(value);
}

/**
 * GET /api/admin/dues/[memberId]?fy=2026
 *
 * Per-member payment log for a fiscal year.
 * Gate: dues.view OR dues.manage
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canView = await hasAnyFeature(session.user.id, [
      FEATURES.DUES_VIEW,
      FEATURES.DUES_MANAGE,
    ]);
    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { memberId } = await params;
    const { searchParams } = new URL(request.url);

    const fyParam = searchParams.get("fy");
    const fiscalYear = fyParam
      ? parseInt(fyParam, 10)
      : currentFiscalYear(new Date());
    if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid fiscal year" }, { status: 400 });
    }

    const log = await getMemberPaymentLog(memberId, fiscalYear);
    if (!log) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json(log);
  } catch (error) {
    console.error("Error fetching member payment log:", error);
    return NextResponse.json(
      { error: "Failed to fetch member payment log" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/dues/[memberId]
 *
 * Create a dues payment for a member.
 * Gate: dues.manage
 *
 * Body: { fiscalYear, paymentDate, amountCents, method, notes? }
 *
 * Design note: fiscalYear is an explicit field in the request body (not derived
 * from paymentDate) so treasurers can record late payments for a prior FY
 * without confusion. This matches the Phase 3 contract which lists fiscalYear
 * in the validation rules alongside paymentDate.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { memberId } = await params;

    // Verify member exists
    const member = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const body = await request.json();

    // --- Validate ---
    const { fiscalYear, paymentDate, amountCents, method, notes } = body;

    if (
      fiscalYear === undefined ||
      typeof fiscalYear !== "number" ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 2000 ||
      fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }

    if (!paymentDate || typeof paymentDate !== "string") {
      return NextResponse.json(
        { error: "paymentDate is required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(paymentDate)) {
      return NextResponse.json(
        { error: "paymentDate must be in YYYY-MM-DD format" },
        { status: 400 },
      );
    }
    // Date must not be more than 1 day in the future
    const payDate = new Date(paymentDate + "T00:00:00");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);
    if (isNaN(payDate.getTime()) || payDate > tomorrow) {
      return NextResponse.json(
        { error: "paymentDate cannot be more than 1 day in the future" },
        { status: 400 },
      );
    }

    if (
      amountCents === undefined ||
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents === 0
    ) {
      return NextResponse.json(
        { error: "amountCents must be a non-zero integer" },
        { status: 400 },
      );
    }
    if (amountCents < -500000 || amountCents > 500000) {
      return NextResponse.json(
        { error: "amountCents must be between -500000 and 500000" },
        { status: 400 },
      );
    }

    if (!isValidMethod(method)) {
      return NextResponse.json(
        { error: "method must be one of: check, cash, zeffy, other" },
        { status: 400 },
      );
    }

    if (notes !== undefined && notes !== null) {
      if (typeof notes !== "string") {
        return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
      }
      if (notes.length > 500) {
        return NextResponse.json(
          { error: "notes must be 500 characters or fewer" },
          { status: 400 },
        );
      }
    }

    // --- Insert ---
    const [payment] = await db
      .insert(duesPayments)
      .values({
        memberId,
        fiscalYear,
        paymentDate,
        amountCents,
        method,
        notes: notes ?? null,
        recordedByUserId: session.user.id,
      })
      .returning();

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error("Error creating dues payment:", error);
    return NextResponse.json(
      { error: "Failed to create dues payment" },
      { status: 500 },
    );
  }
}
