import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { duesPayments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const VALID_METHODS = ["check", "cash", "zeffy", "other"] as const;
type PaymentMethod = (typeof VALID_METHODS)[number];

function isValidMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (VALID_METHODS as readonly string[]).includes(value);
}

/**
 * PATCH /api/admin/dues/[memberId]/[paymentId]
 *
 * Update a dues payment (partial update — only provided fields are changed).
 * Gate: dues.manage
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string; paymentId: string }> },
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

    const { memberId, paymentId } = await params;

    const existing = await db.query.duesPayments.findFirst({
      where: and(
        eq(duesPayments.id, paymentId),
        eq(duesPayments.memberId, memberId),
      ),
    });
    if (!existing) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const body = await request.json();
    const { fiscalYear, paymentDate, amountCents, method, notes } = body;

    const patch: Partial<{
      fiscalYear: number;
      paymentDate: string;
      amountCents: number;
      method: string;
      notes: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (fiscalYear !== undefined) {
      if (
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
      patch.fiscalYear = fiscalYear;
    }

    if (paymentDate !== undefined) {
      if (typeof paymentDate !== "string") {
        return NextResponse.json(
          { error: "paymentDate must be a string (YYYY-MM-DD)" },
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
      patch.paymentDate = paymentDate;
    }

    if (amountCents !== undefined) {
      if (
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
      patch.amountCents = amountCents;
    }

    if (method !== undefined) {
      if (!isValidMethod(method)) {
        return NextResponse.json(
          { error: "method must be one of: check, cash, zeffy, other" },
          { status: 400 },
        );
      }
      patch.method = method;
    }

    if (notes !== undefined) {
      if (notes !== null && typeof notes !== "string") {
        return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
      }
      if (typeof notes === "string" && notes.length > 500) {
        return NextResponse.json(
          { error: "notes must be 500 characters or fewer" },
          { status: 400 },
        );
      }
      patch.notes = notes ?? null;
    }

    const [updated] = await db
      .update(duesPayments)
      .set(patch)
      .where(
        and(
          eq(duesPayments.id, paymentId),
          eq(duesPayments.memberId, memberId),
        ),
      )
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating dues payment:", error);
    return NextResponse.json(
      { error: "Failed to update dues payment" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/dues/[memberId]/[paymentId]
 *
 * Hard-delete a dues payment.
 * Gate: dues.manage
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ memberId: string; paymentId: string }> },
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

    const { memberId, paymentId } = await params;

    const existing = await db.query.duesPayments.findFirst({
      where: and(
        eq(duesPayments.id, paymentId),
        eq(duesPayments.memberId, memberId),
      ),
    });
    if (!existing) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    await db
      .delete(duesPayments)
      .where(
        and(
          eq(duesPayments.id, paymentId),
          eq(duesPayments.memberId, memberId),
        ),
      );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting dues payment:", error);
    return NextResponse.json(
      { error: "Failed to delete dues payment" },
      { status: 500 },
    );
  }
}
