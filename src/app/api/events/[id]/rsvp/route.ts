import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/events/[id]/rsvp
 * Create or update an RSVP for an event
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const { status, guestCount = 0 } = await request.json();

    if (!["attending", "maybe", "declined"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Verify event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Upsert RSVP
    const existing = await db.query.eventRsvps.findFirst({
      where: and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, session.user.id)
      ),
    });

    if (existing) {
      const [updated] = await db
        .update(eventRsvps)
        .set({ status, guestCount, updatedAt: new Date() })
        .where(eq(eventRsvps.id, existing.id))
        .returning();
      return NextResponse.json(updated);
    } else {
      const [created] = await db
        .insert(eventRsvps)
        .values({ eventId, userId: session.user.id, status, guestCount })
        .returning();
      return NextResponse.json(created, { status: 201 });
    }
  } catch (error) {
    console.error("Error saving RSVP:", error);
    return NextResponse.json({ error: "Failed to save RSVP" }, { status: 500 });
  }
}

/**
 * DELETE /api/events/[id]/rsvp
 * Remove an RSVP
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;

    await db
      .delete(eventRsvps)
      .where(
        and(
          eq(eventRsvps.eventId, eventId),
          eq(eventRsvps.userId, session.user.id)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting RSVP:", error);
    return NextResponse.json({ error: "Failed to remove RSVP" }, { status: 500 });
  }
}
