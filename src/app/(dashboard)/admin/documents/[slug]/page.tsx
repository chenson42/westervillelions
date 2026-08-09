import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getDocumentBySlug,
  getCurrentVersion,
  listVersionsForAdmin,
  getUserNamesByIds,
} from "@/lib/documents-queries";
import { listMinutesForAdmin } from "@/lib/minutes-queries";
import { minutesKindLabel } from "@/lib/minutes";
import { DocumentView } from "@/components/documents/document-view";
import { VersionHistoryList, type VersionHistoryRow } from "@/components/documents/version-history-list";
import { DocumentVersionForm } from "@/components/admin/documents/document-version-form";
import { PendingVersionsPanel } from "@/components/admin/documents/pending-versions-panel";

export const dynamic = "force-dynamic";

/**
 * Admin editor page (docs/work-log/2026-08-09-governance-document-
 * versioning.md, Phase 3 "The Reading Surface" / Component Plan): read-only
 * current-text display, the pending-amendments review panel (Adopt / Link
 * Citing Minutes), the new-version form, and the full version history
 * including pending rows — the one place pending versions are ever shown
 * outside the admin API (DECISION-076 Ruling 6).
 */
export default async function AdminDocumentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) redirect("/admin");

  const { slug } = await params;
  const document = await getDocumentBySlug(slug);
  if (!document) notFound();

  const [current, allVersions, minutesRows] = await Promise.all([
    getCurrentVersion(document.id),
    listVersionsForAdmin(document.id),
    listMinutesForAdmin(),
  ]);

  const userIds = allVersions.flatMap((v) => [v.authorUserId, v.adoptedByUserId]);
  const names = await getUserNamesByIds(userIds);
  const minutesById = new Map(minutesRows.map((m) => [m.id, m]));
  const minutesOptions = minutesRows.map((m) => ({
    id: m.id,
    label: `${minutesKindLabel(m.kind)} minutes — ${m.meetingDate}${m.status === "draft" ? " (draft)" : ""}`,
  }));

  const pending = allVersions
    .filter((v) => v.changeType === "substantive" && v.adoptedAt === null)
    .map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      changeNote: v.changeNote,
      authorName: v.authorUserId ? names.get(v.authorUserId) ?? null : null,
      createdAt: v.createdAt.toISOString(),
    }));

  const needsCitation = allVersions
    .filter((v) => v.changeType === "substantive" && v.adoptedAt !== null && !v.citingMinutesId)
    .map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      adoptedAt: (v.adoptedAt as Date).toISOString(),
    }));

  const historyRows: VersionHistoryRow[] = allVersions.map((v) => {
    const cited = v.citingMinutesId ? minutesById.get(v.citingMinutesId) : null;
    return {
      id: v.id,
      versionNumber: v.versionNumber,
      changeType: v.changeType,
      changeNote: v.changeNote,
      authorName: v.authorUserId ? names.get(v.authorUserId) ?? null : null,
      adoptedByName: v.adoptedByUserId ? names.get(v.adoptedByUserId) ?? null : null,
      adoptedAt: v.adoptedAt,
      adoptionNote: v.adoptionNote,
      citingMinutes: cited
        ? {
            id: cited.id,
            label: `${minutesKindLabel(cited.kind)} minutes — ${cited.meetingDate}`,
            status: cited.status,
            href: `/admin/minutes/${cited.id}`,
          }
        : v.citingMinutesId
          ? { id: v.citingMinutesId, label: "Cited minutes", status: "unknown", href: `/admin/minutes/${v.citingMinutesId}` }
          : null,
      createdAt: v.createdAt,
      isCurrent: v.isCurrent,
      isPending: v.changeType === "substantive" && v.adoptedAt === null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/documents"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Governing Documents
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <h1 className="text-3xl font-bold text-gray-900">{document.title}</h1>
          <Link
            href={`/admin/documents/${slug}/compare`}
            className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            Compare versions →
          </Link>
        </div>
      </div>

      {current ? (
        <DocumentView
          data={{
            title: document.title,
            versionNumber: current.versionNumber,
            bodyMarkdown: current.bodyMarkdown,
            createdAt: current.createdAt,
          }}
        />
      ) : (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>Not published yet — save the first version below.</p>
        </div>
      )}

      <PendingVersionsPanel slug={slug} pending={pending} needsCitation={needsCitation} minutesOptions={minutesOptions} />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Save a new version</h2>
        <DocumentVersionForm slug={slug} initialBodyMarkdown={current?.bodyMarkdown ?? ""} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Full version history</h2>
        <VersionHistoryList rows={historyRows} compareBasePath={`/admin/documents/${slug}/compare`} />
      </div>
    </div>
  );
}
