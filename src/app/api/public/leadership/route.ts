import { NextResponse } from "next/server";
import { getBoardMemberships } from "@/lib/board-positions";

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
    // getBoardMemberships() returns [] both when there's no "Board of
    // Directors" group and when the group exists but has zero members —
    // the response shape below is identical ([]) either way, matching the
    // route's pre-refactor behavior byte-for-byte.
    const boardMembers = await getBoardMemberships();

    const shaped = boardMembers.map((m) => ({
      firstName: m.firstName,
      lastName: m.lastName,
      position: m.position,
    }));

    // getBoardMemberships() has no ORDER BY (it's a shared, unordered bulk
    // lookup); sort by lastName first so ties in the position sort below
    // resolve the same way the old query's `orderBy(asc(members.lastName))`
    // + stable JS sort did — response order is unchanged.
    shaped.sort((a, b) => a.lastName.localeCompare(b.lastName));

    // Sort: known positions by rank first, then alphabetically by position name
    const sorted = shaped.sort((a, b) => {
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
