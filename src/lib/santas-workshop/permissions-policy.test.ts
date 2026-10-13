/**
 * The worker app needs the live camera; nothing else does. `next.config.ts` builds both
 * Permissions-Policy strings from one function, the crew rule comes after the global
 * rule (the last matching rule wins for the same key, as read from the Next 16 headers
 * doc), and no other source widens the camera. This test encodes that reading; the
 * measurement is Phase 5 check L5.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[];
}

/** The subset of Next's path matching these sources use. */
function matches(source: string, path: string): boolean {
  if (source === "/(.*)") return true;
  const re = source.replace(/\/:path\*/, "(?:/.*)?").replace(/:[a-z]+/g, "[^/]+");
  return new RegExp(`^${re}$`).test(path);
}

/** Last matching rule wins per header key. */
async function resolved(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rule of await rules()) {
    if (!matches(rule.source, path)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

describe("Permissions-Policy", () => {
  it("the global rule keeps camera=()", async () => {
    const [global] = await rules();
    expect(global.source).toBe("/(.*)");
    const pp = global.headers.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    expect(pp).toContain("camera=()");
    expect(pp).not.toContain("camera=(self)");
  });

  it("the crew rule exists after the global rule with camera=(self)", async () => {
    const all = await rules();
    const globalIndex = all.findIndex((r) => r.source === "/(.*)");
    const crewIndex = all.findIndex((r) => r.source === "/santas-workshop/crew/:path*");
    expect(crewIndex).toBeGreaterThan(globalIndex);
    expect(all[crewIndex].headers.find((h) => h.key === "Permissions-Policy")?.value).toContain("camera=(self)");
  });

  it("the two strings are equal apart from the camera token (microphone, geolocation, payment unchanged)", async () => {
    const all = await rules();
    const global = all[0].headers.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    const crew = all.find((r) => r.source === "/santas-workshop/crew/:path*")?.headers.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    expect(crew.replace("camera=(self)", "camera=()")).toBe(global);
    expect(crew).toContain("microphone=()");
    expect(crew).toContain("geolocation=()");
    expect(crew).toContain('payment=(self "https://www.zeffy.com")');
  });

  it("a simulated last-wins resolution gives camera=(self) on the crew path and camera=() everywhere else", async () => {
    expect((await resolved("/santas-workshop/crew/practice-a"))["Permissions-Policy"]).toContain("camera=(self)");
    expect((await resolved("/santas-workshop/crew/practice-a/anything"))["Permissions-Policy"]).toContain("camera=(self)");
    for (const path of ["/santas-workshop", "/santas-workshop/c/abc", "/santas-workshop/f/abc", "/", "/admin", "/api/santas-workshop/photos/x"]) {
      expect((await resolved(path))["Permissions-Policy"], path).toContain("camera=()");
    }
  });

  it("token pages and the API set their referrer and robots headers after the global rule", async () => {
    const collage = await resolved("/santas-workshop/c/aaaaaaaaaaaaaaaaaaaaaa");
    const family = await resolved("/santas-workshop/f/aaaaaaaaaaaaaaaaaaaaaa");
    const api = await resolved("/api/santas-workshop/crew/x/roster");
    const crew = await resolved("/santas-workshop/crew/x");
    expect(collage["Referrer-Policy"]).toBe("no-referrer");
    expect(collage["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(family["Referrer-Policy"]).toBe("no-referrer");
    expect(crew["Referrer-Policy"]).toBe("no-referrer");
    expect(crew["X-Robots-Tag"]).toBe("noindex");
    expect(api["X-Robots-Tag"]).toBe("noindex");
    // The public sign-up page keeps the site-wide referrer policy.
    expect((await resolved("/santas-workshop"))["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("no other source sets camera=(self)", () => {
    const ROOT = join(__dirname, "..", "..", "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === ".git" || name === "worktrees") continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js|json)$/.test(name) && !/\.test\./.test(name) && readFileSync(p, "utf8").includes("camera=(self)")) hits.push(relative(ROOT, p));
      }
    };
    walk(join(ROOT, "src"));
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (config.includes("camera=(self)")) hits.push("next.config.ts");
    expect(hits).toEqual([]);
  });

  it("next.config.ts builds both strings from the one function", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "next.config.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).toMatch(/function permissionsPolicy\(camera: "\(\)" \| "\(self\)"\)/);
    expect(source.match(/camera=/g)).toHaveLength(1); // the template inside the function: `camera=${camera}`
    expect(source).toContain('permissionsPolicy("()")');
    expect(source).toContain('permissionsPolicy("(self)")');
  });
});
