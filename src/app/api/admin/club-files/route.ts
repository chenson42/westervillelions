/**
 * GET /api/admin/club-files
 *
 * Lists every Club File for the admin list page, newest first, with each
 * row's attached-event count.
 *
 * Gate: club_files.manage
 *
 * Response 200: { files: AdminClubFileSummary[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listClubFilesForAdmin } from "@/lib/club-files-queries";

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const files = await listClubFilesForAdmin();
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error listing club files:", error);
    return NextResponse.json({ error: "Failed to list club files" }, { status: 500 });
  }
}
