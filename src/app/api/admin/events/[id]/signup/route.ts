import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventRsvps, events } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { FEATURES } from "@/lib/permissions";
import { format } from "date-fns";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/events/[id]/signup
 * Admin: add a member or guest write-in to an event signup.
 *
 * Body (discriminated union):
 *   { kind: "member"; userId: string; occurrenceDate?: string; status?: string; guestCount?: number }
 *   { kind: "guest";  guestName: string; guestEmail?: string; occurrenceDate?: string }
 *
 * Backward-compat: if `kind` is absent but `userId` is present, treated as kind: "member".
 *
 * Responses:
 *   201  { id, eventId, userId, occurrenceDate, status, createdAt, rsvpName?, rsvpEmail?, createdByUserId? }
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

    const body = (await request.json()) as {
      kind?: string;
      userId?: string;
      occurrenceDate?: string;
      status?: string;
      guestCount?: number;
      guestName?: string;
      guestEmail?: string;
    };

    // Determine kind with backward-compat fallback
    const kind = body.kind ?? (body.userId ? "member" : undefined);

    if (!kind || (kind !== "member" && kind !== "guest")) {
      return NextResponse.json(
        { error: "kind must be 'member' or 'guest'" },
        { status: 400 }
      );
    }

    // Parse occurrenceDate (shared logic for both kinds)
    let parsedDateStr: string | null = null;
    if (body.occurrenceDate) {
      const parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
      parsedDateStr = format(parsedDate, "yyyy-MM-dd HH:mm:ss");
    }

    if (kind === "member") {
      // ── Member path (existing behavior) ────────────────────────────────────
      if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }

      if (event.isRecurring && !body.occurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate is required for recurring events" },
          { status: 400 }
        );
      }

      try {
        const [created] = await db
          .insert(eventRsvps)
          .values({
            eventId,
            userId: body.userId,
            occurrenceDate: parsedDateStr ?? null,
            status: (body.status ?? "attending") as "attending" | "maybe" | "declined",
            guestCount: body.guestCount ?? 0,
            createdByUserId: session.user.id,
          })
          .returning();

        return NextResponse.json(
          {
            id: created.id,
            eventId: created.eventId,
            userId: created.userId,
            occurrenceDate: created.occurrenceDate ?? null,
            status: created.status,
            createdAt: created.createdAt instanceof Date
              ? created.createdAt.toISOString()
              : created.createdAt,
          },
          { status: 201 }
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return NextResponse.json({ alreadyExists: true }, { status: 200 });
        }
        throw error;
      }
    } else {
      // ── Guest path (new) ────────────────────────────────────────────────────
      const guestName = body.guestName?.trim() ?? "";
      if (!guestName) {
        return NextResponse.json({ error: "guestName is required" }, { status: 400 });
      }
      if (guestName.length > 200) {
        return NextResponse.json({ error: "guestName must be 200 characters or fewer" }, { status: 400 });
      }

      const guestEmail = body.guestEmail?.trim() || null;
      if (guestEmail && !EMAIL_REGEX.test(guestEmail)) {
        return NextResponse.json({ error: "Invalid guestEmail format" }, { status: 400 });
      }

      if (event.isRecurring && !body.occurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate is required for recurring events" },
          { status: 400 }
        );
      }
      if (!event.isRecurring && body.occurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate must not be provided for non-recurring events" },
          { status: 400 }
        );
      }

      const [created] = await db
        .insert(eventRsvps)
        .values({
          eventId,
          userId: null,
          rsvpName: guestName,
          rsvpEmail: guestEmail,
          occurrenceDate: parsedDateStr ?? null,
          status: "attending",
          guestCount: 0,
          createdByUserId: session.user.id,
        })
        .returning();

      return NextResponse.json(
        {
          id: created.id,
          eventId: created.eventId,
          userId: null,
          rsvpName: created.rsvpName,
          rsvpEmail: created.rsvpEmail ?? null,
          occurrenceDate: created.occurrenceDate ?? null,
          status: created.status,
          createdAt: created.createdAt instanceof Date
            ? created.createdAt.toISOString()
            : created.createdAt,
          createdByUserId: created.createdByUserId,
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error("Error adding admin signup:", error);
    return NextResponse.json({ error: "Failed to add signup" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/events/[id]/signup
 * Admin: remove a member or guest from an event signup.
 *
 * Body:
 *   { userId: string; occurrenceDate?: string }  — existing member path
 *   { rsvpId: string }                           — new: delete by rsvp primary key
 *
 * If both rsvpId and userId are present, rsvpId takes precedence.
 * rsvpId path verifies eventRsvps.eventId = eventId (URL param) before deleting.
 *
 * Responses:
 *   200  { success: true }
 *   400  Validation error
 *   401  Not authenticated
 *   403  Forbidden
 *   404  Event or rsvp not found
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

    const body = (await request.json()) as {
      userId?: string;
      occurrenceDate?: string;
      rsvpId?: string;
    };

    if (body.rsvpId) {
      // ── Delete by rsvpId — verify ownership before deleting ────────────────
      const row = await db.query.eventRsvps.findFirst({
        where: eq(eventRsvps.id, body.rsvpId),
      });
      if (!row || row.eventId !== eventId) {
        return NextResponse.json(
          { error: "RSVP not found" },
          { status: 404 }
        );
      }
      await db.delete(eventRsvps).where(eq(eventRsvps.id, body.rsvpId));
      return NextResponse.json({ success: true });
    }

    // ── Delete by userId + occurrenceDate (existing member path) ───────────
    if (!body.userId) {
      return NextResponse.json({ error: "userId or rsvpId is required" }, { status: 400 });
    }

    let parsedDateStr: string | null = null;
    if (body.occurrenceDate) {
      const parsedDate = new Date(body.occurrenceDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid occurrenceDate" }, { status: 400 });
      }
      parsedDateStr = format(parsedDate, "yyyy-MM-dd HH:mm:ss");
    }

    await db.delete(eventRsvps).where(
      and(
        eq(eventRsvps.eventId, eventId),
        eq(eventRsvps.userId, body.userId),
        parsedDateStr
          ? eq(eventRsvps.occurrenceDate, parsedDateStr)
          : isNull(eventRsvps.occurrenceDate)
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing admin signup:", error);
    return NextResponse.json({ error: "Failed to remove signup" }, { status: 500 });
  }
}
