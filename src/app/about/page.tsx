import type { Metadata } from "next";
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { LeadershipAvatar } from "@/components/members/leadership-avatar";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Learn about the Westerville Lions Club — a community service organization serving Westerville, Ohio since 1928 as part of Lions Clubs International.",
  alternates: {
    canonical: "https://westervillelions.org/about",
  },
  openGraph: {
    title: "About Us | Westerville Lions Club",
    description:
      "Learn about the Westerville Lions Club — a community service organization serving Westerville, Ohio since 1928 as part of Lions Clubs International.",
    url: "https://westervillelions.org/about",
    images: [
      {
        url: "https://westervillelions.org/images/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
};

const POSITION_ORDER: Record<string, number> = {
  president: 0,
  "1st vice president": 1,
  "first vice president": 1,
  "2nd vice president": 2,
  "second vice president": 2,
  "vice president": 3,
  secretary: 4,
  treasurer: 5,
  "lion tamer": 6,
  "tail twister": 7,
};

function positionSortKey(position: string | null): [number, string] {
  const normalized = (position ?? "").toLowerCase().trim();
  const rank = POSITION_ORDER[normalized] ?? 99;
  return [rank, normalized];
}

async function getLeadership(): Promise<{ memberId: string; firstName: string; lastName: string; position: string | null; joinDate: Date | null }[]> {
  try {
    const boardGroup = await db.query.groups.findFirst({
      where: sql`lower(${groups.name}) = 'board of directors'`,
    });

    if (!boardGroup) return [];

    const boardMembers = await db
      .select({
        memberId: members.id,
        firstName: members.firstName,
        lastName: members.lastName,
        position: groupMemberships.position,
        joinDate: members.joinDate,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .where(eq(groupMemberships.groupId, boardGroup.id))
      .orderBy(asc(members.lastName));

    return boardMembers.sort((a, b) => {
      const [rankA, nameA] = positionSortKey(a.position);
      const [rankB, nameB] = positionSortKey(b.position);
      if (rankA !== rankB) return rankA - rankB;
      return nameA.localeCompare(nameB);
    });
  } catch {
    return [];
  }
}

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "About", item: "https://westervillelions.org/about" },
  ],
};

export default async function AboutPage() {
  const leadership = await getLeadership();

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-white/80 font-semibold uppercase tracking-widest text-sm mb-4">
            Westerville, Ohio
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">About Our Club</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            Serving our community with pride since 1928 — a proud chapter of Lions Clubs International.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Our History</h2>
            <p className="text-lg text-gray-700 mb-4">
              The Westerville Lions Club has been a cornerstone of community service in
              Westerville, Ohio since 1928. For {new Date().getFullYear() - 1928 - 1}+ years, our members have dedicated
              themselves to improving the lives of our neighbors through humanitarian service
              and civic engagement.
            </p>
            <p className="text-lg text-gray-700">
              As part of Lions Clubs International, we are connected to the world's largest
              service club organization, with 1.4 million members in more than 200 countries
              and geographic areas.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Our Meetings</h2>
            <div className="bg-gray-50 p-6 rounded-lg">
              <p className="text-lg text-gray-700 mb-2">
                <strong>When:</strong> 1st and 3rd Thursday of each month at 6:30 PM (September–May)
              </p>
              <p className="text-lg text-gray-700 mb-2">
                <strong>Where:</strong> The Landings, 350 County Line Rd W, Westerville, OH 43082
              </p>
              <p className="text-lg text-gray-700">
                All meetings are open to visitors. Come see what we're all about!
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Leadership</h2>
            <p className="text-lg text-gray-700 mb-6">
              Our club is led by dedicated volunteers who guide our service initiatives
              and ensure we meet the needs of our community. Leadership positions rotate
              annually, providing opportunities for all members to contribute their unique
              skills and perspectives.
            </p>
            {leadership.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {leadership.map((member, index) => (
                  <div key={index} className="bg-gray-50 p-6 rounded-lg text-center">
                    <LeadershipAvatar
                      src={`/api/public/members/${member.memberId}/photo`}
                      alt={`${member.firstName} ${member.lastName}`}
                    />
                    <p className="font-semibold text-gray-900">
                      {member.firstName} {member.lastName}
                    </p>
                    {member.position && (
                      <p className="text-lions-blue text-sm mt-1">{member.position}</p>
                    )}
                    {member.joinDate && (() => {
                      const years = new Date().getFullYear() - new Date(member.joinDate).getFullYear();
                      return years > 0 ? (
                        <p className="text-gray-500 text-xs mt-1">
                          Member for {years} year{years !== 1 ? "s" : ""}
                        </p>
                      ) : null;
                    })()}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Join Us</h2>
            <p className="text-lg text-gray-700 mb-6">
              We're always looking for community-minded individuals who want to make a
              difference. Whether you have a few hours a month or can commit to regular
              service, there's a place for you in the Westerville Lions Club.
            </p>
            <a
              href="/join"
              className="inline-block bg-lions-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Apply for Membership
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
