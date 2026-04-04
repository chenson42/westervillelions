import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { homepageAnnouncements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * POST /api/admin/announcements/reorder
 * Reorder announcements by setting sort_order = index for each id
 * Body: { orderedIds: string[] }
 */
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

    if (!Array.isArray(data.orderedIds) || data.orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds must be a non-empty array" },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < data.orderedIds.length; i++) {
        await tx
          .update(homepageAnnouncements)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(eq(homepageAnnouncements.id, data.orderedIds[i]));
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering announcements:", error);
    return NextResponse.json(
      { error: "Failed to reorder announcements" },
      { status: 500 }
    );
  }
}
