/**
 * Seeded default role bundles, computed by PARSING the migrations
 * (DECISION-115, B-111). Test file only, on purpose: a TS constant of "what the
 * migrations seed" would be a second hand-kept list (the DECISION-082 failure).
 * The migrations are what runs in production, and no migration contains a
 * `DELETE FROM role_features`, so the union of binds equals the seeded state
 * (a test below asserts that premise so it cannot rot).
 *
 * The parser reads the canonical idiom
 *   ... WHERE r.name = 'ROLE' AND f.name = 'FEATURE' AND NOT EXISTS (...);
 * and FAILS LOUDLY on any role_features insert it cannot read that mentions
 * 'treasurer' or 'budget_committee', so a new idiom cannot silently exempt
 * itself ("extend the parser"). The only non-canonical inserts today are the
 * bulk `admin` / `IN (...)` binds in 0002, which name neither watched role.
 *
 * What it asserts:
 *  - the parser is alive; every bound feature literal exists in FEATURES (an
 *    INSERT ... SELECT with a misspelt feature inserts zero rows and succeeds,
 *    so this class is otherwise invisible);
 *  - B1: the treasurer bundle satisfies every "Treasury" nav item, except
 *    Approvals, which needs board_member (ledger.approve is deliberately not on
 *    treasurer) and is satisfied by treasurer + board_member;
 *  - B2: treasurer holds no admin.* key, club_files.manage or
 *    welcome_packet.manage (a holder of admin.users/admin.roles can grant
 *    itself admin);
 *  - B3: budget_committee satisfies BUDGET_WRITE_FEATURES (Y9).
 *
 * What it CANNOT see: a runtime grant or revoke at /admin/permissions, and an
 * inline control gate in JSX versus the route it calls.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAVIGATION, BUDGET_WRITE_FEATURES, FEATURES } from "./permissions";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const sources = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), "utf8")) }));

interface Parsed {
  binds: Array<{ role: string; feature: string; file: string }>;
  unreadable: Array<{ file: string; statement: string }>;
  total: number;
}

function parseRoleFeatureInserts(): Parsed {
  const out: Parsed = { binds: [], unreadable: [], total: 0 };
  for (const { file, sql } of sources) {
    const statements = sql.match(/INSERT\s+INTO\s+role_features\b[\s\S]*?;/gi) ?? [];
    for (const statement of statements) {
      out.total++;
      const roles = [...statement.matchAll(/\br\.name\s*=\s*'([^']+)'/g)].map((m) => m[1]);
      const features = [...statement.matchAll(/\bf\.name\s*=\s*'([^']+)'/g)].map((m) => m[1]);
      if (roles.length === 1 && features.length === 1 && !/\bIN\s*\(/i.test(statement)) {
        out.binds.push({ role: roles[0], feature: features[0], file });
      } else {
        out.unreadable.push({ file, statement });
      }
    }
  }
  return out;
}

const parsed = parseRoleFeatureInserts();

function bundle(role: string): Set<string> {
  return new Set(parsed.binds.filter((b) => b.role === role).map((b) => b.feature));
}

function satisfies(held: Set<string>, required: string | string[] | undefined): boolean {
  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((f) => held.has(f));
}

describe("default role bundles parsed from migrations", () => {
  it("the parser is alive: known pairs are found and most statements are canonical", () => {
    const has = (role: string, feature: string) => bundle(role).has(feature);
    expect(has("treasurer", "ledger.record")).toBe(true);
    expect(has("treasurer", "ledger.report_send")).toBe(true);
    expect(has("treasurer", "ledger.manage")).toBe(true); // migration 0110
    expect(has("board_member", "ledger.approve")).toBe(true);
    expect(parsed.binds.length).toBeGreaterThanOrEqual(50);
    expect(parsed.total).toBeGreaterThanOrEqual(parsed.binds.length);
  });

  it("an unreadable role_features insert may not mention treasurer or budget_committee (extend the parser)", () => {
    const hidden = parsed.unreadable.filter((u) => /'(?:treasurer|budget_committee)'/.test(u.statement));
    expect(
      hidden.map((u) => u.file),
      "a role_features insert that mentions treasurer or budget_committee is not in the canonical idiom: extend the parser in default-role-bundles.test.ts",
    ).toEqual([]);
  });

  it("no migration deletes role_features, so the union of binds equals the seeded state", () => {
    const deleting = sources.filter((s) => /DELETE\s+FROM\s+role_features/i.test(s.sql)).map((s) => s.file);
    expect(deleting).toEqual([]);
  });

  it("every feature literal bound in a migration exists in FEATURES (a misspelling inserts zero rows silently)", () => {
    const known = new Set<string>(Object.values(FEATURES));
    const unknown = [...new Set(parsed.binds.map((b) => b.feature))].filter((f) => !known.has(f));
    expect(unknown).toEqual([]);
  });

  it("B1: the treasurer bundle satisfies every Treasury nav item except /admin/ledger/approvals, which treasurer + board_member satisfies", () => {
    const treasury = ADMIN_NAVIGATION.find((g) => g.label === "Treasury");
    expect(treasury, "the Treasury nav group was renamed: update this test").toBeDefined();
    const items = treasury!.items;
    expect(items.some((i) => i.href === "/admin/ledger/approvals")).toBe(true);

    const treasurer = bundle("treasurer");
    const combined = new Set([...treasurer, ...bundle("board_member")]);

    const unmet = items
      .filter((i) => i.href !== "/admin/ledger/approvals")
      .filter((i) => !satisfies(treasurer, i.requiredFeature))
      .map((i) => `${i.name} (${i.href})`);
    expect(unmet).toEqual([]);

    const approvals = items.find((i) => i.href === "/admin/ledger/approvals")!;
    expect(satisfies(treasurer, approvals.requiredFeature)).toBe(false); // deliberately board-only
    expect(satisfies(combined, approvals.requiredFeature)).toBe(true);
  });

  it("B2: the treasurer bundle holds no admin.* key, club_files.manage or welcome_packet.manage", () => {
    const forbidden = [...bundle("treasurer")].filter(
      (f) => f.startsWith("admin.") || f === FEATURES.CLUB_FILES_MANAGE || f === FEATURES.WELCOME_PACKET_MANAGE,
    );
    expect(forbidden).toEqual([]);
  });

  it("B3: the budget_committee bundle satisfies BUDGET_WRITE_FEATURES (Y9: create a category from the budgeting page)", () => {
    expect(satisfies(bundle("budget_committee"), [...BUDGET_WRITE_FEATURES])).toBe(true);
  });

  it("negative control: the satisfaction check fails for a bundle missing the key", () => {
    expect(satisfies(new Set(["ledger.view"]), [...BUDGET_WRITE_FEATURES])).toBe(false);
  });
});
