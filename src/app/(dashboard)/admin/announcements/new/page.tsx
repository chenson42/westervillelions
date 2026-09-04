import AnnouncementForm from "@/components/admin/announcement-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function NewAnnouncementPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
  if (!canAccess) redirect("/admin");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/announcements" className="hover:text-gray-900">
            Announcements
          </Link>
          <span>/</span>
          <span className="text-gray-900">New Announcement</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Create New Announcement
        </h1>
      </div>

      <AnnouncementForm />
    </div>
  );
}
