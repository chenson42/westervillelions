import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/app/privacy/page.tsx"), "utf8");

describe("privacy page workshop section", () => {
  it("has a Santa's Workshop section and a collected-data bullet", () => {
    expect(src).toContain("A Visit to Santa&apos;s Workshop</h2>");
    expect(src).toContain("Santa&apos;s Workshop sign-ups:</strong>");
  });

  it("imports its promise and photo sentences from copy.ts rather than retyping them", () => {
    expect(src).toMatch(/from "@\/components\/santas-workshop\/copy"/);
    for (const name of ["PROMISE", "PHOTO_BOX_LABEL", "PHOTO_BOX_HELPER", "COLLAGE_KEEPING"]) {
      expect(src).toContain(name);
    }
    expect(src).not.toContain("We photograph stuffies only");
  });
});
