import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { syncClubMembersList } from "@/lib/google-groups";

/**
 * POST /api/admin/members/sync-club
 * Manually trigger a sync of all active members to club@westervillelions.org
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canEdit = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await syncClubMembersList();
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    console.error("Error syncing club members list:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}
