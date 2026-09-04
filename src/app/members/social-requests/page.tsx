import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listMySocialRequests } from "@/lib/social-requests-queries";
import { socialRequestSubjectLine } from "@/lib/social-requests";
import { SocialRequestStatusBadge } from "@/components/members/social-request-status";
import type { SocialRequest } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Member portal list — "My Social Media Requests". Mirrors
 * `members/proposals/page.tsx` exactly: Account Not Linked empty state,
 * drafts/in-review/decided grouping (decided = posted/declined/deferred),
 * "You haven't submitted a request yet" empty state.
 */
export default async function MemberSocialRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
            <h1 className="text-3xl font-bold mb-1">My Social Media Requests</h1>
            <p className="text-blue-100 max-w-2xl">
              Ask the board to post something to the club&rsquo;s social media accounts — Facebook, Instagram, and
              more.
            </p>
          </div>
          {memberId && (
            <Link
              href="/members/social-requests/new"
              className="inline-flex items-center justify-center gap-2 self-start bg-lions-gold text-lions-blue-dark px-6 py-3 rounded-lg font-semibold hover:brightness-95 transition shadow-md focus:outline-none focus:ring-2 focus:ring-white min-h-[44px] sm:self-auto"
            >
              <span aria-hidden="true">+</span>
              <span>Request a Post</span>
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
            <div className="text-4xl mb-4" aria-hidden="true">📣</div>
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked before requesting a social media post.
            </p>
          </div>
        ) : (
          <MemberSocialRequestsList userId={session.user.id} />
        )}
      </div>
    </div>
  );
}

function SocialRequestRow({ request }: { request: SocialRequest }) {
  return (
    <li>
      <Link
        href={`/members/social-requests/${request.id}`}
        className="block px-6 py-4 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-inset"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-base font-semibold text-gray-900">{socialRequestSubjectLine(request.postCopy)}</p>
          <SocialRequestStatusBadge status={request.status} />
        </div>
        <p className="mt-1 text-sm text-gray-400">
          {request.status === "draft"
            ? `Last saved ${formatDate(request.updatedAt)}`
            : `Submitted ${request.submittedAt ? formatDate(request.submittedAt) : "—"}`}
        </p>
      </Link>
    </li>
  );
}

async function MemberSocialRequestsList({ userId }: { userId: string }) {
  const requests = await listMySocialRequests(userId);

  if (requests.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="font-medium">You haven&rsquo;t submitted a request yet.</p>
        <p className="mt-1 text-sm">
          Click{" "}
          <Link href="/members/social-requests/new" className="text-lions-blue hover:underline font-semibold">
            Request a Post
          </Link>{" "}
          above to ask the board to share something on the club&rsquo;s social media.
        </p>
      </div>
    );
  }

  const drafts = requests.filter((r) => r.status === "draft");
  const inReview = requests.filter((r) => r.status === "submitted" || r.status === "under_review");
  const decided = requests.filter((r) => ["posted", "declined", "deferred"].includes(r.status));

  return (
    <div className="space-y-8">
      {drafts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Drafts</h2>
            <p className="text-sm text-gray-500 mt-0.5">Saved but not yet submitted to the board.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {drafts.map((r) => (
              <SocialRequestRow key={r.id} request={r} />
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
            {inReview.map((r) => (
              <SocialRequestRow key={r.id} request={r} />
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
            {decided.map((r) => (
              <SocialRequestRow key={r.id} request={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
