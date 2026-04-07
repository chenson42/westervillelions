import TestimonialForm from "@/components/admin/testimonial-form";
import Link from "next/link";

export default function NewTestimonialPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/testimonials" className="hover:text-gray-900">
            Testimonials
          </Link>
          <span>/</span>
          <span className="text-gray-900">New Testimonial</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Create New Testimonial
        </h1>
      </div>

      <TestimonialForm />
    </div>
  );
}
