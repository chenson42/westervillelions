import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Budgeting (guide — new section, Phase 1 work-log
 * docs/work-log/2026-07-27-ledger-budgeting-guide.md). Explains the policy
 * reasoning behind why the Budgeting page enforces a different "balanced"
 * rule per fund kind — content is locked in that work-log's outline.
 *
 * Per Phase 1 Gap notes: dollar/day-count thresholds (Activity's ~$100
 * tolerance, "several months" of operating reserve) are stated as
 * principles here, not hardcoded permanent-feeling numbers — same
 * precedent as GuardrailsSection. The one code-verifiable number
 * (ACTIVITY_BALANCE_TOLERANCE_CENTS) lives on the Budgeting page's own
 * per-fund "why" note instead, since it's read directly off the constant
 * it annotates. No 990/compliance-deadline content is restated here — a
 * single cross-link to the existing Compliance Calendar section instead.
 */
export default function BudgetingSection() {
  return (
    <section id="budgeting" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Budgeting</h2>

      <p className="mt-2 text-sm text-gray-700">
        The{" "}
        <Link href="/admin/ledger/budgeting" className={linkClass}>
          Budgeting page
        </Link>{" "}
        flags a fund&rsquo;s planned budget as balanced, needing review, or purely informational
        depending on which fund you&rsquo;re looking at — this section explains the policy
        reasoning behind that difference.
      </p>

      <h3 className="mt-5 font-semibold text-gray-900">The Two-Fund Rule</h3>
      <p className="mt-2 text-sm text-gray-700">
        The keystone rule behind everything below: money raised from the public may never fund
        club administration. This is codified in the Standard Club Constitution, Art. VII §3(g),
        and the LCI Board Policy Manual, Ch. XV (&ldquo;Use of Funds&rdquo;) &mdash; citations as
        of current LCI governing documents. The public gives on the understanding that net
        proceeds serve a community need; spending that money on the club&rsquo;s own operations
        instead is a breach of faith with the contributing public.
      </p>
      <p className="mt-2 text-sm text-gray-700">
        One nuance on netting: only a fundraiser&rsquo;s <span className="font-semibold">direct</span>{" "}
        costs (the expenses of putting that specific event on) may be deducted from its proceeds
        before the net is counted as public money. General club overhead may never be netted
        against public donations.
      </p>

      <h3 className="mt-5 font-semibold text-gray-900">How Our Funds Map</h3>
      <p className="mt-2 text-sm text-gray-700">
        The Club entity (a 501(c)(4)) holds the Administrative and Activity funds. The Foundation
        entity (a 501(c)(3)) holds the Charitable and Scholarship funds. The Activity fund is a
        pass-through clearing account for publicly-raised money on its way to the Foundation &mdash;
        it targets roughly a zero balance and sweeps forward rather than accumulating. That
        distinction &mdash; administrative money the club keeps and spends on itself, versus public
        money that only passes through or is meant to be given away &mdash; is why the balance
        rule differs by fund kind, as covered below.
      </p>

      <h3 className="mt-5 font-semibold text-gray-900">Building the Budget</h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          Start from prior-year actuals &mdash; this is exactly what the{" "}
          <Link href="/admin/ledger/budgeting" className={linkClass}>
            &ldquo;Seed from last year&rdquo;
          </Link>{" "}
          action on the Budgeting page does for you.
        </li>
        <li>Project revenue conservatively, and lean high on expected expenses.</li>
        <li>
          Each fund&rsquo;s budget must balance on its own terms &mdash; never against another
          fund.
        </li>
        <li>
          Enter dues and insurance first; they&rsquo;re the most predictable lines in the whole
          budget.
        </li>
        <li>
          Plan a small, intentional surplus on the Administrative side rather than budgeting to
          exactly zero.
        </li>
        <li>
          For a giving category, you can <strong>break the target down by cause</strong> &mdash;
          Youth &amp; Education, Hunger Relief, Disaster Relief, and so on &mdash; instead of a single
          lump sum. The category&rsquo;s total becomes the sum of its cause lines, matching the grain
          the{" "}
          <Link href="/members/impact" className={linkClass}>
            Impact dashboard
          </Link>{" "}
          reports giving in. Categories you don&rsquo;t break down keep their single amount as before.
        </li>
        <li>
          A cause can hold <strong>several labeled lines</strong> when it funds more than one
          beneficiary &mdash; e.g. under <em>Hunger &amp; Basic Needs</em> you might budget WARM and
          Westerville Sharing &amp; Caring separately. Each line takes an optional label; the cause
          subtotal is the sum of its lines.
        </li>
      </ul>

      <h3 className="mt-5 font-semibold text-gray-900">
        Reserves vs. Disbursement &mdash; Why the Rule Differs by Fund
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        On the Administrative side, the goal is to hold a healthy operating reserve &mdash; a few
        months of operating costs &mdash; because that fund covers the club&rsquo;s own bills. On
        the Charitable and Scholarship side, the goal is the opposite: disburse, don&rsquo;t
        accumulate. A large idle balance of public donations sitting unspent can put the
        Foundation&rsquo;s exempt status at risk. This is exactly why the Budgeting page&rsquo;s
        balance badges behave differently per fund &mdash; Administrative is checked against
        covering its own expenses, Activity is checked for staying near zero as a pass-through,
        and Charitable/Scholarship are shown for information only, since a planned drawdown there
        is the point, not a problem.
      </p>

      <h3 className="mt-5 font-semibold text-gray-900">Deductibility &mdash; Which Gifts Are Tax-Deductible</h3>
      <p className="mt-2 text-sm text-gray-700">
        Gifts to the Club (a 501(c)(4)) are <span className="font-semibold">not</span>{" "}
        tax-deductible to the donor. Gifts to the Foundation (a 501(c)(3)) are. Steer
        deduction-sensitive donors &mdash; and the campaigns built for them &mdash; toward the
        Foundation.
      </p>

      <h3 className="mt-5 font-semibold text-gray-900">Compliance Deadlines</h3>
      <p className="mt-2 text-sm text-gray-700">
        Budgeting decisions feed the annual Form 990 and state-registration filings &mdash; see
        the{" "}
        <Link href="#compliance-990" className={linkClass}>
          Compliance Calendar section above
        </Link>{" "}
        for the current filing calendar.
      </p>
    </section>
  );
}
