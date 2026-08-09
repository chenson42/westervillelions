/**
 * One-off: ports the 2026-08-07 Board Retreat minutes (real minutes, entered
 * into dev while testing the minutes feature) from dev into production,
 * together with its motions and action items.
 *
 * NEVER a migration — `drizzle/migrations/` re-runs on every deploy and this
 * inserts real governance rows. Same reasoning as
 * scripts/seed-governance-document.ts.
 *
 * WHY THIS ISN'T A STRAIGHT ROW COPY — foreign keys do not carry across:
 *   - event_id: dev and prod hold DIFFERENT UUIDs for the same Board Retreat
 *     event. Resolved by natural key (title + start_date::date) and remapped.
 *     A blind copy would either violate the FK or, worse, silently point at
 *     an unrelated prod event.
 *   - author_user_id / approved_by_user_id: resolved by EMAIL, not by copying
 *     the UUID. These happen to match today, but relying on that coincidence
 *     is how a future port would silently attribute minutes to the wrong
 *     person.
 *
 * TIMESTAMP HANDLING — read this before editing. Passing these values back
 * through the driver as JS Dates is how this project has already shipped a
 * timestamp-shift bug twice (DECISION-015, and the 2026-08 meeting-schedule
 * import where 19:00 was stored as 23:00). Every timestamp here is therefore
 * read AS TEXT and re-inserted with an explicit cast, never as a Date.
 *
 * Note the columns are `timestamp with time zone` in BOTH live databases even
 * though schema.ts declares them as naive `timestamp` — verified directly
 * against information_schema, not assumed. That drift is pre-existing and out
 * of scope here, but it dictates the cast: `::text` yields an offset-bearing
 * literal ("2026-08-09 13:40:17.611+00"), so we cast to `::timestamptz`, which
 * parses that offset explicitly and round-trips the exact instant regardless
 * of either session's timezone. Casting to a bare `::timestamp` would discard
 * the offset and silently re-interpret it in the session timezone — correct
 * only by luck while both sessions happen to be GMT.
 *
 * meeting_date is a `date` column and is safe as text.
 *
 * Row IDs are preserved deliberately — prod's minutes table is empty, so
 * there is no collision risk, and keeping the IDs makes the dev row and the
 * prod row cross-referenceable if this ever needs auditing.
 *
 * Usage:
 *   pnpm exec tsx scripts/port-board-minutes-to-prod.ts            # dry run (default)
 *   pnpm exec tsx scripts/port-board-minutes-to-prod.ts --apply    # writes
 *
 * Requires BOTH DATABASE_URL (source: dev) and PROD_DATABASE_URL (target).
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const MINUTES_ID = "937d9764-1b55-4a1f-a765-65c675961d9c";

const devUrl = process.env.DATABASE_URL || process.env.DB_URL;
const prodUrl = process.env.PROD_DATABASE_URL;
if (!devUrl) throw new Error("No DATABASE_URL/DB_URL (source dev DB).");
if (!prodUrl) throw new Error("No PROD_DATABASE_URL (target production DB).");
if (devUrl === prodUrl) throw new Error("Source and target are the same database — refusing to run.");

const dev = postgres(devUrl);
const prod = postgres(prodUrl);

async function main() {
  console.log(`Source: dev   Target: *** PRODUCTION ***   Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  // ---- Read the source row ------------------------------------------------
  const [m] = await dev`
    SELECT id, kind, meeting_date::text AS meeting_date, status, title, present_count,
           event_id, notetaker_member_id, notetaker_name_snapshot, body_markdown,
           author_user_id, approved_by_user_id,
           approved_at::text  AS approved_at,
           created_at::text   AS created_at,
           updated_at::text   AS updated_at,
           pending_delete_at::text AS pending_delete_at
    FROM minutes WHERE id = ${MINUTES_ID}`;
  if (!m) throw new Error(`Minutes ${MINUTES_ID} not found in dev.`);
  if (m.pending_delete_at) throw new Error("Source row is soft-deleted — refusing to port.");

  const motions = await dev`
    SELECT id, text, mover_name, seconder_name, result, created_at::text AS created_at
    FROM minutes_motions WHERE minutes_id = ${MINUTES_ID} ORDER BY created_at, id`;
  const actionItems = await dev`
    SELECT * FROM minutes_action_items WHERE minutes_id = ${MINUTES_ID} ORDER BY created_at, id`;

  // ---- Guard: already ported? --------------------------------------------
  const dupe = await prod`
    SELECT id FROM minutes WHERE kind = ${m.kind} AND meeting_date = ${m.meeting_date}::date`;
  if (dupe.length > 0) {
    console.log(`Production already has ${m.kind} minutes for ${m.meeting_date} (id=${dupe[0].id}). Nothing to do.`);
    return;
  }

  // ---- Resolve FKs by natural key ----------------------------------------
  let prodEventId: string | null = null;
  if (m.event_id) {
    const [devEv] = await dev`SELECT title, start_date::text AS start_date FROM events WHERE id = ${m.event_id}`;
    if (!devEv) throw new Error(`Dev event ${m.event_id} missing — cannot resolve.`);
    const matches = await prod`
      SELECT id FROM events
      WHERE title = ${devEv.title} AND start_date::date = ${devEv.start_date}::date`;
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly 1 prod event matching "${devEv.title}" on ${devEv.start_date}, found ${matches.length}. ` +
          "Refusing to guess which event these minutes belong to.",
      );
    }
    prodEventId = matches[0].id;
    console.log(`event_id remapped: ${m.event_id} (dev) -> ${prodEventId} (prod) via "${devEv.title}" @ ${devEv.start_date}`);
  }

  async function resolveUser(devUserId: string | null, label: string): Promise<string | null> {
    if (!devUserId) return null;
    const [devU] = await dev`SELECT email FROM users WHERE id = ${devUserId}`;
    if (!devU) throw new Error(`Dev user ${devUserId} (${label}) missing — cannot resolve.`);
    const matches = await prod`SELECT id FROM users WHERE email = ${devU.email}`;
    if (matches.length !== 1) {
      throw new Error(`Expected exactly 1 prod user for ${devU.email} (${label}), found ${matches.length}.`);
    }
    console.log(`${label} resolved: ${devU.email} -> ${matches[0].id}`);
    return matches[0].id;
  }

  const prodAuthorId = await resolveUser(m.author_user_id, "author_user_id");
  const prodApproverId = await resolveUser(m.approved_by_user_id, "approved_by_user_id");

  // notetaker_member_id is null on this row; resolving it by name snapshot is
  // deliberately NOT attempted — guessing which member a free-text name maps
  // to is exactly the kind of silent wrong-attribution this script avoids.
  if (m.notetaker_member_id) {
    throw new Error("Source row has a notetaker_member_id — this script has no resolution path for it. Extend it first.");
  }

  console.log(`\n${m.kind} minutes — ${m.meeting_date} — "${m.title}"`);
  console.log(`  status=${m.status}  present_count=${m.present_count}  body=${m.body_markdown?.length ?? 0} chars`);
  console.log(`  approved_at=${m.approved_at}  created_at=${m.created_at}`);
  console.log(`  motions=${motions.length}  action items=${actionItems.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    return;
  }

  // ---- Write --------------------------------------------------------------
  await prod.begin(async (tx) => {
    await tx`
      INSERT INTO minutes (
        id, kind, event_id, meeting_date, status, title, present_count,
        notetaker_member_id, notetaker_name_snapshot, body_markdown,
        author_user_id, approved_by_user_id, approved_at, created_at, updated_at
      ) VALUES (
        ${m.id}, ${m.kind}, ${prodEventId}, ${m.meeting_date}::date, ${m.status},
        ${m.title}, ${m.present_count}, NULL, ${m.notetaker_name_snapshot},
        ${m.body_markdown}, ${prodAuthorId}, ${prodApproverId},
        ${m.approved_at}::text::timestamptz,
        ${m.created_at}::text::timestamptz,
        ${m.updated_at}::text::timestamptz
      )`;

    for (const mo of motions) {
      await tx`
        INSERT INTO minutes_motions (id, minutes_id, text, mover_name, seconder_name, result, created_at)
        VALUES (${mo.id}, ${m.id}, ${mo.text}, ${mo.mover_name}, ${mo.seconder_name}, ${mo.result},
                ${mo.created_at}::text::timestamptz)`;
    }

    for (const ai of actionItems as Array<Record<string, unknown>>) {
      await tx`
        INSERT INTO minutes_action_items ${tx({ ...ai, minutes_id: m.id })}`;
    }

    console.log(`\nInserted minutes ${m.id} with ${motions.length} motion(s), ${actionItems.length} action item(s).`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dev.end();
    await prod.end();
  });
