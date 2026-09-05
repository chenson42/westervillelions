import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Meetings",
  description:
    "The Westerville Lions Club meets the 1st and 3rd Thursday of each month (September–May) at The Landings in Westerville, Ohio. Guests are always welcome.",
  alternates: {
    canonical: "https://westervillelions.org/meetings",
  },
};

export default function MeetingsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Meetings</h1>
          <p className="text-xl">Join us for our regular club meetings</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-md mb-8">
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Regular Meetings</h2>
            <div className="space-y-4 text-lg text-gray-700">
              <div className="flex gap-3">
                <span className="font-semibold text-gray-900 w-24 shrink-0">When:</span>
                <span>1st and 3rd Thursday of each month (September–May) — social hour at 6:30 PM, meeting begins at 7:00 PM</span>
              </div>
              <div className="flex gap-3">
                <span className="font-semibold text-gray-900 w-24 shrink-0">Where:</span>
                <div>
                  <p>The Landings</p>
                  <p>350 County Line Rd W</p>
                  <p>Westerville, OH 43082</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="font-semibold text-gray-900 w-24 shrink-0">Format:</span>
                <span>Business meetings with fellowship and service planning</span>
              </div>
            </div>

            <div className="mt-6">
              <a
                href="https://maps.google.com/?q=350+County+Line+Rd+W,+Westerville,+OH+43082"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-lions-blue hover:text-lions-blue-dark font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Get Directions
              </a>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-md mb-8">
            <h2 className="text-3xl font-bold mb-4 text-lions-blue">What to Expect</h2>
            <ul className="space-y-3 text-lg text-gray-700">
              <li className="flex gap-3">
                <span className="text-lions-gold font-bold">·</span>
                <span>Fellowship and dinner before the meeting</span>
              </li>
              <li className="flex gap-3">
                <span className="text-lions-gold font-bold">·</span>
                <span>Updates on current service projects and community initiatives</span>
              </li>
              <li className="flex gap-3">
                <span className="text-lions-gold font-bold">·</span>
                <span>Planning for upcoming events and fundraisers</span>
              </li>
              <li className="flex gap-3">
                <span className="text-lions-gold font-bold">·</span>
                <span>Guest speakers on topics relevant to our community</span>
              </li>
            </ul>
          </div>

          <div className="bg-blue-50 rounded-xl p-8">
            <h3 className="text-2xl font-bold mb-4 text-lions-blue">Interested in Attending?</h3>
            <p className="text-lg text-gray-700 mb-6">
              Guests are always welcome at our meetings. No appointment needed — just show up and
              introduce yourself! It&apos;s a great way to learn about our club and meet our members.
            </p>
            <a
              href="/connect"
              className="inline-block bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Contact Us
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
