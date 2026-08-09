import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getMinutesDetail } from "@/lib/minutes-queries";
import { getMinutesFormEventOptions, getMinutesFormMemberOptions } from "@/lib/minutes-admin-form-data";
import { minutesKindLabel } from "@/lib/minutes";
import { MinutesEditorShell } from "@/components/admin/minutes/minutes-editor-shell";

export const dynamic = "force-dynamic";

export default async function AdminMinutesDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ justSaved?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) redirect("/admin");
  const canDelete = await hasFeature(session.user.id, FEATURES.MINUTES_DELETE);

  const { id } = await params;
  const { justSaved } = await searchParams;

  const [detail, eventOptions, memberOptions] = await Promise.all([
    getMinutesDetail(id),
    getMinutesFormEventOptions(),
    getMinutesFormMemberOptions(),
  ]);

  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/minutes"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Minutes
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">
          {detail.title || `${minutesKindLabel(detail.kind)} minutes — ${detail.meetingDate}`}
        </h1>
        <p className="mt-1 text-gray-600">{detail.meetingDate}</p>
      </div>

      <MinutesEditorShell
        minutesId={detail.id}
        kind={detail.kind}
        status={detail.status}
        pendingDeleteAt={detail.pendingDeleteAt ? detail.pendingDeleteAt.toISOString() : null}
        approvedAt={detail.approvedAt ? detail.approvedAt.toISOString() : null}
        canDelete={canDelete}
        eventOptions={eventOptions}
        memberOptions={memberOptions}
        currentMemberId={session.user.memberId ?? null}
        initial={{
          kind: detail.kind,
          eventId: detail.eventId,
          meetingDate: detail.meetingDate,
          title: detail.title,
          presentCount: detail.presentCount,
          notetakerMemberId: detail.notetakerMemberId,
          bodyMarkdown: detail.bodyMarkdown,
          motions: detail.motions,
          actionItems: detail.actionItems,
        }}
        detailData={{
          id: detail.id,
          kind: detail.kind,
          meetingDate: detail.meetingDate,
          status: detail.status,
          title: detail.title,
          presentCount: detail.presentCount,
          notetakerNameSnapshot: detail.notetakerNameSnapshot,
          bodyMarkdown: detail.bodyMarkdown,
          approvedAt: detail.approvedAt,
          motions: detail.motions,
          actionItems: detail.actionItems,
        }}
        justSaved={justSaved === "1"}
      />
    </div>
  );
}
