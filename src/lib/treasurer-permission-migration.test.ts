import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { FEATURE_DESCRIPTIONS, FEATURES } from "@/lib/permissions";

// Pins migration NNNN_treasurer_permission_baseline.sql (DECISION-115). Found
// by slug, not number. Seeded defaults only; a runtime grant is invisible here.
const dir = join(process.cwd(), "drizzle", "migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_treasurer_permission_baseline\.sql$/.test(f));
const sql = file
  ? readFileSync(join(dir, file), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
  : "";

const LM = FEATURE_DESCRIPTIONS[FEATURES.LEDGER_MANAGE];
const EQ = FEATURE_DESCRIPTIONS[FEATURES.EMAIL_QUEUE_MANAGE];

function bind(role: string, feature: string) {
  const re = new RegExp(
    `WHERE r\\.name = '${role}' AND f\\.name = '${feature.replace(".", "\\.")}'\\s+AND NOT EXISTS`,
  );
  return re.test(sql);
}

describe("treasurer permission baseline migration", () => {
  it("exists", () => {
    expect(file).toBeTruthy();
  });

  it("inserts the email_queue.manage feature row once, guarded, with category email_queue and a description byte-identical to FEATURE_DESCRIPTIONS", () => {
    const m = sql.match(/INSERT INTO features/g) ?? [];
    expect(m).toHaveLength(1);
    expect(sql).toContain(
      `SELECT 'email_queue.manage', 'email_queue',\n    '${EQ}'\n  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'email_queue.manage')`,
    );
  });

  it("updates the ledger.manage description to the FEATURE_DESCRIPTIONS text behind an IS DISTINCT FROM guard", () => {
    expect(sql).toContain(
      `UPDATE features SET description = '${LM}'\nWHERE name = 'ledger.manage' AND description IS DISTINCT FROM '${LM}'`,
    );
    expect(sql).toContain(
      `UPDATE features SET description = '${EQ}'\nWHERE name = 'email_queue.manage' AND description IS DISTINCT FROM '${EQ}'`,
    );
  });

  it("binds ledger.manage to treasurer and email_queue.manage to admin and treasurer with the NOT EXISTS idiom", () => {
    expect(bind("treasurer", "ledger.manage")).toBe(true);
    expect(bind("admin", "email_queue.manage")).toBe(true);
    expect(bind("treasurer", "email_queue.manage")).toBe(true);
    expect((sql.match(/INSERT INTO role_features/g) ?? []).length).toBe(3);
  });

  it("does not inherit from admin.users (transitional any-of gate instead) and binds nothing to budget_committee", () => {
    expect(sql).not.toContain("admin.users");
    expect(sql).not.toContain("budget_committee");
  });

  it("contains no DELETE, no @ sign, no {{ token}}", () => {
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toContain("@");
    expect(sql).not.toContain("{{");
  });

  it("keeps the mirrored descriptions apostrophe-free", () => {
    expect(LM).not.toContain("'");
    expect(EQ).not.toContain("'");
  });
});
