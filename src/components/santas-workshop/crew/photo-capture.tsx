"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CREW_BTN, CREW_BTN_OUTLINE } from "./crew-styles";

interface Props {
  /** The stuffy's name, shown above the preview so the right photo goes on the right stuffy. */
  stuffyLabel: string;
  /** One line telling the worker what to include or leave out of the shot. */
  prompt: string;
  /** "Take photo" label for the first shot. */
  takeLabel?: string;
  useLabel?: string;
  busy?: boolean;
  /** The worker accepted the photo. The parent downscales and queues it. */
  onUse(file: File): void;
  disabled?: boolean;
}

const REMINDER = "Stuffies only, never the children.";

/**
 * Camera capture through a file input with `capture`: it opens the phone's own camera
 * app, so it works without any camera permission prompt and on every browser. The
 * preview shows the stuffy's name above the photo; nothing is sent until "Use photo".
 */
export function PhotoCapture({ stuffyLabel, prompt, takeLabel = "Take photo", useLabel = "Use photo", busy = false, onUse, disabled = false }: Props) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  // The preview URL is created in the change handler and revoked when replaced, reset or unmounted.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const pickedUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (pickedUrl.current) URL.revokeObjectURL(pickedUrl.current);
    },
    [],
  );

  function pick(file: File | undefined) {
    if (pickedUrl.current) URL.revokeObjectURL(pickedUrl.current);
    if (!file) {
      pickedUrl.current = null;
      setPicked(null);
      return;
    }
    // A HEIC photo may not preview in every browser; the <img> then shows its alt text and Use still works.
    const url = URL.createObjectURL(file);
    pickedUrl.current = url;
    setPicked({ file, url });
  }

  function reset() {
    pick(undefined);
    if (input.current) input.current.value = "";
  }

  const file = picked?.file ?? null;
  const previewUrl = picked?.url ?? null;

  return (
    <div className="space-y-3">
      <p className="text-base text-gray-800">{prompt}</p>
      <p className="text-sm font-medium text-gray-600">{REMINDER}</p>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={`${takeLabel} of ${stuffyLabel}`}
        onChange={(e) => pick(e.target.files?.[0])}
        disabled={disabled || busy}
      />
      {!file ? (
        <label
          htmlFor={inputId}
          className={`${CREW_BTN} cursor-pointer ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}
        >
          {takeLabel}
        </label>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold text-gray-900">For: {stuffyLabel}</p>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview, not a site asset
            <img src={previewUrl} alt={`Preview of the photo for ${stuffyLabel}`} className="max-h-[50vh] w-full rounded-2xl bg-gray-100 object-contain" />
          )}
          <button type="button" className={CREW_BTN} disabled={busy} onClick={() => file && onUse(file)}>
            {busy ? "Saving…" : useLabel}
          </button>
          <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={reset}>
            Retake
          </button>
        </div>
      )}
    </div>
  );
}
