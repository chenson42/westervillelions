import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The repo is public: every fixture must be synthetic or redacted. Fails the build on a
 * non-example e-mail address or a phone-shaped number, in this folder and the workshop fixtures.
 */
const DIRS = [join(__dirname, "__fixtures__"), join(__dirname, "..", "santas-workshop", "__fixtures__")];

function files(): string[] {
  const out: string[] = [];
  for (const dir of DIRS) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".json")) out.push(join(dir, f));
    } catch {
      /* directory absent */
    }
  }
  return out;
}

describe("fixtures hold no personal data", () => {
  it("has fixtures to check", () => {
    expect(files().length).toBeGreaterThan(0);
  });

  for (const file of files()) {
    it(`${file.split("/").slice(-2).join("/")} is clean`, () => {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)) {
        expect(m[1]).toMatch(/^example\.(invalid|com)$/);
      }
      expect(text).not.toMatch(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/);
      expect(text).not.toMatch(/\+\d{10,}/);
    });
  }
});
