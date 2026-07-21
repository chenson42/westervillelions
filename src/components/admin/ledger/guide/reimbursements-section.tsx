import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Reimbursements & Approvals (guide §5 — full-surface).
 *
 * Flags the Approvals page's stricter gate (LEDGER_APPROVE alone, via
 * hasFeature, not hasAnyFeature) — a real exception worth naming since it's
 * stricter than every other Ledger subpage including this guide itself.
 */
export default function ReimbursementsSection() {
  return (
    <section id="reimbursements" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Reimbursements &amp; Approvals</h2>
      <p className="mt-2 text-sm text-gray-700">
        Members submit expense-reimbursement requests, which move through a simple pipeline:{" "}
        <span className="font-semibold">submitted</span> &rarr;{" "}
        <span className="font-semibold">approved</span> &rarr;{" "}
        <span className="font-semibold">paid</span> (or <span className="font-semibold">rejected</span>{" "}
        at the approval step). Approved-but-unpaid reimbursements and other disbursements over the
        approval threshold sit in a separate <span className="font-semibold">Approvals</span> queue
        until a board approver acts on them — pending amounts are excluded from posted fund
        balances until then.
      </p>
      <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Note:</span> the Approvals page is gated more strictly
          than every other Ledger page — it requires the Approve permission specifically, not any
          Ledger permission. A board member who can view and record transactions but doesn&rsquo;t
          hold the Approve permission won&rsquo;t be able to open it.
        </p>
      </div>
      <p className="mt-4 text-sm space-x-4">
        <Link href="/admin/ledger/reimbursements" className={linkClass}>
          Open Reimbursements &rarr;
        </Link>
        <Link href="/admin/ledger/approvals" className={linkClass}>
          Open Approvals &rarr;
        </Link>
      </p>
    </section>
  );
}
