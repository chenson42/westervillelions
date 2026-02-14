import { ZeffyButton } from "@/components/campaigns/zeffy-button";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Image from "next/image";

/**
 * Campaigns Page (Public)
 *
 * Displays active donation campaigns loaded dynamically from the database.
 */
export default async function CampaignsPage() {
  // Load active campaigns from database, ordered by display_order
  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.isActive, true))
    .orderBy(campaigns.displayOrder);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero section */}
      <div className="bg-lions-red text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Support Our Campaigns</h1>
          <p className="text-xl">Your generosity helps us serve our community</p>
        </div>
      </div>

      {/* Campaigns grid */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          {activeCampaigns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600">
                No active campaigns at this time. Please check back soon!
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {activeCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="bg-white border-2 border-lions-gold rounded-xl p-6 shadow-md hover:shadow-xl transition"
                >
                  {campaign.image && (
                    <div className="mb-4 -mx-6 -mt-6">
                      <Image
                        src={campaign.image}
                        alt={campaign.title}
                        width={400}
                        height={200}
                        className="w-full h-48 object-cover rounded-t-xl"
                      />
                    </div>
                  )}
                  <h3 className="text-2xl font-bold mb-4 text-lions-red">
                    {campaign.title}
                  </h3>
                  {campaign.description && (
                    <p className="text-gray-700 mb-6 leading-relaxed">
                      {campaign.description}
                    </p>
                  )}
                  <ZeffyButton
                    zeffyLink={campaign.zeffyLink}
                    className="w-full bg-lions-gold text-gray-900 px-6 py-3 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition shadow-lg"
                  >
                    Donate Now
                  </ZeffyButton>
                </div>
              ))}
            </div>
          )}

          {/* Thank you message */}
          <div className="mt-12 bg-red-50 p-8 rounded-xl text-center">
            <h2 className="text-2xl font-bold mb-4 text-lions-red">
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
