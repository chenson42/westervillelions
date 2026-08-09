/**
 * One-off: creates the Westerville BMX volunteer slots as club-private,
 * RSVP-able recurring events, from the club's printed "BMX Season Schedule
 * Volunteers — Westerville Lions Club" sheet (photographed 2026-08-09).
 *
 * SOURCE SHEET — what it lists, and what this script does with each item:
 *   Opening Day .............. Sun Apr 26, noon ............ SKIPPED (past)
 *   BMX League Open House .... Mon Apr 27, 5:30–7:30pm ..... SKIPPED (past)
 *   Bike Safety Rodeo ........ Sat May 9, 10am–12pm ........ SKIPPED (past)
 *   State Race Qualifier ..... Sun Aug 2, all day .......... SKIPPED (past)
 *   Weekly schedule .......... Aug 26 – Oct 25 ............. CREATED (below)
 *
 * The four skipped items had already happened when this was written
 * (2026-08-09) — the State Race Qualifier by one week. They are deliberately
 * NOT created: an event nobody can still volunteer for is noise in the
 * members' calendar. If a historical record is ever wanted they can be added
 * by hand.
 *
 * YEAR CONFIRMATION — the sheet prints month grids but never a year. It is
 * 2026: the grid puts April 1 on a Wednesday, and the Nov 1 / Nov 8 races on
 * Sundays. Both hold in 2026 and in no adjacent year. Do not "correct" these
 * dates to another year without re-checking that.
 *
 * TIMES — cross-checked against the sheet's own EVENT TIMES legend, which
 * agrees with the Lions volunteer block:
 *   Tuesday   PRACTICE 6-8PM        <- "Tuesdays Open Practice 6 to 8pm"
 *   Thursday  RACE THURS: 6-7pm     <- "Every Thursdays BMX Racing 6 to 7pm"
 *   Sunday    RACE SUN: 12-1:30PM   <- "Every Sunday BMX Racing League 12:00 to 1"
 * The Sunday end time is taken as 1:30pm from the legend; the volunteer block
 * is cut off mid-line at "12:00 to 1".
 *
 * TIMESTAMP HANDLING — `events.start_date` / `end_date` /
 * `recurrence_end_date` are `timestamp WITHOUT time zone` in production
 * (verified against information_schema, not assumed). Passing a JS Date
 * through the driver makes it send a timestamptz, and Postgres then shifts
 * the value by the session offset — this project shipped exactly that bug on
 * the 2026-08 meeting-schedule import, storing 19:00 as 23:00. Every instant
 * below is therefore a wall-clock STRING re-inserted with an explicit
 * `::text::timestamp` cast. Do not pass Dates here.
 *
 * recurrence_days uses 0=Sun .. 6=Sat (verified against the existing
 * "Visit us at the Westerville Farmers Market" row: [6] with a Saturday
 * start_date).
 *
 * Usage:
 *   pnpm exec tsx scripts/add-bmx-volunteer-events.ts            # dry run (default)
 *   pnpm exec tsx scripts/add-bmx-volunteer-events.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL when set (loud banner), else DATABASE_URL/DB_URL.
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

const LOCATION = "Westerville BMX";

/** Shared tail on every description — the sheet's own caveat. */
const CAVEAT =
  "\n\nSchedule is subject to change — check westervillebmx.org for the official schedule.";

interface Slot {
  title: string;
  description: string;
  /** Wall-clock first occurrence, "YYYY-MM-DD HH:MM:SS". */
  start: string;
  end: string;
  /** 0=Sun .. 6=Sat */
  day: number;
  /** Wall-clock last occurrence at midnight. */
  recurrenceEnd: string;
}

const SLOTS: Slot[] = [
  {
    title: "BMX Volunteers — Tuesday Open Practice",
    description:
      "Lions volunteers are needed at Westerville BMX for Tuesday open practice, 6:00–8:00 pm, " +
      "through the end of the season on October 25." +
      CAVEAT,
    start: "2026-09-01 18:00:00",
    end: "2026-09-01 20:00:00",
    day: 2,
    recurrenceEnd: "2026-10-20 00:00:00",
  },
  {
    title: "BMX Volunteers — Thursday Racing",
    description:
      "Lions volunteers are needed at Westerville BMX for Thursday evening racing, 6:00–7:00 pm, " +
      "through the end of the season on October 25." +
      CAVEAT,
    start: "2026-08-27 18:00:00",
    end: "2026-08-27 19:00:00",
    day: 4,
    recurrenceEnd: "2026-10-22 00:00:00",
  },
  {
    title: "BMX Volunteers — Sunday Racing League",
    description:
      "Lions volunteers are needed at Westerville BMX for the Sunday racing league, 12:00–1:30 pm, " +
      "through the end of the season on October 25.\n\n" +
      "Typical volunteer roles across the season include registration, trophy distribution, " +
      "concessions, and parking." +
      CAVEAT,
    start: "2026-08-30 12:00:00",
    end: "2026-08-30 13:30:00",
    day: 0,
    recurrenceEnd: "2026-10-25 00:00:00",
  },
];

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const [creator] = await sql`SELECT id, email FROM users WHERE email = 'chenson42@gmail.com'`;
  if (!creator) throw new Error("Could not resolve the creating user by email.");

  for (const s of SLOTS) {
    const existing = await sql`SELECT id FROM events WHERE title = ${s.title}`;
    if (existing.length > 0) {
      console.log(`SKIP  "${s.title}" — already exists (id=${existing[0].id})`);
      continue;
    }

    console.log(`${APPLY ? "CREATE" : "WOULD CREATE"}  "${s.title}"`);
    console.log(`        first: ${s.start} → ${s.end}   weekly on day ${s.day}   until ${s.recurrenceEnd}`);
    console.log(`        private to club, RSVP required, location "${LOCATION}"`);

    if (!APPLY) continue;

    const [row] = await sql`
      INSERT INTO events (
        title, description, start_date, end_date, location,
        is_public, is_featured, requires_rsvp, is_all_day,
        is_recurring, recurrence_type, recurrence_days, recurrence_end_date,
        allow_guest_count, created_by
      ) VALUES (
        ${s.title}, ${s.description},
        ${s.start}::text::timestamp, ${s.end}::text::timestamp, ${LOCATION},
        false, false, true, false,
        true, 'weekly', ${[s.day]}, ${s.recurrenceEnd}::text::timestamp,
        false, ${creator.id}
      ) RETURNING id`;
    console.log(`        -> created ${row.id}`);
  }

  if (!APPLY) console.log("\nDRY RUN — re-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
