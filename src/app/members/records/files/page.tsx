import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listAllClubFilesForMembers } from "@/lib/club-files-queries";
import { formatFileSize } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

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

/**
 * Member-facing Club Files list — every file, public and members-only
 * alike, attached to an event or not (docs/work-log/2026-09-04-club-
 * documents.md, User Decision 3: Club Records is the single complete
 * index; event pages are an additional convenience surface).
 *
 * Server Component — auth() + inline memberId check, NO FEATURES gate,
 * mirroring /members/records itself (any linked member).
 */
export default async function MemberClubFilesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const files = memberId ? await listAllClubFilesForMembers() : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Club Files</h1>
          <p className="text-blue-100 max-w-2xl">
            Sponsorship packets, event handouts, and other files the club shares.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 space-y-6">
        <Link
          href="/members/records"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Club Records
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view club files.
            </p>
          </div>
        ) : files.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p>No files have been posted yet.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id}>
                <a
                  href={`/api/club-files/${f.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between gap-3 bg-white rounded-2xl shadow-sm overflow-hidden p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{f.name}</p>
                    {f.description && <p className="text-sm text-gray-500">{f.description}</p>}
                    <p className="mt-1 text-xs text-gray-400">
                      {formatFileSize(f.byteSize)} &middot; Posted {formatDate(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex-shrink-0">{visibilityBadge(f.visibility)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
