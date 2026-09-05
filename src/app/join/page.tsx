import Link from "next/link";
import { MembershipApplicationForm } from "@/components/membership-application-form";
import TestimonialCarousel from "@/components/join/testimonial-carousel";
import { db } from "@/lib/db";
import { testimonials, duesSettings } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

export const revalidate = 3600;

export const metadata = {
  // Was "Join the Westerville Lions Club" — the root layout's title template
  // appends " | Westerville Lions Club" to every page title, so that value
  // rendered the club name twice in the tab title.
  title: "Join Us",
  description: "Apply for membership in the Westerville Lions Club and make a difference in your community.",
  alternates: {
    canonical: "https://westervillelions.org/join",
  },
  openGraph: {
    title: "Join the Westerville Lions Club",
    description: "Apply for membership in the Westerville Lions Club and make a difference in your community.",
    url: "https://westervillelions.org/join",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://westervillelions.org/images/og-default.jpg",
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

const AFTER_YOU_APPLY_STEPS = [
  "A club officer reaches out to welcome you and answer any questions you have.",
  "You're invited to visit a meeting or event and meet the members.",
  "The board reviews your application and you're inducted as a new Lion.",
];

export default async function JoinPage() {
  const [activeTestimonials, activeDuesRows] = await Promise.all([
    db
      .select()
      .from(testimonials)
      .where(eq(testimonials.isActive, true))
      .orderBy(asc(testimonials.sortOrder), asc(testimonials.createdAt)),
    db
      .select()
      .from(duesSettings)
      .where(eq(duesSettings.isActive, true))
      .limit(1),
  ]);
  const activeDues = activeDuesRows[0] ?? null;

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
            Membership
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Join the Lions Club</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed mb-8">
            Become a member and make a real difference — in Westerville and around the world.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="#apply"
              className="bg-lions-gold text-lions-blue-dark px-8 py-4 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition shadow-lg transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lions-blue"
            >
              Apply Now
            </a>
            <Link
              href="/meetings"
              className="bg-transparent border-2 border-white text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-white hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-lions-blue"
            >
              Not ready to apply? Join us at a meeting
            </Link>
          </div>
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

          {activeDues && (
            <div className="mb-10 bg-gray-50 rounded-2xl p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">What It Costs</h2>
              <div className="grid sm:grid-cols-2 gap-6 mb-4">
                <div>
                  <div className="text-3xl font-bold text-lions-blue">
                    ${(activeDues.individualAmountCents / 100).toFixed(0)}
                    <span className="text-base font-medium text-gray-600">/year</span>
                  </div>
                  <p className="text-gray-600 text-sm mt-1">Individual annual dues</p>
                </div>
                <div>
                  <div className="text-3xl font-bold text-lions-blue">
                    ${(activeDues.familyAmountCents / 100).toFixed(0)}
                    <span className="text-base font-medium text-gray-600">/year</span>
                  </div>
                  <p className="text-gray-600 text-sm mt-1">Each additional family member</p>
                </div>
              </div>
              <p className="text-gray-700">
                Dues cover the club&apos;s own operating costs — meeting expenses, supplies, and
                administration — so that donations to our causes go straight to the community.
              </p>
            </div>
          )}

          <div className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">What Happens After You Apply?</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {AFTER_YOU_APPLY_STEPS.map((step, i) => (
                <div key={step} className="text-center">
                  <div className="w-10 h-10 rounded-full bg-lions-blue text-white flex items-center justify-center font-bold mx-auto mb-3">
                    {i + 1}
                  </div>
                  <p className="text-gray-700 text-sm">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="apply" className="bg-gray-50 p-8 rounded-lg scroll-mt-24">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Membership Application</h2>
            <MembershipApplicationForm />
          </div>
        </div>
      </div>
    </div>
  );
}
