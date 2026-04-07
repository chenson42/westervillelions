import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import TestimonialForm from "@/components/admin/testimonial-form";
import Link from "next/link";

export default async function EditTestimonialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const testimonial = await db.query.testimonials.findFirst({
    where: eq(testimonials.id, id),
  });

  if (!testimonial) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/testimonials" className="hover:text-gray-900">
            Testimonials
          </Link>
          <span>/</span>
          <span className="text-gray-900">{testimonial.authorName}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Edit Testimonial
        </h1>
      </div>

      <TestimonialForm testimonial={testimonial} />
    </div>
  );
}
