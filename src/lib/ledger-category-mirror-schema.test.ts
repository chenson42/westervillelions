import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ledgerCategories } from "@/lib/db/schema";

/**
 * Static guards for migration 0115 (B-172 Inc 1, DECISION-126/127). Migrations
 * replay on every deploy, so the mirror seed must be one-shot: a plain by-name
 * UPDATE would re-link a pair the treasurer deliberately cleared.
 */
const dir = join(process.cwd(), "drizzle/migrations");
function strip(file: string): string {
  return readFileSync(join(dir, file), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const MIG = "0115_ledger_category_mirrors.sql";
const FK = "ledger_categories_mirror_fk";

describe("migration 0115 (ledger_categories.mirrors_category_id)", () => {
  const text = strip(MIG);

  it("should add the column idempotently, nullable with no default — regression for a non-idempotent ADD COLUMN failing a deploy", () => {
    expect(text).toMatch(/ALTER TABLE ledger_categories ADD COLUMN IF NOT EXISTS mirrors_category_id uuid;/i);
  });

  it("should add the FK only inside a pg_constraint guard, ON DELETE SET NULL", () => {
    const guard = text.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = '([^']+)'\s*\) THEN([\s\S]*?)END IF;/i);
    expect(guard?.[1]).toBe(FK);
    expect(guard?.[2]).toMatch(/ADD CONSTRAINT ledger_categories_mirror_fk/);
    expect(guard?.[2]).toMatch(/ON DELETE SET NULL/);
  });

  it("should name the FK identically in schema.ts and the migration, within 63 characters, set null", () => {
    expect(FK.length).toBeLessThanOrEqual(63);
    const fks = getTableConfig(ledgerCategories).foreignKeys;
    const mirror = fks.find((f) => f.getName() === FK);
    expect(mirror).toBeDefined();
    expect(mirror?.onDelete).toBe("set null");
  });

  it("should declare the column nullable without default in schema.ts", () => {
    const col = getTableConfig(ledgerCategories).columns.find((c) => c.name === "mirrors_category_id");
    expect(col?.notNull).toBe(false);
    expect(col?.hasDefault).toBe(false);
  });

  it("should run the seed in one DO block guarded by the audit marker NOT EXISTS and write the marker in that block — regression for re-linking a cleared pair on replay", () => {
    const blocks = text.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? [];
    const seed = blocks.filter((b) => /UPDATE\s+ledger_categories/i.test(b));
    expect(seed).toHaveLength(1);
    expect(seed[0]).toMatch(/IF NOT EXISTS \(SELECT 1 FROM ledger_audit_log WHERE action = 'category_mirrors_seeded'\)/);
    expect(seed[0]).toMatch(/INSERT INTO ledger_audit_log[\s\S]*'category_mirrors_seeded'/);
    expect(text.match(/UPDATE\s+ledger_categories/gi)).toHaveLength(1);
  });

  it("should only fill rows whose mirror is still NULL", () => {
    expect(text).toMatch(/c\.mirrors_category_id IS NULL/);
  });

  it("should seed exactly Public donations and White Cane, and no contested pair", () => {
    const list = text.match(/IN \(([^)]*)\)/i)?.[1] ?? "";
    const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names).toEqual(["public donations", "white cane"]);
    for (const n of ["Rudolph Run", "Pancake Breakfast", "Sponsorships", "Interest"]) {
      expect(text).not.toContain(n);
    }
  });

  it("should neither create Transfer to Foundation nor contain an email address", () => {
    expect(text).not.toMatch(/Transfer to Foundation/i);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });
});

describe("migration 0044 fresh-install fund literal", () => {
  it("should seed the activity fund as 'Public Funds', still guarded by NOT EXISTS", () => {
    const text = strip("0044_ledger_books.sql");
    const insert = text.match(/INSERT INTO ledger_funds[^;]*'activity', '[^']*', 'activity'[^;]*;/)?.[0] ?? "";
    expect(insert).toContain("'activity', 'Public Funds', 'activity'");
    expect(insert).toMatch(/NOT EXISTS/);
    expect(text).not.toContain("Activity Fund");
  });
});
