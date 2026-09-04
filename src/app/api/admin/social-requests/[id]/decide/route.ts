/**
 * POST /api/admin/social-requests/[id]/decide — board decision.
 *
 * Gate: SOCIAL_REQUESTS_REVIEW. 403 (not 404) on missing permission — this
 * is an authenticated-but-unauthorized case, not an existence-hiding one; a
 * request's existence isn't secret from other SOCIAL_REQUESTS_REVIEW
 * holders the way it is from the general membership.
 *
 * 404 if the request doesn't exist OR is still status='draft' (drafts are
 * never board-visible; defense in depth even though
 * listSubmittedSocialRequestsForReview() already excludes them).
 *
 * Body: { status: 'under_review'|'posted'|'declined'|'deferred', note?: string }
 * No citingMinutesId/meetingDate/chairName — this feature drops the
 * minutes-citation trio Proposals carries (see schema.ts doc comment).
 * `note` is also where a board member records *where/when* a request was
 * actually posted (a URL, a date) when marking it `posted` — no separate
 * column, free text either way.
 *
 * 409 if status === request.status (same-status-transition guard — no
 * duplicate decision row, no duplicate requester email). Any OTHER
 * transition is allowed, including revisiting a prior status
 * (deferred -> under_review -> deferred again) — status is not a one-way
 * terminal state.
 *
 * After commit: emails the requester (best-effort — never blocks or fails
 * the decision).
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "API Contract" #5.
 *
 * Response 200: { socialRequest, decision }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  isValidDecisionTargetStatus,
  socialRequestDecisionEmailSubject,
  socialRequestStatusLabel,
  socialRequestSubjectLine,
  DECISION_NOTE_MAX_LEN,
} from "@/lib/social-requests";
import { decideSocialRequest, resolveRequesterContactEmail } from "@/lib/social-requests-queries";
import { escapeHtml } from "@/lib/html-escape";
import { sendEmail } from "@/lib/email";
import type { SocialRequest, SocialRequestDecision } from "@/lib/db/schema";

function decisionEmailHtml(request: SocialRequest, decision: SocialRequestDecision, appUrl: string): string {
  // socialRequestStatusLabel(), never the raw enum — the raw value renders
  // as "under_review" (visible underscore) in the one sentence this email
  // exists to deliver.
  return `<p>There's an update on your social media post request, <strong>${escapeHtml(socialRequestSubjectLine(request.postCopy))}</strong>.</p>
<p><strong>New status:</strong> ${socialRequestStatusLabel(request.status)}</p>
${decision.note ? `<p><strong>Note from the board:</strong> ${escapeHtml(decision.note)}</p>` : ""}
<p>View the full details at <a href="${appUrl}/members/social-requests/${request.id}">${appUrl}/members/social-requests/${request.id}</a>.</p>`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const targetStatus = body?.status;
    if (typeof targetStatus !== "string" || !isValidDecisionTargetStatus(targetStatus)) {
      return NextResponse.json(
        { error: "status must be one of: under_review, posted, declined, deferred" },
        { status: 400 },
      );
    }

    let note: string | null = null;
    if (body?.note !== undefined && body?.note !== null) {
      if (typeof body.note !== "string") {
        return NextResponse.json({ error: "note must be a string" }, { status: 400 });
      }
      const trimmed = body.note.trim().slice(0, DECISION_NOTE_MAX_LEN);
      note = trimmed.length > 0 ? trimmed : null;
    }

    const result = await decideSocialRequest({
      id,
      targetStatus,
      decidedByUserId: session.user.id,
      note,
    });

    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "is_draft") {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      // reason === "no_op"
      return NextResponse.json({ error: "This request already has that status" }, { status: 409 });
    }

    const { socialRequest, decision } = result;

    // Best-effort requester notification — never blocks or fails the decision.
    try {
      const contactEmail = await resolveRequesterContactEmail(socialRequest);
      if (contactEmail) {
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
        const appUrl = process.env.NEXTAUTH_URL ?? "";
        await sendEmail({
          to: contactEmail,
          from: fromEmail,
          subject: socialRequestDecisionEmailSubject(socialRequestSubjectLine(socialRequest.postCopy), targetStatus),
          html: decisionEmailHtml(socialRequest, decision, appUrl),
        });
      }
    } catch (err) {
      console.error("Error sending social request decision email:", err);
    }

    return NextResponse.json({ socialRequest, decision });
  } catch (error) {
    console.error("Error deciding social request:", error);
    return NextResponse.json({ error: "Failed to record decision" }, { status: 500 });
  }
}
