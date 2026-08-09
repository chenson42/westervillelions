import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listMyProposals } from "@/lib/proposals-queries";
import { ProposalStatusBadge } from "@/components/members/proposal-status-timeline";
import type { Proposal } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function MemberProposalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
            <h1 className="text-3xl font-bold mb-1">My Proposals</h1>
            <p className="text-blue-100 max-w-2xl">
              Propose a project or activity for the board to consider — replaces the paper form that
              used to get handed to a board member at a meeting.
            </p>
          </div>
          {memberId && (
            <Link
              href="/members/proposals/new"
              className="inline-flex items-center justify-center gap-2 self-start bg-lions-gold text-lions-blue-dark px-6 py-3 rounded-lg font-semibold hover:brightness-95 transition shadow-md focus:outline-none focus:ring-2 focus:ring-white min-h-[44px] sm:self-auto"
            >
              <span aria-hidden="true">+</span>
              <span>Start a Proposal</span>
            </Link>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <div className="text-4xl mb-4" aria-hidden="true">🗂️</div>
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked before proposing a project or activity.
            </p>
          </div>
        ) : (
          <MemberProposalsList userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

function ProposalRow({ proposal }: { proposal: Proposal }) {
  return (
    <li>
      <Link
        href={`/members/proposals/${proposal.id}`}
        className="block px-6 py-4 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-inset"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-base font-semibold text-gray-900">
            {proposal.projectName?.trim() || "Untitled proposal"}
          </p>
          <ProposalStatusBadge status={proposal.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {proposal.status === "draft"
            ? `Last saved ${formatDate(proposal.updatedAt)}`
            : `Submitted ${proposal.submittedAt ? formatDate(proposal.submittedAt) : "—"}`}
        </p>
      </Link>
    </li>
  );
}

async function MemberProposalsList({ userId }: { userId: string }) {
  const proposals = await listMyProposals(userId);

  if (proposals.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="font-medium">You haven&rsquo;t proposed a project yet.</p>
        <p className="mt-1 text-sm">
          Click{" "}
          <Link href="/members/proposals/new" className="text-lions-blue hover:underline font-semibold">
            Start a Proposal
          </Link>{" "}
          above to get your idea in front of the board.
        </p>
      </div>
    );
  }

  const drafts = proposals.filter((p) => p.status === "draft");
  const inReview = proposals.filter((p) => p.status === "submitted" || p.status === "under_review");
  const decided = proposals.filter((p) =>
    ["approved", "declined", "deferred"].includes(p.status),
  );

  return (
    <div className="space-y-8">
      {drafts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Drafts</h2>
            <p className="text-sm text-gray-500 mt-0.5">Saved but not yet submitted to the board.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {drafts.map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
          </ul>
        </div>
      )}

      {inReview.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Submitted &amp; In Review</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {inReview.map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
          </ul>
        </div>
      )}

      {decided.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Decided</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {decided.map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
