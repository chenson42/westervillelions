/**
 * Regression for the Budgeting overview kind badge (B-172 Increment 1 Phase 5, S2).
 *
 * `fund-name-literal-scan.test.ts` looks for the literal word "Activity" in source,
 * so it cannot see a raw fund KIND that is capitalised at run time:
 * `kind.charAt(0).toUpperCase() + kind.slice(1)` printed "Activity" beside the
 * renamed fund heading on /admin/ledger/budgeting and its drill-down, a surface
 * the scan passed and the rename check (S2, expected 0 "Activity") caught.
 *
 * DECISION-127 ruling 9: a kind badge is `fundKindBadge(kind)` ("Public" for the
 * `activity` kind), never the kind string with its first letter raised. This scan
 * fails on that capitalise-the-kind shape anywhere in the ledger surfaces, and on a
 * raw `{...kind}` printed as JSX text.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const ROOTS = ["components/admin/ledger", "app/(dashboard)/admin/ledger", "components/members", "app/members"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const CAPITALISED_KIND = /\b\w*[kK]ind\s*\.\s*charAt\(\s*0\s*\)\s*\.\s*toUpperCase\(\)/;
const RAW_KIND_JSX_TEXT = /\{\s*[\w.]*\b(?:fundKind|kind)\s*\}\s*(?:fund\b|<)/;

describe("fund kind badges never print the raw kind", () => {
  const files = ROOTS.flatMap((r) => walk(path.join(SRC, r)));

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("should not capitalise a fund kind string for display — regression for the Budgeting overview 'Activity' badge", () => {
    const offenders = files
      .filter((f) => CAPITALISED_KIND.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it("should not print a raw fund kind as JSX text", () => {
    const offenders = files
      .filter((f) => RAW_KIND_JSX_TEXT.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it("negative control: both patterns catch the shapes they exist for", () => {
    expect(CAPITALISED_KIND.test("return kind.charAt(0).toUpperCase() + kind.slice(1);")).toBe(true);
    expect(CAPITALISED_KIND.test("fundKind.charAt(0).toUpperCase()")).toBe(true);
    expect(CAPITALISED_KIND.test("name.charAt(0).toUpperCase()")).toBe(false);
    expect(RAW_KIND_JSX_TEXT.test("<span>{fund.kind} fund</span>")).toBe(true);
    expect(RAW_KIND_JSX_TEXT.test("<span>{fundKind}</span>")).toBe(true);
    expect(RAW_KIND_JSX_TEXT.test("<span>{fundKindBadge(kind)}</span>")).toBe(false);
  });
});
