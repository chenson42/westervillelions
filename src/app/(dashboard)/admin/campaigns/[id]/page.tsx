import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import CampaignForm from "@/components/admin/campaign-form";
import Link from "next/link";
import type { CampaignFormData } from "@/components/admin/campaign-form";

export default async function EditCampaignPage({
  params,
}: {
  params: { id: string };
}) {
  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, params.id),
  });

  if (!campaign) {
    notFound();
  }

  const formData: CampaignFormData = {
    title: campaign.title,
    description: campaign.description,
    zeffyLink: campaign.zeffyLink,
    image: campaign.image,
    displayOrder: campaign.displayOrder,
    isActive: campaign.isActive,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/campaigns" className="hover:text-gray-900">
            Campaigns
          </Link>
          <span>/</span>
          <span className="text-gray-900">{campaign.title}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Edit Campaign</h1>
      </div>

      <CampaignForm campaign={formData} campaignId={params.id} />
    </div>
  );
}
