import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { safeCallbackPath } from "./safe-callback-path";

const UUID = "00000000-0000-4000-8000-000000000001";
const ORIGIN = "https://westervillelions.org";

describe("safeCallbackPath", () => {
  it.each([
    `/admin/ledger/approvals?txn=${UUID}`,
    "/members",
    `/admin/ledger/approvals?tab=decided&txn=${UUID}`,
    "/%2F%2Fevil",
  ])("passes %s unchanged", (p) => {
    expect(safeCallbackPath(p)).toBe(p);
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["double backslash", "/\\\\evil.example"],
    ["tab", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
    ["dot-dot double slash", "/..//evil.example"],
    ["dot double slash", "/.//evil.example"],
    ["absolute https", "https://evil.example/x"],
    ["uppercase scheme", "HTTPS://evil.example"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,x"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["too long", "/" + "a".repeat(2048)],
    ["space", "/a b"],
    ["backslash inside", "/a\\b"],
  ])("falls back to /members for %s", (_n, p) => {
    expect(safeCallbackPath(p as string | null | undefined)).toBe("/members");
  });

  it("accepts a same-origin absolute URL only when origin is given", () => {
    const abs = `${ORIGIN}/admin/ledger/approvals?txn=x`;
    expect(safeCallbackPath(abs, { origin: ORIGIN })).toBe("/admin/ledger/approvals?txn=x");
    expect(safeCallbackPath(abs)).toBe("/members");
  });
  it("rejects look-alike and wrong-scheme origins", () => {
    expect(safeCallbackPath("https://westervillelions.org.evil.example/", { origin: ORIGIN })).toBe("/members");
    expect(safeCallbackPath("https://evil.example/", { origin: ORIGIN })).toBe("/members");
    expect(safeCallbackPath("http://westervillelions.org/", { origin: ORIGIN })).toBe("/members");
  });
  it("honours fallback", () => {
    expect(safeCallbackPath("//evil.example", { fallback: "/" })).toBe("/");
  });
});

describe("no raw callbackUrl consumer", () => {
  const root = join(__dirname, "..");
  function walk(dir: string, out: string[] = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  it("every file reading or forwarding callbackUrl calls safeCallbackPath", () => {
    const files = [...walk(join(root, "app")), join(root, "proxy.ts")];
    const offenders = files
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        const reads = /searchParams\.get\(\s*["']callbackUrl["']\s*\)/.test(text);
        const forwards = /callbackUrl/.test(text) && /(router\.push|signIn)\s*\(/.test(text);
        return (reads || forwards) && !text.includes("safeCallbackPath(");
      })
      .map((f) => relative(root, f).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
