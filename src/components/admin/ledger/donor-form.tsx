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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DonorForm({ donor, onClose, onSuccess }: DonorFormProps) {
  const isEdit = Boolean(donor);
  const router = useRouter();

  const [name, setName] = useState(donor?.name ?? "");
  const [emails, setEmails] = useState<string[]>(donor?.emails ?? []);
  const [emailInput, setEmailInput] = useState("");
  const [address, setAddress] = useState(donor?.address ?? "");
  const [submitting, setSubmitting] = useState(false);

  function addEmail() {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_REGEX.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (emails.includes(trimmed)) {
      toast.error("This donor already has that email address.");
      return;
    }
    setEmails((prev) => [...prev, trimmed]);
    setEmailInput("");
  }

  function removeEmail(target: string) {
    setEmails((prev) => prev.filter((e) => e !== target));
  }

  function handleEmailKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addEmail();
    }
  }

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
      const body: Record<string, string | string[] | undefined> = {
        name: trimmedName,
        emails,
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

      {/* Email addresses — flat list, all equal (no primary/alternate) */}
      <div>
        <label htmlFor="donor-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email Addresses <span className="text-gray-400 font-normal">(optional — add as many as needed)</span>
        </label>
        {emails.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {emails.map((e) => (
              <li
                key={e}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 pl-3 pr-1.5 py-1 text-sm text-gray-700"
              >
                {e}
                <button
                  type="button"
                  onClick={() => removeEmail(e)}
                  aria-label={`Remove ${e}`}
                  className="rounded-lg p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-lions-blue transition"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            id="donor-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={handleEmailKeyDown}
            maxLength={254}
            className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            placeholder="jane@example.com"
          />
          <button
            type="button"
            onClick={addEmail}
            className="whitespace-nowrap rounded-lg border-2 border-lions-blue px-3 py-2 text-sm font-semibold text-lions-blue hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue transition"
          >
            Add
          </button>
        </div>
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
