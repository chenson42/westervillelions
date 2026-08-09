/**
 * PATCH /api/admin/proposals/[id]/decisions/[decisionId] — backfill citing
 * minutes and/or the deciding meeting date onto an existing decision row.
 *
 * Gate: PROPOSALS_REVIEW.
 *
 * Body: { citingMinutesId?: string | null, meetingDate?: string | null }
 * At least one of the two must be present in the body.
 *
 * Updates only the named fields on the proposal_decisions row (which must
 * belong to `id`, the proposal id in the URL). No email — this is a quiet
 * record-keeping update, same as documentVersions' citing-minutes backfill.
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "API Contract" #6,
 * carried forward by database-admin's Phase 4 (schema) note: Phase 3's API
 * Contract predates the `meetingDate` ruling, so this route accepts it
 * alongside `citingMinutesId` — both are "record something learned after the
 * fact about a decision" operations.
 *
 * Response 200: { decision }
 * Response 400: neither field present, or a malformed field
 * Response 404: decision not found for this proposal
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isValidDateString } from "@/lib/proposals";
import { backfillDecisionCitingMinutes } from "@/lib/proposals-queries";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; decisionId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, decisionId } = await params;
    const body = await request.json().catch(() => ({}));

    const hasCitingMinutes = body?.citingMinutesId !== undefined;
    const hasMeetingDate = body?.meetingDate !== undefined;
    if (!hasCitingMinutes && !hasMeetingDate) {
      return NextResponse.json(
        { error: "Provide citingMinutesId and/or meetingDate to update" },
        { status: 400 },
      );
    }

    let citingMinutesId: string | null | undefined;
    if (hasCitingMinutes) {
      if (body.citingMinutesId === null || body.citingMinutesId === "") {
        citingMinutesId = null;
      } else if (typeof body.citingMinutesId === "string") {
        citingMinutesId = body.citingMinutesId;
      } else {
        return NextResponse.json({ error: "citingMinutesId must be a string or null" }, { status: 400 });
      }
    }

    let meetingDate: string | null | undefined;
    if (hasMeetingDate) {
      if (body.meetingDate === null || body.meetingDate === "") {
        meetingDate = null;
      } else if (isValidDateString(body.meetingDate)) {
        meetingDate = body.meetingDate;
      } else {
        return NextResponse.json(
          { error: "meetingDate must be a valid date in YYYY-MM-DD format, or null" },
          { status: 400 },
        );
      }
    }

    const result = await backfillDecisionCitingMinutes({
      proposalId: id,
      decisionId,
      citingMinutesId,
      meetingDate,
    });

    if (!result.ok) {
      if (result.reason === "minutes_not_found") {
        return NextResponse.json({ error: "Cited minutes record not found" }, { status: 400 });
      }
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }

    return NextResponse.json({ decision: result.decision });
  } catch (error) {
    console.error("Error backfilling proposal decision:", error);
    return NextResponse.json({ error: "Failed to update decision" }, { status: 500 });
  }
}
