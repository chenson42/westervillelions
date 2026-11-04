/**
 * Static guards for migration 0117 (Santa's Workshop scenes, DECISION-128): the SQL must stay
 * idempotent and match schema.ts (columns, index, both foreign keys with their names and ON DELETE).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { swPhotos, swScenes } from "@/lib/db/schema";

const sql = readFileSync(join(process.cwd(), "drizzle", "migrations", "0117_santas_workshop_scenes.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("the scenes migration is idempotent and matches schema.ts", () => {
  it("creates the table and the column only with IF NOT EXISTS, and drops nothing", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS sw_scenes (");
    expect(sql).toContain("ALTER TABLE sw_photos ADD COLUMN IF NOT EXISTS scene_id uuid;");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i);
    expect(sql).not.toMatch(/\bCHECK\b/i); // push --force would drop a constraint schema.ts does not declare
  });

  it("every sw_scenes column in schema.ts is in the CREATE TABLE", () => {
    const start = sql.indexOf("CREATE TABLE IF NOT EXISTS sw_scenes (");
    const body = sql.slice(start, sql.indexOf(");", start));
    for (const c of getTableConfig(swScenes).columns) expect(body, c.name).toMatch(new RegExp(`^\\s+${c.name} `, "m"));
  });

  it("the index exists with IF NOT EXISTS on (session_id, position)", () => {
    const ix = getTableConfig(swScenes).indexes.map((i) => i.config.name);
    expect(ix).toEqual(["ix_sw_scenes_session_position"]);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS ix_sw_scenes_session_position ON sw_scenes (session_id, position);");
  });

  it("both FK names equal what drizzle derives, sit behind pg_constraint guards, and carry the right ON DELETE", () => {
    const fks = [
      ...getTableConfig(swScenes).foreignKeys,
      ...getTableConfig(swPhotos).foreignKeys.filter((f) => f.getName() === "sw_photos_scene_id_sw_scenes_id_fk"),
    ];
    const expected: Record<string, string> = {
      sw_scenes_session_id_sw_sessions_id_fk: "ON DELETE CASCADE",
      sw_photos_scene_id_sw_scenes_id_fk: "ON DELETE SET NULL",
    };
    expect(fks.map((f) => f.getName()).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, onDelete] of Object.entries(expected)) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(sql).toMatch(new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conname = '${name}'`));
      const block = sql.slice(sql.indexOf(`ADD CONSTRAINT ${name}`));
      expect(block.slice(0, block.indexOf(";"))).toContain(onDelete);
    }
  });

  it("schema.ts declares scene_id as a nullable uuid", () => {
    const col = getTableConfig(swPhotos).columns.find((c) => c.name === "scene_id");
    expect(col?.notNull).toBe(false);
    expect(col?.getSQLType()).toBe("uuid");
  });
});
