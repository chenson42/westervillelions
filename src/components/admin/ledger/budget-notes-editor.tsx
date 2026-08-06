"use client";

/**
 * Budget-level "Notes & Assumptions" editor (Budgeting Overview/Drill-Down
 * Restructure, DECISION-060). Overview-only — modeled on the existing
 * unlock-reason textarea + explicit Save-button pattern (not autosave-on-
 * blur, avoiding debounce complexity for a low-frequency field).
 *
 * `locked` is deliberately NOT part of the disable gate — a budget-level
 * note is commentary, not a budget figure, mirroring the already-shipped
 * category-star/notes precedent (DECISION-057) at a coarser grain. A board
 * that just approved a budget, or is amending one, still needs to annotate
 * WHY without unlocking the dollar amounts. Do not "fix" this into
 * lock-consistency — see PATCH /api/admin/ledger/budget-notes's own doc
 * comment for the same warning.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import BudgetNotesMarkdown from "@/components/admin/ledger/budget-notes-markdown";

interface BudgetNotesEditorProps {
  entityId: string;
  targetFiscalYear: number;
  /** "" when getBudgetNotes() returned null (never annotated). */
  initialNotes: string;
  canManage: boolean;
}

export default function BudgetNotesEditor({
  entityId,
  targetFiscalYear,
  initialNotes,
  canManage,
}: BudgetNotesEditorProps) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const dirty = notes !== initialNotes;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ledger/budget-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, fiscalYear: targetFiscalYear, notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save notes. Try again.");
      }
      toast.success("Budget notes saved.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save notes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    if (!initialNotes) return null;
    return (
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Notes &amp; Assumptions</h2>
        <BudgetNotesMarkdown className="text-gray-700">{initialNotes}</BudgetNotesMarkdown>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
      <h2 className="text-base font-semibold text-gray-900 mb-1">Notes &amp; Assumptions</h2>
      <p className="text-sm text-gray-500 mb-3">
        Free-text context for the board — key assumptions, why a fund looks the way it does, or
        what to expect for the year. Prints on the front page of the board document. Editable even
        when the budget is locked; this is commentary, not a budget figure.
      </p>
      <label htmlFor="budget-notes" className="sr-only">
        Notes &amp; Assumptions
      </label>
      <textarea
        id="budget-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={5}
        maxLength={4000}
        placeholder="e.g. Assumes dues remain flat vs. FY2025; Scholarship fund plans a $2,000 drawdown for the new endowed award."
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
      />
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {notes.length}/4000 &middot; Markdown supported (headings, **bold**, lists, links,
          tables)
        </p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {saving ? "Saving…" : "Save notes"}
        </button>
      </div>
    </div>
  );
}
