"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Testimonial } from "@/lib/db/schema";

type TestimonialFormData = {
  quote: string;
  authorName: string;
  authorTitle: string;
  isActive: boolean;
  sortOrder: number;
};

export default function TestimonialForm({
  testimonial,
}: {
  testimonial?: Testimonial;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<TestimonialFormData>({
    quote: testimonial?.quote ?? "",
    authorName: testimonial?.authorName ?? "",
    authorTitle: testimonial?.authorTitle ?? "",
    isActive: testimonial?.isActive ?? true,
    sortOrder: testimonial?.sortOrder ?? 0,
  });

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
      const url = testimonial
        ? `/api/admin/testimonials/${testimonial.id}`
        : "/api/admin/testimonials";
      const method = testimonial ? "PATCH" : "POST";

      const payload = {
        quote: formData.quote,
        authorName: formData.authorName,
        authorTitle: formData.authorTitle || null,
        isActive: formData.isActive,
        sortOrder: formData.sortOrder,
      };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save testimonial");
      }

      toast.success(
        testimonial
          ? "Testimonial updated successfully"
          : "Testimonial created successfully"
      );
      router.push("/admin/testimonials");
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
          Testimonial Content
        </h2>
        <div className="mt-6 space-y-6">
          {/* Quote */}
          <div>
            <label
              htmlFor="quote"
              className="block text-sm font-medium text-gray-700"
            >
              Quote <span className="text-gray-500">(required)</span>
            </label>
            <textarea
              id="quote"
              name="quote"
              required
              rows={5}
              value={formData.quote}
              onChange={handleChange}
              placeholder="Enter the member's testimonial quote..."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          {/* Author Name */}
          <div>
            <label
              htmlFor="authorName"
              className="block text-sm font-medium text-gray-700"
            >
              Author Name <span className="text-gray-500">(required)</span>
            </label>
            <input
              type="text"
              id="authorName"
              name="authorName"
              required
              value={formData.authorName}
              onChange={handleChange}
              placeholder="e.g. Jane Smith"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          {/* Author Title */}
          <div>
            <label
              htmlFor="authorTitle"
              className="block text-sm font-medium text-gray-700"
            >
              Author Title <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="text"
              id="authorTitle"
              name="authorTitle"
              value={formData.authorTitle}
              onChange={handleChange}
              placeholder="e.g. Member since 2015"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
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
              Active (shown on the join page)
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
            : testimonial
            ? "Update Testimonial"
            : "Create Testimonial"}
        </button>
      </div>
    </form>
  );
}
