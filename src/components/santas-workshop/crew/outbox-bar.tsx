"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Outbox, OutboxSnapshot } from "./outbox-core";
import { STORAGE_DOWN_MESSAGE } from "./crew-messages";
import { CREW_BTN_SMALL } from "./crew-styles";

interface Props {
  outbox: Outbox;
  snapshot: OutboxSnapshot;
  durable: boolean;
}

const KIND_LABEL = { check_in: "Check-in photo", portrait: "Portrait", group: "Group photo" } as const;

/**
 * The outbox indicator. Shows nothing when nothing is waiting. Otherwise: how many
 * photos exist only on this phone, a plain warning that closing the page (or clearing
 * the browser) loses them, the storage-problem banner, and per-photo Retry / Discard.
 */
export function OutboxBar({ outbox, snapshot, durable }: Props) {
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState<string | null>(null);
  const { waiting, items, autoRetryStopped } = snapshot;
  if (waiting === 0 && !autoRetryStopped) return null;

  const sending = items.filter((i) => i.sending).length;
  const parked = items.filter((i) => i.status === "parked");

  return (
    <section aria-label="Photos waiting to send" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold" role="status">
          {waiting === 0 ? "No photos waiting" : `${waiting} photo${waiting === 1 ? "" : "s"} waiting to send`}
          {sending > 0 ? ` (${sending} sending now)` : ""}
        </p>
        {waiting > 0 && (
          <button type="button" className={CREW_BTN_SMALL} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide" : "Details"}
          </button>
        )}
      </div>
      {waiting > 0 && (
        <p className="mt-1 text-sm">
          {durable
            ? "Photos not sent yet exist only on this phone. Don’t clear this browser’s data until this says none are waiting."
            : "This browser can’t keep photos if the page is closed. Keep this page open until none are waiting."}
        </p>
      )}
      {snapshot.heldForSignIn && <p className="mt-2 text-sm font-semibold">Sending is on hold until you enter the worker code again.</p>}
      {autoRetryStopped && (
        <div className="mt-2 rounded-lg bg-white p-3 text-sm">
          <p className="font-semibold">{STORAGE_DOWN_MESSAGE}</p>
          <button type="button" className={`${CREW_BTN_SMALL} mt-2`} onClick={() => outbox.retryNow()}>
            Try again
          </button>
        </div>
      )}
      {parked.length > 0 && (
        <ul className="mt-2 space-y-2">
          {parked.map((i) => (
            <li key={i.photoId} className="rounded-lg bg-white p-3 text-sm">
              <p className="font-semibold">
                {KIND_LABEL[i.kind]}: {i.label}
              </p>
              <p>{i.message ?? "This photo couldn’t be sent."}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={CREW_BTN_SMALL} onClick={() => outbox.retryItem(i.photoId)}>
                  Try again
                </button>
                <button type="button" className={CREW_BTN_SMALL} onClick={() => setDiscard(i.photoId)}>
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.photoId} className="flex justify-between gap-2">
              <span className="min-w-0 break-words">
                {KIND_LABEL[i.kind]}: {i.label}
              </span>
              <span className="shrink-0 font-medium">{i.sending ? "Sending" : i.status === "parked" ? "Needs you" : i.status === "stopped" ? "Waiting" : i.attempts > 0 ? "Will retry" : "Queued"}</span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={discard !== null}
        onOpenChange={(o) => !o && setDiscard(null)}
        title="Discard this photo?"
        description="It will be deleted from this phone and never sent. You can take it again."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          if (discard) void outbox.discard(discard);
          setDiscard(null);
        }}
      />
    </section>
  );
}
