import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, and, or, gt, isNull } from "drizzle-orm";
import { format } from "date-fns";

const siteUrl = "https://westervillelions.org";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const publicEvents = await db
    .select({ id: events.id, updatedAt: events.updatedAt })
    .from(events)
    .where(
      and(
        eq(events.isPublic, true),
        or(gt(events.endDate, format(new Date(), "yyyy-MM-dd HH:mm:ss")), isNull(events.endDate), eq(events.isRecurring, true))
      )
    );

  const eventEntries: MetadataRoute.Sitemap = publicEvents.map((e) => ({
    url: `${siteUrl}/events/${e.id}`,
    lastModified: e.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/mission`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/programs`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/events`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/donate`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/join`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/connect`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/meetings`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    ...eventEntries,
  ];
}
