import { ZeffyEmbed } from "@/components/campaigns/zeffy-embed";

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
 *
 * A card shows its stored image only when one is set; there is no fallback
 * picture (docs/work-log/2026-10-12-campaign-cards-no-fallback-image.md).
 * The card stretches to its grid row so every card in a row is the same
 * height, with the button pinned to the bottom.
 */
export function CampaignCard({ campaign }: { campaign: CampaignCardData }) {
  const hasDescription = !!campaign.description && campaign.description.trim().length > 0;
  const membersOnlyBadge = !campaign.isPublic && (
    <span className="text-xs font-semibold bg-lions-blue text-white px-2 py-1 rounded-full shadow whitespace-nowrap">
      Members Only
    </span>
  );

  return (
    <div
      data-testid="campaign-card"
      className="h-full flex flex-col rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 bg-white overflow-hidden"
    >
      {campaign.image && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={campaign.image}
            alt=""
            className="w-full aspect-[16/9] object-cover"
            data-testid="campaign-card-image"
          />
          {membersOnlyBadge && <span className="absolute top-2 left-2">{membersOnlyBadge}</span>}
        </div>
      )}
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-xl font-bold text-gray-900 leading-tight" data-testid="campaign-card-title">
            {campaign.title}
          </h3>
          {!campaign.image && membersOnlyBadge}
        </div>
        {hasDescription && <p className="text-sm text-gray-600 mb-4">{campaign.description}</p>}
        <div className="mt-auto pt-2">
          <ZeffyEmbed
            zeffyLink={campaign.zeffyLink}
            label={campaign.title}
            description={campaign.description}
          />
        </div>
      </div>
    </div>
  );
}
