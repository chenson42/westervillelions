import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listDocumentsForMembers } from "@/lib/documents-queries";

export const dynamic = "force-dynamic";

/**
 * Admin document list (docs/work-log/2026-08-09-governance-document-
 * versioning.md, Phase 3 "The Reading Surface" / Component Plan). Today:
 * exactly one row, the by-laws — creating additional `documents` rows via
 * the admin UI is explicitly out of scope for this increment (Phase 3 "Out
 * of Scope"); the only document this ships with comes from the one-off seed
 * script.
 *
 * Reuses `listDocumentsForMembers({ isAuthenticated: true })` rather than a
 * new admin-only list query — that call already returns every document
 * regardless of `visibility` for any authenticated caller (the filter only
 * excludes `'members'`-visibility rows for an UNauthenticated one), so it's
 * exactly the right shape for this route without inventing a near-duplicate
 * query function. This route's own `documents.manage` gate is what makes
 * calling it here safe.
 */
export default async function AdminDocumentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.DOCUMENTS_MANAGE))) redirect("/admin");

  const documents = await listDocumentsForMembers({ isAuthenticated: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Governing Documents</h1>
        <p className="mt-1 text-gray-600">
          Versioned governing text — constitution, by-laws, and any future policy documents.
        </p>
      </div>

      {documents.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>
            No governing documents exist yet. Publish the club&apos;s constitution and by-laws with{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">scripts/seed-governance-document.ts</code>.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id}>
              <Link
                href={`/admin/documents/${d.slug}`}
                className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-gray-900">{d.title}</p>
                    <p className="text-sm text-gray-500">
                      {d.currentVersionNumber !== null ? `Current version ${d.currentVersionNumber}` : "Not yet published"}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue capitalize">
                    {d.visibility}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
