import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Books & the Register (guide §2 — full-surface, Phase 1 item 8).
 *
 * Explains funds/transactions/posted-vs-pending and walks the transaction
 * form's real field set (category, party/payer, payment method including
 * debit_card, structured check number, receipt upload + waiver, and the
 * public gift description) as they exist today. Folds in receipts/waivers
 * and public gift descriptions (v1.31) as subsections rather than standalone
 * files, per the tech-lead design.
 */
export default function BooksRegisterSection() {
  return (
    <section id="books-register" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Books &amp; the Register</h2>
      <p className="mt-2 text-sm text-gray-500">
        Each entity (Club/Administrative and Foundation) tracks its own <span className="font-semibold">funds</span> — Administrative,
        Activity, Charitable, or Scholarship — and every dollar in or out is a <span className="font-semibold">transaction</span> recorded
        against one of those funds. A transaction that&rsquo;s awaiting board approval (see Reimbursements
        &amp; Approvals below) is <span className="font-semibold">pending</span> and excluded from posted
        balances until it&rsquo;s approved; everything else is <span className="font-semibold">posted</span>.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Recording a transaction
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li><span className="font-semibold">Category</span> — the income/expense category (optional, but keeps reports meaningful).</li>
        <li><span className="font-semibold">Payer / Payee</span> — required for income, optional for expenses.</li>
        <li>
          <span className="font-semibold">Payment method</span> — Check, Cash, Zeffy, Debit Card, or Other.
        </li>
        <li>
          <span className="font-semibold">Check #</span> — a structured field (not parsed from memo
          text). Type the check number here whenever the payment method is Check.
        </li>
        <li><span className="font-semibold">Memo</span> — free-text notes or a reference.</li>
        <li>
          <span className="font-semibold">Beneficiary cause</span> (expenses) — an optional
          free-text tag (e.g. &ldquo;Rudolph Run,&rdquo; &ldquo;Vision Care Fund&rdquo;) used for
          giving-by-cause reporting.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Receipts and waivers
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Expenses can have a receipt attached (image or PDF upload). When a receipt genuinely
        can&rsquo;t be obtained, record a <span className="font-semibold">waiver</span> instead of
        leaving the transaction undocumented — the Compliance guardrails treat a waived expense
        differently from one that&rsquo;s simply missing paperwork. Attaching a receipt later
        automatically clears an existing waiver.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Public gift descriptions
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        For named gifts you want to appear on the member philanthropy dashboard, add a short{" "}
        <span className="font-semibold">public note</span> to the transaction (e.g. &ldquo;Sponsored
        Westerville Autumn Arborfest 2026&rdquo;) — this is the treasurer-curated line members see,
        separate from the internal memo.
      </p>

      <p className="mt-5 text-sm">
        <Link href="/admin/ledger" className={linkClass}>
          Open the Ledger Overview to record a transaction &rarr;
        </Link>
      </p>
    </section>
  );
}
