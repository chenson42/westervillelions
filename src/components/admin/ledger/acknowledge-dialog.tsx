"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import type { LedgerDonor } from "@/lib/db/schema";
import { formatEmailList } from "@/lib/utils";
import GiftPurposeField from "./gift-purpose-field";

interface AcknowledgeDialogProps {
  txnId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected donor id (optional) */
  donorId?: string;
  /** Called on successful ack creation */
  onSuccess?: () => void;
}

/**
 * Dialog to create an acknowledgment record for a Foundation income transaction.
 * POSTs to /api/admin/ledger/transactions/[id]/acknowledge.
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function AcknowledgeDialog({
  txnId,
  open,
  onOpenChange,
  donorId: initialDonorId,
  onSuccess,
}: AcknowledgeDialogProps) {
  const router = useRouter();
  const [donorId, setDonorId] = useState(initialDonorId ?? "");
  const [qppCents, setQppCents] = useState(""); // quid-pro-quo value in dollars
  const [qppDescription, setQppDescription] = useState(""); // e.g. "one Rudolph Run 5K entry"
  const [purpose, setPurpose] = useState(""); // e.g. "the 2026 Rudolph Run"
  const [typeOverride, setTypeOverride] = useState<"" | "written_ack_250" | "quid_pro_quo_75">("");
  const [submitting, setSubmitting] = useState(false);

  // Donor typeahead state
  const [donorSearch, setDonorSearch] = useState("");
  const [donorResults, setDonorResults] = useState<LedgerDonor[]>([]);
  const [selectedDonor, setSelectedDonor] = useState<LedgerDonor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Resolve a pre-selected donor (passed by id) to a record so we can show its name
  useEffect(() => {
    if (!open || !initialDonorId || selectedDonor) return;
    const controller = new AbortController();
    fetch(`/api/admin/ledger/donors/${initialDonorId}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((donor) => {
        if (donor?.id) setSelectedDonor(donor as LedgerDonor);
      })
      .catch(() => { /* aborted */ });
    return () => controller.abort();
  }, [open, initialDonorId, selectedDonor]);

  // Fetch matching donors as the user types (debounced), only while searching
  useEffect(() => {
    if (!open || selectedDonor) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      const params = donorSearch.trim() ? `?search=${encodeURIComponent(donorSearch.trim())}` : "";
      fetch(`/api/admin/ledger/donors${params}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setDonorResults(data.donors ?? []);
        })
        .catch(() => { /* aborted */ });
    }, 200);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [open, donorSearch, selectedDonor]);

  function selectDonor(donor: LedgerDonor) {
    setSelectedDonor(donor);
    setDonorId(donor.id);
    setSearchOpen(false);
    setDonorSearch("");
  }

  function clearDonor() {
    setSelectedDonor(null);
    setDonorId("");
    setSearchOpen(false);
  }

  function parseDollars(v: string): number | null {
    const n = parseFloat(v.replace(/[$,]/g, "").trim());
    if (isNaN(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body: Record<string, string | number | undefined> = {};
    if (donorId.trim()) body.donorId = donorId.trim();
    if (typeOverride) body.typeOverride = typeOverride;

    const qppValue = qppCents.trim() ? parseDollars(qppCents) : null;
    if (qppCents.trim() && qppValue === null) {
      toast.error("Enter a valid quid-pro-quo value (dollar amount).");
      return;
    }
    if (qppValue !== null) body.quidProQuoValueCents = qppValue;
    if (qppDescription.trim()) body.quidProQuoDescription = qppDescription.trim();
    // Omitted entirely when blank — the server normalizes blank to NULL either
    // way, but sending nothing keeps "no purpose" and "empty purpose" the same
    // request.
    if (purpose.trim()) body.purpose = purpose.trim();

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          toast.warning("An acknowledgment record already exists for this transaction. Use Mark Sent to complete it.");
          onOpenChange(false);
          return;
        }
        if (res.status === 422) {
          toast.error(data.error || "This transaction does not meet the threshold for an acknowledgment.");
          return;
        }
        throw new Error(data.error || "Failed to create acknowledgment.");
      }

      toast.success("Acknowledgment recorded. Use Mark Sent once the letter has been delivered.");
      onSuccess?.();
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record acknowledgment. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Record Acknowledgment
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Create an acknowledgment record for this Foundation donation. After sending the letter
            to the donor, use &ldquo;Mark Sent&rdquo; to close it out.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Donor typeahead — search by name or email, or leave blank */}
            <div>
              <label htmlFor="ack-donor-search" className="block text-sm font-medium text-gray-700 mb-1">
                Donor <span className="text-gray-400 font-normal">(optional — link to a donor record)</span>
              </label>

              {selectedDonor ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{selectedDonor.name}</p>
                    {formatEmailList(selectedDonor.emails) && (
                      <p className="truncate text-xs text-gray-400">
                        {formatEmailList(selectedDonor.emails)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={clearDonor}
                    className="whitespace-nowrap text-xs font-medium text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded transition"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    id="ack-donor-search"
                    type="search"
                    autoComplete="off"
                    value={donorSearch}
                    onChange={(e) => {
                      setDonorSearch(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                    placeholder="Search by name or email…"
                  />
                  {searchOpen && donorResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                      {donorResults.map((donor) => (
                        <li key={donor.id}>
                          <button
                            type="button"
                            onClick={() => selectDonor(donor)}
                            className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition"
                          >
                            <span className="text-sm font-medium text-gray-900">{donor.name}</span>
                            {formatEmailList(donor.emails) && (
                              <span className="text-xs text-gray-400">{formatEmailList(donor.emails)}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {searchOpen && donorSearch.trim() && donorResults.length === 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400 shadow-lg">
                      No donors match &ldquo;{donorSearch.trim()}&rdquo;.
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Leave blank to record the acknowledgment without linking a donor record.
              </p>
            </div>

            {/* Gift purpose — optional donor-facing prose folded into the
                letter's confirmation sentence. Editable later (while unsent)
                from the pending queue, so leaving it blank here is never a
                dead end. */}
            <GiftPurposeField id="ack-purpose" value={purpose} onChange={setPurpose} />

            {/* Quid-pro-quo value */}
            <div>
              <label htmlFor="ack-qpp" className="block text-sm font-medium text-gray-700 mb-1">
                Quid-Pro-Quo Value <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  id="ack-qpp"
                  type="number"
                  min="0"
                  step="0.01"
                  value={qppCents}
                  onChange={(e) => setQppCents(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  placeholder="0.00"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Enter the fair-market value of any goods or services given in exchange (e.g., $75
                for a gala dinner ticket). Leave blank if the gift was fully charitable.
              </p>
            </div>

            {/* Description of goods/services — only meaningful once a quid-pro-quo value is
                entered; IRS Pub. 1771 requires a DESCRIPTION of what the donor received, not just
                its value. Falls back to generic "goods or services" wording in generated letters
                when left blank, so this is never a hard block — just less specific. */}
            {qppCents.trim() && (
              <div>
                <label htmlFor="ack-qpp-description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description of Goods/Services Provided{" "}
                  <span className="text-lions-blue font-normal">(required)</span>
                </label>
                <input
                  id="ack-qpp-description"
                  type="text"
                  value={qppDescription}
                  onChange={(e) => setQppDescription(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  placeholder="e.g., one Rudolph Run 5K entry"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Because this gift has a value given in return, IRS Pub. 1771 requires the
                  acknowledgment to <strong>describe</strong> what the donor received — not just its
                  dollar value. Left blank, the letter falls back to generic &ldquo;goods or
                  services&rdquo; wording, which may not satisfy that requirement.
                </p>
              </div>
            )}

            {/* Type override */}
            <div>
              <label htmlFor="ack-type" className="block text-sm font-medium text-gray-700 mb-1">
                Acknowledgment Type Override <span className="text-gray-400 font-normal">(optional — auto-derived from amount)</span>
              </label>
              <select
                id="ack-type"
                value={typeOverride}
                onChange={(e) => setTypeOverride(e.target.value as "" | "written_ack_250" | "quid_pro_quo_75")}
                className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Auto-detect from amount</option>
                <option value="written_ack_250">Written acknowledgment ($250+)</option>
                <option value="quid_pro_quo_75">Quid-pro-quo disclosure ($75+ FMV)</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Saving…" : "Record Acknowledgment"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
