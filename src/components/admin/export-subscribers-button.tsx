"use client";

import { useState } from "react";

const FORMATS = [
  { value: "zeffy", label: "Zeffy" },
] as const;

type ExportFormat = (typeof FORMATS)[number]["value"];

export default function ExportSubscribersButton() {
  const [format, setFormat] = useState<ExportFormat>("zeffy");
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/newsletter/export?format=${format}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${format}-newsletter-subscribers.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
      >
        {FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleExport}
        disabled={loading}
        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50"
      >
        {loading ? "Exporting…" : "Export"}
      </button>
    </div>
  );
}
