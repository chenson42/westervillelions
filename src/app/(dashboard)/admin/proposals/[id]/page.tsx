import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, minutes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getProposalById, listDecisionsForProposal } from "@/lib/proposals-queries";
import { listMinutesForAdmin } from "@/lib/minutes-queries";
import { minutesKindLabel } from "@/lib/minutes";
import { ProposalStatusBadge, ProposalStatusTimeline, type ProposalTimelineRow } from "@/components/members/proposal-status-timeline";
import { ProposalDecisionPanel } from "@/components/admin/proposals/proposal-decision-panel";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string | null): string {
  if (!d) return "Not specified";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function typeLabel(type: string | null): string {
  if (type === "fundraiser") return "Fundraiser";
  if (type === "service_project") return "Service Project";
  if (type === "both") return "Both";
  return "Not specified";
}

function moneyAnswerText(moneyNeeded: string | null, costCents: number | null, costUnknown: boolean): string {
  if (moneyNeeded === "yes") {
    if (costUnknown) return "Yes — amount not yet known";
    if (costCents !== null) return `Yes — estimated $${(costCents / 100).toFixed(2)}`;
    return "Yes";
  }
  if (moneyNeeded === "no") return "No";
  if (moneyNeeded === "not_sure") return "Not sure";
  return "Not answered";
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <span className="text-sm font-semibold text-gray-700 sm:col-span-1">{label}</span>
      <span className="text-sm text-gray-700 whitespace-pre-wrap sm:col-span-2">{children}</span>
    </div>
  );
}

/**
 * Board review detail + decide. Independent page-level gate — required by
 * src/lib/admin-page-feature-gates.test.ts, matching admin/minutes/new's
 * pattern exactly. 404s on a still-draft proposal (defense in depth — a
 * draft is never board-visible, even by guessed id; see Phase 3 Edge Cases).
 */
export default async function AdminProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW))) redirect("/access-pending");

  const { id } = await params;
  const proposal = await getProposalById(id, { viewerUserId: null, viewerHasReviewAccess: true });
  if (!proposal || proposal.status === "draft") notFound();

  const [decisions, minutesRows] = await Promise.all([
    listDecisionsForProposal(id),
    listMinutesForAdmin({ kind: "board" }),
  ]);

  const minutesOptions = minutesRows.map((m) => ({
    id: m.id,
    label: `${minutesKindLabel(m.kind)} minutes — ${m.meetingDate}${m.status === "draft" ? " (draft)" : ""}`,
  }));

  const deciderIds = Array.from(new Set(decisions.map((d) => d.decidedByUserId).filter((v): v is string => !!v)));
  const deciderRows =
    deciderIds.length > 0
      ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, deciderIds))
      : [];
  const deciderById = new Map(deciderRows.map((u) => [u.id, u.name ?? u.email]));

  const citedMinutesIds = Array.from(
    new Set(decisions.map((d) => d.citingMinutesId).filter((v): v is string => !!v)),
  );
  const citedMinutesRows =
    citedMinutesIds.length > 0
      ? await db
          .select({ id: minutes.id, kind: minutes.kind, meetingDate: minutes.meetingDate })
          .from(minutes)
          .where(inArray(minutes.id, citedMinutesIds))
      : [];
  const citedMinutesById = new Map(citedMinutesRows.map((m) => [m.id, m]));

  const timelineRows: ProposalTimelineRow[] = decisions.map((d) => {
    const cited = d.citingMinutesId ? citedMinutesById.get(d.citingMinutesId) : null;
    return {
      id: d.id,
      status: d.status,
      decidedByName: d.decidedByUserId ? deciderById.get(d.decidedByUserId) ?? null : null,
      decidedAt: d.decidedAt,
      meetingDate: d.meetingDate,
      note: d.note,
      citingMinutes: cited
        ? { label: `${minutesKindLabel(cited.kind)} minutes — ${cited.meetingDate}`, href: `/admin/minutes/${cited.id}` }
        : null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/proposals"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Proposals
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{proposal.projectName?.trim() || "Untitled proposal"}</h1>
          <ProposalStatusBadge status={proposal.status} />
        </div>
        {proposal.proposerNameSnapshot && (
          <p className="mt-1 text-gray-600">
            Proposed by {proposal.proposerNameSnapshot}
            {proposal.proposerEmailSnapshot ? ` — ${proposal.proposerEmailSnapshot}` : ""}
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
        <DetailRow label="Type">{typeLabel(proposal.type)}</DetailRow>
        <DetailRow label="Need / impact">{proposal.needDescription || "—"}</DetailRow>
        <DetailRow label="Chairperson">{proposal.chairName || "—"}</DetailRow>
        <DetailRow label="Money needed from the club">
          {moneyAnswerText(proposal.moneyNeeded, proposal.estimatedCostCents, proposal.estimatedCostUnknown)}
        </DetailRow>
        <DetailRow label="Estimated income">
          {proposal.estimatedIncomeUnknown
            ? "Not sure yet"
            : proposal.estimatedIncomeCents !== null
              ? `$${(proposal.estimatedIncomeCents / 100).toFixed(2)}`
              : "Not specified"}
        </DetailRow>
        <DetailRow label="When">{proposal.proposedDateUnknown ? "Not sure yet" : formatDate(proposal.proposedDate)}</DetailRow>
        <DetailRow label="Volunteers needed">
          {proposal.volunteersNeededUnknown
            ? "Not sure yet"
            : proposal.volunteersNeeded !== null
              ? String(proposal.volunteersNeeded)
              : "Not specified"}
        </DetailRow>
        <DetailRow label="Needed from the club">{proposal.clubResourcesNeeded || "—"}</DetailRow>
        <DetailRow label="Publicity">{proposal.publicityPlan || "—"}</DetailRow>
        <DetailRow label="Additional notes">{proposal.additionalNotes || "—"}</DetailRow>
        <DetailRow label="Submitted">{formatDate(proposal.submittedAt)}</DetailRow>
      </div>

      <ProposalDecisionPanel
        proposalId={proposal.id}
        currentStatus={proposal.status}
        currentChairName={proposal.chairName}
        minutesOptions={minutesOptions}
        decisions={decisions.map((d) => ({ id: d.id, status: d.status, citingMinutesId: d.citingMinutesId, meetingDate: d.meetingDate }))}
      />

      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">Status History</h2>
        <ProposalStatusTimeline rows={timelineRows} />
      </div>
    </div>
  );
}
