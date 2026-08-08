"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import DonorForm from "./donor-form";
import type { LedgerDonor } from "@/lib/db/schema";
import { formatEmailList } from "@/lib/utils";

interface DonorListProps {
  donors: LedgerDonor[];
  canRecord: boolean;
  canManage: boolean;
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Client-side searchable donor list with Add/Delete actions.
 * Gate: rendered only to users with LEDGER_RECORD.
 */
export default function DonorList({ donors: initialDonors, canRecord, canManage }: DonorListProps) {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  // Client-side search over the already-fetched donors
  const filtered = search.trim()
    ? initialDonors.filter(
        (d) =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.emails.some((e) => e.toLowerCase().includes(search.toLowerCase())),
      )
    : initialDonors;

  const donorToDelete = deleteId ? initialDonors.find((d) => d.id === deleteId) : null;

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/ledger/donors/${deleteId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete donor.");
      }
      toast.success("Donor deleted.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete donor. Try again.");
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <label htmlFor="donor-search" className="sr-only">
            Search donors
          </label>
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              id="donor-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>
        </div>

        {canRecord && (
          <Dialog.Root open={addOpen} onOpenChange={setAddOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue whitespace-nowrap min-h-[44px]"
              >
                Add Donor
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none">
                <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
                  Add Donor
                </Dialog.Title>
                <Dialog.Description className="text-sm text-gray-500 mb-4">
                  Add a donor to track Foundation giving and acknowledgment requirements.
                </Dialog.Description>
                <DonorForm onClose={() => setAddOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>

      {/* Donor table */}
      {filtered.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          {search.trim() ? (
            <>
              <p className="font-medium">No donors match &ldquo;{search}&rdquo;.</p>
              <button
                onClick={() => setSearch("")}
                className="mt-2 text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                Clear search
              </button>
            </>
          ) : (
            <>
              <p className="font-medium">No donors recorded yet.</p>
              {canRecord && (
                <p className="mt-1 text-sm">
                  Add a donor to start tracking Foundation giving.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Added
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filtered.map((donor) => (
                  <tr key={donor.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <Link
                        href={`/admin/ledger/donors/${donor.id}`}
                        className="text-lions-blue hover:text-lions-blue-dark hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                      >
                        {donor.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatEmailList(donor.emails, 1) ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {formatDate(donor.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <Link
                          href={`/admin/ledger/donors/${donor.id}`}
                          className="text-xs font-medium text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
                        >
                          View
                        </Link>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setDeleteId(donor.id)}
                            className="text-xs font-medium text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete donor?"
        description={
          donorToDelete
            ? `Deleting "${donorToDelete.name}" will unlink them from any donations and acknowledgments. The transaction and acknowledgment records are preserved. This action cannot be undone.`
            : "This action cannot be undone."
        }
        confirmLabel={deleting ? "Deleting…" : "Delete Donor"}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
