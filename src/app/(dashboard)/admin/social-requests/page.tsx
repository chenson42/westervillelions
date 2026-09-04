import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listSubmittedSocialRequestsForReview } from "@/lib/social-requests-queries";
import { socialRequestSubjectLine } from "@/lib/social-requests";
import {
  SocialRequestReviewTable,
  type SocialRequestReviewRow,
} from "@/components/admin/social-requests/social-request-review-table";

export const dynamic = "force-dynamic";

/**
 * Board review inbox. Independent page-level gate (not just the derived
 * proxy rule) — src/lib/admin-page-feature-gates.test.ts fails the build
 * without this. Never lists drafts — listSubmittedSocialRequestsForReview()
 * excludes them at the query layer.
 */
export default async function AdminSocialRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW))) redirect("/access-pending");

  const requests = await listSubmittedSocialRequestsForReview();

  const rows: SocialRequestReviewRow[] = requests.map((r) => ({
    id: r.id,
    subjectLine: socialRequestSubjectLine(r.postCopy),
    platforms: r.platforms,
    status: r.status,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    requesterName: r.requesterNameSnapshot,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Social Requests</h1>
        <p className="mt-2 text-gray-600">
          Member requests to post something to the club&rsquo;s social media accounts, for board review and
          decision.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">No requests submitted yet.</p>
          <p className="mt-1 text-sm">Submitted social media post requests will show up here for review.</p>
        </div>
      ) : (
        <SocialRequestReviewTable requests={rows} />
      )}
    </div>
  );
}
