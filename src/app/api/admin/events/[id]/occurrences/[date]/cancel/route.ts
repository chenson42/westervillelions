import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, eventOccurrenceOverrides } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/admin/events/[id]/occurrences/[date]/cancel
 *
 * Toggle the cancellation state of a single occurrence of a recurring event.
 *
 * Body: { cancelled: boolean, reason?: string }
 *   - cancelled: true  → upsert a row in event_occurrence_overrides
 *   - cancelled: false → delete the row (restore the occurrence)
 *
 * Auth: session required + FEATURES.EVENTS_EDIT
 *
 * Per DECISION-001: [date] is a YYYY-MM-DD string; no timezone conversion touches it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; date: string }> }
) {
  // 1. Auth check
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Feature gate — same pattern as /api/admin/events/[id]/route.ts
  if (!session.user.features?.includes(FEATURES.EVENTS_EDIT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: eventId, date: occurrenceDate } = await params;

  // 3. Verify event exists
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // 4. Validate [date] param — must be YYYY-MM-DD
  if (!DATE_RE.test(occurrenceDate)) {
    return NextResponse.json(
      { error: "Invalid date format — expected YYYY-MM-DD" },
      { status: 400 }
    );
  }
  // Also verify it parses as a real calendar date
  const [year, month, day] = occurrenceDate.split("-").map(Number);
  const testDate = new Date(year, month - 1, day);
  if (
    testDate.getFullYear() !== year ||
    testDate.getMonth() !== month - 1 ||
    testDate.getDate() !== day
  ) {
    return NextResponse.json({ error: "Invalid calendar date" }, { status: 400 });
  }

  // 5. Parse request body
  const body = await request.json().catch(() => ({})) as {
    cancelled?: boolean;
    reason?: string;
  };

  if (typeof body.cancelled !== "boolean") {
    return NextResponse.json(
      { error: "'cancelled' field is required and must be a boolean" },
      { status: 400 }
    );
  }

  if (body.cancelled) {
    // Cancel: upsert the override row
    const reason =
      typeof body.reason === "string"
        ? body.reason.trim().slice(0, 500) || null
        : null;

    const [row] = await db
      .insert(eventOccurrenceOverrides)
      .values({
        eventId,
        occurrenceDate,
        cancelledAt: new Date(),
        cancelledByUserId: session.user.id ?? null,
        cancellationReason: reason,
      })
      .onConflictDoUpdate({
        target: [eventOccurrenceOverrides.eventId, eventOccurrenceOverrides.occurrenceDate],
        set: {
          cancelledAt: new Date(),
          cancelledByUserId: session.user.id ?? null,
          cancellationReason: reason,
        },
      })
      .returning();

    return NextResponse.json({
      id: row.id,
      eventId: row.eventId,
      occurrenceDate: row.occurrenceDate,
      cancelledAt: row.cancelledAt.toISOString(),
      cancelledByUserId: row.cancelledByUserId,
      cancellationReason: row.cancellationReason,
    });
  } else {
    // Restore: delete the override row
    await db
      .delete(eventOccurrenceOverrides)
      .where(
        and(
          eq(eventOccurrenceOverrides.eventId, eventId),
          eq(eventOccurrenceOverrides.occurrenceDate, occurrenceDate)
        )
      );

    return NextResponse.json({ restored: true });
  }
}
