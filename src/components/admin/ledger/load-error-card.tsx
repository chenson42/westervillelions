import Link from "next/link";

/**
 * Shared load-error fallback for any Ledger admin page's DB-fetching phase
 * (DECISION-032's error-boundary ruling: inline try/catch, not error.tsx —
 * this codebase has no error.tsx precedent and a static failure card needs
 * no client boundary). "Try again" is a plain server re-navigation, no
 * client JS required.
 *
 * Extracted from a private function inside src/app/(dashboard)/admin/ledger/
 * page.tsx (Budgeting Overview/Drill-Down Restructure, architect Ruling 4) so
 * a second and third page (budgeting/page.tsx, budgeting/[fundSlug]/page.tsx)
 * can reuse it instead of copy-pasting a private helper a second time — the
 * same "don't duplicate a private helper" pattern this restructure already
 * applies to budget-plan-status.tsx (Ruling 3).
 *
 * @param backHref   Where "Try again" links to — callers choose their own
 *                    sensible re-navigation target (e.g. self for a page
 *                    with its own retry semantics, or a parent overview when
 *                    a scoped fetch failure is more usefully recovered one
 *                    level up).
 * @param backLabel  Link text, defaults to "Try again".
 */
export default function LoadErrorCard({
  backHref,
  backLabel = "Try again",
}: {
  backHref: string;
  backLabel?: string;
}) {
  return (
    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
      <svg
        className="mx-auto h-10 w-10 text-gray-300 mb-3"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="text-lg font-semibold text-gray-700">Couldn&rsquo;t load the ledger</p>
      <p className="mt-1 text-sm">Something went wrong loading this page. Please try again.</p>
      <Link
        href={backHref}
        className="mt-4 inline-block text-lions-blue hover:underline text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        {backLabel}
      </Link>
    </div>
  );
}
