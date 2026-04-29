import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { FEATURES } from "@/lib/permissions";

/**
 * POST /api/admin/events/[id]/signup
 * Admin: add a member to an event signup.
 *
 * Body: { userId: string, occurrenceDate?: string }
 * Responses:
 *   201  { id, eventId, userId, occurrenceDate, status, createdAt }
 *   200  { alreadyExists: true }
 *   400  Validation error
 *   401  Not authenticated
 *   403  Forbidden
 *   404  Event not found
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
    if (!session.user.features?.includes(FEATURES.EVENTS_EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: eventId } = await params;

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json()) as { userId?: string; occurrenceDate?: string };

    if (!body.userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (event.isRecurring && !body.occurrenceDate) {
      return NextResponse.json(
        { error: "occurrenceDate is required for recurring events" },
        { status: 400 }
      );
    }

    let parsedDate: Date | null = null;
    if (body.occurrenceDate) {
      parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
    }

    try {
      const [created] = await db
        .insert(eventRsvps)
        .values({
          eventId,
          userId: body.userId,
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
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ alreadyExists: true }, { status: 200 });
      }
      throw error;
    }
  } catch (error) {
    console.error("Error adding admin signup:", error);
    return NextResponse.json({ error: "Failed to add signup" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/events/[id]/signup
 * Admin: remove a member from an event signup.
 *
 * Body: { userId: string, occurrenceDate?: string }
 * Responses:
 *   200  { success: true }
 *   400  Validation error
 *   401  Not authenticated
 *   403  Forbidden
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
    if (!session.user.features?.includes(FEATURES.EVENTS_EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: eventId } = await params;

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json()) as { userId?: string; occurrenceDate?: string };

    if (!body.userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    let parsedDate: Date | null = null;
    if (body.occurrenceDate) {
      parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
    }

    await db.delete(eventRsvps).where(
      and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, body.userId),
        parsedDate
          ? eq(eventRsvps.occurrenceDate, parsedDate)
          : isNull(eventRsvps.occurrenceDate)
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing admin signup:", error);
    return NextResponse.json({ error: "Failed to remove signup" }, { status: 500 });
  }
}
