import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { glassesDropoffLocations } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

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
      .from(glassesDropoffLocations)
      .orderBy(asc(glassesDropoffLocations.sortOrder), asc(glassesDropoffLocations.createdAt));

    return NextResponse.json({ locations });
  } catch (error) {
    console.error("Error fetching glasses drop-off locations:", error);
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

    const phone = typeof data.phone === "string" ? data.phone.trim() : "";

    const [location] = await db
      .insert(glassesDropoffLocations)
      .values({
        name: data.name.trim(),
        address: data.address.trim(),
        phone: phone || null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error("Error creating glasses drop-off location:", error);
    return NextResponse.json({ error: "Failed to create location" }, { status: 500 });
  }
}
