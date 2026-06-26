"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { LedgerDonor } from "@/lib/db/schema";

interface DonorFormProps {
  /** When provided, the form edits an existing donor. */
  donor?: LedgerDonor;
  onClose: () => void;
  /** Called with the newly created/updated donor on success */
  onSuccess?: (donor: LedgerDonor) => void;
}

/**
 * Create or edit a donor record (name, email, address).
 * Renders inline — the parent wraps it in a modal.
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function DonorForm({ donor, onClose, onSuccess }: DonorFormProps) {
  const isEdit = Boolean(donor);
  const router = useRouter();

  const [name, setName] = useState(donor?.name ?? "");
  const [email, setEmail] = useState(donor?.email ?? "");
  const [address, setAddress] = useState(donor?.address ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Donor name is required.");
      return;
    }
    if (trimmedName.length > 200) {
      toast.error("Donor name must be 200 characters or fewer.");
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const trimmedAddress = address.trim();
    if (trimmedAddress.length > 500) {
      toast.error("Address must be 500 characters or fewer.");
      return;
    }

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/api/admin/ledger/donors/${donor!.id}`
        : `/api/admin/ledger/donors`;
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, string | undefined> = {
        name: trimmedName,
        email: trimmedEmail || undefined,
        address: trimmedAddress || undefined,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          toast.error("A donor with this name and email already exists. Search for them instead.");
          return;
        }
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} donor.`);
      }

      const result = await res.json();
      const savedDonor: LedgerDonor = result.donor ?? result;

      toast.success(isEdit ? "Donor updated." : "Donor created.");
      onSuccess?.(savedDonor);
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save donor. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label htmlFor="donor-name" className="block text-sm font-medium text-gray-700 mb-1">
          Full Name <span className="text-gray-400 font-normal">(required)</span>
        </label>
        <input
          id="donor-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          placeholder="Jane Smith"
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="donor-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="donor-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          placeholder="jane@example.com"
        />
      </div>

      {/* Address */}
      <div>
        <label htmlFor="donor-address" className="block text-sm font-medium text-gray-700 mb-1">
          Mailing Address <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="donor-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          maxLength={500}
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-none"
          placeholder="123 Main St, Westerville, OH 43081"
        />
        <p className="mt-1 text-xs text-gray-400">
          Used for mailing acknowledgment letters. Not shared outside the treasurer team.
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          {submitting ? "Saving…" : isEdit ? "Update Donor" : "Add Donor"}
        </button>
      </div>
    </form>
  );
}
