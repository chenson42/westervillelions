"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  useChunkedUpload,
  CLUB_FILE_MAX_DECLARED_SIZE,
  type ClubFileVisibility,
} from "@/lib/hooks/use-chunked-upload";
import { formatFileSize } from "@/lib/utils";

/**
 * New-file upload form for /admin/club-files (docs/work-log/
 * 2026-09-04-club-documents.md, Phase 3 Component Plan). Uses the shared
 * chunked-upload hook — see src/lib/hooks/use-chunked-upload.ts.
 *
 * Failure UX per Phase 1 Flow 1: an upload error is shown inline (never a
 * generic toast) and the form retains whatever the admin already typed —
 * nothing is cleared on failure, only on success.
 */
export function ClubFileUploadForm() {
  const router = useRouter();
  const { status, progress, error, upload, retry, canRetry, reset } = useChunkedUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ClubFileVisibility>("members-only");
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
    if (!name) setName(selected.name.replace(/\.pdf$/i, ""));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileError("Choose a PDF to upload.");
      return;
    }
    if (!name.trim()) {
      setFileError("Enter a name for this file.");
      return;
    }

    const result = await upload(file, {
      name: name.trim(),
      description: description.trim() || null,
      visibility,
    });

    if (result) {
      toast.success("File uploaded");
      setFile(null);
      setName("");
      setDescription("");
      setVisibility("members-only");
      if (fileInputRef.current) fileInputRef.current.value = "";
      reset();
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4"
    >
      <h2 className="text-lg font-semibold text-gray-900">Upload a file</h2>

      <div>
        <label htmlFor="club-file-input" className="block text-sm font-medium text-gray-700 mb-1">
          PDF file
        </label>
        <input
          id="club-file-input"
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          disabled={isBusy}
          className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-lions-blue file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-lions-blue-dark file:transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
          aria-describedby="club-file-input-hint"
        />
        <p id="club-file-input-hint" className="mt-1 text-xs text-gray-400">
          PDF only, up to {formatFileSize(CLUB_FILE_MAX_DECLARED_SIZE)}.
          {file && !fileError && ` Selected: ${file.name} (${formatFileSize(file.size)})`}
        </p>
      </div>

      <div>
        <label htmlFor="club-file-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name
        </label>
        <input
          id="club-file-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isBusy}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
          placeholder="e.g. Rudolph Run Sponsorship Packet"
        />
      </div>

      <div>
        <label htmlFor="club-file-description" className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="club-file-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isBusy}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
        />
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700 mb-1">Visibility</span>
        <div className="flex gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="visibility"
              value="members-only"
              checked={visibility === "members-only"}
              onChange={() => setVisibility("members-only")}
              disabled={isBusy}
              className="focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            Members only
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              disabled={isBusy}
              className="focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            Public
          </label>
        </div>
      </div>

      {isBusy && (
        <div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full bg-lions-blue transition-all"
              style={{ width: `${progress}%` }}
            />
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
          type="submit"
          disabled={isBusy}
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {isBusy ? "Uploading…" : "Upload"}
        </button>
        {status === "error" && canRetry && (
          <button
            type="button"
            onClick={() => retry().then((result) => {
              if (result) {
                toast.success("File uploaded");
                setFile(null);
                setName("");
                setDescription("");
                setVisibility("members-only");
                if (fileInputRef.current) fileInputRef.current.value = "";
                reset();
                router.refresh();
              }
            })}
            className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            Retry
          </button>
        )}
      </div>
    </form>
  );
}
