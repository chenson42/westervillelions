/**
 * POST /api/admin/proposals/[id]/decide — board decision.
 *
 * Gate: PROPOSALS_REVIEW. 403 (not 404) on missing permission — this is an
 * authenticated-but-unauthorized case, not an existence-hiding one; a
 * proposal's existence isn't secret from other PROPOSALS_REVIEW holders the
 * way it is from the general membership.
 *
 * 404 if the proposal doesn't exist OR is still status='draft' (drafts are
 * never board-visible; defense in depth even though
 * listSubmittedProposalsForReview() already excludes them).
 *
 * Body: { status: 'under_review'|'approved'|'declined'|'deferred',
 *   note?: string, chairName?: string, citingMinutesId?: string,
 *   meetingDate?: string }
 *
 * 409 if status === proposal.status (same-status-transition guard — no
 * duplicate decision row, no duplicate proposer email). Any OTHER
 * transition is allowed, including revisiting a prior status
 * (deferred -> under_review -> deferred again) — status is not a one-way
 * terminal state.
 *
 * `chairName`, when supplied, is the one field a PROPOSALS_REVIEW holder
 * may edit directly (resolves "chair named after lock" — Phase 3 Edge Cases).
 * `citingMinutesId` / `meetingDate` may also be recorded at decision time,
 * or backfilled later via PATCH .../decisions/[decisionId].
 *
 * After commit: emails the proposer (best-effort — never blocks or fails
 * the decision).
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" #5,
 * carried forward by database-admin's Phase 4 (schema) note on `meetingDate`.
 *
 * Response 200: { proposal, decision }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  isValidDecisionTargetStatus,
  isValidDateString,
  proposalDecisionEmailSubject,
  proposalStatusLabel,
  escapeProposalHtml,
  CHAIR_NAME_MAX_LEN,
  DECISION_NOTE_MAX_LEN,
} from "@/lib/proposals";
import { decideProposal, resolveProposerContactEmail } from "@/lib/proposals-queries";
import { sendEmail } from "@/lib/email";
import type { Proposal, ProposalDecision } from "@/lib/db/schema";

function decisionEmailHtml(proposal: Proposal, decision: ProposalDecision, appUrl: string): string {
  // proposalStatusLabel(), never the raw enum — the raw value renders as
  // "under_review" (visible underscore) in the one sentence this email exists
  // to deliver.
  return `<p>There's an update on your proposal, <strong>${escapeProposalHtml(proposal.projectName ?? "")}</strong>.</p>
<p><strong>New status:</strong> ${proposalStatusLabel(proposal.status)}</p>
${decision.note ? `<p><strong>Note from the board:</strong> ${escapeProposalHtml(decision.note)}</p>` : ""}
<p>View the full details at <a href="${appUrl}/members/proposals/${proposal.id}">${appUrl}/members/proposals/${proposal.id}</a>.</p>`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const targetStatus = body?.status;
    if (typeof targetStatus !== "string" || !isValidDecisionTargetStatus(targetStatus)) {
      return NextResponse.json(
        { error: "status must be one of: under_review, approved, declined, deferred" },
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

    let chairName: string | null = null;
    if (body?.chairName !== undefined && body?.chairName !== null) {
      if (typeof body.chairName !== "string") {
        return NextResponse.json({ error: "chairName must be a string" }, { status: 400 });
      }
      const trimmed = body.chairName.trim().slice(0, CHAIR_NAME_MAX_LEN);
      chairName = trimmed.length > 0 ? trimmed : null;
    }

    let citingMinutesId: string | null = null;
    if (body?.citingMinutesId !== undefined && body?.citingMinutesId !== null && body?.citingMinutesId !== "") {
      if (typeof body.citingMinutesId !== "string") {
        return NextResponse.json({ error: "citingMinutesId must be a string or null" }, { status: 400 });
      }
      citingMinutesId = body.citingMinutesId;
    }

    let meetingDate: string | null = null;
    if (body?.meetingDate !== undefined && body?.meetingDate !== null && body?.meetingDate !== "") {
      if (!isValidDateString(body.meetingDate)) {
        return NextResponse.json(
          { error: "meetingDate must be a valid date in YYYY-MM-DD format, or omitted" },
          { status: 400 },
        );
      }
      meetingDate = body.meetingDate;
    }

    const result = await decideProposal({
      id,
      targetStatus,
      decidedByUserId: session.user.id,
      note,
      chairName,
      citingMinutesId,
      meetingDate,
    });

    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "is_draft") {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      // reason === "no_op"
      return NextResponse.json({ error: "This proposal already has that status" }, { status: 409 });
    }

    const { proposal, decision } = result;

    // Best-effort proposer notification — never blocks or fails the decision.
    try {
      const contactEmail = await resolveProposerContactEmail(proposal);
      if (contactEmail) {
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
        const appUrl = process.env.NEXTAUTH_URL ?? "";
        await sendEmail({
          to: contactEmail,
          from: fromEmail,
          subject: proposalDecisionEmailSubject(proposal.projectName ?? "your proposal", targetStatus),
          html: decisionEmailHtml(proposal, decision, appUrl),
        });
      }
    } catch (err) {
      console.error("Error sending proposal decision email:", err);
    }

    return NextResponse.json({ proposal, decision });
  } catch (error) {
    console.error("Error deciding proposal:", error);
    return NextResponse.json({ error: "Failed to record decision" }, { status: 500 });
  }
}
