"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CheckInWithoutPhotoRequest, CrewActionResponse, CrewRosterRow } from "@/lib/santas-workshop/crew-contract";
import { crewPaths, newKey, postJson } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN_OUTLINE, CREW_CARD, CREW_NOTICE_AMBER, CREW_NOTICE_RED } from "./crew-styles";
import { crewDisplayName } from "./crew-ui";
import { PhotoCapture } from "./photo-capture";
import { queuePhoto } from "./photo-queue";
import { STORAGE_DOWN_MESSAGE } from "./crew-messages";
import { useCard } from "./use-card";

interface Props {
  ctx: CrewCtx;
  row: CrewRosterRow;
}

export function CheckInPanel({ ctx, row }: Props) {
  const { state: cardState, reload } = useCard(ctx, row.id, "checkin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refundOk, setRefundOk] = useState(false);
  const [noPhotoOpen, setNoPhotoOpen] = useState(false);
  const name = crewDisplayName(row.name, row.orderSize);
  const waiting = ctx.outboxSnap.items.some((i) => i.stuffyId === row.id && i.kind === "check_in");
  const storageDown = ctx.outboxSnap.autoRetryStopped;
  const blockedByRefund = row.refundBadge && !refundOk;

  async function acceptPhoto(file: File) {
    setBusy(true);
    setMessage(null);
    const res = await queuePhoto(ctx, {
      file,
      kind: "check_in",
      stuffyId: row.id,
      label: name,
      build: (p) => ({ photoId: p.photoId, expectedState: "tagged", takenAt: p.takenAt, width: p.width, height: p.height, ...(refundOk ? { refundContinue: true } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    toast.success("Saved on this phone. Sending…");
    ctx.navigate({ name: "list" });
  }

  async function withoutPhoto() {
    setNoPhotoOpen(false);
    setBusy(true);
    setMessage(null);
    const body: CheckInWithoutPhotoRequest = { withoutPhoto: true, expectedState: "tagged", idempotencyKey: newKey(), ...(refundOk ? { refundContinue: true } : {}) };
    const res = await postJson<CrewActionResponse>(crewPaths(ctx.slug).checkIn(row.id), body);
    setBusy(false);
    if (res.ok) {
      ctx.applyRow(res.data.stuffy);
      toast.success(`${name} is checked in (no photo)`);
      return;
    }
    setMessage(ctx.failureText(res, "check_in"));
    if (res.body?.code === "stale_state") {
      void ctx.refresh();
      reload();
    }
  }

  return (
    <div className="space-y-4">
      <div className={`${CREW_CARD} p-4`}>
        {cardState.status === "loading" && <p className="text-gray-500">Loading&hellip;</p>}
        {cardState.status === "error" && <p className="text-red-800">{cardState.message}</p>}
        {cardState.status === "ready" && (
          <dl className="space-y-3">
            <div>
              <dt className="text-sm font-semibold text-gray-500">Snack choice</dt>
              <dd className="text-2xl font-bold text-gray-900 break-words">{cardState.card.snack ?? "None chosen. Ask the family."}</dd>
            </div>
            {cardState.card.careNote && (
              <div>
                <dt className="text-sm font-semibold text-gray-500">Care note from the family</dt>
                <dd className="whitespace-pre-wrap break-words text-gray-900">{cardState.card.careNote}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {row.refundBadge && (
        <div role="alert" className={CREW_NOTICE_RED}>
          <p className="font-semibold">This registration shows as refunded.</p>
          <p className="mt-1 text-sm">Ask the event chair before taking this stuffy in. If the chair says go ahead, tap Continue.</p>
          {!refundOk && (
            <button type="button" className={`${CREW_BTN_OUTLINE} mt-3 !border-red-700 !text-red-800`} onClick={() => setRefundOk(true)}>
              Continue anyway
            </button>
          )}
        </div>
      )}

      {waiting ? (
        <p role="status" className={CREW_NOTICE_AMBER}>
          The check-in photo for {name} is saved on this phone and sending. This card updates when it arrives.
        </p>
      ) : (
        <div className={`${CREW_CARD} space-y-4 p-4`}>
          <h3 className="text-lg font-semibold text-gray-900">Check-in photo</h3>
          {storageDown && <p className={CREW_NOTICE_AMBER}>{STORAGE_DOWN_MESSAGE} You can still check in without a photo.</p>}
          {blockedByRefund ? (
            <p className="text-gray-700">Tap Continue above once the chair says it is fine.</p>
          ) : (
            <>
              <PhotoCapture
                stuffyLabel={name}
                prompt="Take a photo of the stuffy with its sticker showing."
                busy={busy}
                onUse={(f) => void acceptPhoto(f)}
              />
              <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => setNoPhotoOpen(true)}>
                Check in without a photo
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={noPhotoOpen}
        onOpenChange={setNoPhotoOpen}
        title="Check in without a photo?"
        description={`${name} will be marked checked in with no photo. The event chair can see that no photo was taken.`}
        confirmLabel="Check in"
        onConfirm={() => void withoutPhoto()}
      />
    </div>
  );
}
