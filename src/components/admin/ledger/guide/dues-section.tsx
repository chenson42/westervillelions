import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Dues (guide §4 — full-surface). Brief per Phase 3 design: where dues land
 * in the ledger, where a member's own history lives, and where the
 * admin-side dues surface is.
 */
export default function DuesSection() {
  return (
    <section id="dues" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Dues</h2>
      <p className="mt-2 text-sm text-gray-700">
        Dues payments auto-post to the club (admin) ledger as income the same day a member pays —
        no manual entry needed. Each member can see their own dues payment history in the member
        portal; the admin dues surface tracks who&rsquo;s paid, who&rsquo;s outstanding, and lets
        you record payments made outside Zeffy (check, cash).
      </p>
      <p className="mt-4 text-sm space-x-4">
        <Link href="/admin/dues" className={linkClass}>
          Open the admin Dues page &rarr;
        </Link>
        <Link href="/members/dues" className={linkClass}>
          See the member-portal dues history page &rarr;
        </Link>
      </p>
    </section>
  );
}
