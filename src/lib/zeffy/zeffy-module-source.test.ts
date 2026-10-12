import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ZEFFY_DIR = __dirname;
const SRC = join(__dirname, "..", "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}
const nonTest = (files: string[]) => files.filter((f) => !/\.test\.tsx?$/.test(f));

describe("consumer-injection: src/lib/zeffy/ knows nothing about the workshop", () => {
  it("imports nothing from santas-workshop", () => {
    for (const file of nonTest(walk(ZEFFY_DIR))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/santas-workshop/);
    }
  });
});

describe("secrets-not-logged", () => {
  it("no console call or template in src/lib/zeffy/ interpolates a secret or a request body", () => {
    for (const file of nonTest(walk(ZEFFY_DIR))) {
      const text = readFileSync(file, "utf8");
      // console.* arguments must not name the secrets or a body
      for (const m of text.matchAll(/console\.\w+\(([^;]*)\)/g)) {
        expect(m[1], file).not.toMatch(/ZEFFY_API_KEY|ZEFFY_WEBHOOK_SECRET|apiKey|secret|rawBody|private_key|body/i);
      }
      expect(text, file).not.toMatch(/\$\{[^}]*(ZEFFY_API_KEY|ZEFFY_WEBHOOK_SECRET|private_key)[^}]*\}/);
    }
  });
});

describe("test-helpers is never imported by app code", () => {
  it("only tests and the fixture script import zeffy/test-helpers", () => {
    const importers = walk(SRC)
      .filter((f) => !f.endsWith("test-helpers.ts"))
      .filter((f) => /from\s+["'][^"']*zeffy\/test-helpers["']|from\s+["']\.\/test-helpers["']/.test(readFileSync(f, "utf8")));
    for (const f of importers) expect(f, f).toMatch(/\.test\.tsx?$/);
  });
});

describe("webhook-route-source", () => {
  const route = readFileSync(join(SRC, "app", "api", "zeffy", "webhook", "route.ts"), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "");

  it("reads arrayBuffer() before any json()", () => {
    const buffer = code.indexOf("arrayBuffer()");
    expect(buffer).toBeGreaterThan(-1);
    const json = code.indexOf(".json()");
    expect(json === -1 || buffer < json).toBe(true);
  });

  it("has no auth import or call: the signature is the authentication", () => {
    expect(code).not.toMatch(/from\s+["']@\/lib\/auth/);
    expect(code).not.toMatch(/\bauth\(/);
  });

  it("is node-runtime and force-dynamic", () => {
    expect(code).toMatch(/export const runtime = "nodejs"/);
    expect(code).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("does not import test-helpers", () => {
    expect(code).not.toMatch(/test-helpers/);
  });
});
