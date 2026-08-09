import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMinutesDetail } from "@/lib/minutes-queries";
import { MinutesDetail } from "@/components/minutes/minutes-detail";

export const dynamic = "force-dynamic";

/**
 * Member-facing minutes detail — read access is universal (any linked
 * member, any kind, any status — Phase 3 Permissions table), so this page
 * only needs to hide a SOFT-DELETED record (an admin-removed record must
 * not be reachable by a direct URL either) and otherwise renders whatever
 * getMinutesDetail() returns, draft or approved, unfiltered by kind.
 */
export default async function MemberRecordsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const { id } = await params;
  const detail = memberId ? await getMinutesDetail(id) : null;

  if (memberId && (!detail || detail.pendingDeleteAt)) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Club Records</h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Link
          href="/members/records"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Club Records
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view meeting minutes.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 sm:p-8">
            <MinutesDetail minutes={detail!} />
          </div>
        )}
      </div>
    </div>
  );
}
