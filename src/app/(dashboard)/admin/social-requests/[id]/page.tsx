import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getSocialRequestById, listDecisionsForSocialRequest } from "@/lib/social-requests-queries";
import { socialRequestStatusLabel, socialRequestPlatformLabel, socialRequestSubjectLine } from "@/lib/social-requests";
import {
  SocialRequestStatusBadge,
  SocialRequestStatusTimeline,
  type SocialRequestTimelineRow,
} from "@/components/members/social-request-status";
import { SocialRequestDecisionPanel } from "@/components/admin/social-requests/social-request-decision-panel";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string | null): string {
  if (!d) return "Not specified";
  // See member detail page's identical comment: plain `date` columns come
  // back as "YYYY-MM-DD"; force local-time parsing to avoid the off-by-one
  // day shift from UTC-midnight interpretation.
  const dt = typeof d === "string" ? new Date(d.length <= 10 ? `${d}T00:00:00` : d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
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
 * src/lib/admin-page-feature-gates.test.ts, matching admin/proposals/[id]'s
 * pattern exactly. 404s on a still-draft request (defense in depth — a
 * draft is never board-visible, even by guessed id; see Phase 3 Edge Cases).
 */
export default async function AdminSocialRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW))) redirect("/access-pending");

  const { id } = await params;
  const request = await getSocialRequestById(id, { viewerUserId: null, viewerHasReviewAccess: true });
  if (!request || request.status === "draft") notFound();

  const decisions = await listDecisionsForSocialRequest(id);

  const deciderIds = Array.from(new Set(decisions.map((d) => d.decidedByUserId).filter((v): v is string => !!v)));
  const deciderRows =
    deciderIds.length > 0
      ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, deciderIds))
      : [];
  const deciderById = new Map(deciderRows.map((u) => [u.id, u.name ?? u.email]));

  const timelineRows: SocialRequestTimelineRow[] = decisions.map((d) => ({
    id: d.id,
    status: d.status,
    decidedByName: d.decidedByUserId ? deciderById.get(d.decidedByUserId) ?? null : null,
    decidedAt: d.decidedAt,
    note: d.note,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/social-requests"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Social Requests
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{socialRequestSubjectLine(request.postCopy)}</h1>
          <SocialRequestStatusBadge status={request.status} />
        </div>
        {request.requesterNameSnapshot && (
          <p className="mt-1 text-gray-600">
            Requested by {request.requesterNameSnapshot}
            {request.requesterEmailSnapshot ? ` — ${request.requesterEmailSnapshot}` : ""}
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
        <DetailRow label="Platforms">
          {request.platforms.length > 0 ? request.platforms.map((p) => socialRequestPlatformLabel(p)).join(", ") : "—"}
        </DetailRow>
        <DetailRow label="Post copy">{request.postCopy || "—"}</DetailRow>
        {request.imageDataUri && (
          <DetailRow label="Image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={request.imageDataUri} alt="Attached image" className="max-h-64 rounded-lg border border-gray-200" />
          </DetailRow>
        )}
        {request.linkUrl && (
          <DetailRow label="Link">
            <a
              href={request.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              {request.linkUrl}
            </a>
          </DetailRow>
        )}
        <DetailRow label="Desired post date">
          {request.desiredPostDate ? formatDate(request.desiredPostDate) : "No preference"}
        </DetailRow>
        <DetailRow label="Notes">{request.notes || "—"}</DetailRow>
        <DetailRow label="Submitted">{formatDate(request.submittedAt)}</DetailRow>
      </div>

      <SocialRequestDecisionPanel requestId={request.id} currentStatus={request.status} />

      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">Status History</h2>
        <SocialRequestStatusTimeline rows={timelineRows} />
      </div>
    </div>
  );
}
