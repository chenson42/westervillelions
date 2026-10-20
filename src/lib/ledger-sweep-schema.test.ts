import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ledgerTransactions, ledgerSweepCloseouts } from "@/lib/db/schema";

/**
 * Static guards for migration 0116 (B-172 Inc 2a, DECISION-126/127). Migrations
 * replay on every deploy, so each statement must be idempotent and the one data
 * statement (the inactive "Transfer to Foundation" category) must never touch an
 * existing row.
 */
const dir = join(process.cwd(), "drizzle/migrations");
const MIG = "0116_ledger_sweep_batches.sql";
const text = readFileSync(join(dir, MIG), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const FKS = [
  { name: "ledger_txn_swept_from_fk", ref: "ledger_transactions(id)", action: "RESTRICT" },
  { name: "ledger_txn_sweep_leg_fk", ref: "ledger_transactions(id)", action: "RESTRICT" },
  { name: "ledger_sweep_closeouts_txn_fk", ref: "ledger_transactions(id)", action: "CASCADE" },
  { name: "ledger_sweep_closeouts_user_fk", ref: "users(id)", action: "SET NULL" },
];

describe("migration 0116 (itemized sweep batches)", () => {
  it("should be the highest-numbered migration", () => {
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files[files.length - 1]).toBe(MIG);
    expect(existsSync(join(dir, MIG))).toBe(true);
  });

  it("should add both pointer columns idempotently, nullable, no default — regression for a non-idempotent ADD COLUMN failing a deploy", () => {
    expect(text).toMatch(/ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS swept_from_txn_id uuid;/);
    expect(text).toMatch(/ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS sweep_leg_txn_id uuid;/);
    const cols = getTableConfig(ledgerTransactions).columns;
    for (const n of ["swept_from_txn_id", "sweep_leg_txn_id"]) {
      const c = cols.find((x) => x.name === n);
      expect(c?.notNull).toBe(false);
      expect(c?.hasDefault).toBe(false);
    }
  });

  it("should add each FK only inside its own pg_constraint guard, with the exact name, target and ON DELETE action", () => {
    for (const fk of FKS) {
      expect(fk.name.length).toBeLessThanOrEqual(63);
      const re = new RegExp(
        `IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${fk.name}'\\) THEN([\\s\\S]*?)END IF;`,
      );
      const body = text.match(re)?.[1] ?? "";
      expect(body, fk.name).toContain(`ADD CONSTRAINT ${fk.name}`);
      expect(body, fk.name).toContain(`REFERENCES ${fk.ref} ON DELETE ${fk.action}`);
    }
    expect(text.match(/ADD CONSTRAINT/g)).toHaveLength(FKS.length);
  });

  it("should declare the same FK names and actions in schema.ts", () => {
    const tx = getTableConfig(ledgerTransactions).foreignKeys;
    for (const n of ["ledger_txn_swept_from_fk", "ledger_txn_sweep_leg_fk"]) {
      expect(tx.find((f) => f.getName() === n)?.onDelete, n).toBe("restrict");
    }
    const co = getTableConfig(ledgerSweepCloseouts).foreignKeys;
    expect(co.find((f) => f.getName() === "ledger_sweep_closeouts_txn_fk")?.onDelete).toBe("cascade");
    expect(co.find((f) => f.getName() === "ledger_sweep_closeouts_user_fk")?.onDelete).toBe("set null");
  });

  it("should create the unique partial index over non-rejected copies, equal in the migration and schema.ts", () => {
    expect(text).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_txn_swept_from_live\s+ON ledger_transactions \(swept_from_txn_id\)\s+WHERE swept_from_txn_id IS NOT NULL AND status <> 'rejected';/,
    );
    const idx = getTableConfig(ledgerTransactions).indexes.find((i) => i.config.name === "ux_ledger_txn_swept_from_live");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(["swept_from_txn_id"]);
    expect(idx?.config.where).toBeDefined();
    const src = readFileSync(join(process.cwd(), "src/lib/db/schema.ts"), "utf8");
    expect(src).toContain("`${t.sweptFromTxnId} IS NOT NULL AND ${t.status} <> 'rejected'`");
  });

  it("should create the plain partial leg index", () => {
    expect(text).toMatch(
      /CREATE INDEX IF NOT EXISTS ix_ledger_txn_sweep_leg\s+ON ledger_transactions \(sweep_leg_txn_id\)\s+WHERE sweep_leg_txn_id IS NOT NULL;/,
    );
    const idx = getTableConfig(ledgerTransactions).indexes.find((i) => i.config.name === "ix_ledger_txn_sweep_leg");
    expect(idx?.config.unique).toBeFalsy();
    expect(idx?.config.where).toBeDefined();
  });

  it("should create the closeouts table idempotently with the txn id as primary key", () => {
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS ledger_sweep_closeouts \(/);
    expect(text).toMatch(/txn_id uuid PRIMARY KEY,/);
    expect(text).toMatch(/reason text NOT NULL,/);
    expect(text).toMatch(/closed_by_user_id uuid,/);
    expect(text).toMatch(/closed_at timestamp NOT NULL DEFAULT now\(\)/);
    const cfg = getTableConfig(ledgerSweepCloseouts);
    const byName = (n: string) => cfg.columns.find((c) => c.name === n);
    expect(byName("txn_id")?.primary).toBe(true);
    expect(byName("reason")?.notNull).toBe(true);
    expect(byName("closed_by_user_id")?.notNull).toBe(false);
    expect(byName("closed_at")?.notNull).toBe(true);
  });

  it("should have the category seed as the only INSERT, WHERE NOT EXISTS, inactive and by name", () => {
    expect(text.match(/\bINSERT\s+INTO\b/gi)).toHaveLength(1);
    const ins = text.match(/INSERT INTO ledger_categories[\s\S]*?;/)?.[0] ?? "";
    expect(ins).toContain("'Transfer to Foundation'");
    expect(ins).toMatch(/'activity', 'expense', 'Transfer to Foundation', false, false, false,/);
    expect(ins).toMatch(/e\.slug = 'club'/);
    expect(ins).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM ledger_categories c\s+WHERE c\.entity_id = e\.id\s+AND c\.fund_kind = 'activity'\s+AND c\.flow = 'expense'\s+AND c\.name = 'Transfer to Foundation'/);
  });

  it("should never UPDATE or DELETE a row, and contain no email address or person", () => {
    expect(text).not.toMatch(/\bUPDATE\b/i);
    expect(text).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(text).not.toMatch(/\bDROP\b/i);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
    expect(text).not.toMatch(/\{\{/);
  });
});
