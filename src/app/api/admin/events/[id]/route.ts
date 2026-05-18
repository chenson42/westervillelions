import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";

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
  } = body;

  const recurring = isRecurring ?? existing.isRecurring;

  const [updated] = await db
    .update(events)
    .set({
      title,
      description: description || null,
      // Pass wall-clock strings directly — no new Date() wrapping. See DECISION-005.
      startDate: startDate || existing.startDate,
      endDate: endDate || null,
      location: location || null,
      image: image || null,
      isPublic: isPublic ?? existing.isPublic,
      isFeatured: isFeatured ?? existing.isFeatured,
      requiresRsvp: requiresRsvp ?? existing.requiresRsvp,
      allowGuestCount: allowGuestCount ?? existing.allowGuestCount,
      maxAttendees: maxAttendees || null,
      isAllDay: isAllDay ?? existing.isAllDay,
      isRecurring: recurring,
      recurrenceType: recurring ? (recurrenceType || null) : null,
      recurrenceDays: recurring ? (recurrenceDays || null) : null,
      recurrenceEndDate: recurring && recurrenceEndDate ? recurrenceEndDate : null,
      extraQuestion: extraQuestion || null,
      extraQuestionType: extraQuestion ? (extraQuestionType === "select" ? "select" : "text") : "text",
      extraQuestionOptions: Array.isArray(extraQuestionOptions) ? extraQuestionOptions.filter((s) => typeof s === "string" && s.length > 0) : [],
      extraQuestionRequired: Boolean(extraQuestion) && Boolean(extraQuestionRequired),
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();

  return NextResponse.json(updated);
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
