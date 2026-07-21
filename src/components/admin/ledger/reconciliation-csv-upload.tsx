"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// Mirrors the upload route's cap exactly — this is a client-side UX nicety
// (fail fast before spending an upload round-trip), never the authoritative
// check. The route re-enforces 2MB server-side regardless.
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

interface ReconciliationCsvUploadProps {
  sessionId: string;
}

/**
 * CSV upload for a session with no statement yet. One upload per session
 * (server-enforced) — this component only ever renders once, before
 * `uploadedAt` is set (see the detail page's conditional).
 *
 * Surfaces the upload route's named header/parse errors verbatim (e.g.
 * "This file doesn't look like a Chase activity export — missing a Posting
 * Date column", or "Row 14: could not parse Amount value \"N/A\"") — never a
 * generic toast, per Phase 1's failure-microcopy requirement.
 */
export default function ReconciliationCsvUpload({ sessionId }: ReconciliationCsvUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("File is too large (max 2MB).");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/upload`,
        { method: "POST", body: formData },
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Could not upload the statement. Try again.");
        return;
      }

      const outOfPeriodNote =
        data.outOfPeriodCount > 0
          ? ` (${data.outOfPeriodCount} row${data.outOfPeriodCount === 1 ? "" : "s"} fell outside the statement period — flagged below.)`
          : "";
      toast.success(`Statement uploaded — ${data.rowCount} rows staged.${outOfPeriodNote}`);
      router.refresh();
    } catch {
      setError("Could not upload the statement. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const inputId = `csv-upload-${sessionId}`;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Upload bank statement</h2>
      <p className="text-sm text-gray-500 mb-4">
        Chase activity export (CSV) for this statement period. One upload per session.
      </p>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
        Statement CSV file
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleChange}
        disabled={uploading}
        aria-describedby={`${inputId}-hint`}
        className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-lions-blue file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-lions-blue-dark file:transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded-lg"
      />
      <p id={`${inputId}-hint`} className="mt-1 text-xs text-gray-400">
        {uploading ? "Parsing statement…" : "CSV export, up to 2MB."}
      </p>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
