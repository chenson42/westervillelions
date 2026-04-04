import { db } from "@/lib/db";
import { homepageAnnouncements } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import AnnouncementForm from "@/components/admin/announcement-form";
import Link from "next/link";

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const announcement = await db.query.homepageAnnouncements.findFirst({
    where: eq(homepageAnnouncements.id, id),
  });

  if (!announcement) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/announcements" className="hover:text-gray-900">
            Announcements
          </Link>
          <span>/</span>
          <span className="text-gray-900">{announcement.title}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Edit Announcement
        </h1>
      </div>

      <AnnouncementForm announcement={announcement} />
    </div>
  );
}
