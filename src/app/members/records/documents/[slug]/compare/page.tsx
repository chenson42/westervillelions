import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDocumentBySlug, listVersionHistoryForMembers, getVersionForCompare } from "@/lib/documents-queries";
import { diffDocumentVersions } from "@/lib/documents";
import { DiffView } from "@/components/documents/diff-view";
import { VersionPickerForm, type VersionPickerOption } from "@/components/documents/version-picker-form";

export const dynamic = "force-dynamic";

/**
 * Member-facing compare view. Reads `?from=&to=` from `searchParams` and
 * re-renders server-side per selection (Phase 3 "Diffing"). Default (no
 * query params): `to` = current version, `from` = the entry immediately
 * before it in `listVersionHistoryForMembers()`'s most-recent-first list.
 *
 * Both version ids resolve through `getVersionForCompare(id, { allowPending:
 * false })` — a pending id (reachable only by a guessed/shared URL, since
 * this page's own picker never offers one) resolves to `null`, which this
 * page turns into a plain 404, never a leak of pending text (DECISION-076
 * Ruling 6).
 */
export default async function MemberDocumentComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;
  const { slug } = await params;
  const { from: fromParam, to: toParam } = await searchParams;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Compare Versions</h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-4xl space-y-6">
        <Link
          href={`/members/records/documents/${slug}/history`}
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to version history
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
          <ComparePageBody slug={slug} fromParam={fromParam} toParam={toParam} />
        )}
      </div>
    </div>
  );
}

async function ComparePageBody({
  slug,
  fromParam,
  toParam,
}: {
  slug: string;
  fromParam?: string;
  toParam?: string;
}) {
  const document = await getDocumentBySlug(slug);
  if (!document) notFound();

  const history = await listVersionHistoryForMembers(document.id);
  if (history.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p>This document has not been published yet — there is nothing to compare.</p>
      </div>
    );
  }

  const currentEntry = history.find((v) => v.isCurrent) ?? history[0];
  const currentIdx = history.findIndex((v) => v.id === currentEntry.id);
  const previousEntry = history[currentIdx + 1] ?? currentEntry;

  const toId = toParam || currentEntry.id;
  const fromId = fromParam || previousEntry.id;

  const [fromVersion, toVersion] = await Promise.all([
    getVersionForCompare(fromId, { allowPending: false }),
    getVersionForCompare(toId, { allowPending: false }),
  ]);
  if (!fromVersion || !toVersion || fromVersion.documentId !== document.id || toVersion.documentId !== document.id) {
    notFound();
  }

  const diff = diffDocumentVersions(fromVersion.bodyMarkdown, toVersion.bodyMarkdown);

  const options: VersionPickerOption[] = history.map((v) => ({
    id: v.id,
    label: `Version ${v.versionNumber}${v.isCurrent ? " (current)" : ""}`,
  }));

  return (
    <>
      <VersionPickerForm
        action={`/members/records/documents/${slug}/compare`}
        options={options}
        from={fromId}
        to={toId}
      />

      <p className="text-sm text-gray-600">
        Comparing <span className="font-semibold">Version {fromVersion.versionNumber}</span> to{" "}
        <span className="font-semibold">Version {toVersion.versionNumber}</span>
        {toVersion.id === document.currentVersionId ? " — the current, operative text" : ""}.
      </p>

      <DiffView diff={diff} />
    </>
  );
}
