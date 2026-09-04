/**
 * GET  /api/admin/events/[id]/announce — cohort/occurrence/history preview
 *      (the client's "Refresh" action; page.tsx calls the same underlying
 *      query helpers directly for first paint).
 * POST /api/admin/events/[id]/announce — send.
 *
 * Gate: BOTH handlers independently check auth() + hasFeature(EVENTS_ANNOUNCE)
 * — a narrower key than EVENTS_EDIT (Phase 1 User Decision 1), never reused
 * from the general events-view/edit keys. See Phase 2's note: the nested-page
 * proxy test only asserts *some* gate exists, not that it's this specific key
 * — this file being right is a manual-review item, not something the test
 * suite alone catches.
 *
 * docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3 "API Contract".
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, type NewEventAnnouncement } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { CLUB_GROUP_EMAIL } from "@/lib/club-contacts";
import { sendBulkMemberEmail } from "@/lib/email";
import {
  dateKey,
  generateOccurrences,
  parseWallClock,
  buildVEvent,
  buildIcsCalendar,
  toIcsFilename,
  type IcsEventInput,
} from "@/lib/events";
import {
  renderAnnouncementSubject,
  renderAnnouncementBody,
  classifyAnnouncementRecipients,
  EVENT_ANNOUNCEMENT_NOTE_MAX_LEN,
  type AnnouncementScope,
} from "@/lib/event-announcements";
import {
  getAnnouncementRecipients,
  getFutureOccurrenceOptions,
  getCancelledOccurrenceDates,
  getEventAnnouncementHistory,
  insertEventAnnouncementRows,
} from "@/lib/event-announcements-queries";

type Params = { params: Promise<{ id: string }> };

function siteUrl(): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://westervillelions.org";
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: eventId } = await params;

    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const [occurrenceOptions, allRecipients, history] = await Promise.all([
      getFutureOccurrenceOptions(eventId, event),
      getAnnouncementRecipients(),
      getEventAnnouncementHistory(eventId),
    ]);

    const withEmail = allRecipients
      .filter((m) => m.email && m.email.trim())
      .map((m) => ({ memberId: m.memberId, firstName: m.firstName, lastName: m.lastName }));
    const withoutEmail = allRecipients
      .filter((m) => !m.email || !m.email.trim())
      .map((m) => ({ memberId: m.memberId, firstName: m.firstName, lastName: m.lastName }));

    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        isRecurring: event.isRecurring,
        isAllDay: event.isAllDay,
        location: event.location ?? null,
      },
      occurrenceOptions,
      hasFutureOccurrence: occurrenceOptions.length > 0,
      recipients: { withEmail, withoutEmail },
      history,
    });
  } catch (error) {
    console.error("Error loading event announcement preview:", error);
    return NextResponse.json(
      { error: "Failed to load event announcement preview" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.EVENTS_ANNOUNCE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: eventId } = await params;
    const body = await request.json().catch(() => ({}));

    // ---- Basic shape validation --------------------------------------
    const requestedScope = body?.scope;
    if (requestedScope !== "occurrence" && requestedScope !== "series") {
      return NextResponse.json(
        { error: "scope must be 'occurrence' or 'series'." },
        { status: 400 },
      );
    }

    const requestedOccurrenceDate =
      typeof body?.occurrenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.occurrenceDate)
        ? body.occurrenceDate
        : null;
    if (requestedScope === "occurrence" && body?.occurrenceDate !== undefined && !requestedOccurrenceDate) {
      return NextResponse.json({ error: "occurrenceDate must be a YYYY-MM-DD string." }, { status: 400 });
    }

    const rawMemberIds = body?.memberIds;
    if (!Array.isArray(rawMemberIds) || !rawMemberIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "memberIds must be an array of strings." }, { status: 400 });
    }
    const memberIds: string[] = rawMemberIds;

    const rawNote = body?.note;
    const note =
      typeof rawNote === "string" && rawNote.trim()
        ? rawNote.trim().slice(0, EVENT_ANNOUNCEMENT_NOTE_MAX_LEN)
        : null;

    // ---- 1. Load the event fresh --------------------------------------
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // ---- 2. Resolve effective scope + occurrenceDate -------------------
    // A non-recurring event's "series" and "occurrence" are the same thing
    // — force scope: "occurrence" server-side regardless of what was
    // submitted, using the event's own startDate. Never trust the client
    // here (Edge Cases: "Non-recurring events never get scope: 'series' rows").
    let scope: AnnouncementScope = requestedScope;
    let occurrenceDate: string | null = null;
    let occurrenceDateObj: Date | null = null;

    if (!event.isRecurring) {
      scope = "occurrence";
      occurrenceDateObj = parseWallClock(event.startDate);
      occurrenceDate = dateKey(occurrenceDateObj);
    } else if (scope === "occurrence") {
      if (!requestedOccurrenceDate) {
        return NextResponse.json(
          { error: "occurrenceDate is required when scope is 'occurrence'." },
          { status: 400 },
        );
      }
      // Re-validate against a FRESH regeneration + cancelled-overrides set —
      // never the client's payload (mirrors /api/events/[id]/ics's own C1
      // check). Rejects both a nonexistent date and a since-cancelled one.
      const allOccurrences = generateOccurrences(event, parseWallClock(event.startDate), 520);
      const cancelledSet = await getCancelledOccurrenceDates(eventId);
      const match = allOccurrences.find((d) => dateKey(d) === requestedOccurrenceDate);
      if (!match || cancelledSet.has(requestedOccurrenceDate)) {
        return NextResponse.json(
          { error: "That occurrence has been cancelled or no longer exists — refresh and pick another." },
          { status: 400 },
        );
      }
      occurrenceDateObj = match;
      occurrenceDate = requestedOccurrenceDate;
    }
    // scope === "series" for a recurring event: occurrenceDate stays null.

    // ---- 3. The event must have SOME future, non-cancelled occurrence --
    const futureOptions = await getFutureOccurrenceOptions(eventId, event);
    if (futureOptions.length === 0) {
      return NextResponse.json(
        { error: "This event has no upcoming occurrences to announce." },
        { status: 400 },
      );
    }

    // ---- 4. Re-derive the active-member/has-email cohort fresh ---------
    const freshActiveMembers = await getAnnouncementRecipients();
    const { toSend: toSendClassified, skipped } = classifyAnnouncementRecipients(
      memberIds,
      freshActiveMembers.map((m) => ({ memberId: m.memberId, email: m.email })),
    );

    if (toSendClassified.length === 0) {
      return NextResponse.json({ error: "No recipients to send to." }, { status: 400 });
    }

    const memberById = new Map(freshActiveMembers.map((m) => [m.memberId, m]));

    // ---- 5. Build the .ics attachment ONCE for the whole batch ---------
    const eventUrl = event.isPublic
      ? `${siteUrl()}/events/${eventId}`
      : `${siteUrl()}/members/events/${eventId}`;
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

    let icsContent: string;
    if (scope === "occurrence") {
      const vevent = buildVEvent(icsInput, occurrenceDateObj!);
      icsContent = buildIcsCalendar([vevent]);
    } else {
      const allOccurrences = generateOccurrences(event, parseWallClock(event.startDate), 520);
      const cancelledSet = await getCancelledOccurrenceDates(eventId);
      const activeOccurrences = allOccurrences.filter((d) => !cancelledSet.has(dateKey(d)));
      const vevents = activeOccurrences.map((d) => buildVEvent(icsInput, d));
      icsContent = buildIcsCalendar(vevents);
    }
    const icsFilename = toIcsFilename(event.title);

    // ---- 6. Render subject once, one personalized body per recipient ---
    const subject = renderAnnouncementSubject(event.title, scope);
    const icsDownloadUrl =
      scope === "occurrence"
        ? `${siteUrl()}/api/events/${eventId}/ics?occurrence=${occurrenceDate}`
        : `${siteUrl()}/api/events/${eventId}/ics`;

    const toSend = toSendClassified.map(({ memberId, email }) => {
      const member = memberById.get(memberId)!;
      const html = renderAnnouncementBody({
        firstName: member.firstName,
        event: {
          title: event.title,
          description: event.description ?? null,
          location: event.location ?? null,
          isAllDay: event.isAllDay,
          isRecurring: event.isRecurring,
          recurrenceType: event.recurrenceType ?? null,
          recurrenceDays: event.recurrenceDays ?? null,
          recurrenceEndDate: event.recurrenceEndDate ?? null,
          startDate: event.startDate,
        },
        scope,
        occurrenceDate: occurrenceDateObj ?? undefined,
        icsDownloadUrl,
        note,
      });
      return { memberId, email, html };
    });

    // ---- 7. Send. Always via sendBulkMemberEmail() — never a hand-rolled
    //         loop over sendEmail() for this shape. ----------------------
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
    const { results } = await sendBulkMemberEmail({
      from: fromEmail,
      subject,
      replyTo: CLUB_GROUP_EMAIL,
      attachments: [{ filename: icsFilename, content: icsContent, contentType: "text/calendar" }],
      recipients: toSend.map((r) => ({ to: r.email, html: r.html })),
    });
    const resultByEmail = new Map(results.map((r) => [r.to, r]));

    // ---- 8. One event_announcements row per attempted recipient, all
    //         sharing one batchId. -----------------------------------
    const batchId = randomUUID();
    const rows: NewEventAnnouncement[] = toSend.map((r) => {
      const result = resultByEmail.get(r.email);
      return {
        batchId,
        eventId,
        scope,
        occurrenceDate: scope === "series" ? null : occurrenceDate,
        memberId: r.memberId,
        sentByUserId: session.user.id,
        emailQueueId: result?.emailQueueId ?? null,
        success: result?.success ?? false,
        error: result?.error ?? null,
        note,
      };
    });
    await insertEventAnnouncementRows(rows);

    // ---- 9. 200 always — a partial or total send failure is a
    //         successful API call reporting failure, never a 500. -------
    return NextResponse.json({
      batchId,
      scope,
      occurrenceDate: scope === "series" ? null : occurrenceDate,
      sent: toSend.map((r) => {
        const result = resultByEmail.get(r.email);
        return {
          memberId: r.memberId,
          success: result?.success ?? false,
          ...(result?.error ? { error: result.error } : {}),
        };
      }),
      skipped,
    });
  } catch (error) {
    console.error("Error sending event announcement:", error);
    return NextResponse.json({ error: "Failed to send event announcement" }, { status: 500 });
  }
}
