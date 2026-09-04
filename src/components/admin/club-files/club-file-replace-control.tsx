"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useChunkedUpload, CLUB_FILE_MAX_DECLARED_SIZE } from "@/lib/hooks/use-chunked-upload";
import { formatFileSize } from "@/lib/utils";

/**
 * Replace-in-place control for an existing Club File (docs/work-log/
 * 2026-09-04-club-documents.md, Phase 1 ruling: replace keeps the same row's
 * title/visibility/event-attachments, just swaps the bytes — no version
 * history). Shares the same chunked-upload hook as the new-file form; the
 * finalize call sends no metadata (server ignores it for a replace).
 */
export function ClubFileReplaceControl({ fileId, currentFilename }: { fileId: string; currentFilename: string }) {
  const router = useRouter();
  const { status, progress, error, upload, retry, canRetry, reset } = useChunkedUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const isBusy = status === "uploading" || status === "finalizing";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > CLUB_FILE_MAX_DECLARED_SIZE) {
      setFileError(
        `This file is ${formatFileSize(selected.size)}. Files must be under ${formatFileSize(CLUB_FILE_MAX_DECLARED_SIZE)}.`,
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
  }

  function onSuccess() {
    toast.success("File replaced");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    reset();
    router.refresh();
  }

  async function handleUpload() {
    if (!file) {
      setFileError("Choose a replacement PDF first.");
      return;
    }
    const result = await upload(file, {}, { replaceFileId: fileId });
    if (result) onSuccess();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Replace file</h2>
      <p className="text-sm text-gray-500">
        Uploads new bytes for <span className="font-medium text-gray-700">{currentFilename}</span> in place. The
        name, description, visibility, and event attachments stay the same.
      </p>

      <input
        id="club-file-replace-input"
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        disabled={isBusy}
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-lions-blue file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-lions-blue-dark file:transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
      />

      {isBusy && (
        <div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-lions-blue transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {status === "finalizing" ? "Finishing up…" : `Uploading… ${progress}%`}
          </p>
        </div>
      )}

      {(fileError || error) && (
        <p className="text-sm text-red-600" role="alert">
          {fileError || error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={isBusy || !file}
          className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {isBusy ? "Uploading…" : "Replace file"}
        </button>
        {status === "error" && canRetry && (
          <button
            type="button"
            onClick={() => retry().then((result) => result && onSuccess())}
            className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
