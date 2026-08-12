import ExcelJS from "exceljs";
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  // Build header map from first row
  const headerRow = worksheet.getRow(1);
  const headers: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "");
  });

  const data: RosterRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const record: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) record[header] = cell.value;
    });
    data.push(record as unknown as RosterRow);
  });

  console.log(`📊 Found ${data.length} members in roster`);

  let imported = 0;
  let skipped = 0;

  for (const row of data) {
    try {
      const { firstName, lastName } = parseName(row.Name);
      const joinDate = parseDate(row["Start Date"]);

      // Handle a shared household email in the roster (two members sharing
      // one email address; the second needs a distinct login so both get
      // separate accounts). Set SHARED_HOUSEHOLD_EMAIL / _ALT /
      // _ALT_FIRST_NAME_MATCH in your environment if your roster has this
      // case — unset, this is a no-op.
      let email = row.Email.toLowerCase();
      const sharedEmail = process.env.SHARED_HOUSEHOLD_EMAIL?.toLowerCase();
      const sharedEmailAlt = process.env.SHARED_HOUSEHOLD_EMAIL_ALT;
      const sharedEmailAltFirstNameMatch = process.env.SHARED_HOUSEHOLD_EMAIL_ALT_FIRST_NAME_MATCH;
      if (sharedEmail && sharedEmailAlt && sharedEmailAltFirstNameMatch && email === sharedEmail && firstName.includes(sharedEmailAltFirstNameMatch)) {
        email = sharedEmailAlt;
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

        // Create member record. membershipStatus mirrors isActive here — this
        // roster has no "prospective" signal, so a not-active row maps to
        // "ended" (matches the migration 0061 backfill rule). Keep both
        // columns in sync per the isActive/membershipStatus invariant in
        // src/lib/members.ts — see docs/work-log/2026-07-26-prospective-members.md.
        const isActive = row.Status === "Active Member";
        await db.insert(members).values({
          userId,
          memberNumber: row["Member #"],
          firstName,
          lastName,
          phone: row.telephone || null,
          branch: row.Branch || null,
          joinDate,
          isActive,
          membershipStatus: isActive ? "active" : "ended",
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
