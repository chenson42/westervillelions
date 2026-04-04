import AnnouncementForm from "@/components/admin/announcement-form";
import Link from "next/link";

export default function NewAnnouncementPage() {
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
