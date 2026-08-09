/**
 * POST /api/members/proposals — create a new draft proposal.
 *
 * Gate: session.user.memberId (linked member; no FEATURES gate — any linked
 * member, even one with zero granted roles, may propose an idea).
 *
 * Body: {} or any subset of the proposal's optional/required field names —
 * the client's first autosave tick may already carry partial data.
 * `status`, `proposerMemberId`, and `proposerUserId` are never
 * client-writable; the server always forces status='draft' and stamps the
 * ids from the session (state-machine-shortcut adversarial finding, Phase 1).
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" #1.
 *
 * Response 201: { proposal }
 * Response 400: validation error (see parseProposalBody())
 * Response 401: unauthenticated
 * Response 403: no linked member record
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseProposalBody } from "@/lib/proposals";
import { createDraftProposal } from "@/lib/proposals-queries";

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
    const { fields, error } = parseProposalBody(rawBody, null);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const proposal = await createDraftProposal({
      proposerUserId: session.user.id,
      proposerMemberId: session.user.memberId,
      fields,
    });

    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    console.error("Error creating proposal draft:", error);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
