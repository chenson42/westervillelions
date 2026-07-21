import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Bank Reconciliation (guide §10 — full-surface).
 *
 * DEVIATION FROM PHASE 3 DESIGN (recorded here + in the Phase 4 work-log
 * section): the design doc scoped this section as "live today: check
 * numbers, per-row reconcile toggle, uncashed checks" plus a concept-level
 * "coming soon" half, written when Bank Reconciliation inc2 had shipped only
 * schema. inc2 has since shipped a full manual workbench at
 * /admin/ledger/reconciliation — sessions, CSV upload, a matching grid, a
 * tie-out summary with a hard close gate, and reopen. This section documents
 * that real, shipped workflow instead of describing it as unbuilt. Only
 * auto-match suggestions and bulk Zeffy-payout-batch matching (summing a
 * week of Zeffy rows against one Monday deposit automatically) remain
 * "coming soon" — today, matching a bank line to a ledger transaction is a
 * manual, one-at-a-time action in the matching grid.
 */
export default function ReconciliationSection() {
  return (
    <section id="reconciliation" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Bank Reconciliation</h2>
      <p className="mt-2 text-sm text-gray-700">
        Reconciliation ties your recorded transactions to what the bank actually shows, account by
        account, for a statement period. The workflow:
      </p>

      <ol className="mt-4 space-y-3 text-sm text-gray-700 list-decimal pl-5">
        <li>
          <span className="font-semibold">Open a session</span> — pick a bank account (cash
          accounts like Petty Cash have no bank statement, so they&rsquo;re not offered here),
          the statement period&rsquo;s start/end dates, and the statement&rsquo;s opening and
          closing balances.
        </li>
        <li>
          <span className="font-semibold">Upload the bank statement</span> — a CSV export for
          that period, once per session.
        </li>
        <li>
          <span className="font-semibold">Match</span> — for each bank-statement line, either pick
          the matching ledger transaction from the candidate list or create a new transaction
          directly from that line if none exists yet. Matching today is manual, one line at a
          time.
        </li>
        <li>
          <span className="font-semibold">Tie out</span> — a running summary compares opening
          balance + cleared transactions against the statement&rsquo;s closing balance.
        </li>
        <li>
          <span className="font-semibold">Close</span> — the Close button only becomes available
          once the session balances to the penny and every in-period bank line has been matched.
          This is a hard gate with no override.
        </li>
        <li>
          <span className="font-semibold">Reopen</span> — a closed session can be reopened if
          something needs correcting, but only by someone who can manage the Ledger (a stricter
          permission than viewing or recording).
        </li>
      </ol>

      <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Coming soon:</span> automatic match suggestions, and a
          batch mode for Zeffy&rsquo;s Monday lump-sum deposits (matching a whole week of
          Zeffy-method rows against one bank line at once instead of one at a time).
        </p>
      </div>

      <p className="mt-4 text-sm text-gray-700">
        Structured check numbers and the uncashed-checks list (see that section above) exist
        independently of a reconciliation session — you don&rsquo;t need to open a session just to
        record a check number or see what&rsquo;s outstanding.
      </p>

      <p className="mt-4 text-sm">
        <Link href="/admin/ledger/reconciliation" className={linkClass}>
          Open Bank Reconciliation &rarr;
        </Link>
      </p>
    </section>
  );
}
