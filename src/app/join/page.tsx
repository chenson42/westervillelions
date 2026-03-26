import { MembershipApplicationForm } from "@/components/membership-application-form";

export const metadata = {
  title: "Join the Westerville Lions Club",
  description: "Apply for membership in the Westerville Lions Club and make a difference in your community.",
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Join", item: "https://westervillelions.org/join" },
  ],
};

export default function JoinPage() {
  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Join the Lions Club</h1>
          <p className="text-xl">Become a member and serve your community</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Why Join the Westerville Lions?</h2>
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="text-center p-4">
                <div className="text-3xl mb-2">🤝</div>
                <h3 className="font-semibold text-gray-900 mb-1">Serve Your Community</h3>
                <p className="text-sm text-gray-600">Make a real difference in Westerville and surrounding areas through hands-on service projects.</p>
              </div>
              <div className="text-center p-4">
                <div className="text-3xl mb-2">🌍</div>
                <h3 className="font-semibold text-gray-900 mb-1">Global Network</h3>
                <p className="text-sm text-gray-600">Join 1.35 million Lions members across 206 countries working toward humanitarian goals.</p>
              </div>
              <div className="text-center p-4">
                <div className="text-3xl mb-2">👥</div>
                <h3 className="font-semibold text-gray-900 mb-1">Build Friendships</h3>
                <p className="text-sm text-gray-600">Connect with civic-minded neighbors who share your commitment to community.</p>
              </div>
            </div>
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
