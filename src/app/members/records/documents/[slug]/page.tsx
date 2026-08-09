import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDocumentBySlug, getCurrentVersion } from "@/lib/documents-queries";
import { DocumentView } from "@/components/documents/document-view";

export const dynamic = "force-dynamic";

/**
 * Member-facing current-document view (docs/work-log/2026-08-09-governance-
 * document-versioning.md, Phase 3 "The Reading Surface"). `auth()` + inline
 * `memberId` check mirroring `/members/records/[id]/page.tsx` line for
 * line. `visibility` gating isn't a separate branch here — this route lives
 * entirely under the auth-required `/members` tree, and this increment
 * ships no public route variant (Phase 3 "Out of Scope"), so any linked
 * member who reaches this URL is already inside the audience the
 * `documents.visibility` column is meant to admit.
 */
export default async function MemberDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const { slug } = await params;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Club Records</h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
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
              Your user account is not linked to a member record. Contact the club treasurer or an administrator to
              have your account linked so you can view governing documents.
            </p>
          </div>
        ) : (
          <DocumentPageBody slug={slug} />
        )}
      </div>
    </div>
  );
}

async function DocumentPageBody({ slug }: { slug: string }) {
  const document = await getDocumentBySlug(slug);
  if (!document) notFound();

  const current = await getCurrentVersion(document.id);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">{document.title}</h2>
        <Link
          href={`/members/records/documents/${slug}/history`}
          className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          Version history &amp; changes →
        </Link>
      </div>

      {!current ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p>This document has not been published yet.</p>
        </div>
      ) : (
        <DocumentView
          data={{
            title: document.title,
            versionNumber: current.versionNumber,
            bodyMarkdown: current.bodyMarkdown,
            createdAt: current.createdAt,
          }}
        />
      )}
    </>
  );
}
