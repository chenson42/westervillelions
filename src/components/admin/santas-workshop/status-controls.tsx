"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CrewCodeResponse, SessionKind, SessionStatus, SetStatusRequest, SetStatusResponse } from "@/lib/santas-workshop/admin-contract";
import { closeWarningText, statusActionsFor, statusDoneText, statusHelp, type StatusAction } from "@/lib/santas-workshop/admin-actions-ui";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "./styles";
import { StatusBadge } from "./badges";

interface Props {
  sessionId: string;
  status: SessionStatus;
  kind: SessionKind;
}

export function StatusControls({ sessionId, status, kind }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState(0);
  const actions = statusActionsFor(status);

  async function run(action: StatusAction) {
    setPending(null);
    setBusy(true);
    setError(null);
    const body: SetStatusRequest = { to: action.to };
    const res = await callAdmin<SetStatusResponse>(ADMIN_API.status(sessionId), { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    toast.success(statusDoneText(action.to, res.data.noop));
    router.refresh();
  }

  // B-181: the same "phones that used the code in the last hour" count the rotate dialog reports.
  async function ask(a: StatusAction) {
    setDevices(0);
    if (a.to === "closed") {
      setBusy(true);
      const res = await callAdmin<CrewCodeResponse>(ADMIN_API.crewCode(sessionId));
      setBusy(false);
      if (res.ok) setDevices(res.data.activeDevicesLastHour);
    }
    setPending(a);
  }

  const warning = pending?.to === "closed" ? closeWarningText(devices) : null;

  return (
    <section className={`${CARD} p-6`} aria-labelledby="status-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="status-heading" className="text-lg font-semibold text-gray-900">
          Session status
        </h2>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-sm text-gray-600">{statusHelp(status, kind)}</p>
      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {actions.map((a) => (
            <button
              key={a.to}
              type="button"
              disabled={busy}
              className={a.primary ? BTN_PRIMARY : BTN_SECONDARY}
              onClick={() => (a.confirm ? void ask(a) : void run(a))}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.confirm?.title ?? ""}
        description={
          <>
            <p>{pending?.confirm?.body ?? ""}</p>
            {warning && (
              <p className="mt-2 rounded-lg bg-amber-50 p-3 font-medium text-amber-900" data-testid="close-warning">
                {warning}
              </p>
            )}
          </>
        }
        confirmLabel={pending?.confirm?.confirmLabel ?? "Confirm"}
        destructive={pending?.confirm?.destructive ?? false}
        onConfirm={() => pending && void run(pending)}
      />
    </section>
  );
}
