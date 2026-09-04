import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listClubFilesForAdmin } from "@/lib/club-files-queries";
import { formatFileSize } from "@/lib/utils";
import { ClubFileUploadForm } from "@/components/admin/club-files/club-file-upload-form";
import { DeleteClubFileButton } from "@/components/admin/club-files/delete-club-file-button";

export const dynamic = "force-dynamic";

function visibilityBadge(visibility: string) {
  return visibility === "public" ? (
    <span className="inline-flex items-center rounded-full bg-lions-gold/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
      Public
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
      Members only
    </span>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Admin Club Files list (docs/work-log/2026-09-04-club-documents.md,
 * Phase 3 Component Plan). Server Component — calls listClubFilesForAdmin()
 * directly, same pattern as /admin/welcome-packets and /admin/documents.
 *
 * Gate: club_files.manage, admin-only by role binding (0098 migration).
 */
export default async function AdminClubFilesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE))) redirect("/admin");

  const files = await listClubFilesForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Club Files</h1>
        <p className="mt-1 text-gray-600">
          General-purpose files the club shares — sponsorship packets, event handouts, and other
          documents. Mark a file &ldquo;Public&rdquo; to make it downloadable without signing in,
          or &ldquo;Members only&rdquo; to restrict it to linked member accounts.
        </p>
      </div>

      <ClubFileUploadForm />

      {files.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>No files yet — upload your first one above.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="bg-white rounded-2xl shadow-sm overflow-hidden p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <Link
                    href={`/admin/club-files/${f.id}`}
                    className="font-semibold text-gray-900 hover:text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                  >
                    {f.name}
                  </Link>
                  {f.description && <p className="mt-0.5 text-sm text-gray-500">{f.description}</p>}
                  <p className="mt-1 text-xs text-gray-400">
                    {formatFileSize(f.byteSize)} &middot; Uploaded {formatDate(f.createdAt)}
                    {f.attachedEventCount > 0 && (
                      <>
                        {" "}
                        &middot; Attached to {f.attachedEventCount} event{f.attachedEventCount === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {visibilityBadge(f.visibility)}
                  <Link
                    href={`/admin/club-files/${f.id}`}
                    className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
                  >
                    Edit
                  </Link>
                  <DeleteClubFileButton
                    fileId={f.id}
                    fileName={f.name}
                    attachedEventCount={f.attachedEventCount}
                    variant="row"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
