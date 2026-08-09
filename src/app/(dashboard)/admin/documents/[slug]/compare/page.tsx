import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getDocumentBySlug, listVersionsForAdmin, getVersionForCompare } from "@/lib/documents-queries";
import { diffDocumentVersions } from "@/lib/documents";
import { DiffView } from "@/components/documents/diff-view";
import { VersionPickerForm, type VersionPickerOption } from "@/components/documents/version-picker-form";

export const dynamic = "force-dynamic";

/**
 * Admin-scoped compare view — same shape as the member compare page, but its
 * version list includes pending rows and its reads pass `allowPending: true`
 * (this route is already `documents.manage`-gated, so that's safe here and
 * nowhere else — the member compare page never does this, DECISION-076
 * Ruling 6).
 */
export default async function AdminDocumentComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) redirect("/admin");

  const { slug } = await params;
  const { from: fromParam, to: toParam } = await searchParams;

  const document = await getDocumentBySlug(slug);
  if (!document) notFound();

  const backLink = (
    <Link
      href={`/admin/documents/${slug}`}
      className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
    >
      &larr; Back to {document.title}
    </Link>
  );

  const allVersions = await listVersionsForAdmin(document.id);
  if (allVersions.length === 0) {
    return (
      <div className="space-y-6">
        {backLink}
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>No versions to compare yet.</p>
        </div>
      </div>
    );
  }

  const currentEntry = allVersions.find((v) => v.isCurrent) ?? allVersions[0];
  const currentIdx = allVersions.findIndex((v) => v.id === currentEntry.id);
  const previousEntry = allVersions[currentIdx + 1] ?? currentEntry;

  const toId = toParam || currentEntry.id;
  const fromId = fromParam || previousEntry.id;

  const [fromVersion, toVersion] = await Promise.all([
    getVersionForCompare(fromId, { allowPending: true }),
    getVersionForCompare(toId, { allowPending: true }),
  ]);
  if (!fromVersion || !toVersion || fromVersion.documentId !== document.id || toVersion.documentId !== document.id) {
    notFound();
  }

  const diff = diffDocumentVersions(fromVersion.bodyMarkdown, toVersion.bodyMarkdown);

  const options: VersionPickerOption[] = allVersions.map((v) => ({
    id: v.id,
    label: `Version ${v.versionNumber}${
      v.isCurrent ? " (current)" : v.changeType === "substantive" && !v.adoptedAt ? " (pending)" : ""
    }`,
  }));

  const toIsPending = toVersion.changeType === "substantive" && !toVersion.adoptedAt;

  return (
    <div className="space-y-6">
      {backLink}
      <h1 className="text-2xl font-bold text-gray-900">Compare Versions</h1>

      <VersionPickerForm action={`/admin/documents/${slug}/compare`} options={options} from={fromId} to={toId} />

      <p className="text-sm text-gray-600">
        Comparing <span className="font-semibold">Version {fromVersion.versionNumber}</span> to{" "}
        <span className="font-semibold">Version {toVersion.versionNumber}</span>
        {toVersion.id === document.currentVersionId ? " — the current, operative text" : ""}
        {toIsPending ? " — a pending, not-yet-adopted amendment (not visible to members)" : ""}.
      </p>

      <DiffView diff={diff} />
    </div>
  );
}
