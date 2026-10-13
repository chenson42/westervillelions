"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CrewCodeAction, CrewCodeActionRequest, CrewCodeResponse, SessionStatus } from "@/lib/santas-workshop/admin-contract";
import { codeCardStatus, codeShownText, crewInvitation, devicesActiveText } from "@/lib/santas-workshop/admin-actions-ui";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import { Chip } from "./badges";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, LINK } from "./styles";

interface Props {
  sessionId: string;
  slug: string;
  status: SessionStatus;
  access: { issued: boolean; paused: boolean; version: number };
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Couldn’t copy automatically. Select the text and copy it by hand.");
  }
}

export function WorkerCodeCard({ sessionId, slug, status, access }: Props) {
  const router = useRouter();
  const [shown, setShown] = useState<CrewCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState<number | null>(null);
  const summary = codeCardStatus(access, status);

  async function show() {
    setBusy(true);
    setError(null);
    const res = await callAdmin<CrewCodeResponse>(ADMIN_API.crewCode(sessionId));
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    setShown(res.data);
  }

  async function act(action: CrewCodeAction, acknowledge = false) {
    setRotateOpen(false);
    setDevicesOpen(null);
    setBusy(true);
    setError(null);
    const body: CrewCodeActionRequest = { action, ...(acknowledge ? { acknowledge: true } : {}) };
    const res = await callAdmin<CrewCodeResponse>(ADMIN_API.crewCode(sessionId), { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      if (res.failure.code === "devices_active") {
        setDevicesOpen(res.failure.count ?? 1);
        return;
      }
      setError(res.failure.message);
      return;
    }
    setShown(action === "rotate" ? res.data : null);
    toast.success(action === "rotate" ? "New worker code issued. Old phones are signed out." : action === "pause" ? "Worker access paused." : "Worker access resumed.");
    router.refresh();
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const crewPath = `/santas-workshop/crew/${slug}`;

  return (
    <section className={`${CARD} p-6`} aria-labelledby="code-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="code-heading" className="text-lg font-semibold text-gray-900">
          Worker access
        </h2>
        <Chip tone={summary.tone}>{access.paused ? "Paused" : access.issued ? `Code v${access.version}` : "No code"}</Chip>
      </div>
      <p className="mt-1 text-sm text-gray-600">{summary.text}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={busy || !access.issued} onClick={() => void show()}>
          Show code
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={busy || status === "purged"} onClick={() => setRotateOpen(true)}>
          {access.issued ? "Rotate code" : "Issue code"}
        </button>
        {access.issued && (access.paused ? (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void act("resume")}>
            Resume
          </button>
        ) : (
          <button type="button" className={BTN_SECONDARY} disabled={busy || status !== "active"} onClick={() => void act("pause")}>
            Pause
          </button>
        ))}
      </div>

      {shown && (
        <div className="mt-4 rounded-2xl bg-lions-blue/5 p-4" role="status">
          {shown.code ? (
            <>
              <p className="text-sm text-gray-600">Worker code</p>
              <p className="break-all font-mono text-3xl font-bold tracking-widest text-gray-900">{shown.formatted ?? shown.code}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={BTN_SMALL} onClick={() => void copy(shown.formatted ?? shown.code ?? "", "Code")}>
                  Copy code
                </button>
                <button type="button" className={BTN_SMALL} onClick={() => void copy(crewInvitation(origin, slug, shown.formatted), "Message")}>
                  Copy message for the crew
                </button>
                <button type="button" className={BTN_SMALL} onClick={() => setShown(null)}>
                  Hide
                </button>
              </div>
            </>
          ) : null}
          <p className="mt-2 text-sm text-gray-700">{codeShownText(shown)}</p>
        </div>
      )}

      <p className="mt-4 text-sm text-gray-600">
        Crew page for phones:{" "}
        <a href={crewPath} target="_blank" rel="noopener noreferrer" className={LINK}>
          {crewPath}
        </a>{" "}
        (you can open it too: admins skip the code). Share the code by text message, never in an email subject.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={access.issued ? "Rotate the worker code?" : "Issue a worker code?"}
        description={access.issued ? "A new code is issued and every phone using the old one is signed out at once. Photos waiting on a phone stay there and send after it signs in again." : "A code is created so the crew can sign in once the session is active."}
        confirmLabel={access.issued ? "Rotate code" : "Issue code"}
        destructive={access.issued}
        onConfirm={() => void act("rotate")}
      />
      <ConfirmDialog
        open={devicesOpen !== null}
        onOpenChange={(o) => !o && setDevicesOpen(null)}
        title="Phones are signed in right now"
        description={devicesOpen !== null ? devicesActiveText(devicesOpen) : ""}
        confirmLabel="Rotate anyway"
        destructive
        onConfirm={() => void act("rotate", true)}
      />
    </section>
  );
}
