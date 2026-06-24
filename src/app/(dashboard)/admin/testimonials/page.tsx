import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import Link from "next/link";
import DeleteTestimonialButton from "./delete-button";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function AdminTestimonialsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
  if (!canAccess) redirect("/admin");

  const testimonialList = await db
    .select()
    .from(testimonials)
    .orderBy(asc(testimonials.sortOrder), asc(testimonials.createdAt));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Testimonials</h1>
          <p className="mt-2 text-gray-600">
            Manage member quotes shown on the Join page
          </p>
        </div>
        <Link
          href="/admin/testimonials/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          New Testimonial
        </Link>
      </div>

      {testimonialList.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          <p className="text-lg font-medium">No testimonials found</p>
          <p className="mt-1 text-sm">
            Create your first testimonial to get started
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Quote
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell"
                >
                  Author
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {testimonialList.map((testimonial) => (
                <tr key={testimonial.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-900 italic truncate max-w-xs">
                      &ldquo;{testimonial.quote}&rdquo;
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                    <p className="text-sm font-medium text-gray-900">
                      {testimonial.authorName}
                    </p>
                    {testimonial.authorTitle && (
                      <p className="text-xs text-gray-500">{testimonial.authorTitle}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        testimonial.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {testimonial.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/testimonials/${testimonial.id}`}
                        className="inline-block rounded-md border border-lions-blue px-3 py-1.5 text-sm font-medium text-lions-blue hover:bg-lions-blue hover:text-white transition"
                      >
                        Edit
                      </Link>
                      <DeleteTestimonialButton id={testimonial.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Only <strong>active</strong> testimonials are shown on the Join page, ordered by Sort
              Order (lowest first). They rotate automatically in a carousel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
