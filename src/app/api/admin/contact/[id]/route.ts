import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { contactSubmissions } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const canView = await hasFeature(session.user.id, FEATURES.CONTACT_VIEW);
    if (!canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const { isRead } = await request.json();

    await db
      .update(contactSubmissions)
      .set({ isRead })
      .where(eq(contactSubmissions.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating contact submission:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
