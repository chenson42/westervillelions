/** Source scans for the clone feature (build-failing). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const queries = read("lib", "santas-workshop", "session-queries.ts");

/** The clone section of session-queries.ts: getCloneSource through the end of createSession. */
function cloneSection(): string {
  const start = queries.indexOf("/** The only columns a clone reads");
  const end = queries.indexOf("// Overview", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return queries.slice(start, end);
}

describe("clone source scans", () => {
  it("getCloneSource selects the named columns only and none of the credential, token, Zeffy or stamp columns", () => {
    const section = cloneSection();
    const fn = section.slice(section.indexOf("export async function getCloneSource"), section.indexOf("export async function createSession"));
    expect(fn).toMatch(/db\s*\.select\(\{/);
    expect(fn).not.toMatch(/\.select\(\)/);
    for (const banned of [
      "crewCodeEnc", "crewCodeVersion", "crewPaused", "collageToken", "collagePublishedAt", "zeffy", "storageFolderKey",
      "PurgedAt", "status", "frameFilePrefix", "createdByUserId",
    ]) {
      expect(fn, banned).not.toContain(banned);
    }
  });

  it("session-clone.ts and the clone section of session-queries.ts never mention swScenes, sw_scenes or scene-admin", () => {
    for (const text of [read("lib", "santas-workshop", "session-clone.ts"), cloneSection()]) {
      expect(text).not.toMatch(/swScenes|sw_scenes|scene-admin|scene-queries/);
    }
  });

  it("the session page links to the clone form and the new page never falls back to a blank form for a bad cloneFrom", () => {
    const page = read("app", "(dashboard)", "admin", "santas-workshop", "[sessionId]", "page.tsx");
    expect(page).toContain("/admin/santas-workshop/new?cloneFrom=${s.id}");
    const created = read("app", "(dashboard)", "admin", "santas-workshop", "new", "page.tsx");
    const guard = created.indexOf("if (cloneFrom !== undefined)");
    const missing = created.indexOf("That session no longer exists");
    const blank = created.indexOf("defaultSessionDraft(");
    expect(guard).toBeGreaterThan(-1);
    expect(missing).toBeGreaterThan(guard);
    expect(created.indexOf("return (", guard)).toBeLessThan(missing);
    expect(blank).toBeGreaterThan(missing);
  });
});
