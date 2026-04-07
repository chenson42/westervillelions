import { MembershipApplicationForm } from "@/components/membership-application-form";
import TestimonialCarousel from "@/components/join/testimonial-carousel";
import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const metadata = {
  title: "Join the Westerville Lions Club",
  description: "Apply for membership in the Westerville Lions Club and make a difference in your community.",
  alternates: {
    canonical: "https://westervillelions.org/join",
  },
  openGraph: {
    title: "Join the Westerville Lions Club",
    description: "Apply for membership in the Westerville Lions Club and make a difference in your community.",
    url: "https://westervillelions.org/join",
    images: [
      {
        url: "https://westervillelions.org/images/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Join", item: "https://westervillelions.org/join" },
  ],
};

export default async function JoinPage() {
  const activeTestimonials = await db
    .select()
    .from(testimonials)
    .where(eq(testimonials.isActive, true))
    .orderBy(asc(testimonials.sortOrder), asc(testimonials.createdAt));

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
            Membership
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Join the Lions Club</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            Become a member and make a real difference — in Westerville and around the world.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Why Join the Westerville Lions?</h2>
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6 text-center">
                <div className="text-4xl mb-3">🤝</div>
                <h3 className="font-semibold text-lions-blue mb-2">Serve Your Community</h3>
                <p className="text-sm text-gray-600">Make a real difference in Westerville and surrounding areas through hands-on service projects.</p>
              </div>
              <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6 text-center">
                <div className="text-4xl mb-3">🌍</div>
                <h3 className="font-semibold text-lions-blue mb-2">Global Network</h3>
                <p className="text-sm text-gray-600">Join 1.35 million Lions members across 206 countries working toward humanitarian goals.</p>
              </div>
              <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6 text-center">
                <div className="text-4xl mb-3">👥</div>
                <h3 className="font-semibold text-lions-blue mb-2">Build Friendships</h3>
                <p className="text-sm text-gray-600">Connect with civic-minded neighbors who share your commitment to community.</p>
              </div>
            </div>
            {activeTestimonials.length > 0 && (
              <TestimonialCarousel testimonials={activeTestimonials} />
            )}

            <p className="text-gray-700">
              We meet twice monthly at The Landings (350 County Line Rd W, Westerville, OH 43082).
              Visitors are always welcome — feel free to attend a meeting before applying.
            </p>
          </div>

          <div className="bg-gray-50 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Membership Application</h2>
            <MembershipApplicationForm />
          </div>
        </div>
      </div>
    </div>
  );
}
