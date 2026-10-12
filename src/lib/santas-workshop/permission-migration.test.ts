/**
 * Pins migration 0114 (santas_workshop.manage, DECISION-121). Found by slug, not number.
 * Seeded defaults only; a runtime grant is invisible here.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_DESCRIPTIONS, FEATURES } from "@/lib/permissions";

const dir = join(process.cwd(), "drizzle", "migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_santas_workshop_permission\.sql$/.test(f));
const sql = file
  ? readFileSync(join(dir, file), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
  : "";

const KEY = FEATURES.SANTAS_WORKSHOP_MANAGE;
const DESC = FEATURE_DESCRIPTIONS[KEY];

function bind(role: string) {
  return new RegExp(`WHERE r\\.name = '${role}' AND f\\.name = 'santas_workshop\\.manage'\\s+AND NOT EXISTS`).test(sql);
}

describe("santas_workshop.manage permission migration", () => {
  it("exists, after the tables migration", () => {
    expect(file).toBeTruthy();
    const tables = readdirSync(dir).find((f) => /^\d{4}_santas_workshop_tables\.sql$/.test(f));
    expect(tables).toBeTruthy();
    expect(file!.slice(0, 4) > tables!.slice(0, 4)).toBe(true);
  });

  it("key and category", () => {
    expect(KEY).toBe("santas_workshop.manage");
    expect(sql).toContain("SELECT 'santas_workshop.manage', 'santas_workshop',");
  });

  it("inserts the feature once, guarded, with a description byte-identical to FEATURE_DESCRIPTIONS", () => {
    expect((sql.match(/INSERT INTO features/g) ?? []).length).toBe(1);
    expect(sql).toContain(`'${DESC}'\n  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'santas_workshop.manage')`);
    expect(sql).toContain(
      `UPDATE features SET description = '${DESC}'\nWHERE name = 'santas_workshop.manage' AND description IS DISTINCT FROM '${DESC}'`,
    );
    expect(DESC).not.toContain("'");
  });

  it("binds admin and board_member with the CROSS JOIN + NOT EXISTS idiom, and nothing else", () => {
    expect(bind("admin")).toBe(true);
    expect(bind("board_member")).toBe(true);
    expect((sql.match(/INSERT INTO role_features/g) ?? []).length).toBe(2);
    expect(sql).not.toMatch(/treasurer|'member'|admin\.users|admin\.roles/);
  });

  it("contains no DELETE, no @ sign, no seed token", () => {
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toContain("@");
    expect(sql).not.toContain("{{");
  });
});
