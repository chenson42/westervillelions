/**
 * Source scans for the Slice 1 server surface (build-failing):
 *   - every /api/admin/santas-workshop/** handler makes `await auth()` then the
 *     SANTAS_WORKSHOP_MANAGE hasFeature() check its first two statements, before
 *     any body read or database use;
 *   - the carrier modules the admin UI imports stay client-safe (no db, no
 *     server-only, no node: imports, transitively).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const ADMIN_API = join(SRC, "app", "api", "admin", "santas-workshop");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** [name, body] for each `export async function METHOD(...) { body }`, paren- and brace-balanced. */
function handlers(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    while (depth > 0 && i < source.length) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
      i += 1;
    }
    const open = source.indexOf("{", i);
    let braces = 1;
    let j = open + 1;
    while (braces > 0 && j < source.length) {
      if (source[j] === "{") braces += 1;
      else if (source[j] === "}") braces -= 1;
      j += 1;
    }
    out.push({ name: m[1], body: source.slice(open + 1, j - 1) });
  }
  return out;
}

const GATE =
  /^\s*const session = await auth\(\);\s*if \(!session\?\.user\?\.id\) return unauthorized\(\);\s*if \(!\(await hasFeature\(session\.user\.id, FEATURES\.SANTAS_WORKSHOP_MANAGE\)\)\) return forbidden\(\);/;

describe("admin-routes-gate: /api/admin/santas-workshop/**", () => {
  const routes = walk(ADMIN_API).filter((f) => f.endsWith("route.ts"));

  it("finds the Slice 1 routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
    expect(walk(ADMIN_API).every((f) => f.endsWith("route.ts"))).toBe(true);
  });

  for (const file of routes) {
    const rel = file.slice(ADMIN_API.length);
    const source = readFileSync(file, "utf8");
    const found = handlers(source);

    it(`${rel}: exports at least one handler`, () => {
      expect(found.length).toBeGreaterThan(0);
    });

    for (const h of found) {
      it(`${rel} ${h.name}: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE) are the first two statements`, () => {
        expect(h.body).toMatch(GATE);
      });
    }

    it(`${rel}: imports auth and hasFeature from the project helpers`, () => {
      expect(source).toMatch(/from "@\/lib\/auth"/);
      expect(source).toMatch(/import \{ hasFeature \} from "@\/lib\/permissions-server"/);
      expect(source).toMatch(/FEATURES\.SANTAS_WORKSHOP_MANAGE/);
    });
  }
});

describe("carrier modules are client-safe", () => {
  const CARRIERS = [
    "lib/santas-workshop/admin-contract.ts",
    "lib/santas-workshop/question-fields.ts",
    "lib/santas-workshop/session-input.ts",
    "lib/santas-workshop/session-checklist.ts",
    "lib/santas-workshop/sync-cursor.ts",
    "lib/santas-workshop/state-machine.ts",
    "lib/santas-workshop/payment-mapper.ts",
    "lib/zeffy/event-outcomes.ts",
  ].map((p) => join(SRC, p));

  function resolve(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("./") || spec.startsWith("../")) base = join(dirname(from), spec);
    else if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
    else return null;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
    return null;
  }

  function closure(entry: string, seen = new Set<string>()): Set<string> {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    const text = readFileSync(entry, "utf8");
    for (const m of text.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/g)) {
      const target = resolve(entry, m[1]);
      if (target) closure(target, seen);
    }
    return seen;
  }

  for (const entry of CARRIERS) {
    it(`${entry.slice(SRC.length + 1)} pulls in no server-only module`, () => {
      for (const file of closure(entry)) {
        const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const where = file.slice(SRC.length + 1);
        expect(text, where).not.toMatch(/from\s+["']@\/lib\/db["']|from\s+["']@\/lib\/db\//);
        expect(text, where).not.toMatch(/from\s+["']node:|from\s+["'](fs|crypto|path)["']/);
        expect(text, where).not.toMatch(/from\s+["']next\/server["']|["']server-only["']/);
        expect(text, where).not.toMatch(/process\.env/);
      }
    });
  }
});
