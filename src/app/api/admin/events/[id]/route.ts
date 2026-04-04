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
    maxAttendees,
    isRecurring,
    recurrenceType,
    recurrenceDays,
    recurrenceEndDate,
  } = body;

  const recurring = isRecurring ?? existing.isRecurring;

  const [updated] = await db
    .update(events)
    .set({
      title,
      description: description || null,
      startDate: startDate ? new Date(startDate) : existing.startDate,
      endDate: endDate ? new Date(endDate) : null,
      location: location || null,
      image: image || null,
      isPublic: isPublic ?? existing.isPublic,
      isFeatured: isFeatured ?? existing.isFeatured,
      requiresRsvp: requiresRsvp ?? existing.requiresRsvp,
      maxAttendees: maxAttendees || null,
      isRecurring: recurring,
      recurrenceType: recurring ? (recurrenceType || null) : null,
      recurrenceDays: recurring ? (recurrenceDays || null) : null,
      recurrenceEndDate: recurring && recurrenceEndDate ? new Date(recurrenceEndDate) : null,
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
