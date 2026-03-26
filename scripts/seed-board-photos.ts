/**
 * Seed profile pictures for Board of Directors members using famous-person photos.
 * Only updates members who don't already have a profile picture.
 * Run with: npx tsx scripts/seed-board-photos.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/lib/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

// Famous people mapped to board members by full name (gender-matched)
const FAMOUS_PEOPLE: Record<string, string> = {
  "James Shively":    "Abraham_Lincoln",
  "Debbie Bennati":   "Marie_Curie",
  "Arthur Robertson": "Theodore_Roosevelt",
  "Beth Robertson":   "Amelia_Earhart",
  "Lori Lampel":      "Eleanor_Roosevelt",
  "Alex Levasseur":   "Albert_Einstein",
  "Miriam Reinhoudt": "Rosa_Parks",
  "William Phythyon": "Benjamin_Franklin",
  "Kris Thompson":    "George_Washington",
  "Chris Henson":     "Mark_Twain",
  "Howard Baum":      "Winston_Churchill",
  "Jane Enneking":    "Harriet_Tubman",
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikipediaThumb(wikiTitle: string): Promise<string> {
  // Use Wikipedia REST API summary endpoint — returns thumbnail URL, no rate-limit issues
  const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
  const summaryRes = await fetch(apiUrl, {
    headers: { "User-Agent": "WestervilleLions/1.0 (seed script; github.com/Nonprofits-of-Westerville)" },
  });
  if (!summaryRes.ok) throw new Error(`Wikipedia API ${summaryRes.status} for ${wikiTitle}`);
  const summary = await summaryRes.json() as { thumbnail?: { source: string } };
  const thumbUrl = summary.thumbnail?.source;
  if (!thumbUrl) throw new Error(`No thumbnail found for ${wikiTitle}`);

  await delay(2000); // be polite to Wikipedia

  const imgRes = await fetch(thumbUrl, {
    headers: { "User-Agent": "WestervilleLions/1.0 (seed script)" },
  });
  if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} fetching thumbnail`);
  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  const buffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

async function main() {
  console.log("🦁 Seeding board member profile photos...\n");

  // Find the Board of Directors group
  const boardGroup = await db.query.groups.findFirst({
    where: (g, { sql }) => sql`lower(${g.name}) = 'board of directors'`,
  });

  if (!boardGroup) {
    console.error("❌ Could not find 'Board of Directors' group");
    process.exit(1);
  }

  // Get board members without a photo
  const memberships = await db
    .select({
      id: schema.members.id,
      firstName: schema.members.firstName,
      lastName: schema.members.lastName,
      profilePicture: schema.members.profilePicture,
    })
    .from(schema.groupMemberships)
    .innerJoin(schema.members, eq(schema.groupMemberships.memberId, schema.members.id))
    .where(eq(schema.groupMemberships.groupId, boardGroup.id));

  console.log(`Found ${memberships.length} board members\n`);

  for (const member of memberships) {
    const fullName = `${member.firstName} ${member.lastName}`;
    const wikiTitle = FAMOUS_PEOPLE[fullName];

    if (!wikiTitle) {
      console.log(`⏭️  ${fullName} — no famous person mapping, skipping`);
      continue;
    }

    if (member.profilePicture) {
      console.log(`⏭️  ${fullName} — already has a photo, skipping`);
      continue;
    }

    try {
      console.log(`📥 ${fullName} → ${wikiTitle.replace(/_/g, " ")} (fetching...)`);
      const dataUri = await fetchWikipediaThumb(wikiTitle);
      const kb = Math.round((dataUri.length * 3) / 4 / 1024);
      await db
        .update(schema.members)
        .set({ profilePicture: dataUri, updatedAt: new Date() })
        .where(eq(schema.members.id, member.id));
      console.log(`   ✅ Saved (~${kb} KB)`);
    } catch (err) {
      console.error(`   ❌ Failed: ${err}`);
    }
  }

  console.log("\n✅ Done!");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
