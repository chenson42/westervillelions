import CampaignForm from "@/components/admin/campaign-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function NewCampaignPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
  if (!canAccess) redirect("/admin");

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
