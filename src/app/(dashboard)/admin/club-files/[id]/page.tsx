import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getClubFileById, getClubFileEventIds } from "@/lib/club-files-queries";
import { formatFileSize } from "@/lib/utils";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { ClubFileMetadataForm } from "@/components/admin/club-files/club-file-metadata-form";
import { ClubFileReplaceControl } from "@/components/admin/club-files/club-file-replace-control";
import { EventAttachPicker } from "@/components/admin/club-files/event-attach-picker";
import { DeleteClubFileButton } from "@/components/admin/club-files/delete-club-file-button";

export const dynamic = "force-dynamic";

/**
 * Admin Club File detail — metadata edit, replace-in-place, event
 * attach/detach picker, delete (docs/work-log/2026-09-04-club-documents.md,
 * Phase 3 Component Plan).
 */
export default async function AdminClubFileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) redirect("/admin");

  const { id } = await params;
  const file = await getClubFileById(id);
  if (!file) notFound();

  const eventIds = await getClubFileEventIds(id);
  const attachedEvents =
    eventIds.length > 0
      ? await db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, eventIds))
      : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/club-files"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Club Files
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{file.name}</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {file.filename} &middot; {formatFileSize(file.byteSize)}
        </p>
      </div>

      <ClubFileMetadataForm
        fileId={file.id}
        initialName={file.name}
        initialDescription={file.description}
        initialVisibility={file.visibility === "public" ? "public" : "members-only"}
      />

      <ClubFileReplaceControl fileId={file.id} currentFilename={file.filename} />

      <EventAttachPicker fileId={file.id} initialEventIds={eventIds} />

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Delete this file</h2>
        <p className="text-sm text-gray-500">
          Permanently removes the file and its download link. This cannot be undone.
        </p>
        <DeleteClubFileButton
          fileId={file.id}
          fileName={file.name}
          attachedEventNames={attachedEvents.map((e) => e.title)}
          redirectTo="/admin/club-files"
        />
      </div>
    </div>
  );
}
