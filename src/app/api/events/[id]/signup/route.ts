import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events } from "@/lib/db/schema";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { generateOccurrences, isValidOccurrence } from "@/lib/events";

/**
 * POST /api/events/[id]/signup
 * Sign the authenticated user up for an event (or a specific occurrence of a recurring event).
 * Login required.
 *
 * Request body:
 *   { occurrenceDate?: string }  // ISO timestamp — required for recurring events
 *
 * Responses:
 *   201  { id, eventId, userId, occurrenceDate, status, createdAt }
 *   200  { alreadySignedUp: true }  — idempotent: user is already attending
 *   400  Validation error
 *   401  Not authenticated
 *   404  Event not found
 *   409  Occurrence is full (cap reached or unique violation race condition)
 *   500  Server error
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

    // Fetch the event
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Signups must be enabled on the event
    if (!event.requiresRsvp) {
      return NextResponse.json(
        { error: "Signups are not enabled for this event" },
        { status: 400 }
      );
    }

    // Parse body (allow empty body for non-recurring events)
    const body = await request.json().catch(() => ({})) as { occurrenceDate?: string };

    let parsedDate: Date | null = null;

    if (event.isRecurring) {
      if (!body.occurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate is required for recurring events" },
          { status: 400 }
        );
      }

      parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }

      // Validate against the generated occurrence list
      const allOccurrences = generateOccurrences(
        {
          isRecurring: event.isRecurring,
          startDate: event.startDate,
          recurrenceType: event.recurrenceType,
          recurrenceDays: event.recurrenceDays,
          recurrenceEndDate: event.recurrenceEndDate,
        },
        event.startDate
      );

      if (!isValidOccurrence(parsedDate, allOccurrences)) {
        return NextResponse.json({ error: "Invalid occurrence date" }, { status: 400 });
      }

      // Reject signups for past occurrences
      if (parsedDate < new Date()) {
        return NextResponse.json(
          { error: "Cannot sign up for a past occurrence" },
          { status: 400 }
        );
      }
    }

    // Idempotency: if the user is already signed up (status != 'declined'), return 200
    const existingRsvp = await db.query.eventRsvps.findFirst({
      where: and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, session.user.id),
        parsedDate
          ? eq(eventRsvps.occurrenceDate, parsedDate)
          : isNull(eventRsvps.occurrenceDate)
      ),
    });

    if (existingRsvp && existingRsvp.status !== "declined") {
      return NextResponse.json({ alreadySignedUp: true }, { status: 200 });
    }

    // Cap check: count attending/maybe rows for this event + occurrenceDate slot
    if (event.maxAttendees !== null && event.maxAttendees !== undefined) {
      const [{ count: attendeeCount }] = await db
        .select({ count: count() })
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.eventId, eventId),
            parsedDate
              ? eq(eventRsvps.occurrenceDate, parsedDate)
              : isNull(eventRsvps.occurrenceDate),
            ne(eventRsvps.status, "declined")
          )
        );

      if (Number(attendeeCount) >= event.maxAttendees) {
        return NextResponse.json({ error: "This occurrence is full" }, { status: 409 });
      }
    }

    // Insert (or re-activate a previously declined row)
    try {
      if (existingRsvp) {
        // Row exists but status is 'declined' — update to 'attending'
        const [updated] = await db
          .update(eventRsvps)
          .set({ status: "attending", updatedAt: new Date() })
          .where(eq(eventRsvps.id, existingRsvp.id))
          .returning();
        return NextResponse.json(
          {
            id: updated.id,
            eventId: updated.eventId,
            userId: updated.userId,
            occurrenceDate: updated.occurrenceDate?.toISOString() ?? null,
            status: updated.status,
            createdAt: updated.createdAt.toISOString(),
          },
          { status: 201 }
        );
      }

      const [created] = await db
        .insert(eventRsvps)
        .values({
          eventId,
          userId: session.user.id,
          occurrenceDate: parsedDate ?? null,
          status: "attending",
        })
        .returning();

      return NextResponse.json(
        {
          id: created.id,
          eventId: created.eventId,
          userId: created.userId,
          occurrenceDate: created.occurrenceDate?.toISOString() ?? null,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        },
        { status: 201 }
      );
    } catch (error) {
      // Postgres unique violation — race condition: another request filled the last slot
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "This occurrence is full" }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error("Error signing up for event:", error);
    return NextResponse.json({ error: "Failed to sign up for event" }, { status: 500 });
  }
}

/**
 * DELETE /api/events/[id]/signup
 * Cancel the authenticated user's signup for an event (or a specific occurrence).
 * Login required. Idempotent — returns 200 even when no row exists.
 *
 * Request body:
 *   { occurrenceDate?: string }  // ISO timestamp — required for recurring events
 *
 * Responses:
 *   200  { success: true }
 *   401  Not authenticated
 *   404  Event not found
 *   500  Server error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;

    // Verify event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Parse optional body
    const body = await request.json().catch(() => ({})) as { occurrenceDate?: string };

    let parsedDate: Date | null = null;
    if (body.occurrenceDate) {
      parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
    }

    // Delete the matching row (idempotent — no error if row not found)
    await db.delete(eventRsvps).where(
      and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, session.user.id),
        parsedDate
          ? eq(eventRsvps.occurrenceDate, parsedDate)
          : isNull(eventRsvps.occurrenceDate)
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error canceling event signup:", error);
    return NextResponse.json({ error: "Failed to cancel signup" }, { status: 500 });
  }
}
