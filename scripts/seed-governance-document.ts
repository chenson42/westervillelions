/**
 * One-off seed: imports docs/club-constitution-and-bylaws.md as version 1 of
 * the "constitution-bylaws" governance document (title "Constitution &
 * By-Laws", visibility 'members' per the treasurer's 2026-08-09 decision).
 *
 * NEVER a migration (DECISION-076 Ruling 5) — `drizzle/migrations/` re-runs
 * on every deploy, and this is exactly the failure class that has already
 * bitten this project for real: the standing memory note on the Ledger's
 * Quicken-export seed, "NEVER re-run import (delete-and-reinsert wipes
 * post-seed edits)." A `WHERE NOT EXISTS` guard protects a migration against
 * re-INSERTING a duplicate row, but not against a human later editing that
 * migration file (to fix a transcription typo, say) and having it replay
 * against a database where versions 2-N already exist on top of version 1.
 * This script's primary safety property is structural: it is not wired into
 * `drizzle/migrations/` or any deploy step, so it cannot be silently
 * re-triggered by a routine `pnpm build`/`db:migrate`. The idempotency guard
 * below (no-op if the slug already exists) is defense-in-depth on top of
 * that, not the primary defense.
 *
 * Strips the file's transcription-notice header before import — that header
 * ("THE SCANNED PDF IS AUTHORITATIVE") describes the document's
 * PRE-publication status and becomes actively wrong the moment this script
 * publishes the document. Only the body from "## Contents" onward becomes
 * `bodyMarkdown`. See extractBodyMarkdown() below.
 *
 * `authorUserId` is null — there is no session, this is a script, not an
 * admin action (attribution-only field, nullable everywhere else in this
 * schema for the same reason).
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-governance-document.ts            # dry run (default)
 *   pnpm exec tsx scripts/seed-governance-document.ts --apply    # writes
 *
 * TARGET DB: set PROD_DATABASE_URL to run against production (a loud banner
 * prints); otherwise uses DATABASE_URL/DB_URL (dev) from .env.local.
 *
 * *** NEVER run this against production as a routine step. *** Publishing
 * the by-laws is the treasurer's deliberate call — the moment this script
 * applies against production is the moment the 1998 scan stops governing
 * and the in-app document becomes the club's authoritative text. Running it
 * against dev to seed content for development/testing is expected and safe.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import { readFileSync } from "fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { documents, documentVersions } from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) {
  throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
}

const client = postgres(url);
const db = drizzle(client, { schema });

const SLUG = "constitution-bylaws";
const TITLE = "Constitution & By-Laws";
const VISIBILITY = "members";
const SOURCE_PATH = resolve(__dirname, "../docs/club-constitution-and-bylaws.md");
const CHANGE_NOTE =
  "Initial publication — verbatim transcription of the 1998 Constitution & By-Laws " +
  "(Revised April 2, 1998), proofread against the scanned original.";

/**
 * Strips the file's transcription-notice header. The header runs from the
 * top of the file through the FIRST line that is exactly "---" (the divider
 * closing the blockquote warning) — `bodyMarkdown` starts at the next
 * content after that divider, which is "## Contents" in the source file as
 * of this script's writing. Refuses (throws) rather than guessing if the
 * file's shape has changed since — a silent wrong-split would publish a
 * governing document missing part of its own text, or with stray header
 * prose baked in.
 */
function extractBodyMarkdown(raw: string): string {
  const lines = raw.split("\n");
  const dividerIndex = lines.findIndex((line) => line.trim() === "---");
  if (dividerIndex === -1) {
    throw new Error(
      `Could not find the header-closing "---" divider in ${SOURCE_PATH} — refusing to guess ` +
        "where the transcription notice ends. Check the file hasn't changed shape.",
    );
  }
  const body = lines
    .slice(dividerIndex + 1)
    .join("\n")
    .replace(/^\n+/, ""); // drop the blank line(s) immediately after the divider
  if (!body.trim().startsWith("## Contents")) {
    throw new Error(
      "Expected the stripped body to start with \"## Contents\" but it starts with " +
        `${JSON.stringify(body.slice(0, 40))} — refusing to import. Check the file's shape.`,
    );
  }
  return body;
}

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);
  if (usingProd) {
    console.log("=".repeat(78));
    console.log("*** THIS WILL WRITE TO PRODUCTION — the club's live database. ***");
    console.log("Publishing the by-laws is the treasurer's deliberate call to make. The");
    console.log("moment this applies, the 1998 scan stops governing and the in-app document");
    console.log("becomes the club's authoritative text. Confirm this is intentional.");
    console.log("=".repeat(78));
  }

  const existing = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, SLUG)).limit(1);
  if (existing.length > 0) {
    console.log(`A document with slug "${SLUG}" already exists (id=${existing[0].id}). Nothing to do.`);
    await client.end();
    return;
  }

  const raw = readFileSync(SOURCE_PATH, "utf-8");
  const bodyMarkdown = extractBodyMarkdown(raw);

  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Title: ${TITLE}`);
  console.log(`Slug: ${SLUG}`);
  console.log(`Visibility: ${VISIBILITY}`);
  console.log(`Body: ${bodyMarkdown.length} characters, ${bodyMarkdown.split("\n").length} lines`);
  console.log(`Change note: ${CHANGE_NOTE}`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await client.end();
    return;
  }

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ title: TITLE, slug: SLUG, visibility: VISIBILITY })
      .returning({ id: documents.id });

    const [version] = await tx
      .insert(documentVersions)
      .values({
        documentId: doc.id,
        versionNumber: 1,
        bodyMarkdown,
        changeType: "editorial",
        changeNote: CHANGE_NOTE,
        authorUserId: null,
      })
      .returning({ id: documentVersions.id });

    await tx
      .update(documents)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));

    console.log(`\nCreated document ${doc.id}, version 1 (${version.id}), current version set.`);
  });

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
