import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { eq, inArray } from "drizzle-orm";
import { isImageDataUri, parseImageDataUri, buildEventImageUrl } from "@/lib/event-image";
import { upsertEventImage, deleteEventImage } from "@/lib/event-images-queries";
import { EVENT_SIBLING_FAN_OUT_FIELDS, isUpcomingWallClock, type EventSiblingFanOutField } from "@/lib/events";
import { getSiblingCandidatesByTitle } from "@/lib/event-siblings-queries";

type SiblingResultRow = { id: string; title: string; startDate: string };

/**
 * PATCH /api/admin/events/[id]
 *
 * Extended (docs/work-log/2026-09-29-bulk-edit-same-title-events.md, Phase
 * 3) with an optional `applyToSiblings: { fields: string[] }` request
 * member. When omitted, behavior is byte-for-byte identical to the
 * original full-body-replace PATCH: only the target row updates, and the
 * response's `siblings` field is `null`.
 *
 * When present and valid, the edited row's own newly-saved value for each
 * requested field that is ALSO on the server's own EVENT_SIBLING_FAN_OUT_FIELDS
 * allowlist is fanned out to every other upcoming event sharing this row's
 * PRE-EDIT title (existing.title — never body.title, and never a
 * client-supplied id list). Both the main-row update and the sibling
 * fan-out commit inside one db.transaction().
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.features?.includes(FEATURES.EVENTS_EDIT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = await request.json();
  const {
    title,
    description,
    startDate,
    endDate,
    location,
    image,
    isPublic,
    isFeatured,
    requiresRsvp,
    allowGuestCount,
    maxAttendees,
    isAllDay,
    isRecurring,
    recurrenceType,
    recurrenceDays,
    recurrenceEndDate,
    extraQuestion,
    extraQuestionType,
    extraQuestionOptions,
    extraQuestionRequired,
    applyToSiblings,
  } = body;

  // Validate applyToSiblings BEFORE any write — a malformed or fully
  // off-allowlist request fails the whole PATCH, including the main row.
  // A request that simply omits applyToSiblings skips this block entirely
  // (allowedFields stays [], no error, no sibling query — see below).
  let allowedFields: EventSiblingFanOutField[] = [];
  if (applyToSiblings !== undefined) {
    const requestedFields: unknown = applyToSiblings?.fields;
    if (!Array.isArray(requestedFields) || requestedFields.length === 0) {
      return NextResponse.json(
        { error: "applyToSiblings.fields must be a non-empty array of field names." },
        { status: 400 }
      );
    }
    allowedFields = requestedFields.filter((f): f is EventSiblingFanOutField =>
      (EVENT_SIBLING_FAN_OUT_FIELDS as readonly string[]).includes(f)
    );
    if (allowedFields.length === 0) {
      return NextResponse.json(
        { error: "No recognized fields to apply to other events." },
        { status: 400 }
      );
    }
  }

  const recurring = isRecurring ?? existing.isRecurring;

  // Transpose a freshly-cropped data: URI into event_images + a versioned
  // URL; an explicit null/empty clears any stored image; anything else
  // (the existing versioned URL, unchanged) passes through as-is.
  // Site Review Fixes Batch 3 — docs/work-log/2026-09-04-site-review-fixes.md
  const rawImage: string | null = typeof image === "string" ? image : null;
  let finalImage: string | null;
  if (isImageDataUri(rawImage)) {
    const parsed = parseImageDataUri(rawImage);
    if (parsed) {
      await upsertEventImage(id, parsed.buffer, parsed.contentType);
      finalImage = buildEventImageUrl(id, Date.now());
    } else {
      // Malformed data: URI (shouldn't happen from the cropper) — leave
      // whatever was already stored rather than silently wiping it.
      finalImage = existing.image;
    }
  } else if (!rawImage) {
    await deleteEventImage(id);
    finalImage = null;
  } else {
    finalImage = rawImage;
  }

  // Normalized values for the ten fan-out-eligible fields, computed ONCE
  // and shared by both the main-row update and the sibling update — never
  // a second, independently-derived copy (Phase 3 Data Flow step 4).
  const fanOutValues = {
    location: location || null,
    description: description || null,
    isPublic: isPublic ?? existing.isPublic,
    requiresRsvp: requiresRsvp ?? existing.requiresRsvp,
    maxAttendees: maxAttendees || null,
    allowGuestCount: allowGuestCount ?? existing.allowGuestCount,
    extraQuestion: extraQuestion || null,
    extraQuestionType: extraQuestion ? (extraQuestionType === "select" ? "select" : "text") : "text",
    extraQuestionOptions: Array.isArray(extraQuestionOptions)
      ? extraQuestionOptions.filter((s: unknown) => typeof s === "string" && s.length > 0)
      : [],
    extraQuestionRequired: Boolean(extraQuestion) && Boolean(extraQuestionRequired),
  } satisfies Record<EventSiblingFanOutField, unknown>;

  let updated: typeof existing | undefined;
  let siblings: { matched: number; updated: SiblingResultRow[]; skipped: SiblingResultRow[] } | null = null;

  await db.transaction(async (tx) => {
    const [mainUpdated] = await tx
      .update(events)
      .set({
        title,
        description: fanOutValues.description,
        // Pass wall-clock strings directly — no new Date() wrapping. See DECISION-005.
        startDate: startDate || existing.startDate,
        endDate: endDate || null,
        location: fanOutValues.location,
        image: finalImage,
        isPublic: fanOutValues.isPublic,
        isFeatured: isFeatured ?? existing.isFeatured,
        requiresRsvp: fanOutValues.requiresRsvp,
        allowGuestCount: fanOutValues.allowGuestCount,
        maxAttendees: fanOutValues.maxAttendees,
        isAllDay: isAllDay ?? existing.isAllDay,
        isRecurring: recurring,
        recurrenceType: recurring ? (recurrenceType || null) : null,
        recurrenceDays: recurring ? (recurrenceDays || null) : null,
        recurrenceEndDate: recurring && recurrenceEndDate ? recurrenceEndDate : null,
        extraQuestion: fanOutValues.extraQuestion,
        extraQuestionType: fanOutValues.extraQuestionType,
        extraQuestionOptions: fanOutValues.extraQuestionOptions,
        extraQuestionRequired: fanOutValues.extraQuestionRequired,
        updatedAt: new Date(),
      })
      .where(eq(events.id, id))
      .returning();
    updated = mainUpdated;

    if (allowedFields.length === 0) {
      // No applyToSiblings requested — no sibling query at all, matching
      // the ordinary save's zero added cost.
      return;
    }

    // Siblings are ALWAYS selected by existing.title (the pre-edit,
    // as-loaded title) — never body.title, even if this same save is also
    // renaming the event. See Phase 3 "Edge Cases — Title changed in the
    // same save."
    const candidates = await getSiblingCandidatesByTitle(tx, existing.title, id);
    const eligible = candidates.filter((c) => isUpcomingWallClock(c.startDate));

    if (eligible.length === 0) {
      siblings = { matched: 0, updated: [], skipped: [] };
      return;
    }

    const fieldsToSet: Partial<typeof fanOutValues> & { updatedAt: Date } = { updatedAt: new Date() };
    for (const field of allowedFields) {
      (fieldsToSet as Record<EventSiblingFanOutField, unknown>)[field] = fanOutValues[field];
    }

    const returned = await tx
      .update(events)
      .set(fieldsToSet)
      .where(inArray(events.id, eligible.map((c) => c.id)))
      .returning({ id: events.id, title: events.title, startDate: events.startDate });

    const returnedIds = new Set(returned.map((r) => r.id));
    const skipped = eligible
      .filter((c) => !returnedIds.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, startDate: c.startDate }));

    siblings = { matched: eligible.length, updated: returned, skipped };
  });

  return NextResponse.json({ event: updated, siblings });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.features?.includes(FEATURES.EVENTS_DELETE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  await db.delete(events).where(eq(events.id, id));
  return NextResponse.json({ success: true });
}
