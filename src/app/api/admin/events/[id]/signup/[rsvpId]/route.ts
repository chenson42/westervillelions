import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FEATURES } from "@/lib/permissions";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * PATCH /api/admin/events/[id]/signup/[rsvpId]
 * Admin: edit a guest write-in row (name + optional email).
 *
 * Body: { guestName: string; guestEmail?: string | null }
 *
 * Validation:
 *   - Row must exist and belong to this eventId (ownership check).
 *   - Row must have userId IS NULL (cannot rename member signups via this endpoint).
 *   - guestName must be non-empty after trim.
 *   - guestEmail must match email regex if non-null/non-empty.
 *
 * Responses:
 *   200  { id, rsvpName, rsvpEmail, updatedAt }
 *   400  Validation error
 *   401  Not authenticated
 *   403  Forbidden
 *   404  Not found (or ownership mismatch — same response, no info leakage)
 *   500  Server error
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rsvpId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.features?.includes(FEATURES.EVENTS_EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: eventId, rsvpId } = await params;

    // Load the row
    const row = await db.query.eventRsvps.findFirst({
      where: eq(eventRsvps.id, rsvpId),
    });

    if (!row || row.eventId !== eventId) {
      return NextResponse.json({ error: "RSVP not found" }, { status: 404 });
    }

    if (row.userId !== null) {
      return NextResponse.json(
        { error: "Cannot edit a member signup through the guest edit endpoint." },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      guestName?: string;
      guestEmail?: string | null;
    };

    const guestName = body.guestName?.trim() ?? "";
    if (!guestName) {
      return NextResponse.json({ error: "guestName is required" }, { status: 400 });
    }

    const guestEmail = typeof body.guestEmail === "string"
      ? body.guestEmail.trim() || null
      : null;

    if (guestEmail && !EMAIL_REGEX.test(guestEmail)) {
      return NextResponse.json({ error: "Invalid guestEmail format" }, { status: 400 });
    }

    const [updated] = await db
      .update(eventRsvps)
      .set({
        rsvpName: guestName,
        rsvpEmail: guestEmail,
        updatedAt: new Date(),
      })
      .where(eq(eventRsvps.id, rsvpId))
      .returning();

    return NextResponse.json({
      id: updated.id,
      rsvpName: updated.rsvpName,
      rsvpEmail: updated.rsvpEmail ?? null,
      updatedAt: updated.updatedAt instanceof Date
        ? updated.updatedAt.toISOString()
        : updated.updatedAt,
    });
  } catch (error) {
    console.error("Error updating guest signup:", error);
    return NextResponse.json({ error: "Failed to update guest" }, { status: 500 });
  }
}
