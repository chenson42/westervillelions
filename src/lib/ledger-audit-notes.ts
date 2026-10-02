/**
 * Pure vocabulary and diff helper for the lightweight ledger audit "notes"
 * (DECISION-115): fund edits, donor deletes and ledger-settings changes.
 *
 * These are plain-text rows in ledger_audit_log written in the SAME
 * transaction as the change (recordLedgerAuditNote() in ./ledger-audit.ts),
 * the same precedent as the category_* and reconciliation_session_discarded
 * rows. They are deliberately NOT in CORRECTION_AUDIT_ACTIONS (ledger-
 * correction.ts): the board-visible "Recent corrections" reader filters on that
 * list, so these rows can never appear there. They have no reader yet (B-next-2).
 *
 * No email address, postal address or phone number may be stored in any of
 * these rows; a donor delete stores the display name and two counts only.
 * No DB import here.
 */

export const AUDIT_NOTE_ACTIONS = ["fund_updated", "donor_deleted", "ledger_settings_updated"] as const;

export type AuditNoteAction = (typeof AUDIT_NOTE_ACTIONS)[number];

/**
 * Compare a validated patch to the stored row over `keys`. A key is changed only
 * when the patch supplies it (not undefined) and the value differs.
 *
 * Returns `null` when nothing changed, so the caller writes nothing and records
 * no audit row. Otherwise `set` is the columns to write, and `before` / `after`
 * hold only the changed keys (old and new values).
 */
export function diffChangedFields<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T>,
  keys: readonly (keyof T & string)[],
): { set: Partial<T>; before: Partial<T>; after: Partial<T> } | null {
  const set: Partial<T> = {};
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  let changed = false;
  for (const key of keys) {
    const next = patch[key];
    if (next === undefined) continue;
    if (existing[key] === next) continue;
    set[key] = next;
    before[key] = existing[key];
    after[key] = next;
    changed = true;
  }
  return changed ? { set, before, after } : null;
}
