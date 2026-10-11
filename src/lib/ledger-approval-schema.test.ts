import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ledgerTransactions, ledgerTxnCosigns } from "@/lib/db/schema";

/**
 * Static guards for migration 0111 (DECISION-116, rejection attribution).
 * Migrations replay on every deploy, so the SQL must stay idempotent and its FK
 * name must match what drizzle-kit derives, or `push --force` finds a diff.
 */
const MIGRATION = join(process.cwd(), "drizzle/migrations/0111_ledger_rejection_attribution.sql");

function sqlWithoutComments(): string {
  return readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const FK_NAME = "ledger_transactions_rejected_by_user_id_users_id_fk";

describe("migration 0111 (ledger_transactions rejection attribution)", () => {
  it("should add both columns with ADD COLUMN IF NOT EXISTS — regression for a non-idempotent ADD COLUMN failing the next deploy", () => {
    const text = sqlWithoutComments();
    expect(text).toMatch(/ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid\s*;/i);
    expect(text).toMatch(/ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejected_at timestamp\s*;/i);
  });

  it("should add the foreign key only inside a pg_constraint guard", () => {
    const text = sqlWithoutComments();
    expect(text).toMatch(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i);
    expect(text).toMatch(new RegExp(`conname\\s*=\\s*'${FK_NAME}'`));
    const guardIdx = text.search(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i);
    const addIdx = text.indexOf(`ADD CONSTRAINT ${FK_NAME}`);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(guardIdx);
    expect(text.match(/ADD CONSTRAINT/gi)).toHaveLength(1);
  });

  it("should name the FK exactly as drizzle derives it, with ON DELETE SET NULL, so `drizzle-kit push` finds no diff", () => {
    const fk = getTableConfig(ledgerTransactions).foreignKeys.find((f) => f.getName() === FK_NAME);
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe("set null");
    expect(sqlWithoutComments()).toMatch(/REFERENCES users\(id\) ON DELETE SET NULL/i);
  });

  it("should keep both columns nullable with no default in schema.ts", () => {
    const cols = getTableConfig(ledgerTransactions).columns;
    for (const name of ["rejected_by_user_id", "rejected_at"]) {
      const col = cols.find((c) => c.name === name);
      expect(col, name).toBeDefined();
      expect(col!.notNull).toBe(false);
      expect(col!.hasDefault).toBe(false);
    }
  });

  it("should contain no NOT NULL, DEFAULT or UPDATE — no back-fill, no constraint beyond the FK", () => {
    const text = sqlWithoutComments();
    expect(text).not.toMatch(/NOT NULL/i);
    expect(text).not.toMatch(/\bDEFAULT\b/i);
    expect(text).not.toMatch(/\bUPDATE\b/i);
  });
});

/**
 * Static guards for migration 0112 (DECISION-117, ledger_txn_cosigns).
 * Constraint names must equal what drizzle derives (and stay <= 63 chars) or
 * `push --force` reports permanent drift.
 */
const COSIGN_MIGRATION = join(process.cwd(), "drizzle/migrations/0112_ledger_txn_cosigns.sql");
const COSIGN_FK_TXN = "ledger_txn_cosigns_txn_id_ledger_transactions_id_fk";
const COSIGN_FK_USER = "ledger_txn_cosigns_user_id_users_id_fk";
const COSIGN_UNIQUE = "ledger_txn_cosigns_txn_user_key";

function cosignSql(): string {
  return readFileSync(COSIGN_MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("migration 0112 (ledger_txn_cosigns)", () => {
  const cfg = getTableConfig(ledgerTxnCosigns);

  it("should name every constraint as drizzle derives it, within 63 chars, and guard each in the SQL", () => {
    const names = [
      ...cfg.foreignKeys.map((f) => f.getName()),
      ...cfg.uniqueConstraints.map((u) => u.name as string),
    ];
    expect(names.sort()).toEqual([COSIGN_FK_TXN, COSIGN_FK_USER, COSIGN_UNIQUE].sort());
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(63);
      expect(cosignSql()).toMatch(new RegExp(`conname\\s*=\\s*'${n}'`));
    }
  });

  it("should make the unique constraint exactly (txn_id, user_id)", () => {
    const u = cfg.uniqueConstraints.find((c) => c.name === COSIGN_UNIQUE);
    expect(u!.columns.map((c) => c.name)).toEqual(["txn_id", "user_id"]);
    expect(cosignSql()).toMatch(/UNIQUE \(txn_id, user_id\)/i);
  });

  it("should cascade on txn_id, set null on user_id, and keep user_id nullable", () => {
    const fkTxn = cfg.foreignKeys.find((f) => f.getName() === COSIGN_FK_TXN);
    const fkUser = cfg.foreignKeys.find((f) => f.getName() === COSIGN_FK_USER);
    expect(fkTxn!.onDelete).toBe("cascade");
    expect(fkUser!.onDelete).toBe("set null");
    expect(cfg.columns.find((c) => c.name === "user_id")!.notNull).toBe(false);
    expect(cfg.columns.find((c) => c.name === "txn_id")!.notNull).toBe(true);
    expect(cosignSql()).toMatch(/ON DELETE CASCADE/i);
    expect(cosignSql()).toMatch(/ON DELETE SET NULL/i);
  });

  it("should have exactly the columns id, txn_id, user_id, cosigned_at — no kind, minute, amount, fund or entity", () => {
    expect(cfg.columns.map((c) => c.name).sort()).toEqual(["cosigned_at", "id", "txn_id", "user_id"]);
  });

  it("should be CREATE TABLE IF NOT EXISTS with all three constraints in guarded blocks and no data writes", () => {
    const text = cosignSql();
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS ledger_txn_cosigns/i);
    expect(text.match(/ADD CONSTRAINT/gi)).toHaveLength(3);
    expect(text.match(/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/gi)).toHaveLength(3);
    expect(text).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM\b/i);
  });
});
