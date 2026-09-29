/**
 * Turns RSVP off on every UPCOMING regular club meeting — General, Activities and
 * Board — in one pass.
 *
 *   pnpm exec tsx scripts/disable-rsvp-on-meetings.ts            # dry run
 *   pnpm exec tsx scripts/disable-rsvp-on-meetings.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 *
 * WHY: the 2026-27 meeting schedule was seeded as ~26 independent event rows, not
 * as recurring series (see scripts/add-2026-27-meeting-schedule.ts). The admin
 * turned RSVP off on one General Meeting and one Activities Meeting on 2026-09-25
 * expecting it to apply to the whole schedule; nothing propagated because there is
 * no series to propagate through. This script finishes that change. The product
 * gap (no bulk edit / no real series) is tracked separately.
 *
 * SCOPE: rows whose title is exactly "General Meeting", "Activities Meeting" or
 * "Board Meeting" and whose start_date is in the future. The Christmas Party
 * ("Activities Meeting — Christmas Party") is deliberately LEFT ALONE — a party is
 * the one meeting where a headcount is useful. Past meetings are untouched.
 *
 * Existing RSVP rows are not deleted; they simply stop being collected.
 *
 * IDEMPOTENT: only touches rows where requires_rsvp is still true.
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

const TITLES = ["General Meeting", "Activities Meeting", "Board Meeting"];

// "Upcoming" is compared in EASTERN WALL-CLOCK, not against Postgres now().
// events.start_date is a naive timestamp (DECISION-005); `start_date >= now()`
// would cast it using the session timezone (UTC on Neon) and treat a 7pm meeting
// as already started four hours early. Build the cutoff as the same kind of
// wall-clock string the column stores.
function nowEasternWallClock(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}
const CUTOFF = nowEasternWallClock();

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}  |  upcoming = start_date >= ${CUTOFF} (Eastern)\n`,
  );

  const rows = await sql`
    SELECT id, title, start_date::text AS start_text, requires_rsvp,
           (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id)::int AS rsvp_count
    FROM events e
    WHERE title = ANY(${TITLES}) AND start_date >= ${CUTOFF}::text::timestamp
    ORDER BY start_date`;

  let toFlip = 0;
  for (const r of rows) {
    const flag = r.requires_rsvp ? "FLIP  " : "ok    ";
    if (r.requires_rsvp) toFlip++;
    console.log(
      `  ${flag}  ${r.start_text}  ${r.title.padEnd(20)}  rsvps so far: ${r.rsvp_count}`,
    );
  }
  console.log(`\n${rows.length} upcoming meetings, ${toFlip} still requiring RSVP.`);
  console.log("Christmas Party (2026-12-17) intentionally not in scope.");

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to turn RSVP off on the FLIP rows.");
    await sql.end();
    return;
  }

  const updated = await sql`
    UPDATE events
    SET requires_rsvp = false, updated_at = now()
    WHERE title = ANY(${TITLES}) AND start_date >= ${CUTOFF}::text::timestamp AND requires_rsvp = true
    RETURNING title, start_date::text AS start_text`;
  console.log(`\nApplied. RSVP turned off on ${updated.length} meeting(s).`);

  const remaining = await sql`
    SELECT count(*)::int AS n FROM events
    WHERE title = ANY(${TITLES}) AND start_date >= ${CUTOFF}::text::timestamp AND requires_rsvp = true`;
  console.log(`Upcoming meetings still requiring RSVP: ${remaining[0].n} (expected 0).`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
