import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/events/[id]/rsvp
 * Create or update an RSVP for an event.
 * Authentication is optional — logged-in users key on userId, anonymous users key on rsvpEmail.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;
    const body = await request.json();
    const { status, guestCount = 0, name, email } = body;

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

    if (session?.user?.id) {
      // Authenticated user: upsert by (eventId, userId)
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
    } else {
      // Anonymous user: require name + email
      if (!email) {
        return NextResponse.json({ error: "Email is required for anonymous RSVPs" }, { status: 400 });
      }
      if (!name) {
        return NextResponse.json({ error: "Name is required for anonymous RSVPs" }, { status: 400 });
      }

      // Upsert by (eventId, rsvpEmail)
      const existing = await db.query.eventRsvps.findFirst({
        where: and(
          eq(eventRsvps.eventId, eventId),
          eq(eventRsvps.rsvpEmail, email)
        ),
      });

      if (existing) {
        const [updated] = await db
          .update(eventRsvps)
          .set({ status, guestCount, rsvpName: name, updatedAt: new Date() })
          .where(eq(eventRsvps.id, existing.id))
          .returning();
        return NextResponse.json(updated);
      } else {
        const [created] = await db
          .insert(eventRsvps)
          .values({ eventId, rsvpName: name, rsvpEmail: email, status, guestCount })
          .returning();
        return NextResponse.json(created, { status: 201 });
      }
    }
  } catch (error) {
    console.error("Error saving RSVP:", error);
    return NextResponse.json({ error: "Failed to save RSVP" }, { status: 500 });
  }
}

/**
 * DELETE /api/events/[id]/rsvp
 * Remove an RSVP.
 * Authenticated users delete by userId; anonymous users delete by email in body.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: eventId } = await params;

    if (session?.user?.id) {
      await db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, eventId),
            eq(eventRsvps.userId, session.user.id)
          )
        );
    } else {
      const body = await request.json().catch(() => ({}));
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }
      await db
        .delete(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, eventId),
            eq(eventRsvps.rsvpEmail, email)
          )
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting RSVP:", error);
    return NextResponse.json({ error: "Failed to remove RSVP" }, { status: 500 });
  }
}
