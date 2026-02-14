import CampaignForm from "@/components/admin/campaign-form";
import Link from "next/link";

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/campaigns" className="hover:text-gray-900">
            Campaigns
          </Link>
          <span>/</span>
          <span className="text-gray-900">New Campaign</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Create New Campaign
        </h1>
      </div>

      <CampaignForm />
    </div>
  );
}
