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

const sql = postgres(connectionString, { max: 1 });

try {
  console.log("🔄 Running database migrations...");

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const content = readFileSync(filePath, "utf-8");
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
