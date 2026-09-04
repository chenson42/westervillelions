"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ClubFileVisibility } from "@/lib/hooks/use-chunked-upload";

/**
 * Metadata-only edit form for a Club File's name/description/visibility —
 * PATCH /api/admin/club-files/[id]. Never touches bytes (replace-in-place
 * is a separate control, ClubFileReplaceControl).
 */
export function ClubFileMetadataForm({
  fileId,
  initialName,
  initialDescription,
  initialVisibility,
}: {
  fileId: string;
  initialName: string;
  initialDescription: string | null;
  initialVisibility: ClubFileVisibility;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [visibility, setVisibility] = useState<ClubFileVisibility>(initialVisibility);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/club-files/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          visibility,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save changes");
      }
      toast.success("Changes saved");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Details</h2>

      <div>
        <label htmlFor="edit-club-file-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name
        </label>
        <input
          id="edit-club-file-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSaving}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="edit-club-file-description" className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="edit-club-file-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSaving}
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
              name="edit-visibility"
              checked={visibility === "members-only"}
              onChange={() => setVisibility("members-only")}
              disabled={isSaving}
              className="focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            Members only
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="edit-visibility"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              disabled={isSaving}
              className="focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            Public
          </label>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSaving}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        {isSaving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
