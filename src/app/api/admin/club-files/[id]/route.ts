/**
 * PATCH /api/admin/club-files/[id] — metadata-only edit.
 * DELETE /api/admin/club-files/[id] — deletes the row (cascades
 *   club_file_events) and its durable blob.
 *
 * Gate: club_files.manage
 *
 * PATCH body: { name?: string, description?: string | null, visibility?: 'public' | 'members-only' }
 * PATCH Response 200: { file }
 * DELETE Response 200: { deleted: true }
 *
 * 400 — invalid name/visibility
 * 404 — file not found
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  deleteClubFile,
  isValidClubFileVisibility,
  updateClubFileMetadata,
  type UpdateClubFileMetadataInput,
} from "@/lib/club-files-queries";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name, description, visibility } = (body ?? {}) as {
      name?: unknown;
      description?: unknown;
      visibility?: unknown;
    };

    const input: UpdateClubFileMetadataInput = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      input.name = name.trim();
    }
    if (description !== undefined) {
      if (description !== null && typeof description !== "string") {
        return NextResponse.json({ error: "description must be a string or null" }, { status: 400 });
      }
      input.description = description;
    }
    if (visibility !== undefined) {
      if (!isValidClubFileVisibility(visibility)) {
        return NextResponse.json(
          { error: "visibility must be 'public' or 'members-only'" },
          { status: 400 },
        );
      }
      input.visibility = visibility;
    }

    const updated = await updateClubFileMetadata(id, input);
    if (!updated) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ file: updated });
  } catch (error) {
    console.error("Error updating club file:", error);
    return NextResponse.json({ error: "Failed to update club file" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const deleted = await deleteClubFile(id);
    if (!deleted) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Error deleting club file:", error);
    return NextResponse.json({ error: "Failed to delete club file" }, { status: 500 });
  }
}
