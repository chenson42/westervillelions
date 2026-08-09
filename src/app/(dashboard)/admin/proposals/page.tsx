import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listSubmittedProposalsForReview } from "@/lib/proposals-queries";
import { ProposalReviewTable, type ProposalReviewRow } from "@/components/admin/proposals/proposal-review-table";

export const dynamic = "force-dynamic";

/**
 * Board review inbox. Independent page-level gate (not just the derived
 * proxy rule) — src/lib/admin-page-feature-gates.test.ts fails the build
 * without this. Never lists drafts — listSubmittedProposalsForReview()
 * excludes them at the query layer.
 */
export default async function AdminProposalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW))) redirect("/access-pending");

  const proposals = await listSubmittedProposalsForReview();

  const rows: ProposalReviewRow[] = proposals.map((p) => ({
    id: p.id,
    projectName: p.projectName?.trim() || "Untitled proposal",
    type: p.type,
    chairName: p.chairName,
    status: p.status,
    submittedAt: p.submittedAt ? p.submittedAt.toISOString() : null,
    proposerName: p.proposerNameSnapshot,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Proposals</h1>
        <p className="mt-2 text-gray-600">
          Project and activity proposals submitted by members, for board review and decision.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No proposals submitted yet.</p>
          <p className="mt-1 text-sm">Submitted proposals will show up here for review.</p>
        </div>
      ) : (
        <ProposalReviewTable proposals={rows} />
      )}
    </div>
  );
}
