import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Reports (guide §9 — user note 3, part B). Brief per Phase 3 design; no
 * fund slug hardcoded since fund slugs are dynamic per entity.
 */
export default function ReportsSection() {
  return (
    <section id="reports" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Reports</h2>
      <p className="mt-2 text-sm text-gray-700">
        The Reports page shows an entity-wide report across all of that entity&rsquo;s funds for a
        chosen fiscal year — gross receipts, net, and a guardrail summary in one view. Each
        individual fund also has its own report, reachable from that fund&rsquo;s own page on the
        Ledger Overview.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/admin/ledger/reports" className={linkClass}>
          Open Reports &rarr;
        </Link>
      </p>
    </section>
  );
}
