/**
 * POST /api/members/social-requests/[id]/submit — draft -> submitted.
 *
 * Gate: ownership (requesterUserId === session.user.id), 404-not-403 rule.
 *
 * 409 if status !== 'draft' (idempotency guard against a double-click/retry
 * re-emailing the board). 422 with a field-keyed error map on validation
 * failure — never a bare 400/500 — so the client can re-render the same
 * in-progress form with the entered data intact.
 *
 * On success: snapshots the requester's name/email/phone, flips
 * status='submitted', writes the first social_request_decisions row
 * (status='submitted'), then — AFTER the DB transaction commits — emails
 * BOARD_EMAIL and (as a deliberate small spec extension, matching the
 * Proposals precedent) the requester's own address. A send failure never
 * blocks or fails the submission; the request is already saved. Per
 * CLAUDE.md's deny-by-default outbound-email invariant, a blocked/failed
 * send is caught here and only logged — it must never surface as a form
 * error to the member.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "API Contract" #4,
 * "Edge Cases & Risks".
 *
 * Response 200: { socialRequest }
 * Response 404: not found / not owned
 * Response 409: already submitted (not in 'draft' status)
 * Response 422: { errors: { field: message } }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedSocialRequest, submitSocialRequest } from "@/lib/social-requests-queries";
import { socialRequestPlatformLabel, socialRequestSubjectLine } from "@/lib/social-requests";
import { escapeHtml } from "@/lib/html-escape";
import { sendEmail } from "@/lib/email";
import { BOARD_EMAIL } from "@/lib/club-contacts";
import type { SocialRequest } from "@/lib/db/schema";

function platformsText(request: SocialRequest): string {
  if (!request.platforms || request.platforms.length === 0) return "Not specified";
  return request.platforms.map((p) => socialRequestPlatformLabel(p)).join(", ");
}

function dateAnswerText(request: SocialRequest): string {
  return request.desiredPostDate ?? "No preference";
}

function boardNotificationHtml(request: SocialRequest, appUrl: string): string {
  return `<p>A new social media post request has been submitted for board review.</p>
<ul>
  <li><strong>Requested by:</strong> ${escapeHtml(request.requesterNameSnapshot ?? "Unknown")}</li>
  <li><strong>Platform(s):</strong> ${escapeHtml(platformsText(request))}</li>
  <li><strong>Post copy:</strong> ${escapeHtml(request.postCopy ?? "")}</li>
  <li><strong>Desired post date:</strong> ${escapeHtml(dateAnswerText(request))}</li>
  ${request.linkUrl ? `<li><strong>Link:</strong> ${escapeHtml(request.linkUrl)}</li>` : ""}
  ${request.imageDataUri ? `<li><strong>Image:</strong> attached</li>` : ""}
  ${request.notes ? `<li><strong>Notes:</strong> ${escapeHtml(request.notes)}</li>` : ""}
</ul>
<p>Review this request at <a href="${appUrl}/admin/social-requests/${request.id}">${appUrl}/admin/social-requests/${request.id}</a>.</p>`;
}

function requesterConfirmationHtml(request: SocialRequest, appUrl: string): string {
  const subjectLine = socialRequestSubjectLine(request.postCopy);
  return `<p>Thanks for submitting your social media post request, <strong>${escapeHtml(subjectLine)}</strong>.</p>
<p>The board reviews requests as they come in; we'll email you when there's an update.</p>
<p>You can check on your request any time at <a href="${appUrl}/members/social-requests/${request.id}">${appUrl}/members/social-requests/${request.id}</a>.</p>`;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.memberId) {
      return NextResponse.json({ error: "Member account required" }, { status: 403 });
    }

    const { id } = await params;
    const owned = await getOwnedSocialRequest(id, session.user.id);
    if (!owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await submitSocialRequest(id);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (result.reason === "not_draft") {
        return NextResponse.json({ error: "This request has already been submitted" }, { status: 409 });
      }
      // reason === "validation"
      return NextResponse.json({ errors: result.errors }, { status: 422 });
    }

    const { socialRequest } = result;

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
    const appUrl = process.env.NEXTAUTH_URL ?? "";

    // Fire after commit, best-effort — never blocks or fails the submission.
    try {
      await sendEmail({
        to: BOARD_EMAIL,
        from: fromEmail,
        subject: `New Social Media Post Request: ${socialRequestSubjectLine(socialRequest.postCopy)}`,
        html: boardNotificationHtml(socialRequest, appUrl),
      });
    } catch (err) {
      console.error("Error sending social request board notification email:", err);
    }

    if (socialRequest.requesterEmailSnapshot) {
      try {
        await sendEmail({
          to: socialRequest.requesterEmailSnapshot,
          from: fromEmail,
          subject: `We've received your social media post request`,
          html: requesterConfirmationHtml(socialRequest, appUrl),
        });
      } catch (err) {
        console.error("Error sending social request confirmation email:", err);
      }
    }

    return NextResponse.json({ socialRequest });
  } catch (error) {
    console.error("Error submitting social request:", error);
    return NextResponse.json({ error: "Failed to submit social media post request" }, { status: 500 });
  }
}
