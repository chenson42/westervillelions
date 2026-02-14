"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export interface CampaignFormData {
  title: string;
  description?: string | null;
  zeffyLink: string;
  image?: string | null;
  displayOrder: number;
  isActive: boolean;
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
  const [formData, setFormData] = useState<CampaignFormData>(
    campaign || {
      title: "",
      zeffyLink: "",
      displayOrder: 0,
      isActive: true,
    }
  );

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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
            />
          </div>

          <div>
            <label
              htmlFor="zeffyLink"
              className="block text-sm font-medium text-gray-700"
            >
              Zeffy Campaign Link *
            </label>
            <input
              type="url"
              id="zeffyLink"
              name="zeffyLink"
              required
              value={formData.zeffyLink}
              onChange={handleChange}
              placeholder="https://www.zeffy.com/embed/donation-form/..."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
            />
            <p className="mt-1 text-xs text-gray-500">
              Get this link from your Zeffy campaign dashboard
            </p>
          </div>

          <div>
            <label
              htmlFor="image"
              className="block text-sm font-medium text-gray-700"
            >
              Image URL (optional)
            </label>
            <input
              type="url"
              id="image"
              name="image"
              value={formData.image || ""}
              onChange={handleChange}
              placeholder="https://example.com/image.jpg"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
            />
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
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
              className="h-4 w-4 rounded border-gray-300 text-lions-red focus:ring-lions-red"
            />
            <label
              htmlFor="isActive"
              className="ml-2 block text-sm text-gray-700"
            >
              Active (visible on public site)
            </label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-red focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-lions-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-50"
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
