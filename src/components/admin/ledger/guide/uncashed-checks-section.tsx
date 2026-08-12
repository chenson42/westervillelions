import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Uncashed Checks (guide §6 — full-surface).
 */
export default function UncashedChecksSection() {
  return (
    <section id="uncashed-checks" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Uncashed Checks</h2>
      <p className="mt-2 text-sm text-gray-700">
        The Ledger Overview page lists checks that have been recorded as written but haven&rsquo;t
        yet been marked reconciled — a quick view into what&rsquo;s still outstanding at the bank
        across both entities.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        A check that&rsquo;s been outstanding for months is a &ldquo;contact the payee, consider
        voiding and reissuing&rdquo; situation, not a data-entry error.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/admin/ledger" className={linkClass}>
          See the Uncashed Checks panel on the Ledger Overview &rarr;
        </Link>
      </p>
    </section>
  );
}
