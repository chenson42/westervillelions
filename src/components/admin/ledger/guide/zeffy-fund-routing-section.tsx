import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Zeffy & Fund Routing (guide §3 — user note 5, spine).
 *
 * Documents the current (2026-07-21, revised) policy: a single Zeffy account,
 * not the earlier superseded two-account plan. Cross-links to the compliance
 * page (aged-public-fund guardrail).
 */
export default function ZeffyFundRoutingSection() {
  return (
    <section id="zeffy-fund-routing" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Zeffy &amp; Fund Routing</h2>
      <p className="mt-2 text-sm text-gray-500">
        The club uses a single Zeffy account for both dues and donations — there is no separate
        Zeffy account for the Foundation. Where each type of Zeffy payment lands in the books
        depends on what it is:
      </p>

      <ul className="mt-4 space-y-3 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">Dues via Zeffy</span> &rarr; club (admin) income,
          unchanged. The dues auto-post already handles this.
        </li>
        <li>
          <span className="font-semibold">Donations via Zeffy</span> &rarr; recorded as club{" "}
          <span className="font-semibold">Activity Fund</span> (public) income, then promptly
          swept to the Foundation. The Activity Fund is a clearing account with a target balance
          of $0 — it is never a home for donation money, only a landing place on the way to the
          Foundation.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Recording the sweep to the Foundation
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Write the check or transfer, then record it in the Ledger as two linked entries citing the
        same board minute where one exists: a club <span className="font-semibold">Activity Fund
        expense</span> (money leaving the club books) and a matching Foundation{" "}
        <span className="font-semibold">income</span> entry (money arriving at the Foundation).
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Monday lump-payout reconciliation
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Zeffy sweeps the prior week&rsquo;s payments into the bank account every Monday, so one
        bank-statement line covers several individual Ledger rows. For each Monday deposit, sum
        the Zeffy-method Ledger transactions from the preceding week — Zeffy takes no ledger-side
        fee, so the sum should equal the deposit exactly. A mismatch usually means a payment
        straddled the payout cutoff or was recorded with the wrong method.
      </p>

      <div className="mt-5 rounded-2xl bg-blue-50 border border-blue-100 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Caveat:</span> a gift made through the club-side Zeffy
          form is legally a gift to the club, not the 501(c)(3) Foundation. Donor
          tax-deductibility is only clean once funds are in the Foundation — keep steering
          larger or deduction-sensitive donors to Foundation giving channels, and sweep often
          enough that donations don&rsquo;t sit club-side.
        </p>
      </div>

      <p className="mt-3 text-sm">
        <Link href="/admin/ledger/compliance" className={linkClass}>
          See the aged public-fund guardrail on the Compliance page &rarr;
        </Link>
      </p>
    </section>
  );
}
