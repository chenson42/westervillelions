"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createQrDecoder, decodeStillFile, type QrDecoder } from "./qr-decoder";
import { DECODE_INTERVAL_MS, MAX_SCAN_TEXT, createScanAccumulator } from "./scan-loop";
import { CREW_BTN, CREW_BTN_OUTLINE, CREW_INPUT, CREW_LABEL } from "./crew-styles";

interface Props {
  /** Called once per believed sticker (camera, photo, or typed). */
  onCode(text: string): void;
  /** Disables the camera and the field while a lookup is running. */
  busy?: boolean;
  /** Start the camera as soon as the screen opens. Off when the camera is a secondary choice. */
  autoStart?: boolean;
  /** Short helper shown above the camera. */
  hint?: string;
}

type CameraState = "off" | "starting" | "on" | "denied" | "unavailable";

/**
 * Camera QR scanner with a "type the code" field that is ALWAYS visible and a
 * "scan from a photo" fallback. The camera stream is released when the screen
 * unmounts or the tab is hidden.
 */
export function Scanner({ onCode, busy = false, autoStart = true, hint }: Props) {
  const typedId = useId();
  const photoId = useId();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const decoder = useRef<QrDecoder | null>(null);
  const accumulator = useRef(createScanAccumulator());
  const [camera, setCamera] = useState<CameraState>("off");
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    setCamera("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      decoder.current ??= await createQrDecoder();
      setCamera("on");
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      setCamera(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    const onHide = () => {
      if (document.hidden) {
        stop();
        setCamera("off");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop();
    };
  }, [autoStart, start, stop]);

  useEffect(() => {
    if (camera !== "on") return;
    const acc = accumulator.current;
    acc.reset();
    let working = false;
    const timer = window.setInterval(async () => {
      const v = video.current;
      const d = decoder.current;
      if (working || busyRef.current || !v || !d || v.readyState < 2) return;
      working = true;
      try {
        const text = acc.push(await d.decode(v), Date.now());
        if (text) onCodeRef.current(text);
      } finally {
        working = false;
      }
    }, DECODE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [camera]);

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t || busy) return;
    setTyped("");
    onCodeRef.current(t);
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setNote(null);
    try {
      const text = await decodeStillFile(file);
      if (text && text.length <= MAX_SCAN_TEXT) onCodeRef.current(text);
      else setNote("No sticker found in that photo. Get closer and try again, or type the code.");
    } catch {
      setNote("That photo couldn't be read. Try again, or type the code.");
    }
  }

  return (
    <div className="space-y-4">
      {hint && <p className="text-base text-gray-800">{hint}</p>}
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className={`aspect-[4/3] w-full object-cover ${camera === "on" ? "" : "opacity-0"}`} aria-label="Camera view for scanning a sticker" />
        {camera !== "on" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
            {camera === "starting" && <p>Starting the camera&hellip;</p>}
            {camera === "off" && (
              <button type="button" onClick={() => void start()} className={`${CREW_BTN} max-w-xs`}>
                Turn on camera
              </button>
            )}
            {camera === "denied" && <p>The camera is blocked for this page. Allow it in the browser settings, or type the code below.</p>}
            {camera === "unavailable" && <p>No camera is available here. Type the code below, or scan from a photo.</p>}
          </div>
        )}
        {camera === "on" && <div aria-hidden="true" className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-lions-gold/80" />}
      </div>

      <form onSubmit={submitTyped} className="space-y-2">
        <label htmlFor={typedId} className={CREW_LABEL}>
          Or type the code printed on the sticker
        </label>
        <div className="flex gap-2">
          <input
            id={typedId}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_SCAN_TEXT}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={CREW_INPUT}
          />
          <button type="submit" disabled={busy || !typed.trim()} className="min-h-[52px] shrink-0 rounded-lg bg-lions-blue px-5 font-semibold text-white hover:bg-lions-blue-dark disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2">
            Go
          </button>
        </div>
      </form>

      <div>
        <input id={photoId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void fromPhoto(e.target.files?.[0])} disabled={busy} />
        <label htmlFor={photoId} className={`${CREW_BTN_OUTLINE} cursor-pointer`}>
          Scan from a photo
        </label>
        {note && (
          <p role="status" className="mt-2 text-sm text-amber-800">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
