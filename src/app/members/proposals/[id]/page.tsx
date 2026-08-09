import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users, minutes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getProposalById, listDecisionsForProposal } from "@/lib/proposals-queries";
import { isProposalEditableByProposer, proposalStatusLabel } from "@/lib/proposals";
import { minutesKindLabel } from "@/lib/minutes";
import { ProposalForm, type ProposalFormInitial } from "@/components/members/proposal-form";
import {
  ProposalStatusBadge,
  ProposalStatusTimeline,
  type ProposalTimelineRow,
} from "@/components/members/proposal-status-timeline";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string | null): string {
  if (!d) return "Not specified";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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

export default async function MemberProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const proposal = await getProposalById(id, {
    viewerUserId: session.user.id,
    viewerHasReviewAccess: false,
  });
  if (!proposal) notFound();

  const editable = isProposalEditableByProposer(proposal.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">{proposal.projectName?.trim() || "Untitled proposal"}</h1>
          <div className="mt-2">
            <ProposalStatusBadge status={proposal.status} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <Link
          href="/members/proposals"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to My Proposals
        </Link>

        {editable ? (
          <EditableBody proposal={proposal} memberId={session.user.memberId ?? null} />
        ) : (
          <LockedBody proposal={proposal} />
        )}
      </div>
    </div>
  );
}

async function EditableBody({
  proposal,
  memberId,
}: {
  proposal: NonNullable<Awaited<ReturnType<typeof getProposalById>>>;
  memberId: string | null;
}) {
  const member = memberId ? await db.query.members.findFirst({ where: eq(members.id, memberId) }) : null;

  const initial: ProposalFormInitial = {
    id: proposal.id,
    status: proposal.status,
    projectName: proposal.projectName,
    type: proposal.type,
    needDescription: proposal.needDescription,
    chairName: proposal.chairName,
    moneyNeeded: proposal.moneyNeeded,
    estimatedCostCents: proposal.estimatedCostCents,
    estimatedCostUnknown: proposal.estimatedCostUnknown,
    estimatedIncomeCents: proposal.estimatedIncomeCents,
    estimatedIncomeUnknown: proposal.estimatedIncomeUnknown,
    proposedDate: proposal.proposedDate,
    proposedDateUnknown: proposal.proposedDateUnknown,
    volunteersNeeded: proposal.volunteersNeeded,
    volunteersNeededUnknown: proposal.volunteersNeededUnknown,
    clubResourcesNeeded: proposal.clubResourcesNeeded,
    publicityPlan: proposal.publicityPlan,
    additionalNotes: proposal.additionalNotes,
    submittedAt: proposal.submittedAt ? proposal.submittedAt.toISOString() : null,
  };

  return (
    <ProposalForm
      proposal={initial}
      proposerName={member ? `${member.firstName} ${member.lastName}`.trim() : proposal.proposerNameSnapshot ?? ""}
      proposerEmail={member?.email ?? proposal.proposerEmailSnapshot ?? ""}
      proposerPhone={member?.phone ?? proposal.proposerPhoneSnapshot ?? null}
    />
  );
}

async function LockedBody({
  proposal,
}: {
  proposal: NonNullable<Awaited<ReturnType<typeof getProposalById>>>;
}) {
  const decisions = await listDecisionsForProposal(proposal.id);

  const deciderIds = Array.from(new Set(decisions.map((d) => d.decidedByUserId).filter((v): v is string => !!v)));
  const minutesIds = Array.from(
    new Set(decisions.map((d) => d.citingMinutesId).filter((v): v is string => !!v)),
  );

  const [deciderRows, minutesRows] = await Promise.all([
    deciderIds.length > 0
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, deciderIds))
      : Promise.resolve([]),
    minutesIds.length > 0
      ? db
          .select({ id: minutes.id, kind: minutes.kind, meetingDate: minutes.meetingDate })
          .from(minutes)
          .where(inArray(minutes.id, minutesIds))
      : Promise.resolve([]),
  ]);
  const deciderById = new Map(deciderRows.map((u) => [u.id, u.name ?? u.email]));
  const minutesById = new Map(minutesRows.map((m) => [m.id, m]));

  const timelineRows: ProposalTimelineRow[] = decisions.map((d) => {
    const cited = d.citingMinutesId ? minutesById.get(d.citingMinutesId) : null;
    return {
      id: d.id,
      status: d.status,
      decidedByName: d.decidedByUserId ? deciderById.get(d.decidedByUserId) ?? null : null,
      decidedAt: d.decidedAt,
      meetingDate: d.meetingDate,
      note: d.note,
      citingMinutes: cited
        ? {
            label: `${minutesKindLabel(cited.kind)} minutes — ${cited.meetingDate}`,
            href: `/members/records/${cited.id}`,
          }
        : null,
    };
  });

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-800">
        This proposal is locked for review. It&rsquo;s currently{" "}
        <strong>{proposalStatusLabel(proposal.status)}</strong> — you&rsquo;ll be emailed when the status changes.
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4 text-base">
        <DetailRow label="Type">
          {proposal.type === "fundraiser" ? "Fundraiser" : proposal.type === "service_project" ? "Service Project" : proposal.type === "both" ? "Both" : "Not specified"}
        </DetailRow>
        <DetailRow label="Need / impact">{proposal.needDescription || "—"}</DetailRow>
        <DetailRow label="Chairperson">{proposal.chairName || "—"}</DetailRow>
        <DetailRow label="Money needed from the club">
          {moneyAnswerText(proposal.moneyNeeded, proposal.estimatedCostCents, proposal.estimatedCostUnknown)}
        </DetailRow>
        {(proposal.type === "fundraiser" || proposal.type === "both") && (
          <DetailRow label="Estimated income">
            {proposal.estimatedIncomeUnknown
              ? "Not sure yet"
              : proposal.estimatedIncomeCents !== null
                ? `$${(proposal.estimatedIncomeCents / 100).toFixed(2)}`
                : "Not specified"}
          </DetailRow>
        )}
        <DetailRow label="When">
          {proposal.proposedDateUnknown ? "Not sure yet" : formatDate(proposal.proposedDate)}
        </DetailRow>
        <DetailRow label="Volunteers needed">
          {proposal.volunteersNeededUnknown
            ? "Not sure yet"
            : proposal.volunteersNeeded !== null
              ? String(proposal.volunteersNeeded)
              : "Not specified"}
        </DetailRow>
        {proposal.clubResourcesNeeded && (
          <DetailRow label="Needed from the club">{proposal.clubResourcesNeeded}</DetailRow>
        )}
        {proposal.publicityPlan && <DetailRow label="Publicity">{proposal.publicityPlan}</DetailRow>}
        {proposal.additionalNotes && <DetailRow label="Additional notes">{proposal.additionalNotes}</DetailRow>}
        <DetailRow label="Submitted">{formatDate(proposal.submittedAt)}</DetailRow>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">Status History</h2>
        <ProposalStatusTimeline rows={timelineRows} />
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <span className="font-semibold text-gray-700 sm:col-span-1">{label}</span>
      <span className="text-gray-700 whitespace-pre-wrap sm:col-span-2">{children}</span>
    </div>
  );
}
