import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { asc, eq } from "drizzle-orm";
import { isImageDataUri, parseImageDataUri, buildEventImageUrl } from "@/lib/event-image";
import { upsertEventImage } from "@/lib/event-images-queries";

export async function GET() {
  const session = await auth();
  if (!session?.user?.features?.includes(FEATURES.EVENTS_EDIT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const eventList = await db.select().from(events).orderBy(asc(events.startDate));
  return NextResponse.json(eventList);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.features?.includes(FEATURES.EVENTS_EDIT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  } = body;

  if (!title || !startDate) {
    return NextResponse.json({ error: "Title and start date are required" }, { status: 400 });
  }

  // Validate startDate shape: "YYYY-MM-DDTHH:MM" wall-clock string
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startDate)) {
    return NextResponse.json({ error: "startDate must be a YYYY-MM-DDTHH:MM string" }, { status: 400 });
  }

  // The cropper always sends a data: URI for a newly selected/cropped image.
  // Never persist that base64 blob into events.image, even momentarily —
  // insert with no image, then transpose it into event_images once the
  // event's id exists (site-review-fixes Batch 3).
  const rawImage: string | null = typeof image === "string" ? image : null;
  const initialImage = isImageDataUri(rawImage) ? null : rawImage;

  const [newEvent] = await db
    .insert(events)
    .values({
      title,
      description: description || null,
      // Pass wall-clock strings directly — no new Date() wrapping. See DECISION-005.
      startDate,
      endDate: endDate || null,
      location: location || null,
      image: initialImage,
      isPublic: isPublic ?? false,
      isFeatured: isFeatured ?? false,
      requiresRsvp: requiresRsvp ?? false,
      allowGuestCount: allowGuestCount ?? false,
      maxAttendees: maxAttendees || null,
      isAllDay: isAllDay ?? false,
      isRecurring: isRecurring ?? false,
      recurrenceType: isRecurring ? (recurrenceType || null) : null,
      recurrenceDays: isRecurring ? (recurrenceDays || null) : null,
      recurrenceEndDate: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
      extraQuestion: extraQuestion || null,
      extraQuestionType: extraQuestion ? (extraQuestionType === "select" ? "select" : "text") : "text",
      extraQuestionOptions: Array.isArray(extraQuestionOptions) ? extraQuestionOptions.filter((s) => typeof s === "string" && s.length > 0) : [],
      extraQuestionRequired: Boolean(extraQuestion) && Boolean(extraQuestionRequired),
      createdBy: session.user.id,
    })
    .returning();

  if (isImageDataUri(rawImage)) {
    const parsed = parseImageDataUri(rawImage);
    if (parsed) {
      await upsertEventImage(newEvent.id, parsed.buffer, parsed.contentType);
      const versionedUrl = buildEventImageUrl(newEvent.id, Date.now());
      await db.update(events).set({ image: versionedUrl }).where(eq(events.id, newEvent.id));
      newEvent.image = versionedUrl;
    }
    // Malformed data: URI (shouldn't happen from the cropper) — leave the
    // event with no image rather than fail the whole create.
  }

  return NextResponse.json(newEvent, { status: 201 });
}
