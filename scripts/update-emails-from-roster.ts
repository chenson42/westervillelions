import * as XLSX from "xlsx";
import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface RosterRow {
  Branch: string | null;
  Last: string;
  Name: string;
  "Member #": number;
  "Date Joined": string;
  Email: string;
  Address1: string;
  City: string;
  State: string;
  Zip: number;
  Phone: string;
}

async function updateEmailsFromRoster() {
  const workbook = XLSX.readFile("/Users/cshenso/Downloads/Roster as of 2-3-2026.xlsx");
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<RosterRow>(worksheet);

  console.log(`Found ${data.length} members in roster\n`);

  let updated = 0;
  let notFound = 0;

  for (const row of data) {
    const lastName = row.Last.trim();
    const fullName = row.Name.trim();

    // Extract first name from full name, removing titles
    const nameParts = fullName.split(" ");
    // Remove common titles
    const titles = ["Mr.", "Mrs.", "Ms", "Ms.", "Dr.", "Miss"];
    let firstName = nameParts[0];
    if (titles.includes(nameParts[0])) {
      firstName = nameParts[1] || nameParts[0];
    }

    const email = row.Email?.trim();

    if (email) {
      // Try to find member by first and last name
      const member = await db.query.members.findFirst({
        where: and(
          eq(members.firstName, firstName),
          eq(members.lastName, lastName)
        ),
      });

      if (member) {
        await db
          .update(members)
          .set({ email })
          .where(eq(members.id, member.id));

        console.log(`✓ ${firstName} ${lastName} → ${email}`);
        updated++;
      } else {
        console.log(`✗ ${firstName} ${lastName} - not found in database`);
        notFound++;
      }
    }
  }

  console.log(`\n✅ Updated ${updated} emails`);
  console.log(`⚠️  ${notFound} members not found in database`);
  process.exit(0);
}

updateEmailsFromRoster().catch((error) => {
  console.error("Error updating emails:", error);
  process.exit(1);
});
