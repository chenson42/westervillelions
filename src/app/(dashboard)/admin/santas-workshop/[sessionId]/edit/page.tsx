import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionRow, listUnmatchedWindowAnswers, toSessionDto } from "@/lib/santas-workshop/session-queries";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { SessionForm } from "@/components/admin/santas-workshop/session-form";
import { CARD } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

export default async function EditSantasWorkshopSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const row = await getSessionRow(sessionId);
  if (!row) notFound();
  const dto = toSessionDto(row);
  const purged = dto.personalPurgedAt !== null;
  const unmatched = purged ? [] : await listUnmatchedWindowAnswers(sessionId);

  return (
    <div className="space-y-6 max-w-3xl">
      <SessionNav session={dto} active="edit" />
      {purged ? (
        <div className={`${CARD} p-6`}>
          <h2 className="text-lg font-semibold text-gray-900">This session can no longer be changed</h2>
          <p className="mt-2 text-sm text-gray-600">Its registrant details have been removed, so its settings are now read-only.</p>
        </div>
      ) : (
        <SessionForm mode="edit" session={dto} unmatchedAnswers={unmatched} />
      )}
    </div>
  );
}
