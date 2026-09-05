import type { Metadata } from "next";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { CampaignCard } from "@/components/campaigns/campaign-card";
import { MemberOnlyCampaigns } from "@/components/campaigns/member-only-campaigns";
import { getRecentGivingStats } from "@/lib/impact-stats-queries";
import { roundDownToThousand, formatImpactAmount } from "@/lib/impact-stats";
import { fiscalYearLabel } from "@/lib/fiscal-year";

export const revalidate = 3600;

// Founding-based lifetime estimate — recent average giving extrapolated back
// to 1928 by CPI (treasurer-approved method, 2026-09-04). Always carries the
// "estimated" qualifier; not derived from a live query.
const LIFETIME_ESTIMATE = "$1 million+";

export const metadata: Metadata = {
  title: "Donate | Support Our Mission",
  description:
    "Support the Westerville Lions Club Foundation — 501(c)(3). Your tax-deductible gift funds youth programs, hunger relief, and community service in Westerville, Ohio.",
  alternates: {
    canonical: "https://westervillelions.org/donate",
  },
  openGraph: {
    title: "Donate | Support Our Mission | Westerville Lions Club",
    description:
      "Support the Westerville Lions Club Foundation — 501(c)(3). Your tax-deductible gift funds youth programs, hunger relief, and community service in Westerville, Ohio.",
    url: "https://westervillelions.org/donate",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Donate", item: "https://westervillelions.org/donate" },
  ],
};

export default async function DonatePage() {
  // Public campaigns only — this keeps the page's own render session-
  // independent so it can be statically served (revalidate=3600). Member-
  // only campaigns are appended client-side by <MemberOnlyCampaigns>
  // for signed-in visitors. See docs/work-log/2026-09-04-site-review-fixes.md,
  // "Batch 2 — static rendering".
  const [activeCampaigns, givingStats] = await Promise.all([
    db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.isActive, true), eq(campaigns.isPublic, true)))
      .orderBy(campaigns.displayOrder),
    getRecentGivingStats(),
  ]);

  const anyCampaignDescriptions = activeCampaigns.some(
    (c) => c.description && c.description.trim().length > 0,
  );

  const twoYearAmount = formatImpactAmount(roundDownToThousand(givingStats.totalCents));
  const [olderFy, newerFy] = givingStats.fiscalYears;
  const grantsCount = givingStats.grantCount;

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
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
          {/* Entity clarity — who actually receives a gift made on this page,
              and the Foundation's tax-exempt status/EIN, up front and before
              any "Donate Now" button (site-review batch 5, 2026-09-04). The
              Club itself is a 501(c)(4) and its own donations are NOT
              deductible — its EIN never appears here. */}
          <div className="mb-8 bg-lions-blue/5 border border-lions-blue/20 rounded-2xl p-6 text-center">
            <p className="text-gray-800">
              Donations made here are received by the{" "}
              <strong>Westerville Lions Club Foundation</strong>, a 501(c)(3) nonprofit — your gift is
              tax-deductible as allowed by law.{" "}
              <span className="whitespace-nowrap font-semibold">EIN 32-0467239</span>.
            </p>
          </div>

          {/* The gold "Donate Now" buttons open a JS-driven Zeffy modal
              (ZeffyEmbed) — dead without JavaScript. This noscript fallback
              points non-JS visitors straight to the mail-a-check option
              further down the page (site-review batch 4, 2026-09-04). */}
          <noscript>
            <div className="mb-8 bg-lions-gold/10 border border-lions-gold/30 rounded-2xl p-6 text-center">
              <p className="text-gray-800">
                Online donation forms require JavaScript to be enabled. You can still give by{" "}
                <a href="#other-ways-to-give" className="text-lions-blue font-semibold hover:underline">
                  mailing a check
                </a>{" "}
                — see the instructions below.
              </p>
            </div>
          </noscript>
          {!anyCampaignDescriptions && activeCampaigns.length > 0 && (
            <p className="text-center text-gray-600 mb-8 max-w-2xl mx-auto">
              Every campaign below supports the Foundation&apos;s community programs — youth
              scholarships, hunger relief, vision care, and local humanitarian projects.
            </p>
          )}
          {activeCampaigns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xl text-gray-600">
                No active campaigns at this time. Please check back soon!
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
              {activeCampaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
          )}

          <MemberOnlyCampaigns />

          <div className="mt-12 bg-lions-blue/5 p-8 rounded-2xl text-center">
            <h2 className="text-2xl font-bold mb-4 text-lions-blue">
              Thank You for Your Support
            </h2>
            <p className="text-lg text-gray-700">
              Your generosity makes a real difference in our community. Every
              donation helps us continue our mission of service.
            </p>
          </div>

          {/* Impact numbers — live two-year total from the ledger, plus a
              constant, footnoted lifetime estimate (site-review batch 5,
              2026-09-04). See src/lib/impact-stats-queries.ts. */}
          <div
            className="mt-12 grid sm:grid-cols-3 gap-6 text-center"
            title={`Fiscal years ${fiscalYearLabel(olderFy)} and ${fiscalYearLabel(newerFy)}`}
          >
            <div>
              <div className="text-3xl sm:text-4xl font-bold text-lions-blue">{twoYearAmount}</div>
              <p className="text-gray-600 mt-1">given in the last two years</p>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold text-lions-blue">{grantsCount}+</div>
              <p className="text-gray-600 mt-1">community grants</p>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-bold text-lions-blue">{LIFETIME_ESTIMATE}*</div>
              <p className="text-gray-600 mt-1">given since our 1928 founding</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 text-center mt-3">
            *Estimate based on recent giving, adjusted for inflation back to our 1928 founding.
          </p>

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

            <div id="other-ways-to-give" className="scroll-mt-24">
              <h2 className="text-2xl font-bold mb-4 text-gray-900">Other Ways to Give</h2>
              <ul className="space-y-3 text-gray-700">
                <li>
                  <strong>Mail a Check:</strong> Payable to &ldquo;Westerville Lions Club Foundation&rdquo;
                  and mailed to:
                  <address className="not-italic mt-1">
                    Westerville Lions Club Foundation
                    <br />
                    PO Box 0597
                    <br />
                    Westerville, OH 43086-0597
                  </address>
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
                <div key={item.label} className="bg-gray-50 p-5 rounded-2xl">
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
