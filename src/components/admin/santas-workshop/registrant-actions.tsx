"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  AdminRevertRequest,
  AdminWithdrawRequest,
  RefundResolutionRequest,
  RefundResolutionResponse,
  RegistrantDto,
  RegistrantResponse,
  SessionKind,
  SessionStatus,
  StuffyState,
} from "@/lib/santas-workshop/admin-contract";
import { REVERT_HISTORY_NOTE, refundResolutionText, registrantActions, revertButtonLabel, revertTargets } from "@/lib/santas-workshop/admin-actions-ui";
import { ADMIN_API, STATE_LABELS, callAdmin } from "@/lib/santas-workshop/admin-ui";
import { ReasonDialog } from "./reason-dialog";
import { BTN_SMALL, INPUT, LABEL } from "./styles";

interface Props {
  registrant: Pick<RegistrantDto, "id" | "orderId" | "state" | "withdrawn" | "needsAttention" | "refund" | "name" | "orderSize">;
  sessionKind: SessionKind;
  sessionStatus: SessionStatus;
}

type Open = "withdraw" | "revert" | "keep" | "refund-withdraw" | null;

/** Per-row actions. Every one is re-checked by the server; this only decides which buttons to offer. */
export function RegistrantActions({ registrant: r, sessionKind, sessionStatus }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<StuffyState>(() => revertTargets(r.state, sessionKind).at(-1) ?? "registered");
  const [error, setError] = useState<string | null>(null);
  const actions = registrantActions(r, sessionKind, sessionStatus);
  if (!actions.withdraw && !actions.dismissAttention && !actions.refund && !actions.revert) return null;

  async function dismiss() {
    setBusy(true);
    setError(null);
    const res = await callAdmin<RegistrantResponse>(ADMIN_API.dismissAttention(r.id), { method: "POST", body: "{}" });
    setBusy(false);
    if (!res.ok) return setError(res.failure.message);
    toast.success("Flag dismissed.");
    router.refresh();
  }

  async function withdraw(reason: string): Promise<string | null> {
    const body: AdminWithdrawRequest = { reason };
    const res = await callAdmin<RegistrantResponse>(ADMIN_API.withdraw(r.id), { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) return res.failure.message;
    toast.success("Withdrawn.");
    router.refresh();
    return null;
  }

  async function revert(reason: string): Promise<string | null> {
    const body: AdminRevertRequest = { toState: target, expectedState: r.state, reason };
    const res = await callAdmin<RegistrantResponse>(ADMIN_API.revert(r.id), { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.failure.code === "stale_state") router.refresh();
      return res.failure.message;
    }
    toast.success(`Back to: ${STATE_LABELS[target]}.`);
    router.refresh();
    return null;
  }

  async function resolveRefund(resolution: "keep" | "withdraw") {
    setOpen(null);
    setBusy(true);
    setError(null);
    const body: RefundResolutionRequest = { resolution };
    const res = await callAdmin<RefundResolutionResponse>(ADMIN_API.refundResolution(r.orderId), { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(res.failure.message);
    toast.success(refundResolutionText(res.data, resolution));
    router.refresh();
  }

  const who = r.name?.trim() ? r.name : `the unnamed stuffy (order of ${r.orderSize})`;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap gap-2">
        {actions.dismissAttention && (
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => void dismiss()}>
            Dismiss flag
          </button>
        )}
        {actions.refund && (
          <>
            <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => setOpen("keep")}>
              Refund: keep
            </button>
            <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => setOpen("refund-withdraw")}>
              Refund: withdraw
            </button>
          </>
        )}
        {actions.withdraw && (
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => setOpen("withdraw")}>
            Withdraw
          </button>
        )}
        {actions.revert && (
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => setOpen("revert")}>
            {revertButtonLabel(sessionKind)}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ReasonDialog
        open={open === "withdraw"}
        onOpenChange={(o) => !o && setOpen(null)}
        title={`Withdraw ${who}?`}
        description="The registration drops off the crew's list. A stuffy that is already checked in cannot be withdrawn."
        confirmLabel="Withdraw"
        onSubmit={withdraw}
      />
      <ReasonDialog
        open={open === "revert"}
        onOpenChange={(o) => !o && setOpen(null)}
        title={sessionKind === "real" ? `Revert the last step for ${who}?` : `Put ${who} back a step?`}
        description={`${sessionKind === "real" ? "This is a real session. " : "Practice session. "}Going back to Registered also frees the sticker. ${REVERT_HISTORY_NOTE}`}
        confirmLabel="Go back"
        onSubmit={revert}
      >
        <div>
          <label htmlFor={`rv-${r.id}`} className={LABEL}>
            Go back to
          </label>
          <select id={`rv-${r.id}`} value={target} onChange={(e) => setTarget(e.target.value as StuffyState)} className={INPUT}>
            {revertTargets(r.state, sessionKind).map((st) => (
              <option key={st} value={st}>
                {STATE_LABELS[st]}
              </option>
            ))}
          </select>
        </div>
      </ReasonDialog>
      <ConfirmDialog
        open={open === "keep"}
        onOpenChange={(o) => !o && setOpen(null)}
        title="Keep this registration?"
        description="The refund stays in Zeffy, but this registration stays on the list and the flag clears for the amount refunded so far."
        confirmLabel="Keep it"
        onConfirm={() => void resolveRefund("keep")}
      />
      <ConfirmDialog
        open={open === "refund-withdraw"}
        onOpenChange={(o) => !o && setOpen(null)}
        title="Withdraw this order?"
        description="Every stuffy in this order that has not been checked in is withdrawn. Any already checked in stay flagged for you to handle."
        confirmLabel="Withdraw them"
        destructive
        onConfirm={() => void resolveRefund("withdraw")}
      />
    </div>
  );
}
