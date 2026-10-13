"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CrewRosterRow } from "@/lib/santas-workshop/crew-contract";
import type { CrewCtx } from "./crew-context";
import { photoUrl } from "./crew-api";
import { CREW_BTN_OUTLINE, CREW_CARD, CREW_NOTICE_AMBER } from "./crew-styles";
import { crewDisplayName } from "./crew-ui";
import { CheckInThumb } from "./check-in-thumb";
import { PhotoCapture } from "./photo-capture";
import { queuePhoto } from "./photo-queue";
import { useCard } from "./use-card";

interface Props {
  ctx: CrewCtx;
  row: CrewRosterRow;
  /** The worker chose to hand the stuffy over now. */
  onHandOver(): void;
}

export function PortraitPanel({ ctx, row, onHandOver }: Props) {
  const retake = row.state === "portrait_taken";
  const { state: cardState } = useCard(ctx, row.id, "portrait");
  // The portrait card says only that a portrait exists; the pickup card carries its photo id for the thumbnail.
  const { state: pickupState } = useCard(ctx, row.id, "pickup");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const name = crewDisplayName(row.name, row.orderSize);
  const waiting = ctx.outboxSnap.items.some((i) => i.stuffyId === row.id && i.kind === "portrait");
  const portraitId = pickupState.status === "ready" ? pickupState.card.portraitPhotoId : null;

  async function queue(file: File) {
    setPending(null);
    setBusy(true);
    setMessage(null);
    const res = await queuePhoto(ctx, {
      file,
      kind: "portrait",
      stuffyId: row.id,
      label: name,
      build: (p) => ({
        photoId: p.photoId,
        expectedState: retake ? "portrait_taken" : "checked_in",
        takenAt: p.takenAt,
        width: p.width,
        height: p.height,
        thumbWidth: p.thumbWidth,
        thumbHeight: p.thumbHeight,
        ...(retake ? { replace: true } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    toast.success("Portrait saved on this phone. Sending…");
    ctx.navigate({ name: "list" });
  }

  return (
    <div className="space-y-4">
      {cardState.status === "ready" && cardState.card.noteToSanta && (
        <div className={`${CREW_CARD} p-4`}>
          <p className="text-sm font-semibold text-gray-500">Note to Santa</p>
          <p className="whitespace-pre-wrap break-words text-lg text-gray-900">{cardState.card.noteToSanta}</p>
        </div>
      )}
      {cardState.status === "error" && <p className="text-red-800">{cardState.message}</p>}
      <CheckInThumb photoId={cardState.status === "ready" ? cardState.card.checkInPhotoId : null} name={name} loading={cardState.status !== "ready"} />

      {retake && (
        <div className={`${CREW_CARD} p-4`}>
          <p className="mb-2 font-semibold text-gray-900">Current portrait</p>
          {portraitId ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the photo door, not a static asset
            <img src={photoUrl(portraitId, "thumb")} alt={`Current portrait of ${name}`} className="max-h-[40vh] w-full rounded-2xl bg-gray-100 object-contain" />
          ) : (
            <p className="text-sm text-gray-600">{pickupState.status === "loading" ? "Loading the photo…" : "The portrait is still arriving or is hidden."}</p>
          )}
        </div>
      )}

      {waiting ? (
        <p role="status" className={CREW_NOTICE_AMBER}>
          The portrait for {name} is saved on this phone and sending. This card updates when it arrives.
        </p>
      ) : (
        <div className={`${CREW_CARD} space-y-4 p-4`}>
          <h3 className="text-lg font-semibold text-gray-900">{retake ? "Retake the portrait" : "Portrait with Santa"}</h3>
          <PhotoCapture
            stuffyLabel={name}
            prompt="Take the portrait with Santa and Mrs. Claus. Keep the sticker out of the shot."
            takeLabel={retake ? "Retake portrait" : "Take portrait"}
            busy={busy}
            onUse={(f) => (retake ? setPending(f) : void queue(f))}
          />
        </div>
      )}

      {message && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {message}
        </p>
      )}

      <button type="button" className={CREW_BTN_OUTLINE} onClick={onHandOver}>
        {retake ? "Hand over to the family" : "Hand over without a portrait"}
      </button>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Replace the portrait?"
        description={`The new photo takes the place of the current portrait for ${name}. The old one is no longer used.`}
        confirmLabel="Replace it"
        onConfirm={() => pending && void queue(pending)}
      />
    </div>
  );
}
