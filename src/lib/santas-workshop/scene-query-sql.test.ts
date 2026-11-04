/** Regression for D2: a correlated subquery's outer column must be table-qualified (Drizzle renders a single-table select unqualified). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("scene-queries correlated counts", () => {
  const src = readFileSync(join(__dirname, "scene-queries.ts"), "utf8");
  it("never interpolates the outer scene id inside the sw_photos subquery", () => {
    for (const line of src.split("\n").filter((l) => l.includes("from sw_photos sp"))) {
      expect(line).toContain("sp.scene_id = sw_scenes.id");
      expect(line).not.toMatch(/sp\.scene_id = \$\{/);
    }
  });
});
