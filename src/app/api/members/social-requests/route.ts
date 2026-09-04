/**
 * POST /api/members/social-requests — create a new draft social media post
 * request.
 *
 * Gate: session.user.memberId (linked member; no FEATURES gate — any linked
 * member may request a post, matching the Proposals precedent).
 *
 * Body: {} or any subset of the request's optional/required field names —
 * the client's first autosave tick may already carry partial data.
 * `status`, `requesterMemberId`, and `requesterUserId` are never
 * client-writable; the server always forces status='draft' and stamps the
 * ids from the session.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "API Contract" #1.
 *
 * Response 201: { socialRequest }
 * Response 400: validation error (see parseSocialRequestBody())
 * Response 401: unauthenticated
 * Response 403: no linked member record
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseSocialRequestBody } from "@/lib/social-requests";
import { createDraftSocialRequest } from "@/lib/social-requests-queries";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json({ error: "Member account required" }, { status: 403 });
    }

    const rawBody = await request.json().catch(() => ({}));
    const { fields, error } = parseSocialRequestBody(rawBody);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const socialRequest = await createDraftSocialRequest({
      requesterUserId: session.user.id,
      requesterMemberId: session.user.memberId,
      fields,
    });

    return NextResponse.json({ socialRequest }, { status: 201 });
  } catch (error) {
    console.error("Error creating social request draft:", error);
    return NextResponse.json({ error: "Failed to create social media post request" }, { status: 500 });
  }
}
