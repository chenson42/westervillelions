import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * "Club Finances" fan-out hub (docs/work-log/2026-08-08-meeting-minutes.md,
 * Phase 3 IA restructure, DECISION-074 Ruling 4) — a pure navigation page.
 * Fans out to the two existing, unchanged, already-ungated-beyond-membership
 * pages (/members/financial-reports, /members/impact), the same
 * "hub absorbs sub-pages" shape ADMIN_NAVIGATION's "Treasury" group already
 * establishes. No auth gate beyond a signed-in session — the two
 * destinations each carry their own inline memberId check, unchanged.
 */
export default async function MemberFinancesHubPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Club Finances</h1>
          <p className="text-blue-100 max-w-2xl">
            The club&rsquo;s numbers, published for every member.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
        </Link>

        <div className="grid sm:grid-cols-2 gap-6">
          <a
            href="/members/financial-reports"
            className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Financial Statements</h3>
            <p className="text-gray-700">
              The monthly Statement of Financial Condition the treasurer reports to the board.
            </p>
          </a>
          <a
            href="/members/impact"
            className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Our Impact</h3>
            <p className="text-gray-700">Giving by cause and by fiscal year — how the club serves.</p>
          </a>
        </div>
      </div>
    </div>
  );
}
