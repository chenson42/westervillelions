import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSocialRequestById, listDecisionsForSocialRequest } from "@/lib/social-requests-queries";
import {
  isSocialRequestEditableByRequester,
  socialRequestStatusLabel,
  socialRequestPlatformLabel,
  socialRequestSubjectLine,
} from "@/lib/social-requests";
import { SocialRequestForm, type SocialRequestFormInitial } from "@/components/members/social-request-form";
import {
  SocialRequestStatusBadge,
  SocialRequestStatusTimeline,
  type SocialRequestTimelineRow,
} from "@/components/members/social-request-status";

export const dynamic = "force-dynamic";

function formatDate(d: Date | string | null): string {
  if (!d) return "Not specified";
  // Plain `date` columns (no time component) come back as a "YYYY-MM-DD"
  // string; appending T00:00:00 forces local-time parsing instead of UTC
  // midnight, avoiding the off-by-one-day shift documented elsewhere in this
  // codebase for naive date/timestamp values.
  const dt = typeof d === "string" ? new Date(d.length <= 10 ? `${d}T00:00:00` : d) : d;
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <span className="font-semibold text-gray-700 sm:col-span-1">{label}</span>
      <span className="text-gray-700 whitespace-pre-wrap sm:col-span-2">{children}</span>
    </div>
  );
}

/**
 * Member detail page — editable pre-lock / locked+timeline post-lock split,
 * mirrors `members/proposals/[id]/page.tsx` exactly. `getSocialRequestById()`
 * enforces the requester-or-reviewer visibility rule server-side and returns
 * null (never a 403) for a non-visible id, so this renders a plain 404 —
 * never confirms existence to a non-owner.
 */
export default async function MemberSocialRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const request = await getSocialRequestById(id, {
    viewerUserId: session.user.id,
    viewerHasReviewAccess: false,
  });
  if (!request) notFound();

  const editable = isSocialRequestEditableByRequester(request.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">{socialRequestSubjectLine(request.postCopy)}</h1>
          <div className="mt-2">
            <SocialRequestStatusBadge status={request.status} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <Link
          href="/members/social-requests"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to My Requests
        </Link>

        {editable ? (
          <EditableBody request={request} memberId={session.user.memberId ?? null} />
        ) : (
          <LockedBody request={request} />
        )}
      </div>
    </div>
  );
}

async function EditableBody({
  request,
  memberId,
}: {
  request: NonNullable<Awaited<ReturnType<typeof getSocialRequestById>>>;
  memberId: string | null;
}) {
  const member = memberId ? await db.query.members.findFirst({ where: eq(members.id, memberId) }) : null;

  const initial: SocialRequestFormInitial = {
    id: request.id,
    status: request.status,
    platforms: request.platforms,
    postCopy: request.postCopy,
    imageDataUri: request.imageDataUri,
    linkUrl: request.linkUrl,
    desiredPostDate: request.desiredPostDate,
    notes: request.notes,
    submittedAt: request.submittedAt ? request.submittedAt.toISOString() : null,
  };

  return (
    <SocialRequestForm
      request={initial}
      requesterName={member ? `${member.firstName} ${member.lastName}`.trim() : request.requesterNameSnapshot ?? ""}
      requesterEmail={member?.email ?? request.requesterEmailSnapshot ?? ""}
      requesterPhone={member?.phone ?? request.requesterPhoneSnapshot ?? null}
    />
  );
}

async function LockedBody({
  request,
}: {
  request: NonNullable<Awaited<ReturnType<typeof getSocialRequestById>>>;
}) {
  const decisions = await listDecisionsForSocialRequest(request.id);

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
    <div className="space-y-8">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-800">
        This request is locked for review. It&rsquo;s currently{" "}
        <strong>{socialRequestStatusLabel(request.status)}</strong> — you&rsquo;ll be emailed when the status
        changes.
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4 text-base">
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
        {request.notes && <DetailRow label="Notes">{request.notes}</DetailRow>}
        <DetailRow label="Submitted">{formatDate(request.submittedAt)}</DetailRow>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">Status History</h2>
        <SocialRequestStatusTimeline rows={timelineRows} />
      </div>
    </div>
  );
}
