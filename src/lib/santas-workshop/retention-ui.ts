/**
 * Pure, client-safe copy and logic for the admin Retention card (DECISION-125).
 * No React, no fetch. Types and the blocker vocabulary come from the contract.
 */

import { describeBlockers, type PurgeResponse, type RetentionScope, type RetentionScopeStatus, type ScopePreview } from "./admin-contract";
import { formatLongDate } from "./format";

export const SCOPE_LABELS: Record<RetentionScope, string> = {
  personal: "Personal data",
  public: "Public photos",
};

export const SCOPE_BUTTONS: Record<RetentionScope, string> = {
  personal: "Purge personal data",
  public: "Take photos down",
};

export const REASON_WARNING = "Do not type any family's name here.";

/** One line for a scope: its date and where it stands. */
export function scopeStateText(s: RetentionScopeStatus): { badge: "Purged" | "Due" | "Not yet"; text: string } {
  switch (s.state) {
    case "purged":
      return { badge: "Purged", text: "Finished. This cannot be undone." };
    case "due":
      return { badge: "Due", text: `Ready to run. The date was ${formatLongDate(s.dueOn)}.` };
    case "blocked":
      return { badge: "Not yet", text: `Scheduled for ${formatLongDate(s.dueOn)}. It cannot run on its own yet: ${describeBlockers(s.blockers, s.dueOn)}.` };
    default: {
      const never: never = s.state;
      return never;
    }
  }
}

export function scopeDescription(scope: RetentionScope): string {
  return scope === "personal"
    ? "Buyer names, emails and answers, children's first names, notes, care notes, check-in photos and the stored Zeffy messages are deleted for this session. Each stuffy keeps only its name, its portrait and its family page link."
    : "Every stuffy portrait and group photo is deleted, the collage and every family page stop showing photos, and the QR codes on printed frames lead to a \"removed\" page.";
}

export interface PurgeDialogCopy {
  title: string;
  confirmLabel: string;
  lines: string[];
  /** The date has not arrived or the session is not closed: a reason is required. */
  needsReason: boolean;
  blockedText: string | null;
}

/** Counts only: nothing here can carry a family's name. */
export function previewLines(scope: RetentionScope, p: ScopePreview): string[] {
  const photos = `${p.photos} photo${p.photos === 1 ? "" : "s"}`;
  if (scope === "public") return [`${photos} will be deleted.`];
  return [
    `${photos} will be deleted.`,
    `${p.orders} order${p.orders === 1 ? "" : "s"} and ${p.stuffies} stuff${p.stuffies === 1 ? "y" : "ies"} will lose their personal details.`,
  ];
}

export function purgeDialogCopy(scope: RetentionScope, status: RetentionScopeStatus, preview: ScopePreview | null): PurgeDialogCopy {
  const needsReason = status.state === "blocked";
  const lines = [scopeDescription(scope), ...(preview ? previewLines(scope, preview) : []), "This cannot be undone."];
  return {
    title: `${SCOPE_BUTTONS[scope]}?`,
    confirmLabel: SCOPE_BUTTONS[scope],
    lines,
    needsReason,
    blockedText: needsReason ? `This is earlier than planned: ${describeBlockers(status.blockers, status.dueOn)}. Give a reason to run it now.` : null,
  };
}

/** True when the Confirm button may be pressed. */
export function reasonOk(copy: Pick<PurgeDialogCopy, "needsReason">, reason: string): boolean {
  return !copy.needsReason || reason.trim().length > 0;
}

export function progressText(totalDeleted: number, remaining: number): string {
  return `Deleted ${totalDeleted} photo${totalDeleted === 1 ? "" : "s"} so far. ${remaining} left. Keep this page open.`;
}

export function purgeDoneText(scope: RetentionScope, r: Pick<PurgeResponse, "noop">, totalDeleted: number): string {
  if (r.noop) return "That was already done.";
  const what = scope === "personal" ? "Personal data purged" : "Photos taken down";
  return `${what}. ${totalDeleted} photo${totalDeleted === 1 ? "" : "s"} deleted.`;
}

export const RESET_COPY = {
  button: "Reset practice session",
  title: "Reset this practice session?",
  body: "Every registration, stuffy, photo and history entry in this practice session is deleted so the drill can start again. The session itself, its settings and the worker code stay. This cannot be undone.",
  confirm: "Reset practice session",
  purgedNote: "Its removal markers are cleared and the session returns to draft, so you can activate it again.",
} as const;
