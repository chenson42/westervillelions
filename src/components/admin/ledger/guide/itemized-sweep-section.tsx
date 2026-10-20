import Link from "next/link";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import { SWEEP_FIFO_LINE } from "../sweep-builder-logic";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Sweeping to the Foundation (guide, B-172 Increment 2b). The itemized sweep:
 * how a batch is built and reviewed, the board's approval, void and why an
 * approved batch cannot be voided, the "already handled" closeout for gifts the
 * earlier single-amount sweep covered, and the FIFO wording. Fund names come
 * from `labels`; this file types none. Donors are not named anywhere in it.
 */
export default function ItemizedSweepSection({ labels }: { labels: FundLabels }) {
  return (
    <section id="itemized-sweep" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Sweeping to the Foundation</h2>
      <p className="mt-2 text-sm text-gray-700">
        Gifts that arrive in {labels.activity} belong to the Foundation. A sweep moves them there one
        gift at a time: the Foundation&rsquo;s books show each gift on its own line, with its original
        date, its donor and its Foundation category, so receipts, donor history and the Form 990
        preparation see what was actually given. On the Club&rsquo;s books the sweep is one transfer
        entry for the batch.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Building a batch
      </h3>
      <ol className="mt-2 space-y-2 text-sm text-gray-700 list-decimal pl-5">
        <li>
          Write the check or make the transfer first. A sweep is recorded after the money moves, so its
          date cannot be in the future (an earlier date is fine).
        </li>
        <li>
          On the {labels.activity} register choose{" "}
          <span className="font-semibold">Sweep to the Foundation</span>, or choose{" "}
          <span className="font-semibold">Record sweep now</span> after moving a gift. Tick the gifts
          that went into the payment. Gifts that cannot be swept are listed under{" "}
          <span className="font-semibold">Held back</span>, each with the reason.
        </li>
        <li>
          Choose <span className="font-semibold">Review</span>. The review shows the Foundation
          category each gift will land in, whether a receipt is still needed, and anything worth a
          second look: a gift from an earlier fiscal year, a month whose statement was already sent, a
          gift with no donor, or a total larger than the {labels.activity} balance.
        </li>
        <li>
          Pick the two bank accounts, type the{" "}
          <span className="font-semibold">amount that reached the bank</span> and the board-minute
          reference, and post. The amount must equal the total of the ticked gifts to the penny; the
          page shows the difference while you type. If it never matches, a gift is missing or extra,
          or fees came out of the payment: fix the selection rather than the amount.
        </li>
      </ol>
      <p className="mt-3 text-sm text-gray-700">
        <span className="font-semibold">Why a gift may look unswept when its dollars are spent.</span>{" "}
        {SWEEP_FIFO_LINE} The sweep follows the gifts you tick, not the dollars, so it is the gift list
        that matters.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Board approval
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          A sweep at or below the board approval threshold (see Ledger settings) posts at once. A larger
          one waits on <Link href="/admin/ledger/approvals" className={linkClass}>Approvals</Link>{" "}
          as a single item.
        </li>
        <li>
          The approver sees a summary only: the number of gifts, the total, the dates, a line per
          category, who recorded it and the minute. No donor, party or memo is shown. One approval or
          rejection decides the whole batch; individual gifts cannot be decided separately.
        </li>
        <li>
          Whoever recorded the sweep cannot approve it. Every approver is emailed when a sweep goes to the
          board; the app says &ldquo;Emailed&rdquo;, never &ldquo;Delivered&rdquo;, because it cannot see
          whether a message arrived.
        </li>
        <li>
          Rejecting a batch frees all of its gifts to be swept again. The rejected batch stays on the
          register as a record.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Voiding a batch
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          Open the batch from the <span className="font-semibold">Batch</span> button on the
          transfer entry (or any swept gift). A person with the Manage Ledger permission can{" "}
          <span className="font-semibold">Void</span> a posted batch with a reason. Voiding removes the
          transfer entry and every copy on the Foundation&rsquo;s books and frees the gifts. The reason
          is kept for the board, so do not type a donor&rsquo;s name.
        </li>
        <li>
          <span className="font-semibold">An approved batch cannot be voided.</span> The board has
          decided it and it is locked. Record a correcting entry on each book instead.
        </li>
        <li>
          A batch also cannot be voided once any of its entries has cleared a bank statement or is
          matched in a reconciliation session (reopen the session and unmatch first), once a receipt
          was sent for one of its gifts (record a refund on the Foundation instead), when it belongs to
          an earlier fiscal year, or when the Foundation has marked a gift&rsquo;s year as filed. The
          dialog says which and what to do.
        </li>
        <li>
          A pending batch is not voided; reject it from Approvals.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Gifts the earlier single-amount sweep already covered
      </h3>
      <p className="mt-2 text-sm text-gray-700">
        Before sweeps were itemized, the October 1, 2026 sweep was recorded as one amount. The gifts it
        carried are still unswept in {labels.activity}. On the Sweep to the Foundation page a person
        with the Manage Ledger permission marks them{" "}
        <span className="font-semibold">already handled</span>, with a reason (do not type a
        family&rsquo;s name), so they leave the list and are never swept twice. A marked gift can be
        unmarked from the collapsed list on the same page if it was marked by mistake.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        After the sweep
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          The transfer entry carries a chip &ldquo;Sweep of N gifts to the Foundation&rdquo;, each
          source gift &ldquo;Swept to the Foundation&rdquo;, and each Foundation copy &ldquo;Swept
          from {labels.activity}&rdquo;. These rows cannot be edited, split, moved or deleted; the
          Batch button opens the summary. A copy keeps its donor link.
        </li>
        <li>
          A receipt that was already sent for a gift is not sent again by the Foundation; the review
          says so.
        </li>
        <li>
          In bank reconciliation, the match picker lists a batch&rsquo;s copies together with{" "}
          <span className="font-semibold">Match this batch</span>, which ticks exactly those entries.
          If the bank line is for the whole batch the total balances; if one copy was matched
          elsewhere the running total will not balance, and the match is refused.
        </li>
        <li>
          On a donor&rsquo;s page, the {labels.activity} gift reads &ldquo;Swept to the Foundation&rdquo;
          and the Foundation copy &ldquo;Swept from {labels.activity}&rdquo;; the giving total counts the
          gift once, from the Foundation copy.
        </li>
      </ul>
    </section>
  );
}
