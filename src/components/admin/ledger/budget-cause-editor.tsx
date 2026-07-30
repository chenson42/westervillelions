"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BUDGET_CAUSES,
  OTHER_COMMUNITY_SUPPORT_CAUSE,
  MAX_BUDGET_LINE_LABEL_LENGTH,
  MAX_BUDGET_NOTE_LENGTH,
  sumBudgetCauseLines,
  formatBudgetReferenceCents,
} from "@/lib/ledger";

export const ALL_CAUSES: readonly string[] = [...BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE];
const CAUSE_LINES_URL = "/api/admin/ledger/budgets/cause-lines";
const CAUSE_GROUP_URL = "/api/admin/ledger/budgets/cause-lines/group";
const CAUSE_LINE_ANNOTATIONS_URL = "/api/admin/ledger/budgets/cause-lines/annotations";
// sonner's own default toast visible duration is 4000ms — this needs an
// explicit override so the Undo countdown and the toast's own dismissal line
// up (Component Plan / DECISION-055 item 1): otherwise the toast could
// disappear while the hold is still live, leaving Undo with nothing to click.
const HOLD_MS = 6000;

export interface BudgetCauseLine {
  /** null only for a client-side pending pre-fill row that's never been saved. */
  id: string | null;
  cause: string;
  label: string;
  amountCents: number;
  /**
   * Read-only prior-year reference columns (2026-07-28-causeline-prior-year-
   * reference — extends the category-grain reference from
   * 2026-07-28-budgeting-page-redesign Increment 1 down to this cause/
   * beneficiary line). Sourced by the page from a second getFundReport() call
   * at fiscalYear - 1, matched by `(categoryId, cause, label)` via
   * `causeLineReferenceKey`. null = no prior-year data (new line, new
   * category, or a manually-typed label with no matching prior-FY party) —
   * renders "—". Optional/defaulted so a never-saved client-side row (the
   * "+ add cause" pre-fill, or a freshly added line) doesn't need to supply
   * them.
   */
  priorBudgetCents?: number | null;
  priorActualCents?: number | null;
  /**
   * Soft-delete/restore-until-finalize at the line-item grain (Budgeting Page
   * Restructure, DECISION-054/055/056) — non-null = this line is individually
   * marked for removal (independent of its parent category's own flag).
   * Optional/defaulted so a never-saved client-side row doesn't need to
   * supply it (always null for those).
   */
  pendingDeleteAt?: string | null;
  /**
   * Budget Star & Notes (DECISION-057, docs/work-log/2026-07-28-budget-star-
   * notes.md). Optional/defaulted (false/null) — a never-saved client-side
   * pre-fill row (id === null) has nothing to star/note against yet, so
   * these are always absent for that case.
   */
  starred?: boolean;
  note?: string | null;
}

interface Row {
  /** null = never saved to the server — a fresh/pending row (mirrors B-17's `committedCause` convention, but keyed correctly now that cause can repeat). */
  id: string | null;
  cause: string;
  label: string;
  /** Dollar-string value of the amount input, e.g. "125.00". */
  value: string;
  saving: boolean;
  /** Fixed at seed time from `initialLines` — read-only reference, never
   *  recomputed as the treasurer edits label/amount (see BudgetCauseLine's
   *  doc comment). null for a client-side-only row (a fresh "+ add line
   *  item" or the "+ add cause" pre-fill). */
  priorBudgetCents: number | null;
  priorActualCents: number | null;
  /** Server-committed pending-delete state (own flag) — struck-through +
   *  Restore, same visual treatment BudgetEditor already gives a
   *  pending-delete category row. */
  pendingDeleteAt: string | null;
  /** Client-only "toast is counting down" state — visually identical to
   *  pendingDeleteAt !== null, but Undo here is a pure clearTimeout, no
   *  network call ever fires if clicked in time. */
  holdingForDelete: boolean;
  /** Budget Star & Notes (DECISION-057) — always false/null for a never-saved
   *  row (id === null); the annotation controls are hidden until the row has
   *  a committed id (see Edge Cases in the Phase 3 design). */
  starred: boolean;
  note: string | null;
}

/** A row renders "dead" (struck-through, inputs disabled, excluded from every
 *  on-screen total) when EITHER its own committed flag or its client-only
 *  hold is set — the two look identical, they differ only in what the
 *  Undo/Restore control does (see startHold/restoreCommittedLine). */
function isRowDead(row: Row): boolean {
  return row.pendingDeleteAt !== null || row.holdingForDelete;
}

export type ExitBreakdownReason = "cancelled" | "collapsed" | "emptied";

interface BudgetCauseEditorProps {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  /**
   * Seed rows for local state. Either the server-confirmed breakdown
   * (`pending: false`, every row has an `id`) or a single client-side
   * pre-fill row (`pending: true`, `id: null`, cause = the treasurer's pick
   * from the category row's "+ add cause" control) — see budget-editor.tsx's
   * `pickCause` handler. Never empty.
   */
  initialLines: BudgetCauseLine[];
  /** True when initialLines is a local pre-fill that hasn't been saved yet. */
  pending: boolean;
  /** Locked-budget defense-in-depth — mirrors BudgetEditor's own `disabled` prop. */
  disabled?: boolean;
  /** Prior labels used anywhere in this entity's cause lines — feeds the `<datalist>` autocomplete. */
  labelOptions?: string[];
  /**
   * Live dollar-string total, fired on every amount keystroke (not just on
   * commit) — the parent forwards this into its own onInputChange, which is
   * what keeps GuidedBudgetSetup's fundSums/balance readout live while the
   * treasurer types, matching BudgetEditor's own per-keystroke behavior.
   * Never fired for a remove/undo/restore transition alone (Budgeting Page
   * Restructure) — those don't change the category's gross total (a
   * soft-deleted line's amountCents is never touched, mirroring Ruling 1),
   * they only change causeLinePendingCents via onPendingDeltaChange below.
   */
  onTotalChange?: (totalDollarString: string) => void;
  /**
   * Fired when this category should stop rendering as a breakdown and
   * revert to a plain lump-sum input — either the treasurer cancelled an
   * unsaved pre-fill or explicitly collapsed a real breakdown back to a lump
   * sum. ("emptied" is retained in the type for the exit-breakdown contract
   * but is no longer reachable from this component now that line-item
   * removal is a soft-delete, not a hard delete that could empty the parent.)
   */
  onExitBreakdown: (reason: ExitBreakdownReason) => void;
  /**
   * Command prop from BudgetEditor's category-row "+ add cause" control
   * (Budgeting Page Restructure) — a non-null value means the treasurer just
   * picked a NEW cause to start a second/third group on a category already
   * in breakdown. Consumed once via a useEffect (appends a fresh pending row
   * for that cause), then the parent is asked to clear it back to null via
   * onNewCauseRequestHandled so a stale value can't re-trigger on an
   * unrelated re-render.
   */
  requestedNewCause?: string | null;
  onNewCauseRequestHandled?: () => void;
  /**
   * Fired the instant a line/group removal starts its hold (or resolves) or
   * an undo/restore reverses it — BEFORE any round trip completes — with the
   * dollar delta (in cents) to apply to this category's live total upstream
   * (GuidedBudgetSetup's causeLinePendingCents, computeFundLineSums's third
   * parameter). Positive = a removal (subtract this many cents from the
   * category's live balance); negative = an undo/restore (add it back).
   * Optional so callers that don't need the cross-cutting live total (e.g.
   * the plain [fundSlug]/report/page.tsx) can omit it.
   */
  onPendingDeltaChange?: (deltaCents: number) => void;
  /**
   * Shows star/note annotation controls on each committed line (Budget Star
   * & Notes, DECISION-057), wired to PATCH
   * /api/admin/ledger/budgets/cause-lines/annotations. Bubbled straight
   * through from BudgetEditor's own showAnnotationControls prop — default
   * false so [fundSlug]/report/page.tsx's BudgetEditor (which doesn't opt
   * in) never shows these here either, even for a category already in
   * breakdown mode.
   */
  showAnnotationControls?: boolean;
}

/** Read-only reference cell — one of Prior Budget / Prior Actual. Mirrors
 *  BudgetEditor's own `ReferenceValue` (2026-07-28-budgeting-page-redesign,
 *  Increment 1) so the two grains look identical. */
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

/** Star toggle icon (Budget Star & Notes, DECISION-057) — mirrors
 *  budget-editor.tsx's own StarIcon so both grains look identical. */
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

/** Note icon (Budget Star & Notes, DECISION-057) — mirrors budget-editor.tsx's own NoteIcon. */
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
 *  browser is mid-click on. Applied to every add/remove/restore/collapse
 *  control in this file. */
function preventMouseDownDefault(e: React.MouseEvent) {
  e.preventDefault();
}

function parseDollarsToCents(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return 0;
  const n = parseFloat(trimmed);
  return !isNaN(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Excludes dead (pending-delete or holding-for-delete) rows — this is the
 *  on-screen "Category total" / per-group "Subtotal" readout only. It has no
 *  bearing on onTotalChange's payload (see that prop's doc comment): a
 *  soft-deleted row's amountCents is never touched, so the category's GROSS
 *  total (what onTotalChange reports) doesn't change when a row goes dead or
 *  comes back — only this on-screen display does. */
function currentTotalCents(rows: Row[]): number {
  return sumBudgetCauseLines(
    rows.filter((r) => !isRowDead(r)).map((r) => ({ amountCents: parseDollarsToCents(r.value) })),
  );
}

/**
 * Reads the server's `{ error, reason }` 409/400 body and returns the copy to
 * show the treasurer. The server already writes a specific, cause-naming
 * message for both `locked` and `duplicate_cause_label` (see
 * `assertBudgetUnlocked`/`duplicateCauseLabelResult` in ledger-queries.ts), so
 * this just forwards `data.error` with a generic fallback per reason — it
 * exists so every call site handles a missing/malformed body identically.
 */
function describeWriteError(
  data: { error?: string; reason?: "locked" | "duplicate_cause_label" },
  fallback: string,
): string {
  if (data.error) return data.error;
  if (data.reason === "locked") return "This budget is locked. Unlock it to make changes.";
  if (data.reason === "duplicate_cause_label") {
    return "A line for this cause and label already exists — edit it instead.";
  }
  return fallback;
}

/**
 * Cause-level budget breakdown for one category (B-17 Increment A; re-keyed
 * to `id` and grouped-by-cause by Labeled Cause Budget Lines,
 * DECISION-047/048; restructured for per-cause add/remove and delayed-commit
 * line removal by the Budgeting Page Restructure, DECISION-054/055/056).
 * Nested inside BudgetEditor when a giving-eligible expense category
 * (isCauseEligibleCategory) is in breakdown mode. Mirrors BudgetEditor's own
 * commit-on-blur/Enter and ConfirmDialog conventions — this is the third
 * nested layer in an already-dense editor, so it must not look or behave
 * like a bolted-on component.
 *
 * Row identity is the line's own `id` (`id === null` means "never saved"). A
 * cause is fixed the moment a row is created — by the cause GROUP it's added
 * to (the per-cause "+ add line item" control) or by the category-row
 * "+ add cause" picker for a brand-new group — there is no per-line cause
 * `<select>` in this increment (the old one-cause-per-category-at-a-time
 * default is gone entirely: a new line always inherits its cause by
 * context). Rows are grouped by cause for display (header + per-cause
 * subtotal + nested labeled lines), in canonical ALL_CAUSES order so the
 * grouping is stable across re-renders/reloads.
 *
 * Removal: a single line item is immediate + a quiet, delayed-commit Undo
 * (the flag-flip PATCH is held client-side for HOLD_MS and only actually
 * sent if Undo isn't clicked in time — see startHold/commitHoldDelete). A
 * whole cause group is confirm-then-immediate, no Undo timer, but still
 * reversible-until-finalize via a persistent "Restore group" control (see
 * doGroupRemove/doGroupRestore) — distinct models for two different grains,
 * per DECISION-055.
 */
export default function BudgetCauseEditor({
  fundId,
  fiscalYear,
  categoryId,
  flow,
  initialLines,
  pending,
  disabled = false,
  labelOptions = [],
  onTotalChange,
  onExitBreakdown,
  requestedNewCause,
  onNewCauseRequestHandled,
  onPendingDeltaChange,
  showAnnotationControls = false,
}: BudgetCauseEditorProps) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.map((l) => ({
      id: pending ? null : l.id,
      cause: l.cause,
      label: l.label,
      value: (l.amountCents / 100).toFixed(2),
      saving: false,
      priorBudgetCents: l.priorBudgetCents ?? null,
      priorActualCents: l.priorActualCents ?? null,
      pendingDeleteAt: pending ? null : (l.pendingDeleteAt ?? null),
      holdingForDelete: false,
      starred: pending ? false : (l.starred ?? false),
      note: pending ? null : (l.note ?? null),
    })),
  );
  const dirtyAmountRef = useRef<boolean[]>(rows.map(() => false));
  const dirtyLabelRef = useRef<boolean[]>(rows.map(() => false));
  // Delayed-commit timers for single line-item removal, keyed by the row's
  // own (server) id — cleared on Undo, and on unmount (defense-in-depth: an
  // outstanding hold must not silently fire a request against a component
  // that's gone, e.g. a category-level remove-in-breakdown or a "Collapse to
  // lump sum" that unmounts this whole editor before the hold window elapses
  // — per Ruling 4, category-level pending-delete never cascades a write
  // onto children, so a cleared hold correctly leaves that line untouched).
  const holdTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    return () => {
      Object.values(holdTimers.current).forEach(clearTimeout);
      holdTimers.current = {};
    };
  }, []);

  // Reconciles each committed row's READ-ONLY prior-year reference fields
  // (Prior Budget / Prior Actual) against freshly server-computed values —
  // fixes the 2026-07-30 loop-back bug on 2026-07-28-causeline-prior-year-
  // reference: `rows` state used to seed priorBudgetCents/priorActualCents
  // once at mount (see Row's own doc comment) and addRowForCause always
  // hardcoded null for a brand-new row, with nothing ever recomputing either
  // — so a line added/edited in THIS session stayed stuck at "—" forever,
  // even once a matching prior-FY value existed, until a hard full-page
  // reload re-seeded the component from scratch.
  //
  // This fires whenever `initialLines` changes IDENTITY, which only happens
  // after a `router.refresh()` re-runs the server component tree with fresh
  // props (see budget-editor.tsx: `initialLines` is `line.causeLines`
  // straight off BudgetEditor's own `lines` prop, never locally copied, so
  // its identity is stable across unrelated re-renders — e.g. typing in a
  // sibling field never re-triggers this). commitCreate/commitUpdate/the
  // delete-hold/restore paths all already call router.refresh() on success,
  // so the fresh, server-recomputed prior values arrive here shortly after.
  //
  // Matches by committed server `id` only (never by label/value) — a
  // never-saved row (id === null) has nothing in `initialLines` to match
  // against yet, which is correct: the server hasn't computed anything for
  // an unsaved label. Only priorBudgetCents/priorActualCents are touched;
  // label/value edits are guarded by their own dirty refs (dirtyAmountRef/
  // dirtyLabelRef) and this effect never reads or writes either, so it can't
  // clobber an in-progress edit.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.id === null) return r;
        const match = initialLines.find((l) => l.id === r.id);
        if (!match) return r;
        const nextPriorBudget = match.priorBudgetCents ?? null;
        const nextPriorActual = match.priorActualCents ?? null;
        if (nextPriorBudget === r.priorBudgetCents && nextPriorActual === r.priorActualCents) {
          return r;
        }
        changed = true;
        return { ...r, priorBudgetCents: nextPriorBudget, priorActualCents: nextPriorActual };
      });
      return changed ? next : prev;
    });
  }, [initialLines]);

  // Command-prop consumption for the category-row "+ add cause" control when
  // this category is already in breakdown (see requestedNewCause's doc
  // comment). eslint-disable is required since addRowForCause/
  // onNewCauseRequestHandled are not stable identities across renders and
  // including them would refire this effect on every unrelated re-render —
  // the intent is "run only when requestedNewCause itself changes."
  useEffect(() => {
    if (requestedNewCause) {
      addRowForCause(requestedNewCause);
      onNewCauseRequestHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNewCause]);

  const [groupRemoveConfirm, setGroupRemoveConfirm] = useState<{ cause: string; count: number } | null>(
    null,
  );
  const [collapseConfirmOpen, setCollapseConfirmOpen] = useState(false);
  const datalistId = `cause-line-labels_${categoryId}_${flow}`;

  // Budget Star & Notes (DECISION-057) — one note editor open at a time,
  // keyed by the row's own committed id (a never-saved row has none, so its
  // controls are hidden entirely — see requestRemove's own id === null
  // branch for the same "nothing to address server-side yet" pattern).
  const [noteEditRowId, setNoteEditRowId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteSaving, setNoteSaving] = useState<Record<string, boolean>>({});

  /** Star toggle — optimistic (flips instantly). Never gated on `disabled`:
   *  this endpoint intentionally skips assertBudgetUnlocked (DECISION-057). */
  async function toggleLineStar(row: Row) {
    if (row.id === null) return;
    const id = row.id;
    const next = !row.starred;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, starred: next } : r)));
    try {
      const res = await fetch(CAUSE_LINE_ANNOTATIONS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, starred: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save — try again.");
      }
      router.refresh();
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, starred: !next } : r)));
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    }
  }

  function openLineNoteEditor(row: Row) {
    if (row.id === null) return;
    setNoteDraft(row.note ?? "");
    setNoteEditRowId(row.id);
  }

  function closeLineNoteEditor() {
    setNoteEditRowId(null);
    setNoteDraft("");
  }

  /** Save-button-only, same discipline as budget-editor.tsx's category-grain
   *  note editor — no autosave on blur, keeps the editor open with the typed
   *  text intact on failure. */
  async function saveLineNote(row: Row) {
    if (row.id === null) return;
    const id = row.id;
    const trimmed = noteDraft.trim();
    if (trimmed.length > MAX_BUDGET_NOTE_LENGTH) {
      toast.error(`Note is limited to ${MAX_BUDGET_NOTE_LENGTH} characters.`);
      return;
    }
    setNoteSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(CAUSE_LINE_ANNOTATIONS_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note: trimmed || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't save — try again.");
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, note: trimmed || null } : r)));
      closeLineNoteEditor();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setNoteSaving((prev) => ({ ...prev, [id]: false }));
    }
  }

  /** Star/note icon cluster for one committed cause line — hidden entirely
   *  for a never-saved row (nothing to address server-side yet) and when
   *  showAnnotationControls is false. Rendered in BOTH the live and dead
   *  render branches (Decision 7): a row that's individually pending-delete
   *  or mid-hold still shows and allows editing its own star/note. */
  function renderLineAnnotationControls(row: Row) {
    if (!showAnnotationControls) return null;
    if (row.id === null) {
      // Uncommitted row (Budgeting UX Polish, 2026-07-30) — annotations need
      // a persisted line id, which doesn't exist yet. Rather than pop the
      // star/note controls in only after the first commit (a jarring layout
      // shift once the row gets an id), reserve the EXACT same footprint
      // here, disabled and muted, with a hint explaining why. Mirrors the
      // committed branch below: same wrapper classes, same button sizing.
      return (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            disabled
            title="Save the line to star it or add a note"
            aria-label="Flag for discussion — save this line first"
            className="inline-flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] text-gray-200 cursor-not-allowed"
          >
            <StarIcon filled={false} />
          </button>
          <button
            type="button"
            disabled
            title="Save the line to star it or add a note"
            aria-label="Add note for discussion — save this line first"
            className="inline-flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] text-gray-200 cursor-not-allowed"
          >
            <NoteIcon filled={false} />
          </button>
        </div>
      );
    }
    const hasNote = !!(row.note && row.note.trim() !== "");
    const noteOpen = noteEditRowId === row.id;
    const displayLabel = row.label ? `"${row.label}"` : row.cause;
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onMouseDown={preventMouseDownDefault}
          onClick={() => void toggleLineStar(row)}
          title={row.starred ? "Unflag for discussion" : "Flag for discussion"}
          aria-label={
            row.starred ? `Unflag ${displayLabel} for discussion` : `Flag ${displayLabel} for discussion`
          }
          aria-pressed={row.starred}
          className={`inline-flex items-center justify-center rounded-lg min-h-[44px] min-w-[44px] transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            row.starred ? "text-lions-gold" : "text-gray-300 hover:text-gray-400"
          }`}
        >
          <StarIcon filled={row.starred} />
        </button>
        <button
          type="button"
          onMouseDown={preventMouseDownDefault}
          onClick={() => (noteOpen ? closeLineNoteEditor() : openLineNoteEditor(row))}
          title={hasNote ? "Edit note" : "Add note for discussion"}
          aria-label={hasNote ? `Edit note for ${displayLabel}` : `Add note for ${displayLabel}`}
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

  /** Inline note editor for a cause line — same discipline as
   *  budget-editor.tsx's category-grain editor (Save-button-only, never a
   *  modal). */
  function renderLineNoteEditor(row: Row) {
    if (!showAnnotationControls || row.id === null || noteEditRowId !== row.id) return null;
    const id = row.id;
    const isSaving = !!noteSaving[id];
    const overLimit = noteDraft.length > MAX_BUDGET_NOTE_LENGTH;
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 mt-1">
        <label htmlFor={`cause-line-note-${id}`} className="sr-only">
          Note for this line — for discussion, not shown to members
        </label>
        <textarea
          id={`cause-line-note-${id}`}
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
              onClick={closeLineNoteEditor}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 rounded px-2 py-2 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              Cancel
            </button>
            <button
              type="button"
              onMouseDown={preventMouseDownDefault}
              onClick={() => void saveLineNote(row)}
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

  const hasCommittedRows = rows.some((r) => r.id !== null);
  const totalCents = currentTotalCents(rows);

  function setRowSaving(index: number, saving: boolean) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving } : r)));
  }

  function handleAmountChange(index: number, value: string) {
    if (disabled) return;
    const next = rows.map((r, i) => (i === index ? { ...r, value } : r));
    setRows(next);
    dirtyAmountRef.current[index] = true;
    onTotalChange?.((currentTotalCents(next) / 100).toFixed(2));
  }

  function handleLabelChange(index: number, label: string) {
    if (disabled) return;
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
    dirtyLabelRef.current[index] = true;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      void commitRow(index);
    }
  }

  async function commitRow(index: number) {
    const row = rows[index];
    if (!row) return;

    if (row.id === null) {
      await commitCreate(index);
      return;
    }
    await commitUpdate(index);
  }

  /** First-ever commit for a never-saved row — this IS how it gets created. */
  async function commitCreate(index: number) {
    const row = rows[index];
    if (!row) return;

    const raw = row.value.trim();
    // A blank amount means a deliberate $0 line — a beneficiary you want on the
    // worksheet with nothing budgeted (or "starting at zero"). Removal is the
    // trash button, not an empty box. Typing "0" reaches the same place.
    let amountCents: number;
    if (raw === "") {
      amountCents = 0;
    } else {
      const n = parseFloat(raw);
      if (isNaN(n) || n < 0) {
        toast.error("Enter a valid amount (0 or greater).");
        return;
      }
      amountCents = Math.round(n * 100);
      if (amountCents > 2_147_483_647) {
        toast.error("Amount exceeds maximum.");
        return;
      }
    }
    if (row.label.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
      toast.error(`Label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer.`);
      return;
    }

    setRowSaving(index, true);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId,
          fiscalYear,
          categoryId,
          flow,
          cause: row.cause,
          label: row.label,
          amountCents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Failed to save cause line."));
      }
      const data: { lineId: string; cause: string; label: string; categoryTotalCents: number } =
        await res.json();
      setRows((prev) =>
        prev.map((r, i) =>
          i === index
            ? {
                ...r,
                id: data.lineId,
                cause: data.cause,
                label: data.label,
                value: (amountCents / 100).toFixed(2),
                saving: false,
              }
            : r,
        ),
      );
      dirtyAmountRef.current[index] = false;
      dirtyLabelRef.current[index] = false;
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save cause line. Try again.");
      setRowSaving(index, false);
    }
  }

  /** Amount and/or label edit on an already-committed row — single in-place UPDATE, no delete+recreate. */
  async function commitUpdate(index: number) {
    const row = rows[index];
    if (!row || row.id === null) return;

    const amountDirty = dirtyAmountRef.current[index];
    const labelDirty = dirtyLabelRef.current[index];
    if (!amountDirty && !labelDirty) return;

    let amountCents: number | undefined;
    if (amountDirty) {
      const raw = row.value.trim();
      // A cleared field on an existing line means a deliberate $0 (keep the
      // line, budget nothing) — the trash button, not an empty box, is how a
      // line is removed. Typing "0" reaches the same place.
      if (raw === "") {
        amountCents = 0;
      } else {
        const n = parseFloat(raw);
        if (isNaN(n) || n < 0) {
          toast.error("Enter a valid amount (0 or greater).");
          return;
        }
        amountCents = Math.round(n * 100);
        if (amountCents > 2_147_483_647) {
          toast.error("Amount exceeds maximum.");
          return;
        }
      }
    }
    if (labelDirty && row.label.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
      toast.error(`Label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer.`);
      return;
    }

    const body: { id: string; amountCents?: number; label?: string } = { id: row.id };
    if (amountDirty) body.amountCents = amountCents;
    if (labelDirty) body.label = row.label;

    setRowSaving(index, true);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Failed to save cause line."));
      }
      const data: { label: string; categoryTotalCents: number } = await res.json();
      setRows((prev) =>
        prev.map((r, i) =>
          i === index
            ? {
                ...r,
                label: data.label,
                value: amountCents !== undefined ? (amountCents / 100).toFixed(2) : r.value,
                saving: false,
              }
            : r,
        ),
      );
      dirtyAmountRef.current[index] = false;
      dirtyLabelRef.current[index] = false;
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save cause line. Try again.");
      setRowSaving(index, false);
    }
  }

  /** New pending row seeded directly into `cause`'s group — no cause
   *  `<select>` anywhere, ever (Budgeting Page Restructure). Called both by
   *  a cause group's own "+ add line item" control and by the
   *  requestedNewCause command-prop effect above (a brand-new group started
   *  from the category row's "+ add cause" picker). */
  function addRowForCause(cause: string) {
    if (disabled) return;
    setRows((prev) => [
      ...prev,
      {
        id: null,
        cause,
        label: "",
        value: "",
        saving: false,
        priorBudgetCents: null,
        priorActualCents: null,
        pendingDeleteAt: null,
        holdingForDelete: false,
        starred: false,
        note: null,
      },
    ]);
    dirtyAmountRef.current.push(false);
    dirtyLabelRef.current.push(false);
  }

  /** Single line-item remove (Flow 4) — a never-saved row drops locally with
   *  nothing to hold (there's no server row to soft-delete yet); a committed
   *  row starts the delayed-commit hold. Never a ConfirmDialog. */
  function requestRemove(index: number) {
    if (disabled) return;
    const row = rows[index];
    if (!row) return;
    if (row.id === null) {
      doRemoveLocal(index);
      return;
    }
    startHold(row.id);
  }

  function doRemoveLocal(index: number) {
    const next = rows.filter((_, i) => i !== index);
    dirtyAmountRef.current.splice(index, 1);
    dirtyLabelRef.current.splice(index, 1);
    if (next.length === 0) {
      // Only reachable when the removed row was the sole, never-committed
      // pre-fill row — a pure cancel, nothing was ever written.
      onExitBreakdown("cancelled");
      return;
    }
    setRows(next);
  }

  /**
   * Immediate + quiet Undo (DECISION-055 item 1): flips the row into the
   * dead-row treatment right away and fires onPendingDeltaChange
   * optimistically so the fund-level live balance excludes it before any
   * round trip. The actual PATCH is held for HOLD_MS — Undo clicked in time
   * is a pure clearTimeout, zero network calls, the row was never touched
   * server-side.
   */
  function startHold(rowId: string) {
    if (disabled) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const amountCents = parseDollarsToCents(row.value);
    const displayLabel = row.label ? `"${row.label}"` : row.cause;

    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, holdingForDelete: true } : r)));
    onPendingDeltaChange?.(amountCents);

    const timer = setTimeout(() => {
      delete holdTimers.current[rowId];
      void commitHoldDelete(rowId, amountCents);
    }, HOLD_MS);
    holdTimers.current[rowId] = timer;

    toast(`Removed ${displayLabel}`, {
      duration: HOLD_MS,
      action: {
        label: "Undo",
        onClick: () => cancelHold(rowId, amountCents),
      },
    });
  }

  function cancelHold(rowId: string, amountCents: number) {
    const timer = holdTimers.current[rowId];
    if (timer) {
      clearTimeout(timer);
      delete holdTimers.current[rowId];
    }
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, holdingForDelete: false } : r)));
    onPendingDeltaChange?.(-amountCents);
  }

  async function commitHoldDelete(rowId: string, amountCents: number) {
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, pendingDelete: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Could not remove this line. Try again."));
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, holdingForDelete: false, pendingDeleteAt: new Date().toISOString() }
            : r,
        ),
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this line. Try again.");
      // Revert — the hold expired but the server call failed; put the row
      // back to normal and give the live balance its dollars back.
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, holdingForDelete: false } : r)));
      onPendingDeltaChange?.(-amountCents);
    }
  }

  /** Restore for an already server-committed pending-delete row (persisted
   *  from a prior visit, or a hold that already fired). */
  async function restoreCommittedLine(rowId: string) {
    if (disabled) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const amountCents = parseDollarsToCents(row.value);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, pendingDelete: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Could not restore this line. Try again."));
      }
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, pendingDeleteAt: null } : r)));
      onPendingDeltaChange?.(-amountCents);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore this line. Try again.");
    }
  }

  /** Cause-GROUP remove (Flow 5) — confirm-then-immediate, one atomic PATCH
   *  for every committed row in the group; any never-saved row in the same
   *  group is dropped locally in the same action (nothing to flag
   *  server-side for it). No Undo timer — reversal is a persistent
   *  "Restore group" control instead (DECISION-055 item 2). */
  async function doGroupRemove(cause: string) {
    const groupRowsBefore = rows.filter((r) => r.cause === cause);
    const uncommitted = groupRowsBefore.filter((r) => r.id === null);
    const committedLive = groupRowsBefore.filter((r) => r.id !== null && !isRowDead(r));
    const deltaCents = sumBudgetCauseLines(
      [...uncommitted, ...committedLive].map((r) => ({ amountCents: parseDollarsToCents(r.value) })),
    );

    // Any row still mid-hold in this group is about to be committed by the
    // group PATCH below anyway — cancel its individual timer so it can't
    // also independently fire commitHoldDelete for the same row.
    groupRowsBefore.forEach((r) => {
      if (r.id && holdTimers.current[r.id]) {
        clearTimeout(holdTimers.current[r.id]);
        delete holdTimers.current[r.id];
      }
    });

    if (uncommitted.length > 0) {
      const keepMask = rows.map((r) => !(r.cause === cause && r.id === null));
      dirtyAmountRef.current = dirtyAmountRef.current.filter((_, i) => keepMask[i]);
      dirtyLabelRef.current = dirtyLabelRef.current.filter((_, i) => keepMask[i]);
      setRows((prev) => prev.filter((r) => !(r.cause === cause && r.id === null)));
    }

    if (committedLive.length === 0 && groupRowsBefore.every((r) => r.id === null || isRowDead(r))) {
      // Nothing server-side left to flip (either every row was uncommitted,
      // or every committed row was already dead) — the local drop above
      // already handles it.
      if (uncommitted.length > 0) onPendingDeltaChange?.(deltaCents);
      return;
    }

    try {
      const res = await fetch(CAUSE_GROUP_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause, pendingDelete: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not remove this group. Try again.");
      }
      setRows((prev) =>
        prev.map((r) =>
          r.cause === cause && r.id !== null
            ? { ...r, pendingDeleteAt: new Date().toISOString(), holdingForDelete: false }
            : r,
        ),
      );
      onPendingDeltaChange?.(deltaCents);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this group. Try again.");
    }
  }

  /** Group restore — same endpoint, `pendingDelete: false`. No time limit;
   *  a persistent control on the dead group's header. */
  async function doGroupRestore(cause: string) {
    const groupCommitted = rows.filter((r) => r.cause === cause && r.id !== null);
    const deltaCents = sumBudgetCauseLines(
      groupCommitted.map((r) => ({ amountCents: parseDollarsToCents(r.value) })),
    );
    try {
      const res = await fetch(CAUSE_GROUP_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause, pendingDelete: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not restore this group. Try again.");
      }
      setRows((prev) =>
        prev.map((r) => (r.cause === cause && r.id !== null ? { ...r, pendingDeleteAt: null } : r)),
      );
      onPendingDeltaChange?.(-deltaCents);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore this group. Try again.");
    }
  }

  async function doCollapse() {
    try {
      const res = await fetch("/api/admin/ledger/budgets/cause-lines/collapse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not collapse to lump sum. Try again.");
      }
      toast.success("Collapsed to a single lump-sum amount.");
      onExitBreakdown("collapsed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not collapse to lump sum. Try again.");
    }
  }

  // Group rows by cause, iterated in canonical ALL_CAUSES order (not
  // insertion order) so the grouping is stable across re-renders/reloads.
  const rowsByCause = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const bucket = rowsByCause.get(row.cause);
    if (bucket) bucket.push(index);
    else rowsByCause.set(row.cause, [index]);
  });
  const groupOrder = ALL_CAUSES.filter((c) => rowsByCause.has(c));
  // Defensive: a cause value outside the canonical list (shouldn't happen —
  // isValidBudgetCause gates every write) still renders, appended at the end,
  // rather than silently disappearing.
  for (const c of rowsByCause.keys()) {
    if (!groupOrder.includes(c)) groupOrder.push(c);
  }

  return (
    <div className="space-y-3">
      <datalist id={datalistId}>
        {labelOptions.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      {groupOrder.map((cause) => {
        // Stable sort within the group: starred rows first, existing order
        // preserved otherwise (Phase 1 Decision 1, scoped to "within each
        // group" — the group here is the cause, not the whole category).
        const indices = [...(rowsByCause.get(cause) ?? [])].sort(
          (a, b) => Number(rows[b].starred) - Number(rows[a].starred),
        );
        const liveIndices = indices.filter((i) => !isRowDead(rows[i]));
        const subtotalCents = sumBudgetCauseLines(
          liveIndices.map((i) => ({ amountCents: parseDollarsToCents(rows[i].value) })),
        );
        const groupHasCommitted = indices.some((i) => rows[i].id !== null);
        const groupAllDead = indices.length > 0 && indices.every((i) => isRowDead(rows[i]));

        return (
          <div
            key={cause}
            className={`rounded-lg p-2 space-y-2 ${groupAllDead ? "bg-gray-100" : "bg-gray-50"}`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p
                className={`text-sm font-semibold ${groupAllDead ? "text-gray-400 line-through" : "text-gray-800"}`}
              >
                {cause}
              </p>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500 tabular-nums">
                  Subtotal: <span className="font-medium text-gray-700">${(subtotalCents / 100).toFixed(2)}</span>
                </p>
                {!disabled && groupAllDead && (
                  <button
                    type="button"
                    onMouseDown={preventMouseDownDefault}
                    onClick={() => void doGroupRestore(cause)}
                    className="inline-flex items-center justify-center rounded-lg px-3 text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                  >
                    Restore group
                  </button>
                )}
                {!disabled && !groupAllDead && groupHasCommitted && (
                  <button
                    type="button"
                    onMouseDown={preventMouseDownDefault}
                    onClick={() => setGroupRemoveConfirm({ cause, count: indices.length })}
                    title={`Remove ${cause} and its line items`}
                    aria-label={`Remove ${cause} and its line items`}
                    className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px]"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2 pl-3 border-l-2 border-gray-200">
              {indices.map((index) => {
                const row = rows[index];
                const dead = isRowDead(row);

                if (dead) {
                  return (
                    <div
                      key={index}
                      className="space-y-1 py-1 px-2 -mx-2 rounded-lg bg-gray-100"
                    >
                      <div className="grid grid-cols-2 gap-2 max-w-xs">
                        <ReferenceValue label="Prior Budget" cents={row.priorBudgetCents} />
                        <ReferenceValue label="Prior Actual" cents={row.priorActualCents} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-500 line-through flex-1 min-w-0 truncate">
                          {row.label || "(generic)"}
                        </span>
                        <div className="relative w-24 flex-shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                            $
                          </span>
                          <input
                            type="number"
                            value={row.value}
                            disabled
                            readOnly
                            className="block w-full rounded border border-gray-200 bg-gray-100 py-1 pl-6 pr-2 text-sm tabular-nums text-gray-400 line-through"
                            aria-label={`Amount for ${cause}${row.label ? ` (${row.label})` : ""}, marked for removal`}
                          />
                        </div>
                        {renderLineAnnotationControls(row)}
                        {!disabled && row.id !== null && (
                          <button
                            type="button"
                            onMouseDown={preventMouseDownDefault}
                            onClick={() =>
                              row.holdingForDelete
                                ? cancelHold(row.id as string, parseDollarsToCents(row.value))
                                : void restoreCommittedLine(row.id as string)
                            }
                            className="inline-flex items-center justify-center rounded-lg px-3 text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] flex-shrink-0"
                          >
                            {row.holdingForDelete ? "Undo" : "Restore"}
                          </button>
                        )}
                      </div>
                      {renderLineNoteEditor(row)}
                    </div>
                  );
                }

                return (
                  <div key={index} className="space-y-1">
                    {/* Prior-year reference columns (read-only) — same
                        grid-cols-2 pattern as BudgetEditor's category-grain
                        columns, so it stacks cleanly at 360px too. */}
                    <div className="grid grid-cols-2 gap-2 max-w-xs">
                      <ReferenceValue label="Prior Budget" cents={row.priorBudgetCents} />
                      <ReferenceValue label="Prior Actual" cents={row.priorActualCents} />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        list={datalistId}
                        value={row.label}
                        onChange={(e) => handleLabelChange(index, e.target.value)}
                        onBlur={() => void commitRow(index)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        disabled={disabled || row.saving}
                        maxLength={MAX_BUDGET_LINE_LABEL_LENGTH}
                        placeholder="(generic)"
                        aria-label={`Label for this ${cause} line`}
                        className="block w-full rounded border border-gray-300 py-1.5 px-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 sm:flex-1 min-h-[36px]"
                      />
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 sm:w-28">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                            $
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.value}
                            onChange={(e) => handleAmountChange(index, e.target.value)}
                            onBlur={() => void commitRow(index)}
                            onKeyDown={(e) => handleKeyDown(e, index)}
                            disabled={disabled || row.saving}
                            className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm tabular-nums focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                            placeholder="0.00"
                            aria-label={`Amount for ${cause}${row.label ? ` (${row.label})` : ""}`}
                          />
                        </div>
                        {renderLineAnnotationControls(row)}
                        {!disabled && (
                          <button
                            type="button"
                            onMouseDown={preventMouseDownDefault}
                            onClick={() => requestRemove(index)}
                            title={`Remove ${cause}${row.label ? ` (${row.label})` : ""} line`}
                            aria-label={`Remove ${cause}${row.label ? ` (${row.label})` : ""} line`}
                            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px] flex-shrink-0"
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    </div>
                    {renderLineNoteEditor(row)}
                  </div>
                );
              })}
              {!disabled && !groupAllDead && (
                <button
                  type="button"
                  onMouseDown={preventMouseDownDefault}
                  onClick={() => addRowForCause(cause)}
                  className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
                >
                  + Add line item
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-sm text-gray-700">
          Category total:{" "}
          <span className="font-semibold tabular-nums">${(totalCents / 100).toFixed(2)}</span>
        </p>
        {!disabled && (
          <div className="flex items-center gap-4">
            {hasCommittedRows ? (
              <button
                type="button"
                onMouseDown={preventMouseDownDefault}
                onClick={() => setCollapseConfirmOpen(true)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
              >
                Collapse to lump sum
              </button>
            ) : (
              <button
                type="button"
                onMouseDown={preventMouseDownDefault}
                onClick={() => onExitBreakdown("cancelled")}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {disabled && <p className="text-xs text-gray-400">This budget is locked for editing.</p>}

      <ConfirmDialog
        open={groupRemoveConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setGroupRemoveConfirm(null);
        }}
        title="Remove this cause group?"
        description={
          groupRemoveConfirm
            ? `Remove "${groupRemoveConfirm.cause}" and its ${groupRemoveConfirm.count} line item${groupRemoveConfirm.count === 1 ? "" : "s"}? This can be undone with "Restore group" until the budget is finalized.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const cause = groupRemoveConfirm?.cause;
          setGroupRemoveConfirm(null);
          if (cause) void doGroupRemove(cause);
        }}
      />

      <ConfirmDialog
        open={collapseConfirmOpen}
        onOpenChange={setCollapseConfirmOpen}
        title="Collapse to a single lump sum?"
        description="This deletes the individual cause line items — the category's dollar total is kept as one lump-sum amount, but the per-cause detail (including every label) is lost and can't be recovered. You can break it down by cause again later, but you'll need to re-enter each line."
        confirmLabel="Collapse"
        destructive
        onConfirm={() => {
          setCollapseConfirmOpen(false);
          void doCollapse();
        }}
      />
    </div>
  );
}
