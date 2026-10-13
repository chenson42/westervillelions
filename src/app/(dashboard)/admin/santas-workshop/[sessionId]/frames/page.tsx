import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionOverview } from "@/lib/santas-workshop/session-queries";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { FramesPanel } from "@/components/admin/santas-workshop/frames-panel";

export const dynamic = "force-dynamic";

export default async function SantasWorkshopFramesPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const s = await getSessionOverview(sessionId);
  if (!s) notFound();

  return (
    <div className="space-y-6">
      <SessionNav session={s} active="frames" />
      <FramesPanel sessionId={s.id} sessionKind={s.kind} purged={s.status === "purged"} year={s.photoDate.slice(0, 4)} />
    </div>
  );
}
