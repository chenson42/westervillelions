import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionOverview } from "@/lib/santas-workshop/session-queries";
import { listSessionPhotos } from "@/lib/santas-workshop/photo-admin";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { PhotosPanel } from "@/components/admin/santas-workshop/photos-panel";

export const dynamic = "force-dynamic";

export default async function SantasWorkshopPhotosPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const [s, groups, portraits] = await Promise.all([
    getSessionOverview(sessionId),
    listSessionPhotos(sessionId, { kind: "group", page: 1 }),
    listSessionPhotos(sessionId, { kind: "portrait", page: 1 }),
  ]);
  if (!s || "ok" in groups || "ok" in portraits) notFound();

  return (
    <div className="space-y-6">
      <SessionNav session={s} active="photos" />
      <PhotosPanel
        sessionId={s.id}
        sessionKind={s.kind}
        purged={s.status === "purged"}
        initial={{
          group: { photos: groups.photos, hasMore: groups.hasMore },
          portrait: { photos: portraits.photos, hasMore: portraits.hasMore },
          counts: groups.counts,
          collage: groups.collage,
        }}
      />
    </div>
  );
}
