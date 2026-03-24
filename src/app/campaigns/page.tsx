import { ZeffyEmbed } from "@/components/campaigns/zeffy-embed";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

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

export default async function CampaignsPage() {
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
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Support Our Campaigns</h1>
          <p className="text-xl">Your generosity helps us serve our community</p>
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
                  className="bg-white border-2 border-lions-gold rounded-xl overflow-hidden shadow-md hover:shadow-xl transition"
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
        </div>
      </div>
    </div>
  );
}
