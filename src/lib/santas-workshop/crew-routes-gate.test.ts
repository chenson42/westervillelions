/**
 * Source scans for the worker surface (build-failing):
 *   - every route under /api/santas-workshop/crew/ calls requireCrew() before any
 *     body read or database use; the only exception is `enter`, which is the
 *     credential exchange and must use the throttle and the code verifier;
 *   - the carrier modules the crew app imports stay client-safe.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const CREW_API = join(SRC, "app", "api", "santas-workshop", "crew");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

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

const BODY_OR_DB = /request\.(json|formData|text|arrayBuffer|blob)\(|readCrewJson\(|readUploadParts\(|\bdb\b|@\/lib\/db/;

describe("crew-routes-gate: /api/santas-workshop/crew/**", () => {
  const routes = walk(CREW_API).filter((f) => f.endsWith("route.ts"));
  const relOf = (f: string) => f.slice(CREW_API.length + 1);

  it("finds the worker routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
    expect(walk(CREW_API).every((f) => f.endsWith("route.ts"))).toBe(true);
  });

  it("the exception list is exactly `enter`", () => {
    const exceptions = routes.filter((f) => !readFileSync(f, "utf8").includes("requireCrew(")).map(relOf);
    expect(exceptions).toEqual([join("[slug]", "enter", "route.ts")]);
  });

  for (const file of routes) {
    const rel = relOf(file);
    const source = readFileSync(file, "utf8");
    const isEnter = rel === join("[slug]", "enter", "route.ts");

    for (const h of handlers(source)) {
      if (isEnter) {
        it(`${rel} ${h.name}: the credential exchange throttles and verifies the code`, () => {
          expect(h.body).toContain("enterWithCode(");
          expect(h.body).toContain("attempts: dbAttemptStore");
          expect(source).not.toContain("requireCrew");
        });
        continue;
      }
      it(`${rel} ${h.name}: requireCrew() comes before any body read or database use`, () => {
        const gate = h.body.indexOf("await requireCrew(");
        expect(gate).toBeGreaterThanOrEqual(0);
        const first = h.body.search(BODY_OR_DB);
        if (first !== -1) expect(first).toBeGreaterThan(gate);
        // The gate result is honoured immediately.
        expect(h.body.slice(gate)).toMatch(/if \(!gate\.ok\) return gate\.response;/);
        // Only the route params are awaited before the gate.
        const before = h.body.slice(0, gate);
        expect((before.match(/await /g) ?? []).length).toBe(1);
        expect(before).toMatch(/await params/);
      });
    }

    it(`${rel}: is a Node, force-dynamic route`, () => {
      expect(source).toMatch(/export const runtime = "nodejs"/);
      expect(source).toMatch(/export const dynamic = "force-dynamic"/);
    });
  }
});

describe("crew carrier modules are client-safe", () => {
  const CARRIERS = [
    "lib/santas-workshop/crew-contract.ts",
    "lib/santas-workshop/photo-limits.ts",
    "lib/santas-workshop/jpeg-header.ts",
    "lib/santas-workshop/state-machine.ts",
    "lib/santas-workshop/manual-add.ts",
    "lib/santas-workshop/session-status.ts",
    "lib/santas-workshop/tag-binding.ts",
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
