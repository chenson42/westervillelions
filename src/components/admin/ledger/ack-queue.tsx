"use client";

import { useState } from "react";
import Link from "next/link";
import type { PendingAcknowledgmentRow } from "@/lib/ledger-queries";
import { ackQueueRowAction } from "@/lib/ack-queue-ui";
import AcknowledgeDialog from "./acknowledge-dialog";
import MarkSentDialog from "./mark-sent-dialog";

interface AckQueueProps {
  rows: PendingAcknowledgmentRow[];
  canRecord: boolean;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Pending acknowledgment queue — Foundation income >= $250 without a sent ack.
 * Each row is in exactly one of two states (see `ackQueueRowAction()` in
 * `@/lib/ack-queue-ui`), and only one action is ever offered per row —
 * offering the wrong one 409s server-side:
 *  1. No acknowledgment yet → "Record acknowledgment" (POST .../acknowledge)
 *     via AcknowledgeDialog.
 *  2. Acknowledgment recorded but not sent → "Mark Sent"
 *     (PATCH .../acknowledge) via MarkSentDialog.
 * (2026-08-08, second increment: previously this always rendered "Record
 * acknowledgment" for every row, so state (2) had no reachable Mark Sent
 * control on this screen.)
 */
export default function AckQueue({ rows, canRecord }: AckQueueProps) {
  // Track which row's dialog is open, by txnId.
  const [acknowledgeFor, setAcknowledgeFor] = useState<string | null>(null);
  const [markSentFor, setMarkSentFor] = useState<string | null>(null);

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
        <p className="font-medium text-green-700">All caught up!</p>
        <p className="mt-1 text-sm">
          All Foundation gifts over $250 have been acknowledged. No pending items.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {rows.length} Foundation gift{rows.length !== 1 ? "s" : ""} over $250{" "}
        {rows.length === 1 ? "requires" : "require"} an acknowledgment letter.
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
                  Donor
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                {canRecord && (
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((row) => {
                // "record" = no acknowledgment exists yet; "mark-sent" = an
                // acknowledgment was already recorded but not yet sent. These
                // are genuinely different states — offering the wrong action
                // 409s (see ack-queue-ui.ts).
                const action = ackQueueRowAction(row.ackId);

                return (
                  <tr key={row.txn.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {row.txn.txnDate}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="font-medium">{row.txn.entityName}</div>
                      <div className="text-xs text-gray-400">{row.txn.fundName}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {row.donor ? (
                        <Link
                          href={`/admin/ledger/donors/${row.donor.id}`}
                          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded text-sm"
                        >
                          {row.donor.name}
                        </Link>
                      ) : (
                        <span className="text-gray-400 text-xs italic">No donor linked</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-green-700">
                      +{formatDollars(row.txn.amountCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {action === "mark-sent" ? (
                        <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-lions-blue border border-blue-200">
                          Acknowledged — not sent
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Pending
                        </span>
                      )}
                    </td>
                    {canRecord && (
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {action === "mark-sent" ? (
                            <button
                              type="button"
                              onClick={() => setMarkSentFor(row.txn.id)}
                              className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                            >
                              Mark Sent
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAcknowledgeFor(row.txn.id)}
                              className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                            >
                              Record acknowledgment
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acknowledge dialog — create the ack record */}
      {acknowledgeFor && (
        <AcknowledgeDialog
          txnId={acknowledgeFor}
          open={true}
          onOpenChange={(open) => { if (!open) setAcknowledgeFor(null); }}
        />
      )}

      {/* Mark-sent dialog — reachable directly from the pending queue when a
          row already has an unsent acknowledgment (2026-08-08 fix). */}
      {markSentFor && (
        <MarkSentDialog
          txnId={markSentFor}
          open={true}
          onOpenChange={(open) => { if (!open) setMarkSentFor(null); }}
        />
      )}

      <p className="text-xs text-gray-400">
        Per IRS Pub. 1771, gifts of $250 or more require a contemporaneous written acknowledgment.
        Record an acknowledgment after sending the letter to the donor.
      </p>
    </div>
  );
}
