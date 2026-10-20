/**
 * Which register controls a row keeps when it plays a part in an itemized sweep
 * (B-172 Increment 2b, B11). Pure and badge-driven: `editLockKind` is unchanged
 * (the 2a A6 pin), and the register hides what the server would refuse instead of
 * offering an Edit form whose every save is a 403.
 *
 * A leg, a copy and a claimed source hide Edit, Delete, Split and Move and show
 * a "Batch" button. A copy keeps the donor link (the one edit the server allows
 * besides its memo, and the memo edit is deliberately not built: proposed B-201).
 * A claimed source refuses every edit, so it loses the donor link as well.
 */

import type { SweepRowBadge } from "@/lib/ledger-sweep";

export interface SweepRowControls {
  /** Show the chip text. */
  chip: boolean;
  /** Edit (and Correct), Delete, Split and Move all follow this one flag. */
  rowActions: boolean;
  /** The "Batch" button that opens the batch dialog. */
  batchButton: boolean;
  /** The donor link and acknowledgment controls on the row. */
  donorActions: boolean;
  /** The dialog may offer Void: a manager, on a batch that is posted. */
  canVoid: boolean;
}

export function sweepRowControls(
  badge: SweepRowBadge | null | undefined,
  canManage: boolean,
): SweepRowControls {
  if (!badge) {
    return { chip: false, rowActions: true, batchButton: false, donorActions: true, canVoid: false };
  }
  return {
    chip: true,
    rowActions: false,
    batchButton: true,
    donorActions: badge.kind !== "source",
    canVoid: canManage && badge.state === "posted",
  };
}
