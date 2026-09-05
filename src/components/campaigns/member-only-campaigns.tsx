"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { CampaignCard, type CampaignCardData } from "@/components/campaigns/campaign-card";

/**
 * Appends non-public donation campaigns below the statically-rendered
 * public grid on /donate, for signed-in visitors only. /donate's server
 * render always queries public+active campaigns so the page itself can be
 * cached (revalidate=3600); this widget fetches the members-only campaigns
 * client-side after the session resolves, same flash-of-signed-out pattern
 * as Header. Renders nothing for anonymous visitors or while loading.
 * See docs/work-log/2026-09-04-site-review-fixes.md, "Batch 2 — static
 * rendering".
 */
export function MemberOnlyCampaigns() {
  const { data: session, status } = useSession();
  const [campaigns, setCampaigns] = useState<CampaignCardData[]>([]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/public/campaigns/member-only")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CampaignCardData[]) => {
        if (!cancelled) setCampaigns(data);
      })
      .catch(() => {
        /* silently omit — the public campaigns above still rendered fine */
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (!session?.user || campaigns.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-2xl font-bold mb-6 text-gray-900">Member-Only Campaigns</h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}
