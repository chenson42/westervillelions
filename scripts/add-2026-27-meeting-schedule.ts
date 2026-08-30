/**
 * Adds the club's 2026-27 meeting schedule as events (treasurer request,
 * 2026-08-08, transcribed from the printed "MEETING SCHEDULE AND BOARD SCHEDULE
 * 2026-27" sheet).
 *
 *   pnpm exec tsx scripts/add-2026-27-meeting-schedule.ts            # dry run
 *   pnpm exec tsx scripts/add-2026-27-meeting-schedule.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 *
 * ALL meetings are at The Landings of Westerville.
 *
 *   General meetings    1st Thursday, 7:00–8:00pm, Training Room, PUBLIC
 *   Activities meetings 3rd Thursday, 7:00–8:00pm, Training Room, PUBLIC
 *   Board meetings      4th Thursday, 7:00–8:30pm, 2nd-floor Private Dining Room,
 *                       INTERNAL (members only) — the sheet notes they are open to
 *                       all active members, but they stay off the public calendar.
 *                       No board meeting in December.
 *   Board retreat       Aug 7 2026, 8:45am–1:30pm, 2nd-floor Private Dining Room, INTERNAL
 *
 * All allow RSVP (`requires_rsvp = true`).
 *
 * TIMES ARE WALL-CLOCK, NOT UTC. `events.start_date` is a naive timestamp that this
 * app reads back as-entered — the existing "Lions Club Meeting" row stores 19:00:00
 * for a 7pm meeting. Converting to UTC here would shift every meeting by four hours
 * in the UI. This is the same naive-timestamp trap this project has hit before.
 *
 * BOARD MOVED FROM THE 4th TUESDAY TO THE 4th THURSDAY, 2026-08-23. The board's
 * original meeting night was the 4th Tuesday (see the superseded historical note
 * below); it has since switched to the 4th Thursday, and December's board meeting
 * was dropped entirely rather than moved. The nine 2026-09 through 2027-06 board
 * rows (and the now-cancelled 2026-12 row) were already corrected directly against
 * both the dev and production databases the day of the change — this file's
 * BOARD_DATES below was updated to match so a future re-run of this idempotent
 * script (by title + start timestamp) recreates the *current* schedule rather than
 * reintroducing the old Tuesday dates.
 *
 * SUPERSEDED — kept for history only, no longer reflects live data:
 *   TWO BOARD DATES WERE QUERIED WITH THE SECRETARY (Miriam Reinhoudt) and RESOLVED
 *   2026-08-08:
 *     2026-10-20 — CORRECT as printed. The club counts weeks from the 1st of the month,
 *                  and October 1 2026 is a Thursday, so the 20th falls in the 4th week by
 *                  that counting even though it is the 3rd Tuesday of the month.
 *     2026-11-26 — TYPO. Corrected to 2026-11-24 (a Tuesday). The printed date was a
 *                  Thursday, and Thanksgiving Day.
 *
 * NOVEMBER BOARD MEETING MOVED OFF THANKSGIVING, 2026-08-30. The 4th-Thursday-move
 * (above) put the board meeting back on 2026-11-26, which is Thanksgiving Day — the
 * club does not meet that day. November's board meeting is a one-off exception:
 * Thursday, 2026-11-12, instead of the 4th Thursday. No other month is affected.
 *
 * IDEMPOTENT: skips any event whose title and start timestamp already exist. Note
 * that this only ever ADDS missing rows — it does not update or delete an existing
 * one, so the already-created 2026-11-26 Board Meeting event needed a manual fix
 * alongside this file's date change.
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

const LOCATION_TRAINING = "The Landings of Westerville — 1st Floor Training Room";
const LOCATION_DINING = "The Landings of Westerville — 2nd Floor Private Dining Room";

const GENERAL_DATES = [
  "2026-09-03", "2026-10-01", "2026-11-05", "2026-12-03",
  "2027-01-07", "2027-02-04", "2027-03-04", "2027-04-01", "2027-05-06",
];
const ACTIVITIES_DATES = [
  "2026-09-17", "2026-10-15", "2026-11-19", "2026-12-17",
  "2027-01-21", "2027-02-18", "2027-03-18", "2027-04-15", "2027-05-20",
];
// Board moved to the 4th Thursday 2026-08-23; no board meeting in December.
// November is 2026-11-12, not the 4th Thursday (2026-11-26 is Thanksgiving). See header.
const BOARD_DATES = [
  "2026-09-24", "2026-10-22", "2026-11-12",
  "2027-01-28", "2027-02-25", "2027-03-25", "2027-04-22", "2027-05-27", "2027-06-24",
];

type NewEvent = {
  title: string;
  description: string;
  start: string;
  end: string;
  location: string;
  isPublic: boolean;
};

const events: NewEvent[] = [];

for (const d of GENERAL_DATES) {
  events.push({
    title: "General Meeting",
    description:
      "Monthly general membership meeting. Registration opens at 6:45pm; the meeting begins at 7:00pm.",
    start: `${d} 19:00:00`,
    end: `${d} 20:00:00`,
    location: LOCATION_TRAINING,
    isPublic: true,
  });
}

for (const d of ACTIVITIES_DATES) {
  const isChristmas = d === "2026-12-17";
  events.push({
    title: isChristmas ? "Activities Meeting — Christmas Party" : "Activities Meeting",
    description: isChristmas
      ? "Activities meeting and the club Christmas Party. Registration opens at 6:45pm; the meeting begins at 7:00pm."
      : "Monthly activities meeting. Registration opens at 6:45pm; the meeting begins at 7:00pm.",
    start: `${d} 19:00:00`,
    end: `${d} 20:00:00`,
    location: LOCATION_TRAINING,
    isPublic: true,
  });
}

for (const d of BOARD_DATES) {
  events.push({
    title: "Board Meeting",
    description: "Monthly board meeting. Open to all active members.",
    start: `${d} 19:00:00`,
    end: `${d} 20:30:00`,
    location: LOCATION_DINING,
    isPublic: false,
  });
}

events.push({
  title: "Board Retreat",
  description: "Annual board retreat. Open to all active members.",
  start: "2026-08-07 08:45:00",
  end: "2026-08-07 13:30:00",
  location: LOCATION_DINING,
  isPublic: false,
});

events.sort((a, b) => a.start.localeCompare(b.start));

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
    console.log(
      `  ${flag}  ${e.start}  ${e.end.slice(11)}  ${e.title.padEnd(38)}  ${e.location.includes("Dining") ? "Dining Rm" : "Training Rm"}`,
    );
  }
  console.log(`\n${events.length} in schedule, ${toCreate} to create.`);
  console.log(
    "\nNotes:\n" +
      "  2026-10-20  4th Thursday, correct (club counts weeks from the 1st; Oct 1 is a Thursday)\n" +
      "  2026-11-12  November Board Meeting exception — 2026-11-26 (the 4th Thursday) is Thanksgiving",
  );

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
                ${e.location}, ${e.isPublic}, true, false, false, false, false, ${creator.id})`;
      created++;
    }
  });

  console.log(`\nApplied. Created ${created} event(s).`);

  // Read the column back as TEXT. Letting the driver marshal a naive `timestamp`
  // into a JS Date and calling toISOString() re-applies a timezone shift on the way
  // out, which makes a correct row look wrong (and a wrong row look right).
  const check = await sql`
    SELECT title, start_date::text AS start_text, end_date::text AS end_text,
           is_public, requires_rsvp
    FROM events WHERE start_date >= '2026-08-01' ORDER BY start_date LIMIT 5`;
  console.log("\nFirst few, as stored (must read as wall-clock, e.g. 19:00 for a 7pm meeting):");
  for (const r of check) {
    console.log(
      `  ${r.start_text}  ${r.title}  ${r.is_public ? "public" : "internal"}  rsvp=${r.requires_rsvp}`,
    );
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
