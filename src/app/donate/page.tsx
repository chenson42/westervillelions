import type { Metadata } from "next";
import { ZeffyEmbed } from "@/components/campaigns/zeffy-embed";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Donate | Support Our Mission",
  description: "Donate to the Westerville Lions Club Foundation — a 501(c)(3) charitable organization. Your tax-deductible gift supports youth programs, hunger relief, humanitarian aid, and community service in Westerville, Ohio.",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Donate", item: "https://westervillelions.org/donate" },
  ],
};

/** Fetch og:image and og:description from a Zeffy campaign page. Cached for 1 hour. */
async function fetchZeffyMeta(
  zeffyLink: string
): Promise<{ image: string | null; description: string | null }> {
  try {
    const res = await fetch(zeffyLink, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WestervilleLions/1.0)" },
    });
    if (!res.ok) return { image: null, description: null };
    const html = await res.text();

    const imageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/);

    const descMatch =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/);

    return {
      image: imageMatch?.[1] ?? null,
      description: descMatch?.[1] ?? null,
    };
  } catch {
    return { image: null, description: null };
  }
}

export default async function DonatePage() {
  const session = await auth().catch(() => null);
  const isLoggedIn = !!session?.user;

  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(
      isLoggedIn
        ? eq(campaigns.isActive, true)
        : and(eq(campaigns.isActive, true), eq(campaigns.isPublic, true))
    )
    .orderBy(campaigns.displayOrder);

  const campaignsWithMeta = await Promise.all(
    activeCampaigns.map(async (campaign) => {
      const needsMeta = !campaign.image || !campaign.description;
      const meta = needsMeta ? await fetchZeffyMeta(campaign.zeffyLink) : { image: null, description: null };
      return {
        ...campaign,
        displayImage: campaign.image ?? meta.image,
        displayDescription: campaign.description ?? meta.description,
      };
    })
  );

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-lions-gold font-semibold uppercase tracking-widest text-sm mb-4">
            Give Back
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Support Our Mission</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            Your generosity helps us serve our community — 100% of donations go toward local and humanitarian service.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          {campaignsWithMeta.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600">
                No active campaigns at this time. Please check back soon!
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
              {campaignsWithMeta.map((campaign) => (
                <div
                  key={campaign.id}
                  className="rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 bg-white overflow-hidden"
                >
                  <div className="relative">
                    {campaign.displayImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={campaign.displayImage}
                        alt={campaign.title}
                        className="w-full"
                      />
                    )}
                    {!campaign.isPublic && (
                      <span className="absolute top-2 left-2 text-xs font-semibold bg-lions-blue text-white px-2 py-1 rounded-full shadow">
                        Members Only
                      </span>
                    )}
                  </div>
                  <div className="p-6">
                    <ZeffyEmbed
                      key={campaign.id}
                      zeffyLink={campaign.zeffyLink}
                      label={campaign.title}
                      description={campaign.displayDescription}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-12 bg-blue-50 p-8 rounded-xl text-center">
            <h2 className="text-2xl font-bold mb-4 text-lions-blue">
              Thank You for Your Support
            </h2>
            <p className="text-lg text-gray-700">
              Your generosity makes a real difference in our community. Every
              donation helps us continue our mission of service.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-bold mb-4 text-gray-900">Tax-Deductible Giving</h2>
              <p className="text-gray-700 mb-3">
                Charitable donations are made to the <strong>Westerville Lions Club Foundation</strong>,
                our 501(c)(3) nonprofit organization. Gifts to the Foundation are tax-deductible and
                go directly to our community service programs.
              </p>
              <p className="text-gray-700">
                Every dollar stays in our community or supports Lions Clubs International&apos;s
                global humanitarian efforts.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4 text-gray-900">Other Ways to Give</h2>
              <ul className="space-y-3 text-gray-700">
                <li>
                  <strong>Mail a Check:</strong> Payable to &ldquo;Westerville Lions Club Foundation&rdquo; —{" "}
                  <a href="/contact" className="text-lions-blue hover:underline">contact us</a> for the mailing address.
                </li>
                <li>
                  <strong>Donate Items:</strong> We accept eyeglass donations and other items for our service programs.
                </li>
                <li>
                  <strong>Volunteer:</strong> Your time is just as valuable —{" "}
                  <a href="/join" className="text-lions-blue hover:underline">become a member</a> or attend an event.
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Where Your Donation Goes</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Youth Programs", body: "Scholarships, educational programs, and youth leadership development" },
                { label: "Community Projects", body: "Local service initiatives, food drives, and community support programs" },
                { label: "Humanitarian Aid", body: "Disaster relief and support for those in need locally and globally" },
                { label: "Hunger Relief", body: "Partnerships with food banks and meal programs for families in need" },
              ].map((item) => (
                <div key={item.label} className="bg-gray-50 p-5 rounded-lg">
                  <h3 className="font-semibold text-lions-blue mb-2">{item.label}</h3>
                  <p className="text-sm text-gray-700">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
