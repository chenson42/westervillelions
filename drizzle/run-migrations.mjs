#!/usr/bin/env node
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const connectionString = process.env.DATABASE_URL || process.env.DB_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL or DB_URL environment variable is not set");
  process.exit(1);
}

const migrationsDir = join(__dirname, "migrations");

// Seed-identity substitution: a handful of migrations bootstrap a starting
// admin/treasurer identity for a fresh install (see CLAUDE.md → "No Personal
// Data in the Repository"). Rather than hard-coding a real person's email,
// those migrations embed the literal token `{{SEED_ADMIN_EMAIL}}` inside a
// SQL string literal, e.g. `WHERE u.email = '{{SEED_ADMIN_EMAIL}}'`. We
// substitute it here from the SEED_ADMIN_EMAIL env var before executing.
// Left unset, it substitutes to an empty string — `WHERE u.email = ''`
// matches no real user, so the statement is a safe no-op. A single quote in
// the value is escaped so it can't break out of the SQL string literal.
const SEED_ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || "").replace(/'/g, "''");

const sql = postgres(connectionString, { max: 1 });

try {
  console.log("🔄 Running database migrations...");

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    let content = readFileSync(filePath, "utf-8");
    content = content.split("{{SEED_ADMIN_EMAIL}}").join(SEED_ADMIN_EMAIL);
    console.log(`  → ${file}`);
    await sql.unsafe(content);
  }

  console.log("✅ Migrations completed successfully");
} catch (error) {
  console.error("❌ Migration failed:", error);
  process.exit(1);
} finally {
  await sql.end();
}
