/**
 * PATCH /api/members/proposals/[id] — autosave / manual edit / explicit
 * "Save Draft".
 *
 * Gate: ownership (proposerUserId === session.user.id) — 404, not 403, on
 * mismatch (enumeration resistance: a non-owner requesting another
 * member's proposal id gets the same not-found response whether the id
 * exists or not).
 *
 * Allowed only while isProposalEditableByProposer(status) ('draft' or
 * 'submitted'); locked once an admin advances it to 'under_review' or
 * beyond — 409 with a plain message.
 *
 * Body: partial field merge (see parseProposalBody() in @/lib/proposals for
 * the full field list). `status` is never accepted here — stripped/rejected
 * server-side, not merely unused by the client.
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" #2, #4.
 *
 * Response 200: { proposal }
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * DELETE /api/members/proposals/[id] — discard a draft (Gap B).
 *
 * Gate: ownership, 404-not-403 rule.
 * 409 if status !== 'draft'. Hard DELETE (cascades to proposal_decisions,
 * always empty for a draft — no decision row exists until submit).
 *
 * Response 204 (no body)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseProposalBody, isProposalEditableByProposer } from "@/lib/proposals";
import { getOwnedProposal, updateProposal, discardDraftProposal } from "@/lib/proposals-queries";

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
    const proposal = await getOwnedProposal(id, session.user.id);
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isProposalEditableByProposer(proposal.status)) {
      return NextResponse.json(
        { error: "This proposal is locked for review and can no longer be edited" },
        { status: 409 },
      );
    }

    const rawBody = await request.json().catch(() => ({}));
    const { fields, error } = parseProposalBody(rawBody, proposal);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const updated = await updateProposal(id, fields);
    if (!updated) {
      // Race: locked by a board decision between the read above and this write.
      return NextResponse.json(
        { error: "This proposal is locked for review and can no longer be edited" },
        { status: 409 },
      );
    }

    return NextResponse.json({ proposal: updated });
  } catch (error) {
    console.error("Error updating proposal:", error);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
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
    const proposal = await getOwnedProposal(id, session.user.id);
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (proposal.status !== "draft") {
      return NextResponse.json({ error: "Only a draft can be discarded" }, { status: 409 });
    }

    const deleted = await discardDraftProposal(id);
    if (!deleted) {
      return NextResponse.json({ error: "Only a draft can be discarded" }, { status: 409 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error discarding proposal draft:", error);
    return NextResponse.json({ error: "Failed to discard proposal" }, { status: 500 });
  }
}
