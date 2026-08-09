/**
 * POST /api/admin/documents/[slug]/versions — create a new version.
 * GET  /api/admin/documents/[slug]/versions — full version chain, pending
 *   substantive versions included (this is the one place pending versions
 *   are ever listed over HTTP — the caller is documents.manage-gated).
 * Gate: documents.manage.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "API
 * Contract".
 *
 * POST body: { changeType: 'editorial' | 'substantive', bodyMarkdown: string,
 *   changeNote: string }. authorUserId is always session.user.id, never
 *   client-supplied. An 'editorial' save flips the document's current
 *   version immediately; a 'substantive' save stays pending until a
 *   separate adopt action (PATCH .../versions/[versionId]).
 *
 * Responses: 201 { id, versionNumber, changeType, isCurrent } on create; 200
 * { versions: DocumentVersionSummary[] } on list; 400 validation; 401
 * unauthenticated; 403 forbidden; 404 unknown slug.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isValidChangeType } from "@/lib/documents";
import { getDocumentBySlug, listVersionsForAdmin, createDocumentVersion } from "@/lib/documents-queries";

// Generous ceiling, not a real content limit — the seeded by-laws are ~30K
// characters; this just catches a fat-fingered/garbage payload.
const BODY_MARKDOWN_MAX_LEN = 500_000;
const CHANGE_NOTE_MAX_LEN = 2_000;

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await params;
    const document = await getDocumentBySlug(slug);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const body = await request.json();

    const changeType = body?.changeType;
    if (typeof changeType !== "string" || !isValidChangeType(changeType)) {
      return NextResponse.json({ error: "changeType must be 'editorial' or 'substantive'" }, { status: 400 });
    }

    const bodyMarkdown = body?.bodyMarkdown;
    if (typeof bodyMarkdown !== "string" || !bodyMarkdown.trim()) {
      return NextResponse.json({ error: "bodyMarkdown is required" }, { status: 400 });
    }
    if (bodyMarkdown.length > BODY_MARKDOWN_MAX_LEN) {
      return NextResponse.json(
        { error: `bodyMarkdown must be ${BODY_MARKDOWN_MAX_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const changeNote = body?.changeNote;
    if (typeof changeNote !== "string" || !changeNote.trim()) {
      return NextResponse.json({ error: "changeNote is required" }, { status: 400 });
    }
    if (changeNote.length > CHANGE_NOTE_MAX_LEN) {
      return NextResponse.json(
        { error: `changeNote must be ${CHANGE_NOTE_MAX_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const result = await createDocumentVersion({
      documentId: document.id,
      changeType,
      bodyMarkdown,
      changeNote: changeNote.trim().slice(0, CHANGE_NOTE_MAX_LEN),
      authorUserId: session.user.id,
    });

    return NextResponse.json(
      { id: result.id, versionNumber: result.versionNumber, changeType: result.changeType, isCurrent: result.isCurrent },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating document version:", error);
    return NextResponse.json({ error: "Failed to create document version" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { slug } = await params;
    const document = await getDocumentBySlug(slug);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const versions = await listVersionsForAdmin(document.id);
    return NextResponse.json({ versions });
  } catch (error) {
    console.error("Error listing document versions:", error);
    return NextResponse.json({ error: "Failed to list document versions" }, { status: 500 });
  }
}
