/**
 * Adds events announced in the September 2026 issue of The Tracks (club
 * newsletter, sent 2026-09-29) that were missing from the events table.
 *
 *   pnpm exec tsx scripts/add-tracks-2026-09-events.ts            # dry run
 *   pnpm exec tsx scripts/add-tracks-2026-09-events.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 * Requires SCRIPT_OPERATOR_EMAIL (the users.email row created_by is set to).
 *
 * Cross-check against production on 2026-09-29: the October 1 General Meeting,
 * October 15 Activities Meeting and September 20 BioBlitz already existed. The
 * October 23 Fourth Friday booth did not, even though the newsletter told members
 * that sign-up to staff it "is available on our website member portal".
 *
 * Time and place follow last year's booth (Fourth Friday 2025-10-24, 6–9pm,
 * Uptown Westerville) — the newsletter gives only the date.
 *
 * TIMES ARE WALL-CLOCK, NOT UTC. `events.start_date` is a naive timestamp that the
 * app reads back as-entered (DECISION-005); converting to UTC here would shift the
 * event by four hours in the UI.
 *
 * IDEMPOTENT: skips any event whose title and start timestamp already exist.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
const CREATOR_EMAIL = process.env.SCRIPT_OPERATOR_EMAIL ?? (() => {
  throw new Error("Set SCRIPT_OPERATOR_EMAIL in your environment (the users.email row created_by is set to).");
})();

type NewEvent = {
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  isPublic: boolean;
  requiresRsvp: boolean;
};

const events: NewEvent[] = [
  {
    title: "Fourth Friday Booth — Uptown Westerville",
    description:
      "The Westerville Lions Club will have a booth at the last Fourth Friday event of the season " +
      "in Uptown Westerville, handing out candy and promoting our club. Sign up here to help staff " +
      "the booth.\n\n" +
      "Please consider bringing a bag of candy to the October 1 or October 15 meeting to help with " +
      "this project.",
    start: "2026-10-23 18:00:00",
    end: "2026-10-23 21:00:00",
    location: "Uptown Westerville — State Street",
    isPublic: false,
    requiresRsvp: true,
  },
];

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`,
  );

  const [creator] = await sql`SELECT id FROM users WHERE email = ${CREATOR_EMAIL}`;
  if (!creator) throw new Error(`No users row for ${CREATOR_EMAIL} — cannot set created_by.`);

  let toCreate = 0;
  for (const e of events) {
    const [existing] = await sql`
      SELECT id FROM events WHERE title = ${e.title} AND start_date = ${e.start}::text::timestamp`;
    const flag = existing ? "SKIP (exists)" : e.isPublic ? "public  " : "internal";
    if (!existing) toCreate++;
    console.log(`  ${flag}  ${e.start} → ${e.end.slice(11)}  ${e.title}  @ ${e.location}  rsvp=${e.requiresRsvp}`);
  }
  console.log(`\n${events.length} in list, ${toCreate} to create.`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to create these.");
    await sql.end();
    return;
  }

  let created = 0;
  await sql.begin(async (tx) => {
    for (const e of events) {
      const [existing] = await tx`
        SELECT id FROM events WHERE title = ${e.title} AND start_date = ${e.start}::text::timestamp`;
      if (existing) continue;
      await tx`
        INSERT INTO events
          (title, description, start_date, end_date, location, is_public, requires_rsvp,
           is_recurring, is_all_day, is_featured, allow_guest_count, created_by)
        VALUES (${e.title}, ${e.description}, ${e.start}::text::timestamp, ${e.end}::text::timestamp,
                ${e.location}, ${e.isPublic}, ${e.requiresRsvp}, false, false, false, false, ${creator.id})`;
      created++;
    }
  });
  console.log(`\nApplied. Created ${created} event(s).`);

  // Read back as TEXT so the driver cannot re-apply a timezone shift on the way out.
  const check = await sql`
    SELECT title, start_date::text AS start_text, end_date::text AS end_text, is_public, requires_rsvp
    FROM events WHERE title = ANY(${events.map((e) => e.title)}) ORDER BY start_date`;
  for (const r of check) {
    console.log(`  ${r.start_text} → ${r.end_text}  ${r.title}  ${r.is_public ? "public" : "internal"}  rsvp=${r.requires_rsvp}`);
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
