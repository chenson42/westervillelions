"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  isCauseEligibleCategory,
  OTHER_COMMUNITY_SUPPORT_CAUSE,
  formatBudgetReferenceCents,
  resolveBudgetLineDeleteAction,
  MAX_BUDGET_NOTE_LENGTH,
} from "@/lib/ledger";
import BudgetCauseEditor, {
  ALL_CAUSES,
  type BudgetCauseLine,
  type ExitBreakdownReason,
} from "@/components/admin/ledger/budget-cause-editor";

interface BudgetLine {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  budgetCents: number | null;
  /**
   * Sourced from ledgerCategories.countsAsGiving. Drives the "+ add cause"
   * affordance's eligibility gate (isCauseEligibleCategory, B-17 Increment A)
   * — optional/defaulted so callers on older pages that haven't threaded it
   * through yet don't break the type.
   */
  countsAsGiving?: boolean;
  /**
   * null = lump-sum/no breakdown; a non-empty array = this category is
   * already in cause-breakdown mode server-side. Optional/defaulted for the
   * same reason as countsAsGiving. `id`/`label` widened by Labeled Cause
   * Budget Lines (DECISION-047/048); `pendingDeleteAt` widened by the
   * Budgeting Page Restructure (DECISION-054/055/056) — every server-sourced
   * line now carries all of them.
   */
  causeLines?: BudgetCauseLine[] | null;
  /**
   * Read-only prior-year reference columns (2026-07-28-budgeting-page-
   * redesign, Increment 1) — this category/flow's budget and actual from
   * fiscalYear - 1, sourced by the page via a second getFundReport() call.
   * null = no prior-year data (new category or new entity); renders "—".
   * Optional/defaulted so older callers that haven't threaded this through
   * ([fundSlug]/report/page.tsx) don't break the type.
   */
  priorBudgetCents?: number | null;
  priorActualCents?: number | null;
  /**
   * Soft-delete/restore-until-finalize (2026-07-28-budgeting-page-redesign,
   * Increment 2, DECISION-052/053). Non-null = this row is marked for
   * removal and stays visible with a "deleted" treatment until the budget is
   * finalized (Approve & lock), at which point it's purged server-side.
   * Serialized as an ISO string (or null) at the getFundReport boundary.
   * Optional/defaulted so older callers that haven't threaded this through
   * don't break the type. As of the Budgeting Page Restructure this is now
   * checked FIRST, ahead of the breakdown branch — a category can be both
   * pendingDeleteAt AND carry causeLines (Flow 6, category remove available
   * even in breakdown mode), and the deleted treatment must win.
   */
  pendingDeleteAt?: string | null;
  /**
   * Budget Star & Notes (DECISION-057, docs/work-log/2026-07-28-budget-star-
   * notes.md). Star = flag this category for discussion; note = a working
   * text note (≤ MAX_BUDGET_NOTE_LENGTH chars), neither shown to members.
   * Optional/defaulted (false/null) so older callers that haven't threaded
   * these through ([fundSlug]/report/page.tsx) don't break the type —
   * annotation controls only render when showAnnotationControls is true.
   */
  starred?: boolean;
  note?: string | null;
}

/** Read-only reference cell — one of Prior Budget / Prior Actual. */
function ReferenceValue({ label, cents }: { label: string; cents: number | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</p>
      <p className="text-sm tabular-nums text-gray-500 truncate">
        {formatBudgetReferenceCents(cents ?? null)}
      </p>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}

/** Star toggle icon (Budget Star & Notes, DECISION-057) — "flag for
 *  discussion," filled gold when starred, outline gray otherwise. */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 21.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

/** Note icon (Budget Star & Notes, DECISION-057) — opens the inline
 *  textarea; filled blue when a note already exists, outline gray otherwise. */
function NoteIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
      />
    </svg>
  );
}

/** Standard fix for the blur-vs-click race (Gap 4 / DECISION-054 item 1):
 *  suppresses the blur-triggered commit on an adjacent input from ever
 *  queuing when the mousedown target is a control about to consume the
 *  click, so a mid-flight router.refresh() can't detach the exact node the
 *  browser is mid-click on. Applied to every add/remove/restore control in
 *  this file. */
function preventMouseDownDefault(e: React.MouseEvent) {
  e.preventDefault();
}

function parseDollarsToCents(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return 0;
  const n = parseFloat(trimmed);
  return !isNaN(n) && n >= 0 ? Math.round(n * 100) : 0;
}

interface BudgetEditorProps {
  fundId: string;
  fiscalYear: number;
  lines: BudgetLine[];
  /**
   * Single-flow hint (Budgeting Page Restructure — GuidedBudgetSetup now
   * renders one BudgetEditor per Income/Expense section). When set, the
   * redundant per-row INCOME/EXPENSE badge is dropped since the whole editor
   * instance is already scoped to one flow. Optional — callers that render a
   * mixed-flow list (e.g. [fundSlug]/report/page.tsx) omit it and keep the
   * per-row badge.
   */
  flow?: "income" | "expense";
  /**
   * Optional callback fired on every keystroke (before blur/save), keyed the
   * same way as internal state: `${categoryId}_${flow}`, value is the raw
   * dollar-string input. Added for guided budgeting's live balance readout
   * (src/components/admin/ledger/guided-budget-setup.tsx), which needs to
   * recompute income/expense totals as the treasurer types, not just after
   * each PATCH round-trip completes. Optional and backward-compatible —
   * existing callers (e.g. [fundSlug]/report/page.tsx) that don't pass it are
   * unaffected.
   */
  onInputChange?: (key: string, value: string) => void;
  /**
   * When true, every input renders disabled and no commit is attempted —
   * used when the (entity, fiscalYear) budget is locked, or the viewer only
   * holds LEDGER_APPROVE (view-only). This is UI-only defense-in-depth: the
   * real enforcement is the server's assertBudgetUnlocked() 409, which a
   * stale tab can still trigger — handleCommit's existing error handling
   * already surfaces that message via toast unchanged.
   */
  disabled?: boolean;
  /**
   * Shows an explicit trash-icon "remove this line" control per row. Callers
   * should pass true only when the viewer holds LEDGER_MANAGE and the budget
   * is unlocked — this is a separate flag from `disabled` so the parent can
   * reason about them independently (e.g. an approve-only viewer never gets
   * showRemoveControl regardless of lock state).
   */
  showRemoveControl?: boolean;
  /** Prior labels used anywhere in this entity's cause lines — feeds BudgetCauseEditor's `<datalist>` autocomplete. */
  labelOptions?: string[];
  /**
   * Fired the instant a soft-delete or restore click resolves optimistically
   * — before the network round-trip completes — keyed the same way as
   * `onInputChange` (`${categoryId}_${flow}`). Lets GuidedBudgetSetup update
   * its `pendingDeleteKeys` state immediately so the live balance badge
   * excludes the line right away; `router.refresh()` (already called on
   * every successful commit) reconciles it with server truth afterward.
   */
  onPendingDeleteChange?: (key: string, pendingDelete: boolean) => void;
  /**
   * Bubbled straight through to every nested BudgetCauseEditor (Budgeting
   * Page Restructure) — see that component's own doc comment. Keyed the same
   * way as onInputChange/onPendingDeleteChange.
   */
  onCauseLinePendingDeltaChange?: (key: string, deltaCents: number) => void;
  /**
   * Shows star/note annotation controls on every category row (Budget Star &
   * Notes, DECISION-057), wired to PATCH /api/admin/ledger/budgets/annotations.
   * Default false so existing callers that don't opt in
   * ([fundSlug]/report/page.tsx) render unchanged. Unlike showRemoveControl,
   * this is NOT combined with `!locked` by callers — annotations stay
   * editable even when the FY budget is Approve-&-locked (Decision 6); the
   * controls this prop gates ignore `disabled` entirely, on purpose.
   * Bubbled straight through to every nested BudgetCauseEditor so cause-line
   * annotation controls share the same opt-in.
   */
  showAnnotationControls?: boolean;
  /**
   * Fired the instant a star toggle click resolves optimistically — before
   * the round trip completes — keyed like onInputChange
   * (`${categoryId}_${flow}`). Lets GuidedBudgetSetup's sort-to-top react
   * instantly; called again with the previous value if the PATCH fails, so
   * the parent's sort order reverts along with the icon. Optional — only
   * meaningful when showAnnotationControls is true.
   */
  onStarChange?: (key: string, starred: boolean) => void;
  /**
   * Scroll-to-newly-added-category (Budgeting UX Polish, 2026-07-30) — when
   * this matches a row rendered by THIS instance (`${categoryId}_${flow}`),
   * that row is smooth-scrolled into view once the row's ref is attached,
   * then `onScrolledToKey` fires so GuidedBudgetSetup can clear it.
   * GuidedBudgetSetup mounts several BudgetEditor instances at once
   * (income/expense x per-fund); only the instance whose `lines` actually
   * contains the key acts on it, since category ids are unique.
   */
  scrollToKey?: string | null;
  onScrolledToKey?: () => void;
}

/**
 * Inline budget editor rendered within the fund report.
 * Only shown to users with LEDGER_MANAGE (gated in the parent Server Component).
 *
 * Each category row has a dollar input that submits on blur or Enter (spreadsheet UX).
 * Setting an already-saved line's value to empty removes it — soft-delete,
 * not a hard delete (2026-07-28-budgeting-page-redesign, Increment 2,
 * DECISION-052/053): the row stays visible with a "deleted" treatment and a
 * Restore toggle until the budget is finalized. Explicit "0" is a deliberate
 * $0 budget, never a delete. `resolveBudgetLineDeleteAction` (src/lib/ledger.ts)
 * is the single source of truth both the trash-icon control and the
 * blank-then-blur/Enter gesture route through, so a genuinely never-saved
 * blank row stays a true no-op (no network call).
 *
 * Budgeting Page Restructure (DECISION-054/055/056): a giving-eligible
 * expense category's cause breakdown is now entered via "+ add cause" (a
 * one-time-per-cause picker on the category row, replacing the old
 * hard-defaulted "Break down by cause" link) and stays available afterward
 * to start a second/third group. Category removal is now available even
 * while a category is in breakdown mode (the has_cause_breakdown guard was
 * removed server-side) — the render-order fix below (pending-delete checked
 * BEFORE breakdown) is what makes that state show correctly.
 */
export default function BudgetEditor({
  fundId,
  fiscalYear,
  lines,
  flow: singleFlow,
  onInputChange,
  disabled = false,
  showRemoveControl = false,
  labelOptions = [],
  onPendingDeleteChange,
  onCauseLinePendingDeltaChange,
  showAnnotationControls = false,
  onStarChange,
  scrollToKey = null,
  onScrolledToKey,
}: BudgetEditorProps) {
  const router = useRouter();
  // Row DOM refs keyed the same way as `inputs` (`${categoryId}_${flow}`) —
  // feeds the scrollToKey effect below (Budgeting UX Polish, 2026-07-30).
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Track per-line editing state: input value (dollars), saving flag
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const line of lines) {
      const key = `${line.categoryId}_${line.flow}`;
      init[key] = line.budgetCents !== null ? (line.budgetCents / 100).toFixed(2) : "";
    }
    return init;
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  // Local-only override of a category's breakdown/lump-sum rendering mode,
  // keyed the same as `inputs` (`${categoryId}_${flow}`). undefined = defer
  // to the server-sourced `causeLines` field; true/false force one way or
  // the other while a local pre-fill or a just-completed collapse is ahead
  // of the next router.refresh(). See DECISION-046 item 1 — entering
  // breakdown mode is a client-side pre-fill with no dedicated endpoint.
  const [breakdownOverride, setBreakdownOverride] = useState<Record<string, boolean>>({});
  // The cause the treasurer picked for a category's FIRST-ever breakdown
  // group (Budgeting Page Restructure) — used as the pre-fill row's cause
  // instead of a hard OTHER_COMMUNITY_SUPPORT_CAUSE default. Only consulted
  // the instant breakdownOverride flips true for a key that had no
  // server-sourced causeLines yet.
  const [breakdownInitialCause, setBreakdownInitialCause] = useState<Record<string, string>>({});
  // Which category row's "+ add cause" picker is currently open (one at a
  // time, mirrors GuidedBudgetSetup's single-open-add-category-form
  // convention).
  const [addCauseKey, setAddCauseKey] = useState<string | null>(null);
  // Command prop into an already-mounted BudgetCauseEditor: a cause picked
  // for a category ALREADY in breakdown needs to inject a new pending row
  // into the existing editor rather than re-entering breakdown (which only
  // applies to a lump-sum category). Cleared back to null by
  // BudgetCauseEditor once consumed.
  const [requestedNewCause, setRequestedNewCause] = useState<Record<string, string | null>>({});
  // Category-remove-in-breakdown confirm (Flow 6, Chris's decision 2026-07-29):
  // removing a category that carries causes/line items opens a ConfirmDialog
  // naming what it takes with it, unlike the unconfirmed lump-sum remove.
  const [categoryRemoveConfirm, setCategoryRemoveConfirm] = useState<BudgetLine | null>(null);

  // Budget Star & Notes (DECISION-057). Optimistic star state, shadows
  // line.starred until the next router.refresh() reconciles it — lets the
  // filled/outline icon flip instantly and, via onStarChange, lets
  // GuidedBudgetSetup's sort-to-top react before the PATCH resolves.
  const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
  // Which category row's note editor is open — one at a time, mirrors
  // addCauseKey's single-open convention.
  const [noteEditKey, setNoteEditKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteSaving, setNoteSaving] = useState<Record<string, boolean>>({});

  function isStarred(line: BudgetLine): boolean {
    const key = `${line.categoryId}_${line.flow}`;
    return starOverride[key] !== undefined ? starOverride[key] : (line.starred ?? false);
  }

  /**
   * Star toggle — optimistic (flips instantly, before the round trip
   * completes, per Phase 1 Decision 1/Decision 6). Never gated on `disabled`:
   * this endpoint intentionally skips assertBudgetUnlocked (DECISION-057),
   * so the control stays enabled even when the FY budget is locked.
   */
  async function toggleStar(line: BudgetLine) {
    const key = `${line.categoryId}_${line.flow}`;
    const current = isStarred(line);
    const next = !current;
    setStarOverride((prev) => ({ ...prev, [key]: next }));
    onStarChange?.(key, next);
    try {
      const res = await fetch("/api/admin/ledger/budgets/annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId,
          fiscalYear,
          categoryId: line.categoryId,
          flow: line.flow,
          starred: next,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save — try again.");
      }
      router.refresh();
    } catch (err) {
      setStarOverride((prev) => ({ ...prev, [key]: current }));
      onStarChange?.(key, current);
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    }
  }

  function openNoteEditor(line: BudgetLine) {
    const key = `${line.categoryId}_${line.flow}`;
    setNoteDraft(line.note ?? "");
    setNoteEditKey(key);
  }

  function closeNoteEditor() {
    setNoteEditKey(null);
    setNoteDraft("");
  }

  /**
   * Save-button-only (no autosave on blur, deliberately — see Phase 3
   * design). On failure, keeps the editor open with the typed text intact
   * and toasts an error — no silent loss of typed input.
   */
  async function saveNote(line: BudgetLine) {
    const key = `${line.categoryId}_${line.flow}`;
    const trimmed = noteDraft.trim();
    if (trimmed.length > MAX_BUDGET_NOTE_LENGTH) {
      toast.error(`Note is limited to ${MAX_BUDGET_NOTE_LENGTH} characters.`);
      return;
    }
    setNoteSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/ledger/budgets/annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId,
          fiscalYear,
          categoryId: line.categoryId,
          flow: line.flow,
          note: trimmed || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save — try again.");
      }
      closeNoteEditor();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setNoteSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  /**
   * Star/note icon cluster (Budget Star & Notes, DECISION-057) — renders next
   * to the category name in all three render branches (pending-delete,
   * in-breakdown, lump-sum) when showAnnotationControls is true. Deliberately
   * ignores `disabled`: these controls stay enabled even when the FY budget
   * is Approve-&-locked (Decision 6) — the annotation endpoints never call
   * assertBudgetUnlocked.
   */
  function renderAnnotationControls(line: BudgetLine, key: string) {
    if (!showAnnotationControls) return null;
    const starred = isStarred(line);
    const hasNote = !!(line.note && line.note.trim() !== "");
    const noteOpen = noteEditKey === key;
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onMouseDown={preventMouseDownDefault}
          onClick={() => void toggleStar(line)}
          title={starred ? "Unflag for discussion" : "Flag for discussion"}
          aria-label={
            starred
              ? `Unflag ${line.categoryName} for discussion`
              : `Flag ${line.categoryName} for discussion`
          }
          aria-pressed={starred}
          className={`inline-flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            starred ? "text-lions-gold" : "text-gray-300 hover:text-gray-400"
          }`}
        >
          <StarIcon filled={starred} />
        </button>
        <button
          type="button"
          onMouseDown={preventMouseDownDefault}
          onClick={() => (noteOpen ? closeNoteEditor() : openNoteEditor(line))}
          title={hasNote ? "Edit note" : "Add note for discussion"}
          aria-label={
            hasNote ? `Edit note for ${line.categoryName}` : `Add note for ${line.categoryName}`
          }
          aria-expanded={noteOpen}
          className={`inline-flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            hasNote ? "text-lions-blue" : "text-gray-300 hover:text-gray-400"
          }`}
        >
          <NoteIcon filled={hasNote} />
        </button>
      </div>
    );
  }

  /** Inline note editor — a textarea directly under the row, never a modal
   *  (Phase 1 Flow 2). Save-button-only; Cancel discards the draft with no
   *  network call. */
  function renderNoteEditor(line: BudgetLine, key: string) {
    if (!showAnnotationControls || noteEditKey !== key) return null;
    const isSaving = !!noteSaving[key];
    const overLimit = noteDraft.length > MAX_BUDGET_NOTE_LENGTH;
    return (
      <div
        className={`rounded-lg border border-gray-200 bg-gray-50 p-2 mb-2 ${singleFlow ? "" : "sm:ml-20"}`}
      >
        <label htmlFor={`note-${key}`} className="sr-only">
          Note for {line.categoryName} — for discussion, not shown to members
        </label>
        <textarea
          id={`note-${key}`}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={2}
          placeholder="Working note for discussion (not shown to members)…"
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={`text-xs ${overLimit ? "text-red-600" : "text-gray-400"}`}>
            {noteDraft.length}/{MAX_BUDGET_NOTE_LENGTH}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onMouseDown={preventMouseDownDefault}
              onClick={closeNoteEditor}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 rounded px-2 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              Cancel
            </button>
            <button
              type="button"
              onMouseDown={preventMouseDownDefault}
              onClick={() => void saveNote(line)}
              disabled={isSaving || overLimit}
              className="text-xs font-semibold text-white bg-lions-blue hover:bg-lions-blue-dark disabled:opacity-60 rounded-lg px-3 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function handleChange(key: string, value: string) {
    if (disabled) return;
    setInputs((prev) => ({ ...prev, [key]: value }));
    dirtyRef.current[key] = true;
    onInputChange?.(key, value);
  }

  /**
   * The single soft-delete/restore write path (DECISION-052 item 2) — both
   * the trash-icon control and a genuine amount edit's failure path never
   * call this directly for a hard delete; `annualAmountCents: null` is no
   * longer sent by this component for any row that ever existed. Fires
   * `onPendingDeleteChange` optimistically (ahead of the round-trip) so
   * GuidedBudgetSetup's live balance badge updates instantly. Now succeeds
   * on a category in breakdown mode too (Flow 6) — the server's
   * has_cause_breakdown guard on this specific write path was removed as
   * part of the Budgeting Page Restructure.
   */
  async function setPendingDelete(
    categoryId: string,
    flow: "income" | "expense",
    pendingDelete: boolean,
  ) {
    if (disabled) return;
    const key = `${categoryId}_${flow}`;
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/ledger/budgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, pendingDelete }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          data.error ||
          (pendingDelete
            ? "Could not remove this budget line. Try again."
            : "Could not restore this budget line. Try again.");
        throw new Error(message);
      }
      onPendingDeleteChange?.(key, pendingDelete);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this budget line. Try again.");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  /**
   * Core commit — takes the raw dollar string explicitly rather than reading
   * `inputs` state, so the trash-icon control (which needs to commit an
   * empty value the instant it's clicked, before React re-renders) can't
   * race a stale closure the way calling handleCommit() directly would.
   *
   * Routes the blank-vs-amount branch through resolveBudgetLineDeleteAction
   * (DECISION-053 item 3): blank + already-persisted row -> soft-delete;
   * blank + genuinely never-saved row -> true no-op, no network call at all.
   * Everything else is an ordinary Shape A amount write, including an
   * explicit "0" (a deliberate $0 budget, never a delete).
   */
  async function commitValue(categoryId: string, flow: "income" | "expense", rawValue: string) {
    if (disabled) return;
    const key = `${categoryId}_${flow}`;
    const raw = rawValue.trim();
    const currentLine = lines.find((l) => l.categoryId === categoryId && l.flow === flow);
    const hasExistingRow = currentLine ? currentLine.budgetCents !== null : false;

    const action = resolveBudgetLineDeleteAction(hasExistingRow, raw);
    if (action === "soft-delete") {
      await setPendingDelete(categoryId, flow, true);
      return;
    }
    if (raw === "") {
      // Genuinely never-saved row with a blank value — true no-op.
      return;
    }

    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) {
      toast.error("Enter a valid amount (0 or greater) or leave blank to remove the budget.");
      return;
    }
    const annualAmountCents = Math.round(n * 100);
    if (annualAmountCents > 2_147_483_647) {
      toast.error("Budget amount exceeds maximum.");
      return;
    }

    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/ledger/budgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, annualAmountCents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Surfaces the server's exact message, including the 409 lock string
        // ("This budget is locked. Unlock it to make changes.") if a stale
        // tab races a lock — no special-casing needed here.
        throw new Error(data.error || "Failed to update budget.");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save budget. Try again.");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleCommit(categoryId: string, flow: "income" | "expense") {
    const key = `${categoryId}_${flow}`;
    if (!dirtyRef.current[key]) return;
    dirtyRef.current[key] = false;
    await commitValue(categoryId, flow, inputs[key] ?? "");
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    categoryId: string,
    flow: "income" | "expense"
  ) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      handleCommit(categoryId, flow);
    }
  }

  /**
   * Trash-icon control — always resolves through resolveBudgetLineDeleteAction
   * with a blank rawValue (a click is equivalent to blanking the line): an
   * already-persisted row (line.budgetCents !== null) soft-deletes
   * immediately, no confirm (removal is reversible now — DECISION-052/053,
   * and category removal keeps this SAME unconfirmed behavior even in
   * breakdown mode per the Phase 3 design — the persistent Restore control
   * is the safety net, not a confirm dialog). A never-saved row (e.g. an
   * active category getFundReport surfaces with no budget set yet) is a
   * true no-op — there's nothing to remove.
   */
  function requestRemove(line: BudgetLine) {
    if (disabled) return;
    const key = `${line.categoryId}_${line.flow}`;
    if (resolveBudgetLineDeleteAction(line.budgetCents !== null, "") === "noop") return;
    setInputs((prev) => ({ ...prev, [key]: "" }));
    dirtyRef.current[key] = false;
    onInputChange?.(key, "");
    void setPendingDelete(line.categoryId, line.flow, true);
  }

  /** Restore — single click, no confirm; a pending-delete row always has an existing row by definition. */
  function requestRestore(line: BudgetLine) {
    if (disabled) return;
    void setPendingDelete(line.categoryId, line.flow, false);
  }

  /** Causes not yet used on this category — feeds the "+ add cause" picker.
   *  Computed from the server-sourced `causeLines` (not any local-only
   *  uncommitted row), which is the correct source of truth per the Phase 3
   *  design; a not-yet-committed pre-fill row is rare enough at this grain
   *  not to warrant threading BudgetCauseEditor's live state back up. */
  function unusedCauses(line: BudgetLine): string[] {
    const used = new Set((line.causeLines ?? []).map((cl) => cl.cause));
    return ALL_CAUSES.filter((c) => !used.has(c));
  }

  /**
   * Handles a pick from the "+ add cause" control (Budgeting Page
   * Restructure). If the category is still lump-sum, this IS how it enters
   * breakdown mode (mirrors the old "Break down by cause" link, just
   * cause-selected instead of hard-defaulted to
   * OTHER_COMMUNITY_SUPPORT_CAUSE). If the category is already in
   * breakdown, the picked cause is handed to the mounted BudgetCauseEditor
   * via the requestedNewCause command prop, which appends a new pending row
   * for it.
   */
  function pickCause(line: BudgetLine, cause: string) {
    const key = `${line.categoryId}_${line.flow}`;
    setAddCauseKey(null);
    const override = breakdownOverride[key];
    const serverBreakdown = !!(line.causeLines && line.causeLines.length > 0);
    const alreadyInBreakdown = override !== undefined ? override : serverBreakdown;

    if (alreadyInBreakdown) {
      setRequestedNewCause((prev) => ({ ...prev, [key]: cause }));
      return;
    }
    setBreakdownInitialCause((prev) => ({ ...prev, [key]: cause }));
    setBreakdownOverride((prev) => ({ ...prev, [key]: true }));
  }

  /**
   * Reverts a category from BudgetCauseEditor back to the plain lump-sum
   * input. The dollar value to show afterward depends on *how* the
   * breakdown ended:
   *  - "cancelled" / "collapsed": the server-side ledger_budgets total was
   *    never touched (a cancel writes nothing; collapse deliberately leaves
   *    annualAmountCents as-is per DECISION-046 item 2) — restore the
   *    line's original budgetCents unchanged.
   *  - "emptied": retained in the type for BudgetCauseEditor's contract, but
   *    unreachable as of the Budgeting Page Restructure — line-item removal
   *    is now a soft-delete flag-flip that never empties (hard-deletes) the
   *    parent, so this branch has no live caller. Kept defensive (blank
   *    input) rather than removed, in case a future change reintroduces a
   *    path that fires it.
   * dirtyRef is cleared in all cases since the restored value already
   * matches server truth — no redundant PATCH should fire on the next blur.
   */
  function exitBreakdown(line: BudgetLine, reason: ExitBreakdownReason) {
    const key = `${line.categoryId}_${line.flow}`;
    setBreakdownOverride((prev) => ({ ...prev, [key]: false }));
    const restored =
      reason === "emptied" ? "" : line.budgetCents !== null ? (line.budgetCents / 100).toFixed(2) : "";
    setInputs((prev) => ({ ...prev, [key]: restored }));
    dirtyRef.current[key] = false;
    onInputChange?.(key, restored);
  }

  /** Shared "+ add cause" control, rendered on a category row regardless of
   *  breakdown state (Budgeting Page Restructure) — stays visible after use
   *  (not one-shot), offering only the shrinking set of unused causes;
   *  hidden entirely once every cause is in use (defensive — ALL_CAUSES is
   *  finite). */
  function renderAddCauseControl(line: BudgetLine, key: string) {
    if (disabled) return null;
    const eligible = isCauseEligibleCategory({ flow: line.flow, countsAsGiving: line.countsAsGiving });
    if (!eligible) return null;
    const unused = unusedCauses(line);
    const open = addCauseKey === key;

    if (open) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {unused.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={preventMouseDownDefault}
              onClick={() => pickCause(line, c)}
              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:border-lions-blue hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={preventMouseDownDefault}
            onClick={() => setAddCauseKey(null)}
            className="text-xs text-gray-500 hover:text-gray-700 rounded px-2 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Cancel
          </button>
        </div>
      );
    }

    if (unused.length === 0) return null;

    return (
      <button
        type="button"
        onMouseDown={preventMouseDownDefault}
        onClick={() => setAddCauseKey(key)}
        className="inline-flex items-center text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
      >
        + Add cause
      </button>
    );
  }

  /**
   * Scroll-to-newly-added-category (Budgeting UX Polish, 2026-07-30). Fires
   * whenever `scrollToKey` or `lines` changes (a new category only exists in
   * `lines` after the router.refresh() the add flow already triggers).
   * Ref callbacks attach synchronously during the commit that renders the
   * new row, ahead of this (passive) effect, so `rowRefs.current[key]` is
   * already populated by the time this runs. No-ops (and leaves
   * `scrollToKey` set) when this instance doesn't render that key — one of
   * several BudgetEditor instances mounted at once, only the matching one
   * scrolls and clears it via onScrolledToKey.
   */
  useEffect(() => {
    if (!scrollToKey) return;
    const el = rowRefs.current[scrollToKey];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    onScrolledToKey?.();
  }, [scrollToKey, lines, onScrolledToKey]);

  return (
    <div className="space-y-1">
      {lines.map((line) => {
        const key = `${line.categoryId}_${line.flow}`;
        const isSaving = saving[key];
        const override = breakdownOverride[key];
        const serverBreakdown = !!(line.causeLines && line.causeLines.length > 0);
        const inBreakdown = override !== undefined ? override : serverBreakdown;

        // Render-order fix (Budgeting Page Restructure): pending-delete is
        // checked BEFORE breakdown. Once the has_cause_breakdown guard came
        // out server-side, a category can be both pendingDeleteAt AND carry
        // causeLines (Flow 6) — the deleted treatment must win regardless of
        // breakdown state, or a removed-in-breakdown category would silently
        // render its BudgetCauseEditor instead of the Restore-able row.
        if (line.pendingDeleteAt) {
          // Soft-deleted row (DECISION-052/053) — stays visible, clearly
          // "deleted": strikethrough + muted, amount input disabled (this is
          // what prevents an edit-while-pending / re-add collision), trash
          // control replaced by a single-click, no-confirm Restore. Purged
          // for real only when the budget is finalized (Approve & lock).
          // This same block now also covers a category that was in
          // breakdown when removed (Flow 6) — its cause lines stay wherever
          // they are (own pendingDeleteAt untouched, per Ruling 4) and the
          // "(N cause lines)" hint below tells the treasurer what's riding
          // along with this removal at finalize time.
          const causeLineCount = line.causeLines?.length ?? 0;
          return (
            <div
              key={key}
              ref={(el) => {
                rowRefs.current[key] = el;
              }}
              className="space-y-1 py-1 px-2 -mx-2 rounded-lg bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="flex items-center gap-2 flex-wrap">
                {!singleFlow && (
                  <span className="text-xs text-gray-400 w-20 uppercase tracking-wide flex-shrink-0">
                    {line.flow}
                  </span>
                )}
                <span className="text-sm text-gray-500 line-through flex-1 min-w-0 truncate">
                  {line.categoryName}
                </span>
                <span className="inline-flex items-center rounded-lg bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600 whitespace-nowrap">
                  Deleted &mdash; removed when finalized
                  {causeLineCount > 0
                    ? ` (${causeLineCount} cause line${causeLineCount === 1 ? "" : "s"})`
                    : ""}
                </span>
                {renderAnnotationControls(line, key)}
              </div>
              <div className={`flex items-center gap-2 ${singleFlow ? "" : "sm:pl-20"}`}>
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0 sm:flex-none sm:w-52">
                  <ReferenceValue label="Prior Budget" cents={line.priorBudgetCents} />
                  <ReferenceValue label="Prior Actual" cents={line.priorActualCents} />
                </div>
                <div className="relative w-28 flex-shrink-0">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                    $
                  </span>
                  <input
                    type="number"
                    value={inputs[key] ?? ""}
                    disabled
                    readOnly
                    className="block w-full rounded border border-gray-200 bg-gray-100 py-1 pl-6 pr-2 text-sm tabular-nums text-gray-400 line-through"
                    aria-label={`Budget for ${line.categoryName} (${line.flow}), marked for removal`}
                  />
                </div>
                {showRemoveControl && !disabled && (
                  <button
                    type="button"
                    onMouseDown={preventMouseDownDefault}
                    onClick={() => requestRestore(line)}
                    disabled={isSaving}
                    title={`Restore ${line.categoryName} to this year's budget`}
                    aria-label={`Restore ${line.categoryName} (${line.flow}) to this year's budget`}
                    className="inline-flex items-center justify-center rounded-lg px-3 text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] flex-shrink-0 disabled:opacity-60"
                  >
                    {isSaving ? "…" : "Restore"}
                  </button>
                )}
              </div>
              {renderNoteEditor(line, key)}
            </div>
          );
        }

        if (inBreakdown) {
          const fallbackCause = breakdownInitialCause[key] ?? OTHER_COMMUNITY_SUPPORT_CAUSE;
          const initialLines: BudgetCauseLine[] =
            line.causeLines && line.causeLines.length > 0
              ? line.causeLines
              : [
                  {
                    id: null,
                    cause: fallbackCause,
                    label: "",
                    amountCents: parseDollarsToCents(inputs[key]),
                    pendingDeleteAt: null,
                  },
                ];
          return (
            <div
              key={key}
              ref={(el) => {
                rowRefs.current[key] = el;
              }}
              className="rounded-lg border border-gray-100 p-2"
            >
              <div className="flex items-center gap-2 mb-2">
                {!singleFlow && (
                  <span className="text-xs text-gray-500 w-20 uppercase tracking-wide">
                    {line.flow}
                  </span>
                )}
                <span className="text-sm font-medium text-gray-900 flex-1 truncate">
                  {line.categoryName}
                </span>
                {renderAnnotationControls(line, key)}
                {/* Category remove in breakdown mode (Flow 6): unlike the
                    lump-sum branch, this category carries causes/line items,
                    so it opens a ConfirmDialog naming what it takes with it
                    (Chris's decision 2026-07-29). Still reversible via the
                    Restore row until the budget is finalized. */}
                {showRemoveControl && !disabled && (
                  <button
                    type="button"
                    onMouseDown={preventMouseDownDefault}
                    onClick={() => setCategoryRemoveConfirm(line)}
                    title={`Remove ${line.categoryName} from this year's budget`}
                    aria-label={`Remove ${line.categoryName} (${line.flow}) from this year's budget`}
                    className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px] flex-shrink-0"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
              {renderNoteEditor(line, key)}
              <BudgetCauseEditor
                fundId={fundId}
                fiscalYear={fiscalYear}
                categoryId={line.categoryId}
                flow={line.flow}
                initialLines={initialLines}
                pending={!(line.causeLines && line.causeLines.length > 0)}
                disabled={disabled}
                labelOptions={labelOptions}
                onTotalChange={(value) => handleChange(key, value)}
                onExitBreakdown={(reason) => exitBreakdown(line, reason)}
                requestedNewCause={requestedNewCause[key] ?? null}
                onNewCauseRequestHandled={() =>
                  setRequestedNewCause((prev) => ({ ...prev, [key]: null }))
                }
                onPendingDeltaChange={(deltaCents) =>
                  onCauseLinePendingDeltaChange?.(key, deltaCents)
                }
                showAnnotationControls={showAnnotationControls}
              />
              <div className="mt-2 pl-1">{renderAddCauseControl(line, key)}</div>
            </div>
          );
        }

        return (
          <div
            key={key}
            ref={(el) => {
              rowRefs.current[key] = el;
            }}
            className="space-y-1 py-1 border-b border-gray-50 last:border-0"
          >
            <div className="flex items-center gap-2">
              {!singleFlow && (
                <span className="text-xs text-gray-500 w-20 uppercase tracking-wide flex-shrink-0">
                  {line.flow}
                </span>
              )}
              <span className="text-sm text-gray-700 flex-1 truncate">{line.categoryName}</span>
              {renderAnnotationControls(line, key)}
            </div>
            {renderNoteEditor(line, key)}
            {/* Prior-year reference columns (read-only) + this year's input.
                Mobile-first: reference cells share a 2-col grid that shrinks
                with the viewport instead of forcing horizontal scroll at
                360px; sm:pl-20 aligns the group under the category name to
                match the "+ add cause" row below. */}
            <div className={`flex items-center gap-2 ${singleFlow ? "" : "sm:pl-20"}`}>
              <div className="grid grid-cols-2 gap-2 flex-1 min-w-0 sm:flex-none sm:w-52">
                <ReferenceValue label="Prior Budget" cents={line.priorBudgetCents} />
                <ReferenceValue label="Prior Actual" cents={line.priorActualCents} />
              </div>
              <div className="relative w-28 flex-shrink-0">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={inputs[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  onBlur={() => handleCommit(line.categoryId, line.flow)}
                  onKeyDown={(e) => handleKeyDown(e, line.categoryId, line.flow)}
                  disabled={isSaving || disabled}
                  className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm tabular-nums focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                  placeholder="—"
                  aria-label={`Budget for ${line.categoryName} (${line.flow})`}
                />
                {isSaving && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    ...
                  </span>
                )}
              </div>
              {showRemoveControl && !disabled && (
                <button
                  type="button"
                  onMouseDown={preventMouseDownDefault}
                  onClick={() => requestRemove(line)}
                  title={`Remove ${line.categoryName} from this year's budget`}
                  aria-label={`Remove ${line.categoryName} (${line.flow}) from this year's budget`}
                  className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px] flex-shrink-0"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            {!disabled && (
              <div className={singleFlow ? "" : "pl-20"}>{renderAddCauseControl(line, key)}</div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-400 mt-2">
        {disabled
          ? "This budget is locked for editing."
          : "Enter amounts in dollars. Press Enter or click away to save. Enter 0 for a $0 budget. Leave blank to remove — removal is reversible until this budget is finalized."}
      </p>

      {/* Flow 6 — confirm before removing a category that carries a cause
          breakdown (Chris's decision 2026-07-29). The message names how many
          causes / line items go with it; removal stays reversible (Restore)
          until finalize. Lump-sum category removal does NOT route here. */}
      <ConfirmDialog
        open={categoryRemoveConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryRemoveConfirm(null);
        }}
        title={
          categoryRemoveConfirm ? `Remove "${categoryRemoveConfirm.categoryName}"?` : ""
        }
        description={
          categoryRemoveConfirm
            ? (() => {
                const cls = categoryRemoveConfirm.causeLines ?? [];
                const causeCount = new Set(cls.map((cl) => cl.cause)).size;
                const lineCount = cls.length;
                return `This removes "${categoryRemoveConfirm.categoryName}" and its ${causeCount} cause${causeCount === 1 ? "" : "s"} / ${lineCount} line item${lineCount === 1 ? "" : "s"}. It stays as a Restore-able row until this budget is finalized.`;
              })()
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (categoryRemoveConfirm) requestRemove(categoryRemoveConfirm);
          setCategoryRemoveConfirm(null);
        }}
      />
    </div>
  );
}
