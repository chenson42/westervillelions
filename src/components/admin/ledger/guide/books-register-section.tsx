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

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Moving an entry to another fund
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        If a gift was recorded under the wrong fund, use <span className="font-semibold">Move</span> on
        its row instead of deleting and re-entering it. Today this moves{" "}
        <span className="font-semibold">income from the Administrative Fund to the Activity Fund</span>{" "}
        only. The entry keeps its date, party, amount and bank account; only the fund and category
        change, and the change is logged with your reason on the Compliance page.
      </p>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          Pick a category in the new fund (Public donations is preselected). The old category belongs
          to the old fund, so a new one is needed.
        </li>
        <li>
          The bank account balance does not change, because the cash did not move. A reconciled entry
          stays reconciled.
        </li>
        <li>
          <span className="font-semibold">A move cannot be undone.</span> Money in the Activity Fund
          leaves only through a minuted sweep. If you move the wrong entry, delete and re-enter it (or
          reopen its reconciliation session first if it was reconciled).
        </li>
        <li>
          Moving an entry that is already reconciled, or dated in an earlier fiscal year, needs the
          Manage Ledger permission. It is a permission, not a second approver.
        </li>
        <li>
          If the month&rsquo;s Administrative statement was already sent to the board, it will read as
          changed and you will be offered a corrected resend. Nothing is sent automatically.
        </li>
        <li>
          <span className="font-semibold">Moving does not sweep anything.</span> Once the money has
          actually been moved, choose <span className="font-semibold">Record sweep now</span> to open
          the Sweep to Foundation form with the amount and account filled in. You still enter the
          board-minute reference yourself. The Foundation side of a sweep is a transfer with no donor
          attached, so it does not generate an acknowledgment letter.
        </li>
        <li>
          Approved, rejected, pending, transfer and dues-posted entries cannot be moved. Expense
          entries cannot be moved yet.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Deleting an entry
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Deleting asks for a reason, and a record of the deleted entry is kept for the board on the
        Compliance page. A gift whose receipt was already sent to the donor cannot be deleted; record a
        refund entry instead. Approved, rejected and reconciled entries show why Edit and Delete are
        unavailable and what to do instead: approved and rejected entries are corrected with a refund
        entry, and a reconciled entry needs its reconciliation session reopened first.
      </p>

      <p className="mt-5 text-sm">
        <Link href="/admin/ledger" className={linkClass}>
          Open the Ledger Overview to record a transaction &rarr;
        </Link>
      </p>
    </section>
  );
}
