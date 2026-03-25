import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Learn about the Westerville Lions Club — a community service organization serving Westerville, Ohio since 1938 as part of Lions Clubs International.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">About Our Club</h1>
          <p className="text-xl">Serving Westerville since 1938</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Our History</h2>
            <p className="text-lg text-gray-700 mb-4">
              The Westerville Lions Club has been a cornerstone of community service in
              Westerville, Ohio since 1938. For over 85 years, our members have dedicated
              themselves to improving the lives of our neighbors through humanitarian service
              and civic engagement.
            </p>
            <p className="text-lg text-gray-700">
              As part of Lions Clubs International, we are connected to the world's largest
              service club organization, with 1.4 million members in more than 200 countries
              and geographic areas.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Our Meetings</h2>
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-lg text-gray-700 mb-2">
                <strong>When:</strong> 1st and 3rd Wednesday of each month at 6:30 PM
              </p>
              <p className="text-lg text-gray-700 mb-2">
                <strong>Where:</strong> Westerville Community Center
              </p>
              <p className="text-lg text-gray-700">
                All meetings are open to visitors. Come see what we're all about!
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Leadership</h2>
            <p className="text-lg text-gray-700 mb-4">
              Our club is led by dedicated volunteers who guide our service initiatives
              and ensure we meet the needs of our community. Leadership positions rotate
              annually, providing opportunities for all members to contribute their unique
              skills and perspectives.
            </p>
          </section>

          <section>
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Join Us</h2>
            <p className="text-lg text-gray-700 mb-6">
              We're always looking for community-minded individuals who want to make a
              difference. Whether you have a few hours a month or can commit to regular
              service, there's a place for you in the Westerville Lions Club.
            </p>
            <a
              href="/join"
              className="inline-block bg-lions-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Apply for Membership
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
