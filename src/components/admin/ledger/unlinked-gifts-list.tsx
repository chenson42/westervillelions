"use client";

import { useState } from "react";
import type { UnlinkedGiftRow } from "@/lib/ledger-queries";
import { formatCalendarDate } from "@/lib/format-date";
import LinkDonorDialog from "./link-donor-dialog";

interface UnlinkedGiftsListProps {
  rows: UnlinkedGiftRow[];
  canRecord: boolean;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * "Unlinked Gifts" worklist — Foundation income transactions with no donor
 * linked, any amount, any income category (including ackNotRequired-flagged
 * ones — the Treasurer's explicit decision), excluding internal transfers.
 * See listUnlinkedGifts() in @/lib/ledger-queries for the exact filter.
 *
 * Deliberately mirrors AckQueue's table structure, not DonorList's — both
 * are Foundation-income-row lists with an inline Link Donor action; there is
 * no card-row precedent on this page (docs/work-log/
 * 2026-09-22-donor-worklist-and-any-amount-ack.md, Phase 3 Verification
 * Note). No Status/Action column — this list has no ack-state machine, only
 * a link action.
 */
export default function UnlinkedGiftsList({ rows, canRecord }: UnlinkedGiftsListProps) {
  const [linkDonorFor, setLinkDonorFor] = useState<UnlinkedGiftRow | null>(null);

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <svg
          className="mx-auto h-12 w-12 text-green-400 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium text-green-700">No unlinked Foundation gifts.</p>
        <p className="mt-1 text-sm">Every posted gift in this range has a donor attached.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {rows.length} Foundation gift{rows.length !== 1 ? "s" : ""} with no donor linked.
      </p>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Entity / Fund
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Donor
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((row) => (
                <tr key={row.txn.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {formatCalendarDate(row.txn.txnDate)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <div className="font-medium">{row.txn.entityName}</div>
                    <div className="text-xs text-gray-400">{row.txn.fundName}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {row.txn.categoryName ?? <span className="text-gray-400">&mdash;</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {canRecord ? (
                      <button
                        type="button"
                        onClick={() => setLinkDonorFor(row)}
                        className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                      >
                        Link donor
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs italic">No donor linked</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-green-700">
                    +{formatDollars(row.txn.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {linkDonorFor && (
        <LinkDonorDialog
          txnId={linkDonorFor.txn.id}
          txnAmountCents={linkDonorFor.txn.amountCents}
          txnDate={String(linkDonorFor.txn.txnDate)}
          currentDonorId={null}
          open={true}
          onOpenChange={(open) => { if (!open) setLinkDonorFor(null); }}
        />
      )}
    </div>
  );
}
