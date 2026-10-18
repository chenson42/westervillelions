/**
 * DECISION-127: the Club's public fund is displayed by its STORED name
 * ("Public Funds" by default, whatever the treasurer renames it to). No ledger
 * surface may hard-code the old name. This scan fails on a capital-A
 * `Activity` outside comments (lowercase "activity" in "Cleared activity" is
 * unaffected) and, on member surfaces, a case-insensitive `activity fund`.
 *
 * Test files are exempt (they are stored-name fixtures). The allowlist below
 * is empty: the UI conversion finished (B-172 Increment 1). A new entry needs a
 * reason and a dated owner; the stale-entry test fails when a listed file is clean.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

/**
 * Empty by design. An entry would carry its reason; the "allowlist entries are
 * still dirty" test fails on a stale entry so the list cannot rot.
 */
export const ALLOWLIST: Record<string, string> = {};

const LEDGER_ROOTS = [
  "components/admin/ledger",
  "app/(dashboard)/admin/ledger",
  "app/api/admin/ledger",
];
const LEDGER_LIB_PREFIXES = ["ledger", "financial-report"];
const MEMBER_ROOTS = ["app/members", "components/members"];

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

/** Remove // and block comments while keeping string and template contents. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      // A ' or " in JSX text (an apostrophe) never closes: end at the line.
      if (c === quote || (quote !== "`" && c === "\n")) quote = null;
      i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && source[i - 1] !== ":") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
    i += 1;
  }
  return out;
}

const CAPITAL_ACTIVITY = /\bActivity\b/;
const ACTIVITY_FUND = /activity funds?\b/i;
/** The stored default fund name; only `ledger-fund-labels.ts` may spell it in code. */
const PUBLIC_FUNDS_LITERAL = /\bPublic Funds\b/;
const LABELS_MODULE = "lib/ledger-fund-labels.ts";
const RAW_KIND_FUND = /\{fund\.kind\} fund/;

function isDirty(file: string): boolean {
  const code = stripComments(readFileSync(path.join(SRC, file), "utf8"));
  return CAPITAL_ACTIVITY.test(code) || ACTIVITY_FUND.test(code) || RAW_KIND_FUND.test(code);
}

function ledgerFiles(): string[] {
  const files: string[] = [];
  for (const root of LEDGER_ROOTS) walk(path.join(SRC, root), files);
  for (const name of readdirSync(path.join(SRC, "lib"))) {
    if (!LEDGER_LIB_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
    files.push(path.join(SRC, "lib", name));
  }
  return files;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

describe("fund-name literal scan (DECISION-127)", () => {
  it("no ledger surface hard-codes a capital-A Activity or 'activity fund' outside the allowlist", () => {
    const offenders = ledgerFiles()
      .filter((f) => !(rel(f) in ALLOWLIST))
      .filter((f) => {
        return isDirty(rel(f));
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no ledger surface hard-codes 'Public Funds' outside the labels module (comments exempt)", () => {
    const offenders = ledgerFiles()
      .filter((f) => rel(f) !== LABELS_MODULE)
      .filter((f) => PUBLIC_FUNDS_LITERAL.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("negative control: the Public Funds pattern catches each literal shape and ignores comments", () => {
    for (const src of ['const a = "in Public Funds";', "<p>{n} Public Funds categories</p>", "`a ${x} Public Funds`"]) {
      expect(PUBLIC_FUNDS_LITERAL.test(stripComments(src)), src).toBe(true);
    }
    expect(PUBLIC_FUNDS_LITERAL.test(stripComments("// Public Funds\n/* Public Funds */ const q = 1;"))).toBe(false);
  });

  it("member surfaces never print 'activity fund' in any case", () => {
    const files: string[] = [];
    for (const root of MEMBER_ROOTS) walk(path.join(SRC, root), files);
    const offenders = files
      .filter((f) => ACTIVITY_FUND.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the register page does not print the raw kind as '{fund.kind} fund' outside the allowlist", () => {
    const file = "app/(dashboard)/admin/ledger/[fundSlug]/page.tsx";
    if (file in ALLOWLIST) return;
    expect(isDirty(file)).toBe(false);
  });

  it("every allowlist entry is still dirty (a clean file must be removed from the list)", () => {
    for (const file of Object.keys(ALLOWLIST)) expect(isDirty(file), file).toBe(true);
  });

  it("every allowlist entry names a reason", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, file).toBeGreaterThan(10);
    }
  });

  describe("negative control: the patterns catch each literal shape", () => {
    it("catches a string literal, a template literal and JSX text, and ignores comments", () => {
      const cases = [
        'const a = "the Activity Fund";',
        "const b = `moved to ${x} Activity`;",
        "<p>Money in the Activity Fund stays.</p>",
      ];
      for (const src of cases) {
        const code = stripComments(src);
        expect(CAPITAL_ACTIVITY.test(code) || ACTIVITY_FUND.test(code), src).toBe(true);
      }
      expect(CAPITAL_ACTIVITY.test(stripComments("// the Activity Fund\n/* Activity */ const q = 1;"))).toBe(false);
      expect(CAPITAL_ACTIVITY.test(stripComments("<p>Cleared activity</p>"))).toBe(false);
      expect(CAPITAL_ACTIVITY.test(stripComments("<p>It's the Activity</p>"))).toBe(true);
    });
  });
});
