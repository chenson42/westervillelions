import ExcelJS from "exceljs";
import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

function parseBirthdate(raw: string): string | null {
  if (!raw) return null;
  // Format: M/D/YYYY
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const month = parts[0].padStart(2, "0");
  const day = parts[1].padStart(2, "0");
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

function parseZip(raw: string): string | null {
  if (!raw) return null;
  // Strip +4 extension (e.g. "43081 2562" → "43081")
  return raw.trim().split(" ")[0].split("-")[0];
}

function preferredPhone(mobile: string, home: string): string | null {
  const m = mobile?.trim();
  const h = home?.trim();
  return m || h || null;
}

async function updateMemberDetails(filePath: string) {
  console.log(`📖 Reading from: ${filePath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  // Build header map from first row
  const headerRow = ws.getRow(1);
  const headers: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "");
  });

  const rows: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) record[header] = cell.value != null ? String(cell.value) : "";
    });
    rows.push(record);
  });

  console.log(`📊 Found ${rows.length} rows\n`);

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const row of rows) {
    const memberNumber = parseInt(row["Contact: Member ID"], 10);
    if (!memberNumber) continue;

    const dob = parseBirthdate(row["Contact: Birthdate"]);
    const stateRaw = row["Contact: Mailing State/Province"]?.trim();
    const state = STATE_ABBR[stateRaw] ?? stateRaw ?? null;
    const zip = parseZip(row["Contact: Mailing Zip/Postal Code"]);
    const phone = preferredPhone(row["Contact: Mobile"], row["Contact: Home Phone"]);
    const gender = row["Contact: Gender"]?.trim() || null;
    const spouseName = row["Contact: Spouse Name"]?.trim() || null;
    const address = row["Contact: Mailing Address Line 1"]?.trim() || null;
    const city = row["Contact: Mailing City"]?.trim() || null;

    const firstName = row["Contact: First Name"]?.trim();
    const lastName = row["Contact: Last Name"]?.trim();

    try {
      const existing = await db.query.members.findFirst({
        where: eq(members.memberNumber, memberNumber),
      });

      if (!existing) {
        console.log(`⚠️  Not found: ${firstName} ${lastName} (#${memberNumber})`);
        notFound++;
        continue;
      }

      await db.update(members).set({
        address,
        city,
        state,
        zip,
        phone,
        dateOfBirth: dob,
        gender,
        spouseName: spouseName || null,
        updatedAt: new Date(),
      }).where(eq(members.memberNumber, memberNumber));

      console.log(`✏️  Updated: ${firstName} ${lastName} (#${memberNumber})${dob ? ` — DOB: ${dob}` : ""}`);
      updated++;
    } catch (error) {
      console.error(`❌ Error updating ${firstName} ${lastName}:`, error);
      errors++;
    }
  }

  console.log(`\n🎉 Done!`);
  console.log(`   ✏️  Updated:   ${updated}`);
  console.log(`   ⚠️  Not found: ${notFound}`);
  if (errors > 0) console.log(`   ❌ Errors:    ${errors}`);
}

const filePath =
  process.argv[2] ||
  "/Users/cshenso/Downloads/Member Detail Information-2026-02-05-01-42-11.xlsx";

updateMemberDetails(filePath)
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
