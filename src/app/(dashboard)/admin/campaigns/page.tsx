import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function AdminCampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
  if (!canAccess) redirect("/admin");

  const campaignList = await db
    .select()
    .from(campaigns)
    .orderBy(campaigns.displayOrder, campaigns.createdAt);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
          <p className="mt-2 text-gray-600">
            Manage donation campaigns and fundraising
          </p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          New Campaign
        </Link>
      </div>

      {campaignList.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          <p className="text-lg font-medium">No campaigns found</p>
          <p className="mt-1 text-sm">Create your first campaign to get started</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
          {campaignList.map((campaign) => (
            <div
              key={campaign.id}
              className={`bg-white border-2 rounded-xl overflow-hidden shadow-md transition ${
                campaign.isActive ? "border-lions-gold" : "border-gray-200 opacity-60"
              }`}
            >
              {/* Image — same natural-ratio presentation as the public page */}
              {campaign.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={campaign.image}
                  alt={campaign.title}
                  className="w-full"
                />
              ) : (
                <div className="w-full bg-gray-100 flex items-center justify-center py-10 text-gray-400 text-sm">
                  No image
                </div>
              )}

              <div className="p-4 space-y-3">
                {/* Title */}
                <p className="font-semibold text-gray-900">{campaign.title}</p>

                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      campaign.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {campaign.isActive ? "Active" : "Inactive"}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      campaign.isPublic
                        ? "bg-blue-100 text-blue-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {campaign.isPublic ? "Public" : "Members Only"}
                  </span>
                  <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500">
                    Order #{campaign.displayOrder}
                  </span>
                </div>

                {/* Edit link */}
                <Link
                  href={`/admin/campaigns/${campaign.id}`}
                  className="block w-full text-center rounded-md border border-lions-blue px-3 py-1.5 text-sm font-medium text-lions-blue hover:bg-lions-blue hover:text-white transition"
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Campaigns are displayed in order on the public website. Only <strong>active</strong> campaigns are shown. <strong>Public</strong> campaigns are visible to everyone; <strong>Members Only</strong> campaigns require login.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
