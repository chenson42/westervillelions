import { readFileSync } from "fs";
import { db } from "../src/lib/db";
import { users, members } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

function parseName(fullName: string): { firstName: string; lastName: string } {
  const name = fullName.replace(/^(Mr\.|Mrs\.|Ms\.?|Dr\.|Miss)\s+/i, "").trim();
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function parseDate(dateStr: string): Date {
  const [month, day, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split("\n").map((l) => l.trimEnd());
  // Line 0: "Table 1,,,,,,,", Line 1: headers
  const headers = lines[1].split(",");
  const rows: Record<string, string>[] = [];
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h.trim()] = (values[idx] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

async function syncRoster(filePath: string) {
  console.log(`📖 Reading roster from: ${filePath}`);
  const content = readFileSync(filePath, "utf-8");
  const rows = parseCSV(content);
  console.log(`📊 Found ${rows.length} members in roster\n`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    const rawName = row["Name"];
    const rawEmail = row["Email"];
    const memberNumber = parseInt(row["Member #"], 10);
    const branch = row["Branch"] || null;
    const phone = row["telephone"] || null;
    const isActive = row["Status"] === "Active Member";
    // membershipStatus mirrors isActive here — this roster has no "prospective"
    // signal, so a not-active row maps to "ended" (matches the migration 0061
    // backfill rule). Keep both columns in sync — see isActiveForStatus() in
    // src/lib/members.ts and docs/work-log/2026-07-26-prospective-members.md.
    const membershipStatus: "active" | "ended" = isActive ? "active" : "ended";
    const joinDate = parseDate(row["Start Date"]);

    if (!rawEmail || !rawName) continue;

    const { firstName, lastName } = parseName(rawName);

    // Handle Robertson shared email
    let email = rawEmail.toLowerCase();
    if (email === "artbethrobertson@gmail.com" && firstName.toLowerCase().includes("beth")) {
      email = "artbethrobertson+beth@gmail.com";
    }

    try {
      // Try to find existing user by email
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUser) {
        // Update user name (strip any prefix that may have been stored)
        await db
          .update(users)
          .set({ name: `${firstName} ${lastName}`, updatedAt: new Date() })
          .where(eq(users.id, existingUser.id));

        // Find and update the linked member record
        const existingMember = await db.query.members.findFirst({
          where: eq(members.userId, existingUser.id),
        });

        if (existingMember) {
          await db
            .update(members)
            .set({
              firstName,
              lastName,
              memberNumber,
              phone,
              branch,
              joinDate,
              isActive,
              membershipStatus,
              updatedAt: new Date(),
            })
            .where(eq(members.id, existingMember.id));
          console.log(`✏️  Updated: ${firstName} ${lastName} (${email})`);
        } else {
          // User exists but no member record — create one
          await db.insert(members).values({
            userId: existingUser.id,
            firstName,
            lastName,
            memberNumber,
            phone,
            branch,
            joinDate,
            isActive,
            membershipStatus,
          });
          console.log(`➕ Created member record for existing user: ${firstName} ${lastName} (${email})`);
        }
        updated++;
      } else {
        // Create new user + member
        const [newUser] = await db
          .insert(users)
          .values({ email, name: `${firstName} ${lastName}`, role: "member" })
          .returning();

        await db.insert(members).values({
          userId: newUser.id,
          firstName,
          lastName,
          memberNumber,
          phone,
          branch,
          joinDate,
          isActive,
          membershipStatus,
        });

        console.log(`✅ Created: ${firstName} ${lastName} (${email})`);
        created++;
      }
    } catch (error) {
      console.error(`❌ Error syncing ${rawName}:`, error);
      errors++;
    }
  }

  console.log(`\n🎉 Sync complete!`);
  console.log(`   ✅ Created: ${created}`);
  console.log(`   ✏️  Updated: ${updated}`);
  if (errors > 0) console.log(`   ❌ Errors:  ${errors}`);
  console.log(`   📊 Total:   ${rows.length}`);
}

const csvPath =
  process.argv[2] ||
  "/Users/cshenso/Downloads/Roster as of 2-3-2026.xlsx - Sheet 1.csv";

syncRoster(csvPath)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
