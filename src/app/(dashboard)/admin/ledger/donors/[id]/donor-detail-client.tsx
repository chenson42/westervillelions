"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import DonorForm from "@/components/admin/ledger/donor-form";
import AcknowledgeDialog from "@/components/admin/ledger/acknowledge-dialog";
import MarkSentDialog from "@/components/admin/ledger/mark-sent-dialog";
import LinkDonorDialog from "@/components/admin/ledger/link-donor-dialog";
import type { DonorWithGivingHistory } from "@/lib/ledger-queries";

interface DonorDetailClientProps {
  donor: DonorWithGivingHistory;
  canRecord: boolean;
  canManage: boolean;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function AckStatusBadge({ status }: { status: "pending" | "sent" | null }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
        Sent
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200">
      None
    </span>
  );
}

export default function DonorDetailClient({ donor, canRecord, canManage }: DonorDetailClientProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Per-transaction dialogs
  const [acknowledgeFor, setAcknowledgeFor] = useState<string | null>(null);
  const [markSentFor, setMarkSentFor] = useState<string | null>(null);
  const [linkDonorFor, setLinkDonorFor] = useState<{
    txnId: string;
    amountCents: number;
    txnDate: string;
  } | null>(null);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/ledger/donors/${donor.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete donor.");
      }
      toast.success("Donor deleted.");
      router.push("/admin/ledger/donors");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete donor. Try again.");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  const totalGiving = donor.givingHistory.reduce(
    (sum, row) => sum + row.txn.amountCents,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Donor info card */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
              Donor
            </p>
            <h1 className="text-2xl font-bold text-gray-900">{donor.name}</h1>
            {donor.email && (
              <p className="mt-1 text-sm text-gray-600">{donor.email}</p>
            )}
            {donor.address && (
              <p className="mt-1 text-sm text-gray-500 whitespace-pre-line">{donor.address}</p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {canRecord && (
              <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[40px]"
                  >
                    Edit
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                  <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none">
                    <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                      Edit Donor
                    </Dialog.Title>
                    <DonorForm donor={donor} onClose={() => setEditOpen(false)} />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="border-2 border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold hover:border-gray-400 hover:text-gray-800 transition focus:outline-none focus:ring-2 focus:ring-gray-300 min-h-[40px]"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {donor.givingHistory.length > 0 && (
          <div className="border-t border-gray-100 px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Total Giving</p>
              <p className="text-lg font-bold text-green-700 tabular-nums mt-0.5">
                {formatDollars(totalGiving)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Donations</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{donor.givingHistory.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Pending Acks</p>
              <p className="text-lg font-bold text-amber-700 mt-0.5">
                {donor.givingHistory.filter((r) => r.ackStatus === "pending").length}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Giving history */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Giving History</h2>

        {donor.givingHistory.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">No Foundation donations linked yet.</p>
            {canRecord && (
              <p className="mt-1 text-sm">
                Navigate to a Foundation fund transaction and use &ldquo;Link donor&rdquo; to
                associate it with this record.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Fund
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Party / Memo
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Ack Status
                    </th>
                    {canRecord && (
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {donor.givingHistory.map((row) => (
                    <tr key={row.txn.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {row.txn.txnDate}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div>{row.txn.fundName}</div>
                        <div className="text-xs text-gray-400">{row.txn.entityName}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[180px]">
                        <div className="truncate">{row.txn.party ?? <span className="text-gray-300">—</span>}</div>
                        {row.txn.memo && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{row.txn.memo}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-green-700">
                        +{formatDollars(row.txn.amountCents)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <AckStatusBadge status={row.ackStatus} />
                      </td>
                      {canRecord && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            {/* Link donor (for transactions linked to this donor) */}
                            <button
                              type="button"
                              onClick={() =>
                                setLinkDonorFor({
                                  txnId: row.txn.id,
                                  amountCents: row.txn.amountCents,
                                  txnDate: row.txn.txnDate,
                                })
                              }
                              className="text-xs font-medium text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1"
                            >
                              Re-link donor
                            </button>

                            {/* Acknowledge / Mark Sent */}
                            {row.ackStatus === null && row.txn.amountCents >= 25000 && (
                              <button
                                type="button"
                                onClick={() => setAcknowledgeFor(row.txn.id)}
                                className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                              >
                                Acknowledge
                              </button>
                            )}
                            {row.ackStatus === "pending" && (
                              <button
                                type="button"
                                onClick={() => setMarkSentFor(row.txn.id)}
                                className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[32px]"
                              >
                                Mark Sent
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete donor?"
        description={`Deleting "${donor.name}" will unlink them from ${donor.givingHistory.length} donation${donor.givingHistory.length !== 1 ? "s" : ""} and any acknowledgment records. The financial transactions are preserved. This action cannot be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete Donor"}
        destructive
        onConfirm={handleDelete}
      />

      {/* Acknowledge dialog */}
      {acknowledgeFor && (
        <AcknowledgeDialog
          txnId={acknowledgeFor}
          open={true}
          donorId={donor.id}
          onOpenChange={(open) => { if (!open) setAcknowledgeFor(null); }}
        />
      )}

      {/* Mark-sent dialog */}
      {markSentFor && (
        <MarkSentDialog
          txnId={markSentFor}
          open={true}
          onOpenChange={(open) => { if (!open) setMarkSentFor(null); }}
        />
      )}

      {/* Link donor dialog */}
      {linkDonorFor && (
        <LinkDonorDialog
          txnId={linkDonorFor.txnId}
          txnAmountCents={linkDonorFor.amountCents}
          txnDate={linkDonorFor.txnDate}
          currentDonorId={donor.id}
          open={true}
          onOpenChange={(open) => { if (!open) setLinkDonorFor(null); }}
        />
      )}
    </div>
  );
}
