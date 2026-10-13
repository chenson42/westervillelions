"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  CrewRosterRow,
  PickupCheckRequest,
  PickupCheckResponse,
  PickupNameRequest,
  PickupNameResponse,
  PickupRequest,
  PickupResponse,
} from "@/lib/santas-workshop/crew-contract";
import { crewPaths, newKey, photoUrl, postJson } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN, CREW_BTN_GOLD, CREW_BTN_OUTLINE, CREW_CARD, CREW_INPUT, CREW_LABEL, CREW_NOTICE_AMBER } from "./crew-styles";
import { crewDisplayName, pickupControls, type PickupVerdict } from "./crew-ui";
import { CheckInThumb } from "./check-in-thumb";
import { useCard } from "./use-card";

interface Props {
  ctx: CrewCtx;
  row: CrewRosterRow;
  onDone(): void;
}

type Step = "start" | "checked" | "done";

const NOTE_MIN = 3;

/** Draws the family page link as a big QR on the worker's phone, for the parent to scan with theirs. */
function FamilyQr({ href }: { href: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode").then(async (mod) => {
      const url = await mod.toDataURL(href, { width: 560, margin: 2, errorCorrectionLevel: "M" });
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [href]);
  // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
  return src ? <img src={src} alt="QR code for the family's photo page" className="mx-auto w-full max-w-xs" /> : <div className="mx-auto aspect-square w-full max-w-xs animate-pulse rounded-2xl bg-gray-100" />;
}

export function PickupPanel({ ctx, row, onDone }: Props) {
  const { state: cardState } = useCard(ctx, row.id, "pickup");
  const [step, setStep] = useState<Step>("start");
  const [parentName, setParentName] = useState<string | null>(null);
  const [someoneElse, setSomeoneElse] = useState(false);
  const [note, setNote] = useState("");
  const [elseNote, setElseNote] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<PickupVerdict>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PickupResponse | null>(null);
  const nameKey = useRef(newKey());
  const checkKey = useRef(newKey());
  const pickupKey = useRef(newKey());
  const name = crewDisplayName(row.name, row.orderSize);
  const controls = pickupControls(step === "checked", verdict);
  const alreadyDone = row.state === "picked_up" && step !== "done";

  async function showName() {
    setBusy(true);
    setMessage(null);
    // The server records that the name was shown and returns the name on file.
    const body: PickupNameRequest = { idempotencyKey: nameKey.current };
    const res = await postJson<PickupNameResponse>(crewPaths(ctx.slug).pickupName(row.id), body);
    setBusy(false);
    if (res.ok) {
      setParentName(res.data.parentName);
      setStep("checked");
      return;
    }
    setMessage(ctx.failureText(res, "pickup_check"));
    if (res.body?.code === "stale_state" || res.body?.code === "illegal_transition") void ctx.refresh();
  }

  async function recordSomeoneElse() {
    const trimmed = note.trim();
    if (trimmed.length < NOTE_MIN) {
      setMessage("Write who is collecting, so the chair knows (at least a few letters).");
      return;
    }
    setBusy(true);
    setMessage(null);
    const body: PickupCheckRequest = { result: "someone_else", note: trimmed, idempotencyKey: newKey() };
    const res = await postJson<PickupCheckResponse>(crewPaths(ctx.slug).pickupCheck(row.id), body);
    setBusy(false);
    if (!res.ok) {
      setMessage(ctx.failureText(res, "pickup_check"));
      return;
    }
    setSomeoneElse(false);
    setElseNote(trimmed);
    setVerdict("someone_else");
    toast.success("Noted. You can hand the stuffy over now.");
  }

  async function nameMatches() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const check: PickupCheckRequest = { result: "matched", idempotencyKey: checkKey.current };
    const res = await postJson<PickupCheckResponse>(crewPaths(ctx.slug).pickupCheck(row.id), check);
    setBusy(false);
    if (!res.ok) {
      setMessage(ctx.failureText(res, "pickup_check"));
      return;
    }
    setVerdict("matched");
  }

  async function markPickedUp() {
    if (busy || verdict === null) return;
    setBusy(true);
    setMessage(null);
    const expected = row.state === "portrait_taken" ? "portrait_taken" : "checked_in";
    const body: PickupRequest = { expectedState: expected, idempotencyKey: pickupKey.current };
    const res = await postJson<PickupResponse>(crewPaths(ctx.slug).pickup(row.id), body);
    setBusy(false);
    if (res.ok) {
      setResult(res.data);
      setStep("done");
      // Pickup never waits on a photo: refresh the list so the row shows Picked up.
      void ctx.refresh();
      return;
    }
    const b = res.body;
    if (b?.code === "already_picked_up") {
      setMessage(`Already picked up at ${new Date(b.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
      void ctx.refresh();
      return;
    }
    setMessage(ctx.failureText(res, "pickup"));
    if (b?.code === "stale_state") void ctx.refresh();
  }

  if (step === "done" && result) {
    const href = typeof window === "undefined" ? result.familyUrl : new URL(result.familyUrl, window.location.origin).toString();
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-green-50 p-4 text-center text-green-900">
          <p className="text-xl font-bold">{name} is picked up.</p>
          {result.replayed && <p className="mt-1 text-sm">That was already recorded.</p>}
        </div>
        <div className={`${CREW_CARD} space-y-3 p-4 text-center`}>
          <p className="font-semibold text-gray-900">Show this to the family. It opens their photo page.</p>
          <FamilyQr href={href} />
        </div>
        <button type="button" className={CREW_BTN} onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  if (alreadyDone) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl bg-gray-100 p-4 text-center text-lg font-semibold text-gray-800">{name} has already been picked up.</p>
        <button type="button" className={CREW_BTN_OUTLINE} onClick={onDone}>
          Back to the list
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {cardState.status === "ready" && (
        <div className={`${CREW_CARD} p-4`}>
          {cardState.card.portraitPhotoId ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the photo door
            <img src={photoUrl(cardState.card.portraitPhotoId, "thumb")} alt={`Portrait of ${name}`} className="max-h-[32vh] w-full rounded-2xl bg-gray-100 object-contain" />
          ) : (
            <p className="text-sm text-gray-600">{cardState.card.hasPortrait ? "The portrait is not shown here." : "No portrait was taken. You can still hand the stuffy over."}</p>
          )}
        </div>
      )}
      {cardState.status === "error" && <p className="text-red-800">{cardState.message}</p>}
      <CheckInThumb photoId={cardState.status === "ready" ? cardState.card.checkInPhotoId : null} name={name} loading={cardState.status !== "ready"} />

      {row.refundBadge && (
        <p role="status" className={CREW_NOTICE_AMBER}>
          This registration shows as refunded. Handing over is still fine; the chair will sort it out.
        </p>
      )}

      {step === "start" ? (
        <div className={`${CREW_CARD} space-y-3 p-4`}>
          <h3 className="text-lg font-semibold text-gray-900">Confirm who is collecting</h3>
          <p className="text-gray-800">Ask the person for their name, then tap the button to see the name on the order.</p>
          <button type="button" className={CREW_BTN} disabled={busy} onClick={() => void showName()}>
            {busy ? "Checking…" : "Show the name on the order"}
          </button>
          <button type="button" className={CREW_BTN_GOLD} disabled>
            Mark picked up
          </button>
        </div>
      ) : (
        <div className={`${CREW_CARD} space-y-4 p-4`}>
          <div>
            <p className="text-sm font-semibold text-gray-500">Name on the order</p>
            <p className="text-3xl font-bold text-gray-900 break-words">{parentName ?? "No name on file"}</p>
          </div>
          {controls.showVerdictButtons && verdict === null && (
            <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => void nameMatches()}>
              Name matches
            </button>
          )}
          {verdict === "matched" && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">Recorded: the name matches.</p>}
          <button type="button" className={CREW_BTN_GOLD} disabled={busy || !controls.canMarkPickedUp} onClick={() => void markPickedUp()}>
            {busy ? "Saving…" : "Mark picked up"}
          </button>
          {verdict === "matched" ? null : elseNote ? (
            <p className="rounded-lg bg-lions-blue/10 p-3 text-sm text-lions-blue-dark">Noted: {elseNote}</p>
          ) : someoneElse ? (
            <div className="space-y-2">
              <label htmlFor="sw-pickup-note" className={CREW_LABEL}>
                Who is collecting?
              </label>
              <input id="sw-pickup-note" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={CREW_INPUT} />
              <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => void recordSomeoneElse()}>
                Save, then I can mark it picked up
              </button>
            </div>
          ) : (
            <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => setSomeoneElse(true)}>
              Someone else is collecting
            </button>
          )}
        </div>
      )}

      {message && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {message}
        </p>
      )}
    </div>
  );
}
