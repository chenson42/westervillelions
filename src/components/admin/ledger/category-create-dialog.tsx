"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { EntityCategoryData } from "@/lib/ledger-category-ui";

interface CategoryCreateDialogProps {
  entities: EntityCategoryData[];
  defaultEntityId: string;
  currentFiscalYear: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FLOW_OPTIONS: { value: "income" | "expense"; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

/**
 * "+ New category" — a second entry point onto the SAME existing
 * `POST /api/admin/ledger/categories` the Guided Budgeting inline flow
 * already uses (unchanged by this feature; Treasurer Decision — Flow 3). No
 * new validation, no new endpoint.
 */
export default function CategoryCreateDialog({
  entities,
  defaultEntityId,
  currentFiscalYear,
  open,
  onOpenChange,
}: CategoryCreateDialogProps) {
  const router = useRouter();
  const [entityId, setEntityId] = useState(defaultEntityId);
  const [fundKind, setFundKind] = useState(
    entities.find((e) => e.id === defaultEntityId)?.funds[0]?.kind ?? "",
  );
  const [flow, setFlow] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [countsAsGiving, setCountsAsGiving] = useState(true);
  const [form990Line, setForm990Line] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeEntity = entities.find((e) => e.id === entityId) ?? entities[0];

  function handleEntityChange(nextEntityId: string) {
    setEntityId(nextEntityId);
    const nextEntity = entities.find((e) => e.id === nextEntityId);
    setFundKind(nextEntity?.funds[0]?.kind ?? "");
  }

  function resetForm() {
    setEntityId(defaultEntityId);
    setFundKind(entities.find((e) => e.id === defaultEntityId)?.funds[0]?.kind ?? "");
    setFlow("expense");
    setName("");
    setCountsAsGiving(true);
    setForm990Line("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Category name cannot be empty.");
      return;
    }
    if (!entityId || !fundKind) {
      toast.error("Choose an entity and fund.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/ledger/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          fiscalYear: currentFiscalYear,
          fundKind,
          flow,
          name: name.trim(),
          countsAsGiving,
          form990Line: form990Line.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to create category.");
      }
      toast.success(`Created "${data.name}".`);
      router.refresh();
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create category. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              New Category
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-cat-entity" className="block text-sm font-medium text-gray-700 mb-1">
                  Entity
                </label>
                <select
                  id="new-cat-entity"
                  value={entityId}
                  onChange={(e) => handleEntityChange(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
                >
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.shortName ?? e.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="new-cat-flow" className="block text-sm font-medium text-gray-700 mb-1">
                  Flow
                </label>
                <select
                  id="new-cat-flow"
                  value={flow}
                  onChange={(e) => setFlow(e.target.value as "income" | "expense")}
                  className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
                >
                  {FLOW_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="new-cat-fund" className="block text-sm font-medium text-gray-700 mb-1">
                Fund
              </label>
              <select
                id="new-cat-fund"
                value={fundKind}
                onChange={(e) => setFundKind(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
              >
                {(activeEntity?.funds ?? []).map((f) => (
                  <option key={f.kind} value={f.kind}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="new-cat-name" className="block text-sm font-medium text-gray-700 mb-1">
                Category name
              </label>
              <input
                id="new-cat-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={countsAsGiving}
                onChange={(e) => setCountsAsGiving(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              Counts toward reported community giving
            </label>

            <div>
              <label htmlFor="new-cat-990" className="block text-sm font-medium text-gray-700 mb-1">
                Form 990 line <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="new-cat-990"
                type="text"
                value={form990Line}
                onChange={(e) => setForm990Line(e.target.value)}
                maxLength={120}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="bg-lions-blue text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                {submitting ? "Creating…" : "Create Category"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
