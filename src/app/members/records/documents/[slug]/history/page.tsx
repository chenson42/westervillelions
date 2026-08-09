import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDocumentBySlug, listVersionHistoryForMembers, getUserNamesByIds } from "@/lib/documents-queries";
import { listMinutesForMembers } from "@/lib/minutes-queries";
import { minutesKindLabel } from "@/lib/minutes";
import { VersionHistoryList, type VersionHistoryRow } from "@/components/documents/version-history-list";

export const dynamic = "force-dynamic";

/**
 * Member-facing version history — every published change, most recent
 * first. Pending substantive versions are excluded at the query layer
 * (`listVersionHistoryForMembers()`, DECISION-076 Ruling 6) — this page
 * never has to reason about that gate itself.
 */
export default async function MemberDocumentHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;
  const { slug } = await params;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Version History</h1>
          <p className="text-blue-100 max-w-2xl">Every published change to this document, most recent first.</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
        <Link
          href={`/members/records/documents/${slug}`}
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to current document
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an administrator to
              have your account linked so you can view governing documents.
            </p>
          </div>
        ) : (
          <HistoryPageBody slug={slug} />
        )}
      </div>
    </div>
  );
}

async function HistoryPageBody({ slug }: { slug: string }) {
  const document = await getDocumentBySlug(slug);
  if (!document) notFound();

  const versions = await listVersionHistoryForMembers(document.id);
  const userIds = versions.flatMap((v) => [v.authorUserId, v.adoptedByUserId]);
  const [names, minutesRows] = await Promise.all([getUserNamesByIds(userIds), listMinutesForMembers()]);
  const minutesById = new Map(minutesRows.map((m) => [m.id, m]));

  const rows: VersionHistoryRow[] = versions.map((v) => {
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
            href: `/members/records/${cited.id}`,
          }
        : v.citingMinutesId
          ? { id: v.citingMinutesId, label: "Cited minutes", status: "unknown", href: "#" }
          : null,
      createdAt: v.createdAt,
      isCurrent: v.isCurrent,
      // Members never receive a pending row here (already excluded at the
      // query layer) — always false for this data source.
      isPending: false,
    };
  });

  return <VersionHistoryList rows={rows} compareBasePath={`/members/records/documents/${slug}/compare`} />;
}
