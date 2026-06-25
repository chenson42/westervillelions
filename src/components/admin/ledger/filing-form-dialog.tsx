"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface FilingFormDialogProps {
  entityId: string;
  fiscalYear: number;
  children: React.ReactNode;
}

/**
 * Dialog for adding a new one-off compliance filing.
 * Gated: only rendered for LEDGER_MANAGE users.
 * Calls POST /api/admin/ledger/filings.
 */
export default function FilingFormDialog({
  entityId,
  fiscalYear,
  children,
}: FilingFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [agency, setAgency] = useState("");
  const [title, setTitle] = useState("");
  const [dueMonth, setDueMonth] = useState("11");
  const [dueDay, setDueDay] = useState("15");
  const [recurrence, setRecurrence] = useState<"annual" | "5_year">("annual");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleOpen(val: boolean) {
    if (val) {
      setAgency("");
      setTitle("");
      setDueMonth("11");
      setDueDay("15");
      setRecurrence("annual");
      setNote("");
      setErrors({});
    }
    setOpen(val);
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!agency.trim()) e.agency = "Agency is required.";
    else if (agency.length > 100) e.agency = "Max 100 characters.";
    if (!title.trim()) e.title = "Title is required.";
    else if (title.length > 200) e.title = "Max 200 characters.";
    const m = parseInt(dueMonth, 10);
    if (isNaN(m) || m < 1 || m > 12) e.dueMonth = "Month must be 1–12.";
    const d = parseInt(dueDay, 10);
    if (isNaN(d) || d < 1 || d > 31) e.dueDay = "Day must be 1–31.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/ledger/filings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          fiscalYear,
          agency: agency.trim(),
          title: title.trim(),
          dueMonth: parseInt(dueMonth, 10),
          dueDay: parseInt(dueDay, 10),
          recurrence,
          note: note.trim() || undefined,
        }),
      });

      if (res.status === 409) {
        toast.error("A filing with this agency and title already exists for this entity and year.");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to add filing.");
      }

      toast.success("Filing added.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add filing.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            Add Filing
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-500">
            Add a one-off compliance filing to this fiscal year&apos;s calendar.
          </Dialog.Description>

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {/* Agency */}
            <div>
              <label htmlFor="f-agency" className="block text-sm font-medium text-gray-700 mb-1">
                Agency
              </label>
              <input
                id="f-agency"
                type="text"
                maxLength={100}
                value={agency}
                onChange={(e) => { setAgency(e.target.value); setErrors((p) => ({ ...p, agency: "" })); }}
                placeholder="e.g. Ohio AG"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              {errors.agency && <p className="mt-1 text-xs text-red-600">{errors.agency}</p>}
            </div>

            {/* Title */}
            <div>
              <label htmlFor="f-title" className="block text-sm font-medium text-gray-700 mb-1">
                Title
              </label>
              <input
                id="f-title"
                type="text"
                maxLength={200}
                value={title}
                onChange={(e) => { setTitle(e.target.value); setErrors((p) => ({ ...p, title: "" })); }}
                placeholder="e.g. Ohio AG Annual Report"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
            </div>

            {/* Due Month + Day */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="f-due-month" className="block text-sm font-medium text-gray-700 mb-1">
                  Due month (1–12)
                </label>
                <input
                  id="f-due-month"
                  type="number"
                  min={1}
                  max={12}
                  value={dueMonth}
                  onChange={(e) => { setDueMonth(e.target.value); setErrors((p) => ({ ...p, dueMonth: "" })); }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
                />
                {errors.dueMonth && <p className="mt-1 text-xs text-red-600">{errors.dueMonth}</p>}
              </div>
              <div>
                <label htmlFor="f-due-day" className="block text-sm font-medium text-gray-700 mb-1">
                  Due day (1–31)
                </label>
                <input
                  id="f-due-day"
                  type="number"
                  min={1}
                  max={31}
                  value={dueDay}
                  onChange={(e) => { setDueDay(e.target.value); setErrors((p) => ({ ...p, dueDay: "" })); }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
                />
                {errors.dueDay && <p className="mt-1 text-xs text-red-600">{errors.dueDay}</p>}
              </div>
            </div>

            {/* Recurrence */}
            <div>
              <label htmlFor="f-recurrence" className="block text-sm font-medium text-gray-700 mb-1">
                Recurrence
              </label>
              <select
                id="f-recurrence"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as "annual" | "5_year")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <option value="annual">Annual</option>
                <option value="5_year">Every 5 years</option>
              </select>
            </div>

            {/* Note */}
            <div>
              <label htmlFor="f-note" className="block text-sm font-medium text-gray-700 mb-1">
                Note{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="f-note"
                maxLength={1000}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue resize-none"
              />
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              >
                {submitting ? "Adding…" : "Add Filing"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
