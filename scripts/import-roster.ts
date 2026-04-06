import * as XLSX from "xlsx";
import { db } from "../src/lib/db";
import { users, members } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

interface RosterRow {
  Branch: string | null;
  Last: string;
  Name: string;
  "Member #": number;
  Status: string;
  Email: string;
  telephone: string | null;
  "Start Date": string;
}

function parseName(fullName: string): { firstName: string; lastName: string } {
  // Remove titles
  let name = fullName.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s+/i, "");

  // Split into parts
  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }

  // Last part is last name, everything else is first name
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");

  return { firstName, lastName };
}

function parseDate(dateStr: string): Date {
  // Parse dates like "5/2/2013"
  const [month, day, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}

async function importRoster(filePath: string) {
  console.log(`📖 Reading roster from: ${filePath}`);

  // Read Excel file
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data: RosterRow[] = XLSX.utils.sheet_to_json(worksheet);

  console.log(`📊 Found ${data.length} members in roster`);

  let imported = 0;
  let skipped = 0;

  for (const row of data) {
    try {
      const { firstName, lastName } = parseName(row.Name);
      const joinDate = parseDate(row["Start Date"]);

      // Handle duplicate email for Robertsons
      let email = row.Email.toLowerCase();
      if (email === "artbethrobertson@gmail.com" && row.Last === "Robertson") {
        if (firstName.includes("Beth")) {
          email = "artbethrobertson+beth@gmail.com";
        }
      }

      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      let userId: string;

      if (existingUser) {
        console.log(`⏭️  User already exists: ${email}`);
        userId = existingUser.id;
        skipped++;
      } else {
        // Create user
        const [newUser] = await db
          .insert(users)
          .values({
            email,
            name: `${firstName} ${lastName}`,
            role: "member",
          })
          .returning();

        userId = newUser.id;

        // Create member record
        await db.insert(members).values({
          userId,
          memberNumber: row["Member #"],
          firstName,
          lastName,
          phone: row.telephone || null,
          branch: row.Branch || null,
          joinDate,
          isActive: row.Status === "Active Member",
        });

        console.log(`✅ Imported: ${row.Name} (${email})`);
        imported++;
      }
    } catch (error) {
      console.error(`❌ Error importing ${row.Name}:`, error);
    }
  }

  console.log(`\n🎉 Import complete!`);
  console.log(`   ✅ Imported: ${imported}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   📊 Total: ${data.length}`);
}

// Run import
const rosterPath = process.argv[2] || "/Users/cshenso/Downloads/Roster as of 2-3-2026.xlsx";
importRoster(rosterPath)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
