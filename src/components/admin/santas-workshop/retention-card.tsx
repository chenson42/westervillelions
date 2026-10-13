"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  RETENTION_SCOPES,
  type PurgeRequest,
  type PurgeResponse,
  type ResetResponse,
  type RetentionPreview,
  type RetentionScope,
  type RetentionStatus,
} from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import {
  REASON_WARNING,
  RESET_COPY,
  SCOPE_BUTTONS,
  SCOPE_LABELS,
  progressText,
  purgeDialogCopy,
  purgeDoneText,
  reasonOk,
  scopeStateText,
} from "@/lib/santas-workshop/retention-ui";
import { Chip } from "./badges";
import { BTN_SECONDARY, CARD, INPUT, LABEL } from "./styles";

const MAX_ROUNDS = 400; // a safety stop; each round is one time-boxed server call

interface Props {
  sessionId: string;
  retention: RetentionStatus;
}

type Pending = { kind: "purge"; scope: RetentionScope } | { kind: "reset" } | null;

export function RetentionCard({ sessionId, retention }: Props) {
  const router = useRouter();
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(next: Exclude<Pending, null>) {
    setError(null);
    setBusy(true);
    const res = await callAdmin<RetentionPreview>(ADMIN_API.retentionPreview(sessionId));
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    setPreview(res.data);
    setReason("");
    setPending(next);
  }

  function close() {
    setPending(null);
    setReason("");
  }

  async function runPurge(scope: RetentionScope, force: boolean, why: string) {
    setBusy(true);
    setError(null);
    let deleted = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body: PurgeRequest = { phase: scope, ...(force ? { force: true, reason: why.trim() } : {}) };
      const res = await callAdmin<PurgeResponse>(ADMIN_API.purge(sessionId), { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        setBusy(false);
        setProgress(null);
        setError(res.failure.message);
        router.refresh();
        return;
      }
      deleted += res.data.photosDeleted;
      if (res.data.done) {
        setBusy(false);
        setProgress(null);
        toast.success(purgeDoneText(scope, res.data, deleted));
        router.refresh();
        return;
      }
      setProgress(progressText(deleted, res.data.remaining));
    }
    setBusy(false);
    setProgress(null);
    setError("This is taking longer than expected. Press the button again to continue where it stopped.");
    router.refresh();
  }

  async function runReset() {
    setBusy(true);
    setError(null);
    let deleted = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await callAdmin<ResetResponse>(ADMIN_API.reset(sessionId), { method: "POST", body: "{}" });
      if (!res.ok) {
        setBusy(false);
        setProgress(null);
        setError(res.failure.message);
        router.refresh();
        return;
      }
      deleted += res.data.photosDeleted;
      if (res.data.done) {
        setBusy(false);
        setProgress(null);
        toast.success("The practice session is empty again.");
        router.refresh();
        return;
      }
      setProgress(progressText(deleted, res.data.remaining));
    }
    setBusy(false);
    setProgress(null);
    setError("This is taking longer than expected. Press the button again to continue where it stopped.");
    router.refresh();
  }

  const purgeScope = pending?.kind === "purge" ? pending.scope : null;
  const copy = purgeScope ? purgeDialogCopy(purgeScope, retention[purgeScope], preview ? preview[purgeScope] : null) : null;
  const resetPreview = preview?.reset ?? null;

  return (
    <section className={`${CARD} p-6`} aria-labelledby="retention-heading">
      <h2 id="retention-heading" className="text-lg font-semibold text-gray-900">
        Retention
      </h2>
      <p className="mt-1 text-sm text-gray-600">Families&rsquo; details and the photos are removed on a schedule. Nothing is removed automatically; you press the button.</p>

      <ul className="mt-4 divide-y divide-gray-100">
        {RETENTION_SCOPES.map((scope) => {
          const st = retention[scope];
          const t = scopeStateText(st);
          return (
            <li key={scope} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`retention-${scope}`}>
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {SCOPE_LABELS[scope]}{" "}
                  <Chip tone={st.state === "purged" ? "gray" : st.state === "due" ? "green" : "amber"}>{t.badge}</Chip>
                </p>
                <p className="text-sm text-gray-600 break-words">{t.text}</p>
              </div>
              {st.state !== "purged" && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void ask({ kind: "purge", scope })}>
                  {SCOPE_BUTTONS[scope]}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {retention.canReset && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 p-4">
          <p className="text-sm text-gray-700">This is a practice session. You can empty it and run the drill again.</p>
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void ask({ kind: "reset" })}>
            {RESET_COPY.button}
          </button>
        </div>
      )}

      {progress && (
        <p role="status" className="mt-3 rounded-lg bg-lions-blue/5 p-3 text-sm text-gray-800">
          {progress}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={purgeScope !== null}
        onOpenChange={(o) => !o && close()}
        title={copy?.title ?? ""}
        confirmLabel={copy?.confirmLabel ?? "Confirm"}
        destructive
        confirmDisabled={copy ? !reasonOk(copy, reason) : true}
        onConfirm={() => {
          if (!purgeScope || !copy) return;
          const why = reason;
          const force = copy.needsReason;
          close();
          void runPurge(purgeScope, force, why);
        }}
        description={
          copy && (
            <div className="space-y-2">
              {copy.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {copy.needsReason && (
                <div className="pt-2">
                  <p className="font-medium text-amber-800">{copy.blockedText}</p>
                  <label htmlFor={reasonId} className={`${LABEL} mt-2`}>
                    Reason (kept in the session history)
                  </label>
                  <textarea id={reasonId} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} />
                  <p className="mt-1 text-xs font-semibold text-gray-700">{REASON_WARNING}</p>
                </div>
              )}
            </div>
          )
        }
      />

      <ConfirmDialog
        open={pending?.kind === "reset"}
        onOpenChange={(o) => !o && close()}
        title={RESET_COPY.title}
        confirmLabel={RESET_COPY.confirm}
        destructive
        onConfirm={() => {
          close();
          void runReset();
        }}
        description={
          <div className="space-y-2">
            <p>{RESET_COPY.body}</p>
            {(retention.personal.state === "purged" || retention.public.state === "purged") && <p>{RESET_COPY.purgedNote}</p>}
            {resetPreview && (
              <p>
                {resetPreview.orders} order{resetPreview.orders === 1 ? "" : "s"}, {resetPreview.stuffies} stuff{resetPreview.stuffies === 1 ? "y" : "ies"} and {resetPreview.photos} photo
                {resetPreview.photos === 1 ? "" : "s"} will be deleted.
              </p>
            )}
          </div>
        }
      />
    </section>
  );
}
