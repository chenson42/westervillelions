"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { HomepageAnnouncement } from "@/lib/db/schema";

type AnnouncementFormData = {
  title: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
};

function toDatetimeLocal(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  // Format as YYYY-MM-DDTHH:MM for datetime-local inputs
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export default function AnnouncementForm({
  announcement,
}: {
  announcement?: HomepageAnnouncement;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<AnnouncementFormData>({
    title: announcement?.title ?? "",
    body: announcement?.body ?? "",
    linkUrl: announcement?.linkUrl ?? "",
    linkLabel: announcement?.linkLabel ?? "",
    isActive: announcement?.isActive ?? true,
    startsAt: toDatetimeLocal(announcement?.startsAt),
    endsAt: toDatetimeLocal(announcement?.endsAt),
    sortOrder: announcement?.sortOrder ?? 0,
  });

  const bodyLength = formData.body.length;
  const BODY_SOFT_LIMIT = 200;

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : type === "number"
          ? parseInt(value, 10) || 0
          : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = announcement
        ? `/api/admin/announcements/${announcement.id}`
        : "/api/admin/announcements";
      const method = announcement ? "PATCH" : "POST";

      const payload = {
        title: formData.title,
        body: formData.body || null,
        linkUrl: formData.linkUrl || null,
        linkLabel: formData.linkLabel || null,
        isActive: formData.isActive,
        startsAt: formData.startsAt ? new Date(formData.startsAt).toISOString() : null,
        endsAt: formData.endsAt ? new Date(formData.endsAt).toISOString() : null,
        sortOrder: formData.sortOrder,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save announcement");
      }

      toast.success(
        announcement
          ? "Announcement updated successfully"
          : "Announcement created successfully"
      );
      router.push("/admin/announcements");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An error occurred"
      );
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Main Content */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Announcement Content
        </h2>
        <div className="mt-6 space-y-6">
          {/* Title */}
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700"
            >
              Title <span className="text-gray-500">(required)</span>
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

          {/* Body */}
          <div>
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="body"
                className="block text-sm font-medium text-gray-700"
              >
                Body <span className="text-gray-500">(optional)</span>
              </label>
              <span
                className={`text-xs tabular-nums ${
                  bodyLength > BODY_SOFT_LIMIT
                    ? "text-amber-600 font-semibold"
                    : "text-gray-400"
                }`}
              >
                {bodyLength} / {BODY_SOFT_LIMIT}
              </span>
            </div>
            <textarea
              id="body"
              name="body"
              rows={4}
              value={formData.body}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            {bodyLength > BODY_SOFT_LIMIT && (
              <p className="mt-1 text-xs text-amber-600">
                Body text over {BODY_SOFT_LIMIT} characters will be truncated
                on the homepage.
              </p>
            )}
          </div>

          {/* Link URL */}
          <div>
            <label
              htmlFor="linkUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Link URL <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="url"
              id="linkUrl"
              name="linkUrl"
              value={formData.linkUrl}
              onChange={handleChange}
              placeholder="https://example.com"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          {/* Link Label */}
          <div>
            <label
              htmlFor="linkLabel"
              className="block text-sm font-medium text-gray-700"
            >
              Link Label <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              id="linkLabel"
              name="linkLabel"
              value={formData.linkLabel}
              onChange={handleChange}
              placeholder="Learn more"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-500">
              Defaults to &ldquo;Learn more&rdquo; if left blank.
            </p>
          </div>
        </div>
      </div>

      {/* Schedule & Settings */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Schedule &amp; Settings
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* Starts At */}
          <div>
            <label
              htmlFor="startsAt"
              className="block text-sm font-medium text-gray-700"
            >
              Starts At <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="datetime-local"
              id="startsAt"
              name="startsAt"
              value={formData.startsAt}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank to show immediately when active.
            </p>
          </div>

          {/* Ends At */}
          <div>
            <label
              htmlFor="endsAt"
              className="block text-sm font-medium text-gray-700"
            >
              Ends At <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="datetime-local"
              id="endsAt"
              name="endsAt"
              value={formData.endsAt}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank to show indefinitely.
            </p>
          </div>

          {/* Sort Order */}
          <div>
            <label
              htmlFor="sortOrder"
              className="block text-sm font-medium text-gray-700"
            >
              Sort Order
            </label>
            <input
              type="number"
              id="sortOrder"
              name="sortOrder"
              value={formData.sortOrder}
              onChange={handleChange}
              min="0"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <p className="mt-1 text-xs text-gray-500">Lower numbers appear first.</p>
          </div>

          {/* Active toggle */}
          <div className="flex items-center pt-6">
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
              Active (shown on homepage)
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
            : announcement
            ? "Update Announcement"
            : "Create Announcement"}
        </button>
      </div>
    </form>
  );
}
