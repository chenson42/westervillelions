import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { plasticDropoffLocations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const MAX_NAME = 200;
const MAX_ADDRESS = 400;
const MAX_PHONE = 30;
const MAX_ENTRY_INSTRUCTIONS = 500;
const MAX_HOURS = 200;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const existing = await db.query.plasticDropoffLocations.findFirst({
      where: eq(plasticDropoffLocations.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (trimmed.length > MAX_NAME) {
        return NextResponse.json({ error: `Name must be ${MAX_NAME} characters or fewer` }, { status: 400 });
      }
      updateFields.name = trimmed;
    }
    if (data.address !== undefined) {
      const trimmed = data.address.trim();
      if (trimmed.length > MAX_ADDRESS) {
        return NextResponse.json({ error: `Address must be ${MAX_ADDRESS} characters or fewer` }, { status: 400 });
      }
      updateFields.address = trimmed;
    }
    if (data.phone !== undefined) {
      const trimmed = typeof data.phone === "string" ? data.phone.trim() : "";
      if (trimmed && trimmed.length > MAX_PHONE) {
        return NextResponse.json({ error: `Phone must be ${MAX_PHONE} characters or fewer` }, { status: 400 });
      }
      updateFields.phone = trimmed || null;
    }
    if (data.entryInstructions !== undefined) {
      const trimmed = typeof data.entryInstructions === "string" ? data.entryInstructions.trim() : "";
      if (trimmed && trimmed.length > MAX_ENTRY_INSTRUCTIONS) {
        return NextResponse.json({ error: `Entry instructions must be ${MAX_ENTRY_INSTRUCTIONS} characters or fewer` }, { status: 400 });
      }
      updateFields.entryInstructions = trimmed || null;
    }
    if (data.hours !== undefined) {
      const trimmed = typeof data.hours === "string" ? data.hours.trim() : "";
      if (trimmed && trimmed.length > MAX_HOURS) {
        return NextResponse.json({ error: `Hours must be ${MAX_HOURS} characters or fewer` }, { status: 400 });
      }
      updateFields.hours = trimmed || null;
    }
    if (typeof data.isActive === "boolean") updateFields.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateFields.sortOrder = Number(data.sortOrder);

    const [updated] = await db
      .update(plasticDropoffLocations)
      .set(updateFields)
      .where(eq(plasticDropoffLocations.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating plastic drop-off location:", error);
    return NextResponse.json({ error: "Failed to update location" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.plasticDropoffLocations.findFirst({
      where: eq(plasticDropoffLocations.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    await db.delete(plasticDropoffLocations).where(eq(plasticDropoffLocations.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting plastic drop-off location:", error);
    return NextResponse.json({ error: "Failed to delete location" }, { status: 500 });
  }
}
