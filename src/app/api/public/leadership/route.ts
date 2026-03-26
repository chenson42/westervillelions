import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";

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

export async function GET() {
  try {
    // Find the Board group (case-insensitive)
    const boardGroup = await db.query.groups.findFirst({
      where: sql`lower(${groups.name}) = 'board of directors'`,
    });

    if (!boardGroup) {
      return NextResponse.json([]);
    }

    const boardMembers = await db
      .select({
        firstName: members.firstName,
        lastName: members.lastName,
        position: groupMemberships.position,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .where(eq(groupMemberships.groupId, boardGroup.id))
      .orderBy(asc(members.lastName));

    // Sort: known positions by rank first, then alphabetically by position name
    const sorted = boardMembers.sort((a, b) => {
      const [rankA, nameA] = positionSortKey(a.position);
      const [rankB, nameB] = positionSortKey(b.position);
      if (rankA !== rankB) return rankA - rankB;
      return nameA.localeCompare(nameB);
    });

    return NextResponse.json(sorted);
  } catch (error) {
    console.error("Error fetching leadership:", error);
    return NextResponse.json({ error: "Failed to fetch leadership" }, { status: 500 });
  }
}
