import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Our Mission & Service Areas",
  description:
    "The Westerville Lions Club serves through vision care, hunger relief, youth programs, environmental initiatives, diabetes awareness, and humanitarian aid in Westerville, Ohio.",
  alternates: {
    canonical: "https://westervillelions.org/mission",
  },
};

const causes = [
  {
    icon: "👁️",
    title: "Vision",
    description:
      "Fighting preventable blindness through vision screenings, eyeglass collection and recycling, and connecting those in need with affordable eye care.",
  },
  {
    icon: "🌾",
    title: "Hunger Relief",
    description:
      "Partnering with local food banks and meal programs to ensure no family in Westerville goes without nutritious food.",
  },
  {
    icon: "🌿",
    title: "Environment",
    description:
      "Protecting our community's natural resources through conservation efforts, clean-up events, and environmental education.",
  },
  {
    icon: "🎗️",
    title: "Childhood Cancer",
    description:
      "Supporting children and families facing cancer through fundraising and awareness in partnership with Lions Clubs International Foundation.",
  },
  {
    icon: "💙",
    title: "Diabetes Awareness",
    description:
      "Promoting diabetes prevention, education, and support for those living with the disease in our community.",
  },
  {
    icon: "🎓",
    title: "Youth Programs",
    description:
      "Investing in the next generation through scholarships, educational programs, and youth leadership development opportunities.",
  },
  {
    icon: "🤝",
    title: "Community Service",
    description:
      "From holiday drives to civic events, we roll up our sleeves alongside neighbors to address Westerville's pressing needs.",
  },
  {
    icon: "🌍",
    title: "Humanitarian Aid",
    description:
      "When disaster strikes — locally or globally — we mobilize to provide relief through our network of Lions Clubs International.",
  },
];

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Mission & Service", item: "https://westervillelions.org/mission" },
  ],
};

export default function MissionPage() {
  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      {/* Hero */}
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
            Our Mission
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            We Serve.
          </h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            To create and foster a spirit of understanding among all people for
            humanitarian needs by providing voluntary services through community
            involvement.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-16">

          {/* Core principles */}
          <section>
            <h2 className="text-3xl font-bold mb-8 text-gray-900">
              What We Stand For
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  title: "Understanding",
                  body: "Promoting goodwill and understanding among the peoples of the world.",
                },
                {
                  title: "Good Citizenship",
                  body: "Supporting the principles of good government, civic responsibility, and ethical leadership.",
                },
                {
                  title: "Community Welfare",
                  body: "Taking an active interest in the civic, cultural, social, and moral welfare of our community.",
                },
              ].map((p) => (
                <div
                  key={p.title}
                  className="rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 bg-white overflow-hidden p-6"
                >
                  <h3 className="text-lg font-semibold mb-2 text-lions-blue">
                    {p.title}
                  </h3>
                  <p className="text-gray-700 text-sm leading-relaxed">{p.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Causes grid */}
          <section>
            <h2 className="text-3xl font-bold mb-3 text-gray-900">How We Serve</h2>
            <p className="text-gray-600 mb-8 text-lg">
              Our service spans Lions Clubs International&apos;s eight global causes and
              the day-to-day needs of our own backyard.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {causes.map((cause) => (
                <div
                  key={cause.title}
                  className="rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 bg-white overflow-hidden p-5"
                >
                  <div className="text-3xl mb-3">{cause.icon}</div>
                  <h3 className="font-semibold text-gray-900 mb-2">{cause.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {cause.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="rounded-xl bg-lions-gold/10 border border-lions-gold/30 p-8 flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2 text-gray-900">
                Ready to Make a Difference?
              </h2>
              <p className="text-gray-700">
                Join a club of neighbors committed to hands-on service. Every Lion
                brings unique skills — all are welcome.
              </p>
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <Link
                href="/join"
                className="inline-block bg-lions-blue text-white px-5 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition whitespace-nowrap"
              >
                Join the Club
              </Link>
              <Link
                href="/donate"
                className="inline-block border border-lions-blue text-lions-blue px-5 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition whitespace-nowrap"
              >
                Donate
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
