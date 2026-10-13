"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CrewActionResponse, CrewRosterRow, RevertRequest } from "@/lib/santas-workshop/crew-contract";
import { crewPaths, postJson } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CheckInPanel } from "./check-in-panel";
import { CREW_BTN_OUTLINE, CREW_CARD, CREW_NOTICE_AMBER } from "./crew-styles";
import { CREW_STATE_LABELS, crewDisplayName, nextStep, previousState, showRevert, tagText, windowLabelFor, type StepScreen } from "./crew-ui";
import { PickupPanel } from "./pickup-panel";
import { PortraitPanel } from "./portrait-panel";
import { TagPanel } from "./tag-panel";

interface Props {
  ctx: CrewCtx;
  /** The row as the roster last had it, or as a scan returned it. */
  initial: CrewRosterRow;
  pendingTag?: string;
}

/** One stuffy: its header, the panel for the step it is on, and (practice only) a way back a step. */
export function StuffyScreen({ ctx, initial, pendingTag }: Props) {
  // Prefer the roster's copy: it is fresher after a refresh or an action.
  const row = ctx.rows.find((r) => r.id === initial.id) ?? initial;
  const [override, setOverride] = useState<StepScreen | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const name = crewDisplayName(row.name, row.orderSize);
  const step = override ?? nextStep(row.state).screen;
  const win = windowLabelFor(ctx.session, row.windowId);
  const back = previousState(row.state, row.hasPortrait);

  async function revert() {
    if (!back) return;
    setRevertOpen(false);
    setBusy(true);
    setMessage(null);
    const body: RevertRequest = { toState: back, expectedState: row.state };
    const res = await postJson<CrewActionResponse>(crewPaths(ctx.slug).revert(row.id), body);
    setBusy(false);
    if (res.ok) {
      ctx.applyRow(res.data.stuffy);
      setOverride(null);
      toast.success(`${name} is back to: ${CREW_STATE_LABELS[res.data.stuffy.state]}`);
      return;
    }
    setMessage(ctx.failureText(res, "revert"));
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <button
        type="button"
        onClick={() => ctx.back()}
        className="min-h-[44px] rounded text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue"
      >
        &larr; Back to the list
      </button>

      <header className={`${CREW_CARD} p-4`}>
        <h2 className="break-words text-2xl font-bold text-gray-900">{name}</h2>
        <p className="mt-1 break-words text-gray-600">{[win, row.description].filter(Boolean).join(" · ") || "No description"}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-lions-blue/10 px-2.5 py-0.5 font-semibold text-lions-blue">{CREW_STATE_LABELS[row.state]}</span>
          <span className="text-gray-600">{tagText(row.last4)}</span>
          {row.refundBadge && <span className="rounded-full bg-gray-200 px-2.5 py-0.5 font-semibold text-gray-700">Refunded</span>}
        </p>
        {row.detailsBeingChecked && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">The chair is checking this registration&rsquo;s details. You can carry on.</p>}
      </header>

      {step === "tag" && <TagPanel ctx={ctx} row={row} pendingTag={pendingTag} onDone={() => setOverride(null)} />}
      {step === "checkin" && <CheckInPanel ctx={ctx} row={row} />}
      {row.state === "tagged" && (
        <button type="button" className={CREW_BTN_OUTLINE} onClick={() => setOverride(step === "tag" ? "checkin" : "tag")}>
          {step === "tag" ? "Keep the current sticker" : "Change sticker"}
        </button>
      )}
      {step === "portrait" && <PortraitPanel ctx={ctx} row={row} onHandOver={() => setOverride("pickup")} />}
      {/* Also for a picked-up stuffy: the panel owns the success screen (with the family QR) and the "already picked up" note, and must not unmount when the refresh flips the state. */}
      {(step === "pickup" || step === "done") && <PickupPanel ctx={ctx} row={row} onDone={() => ctx.navigate({ name: "list" })} />}

      {row.state === "portrait_taken" && step === "portrait" && (
        <button type="button" className={CREW_BTN_OUTLINE} onClick={() => setOverride("pickup")}>
          Go to hand-over
        </button>
      )}
      {step === "pickup" && (row.state === "checked_in" || row.state === "portrait_taken") && (
        <button type="button" className={CREW_BTN_OUTLINE} onClick={() => setOverride("portrait")}>
          {row.state === "portrait_taken" ? "Retake the portrait" : "Take the portrait first"}
        </button>
      )}

      {message && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {message}
        </p>
      )}

      {showRevert(ctx.session) && back && (
        <div className="border-t border-gray-200 pt-4">
          <p className="mb-2 text-sm text-gray-600">Practice session only</p>
          <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => setRevertOpen(true)}>
            Go back a step ({CREW_STATE_LABELS[back]})
          </button>
        </div>
      )}
      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="Go back a step?"
        description={back ? `${name} goes back to “${CREW_STATE_LABELS[back]}”. This is only for practice.` : ""}
        confirmLabel="Go back"
        destructive
        onConfirm={() => void revert()}
      />
    </div>
  );
}
