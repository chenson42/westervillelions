import { ZeffyEmbed } from "@/components/campaigns/zeffy-embed";

/** Shown on a campaign card when no image is stored on the campaign. */
export const CAMPAIGN_CARD_FALLBACK_IMAGE = "/images/service-community.jpg";

export interface CampaignCardData {
  id: string;
  title: string;
  description: string | null;
  zeffyLink: string;
  image: string | null;
  isPublic: boolean;
}

/**
 * A single donation campaign card — extracted from /donate so it can be
 * reused by MemberOnlyCampaigns, which appends non-public campaigns for
 * signed-in members without forcing the whole /donate page dynamic. See
 * docs/work-log/2026-09-04-site-review-fixes.md, "Batch 2 — static
 * rendering".
 */
export function CampaignCard({ campaign }: { campaign: CampaignCardData }) {
  const displayImage = campaign.image ?? CAMPAIGN_CARD_FALLBACK_IMAGE;

  return (
    <div
      data-testid="campaign-card"
      className="rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 bg-white overflow-hidden"
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayImage}
          alt={campaign.title}
          className="w-full"
          data-testid="campaign-card-image"
        />
        {!campaign.isPublic && (
          <span className="absolute top-2 left-2 text-xs font-semibold bg-lions-blue text-white px-2 py-1 rounded-full shadow">
            Members Only
          </span>
        )}
      </div>
      <div className="p-6">
        {campaign.description && campaign.description.trim().length > 0 && (
          <p className="text-sm text-gray-600 mb-4">{campaign.description}</p>
        )}
        <ZeffyEmbed
          zeffyLink={campaign.zeffyLink}
          label={campaign.title}
          description={campaign.description}
        />
      </div>
    </div>
  );
}
