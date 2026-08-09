/**
 * POST /api/admin/minutes/[id]/restore — clears pendingDeleteAt.
 * Gate: minutes.delete.
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 "API Contract".
 *
 * Responses: 200 { id } success; 401 unauthenticated; 403 forbidden; 404 not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { restoreMinutes } from "@/lib/minutes-queries";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_DELETE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const result = await restoreMinutes(id);
    if (!result) {
      return NextResponse.json({ error: "Minutes record not found" }, { status: 404 });
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error restoring minutes:", error);
    return NextResponse.json({ error: "Failed to restore minutes" }, { status: 500 });
  }
}
