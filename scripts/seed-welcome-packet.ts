/**
 * One-off seed: imports the real, currently-local (gitignored, untracked)
 * docs/club-documents/welcome-packet-2026-27.html as the first
 * `welcomePackets` row (lionsYear "2026-27"), and marks it current in the
 * same transaction.
 *
 * *** NO RE-RUN GUARD. *** Unlike scripts/seed-governance-document.ts
 * (which refuses a second run because `documents.slug` is effectively
 * unique in practice), `welcomePackets.lionsYear` has NO unique constraint
 * by design (docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3
 * (Revised) Data Model — a redo/correction for one Lions year must stay
 * representable as a second row, not force an overwrite). That means this
 * script has nothing stopping a second `--apply` run from silently creating
 * a SECOND "2026-27" row (and re-publishing it as current, clobbering
 * whatever was current at that point). *** NEVER run this with --apply more
 * than once. *** If you need to fix a mistake after the first successful
 * apply, use the admin UI at /admin/welcome-packets (edit-in-place, or
 * create a new row and mark it current) — do not re-run this script.
 *
 * NEVER a migration (same reasoning as seed-governance-document.ts):
 * drizzle/migrations/ re-runs on every deploy, and this script's one-time,
 * real-content nature is exactly the failure class that reasoning guards
 * against. This script is not wired into any deploy step, so it cannot be
 * silently re-triggered by a routine `pnpm build`/`db:migrate`.
 *
 * The source file itself never leaves the local disk / private archive —
 * docs/club-documents/ is gitignored (see .gitignore's own comment, and the
 * work-log's "LOOP-BACK" section for why: the packet embeds the club's real
 * giving/budget figures). This script file is ordinary logic containing
 * zero real content and is committed normally, same as
 * seed-governance-document.ts is committed while the by-laws file it reads
 * is a separate, already-resolved question. The filename
 * "welcome-packet-2026-27.html" below is a relative path string, not
 * personal data or a secret — fine to commit.
 *
 * `createdByUserId` is null — there is no session, this is a script, not an
 * admin action (attribution-only field, nullable everywhere else in this
 * schema for the same reason), matching seed-governance-document.ts's own
 * `authorUserId: null` precedent for script-run inserts. (SCRIPT_OPERATOR_EMAIL
 * is not used here for that reason — CLAUDE.md documents it as resolving to
 * a real `users.id` for scripts that attribute a write to an operator, but
 * this script follows the by-laws seed's null-attribution precedent
 * instead. If real-user attribution is wanted later, add a `users` lookup
 * by SCRIPT_OPERATOR_EMAIL before the insert and pass its id as
 * createdByUserId — flagged in the Phase 3 (Revised) design doc as the
 * implementer's call, not a blocking gap.)
 *
 * DEVIATION FROM THE PHASE 3 (REVISED) DESIGN DOC, noted explicitly: the
 * design said to call createWelcomePacket()/markWelcomePacketCurrent() from
 * src/lib/welcome-packets-queries.ts directly. This script does NOT do
 * that — verified empirically that it can't, safely. Those two functions go
 * through the app's shared `@/lib/db` singleton, which resolves its
 * connection from `process.env.DATABASE_URL || process.env.DB_URL` as a
 * MODULE-LEVEL side effect (throwing immediately if neither is set) the
 * instant it's imported. Every one-off script in this repo (including
 * scripts/seed-governance-document.ts) needs to route PROD_DATABASE_URL to
 * that same DATABASE_URL slot for a production run, and the only place to
 * do that is before @/lib/db's own import executes — but a real test run of
 * this exact file proved tsx hoists `import` statements above ALL other
 * top-level code in this file (including an earlier dotenv `config()` call
 * and an explicit `process.env.DATABASE_URL = url` assignment placed textually
 * before the import), reproducing "DATABASE_URL or DB_URL environment
 * variable is not set" even with a valid .env.local present. This is why
 * seed-governance-document.ts never imports @/lib/db either — it builds its
 * own `postgres`/`drizzle` client from the already-resolved `url` constant,
 * entirely sidestepping the hazard. This script does the same, and
 * reimplements just the two small writes (insert one welcomePackets row;
 * flip the welcome_packet_current singleton pointer) directly against that
 * script-owned client instead. It still reuses extractPacketParts()/
 * isValidLionsYear() from src/lib/welcome-packets.ts for validation — that
 * module has zero DB dependency, so it carries no import-time hazard.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-welcome-packet.ts            # dry run (default)
 *   pnpm exec tsx scripts/seed-welcome-packet.ts --apply    # writes (ONCE)
 *
 * TARGET DB: set PROD_DATABASE_URL to run against production (a loud banner
 * prints); otherwise uses DATABASE_URL/DB_URL (dev) from .env.local.
 *
 * *** Do not run --apply against production as part of a routine deploy or
 * implementation step. *** Publishing the welcome packet live is the club's
 * own deliberate call, made once the feature has shipped and been verified
 * — same standing rule as seed-governance-document.ts's own "never run this
 * against production as a routine step."
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import { readFileSync, existsSync } from "fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { welcomePackets, welcomePacketCurrent } from "../src/lib/db/schema";
import { extractPacketParts, isValidLionsYear } from "../src/lib/welcome-packets";

const APPLY = process.argv.includes("--apply");
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) {
  throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
}

const client = postgres(url);
const db = drizzle(client, { schema });

const LIONS_YEAR = "2026-27";
const SOURCE_PATH = resolve(__dirname, "../docs/club-documents/welcome-packet-2026-27.html");

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);
  if (usingProd) {
    console.log("=".repeat(78));
    console.log("*** THIS WILL WRITE TO PRODUCTION — the club's live database. ***");
    console.log("Publishing the welcome packet live is the club's own deliberate call.");
    console.log("This script has NO RE-RUN GUARD (welcomePackets.lionsYear is not unique");
    console.log("by design) — running --apply a second time creates a SECOND row and");
    console.log("re-publishes it, clobbering whatever was current. Confirm this is the");
    console.log("first and only --apply run for this Lions year.");
    console.log("=".repeat(78));
  }

  if (!isValidLionsYear(LIONS_YEAR)) {
    // Guards against this script's own hardcoded constant drifting out of
    // format if it's ever copy-pasted for a future year without updating it.
    throw new Error(`LIONS_YEAR constant "${LIONS_YEAR}" is not a valid "YYYY-YY" value.`);
  }

  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      `Source file not found: ${SOURCE_PATH}. This script reads the local, gitignored ` +
        "docs/club-documents/welcome-packet-2026-27.html — it is not checked into git " +
        "(see .gitignore) and must exist on this machine's disk (or be restored from the " +
        "private archive) before running this script.",
    );
  }

  const rawHtml = readFileSync(SOURCE_PATH, "utf-8");

  // Fail loudly here, before touching the DB, if the source file's shape
  // has changed since this script was written — same hard-fail standard as
  // the admin save path (createWelcomePacket() itself applies the same
  // check; this earlier check lets the dry run report a clear parse
  // preview without a stack trace).
  let parts;
  try {
    parts = extractPacketParts(rawHtml);
  } catch (err) {
    throw new Error(
      `${SOURCE_PATH} failed to parse (${(err as Error).message}) — refusing to import. ` +
        "Check the file hasn't changed shape since this script was written.",
    );
  }

  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Lions year: ${LIONS_YEAR}`);
  console.log(`Title: ${parts.title}`);
  console.log(`Raw HTML: ${rawHtml.length.toLocaleString()} characters`);
  console.log('Anchors found: <title>, <style>, <div class="deck"> — OK');

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write. Remember: no re-run guard exists");
    console.log("once you do — --apply is a ONE-TIME action for this script.");
    await client.end();
    return;
  }

  await db.transaction(async (tx) => {
    const [packet] = await tx
      .insert(welcomePackets)
      .values({ lionsYear: LIONS_YEAR, rawHtml, createdByUserId: null, updatedByUserId: null })
      .returning({ id: welcomePackets.id });

    const [singleton] = await tx.select({ id: welcomePacketCurrent.id }).from(welcomePacketCurrent).limit(1);
    if (!singleton) {
      throw new Error(
        "welcome_packet_current has no seeded row — has migration 0090_welcome_packets.sql run against this database?",
      );
    }

    await tx
      .update(welcomePacketCurrent)
      .set({ packetId: packet.id, setByUserId: null, setAt: new Date() })
      .where(eq(welcomePacketCurrent.id, singleton.id));

    console.log(`\nCreated welcome packet ${packet.id} (${LIONS_YEAR}) and marked it current.`);
  });

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
