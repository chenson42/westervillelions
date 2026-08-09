/**
 * PATCH /api/admin/documents/[slug]/versions/[versionId] — action-body
 * convention (mirrors src/app/api/admin/minutes/[id]/route.ts's PATCH).
 * Gate: documents.manage.
 *
 *   adopt: { action: 'adopt', adoptionNote: string, citingMinutesId?: string | null }
 *     Requires the version to belong to this document, be
 *     changeType='substantive', and not already adopted — else 409.
 *     adoptionNote is required non-empty (this is where Article XV / By-Law
 *     Five compliance gets recorded — "recorded, not enforced"). Sets
 *     adoptedByUserId=session.user.id, adoptedAt=now(), adoptionNote,
 *     optionally citingMinutesId if already known; flips
 *     documents.currentVersionId to this version — one transaction
 *     (adoptVersion() in documents-queries.ts).
 *
 *   link-minutes: { action: 'link-minutes', citingMinutesId: string }
 *     Requires the version to already be adopted, else 409 ("Adopt this
 *     version before citing minutes"). Validates citingMinutesId resolves to
 *     an existing minutes row (any status — reopened minutes are still a
 *     valid citation target). Never touches currentVersionId.
 *
 * No action ever edits bodyMarkdown/changeType/changeNote — versions are
 * immutable by construction, not just by convention. There is no DELETE on
 * this route: versions are permanent, no delete path exists anywhere in
 * this design.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "API
 * Contract".
 *
 * Responses: 200 { id } success; 400 validation; 401 unauthenticated; 403
 * forbidden; 404 unknown slug/version; 409 state conflict.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getDocumentBySlug, getVersionForCompare, adoptVersion, linkCitingMinutes } from "@/lib/documents-queries";

const ADOPTION_NOTE_MAX_LEN = 2_000;

export async function PATCH(
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

    const body = await request.json();
    const action = body?.action;
    if (action !== "adopt" && action !== "link-minutes") {
      return NextResponse.json({ error: "action must be 'adopt' or 'link-minutes'" }, { status: 400 });
    }

    // Admin routes may target a pending version deliberately (that's the
    // whole point of 'adopt') — allowPending: true. Pre-fetch once, shared
    // by both actions' 409 checks below, so those checks happen BEFORE
    // adoptVersion()/linkCitingMinutes() is ever called.
    const version = await getVersionForCompare(versionId, { allowPending: true });
    if (!version || version.documentId !== document.id) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // ── adopt ──────────────────────────────────────────────────────────────
    if (action === "adopt") {
      if (version.changeType !== "substantive") {
        return NextResponse.json(
          {
            error:
              "Only substantive versions can be adopted — an editorial version is already current the moment it's saved",
          },
          { status: 409 },
        );
      }
      if (version.adoptedAt !== null) {
        return NextResponse.json({ error: "This version has already been adopted" }, { status: 409 });
      }

      const adoptionNote = body?.adoptionNote;
      if (typeof adoptionNote !== "string" || !adoptionNote.trim()) {
        return NextResponse.json({ error: "adoptionNote is required" }, { status: 400 });
      }
      if (adoptionNote.length > ADOPTION_NOTE_MAX_LEN) {
        return NextResponse.json(
          { error: `adoptionNote must be ${ADOPTION_NOTE_MAX_LEN} characters or fewer` },
          { status: 400 },
        );
      }

      let citingMinutesId: string | null = null;
      if (body?.citingMinutesId !== undefined && body?.citingMinutesId !== null && body?.citingMinutesId !== "") {
        if (typeof body.citingMinutesId !== "string") {
          return NextResponse.json({ error: "citingMinutesId must be a string or null" }, { status: 400 });
        }
        citingMinutesId = body.citingMinutesId;
      }

      const result = await adoptVersion({
        versionId,
        adoptedByUserId: session.user.id,
        adoptionNote: adoptionNote.trim().slice(0, ADOPTION_NOTE_MAX_LEN),
        citingMinutesId,
      });
      if (!result.ok) {
        return NextResponse.json({ error: "Unable to adopt this version" }, { status: 409 });
      }
      return NextResponse.json({ id: result.id });
    }

    // ── link-minutes ──────────────────────────────────────────────────────
    if (version.changeType !== "substantive" || version.adoptedAt === null) {
      return NextResponse.json({ error: "Adopt this version before citing minutes" }, { status: 409 });
    }

    const citingMinutesId = body?.citingMinutesId;
    if (typeof citingMinutesId !== "string" || !citingMinutesId.trim()) {
      return NextResponse.json({ error: "citingMinutesId is required" }, { status: 400 });
    }

    const result = await linkCitingMinutes(versionId, citingMinutesId.trim());
    if (!result.ok) {
      const notFound = result.reason === "minutes_not_found";
      return NextResponse.json(
        { error: notFound ? "Cited minutes record not found" : "Unable to link citing minutes" },
        { status: notFound ? 400 : 409 },
      );
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error updating document version:", error);
    return NextResponse.json({ error: "Failed to update document version" }, { status: 500 });
  }
}
