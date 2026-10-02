/**
 * Source scan: BUDGET_WRITE_FEATURES is the ONE spelling of the budget-family
 * write gate (DECISION-115, Y9). The literal pair [LEDGER_MANAGE, BUDGET_EDIT]
 * had been spelled nine times in routes plus twice in pages' `canManage`, and
 * "+ Add category" drifted away from its route. If this fails, replace the
 * inline array with BUDGET_WRITE_FEATURES from "@/lib/permissions".
 *
 * Scope: non-test source under src/app/api/admin/ledger and
 * src/app/(dashboard)/admin/ledger. Multi-line aware (arrays wrapped by
 * prettier), either member order, optional trailing comma.
 *
 * What it does NOT prove: that an arbitrary inline `canManage` boolean in JSX
 * matches the fetch() a button triggers. That is the Phase 5 persona
 * click-through.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUDGET_WRITE_FEATURES, FEATURES } from "./permissions";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app/api/admin/ledger", "src/app/(dashboard)/admin/ledger"];

const INLINE_PAIR =
  /\[\s*(?:FEATURES\.LEDGER_MANAGE\s*,\s*FEATURES\.BUDGET_EDIT|FEATURES\.BUDGET_EDIT\s*,\s*FEATURES\.LEDGER_MANAGE)\s*,?\s*\]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("BUDGET_WRITE_FEATURES is the only spelling of the budget write gate", () => {
  it("the constant is exactly [LEDGER_MANAGE, BUDGET_EDIT]", () => {
    expect([...BUDGET_WRITE_FEATURES]).toEqual([FEATURES.LEDGER_MANAGE, FEATURES.BUDGET_EDIT]);
  });

  it("the scanner catches wrapped, reordered and trailing-comma spellings (negative control)", () => {
    expect(INLINE_PAIR.test("[FEATURES.LEDGER_MANAGE, FEATURES.BUDGET_EDIT]")).toBe(true);
    expect(INLINE_PAIR.test("[\n    FEATURES.LEDGER_MANAGE,\n    FEATURES.BUDGET_EDIT,\n  ]")).toBe(true);
    expect(INLINE_PAIR.test("[FEATURES.BUDGET_EDIT, FEATURES.LEDGER_MANAGE]")).toBe(true);
    // The four-item page admission list is a different decision and must not match.
    expect(
      INLINE_PAIR.test(
        "[\n FEATURES.LEDGER_MANAGE,\n FEATURES.LEDGER_APPROVE,\n FEATURES.BUDGET_VIEW,\n FEATURES.BUDGET_EDIT,\n]",
      ),
    ).toBe(false);
  });

  it("no ledger route or admin page spells [LEDGER_MANAGE, BUDGET_EDIT] inline", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20);

    const offenders = files.filter((f) => INLINE_PAIR.test(readFileSync(f, "utf8")));

    expect(offenders.map((f) => f.replace(ROOT + "/", ""))).toEqual([]);
  });
});
