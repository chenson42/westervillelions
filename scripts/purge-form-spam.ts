/**
 * Purges bot-submitted junk rows from contact_submissions,
 * membership_applications, and newsletter_subscriptions — the public-form
 * spam incident documented in docs/work-log/2026-09-28-public-form-spam.md,
 * DECISION-104 (Revision 2).
 *
 * Selection is a row-level OR of two independent signals, mirroring what the
 * LIVE guard now catches (structural guard → content-independent cooldown →
 * content guard, per DECISION-104 Revision 2) — reproduced retroactively here
 * since no `form_submission_cooldown` rows exist for pre-launch submissions:
 *
 *   (a) CONTENT: the same two-field gibberish-agreement rule
 *       `evaluateContentGuard()`/`isGibberishToken()` apply live, imported
 *       directly from src/lib/form-guard.ts, never reimplemented.
 *         - contact_submissions: name + message
 *         - newsletter_subscriptions: first_name + last_name
 *         - membership_applications: any two of first_name/last_name/city
 *   (b) CROSS-TABLE TIMING: the row's (normalized) email also appears in one
 *       of the OTHER two tables within 90 seconds — mirroring what the live
 *       reordered cooldown now catches structurally (a burst-leading
 *       submission protects the ones that follow it in the same burst,
 *       regardless of the leader's own content score).
 *
 * A row in the --since window that matches NEITHER (a) nor (b) is never
 * silently dropped — it's printed under "unmatched — review manually" and
 * excluded from deletion, even with --apply. Per DECISION-104's documented
 * residual gap, this is expected for isolated, burst-leading
 * `membership_applications` submissions with no cross-table sibling.
 *
 * Scoped to --since (required, no default) so this stays bound to the known
 * incident window rather than becoming a standing content-based deletion job
 * (Phase 1's explicit out-of-scope ruling).
 *
 * No email/name literal anywhere in this file or its dry-run output —
 * "No Personal Data in the Repository" (CLAUDE.md). Dry-run output prints
 * only row ids, table names, and timestamps for operator review — never
 * email addresses or free-text field content.
 *
 * Dry-run by default. --apply deletes. No SCRIPT_OPERATOR_EMAIL requirement —
 * per the 2026-09-28 architectural review, that convention applies to scripts
 * writing an attributable column, and this script only deletes rows from
 * tables with none (same as scripts/clear-budget-fy.ts, the template this
 * script is modeled on).
 *
 *   pnpm exec tsx scripts/purge-form-spam.ts --since=2026-09-23            # dry run
 *   pnpm exec tsx scripts/purge-form-spam.ts --since=2026-09-23 --apply    # delete
 *
 * TARGET DB: set PROD_DATABASE_URL to run against production (a loud banner
 * prints); otherwise uses DATABASE_URL/DB_URL (dev).
 *
 * ENV-LOADING FIX (DECISION-104 Revision 2 / Phase 5 QA finding): this script
 * imports `isGibberishToken()` from `../src/lib/form-guard`, which — as of
 * this revision — has NO static top-level import of `@/lib/db` (that module's
 * DB access, `checkAndRecordFormCooldown()`, now uses a dynamic
 * `await import(...)` deferred to call time, and this script never calls
 * it). Previously, form-guard.ts's static `import { db } from "@/lib/db"`
 * was transitively pulled in by this script's import of `isGibberishToken`,
 * and ES import hoisting evaluates that import — including `@/lib/db`'s
 * module-level `postgres(url)` connection, which reads
 * `process.env.DATABASE_URL` — BEFORE this file's own `dotenv.config()` call
 * ever ran, regardless of where `config()` was textually placed. That made
 * this script crash with "DATABASE_URL or DB_URL environment variable is not
 * set" in any fresh shell that didn't already have it exported. Fixed at the
 * source (form-guard.ts), not worked around here — but this file ALSO now
 * defers all env-reading/argv-parsing/DB-connecting side effects into
 * `main()`, so importing this module (e.g. from
 * scripts/purge-form-spam.test.ts, to unit-test the pure correlation logic
 * below) never requires `--since` on argv or a DB URL at all.
 *
 * SECOND, DISTINCT resolution wrinkle found while implementing the above
 * (not in QA's report, found during this revision's own testing): once this
 * file imports `../src/lib/form-guard` — which contains, even only as an
 * unevaluated string inside a dynamic `await import("@/lib/db")` never
 * called by this script — `tsx`'s tsconfig-paths-aware resolver
 * (`resolveTsPaths`) stops being able to resolve the bare specifier
 * `"dotenv"` for THIS file, in both static and dynamic-import form,
 * reproducibly, independent of environment variables (confirmed against a
 * genuinely fresh `env -i` shell and the normal shell alike; a sibling
 * script with no `@/`-aliased import in its graph, e.g.
 * `clear-budget-fy.ts`, is unaffected). `dotenv` is a transitive,
 * NOT-directly-declared dependency in this pnpm-strict tree (only
 * `dotenv-cli` is a direct devDependency) — the working case was already
 * resolving it by accident, and pulling in a `@/`-aliased import elsewhere
 * in the module graph is what exposes the phantom dependency as a hard
 * failure. **Fix: don't depend on the `dotenv` package here at all.** Use
 * Node's own built-in `process.loadEnvFile()` (stable since Node 20.6),
 * which reads the same `KEY=VALUE` `.env` format with no npm dependency and
 * no resolver interaction whatsoever.
 */

import postgres from "postgres";
import { isGibberishToken } from "../src/lib/form-guard";

export const CROSS_TABLE_WINDOW_MS = 90_000;

export interface CorrelationRow {
  id: string;
  createdAt: Date;
  emailNormalized: string;
  fields: (string | null | undefined)[];
}

export interface Classified {
  row: CorrelationRow;
  content: boolean;
  timing: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True iff at least two of the row's content fields are independently gibberish. */
export function contentMatches(fields: (string | null | undefined)[]): boolean {
  return fields.filter((f) => isGibberishToken(f)).length >= 2;
}

/**
 * True iff `row`'s normalized email also appears in one of `otherTables`
 * (each a flat array of rows from a DIFFERENT table) within
 * CROSS_TABLE_WINDOW_MS of `row`'s own timestamp, in either direction.
 */
export function timingMatches(row: CorrelationRow, otherTables: CorrelationRow[][]): boolean {
  for (const rows of otherTables) {
    for (const other of rows) {
      if (other.emailNormalized !== row.emailNormalized) continue;
      const deltaMs = Math.abs(row.createdAt.getTime() - other.createdAt.getTime());
      if (deltaMs <= CROSS_TABLE_WINDOW_MS) return true;
    }
  }
  return false;
}

export function classify(rows: CorrelationRow[], otherTables: CorrelationRow[][]): Classified[] {
  return rows.map((row) => ({
    row,
    content: contentMatches(row.fields),
    timing: timingMatches(row, otherTables),
  }));
}

/** Rows selected for deletion — content match, timing match, or both. */
export function selectMatches(classified: Classified[]): Classified[] {
  return classified.filter((c) => c.content || c.timing);
}

/**
 * Rows in the --since window matched by NEITHER signal. Never silently
 * dropped from deletion consideration by omission — always surfaced
 * separately for manual review, per DECISION-104 Revision 2.
 */
export function unmatchedRows(classified: Classified[]): Classified[] {
  return classified.filter((c) => !c.content && !c.timing);
}

function report(tableName: string, classified: Classified[]): Classified[] {
  const selected = selectMatches(classified);
  const unmatched = unmatchedRows(classified);
  console.log(
    `${tableName}: ${selected.length} match(es) of ${classified.length} in window ` +
      `(content: ${classified.filter((c) => c.content).length}, timing-only: ${
        classified.filter((c) => c.timing && !c.content).length
      })`,
  );
  for (const c of selected) {
    const via = c.content && c.timing ? "content+timing" : c.content ? "content" : "timing";
    console.log(`  ${c.row.id}  ${c.row.createdAt.toISOString()}  [${via}]`);
  }
  if (unmatched.length > 0) {
    console.log(`  ${unmatched.length} row(s) unmatched by content or timing correlation — review manually:`);
    for (const c of unmatched) {
      console.log(`    ${c.row.id}  ${c.row.createdAt.toISOString()}`);
    }
  }
  return selected;
}

async function main() {
  // Node's own built-in .env loader — no "dotenv" package dependency, no
  // resolver interaction. See the module doc comment above ("SECOND,
  // DISTINCT resolution wrinkle") for why the npm "dotenv" package is
  // deliberately not used here. Stable since Node 20.6; this project targets
  // Node 20.x (.nvmrc). Missing file is a silent no-op (matches dotenv's own
  // default behavior for a missing .env.local in prod-like environments where
  // real env vars are already set some other way).
  try {
    process.loadEnvFile(new URL("../.env.local", import.meta.url));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }

  const APPLY = process.argv.includes("--apply");
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  if (!sinceArg) throw new Error("--since=YYYY-MM-DD is required.");
  const SINCE = sinceArg.split("=")[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) {
    throw new Error(`--since must be YYYY-MM-DD, got "${SINCE}"`);
  }

  const usingProd = Boolean(process.env.PROD_DATABASE_URL);
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
  if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
  const sql = postgres(url);

  try {
    console.log(
      `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  since ${SINCE}  |  Mode: ${
        APPLY ? "APPLY (deletes)" : "DRY RUN"
      }\n`,
    );

    const contactRaw = await sql`
      SELECT id, name, message, email, created_at FROM contact_submissions
      WHERE created_at >= ${SINCE}`;
    const contact: CorrelationRow[] = contactRaw.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      emailNormalized: normalizeEmail(r.email),
      fields: [r.name, r.message],
    }));

    const newsletterRaw = await sql`
      SELECT id, first_name, last_name, email, created_at FROM newsletter_subscriptions
      WHERE created_at >= ${SINCE}`;
    const newsletter: CorrelationRow[] = newsletterRaw.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      emailNormalized: normalizeEmail(r.email),
      fields: [r.first_name, r.last_name],
    }));

    const membershipRaw = await sql`
      SELECT id, first_name, last_name, city, email, created_at FROM membership_applications
      WHERE created_at >= ${SINCE}`;
    const membership: CorrelationRow[] = membershipRaw.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      emailNormalized: normalizeEmail(r.email),
      fields: [r.first_name, r.last_name, r.city],
    }));

    const contactClassified = classify(contact, [newsletter, membership]);
    const newsletterClassified = classify(newsletter, [contact, membership]);
    const membershipClassified = classify(membership, [contact, newsletter]);

    const contactSelected = report("contact_submissions", contactClassified);
    const newsletterSelected = report("newsletter_subscriptions", newsletterClassified);
    const membershipSelected = report("membership_applications", membershipClassified);

    const total = contactSelected.length + newsletterSelected.length + membershipSelected.length;
    console.log(`\nTotal matched: ${total}`);

    if (!APPLY) {
      console.log("\nDRY RUN — re-run with --apply to delete.");
      return;
    }

    if (contactSelected.length) {
      const ids = contactSelected.map((c) => c.row.id);
      const del = await sql`DELETE FROM contact_submissions WHERE id = ANY(${ids}) RETURNING id`;
      console.log(`Deleted ${del.length} contact_submissions row(s).`);
    }
    if (newsletterSelected.length) {
      const ids = newsletterSelected.map((c) => c.row.id);
      const del = await sql`DELETE FROM newsletter_subscriptions WHERE id = ANY(${ids}) RETURNING id`;
      console.log(`Deleted ${del.length} newsletter_subscriptions row(s).`);
    }
    if (membershipSelected.length) {
      const ids = membershipSelected.map((c) => c.row.id);
      const del = await sql`DELETE FROM membership_applications WHERE id = ANY(${ids}) RETURNING id`;
      console.log(`Deleted ${del.length} membership_applications row(s).`);
    }
  } finally {
    await sql.end();
  }
}

// Only run when executed directly (tsx script), not when imported by
// scripts/purge-form-spam.test.ts for its pure-function unit tests — this is
// exactly what keeps this module importable without requiring `--since` on
// argv or any DB URL at all.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
