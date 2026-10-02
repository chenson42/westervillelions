import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Reimbursements & Approvals (guide §5 — full-surface).
 *
 * Reimbursements need no board approval (DECISION-106): the treasurer — or any
 * other holder of the Record permission — reviews, then pays or rejects; the
 * board reviews paid requests afterward. The Approvals queue is for
 * disbursements over the threshold and transfers only.
 *
 * Also flags the Approvals page's stricter gate (LEDGER_APPROVE alone, via
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
        <span className="font-semibold">paid</span> (or <span className="font-semibold">rejected</span>).
        There is no board approval step. The treasurer, or anyone else who holds the Record
        permission, reviews the receipt, then either marks the request paid &mdash; which posts
        the expense straight to the fund ledger, outside the approval threshold &mdash; or rejects
        it with a reason.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        <span className="font-semibold">Mark Paid asks which bank account the money came out of</span>{" "}
        (the entity&rsquo;s default is preselected) and, for a check, the{" "}
        <span className="font-semibold">check number</span>. Both let the payment match its line when
        you reconcile. The <span className="font-semibold">Register description</span> starts as what
        the member wrote; change it only if the register should read differently.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        On the Paid tab, each request shows its account and check number. One recorded without an
        account shows a <span className="font-semibold">Needs bank account</span> badge with an{" "}
        <span className="font-semibold">Add bank account</span> button. If a paid request was entered
        wrong, use <span className="font-semibold">Correct</span> on its row in the register (see
        Books &amp; the Register).
      </p>
      <p className="mt-3 text-sm text-gray-700">
        The board reviews reimbursements after the fact. The <span className="font-semibold">Paid</span>{" "}
        tab on the Reimbursements page lists every paid request, newest payment first, with who
        paid it and from which fund.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        <span className="font-semibold">You cannot pay or reject your own request.</span> If you
        submit one, a different person with the Record permission has to act on it, so keep at
        least two people with that permission.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        The <span className="font-semibold">Approvals</span> queue is for disbursements over the
        approval threshold and transfers only &mdash; not reimbursements. Pending amounts there are
        excluded from posted fund balances until a board approver acts on them.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        Requests the board approved under the old process still appear under{" "}
        <span className="font-semibold">Approved (legacy)</span> while any remain, and can be paid or
        rejected like any other.
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
