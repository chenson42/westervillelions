/**
 * Build-failing scans for the photo door (DECISION-121/122):
 *   - the photo store's `get` is called from photo-access.ts only;
 *   - modules that import the store adapters are an explicit allowlist;
 *   - no route file and no response mapper references a storage key;
 *   - nothing creates a Drive permission or asks for a share link.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const prod = walk(SRC).filter((f) => !isTest(f));
const rel = (f: string) => relative(ROOT, f);

describe("the photo store is reached through the access module", () => {
  const STORE_ADAPTER_IMPORT = /from\s+["'][^"']*photo-store(?:\/(?:index|drive|local|memory))?["']/;
  const ALLOWED = [
    "src/lib/santas-workshop/photo-access.ts",
    "src/lib/santas-workshop/photo-service.ts",
    "src/lib/santas-workshop/retention.ts",
    "src/lib/santas-workshop/storage-admin.ts",
  ];

  it("the importer set of the store factory and adapters equals the allowlist", () => {
    const importers = prod
      .filter((f) => STORE_ADAPTER_IMPORT.test(strip(readFileSync(f, "utf8"))))
      .map(rel)
      .filter((f) => !f.includes("/photo-store/"))
      .sort();
    expect(importers).toEqual([...ALLOWED].sort());
  });

  it("`.get(` on the store appears only in photo-access.ts (adapters excluded)", () => {
    for (const file of prod) {
      const r = rel(file);
      if (r.includes("/photo-store/") || r.endsWith("photo-access.ts")) continue;
      expect(strip(readFileSync(file, "utf8")), r).not.toMatch(/\b(store|resolved|photoStore)\.get\(/);
    }
    const access = strip(readFileSync(join(SRC, "lib", "santas-workshop", "photo-access.ts"), "utf8"));
    expect(access.match(/\.get\(key\)/g)).toHaveLength(1);
  });

  it("no route file references a storage key", () => {
    for (const file of prod.filter((f) => /[\\/]app[\\/].*route\.ts$/.test(f) && f.includes("santas-workshop"))) {
      expect(strip(readFileSync(file, "utf8")), rel(file)).not.toMatch(/storageKey|thumbStorageKey|storage_key/);
    }
  });

  it("no response mapper or contract carries a storage key", () => {
    for (const name of ["crew-queries.ts", "crew-contract.ts", "admin-contract.ts", "crew-respond.ts", "crew-http.ts"]) {
      expect(strip(readFileSync(join(SRC, "lib", "santas-workshop", name), "utf8")), name).not.toMatch(/storageKey|thumbStorageKey|storage_key/);
    }
    // session-queries builds the registrant DTO: it must not select photo keys either.
    expect(strip(readFileSync(join(SRC, "lib", "santas-workshop", "session-queries.ts"), "utf8"))).not.toMatch(/storageKey|thumbStorageKey/);
  });

  it("test-support modules are never imported by production code", () => {
    for (const file of prod) {
      const r = rel(file);
      if (r.endsWith("photo-fixtures.ts") || r.endsWith("contract-suite.ts")) continue;
      expect(strip(readFileSync(file, "utf8")), r).not.toMatch(/photo-fixtures|contract-suite/);
    }
  });
});

describe("no Drive sharing anywhere in src/", () => {
  it("never creates a permission or asks for a share link", () => {
    for (const file of prod) {
      expect(strip(readFileSync(file, "utf8")), rel(file)).not.toMatch(/permissions\.create|permissions\.update|anyoneWithLink|webViewLink|webContentLink/);
    }
  });
});

describe("secrets are not logged", () => {
  const files = prod.filter((f) => /santas-workshop[\\/]/.test(f) && (/photo-store[\\/]/.test(f) || /crew-|photo-|storage-|stuffy-/.test(f.split(/[\\/]/).pop() ?? "")));

  it("scans the photo store, worker access and photo modules", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("no console call or error message interpolates key material, the worker code, a sticker or a request body", () => {
    for (const file of files) {
      const source = strip(readFileSync(file, "utf8"));
      for (const m of source.matchAll(/console\.\w+\(([\s\S]*?)\);/g)) {
        expect(m[1], rel(file)).not.toMatch(/private_key|SERVICE_ACCOUNT|AUTH_SECRET|NEXTAUTH_SECRET|crewCodeEnc|tagCode|tag_code|buyer|email|password|body|formData/i);
      }
    }
  });

  it("only the environment-reading modules read the process environment", () => {
    const allowed = new Set(["photo-store/config.ts", "crew-secret.ts"]);
    for (const file of files) {
      const r = rel(file).replace("src/lib/santas-workshop/", "");
      if (allowed.has(r)) continue;
      expect(strip(readFileSync(file, "utf8")), r).not.toMatch(/process\.env/);
    }
  });
});
