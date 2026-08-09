/**
 * GET /api/admin/documents/[slug]/versions/[versionId]/diff?against=<versionId|current>
 * Gate: documents.manage. This is the one diff caller allowed to target a
 * pending (not-yet-adopted) version — the member-facing compare page
 * (src/app/members/records/documents/[slug]/compare/page.tsx, ux-developer)
 * never calls anything with allowPending: true.
 *
 * `versionId` (the path param) is the "base"; `against` (the query param) is
 * either another version's id, or the literal string "current" to diff
 * against the document's live current version. Computes
 * diffDocumentVersions() server-side (src/lib/documents.ts) — diff never
 * ships to any client bundle (DECISION-076 Ruling 2/4).
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "API
 * Contract" / "Diffing".
 *
 * Response: 200 { base: {id, versionNumber}, compare: {id, versionNumber},
 * diff: Change[] }. 400 missing `against`; 401 unauthenticated; 403
 * forbidden; 404 unknown slug, base version, or comparison version (or a
 * version id that doesn't belong to this document).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { diffDocumentVersions } from "@/lib/documents";
import { getDocumentBySlug, getCurrentVersion, getVersionForCompare } from "@/lib/documents-queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { slug, versionId } = await params;
    const document = await getDocumentBySlug(slug);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const base = await getVersionForCompare(versionId, { allowPending: true });
    if (!base || base.documentId !== document.id) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const against = searchParams.get("against");
    if (!against) {
      return NextResponse.json({ error: "against query parameter is required" }, { status: 400 });
    }

    const compare =
      against === "current"
        ? await getCurrentVersion(document.id)
        : await getVersionForCompare(against, { allowPending: true });
    if (!compare || compare.documentId !== document.id) {
      return NextResponse.json({ error: "Comparison version not found" }, { status: 404 });
    }

    const diff = diffDocumentVersions(base.bodyMarkdown, compare.bodyMarkdown);

    return NextResponse.json({
      base: { id: base.id, versionNumber: base.versionNumber },
      compare: { id: compare.id, versionNumber: compare.versionNumber },
      diff,
    });
  } catch (error) {
    console.error("Error diffing document versions:", error);
    return NextResponse.json({ error: "Failed to diff document versions" }, { status: 500 });
  }
}
