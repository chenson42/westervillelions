/**
 * Static guards for migration 0113 (Santa's Workshop tables, B-167 increment 2).
 * Migrations replay on every deploy, so the SQL must stay idempotent, and every
 * constraint/index name and shape must equal what drizzle derives from schema.ts
 * (and stay <= 63 characters) or `push --force` reports permanent drift.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  swSessions,
  swOrders,
  swStuffies,
  swStuffyEvents,
  swPhotos,
  swSessionLog,
  swCrewAttempts,
  zeffyEvents,
} from "@/lib/db/schema";

const TABLES: PgTable[] = [
  swSessions,
  swOrders,
  swStuffies,
  swStuffyEvents,
  swPhotos,
  swSessionLog,
  swCrewAttempts,
  zeffyEvents,
];

const dir = join(process.cwd(), "drizzle", "migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_santas_workshop_tables\.sql$/.test(f));
const raw = file ? readFileSync(join(dir, file), "utf8") : "";
const sql = raw
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 0113 (Santa's Workshop tables)", () => {
  it("exists", () => {
    expect(file).toBeTruthy();
  });

  it("creates all eight tables with CREATE TABLE IF NOT EXISTS, and nothing non-idempotent", () => {
    for (const t of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${getTableConfig(t).name} (`);
    }
    expect((sql.match(/CREATE TABLE/gi) ?? []).length).toBe(TABLES.length);
    expect(sql).not.toMatch(/\bADD COLUMN\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
  });

  it("every ADD CONSTRAINT sits behind a pg_constraint guard naming the same constraint", () => {
    const adds = [...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    expect(adds.length).toBeGreaterThan(0);
    for (const name of adds) {
      expect(sql).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${name}'`));
    }
  });

  it("every table name, derived FK name and index name is at most 63 characters", () => {
    for (const t of TABLES) {
      const cfg = getTableConfig(t);
      expect(cfg.name.length).toBeLessThanOrEqual(63);
      for (const fk of cfg.foreignKeys) {
        const name = fk.getName();
        expect(name.length, name).toBeLessThanOrEqual(63);
      }
      for (const ix of cfg.indexes) {
        expect((ix.config.name ?? "").length).toBeLessThanOrEqual(63);
      }
    }
  });

  it("FK names equal what drizzle derives, and the migration adds exactly those FKs with matching ON DELETE", () => {
    const schemaFks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys);
    const migrationNames = [...sql.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]).sort();
    expect(migrationNames).toEqual(schemaFks.map((f) => f.getName()).sort());
    for (const fk of schemaFks) {
      const name = fk.getName();
      expect(fk.onDelete === "cascade" || fk.onDelete === "set null", name).toBe(true);
      const onDelete = fk.onDelete === "cascade" ? "ON DELETE CASCADE" : "ON DELETE SET NULL";
      const block = sql.slice(sql.indexOf(`ADD CONSTRAINT ${name}`));
      expect(block.slice(0, block.indexOf(";"))).toContain(onDelete);
    }
  });

  it("every index in schema.ts exists in the SQL with IF NOT EXISTS, matching uniqueness and partial-ness", () => {
    for (const t of TABLES) {
      const cfg = getTableConfig(t);
      for (const ix of cfg.indexes) {
        const name = ix.config.name!;
        const re = new RegExp(`CREATE ${ix.config.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ON ${cfg.name} \\([^;]*;`);
        const m = sql.match(re);
        expect(m, `${name} missing or wrong uniqueness`).not.toBeNull();
        expect(Boolean(ix.config.where), `${name} partial-ness`).toBe(/\bWHERE\b/.test(m![0]));
      }
    }
  });

  it("the one-current-portrait partial unique index is in both schema.ts and the SQL with its WHERE", () => {
    const ix = getTableConfig(swPhotos).indexes.find((i) => i.config.name === "ux_sw_photos_current");
    expect(ix).toBeDefined();
    expect(ix!.config.unique).toBe(true);
    expect(ix!.config.where).toBeDefined();
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_sw_photos_current ON sw_photos (stuffy_id, kind) WHERE kind IN ('check_in', 'portrait') AND superseded_at IS NULL;",
    );
  });

  it("each remaining partial unique index exists with its WHERE", () => {
    for (const frag of [
      "ux_sw_sessions_zeffy_campaign ON sw_sessions (zeffy_campaign_id) WHERE zeffy_campaign_id IS NOT NULL",
      "ux_sw_orders_payment ON sw_orders (zeffy_payment_id) WHERE zeffy_payment_id IS NOT NULL",
      "ux_sw_stuffies_item ON sw_stuffies (session_id, zeffy_item_key) WHERE zeffy_item_key IS NOT NULL",
      "ux_sw_stuffies_tag ON sw_stuffies (session_id, tag_code) WHERE tag_code IS NOT NULL",
      "ux_sw_stuffies_frame ON sw_stuffies (session_id, frame_number) WHERE frame_number IS NOT NULL",
      "ux_sw_stuffy_events_idem ON sw_stuffy_events (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
    ]) {
      expect(sql).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${frag}`);
    }
  });

  it("every column in schema.ts appears in its CREATE TABLE", () => {
    for (const t of TABLES) {
      const cfg = getTableConfig(t);
      const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${cfg.name} (`);
      const body = sql.slice(start, sql.indexOf(");", start));
      for (const c of cfg.columns) {
        expect(body, `${cfg.name}.${c.name}`).toMatch(new RegExp(`^\\s+${c.name} `, "m"));
      }
    }
  });

  it("sw_photos holds no bytes; no bytea anywhere in the new tables", () => {
    for (const c of getTableConfig(swPhotos).columns) {
      expect(c.getSQLType()).not.toBe("bytea");
    }
    expect(sql).not.toMatch(/\bbytea\b/i);
  });

  it("uses no CHECK constraint and no enum type (text + TypeScript tuples)", () => {
    expect(sql).not.toMatch(/\bCHECK\b/i);
    expect(sql).not.toMatch(/CREATE TYPE/i);
    const schemaSrc = readFileSync(join(process.cwd(), "src/lib/db/schema.ts"), "utf8");
    const part = schemaSrc.slice(schemaSrc.indexOf("export const swSessions"));
    expect(part).not.toMatch(/\bcheck\(/);
    expect(part).not.toMatch(/pgEnum/);
  });

  it("slug, kind and collage_token are NOT NULL; kind has no default (immutable, set at create)", () => {
    const cols = getTableConfig(swSessions).columns;
    for (const n of ["slug", "kind", "collage_token"]) {
      expect(cols.find((c) => c.name === n)!.notNull).toBe(true);
    }
    expect(cols.find((c) => c.name === "kind")!.hasDefault).toBe(false);
  });

  it("session children cascade from the session; the Zeffy log only nulls its session link", () => {
    for (const t of [swOrders, swStuffies, swStuffyEvents, swPhotos, swSessionLog]) {
      const fk = getTableConfig(t).foreignKeys.find((f) => f.reference().foreignTable === swSessions);
      expect(fk, getTableConfig(t).name).toBeDefined();
      expect(fk!.onDelete).toBe("cascade");
    }
    const z = getTableConfig(zeffyEvents).foreignKeys.find((f) => f.reference().foreignTable === swSessions);
    expect(z!.onDelete).toBe("set null");
  });

  it("contains no personal data: no @ sign, no seed token, no INSERT, UPDATE or DELETE statement", () => {
    expect(sql).not.toContain("@");
    expect(sql).not.toContain("{{");
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
