"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const LIST_PATH = "/admin/ledger/reconciliation";

interface ReconciliationDiscardButtonProps {
  sessionId: string;
  periodLabel: string;
  accountName: string;
  bankLineCount: number;
  matchCount: number;
}

function lineLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function matchLabel(n: number): string {
  return n === 1 ? "1 match" : `${n} matches`;
}

/** Dialog copy. Counts come from the page render and may be slightly stale. */
export function buildDiscardDescription(input: {
  periodLabel: string;
  accountName: string;
  bankLineCount: number;
  matchCount: number;
}): string {
  const { periodLabel, accountName, bankLineCount, matchCount } = input;
  let text = `This permanently deletes the ${periodLabel} session for ${accountName}`;
  if (bankLineCount === 0) {
    text += ". Nothing has been uploaded to it yet.";
  } else {
    const matches = matchCount === 0 ? "no matches" : matchLabel(matchCount);
    text += `, including its ${lineLabel(bankLineCount, "uploaded statement line")} and ${matches}.`;
  }
  text += " Nothing in the ledger is changed: no transaction is edited, un-reconciled or deleted.";
  if (bankLineCount > 0) {
    text += ` Any transaction you created from a bank line during this session stays in your books, on ${accountName}.`;
  }
  text += " This can't be undone, but you can start a new session for the same period right away.";
  return text;
}

export type DiscardAction = {
  toast: { kind: "success" | "info" | "error"; message: string };
  navigate: "push-list" | "refresh" | "none";
};

/** Pure mapping from the DELETE response to the toast + navigation to perform. */
export function discardResponseAction(
  status: number,
  body: { error?: string; bankLineCount?: number; matchCount?: number } | null | undefined,
): DiscardAction {
  const data = body ?? {};
  if (status === 200) {
    const lines = data.bankLineCount ?? 0;
    const matches = data.matchCount ?? 0;
    const message =
      lines === 0 && matches === 0
        ? "Session discarded."
        : `Session discarded. ${lineLabel(lines, "statement line")} and ${matchLabel(matches)} removed.`;
    return { toast: { kind: "success", message }, navigate: "push-list" };
  }
  if (status === 404) {
    return {
      toast: { kind: "info", message: "That session no longer exists." },
      navigate: "push-list",
    };
  }
  if (status === 409) {
    return {
      toast: {
        kind: "error",
        message: data.error || "This session is closed — reopen it before discarding it.",
      },
      navigate: "refresh",
    };
  }
  return {
    toast: { kind: "error", message: data.error || "Could not discard the session. Try again." },
    navigate: "none",
  };
}

/**
 * Discard an open session (hard delete of the session, its statement lines
 * and its matches; no ledger transaction is touched). Rendered only when the
 * viewer may discard it; the route is the real gate.
 */
export default function ReconciliationDiscardButton({
  sessionId,
  periodLabel,
  accountName,
  bankLineCount,
  matchCount,
}: ReconciliationDiscardButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDiscard() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/ledger/reconciliation/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      const action = discardResponseAction(res.status, data);
      toast[action.toast.kind](action.toast.message);
      if (action.navigate === "push-list") {
        router.push(LIST_PATH);
      } else if (action.navigate === "refresh") {
        router.refresh();
      }
    } catch {
      toast.error("Could not discard the session. Try again.");
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="border-2 border-red-300 text-red-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        Discard session
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Discard this session?"
        description={buildDiscardDescription({ periodLabel, accountName, bankLineCount, matchCount })}
        confirmLabel="Discard session"
        destructive
        onConfirm={handleDiscard}
      />
    </>
  );
}
