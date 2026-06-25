"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ------------------------------------------------------------------
// ReimbursementSubmitForm
// ------------------------------------------------------------------

/**
 * Two-step form for submitting a reimbursement request:
 *   Step 1: POST file to /api/members/reimbursements/upload → receives { key }
 *   Step 2: POST form data (including receiptStorageKey) to /api/members/reimbursements
 *
 * The browser never receives a blob URL — only an opaque storage key (DECISION-020).
 *
 * No fund picker — treasurer assigns fund at pay time (R-3).
 */
export function ReimbursementSubmitForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [cause, setCause] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Receipt file must be 10 MB or smaller.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation
    const amountNum = parseFloat(amount.replace(/[$,]/g, "").trim());
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Amount must be greater than $0.");
      return;
    }
    if (amountNum > 10_000) {
      toast.error("Reimbursement amount cannot exceed $10,000.");
      return;
    }
    const amountCents = Math.round(amountNum * 100);

    if (!description.trim()) {
      toast.error("Please describe what you are requesting reimbursement for.");
      return;
    }
    if (description.trim().length > 1000) {
      toast.error("Description must be 1000 characters or fewer.");
      return;
    }

    if (!selectedFile) {
      toast.error("A receipt file is required. Please attach a PDF, JPEG, or PNG.");
      return;
    }

    setUploading(true);
    let receiptStorageKey: string;
    try {
      // Step 1: Upload the receipt file
      const formData = new FormData();
      formData.append("file", selectedFile);

      const uploadRes = await fetch("/api/members/reimbursements/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to upload receipt. Please try again.");
      }

      const uploadData = await uploadRes.json();
      receiptStorageKey = uploadData.key as string;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Receipt upload failed. Please try again.");
      setUploading(false);
      return;
    } finally {
      setUploading(false);
    }

    // Step 2: Submit the reimbursement request
    setSubmitting(true);
    try {
      const res = await fetch("/api/members/reimbursements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents,
          description: description.trim(),
          beneficiaryCause: cause.trim() || undefined,
          receiptStorageKey,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit reimbursement request.");
      }

      toast.success("Reimbursement request submitted. The board will review it shortly.");
      // Reset form
      setAmount("");
      setDescription("");
      setCause("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not submit request. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = uploading || submitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Amount */}
      <div>
        <label htmlFor="reimb-amount" className="block text-sm font-medium text-gray-700 mb-1">
          Amount ($)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
            $
          </span>
          <input
            id="reimb-amount"
            type="number"
            min="0.01"
            max="10000"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            disabled={busy}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            placeholder="0.00"
          />
        </div>
        <p className="mt-1 text-xs text-gray-400">Maximum $10,000 per request.</p>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="reimb-description" className="block text-sm font-medium text-gray-700 mb-1">
          What was this expense for?
        </label>
        <textarea
          id="reimb-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={1000}
          required
          disabled={busy}
          placeholder="Describe the expense and the purpose (e.g., supplies for the Rudolph Run event)"
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">{description.length}/1000 characters</p>
      </div>

      {/* Beneficiary cause (optional) */}
      <div>
        <label htmlFor="reimb-cause" className="block text-sm font-medium text-gray-700 mb-1">
          Related cause or program{" "}
          <span className="text-gray-400 font-normal text-xs">(optional)</span>
        </label>
        <input
          id="reimb-cause"
          type="text"
          value={cause}
          onChange={(e) => setCause(e.target.value)}
          maxLength={200}
          disabled={busy}
          placeholder="e.g., Rudolph Run, Vision Care, Youth Scholarship"
          className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
        />
      </div>

      {/* Receipt upload */}
      <div>
        <label htmlFor="reimb-receipt" className="block text-sm font-medium text-gray-700 mb-1">
          Receipt <span className="text-gray-400 font-normal text-xs">(required — PDF, JPEG, or PNG, max 10 MB)</span>
        </label>
        <input
          id="reimb-receipt"
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          required
          disabled={busy}
          className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-lions-blue file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-lions-blue-dark file:transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
          aria-describedby="reimb-receipt-hint"
        />
        <p id="reimb-receipt-hint" className="mt-1 text-xs text-gray-400">
          {selectedFile
            ? `Selected: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(0)} KB)`
            : "No file selected"}
        </p>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        {uploading
          ? "Uploading receipt…"
          : submitting
          ? "Submitting request…"
          : "Submit Reimbursement Request"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------
// WithdrawButton — DELETEs a submitted reimbursement via ConfirmDialog
// ------------------------------------------------------------------

interface WithdrawButtonProps {
  reimbursementId: string;
  description: string;
}

export function WithdrawButton({ reimbursementId, description }: WithdrawButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleWithdraw() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/members/reimbursements/${reimbursementId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to withdraw request.");
      }
      toast.success("Reimbursement request withdrawn.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw request. Try again.");
    } finally {
      setDeleting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={deleting}
        className="text-sm font-medium text-gray-500 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-2 py-1 disabled:opacity-60"
      >
        Withdraw
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw reimbursement request?"
        description={`This will cancel your request for "${description.slice(0, 80)}${description.length > 80 ? "…" : ""}". You can submit a new request at any time.`}
        confirmLabel="Withdraw"
        destructive
        onConfirm={handleWithdraw}
      />
    </>
  );
}
