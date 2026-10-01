import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ledgerAcknowledgments } from "@/lib/db/schema";

/**
 * Static guards for migration 0109 (DECISION-112). Migrations replay on EVERY
 * deploy, so the backfill must only ever fill NULL rows: a backfill that
 * restamped a moved acknowledgment from its transaction's CURRENT entity would
 * re-issue a Foundation receipt as the Club's. The live replay check is in the
 * Phase 5 work-log; these tests keep the SQL from drifting back into that shape.
 */
const MIGRATION = join(process.cwd(), "drizzle/migrations/0109_ledger_ack_donee_entity.sql");

function sqlWithoutComments(): string {
  return readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migration 0109 (ledger_acknowledgments.donee_entity_id)", () => {
  it("should add the column idempotently — regression for a non-idempotent ADD COLUMN failing the next deploy", () => {
    expect(sqlWithoutComments()).toMatch(
      /ALTER TABLE ledger_acknowledgments ADD COLUMN IF NOT EXISTS donee_entity_id uuid\s*;/i,
    );
  });

  it("should only ever backfill rows whose donee_entity_id IS NULL — regression for a replay restamping a moved receipt with the Club", () => {
    const text = sqlWithoutComments();
    const updates = text.match(/UPDATE\s+ledger_acknowledgments[\s\S]*?;/gi) ?? [];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/WHERE[\s\S]*\ba\.donee_entity_id\s+IS\s+NULL/i);
  });

  it("should backfill with a SET list of donee_entity_id alone, never touching updated_at (a backfill is not an edit)", () => {
    const update = sqlWithoutComments().match(/UPDATE\s+ledger_acknowledgments[\s\S]*?;/i)?.[0] ?? "";
    const setClause = update.match(/SET([\s\S]*?)FROM/i)?.[1] ?? "";

    expect(setClause.trim()).toBe("donee_entity_id = t.entity_id");
    expect(setClause).not.toMatch(/updated_at/i);
  });

  it("should add the foreign key only when absent, under the exact name drizzle derives from schema.ts, so `drizzle-kit push` finds no diff", () => {
    const fks = getTableConfig(ledgerAcknowledgments).foreignKeys;
    const names = fks.map((fk) => fk.getName());
    const text = sqlWithoutComments();

    const derived = "ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk";
    expect(names).toContain(derived);
    expect(text).toMatch(new RegExp(`conname\\s*=\\s*'${derived}'`));
    expect(text).toMatch(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i);
    expect(text).toContain(`ADD CONSTRAINT ${derived}`);
  });

  it("should keep the column nullable and cascade-free in schema.ts, matching the migration's plain REFERENCES", () => {
    const col = getTableConfig(ledgerAcknowledgments).columns.find((c) => c.name === "donee_entity_id");
    const fk = getTableConfig(ledgerAcknowledgments)
      .foreignKeys.map((f) => f.reference())
      .find((r) => r.columns.some((c) => c.name === "donee_entity_id"));

    expect(col).toBeDefined();
    expect(col!.notNull).toBe(false);
    expect(fk?.foreignTable && getTableConfig(fk.foreignTable).name).toBe("ledger_entities");
    expect(sqlWithoutComments()).not.toMatch(/ON DELETE/i);
    expect(sqlWithoutComments()).not.toMatch(/SET NOT NULL/i);
  });
});
