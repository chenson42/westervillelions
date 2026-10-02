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
        Correcting a paid reimbursement
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        A reimbursement you have marked paid is posted to the register as an approved entry, so it
        is labelled <span className="font-semibold">Paid reimbursement</span> and has no Edit or
        Delete. Use <span className="font-semibold">Correct</span> on its row instead.
      </p>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          Correct can change the <span className="font-semibold">category, budget line, payment
          date, payment method, check number, register description and bank account</span>. Every
          correction needs a reason of 10 to 500 characters, which the board can read under Recent
          corrections on the Compliance page. The amount, the fund and who was paid cannot be
          changed here: for those, record a refund entry or have the member submit a new request.
        </li>
        <li>
          <span className="font-semibold">Add bank account.</span> A reimbursement paid before the
          Mark Paid form asked for the account has none, so it could never be matched to the
          bank&rsquo;s check line. The register shows &ldquo;No bank account&rdquo; with an{" "}
          <span className="font-semibold">Add bank account</span> button. It adds the account (and
          the check number, if you have it) and nothing else, and needs no typed reason.
        </li>
        <li>
          The <span className="font-semibold">date and bank account are locked</span> while the entry
          is matched to a bank line or reconciled, because the reconciliation counts them. If the
          account is wrong on a matched entry, unmatch it, correct it, then match it again. Changing
          the account moves the payment between the two accounts&rsquo; book balances.
        </li>
        <li>
          Correcting an entry that was reconciled, is dated in an earlier fiscal year, or whose date
          moves into another fiscal year needs the Manage Ledger permission. If a statement for the
          month was already sent to the board, the dialog warns you that it will read as changed.
        </li>
        <li>
          A date change that would take a month&rsquo;s statement off the members&rsquo; page (an
          unreconciled entry moved into an earlier month) is refused until the entry is reconciled.
        </li>
        <li>
          You cannot correct a reimbursement you submitted yourself; another reviewer has to.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Moving an entry to another fund
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        If a gift was recorded under the wrong fund, use <span className="font-semibold">Move</span> on
        its row instead of deleting and re-entering it. Move handles two cases:{" "}
        <span className="font-semibold">income from the Administrative Fund to the Activity Fund</span>{" "}
        within the Club, and{" "}
        <span className="font-semibold">income from the Foundation&rsquo;s Charitable Fund to the Club&rsquo;s Activity Fund</span>{" "}
        (described below). Either way the entry keeps its date, party and amount, and the change is
        logged with your reason on the Compliance page.
      </p>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          Pick a category in the new fund (Public donations is preselected). The old category belongs
          to the old fund, so a new one is needed.
        </li>
        <li>
          <span className="font-semibold">Within the Club,</span> the bank account does not change,
          because the cash did not move. A reconciled entry stays reconciled.
        </li>
        <li>
          <span className="font-semibold">Across entities,</span> the bank account{" "}
          <span className="font-semibold">does</span> change: the entry leaves the Foundation&rsquo;s
          account and joins the Club account you pick. The dialog shows both accounts&rsquo; balances
          before and after.
        </li>
        <li>
          <span className="font-semibold">A move cannot be undone.</span> Money in the Activity Fund
          leaves only through a minuted sweep. If you move the wrong entry within the Club, delete and
          re-enter it (or reopen its reconciliation session first if it was reconciled).
        </li>
        <li>
          Moving an entry that is already reconciled, or dated in an earlier fiscal year, needs the
          Manage Ledger permission, and so does every move to the other entity. It is a permission,
          not a second approver.
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
        Moving a gift from the Foundation to the Club
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Use this when a gift was recorded on the Foundation&rsquo;s books but the money actually landed
        in a Club bank account. Choose <span className="font-semibold">Move</span> on the
        Foundation&rsquo;s income entry, pick the Activity Fund, pick the Club bank account the money
        landed in (the dialog never guesses unless the Club has only one active account), and choose a
        category.
      </p>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">The donor and the receipt stay.</span> A receipt letter that
          was already sent stays attached to the gift and still names the Foundation. The Club&rsquo;s
          register shows &ldquo;Receipt on file, issued by the Foundation.&rdquo; Because a sent
          receipt cannot be taken back, the moved entry can no longer be deleted; correct it later with
          a refund entry. A receipt record that was never sent is removed with the move, and the
          dialog says so.
        </li>
        <li>
          The ledger does not decide whether the Foundation&rsquo;s receipt is still the right
          document for a gift the Foundation&rsquo;s books no longer carry. Confirm that with whoever
          advises the club on tax matters, and mention the move at the next board meeting.
        </li>
        <li>
          <span className="font-semibold">If the gift was already reconciled,</span> the dialog shows
          a checklist instead of the form. It names the reconciliation session, and any later closed
          sessions to reopen first (newest first). Reopening a session can hide the Foundation&rsquo;s
          monthly statements from members until you close the session again. Then unmatch the gift
          from its bank line, come back and move it. Nothing happens automatically.
        </li>
        <li>
          After the move, reconcile the Club deposit: match the Club bank account&rsquo;s deposit line
          to this entry in the Club&rsquo;s reconciliation session, and give the Foundation bank line
          that was freed its right entry before you close that session again.
        </li>
        <li>
          The dialog warns if the Club already has an entry of the same amount within 30 days, in case
          the deposit was recorded on the Club side too. It cannot see a deposit bundled with other
          money, so check the deposit slip.
        </li>
        <li>
          The Foundation&rsquo;s income totals fall by the gift now. When you record the sweep, the
          Foundation&rsquo;s totals count the transfer-in as income, as they do for every sweep, and
          the Foundation side of a sweep gets no acknowledgment letter.
        </li>
        <li>
          Only current-fiscal-year entries can move to the other entity, and the Move button is not
          shown on earlier-year Foundation entries. This is one-way: a Club entry cannot be moved onto
          the Foundation&rsquo;s books.
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
      <p className="mt-2 text-sm text-gray-700">
        If a Club income entry&rsquo;s money is actually in the Foundation&rsquo;s bank account, it
        cannot be moved onto the Foundation&rsquo;s books. Delete the Club entry (the Delete dialog
        says so) and enter the gift on the Foundation&rsquo;s register, in the bank account the money
        landed in.
      </p>

      <p className="mt-5 text-sm">
        <Link href="/admin/ledger" className={linkClass}>
          Open the Ledger Overview to record a transaction &rarr;
        </Link>
      </p>
    </section>
  );
}
