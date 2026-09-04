/**
 * PATCH /api/members/social-requests/[id] — autosave / manual edit / explicit
 * save.
 *
 * Gate: ownership (requesterUserId === session.user.id) — 404, not 403, on
 * mismatch (enumeration resistance: a non-owner requesting another member's
 * request id gets the same not-found response whether the id exists or not).
 *
 * Allowed only while isSocialRequestEditableByRequester(status) ('draft' or
 * 'submitted'); locked once a board member advances it to 'under_review' or
 * beyond — 409 with a plain message.
 *
 * Body: partial field merge (see parseSocialRequestBody() in
 * @/lib/social-requests for the full field list). `status` is never
 * accepted here — stripped/rejected server-side, not merely unused by the
 * client.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "API Contract" #2, #4.
 *
 * Response 200: { socialRequest }
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DELETE /api/members/social-requests/[id] — discard a draft.
 *
 * Gate: ownership, 404-not-403 rule.
 * 409 if status !== 'draft'. Hard DELETE (cascades to
 * social_request_decisions, always empty for a draft — no decision row
 * exists until submit).
 *
 * Response 204 (no body)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseSocialRequestBody, isSocialRequestEditableByRequester } from "@/lib/social-requests";
import { getOwnedSocialRequest, updateSocialRequest, discardDraftSocialRequest } from "@/lib/social-requests-queries";

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json({ error: "Member account required" }, { status: 403 });
    }

    const { id } = await params;
    const socialRequest = await getOwnedSocialRequest(id, session.user.id);
    if (!socialRequest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isSocialRequestEditableByRequester(socialRequest.status)) {
      return NextResponse.json(
        { error: "This request is locked for review and can no longer be edited" },
        { status: 409 },
      );
    }

    const rawBody = await request.json().catch(() => ({}));
    const { fields, error } = parseSocialRequestBody(rawBody);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const updated = await updateSocialRequest(id, fields);
    if (!updated) {
      // Race: locked by a board decision between the read above and this write.
      return NextResponse.json(
        { error: "This request is locked for review and can no longer be edited" },
        { status: 409 },
      );
    }

    return NextResponse.json({ socialRequest: updated });
  } catch (error) {
    console.error("Error updating social request:", error);
    return NextResponse.json({ error: "Failed to update social media post request" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE (discard draft)
// ---------------------------------------------------------------------------

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json({ error: "Member account required" }, { status: 403 });
    }

    const { id } = await params;
    const socialRequest = await getOwnedSocialRequest(id, session.user.id);
    if (!socialRequest) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (socialRequest.status !== "draft") {
      return NextResponse.json({ error: "Only a draft can be discarded" }, { status: 409 });
    }

    const deleted = await discardDraftSocialRequest(id);
    if (!deleted) {
      return NextResponse.json({ error: "Only a draft can be discarded" }, { status: 409 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error discarding social request draft:", error);
    return NextResponse.json({ error: "Failed to discard social media post request" }, { status: 500 });
  }
}
