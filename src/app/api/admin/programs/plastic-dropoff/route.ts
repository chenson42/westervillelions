import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { plasticDropoffLocations } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const MAX_NAME = 200;
const MAX_ADDRESS = 400;
const MAX_PHONE = 30;
const MAX_ENTRY_INSTRUCTIONS = 500;
const MAX_HOURS = 200;

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const locations = await db
      .select()
      .from(plasticDropoffLocations)
      .orderBy(asc(plasticDropoffLocations.sortOrder), asc(plasticDropoffLocations.createdAt));

    return NextResponse.json({ locations });
  } catch (error) {
    console.error("Error fetching plastic drop-off locations:", error);
    return NextResponse.json({ error: "Failed to fetch locations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    if (!data.name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!data.address?.trim()) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 });
    }
    if (data.name.trim().length > MAX_NAME) {
      return NextResponse.json({ error: `Name must be ${MAX_NAME} characters or fewer` }, { status: 400 });
    }
    if (data.address.trim().length > MAX_ADDRESS) {
      return NextResponse.json({ error: `Address must be ${MAX_ADDRESS} characters or fewer` }, { status: 400 });
    }

    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    if (phone && phone.length > MAX_PHONE) {
      return NextResponse.json({ error: `Phone must be ${MAX_PHONE} characters or fewer` }, { status: 400 });
    }

    const entryInstructions = typeof data.entryInstructions === "string" ? data.entryInstructions.trim() : "";
    if (entryInstructions && entryInstructions.length > MAX_ENTRY_INSTRUCTIONS) {
      return NextResponse.json({ error: `Entry instructions must be ${MAX_ENTRY_INSTRUCTIONS} characters or fewer` }, { status: 400 });
    }

    const hours = typeof data.hours === "string" ? data.hours.trim() : "";
    if (hours && hours.length > MAX_HOURS) {
      return NextResponse.json({ error: `Hours must be ${MAX_HOURS} characters or fewer` }, { status: 400 });
    }

    const [location] = await db
      .insert(plasticDropoffLocations)
      .values({
        name: data.name.trim(),
        address: data.address.trim(),
        phone: phone || null,
        entryInstructions: entryInstructions || null,
        hours: hours || null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error("Error creating plastic drop-off location:", error);
    return NextResponse.json({ error: "Failed to create location" }, { status: 500 });
  }
}
