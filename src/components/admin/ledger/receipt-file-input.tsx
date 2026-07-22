"use client";

import { useRef, useState } from "react";
import { computeResizeDimensions, RECEIPT_IMAGE_JPEG_QUALITY } from "@/lib/image-resize";
import {
  classifyHeicDecodeFailure,
  decodeHeicFileToJpegBlob,
  getHeicDecodeFailureMessage,
} from "@/lib/heic-decode";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — same cap as the upload route enforces

interface ReceiptFileInputProps {
  /** Called once a file has been resized (if applicable) and uploaded successfully. */
  onUploaded: (result: { key: string; displayName: string }) => void;
  /** Optional "back out of replace mode" affordance — rendered as a small link below the input. */
  onCancel?: () => void;
  disabled?: boolean;
  /** Unique suffix so multiple instances (e.g., create dialog + edit dialog) don't collide on id. */
  idSuffix?: string;
}

// "preparing" covers native decode, the WASM chunk fetch/decode (HEIC only),
// and the post-WASM resize — none of that is network upload yet. "uploading"
// starts only once the fetch to the upload route actually begins.
type Status = "idle" | "preparing" | "uploading" | "error";

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif)$/i.test(file.name)
  );
}

/**
 * HEIC/HEIF detection (see docs/work-log/2026-07-21-receipt-heic-support.md).
 * Browsers that can't decode HEIC also tend not to report a MIME type for it
 * (`file.type` is `""`), so this checks both the type Safari does report
 * (`image/heic` / `image/heif`) and the file extension.
 *
 * This distinction matters because a decode failure for a HEIC file must
 * *not* fall back to uploading the original bytes the way other image decode
 * failures do — the server's magic-bytes check only allows PDF/JPEG/PNG, so
 * raw HEIC bytes would 400 with a confusing generic error. Instead, a native
 * decode failure on a HEIC file gets one more attempt via the WASM decoder
 * in @/lib/heic-decode (any browser, not just Chrome/Firefox — see
 * handleChange); only if that also fails does the admin see an error.
 */
function isHeicFile(file: File): boolean {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

/**
 * Resizes an image file client-side per the Phase 3 downscale spec (longest
 * edge 1600px, JPEG quality 0.82, PNG/HEIC converted to JPEG). Pure dimension
 * math lives in src/lib/image-resize.ts; this is the thin canvas glue around
 * it.
 *
 * Decoding uses `createImageBitmap`, which Safari (macOS + iOS) can satisfy
 * natively for HEIC/HEIF source files via the OS's image decoders; Chrome and
 * Firefox cannot decode HEIC and will reject the promise.
 *
 * If decoding/resizing fails for any reason, the caller falls back to
 * uploading the original file — resize is a UX nicety, never a trust
 * boundary, and it must never block an upload the way missing server-side
 * validation would. The one exception is HEIC: see the `isHeicFile` branch in
 * `handleChange`, which intercepts a HEIC decode failure before it reaches
 * this fallback.
 */
async function resizeImage(file: File): Promise<{ blob: Blob; name: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = computeResizeDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", RECEIPT_IMAGE_JPEG_QUALITY),
    );
    if (!blob) throw new Error("Could not process the image.");

    const baseName = file.name.replace(/\.[^./\\]+$/, "") || "receipt";
    return { blob, name: `${baseName}.jpg` };
  } finally {
    bitmap.close();
  }
}

/**
 * File picker for attaching a receipt to an expense transaction.
 *
 * Uploads happen as soon as a file is selected — not deferred to the
 * transaction form's Save button — so the parent form always holds an
 * already-minted opaque storage key by the time it submits (mirrors the
 * reimbursement precedent's two-step upload-then-attach ordering, DECISION-020).
 *
 * If the upload fails, the error is shown inline here and the parent is never
 * notified — the transaction save is never blocked by a receipt-upload
 * failure (Phase 1 Flow A). The admin can retry, or save without a receipt
 * and attach one later via edit.
 *
 * Server-side magic-byte validation and the 10 MB cap in the upload route are
 * authoritative regardless of what happens here.
 */
export default function ReceiptFileInput({
  onUploaded,
  onCancel,
  disabled,
  idSuffix = "",
}: ReceiptFileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus("error");
      setError("File must be 10 MB or smaller.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setStatus("preparing");
    setError(null);

    try {
      let uploadBlob: Blob = file;
      let displayName = file.name || "receipt";

      if (isImageFile(file)) {
        try {
          const resized = await resizeImage(file);
          uploadBlob = resized.blob;
          displayName = resized.name;
        } catch {
          if (isHeicFile(file)) {
            // Native decode failed on a HEIC file — try the WASM decoder
            // before giving up, regardless of browser (this also covers the
            // rare case of Safari itself failing on an unusual HEIC
            // variant). Unlike other image decode failures, HEIC must not
            // fall through to a raw-bytes upload — the server's magic-bytes
            // check only allows PDF/JPEG/PNG and would 400 with a confusing
            // error.
            try {
              const jpegBlob = await decodeHeicFileToJpegBlob(file);
              const jpegAsFile = new File([jpegBlob], file.name, { type: "image/jpeg" });
              const resized = await resizeImage(jpegAsFile); // existing path, now succeeds — it's a JPEG
              uploadBlob = resized.blob;
              displayName = resized.name;
            } catch (wasmErr) {
              setStatus("error");
              setError(getHeicDecodeFailureMessage(classifyHeicDecodeFailure(wasmErr)));
              return;
            }
          } else {
            // Fall back to the original file — resize is a nicety, not a
            // trust boundary, and a decode failure must not block the upload.
            uploadBlob = file;
            displayName = file.name || "receipt";
          }
        }
      }

      setStatus("uploading");

      const formData = new FormData();
      formData.append("file", uploadBlob, displayName);

      const res = await fetch("/api/admin/ledger/transactions/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to upload receipt.");
      }

      const data = await res.json();
      setStatus("idle");
      onUploaded({ key: data.key as string, displayName });
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Could not upload the receipt. You can save the transaction without one and attach it later.",
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const inputId = `receipt-file-input${idSuffix}`;
  const hintId = `${inputId}-hint`;

  return (
    <div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        capture="environment"
        onChange={handleChange}
        disabled={disabled || status === "preparing" || status === "uploading"}
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-lions-blue file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-lions-blue-dark file:transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
        aria-describedby={hintId}
      />
      <p id={hintId} className="mt-1 text-xs text-gray-400">
        {status === "preparing"
          ? "Preparing photo…"
          : status === "uploading"
          ? "Uploading receipt…"
          : "PDF, JPEG, PNG, or HEIC, up to 10 MB. Photos are resized automatically."}
      </p>
      {status === "error" && error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-1 py-0.5"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
