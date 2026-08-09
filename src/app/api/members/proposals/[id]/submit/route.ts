/**
 * POST /api/members/proposals/[id]/submit — draft -> submitted.
 *
 * Gate: ownership (proposerUserId === session.user.id), 404-not-403 rule.
 *
 * 409 if status !== 'draft' (idempotency guard against a double-click/retry
 * re-emailing the board). 422 with a field-keyed error map on validation
 * failure — never a bare 400/500 — so the client can re-render the same
 * in-progress form with the entered data intact (Phase 1 Flow 1 failure note).
 *
 * On success: snapshots the proposer's name/email/phone, flips
 * status='submitted', writes the first proposalDecisions row
 * (status='submitted'), then — AFTER the DB transaction commits — emails
 * BOARD_EMAIL and the proposer's own address. A send failure never blocks
 * or fails the submission; the proposal is already saved.
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" #3,
 * "Email — full contract".
 *
 * Response 200: { proposal }
 * Response 404: not found / not owned
 * Response 409: already submitted (not in 'draft' status)
 * Response 422: { errors: { field: message } }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOwnedProposal, submitProposal } from "@/lib/proposals-queries";
import { escapeProposalHtml } from "@/lib/proposals";
import { sendEmail } from "@/lib/email";
import { BOARD_EMAIL } from "@/lib/club-contacts";
import type { Proposal } from "@/lib/db/schema";

function moneyAnswerText(proposal: Proposal): string {
  if (proposal.moneyNeeded === "yes") {
    if (proposal.estimatedCostUnknown) return "Yes — amount not yet known";
    if (proposal.estimatedCostCents !== null) return `Yes — estimated $${(proposal.estimatedCostCents / 100).toFixed(2)}`;
    return "Yes";
  }
  if (proposal.moneyNeeded === "no") return "No";
  if (proposal.moneyNeeded === "not_sure") return "Not sure";
  return "Not answered";
}

function dateAnswerText(proposal: Proposal): string {
  if (proposal.proposedDateUnknown) return "Not sure yet";
  if (proposal.proposedDate) return proposal.proposedDate;
  return "Not specified";
}

function typeLabel(type: string | null): string {
  if (type === "fundraiser") return "Fundraiser";
  if (type === "service_project") return "Service Project";
  if (type === "both") return "Both";
  return "Not specified";
}

function boardNotificationHtml(proposal: Proposal, appUrl: string): string {
  return `<p>A new project/activity proposal has been submitted for board review.</p>
<ul>
  <li><strong>Proposed by:</strong> ${escapeProposalHtml(proposal.proposerNameSnapshot ?? "Unknown")}</li>
  <li><strong>Project/activity name:</strong> ${escapeProposalHtml(proposal.projectName ?? "")}</li>
  <li><strong>Type:</strong> ${typeLabel(proposal.type)}</li>
  <li><strong>Need / impact:</strong> ${escapeProposalHtml(proposal.needDescription ?? "")}</li>
  <li><strong>Chairperson:</strong> ${escapeProposalHtml(proposal.chairName ?? "")}</li>
  <li><strong>Money needed from the club:</strong> ${moneyAnswerText(proposal)}</li>
  <li><strong>Proposed date:</strong> ${dateAnswerText(proposal)}</li>
</ul>
<p>Review this proposal at <a href="${appUrl}/admin/proposals/${proposal.id}">${appUrl}/admin/proposals/${proposal.id}</a>.</p>`;
}

function proposerConfirmationHtml(proposal: Proposal, appUrl: string): string {
  return `<p>Thanks for submitting your project or activity proposal, <strong>${escapeProposalHtml(proposal.projectName ?? "")}</strong>.</p>
<p>The board reviews proposals at its next meeting; we'll email you when there's an update.</p>
<p>You can check on your proposal any time at <a href="${appUrl}/members/proposals/${proposal.id}">${appUrl}/members/proposals/${proposal.id}</a>.</p>`;
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
    const owned = await getOwnedProposal(id, session.user.id);
    if (!owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await submitProposal(id);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (result.reason === "not_draft") {
        return NextResponse.json(
          { error: "This proposal has already been submitted" },
          { status: 409 },
        );
      }
      // reason === "validation"
      return NextResponse.json({ errors: result.errors }, { status: 422 });
    }

    const { proposal } = result;

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
    const appUrl = process.env.NEXTAUTH_URL ?? "";

    // Fire after commit, best-effort — never blocks or fails the submission.
    try {
      await sendEmail({
        to: BOARD_EMAIL,
        from: fromEmail,
        subject: `New Project/Activity Proposal: ${proposal.projectName}`,
        html: boardNotificationHtml(proposal, appUrl),
      });
    } catch (err) {
      console.error("Error sending proposal board notification email:", err);
    }

    if (proposal.proposerEmailSnapshot) {
      try {
        await sendEmail({
          to: proposal.proposerEmailSnapshot,
          from: fromEmail,
          subject: `We've received your proposal: ${proposal.projectName}`,
          html: proposerConfirmationHtml(proposal, appUrl),
        });
      } catch (err) {
        console.error("Error sending proposal confirmation email:", err);
      }
    }

    return NextResponse.json({ proposal });
  } catch (error) {
    console.error("Error submitting proposal:", error);
    return NextResponse.json({ error: "Failed to submit proposal" }, { status: 500 });
  }
}
