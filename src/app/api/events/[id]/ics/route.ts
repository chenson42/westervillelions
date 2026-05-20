import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, eventOccurrenceOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FEATURES } from "@/lib/permissions";
import { hasFeature } from "@/lib/permissions-server";
import {
  parseWallClock,
  dateKey,
  generateOccurrences,
  buildVEvent,
  buildIcsCalendar,
  toIcsFilename,
  type IcsEventInput,
} from "@/lib/events";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/events/[id]/ics
 *
 * Returns an ICS file for an event.
 * - With ?occurrence=YYYY-MM-DD → single VEVENT for that occurrence
 * - Without query param → all non-cancelled occurrences (series download)
 *
 * Auth gate:
 * - isPublic === true  → anonymous-accessible
 * - isPublic === false → requires session + FEATURES.MEMBERS_VIEW
 *
 * See: docs/work-log/2026-05-20-add-to-calendar.md (Phase 3 API contract)
 */
export async function GET(request: NextRequest, { params }: Params) {
  const noStoreHeaders = {
    "Cache-Control": "no-store",
  };

  const { id: eventId } = await params;

  // ── 1. Load event ──────────────────────────────────────────────────────────
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });

  if (!event) {
    return NextResponse.json(
      { error: "Event not found" },
      { status: 404, headers: noStoreHeaders }
    );
  }

  // ── 2. Auth gate ───────────────────────────────────────────────────────────
  if (!event.isPublic) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: noStoreHeaders }
      );
    }
    if (!session.user.id || !(await hasFeature(session.user.id, FEATURES.MEMBERS_VIEW))) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: noStoreHeaders }
      );
    }
  }

  // ── 3. Load cancellation overrides ────────────────────────────────────────
  const overrides = await db
    .select({ occurrenceDate: eventOccurrenceOverrides.occurrenceDate })
    .from(eventOccurrenceOverrides)
    .where(eq(eventOccurrenceOverrides.eventId, eventId));

  const cancelledSet = new Set(overrides.map((o) => o.occurrenceDate));

  // ── 4. Build the canonical event URL ──────────────────────────────────────
  const siteUrl =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://westervillelions.org";
  const eventUrl = event.isPublic
    ? `${siteUrl}/events/${eventId}`
    : `${siteUrl}/members/events/${eventId}`;

  const icsInput: IcsEventInput = {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    location: event.location ?? null,
    isAllDay: event.isAllDay,
    startDate: event.startDate,
    endDate: event.endDate ?? null,
    isPublic: event.isPublic,
    url: eventUrl,
  };

  const filename = toIcsFilename(event.title);
  const responseHeaders = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };

  // ── 5a. Single-occurrence download ────────────────────────────────────────
  const occurrenceParam = request.nextUrl.searchParams.get("occurrence");

  if (occurrenceParam !== null) {
    // Validate YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrenceParam)) {
      return NextResponse.json(
        { error: "Invalid occurrence date" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    // C1: reject cancelled occurrences
    if (cancelledSet.has(occurrenceParam)) {
      return NextResponse.json(
        { error: "Occurrence not found or cancelled" },
        { status: 404, headers: noStoreHeaders }
      );
    }

    // Validate the occurrence falls within the generated series
    // Use parseWallClock(event.startDate) as `from` (not new Date()) so that
    // past occurrences are included — per invariant in Phase 3 / Phase 2.
    const allOccurrences = generateOccurrences(
      event,
      parseWallClock(event.startDate),
      520
    );
    const match = allOccurrences.find((d) => dateKey(d) === occurrenceParam);

    if (!match) {
      return NextResponse.json(
        { error: "Occurrence not found or cancelled" },
        { status: 404, headers: noStoreHeaders }
      );
    }

    const vevent = buildVEvent(icsInput, match);
    const ics = buildIcsCalendar([vevent]);

    return new NextResponse(ics, { headers: responseHeaders });
  }

  // ── 5b. Series download (no occurrence param) ─────────────────────────────
  // Pass parseWallClock(event.startDate) as `from` so past occurrences are
  // included (C4 + Phase 2 invariant — admin page uses the same pattern).
  const allOccurrences = generateOccurrences(
    event,
    parseWallClock(event.startDate),
    520
  );

  // C1: filter out cancelled occurrences
  const activeOccurrences = allOccurrences.filter(
    (d) => !cancelledSet.has(dateKey(d))
  );

  // C6: zero occurrences → return valid empty VCALENDAR (200)
  const vevents = activeOccurrences.map((d) => buildVEvent(icsInput, d));
  const ics = buildIcsCalendar(vevents);

  return new NextResponse(ics, { headers: responseHeaders });
}
