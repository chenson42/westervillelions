"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Extract the Zeffy URL from either a plain URL or an HTML embed snippet. */
function parseZeffyInput(input: string): string {
  const trimmed = input.trim();
  // If it contains an iframe src, extract it
  const srcMatch = trimmed.match(/src=['"]([^'"]*zeffy\.com[^'"]+)['"]/);
  if (srcMatch) return srcMatch[1];
  return trimmed;
}

export interface CampaignFormData {
  title: string;
  description?: string | null;
  zeffyLink: string;
  image?: string | null;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
}

export default function CampaignForm({
  campaign,
  campaignId,
}: {
  campaign?: CampaignFormData;
  campaignId?: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<CampaignFormData>(
    campaign || {
      title: "",
      zeffyLink: "",
      displayOrder: 0,
      isActive: true,
      isPublic: true,
    }
  );
  // Raw textarea value — could be a URL or a full HTML snippet
  const [zeffySnippet, setZeffySnippet] = useState(campaign?.zeffyLink ?? "");
  const [isFetchingImage, setIsFetchingImage] = useState(false);

  async function handleZeffyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    setZeffySnippet(raw);
    const parsed = parseZeffyInput(raw);
    setFormData((prev) => ({ ...prev, zeffyLink: parsed }));

    // Auto-fetch og:image when a valid Zeffy URL is detected and no image is set
    if (parsed && parsed.includes("zeffy.com") && !formData.image) {
      setIsFetchingImage(true);
      try {
        const res = await fetch(`/api/admin/zeffy-meta?url=${encodeURIComponent(parsed)}`);
        const data = await res.json();
        let toasted = false;
        if (data.image) {
          setFormData((prev) => ({ ...prev, zeffyLink: parsed, image: data.image }));
          toasted = true;
        }
        if (data.description && !formData.description) {
          setFormData((prev) => ({ ...prev, description: data.description }));
          toasted = true;
        }
        if (toasted) toast.success("Info pulled from Zeffy");
      } catch {
        // Silently ignore — image just won't be pre-filled
      } finally {
        setIsFetchingImage(false);
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = campaignId
        ? `/api/admin/campaigns/${campaignId}`
        : "/api/admin/campaigns";
      const method = campaignId ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save campaign");
      }

      toast.success(
        campaignId ? "Campaign updated successfully" : "Campaign created successfully"
      );
      router.push("/admin/campaigns");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);

      const response = await fetch("/api/admin/upload", { method: "POST", body: data });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Upload failed");
      }
      const { url } = await response.json();
      setFormData((prev) => ({ ...prev, image: url }));
      toast.success("Image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : type === "number"
          ? parseInt(value, 10) || 0
          : value || null,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Information */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Campaign Information
        </h2>
        <div className="mt-6 space-y-6">
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700"
            >
              Campaign Title *
            </label>
            <input
              type="text"
              id="title"
              name="title"
              required
              value={formData.title}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              value={formData.description || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="zeffySnippet"
              className="block text-sm font-medium text-gray-700"
            >
              Zeffy Embed *
            </label>
            <textarea
              id="zeffySnippet"
              rows={4}
              value={zeffySnippet}
              onChange={handleZeffyChange}
              placeholder={`Paste the Zeffy embed snippet or URL here.\n\nExample snippet:\n<div ...><iframe src='https://www.zeffy.com/embed/...' ...></iframe></div>`}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              required={!formData.zeffyLink}
            />
            {formData.zeffyLink && (
              <p className="mt-1 text-xs text-green-700 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
                URL extracted: <span className="font-medium truncate max-w-xs inline-block align-bottom">{formData.zeffyLink}</span>
              </p>
            )}
            {zeffySnippet && !formData.zeffyLink && (
              <p className="mt-1 text-xs text-red-600">Could not find a Zeffy URL in the snippet.</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Copy the embed snippet from your Zeffy campaign dashboard (Share → Embed).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Campaign Image (optional)
            </label>
            <div className="mt-1 space-y-3">
              {isFetchingImage && (
                <p className="text-sm text-gray-500 animate-pulse">Fetching image from Zeffy...</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageUpload}
                className="hidden"
              />
              {formData.image && !isFetchingImage ? (
                <div className="relative inline-block rounded-lg overflow-hidden border border-gray-200 group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={formData.image}
                    alt="Campaign image preview"
                    className="block w-48"
                  />
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="bg-white text-gray-800 text-xs font-medium px-3 py-1.5 rounded-md shadow hover:bg-gray-100 disabled:opacity-50"
                    >
                      {isUploading ? "Uploading…" : "Replace"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, image: null }))}
                      className="bg-white text-red-600 text-xs font-medium px-3 py-1.5 rounded-md shadow hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isUploading ? "Uploading..." : "Upload Image"}
                </button>
              )}
              <p className="text-xs text-gray-500">JPEG, PNG, WebP or GIF — max 5MB</p>
            </div>
          </div>
        </div>
      </div>

      {/* Display Settings */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Display Settings
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="displayOrder"
              className="block text-sm font-medium text-gray-700"
            >
              Display Order
            </label>
            <input
              type="number"
              id="displayOrder"
              name="displayOrder"
              value={formData.displayOrder}
              onChange={handleChange}
              min="0"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-500">
              Lower numbers appear first
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isActive"
              name="isActive"
              checked={formData.isActive}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
            />
            <label
              htmlFor="isActive"
              className="ml-2 block text-sm text-gray-700"
            >
              Active (shown on site)
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPublic"
              name="isPublic"
              checked={formData.isPublic}
              onChange={handleChange}
              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
            />
            <label
              htmlFor="isPublic"
              className="ml-2 block text-sm text-gray-700"
            >
              Public (visible to non-members)
            </label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting
            ? "Saving..."
            : campaignId
            ? "Update Campaign"
            : "Create Campaign"}
        </button>
      </div>
    </form>
  );
}
