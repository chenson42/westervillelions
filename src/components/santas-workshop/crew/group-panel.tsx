"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN, CREW_CARD } from "./crew-styles";
import { PhotoCapture } from "./photo-capture";
import { queuePhoto } from "./photo-queue";

/** Group photos belong to the session, not to a stuffy: no scan, no name. */
export function GroupPanel({ ctx }: { ctx: CrewCtx }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  // Remounting the capture control clears its preview after each photo.
  const [round, setRound] = useState(0);

  async function use(file: File) {
    setBusy(true);
    setMessage(null);
    const res = await queuePhoto(ctx, {
      file,
      kind: "group",
      stuffyId: null,
      label: "Group photo",
      build: (p) => ({ photoId: p.photoId, takenAt: p.takenAt, width: p.width, height: p.height, thumbWidth: p.thumbWidth, thumbHeight: p.thumbHeight }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    setSaved((n) => n + 1);
    setRound((r) => r + 1);
    toast.success("Group photo saved on this phone. Sending…");
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <h2 className="text-2xl font-bold text-gray-900">Group photo</h2>
      <div className={`${CREW_CARD} space-y-4 p-4`}>
        <PhotoCapture key={round} stuffyLabel="the group" prompt="Take a photo of the stuffies together with Santa and Mrs. Claus. No children in frame." takeLabel="Take group photo" busy={busy} onUse={(f) => void use(f)} />
      </div>
      {saved > 0 && (
        <p role="status" className="rounded-2xl bg-green-50 p-3 text-green-900">
          {saved} group photo{saved === 1 ? "" : "s"} saved on this phone. Take another, or go back to the list.
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-amber-900">
          {message}
        </p>
      )}
      <button type="button" className={CREW_BTN} onClick={() => ctx.navigate({ name: "list" })}>
        Back to the list
      </button>
    </div>
  );
}
