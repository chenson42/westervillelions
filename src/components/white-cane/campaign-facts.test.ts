import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  FUNDED_PROJECTS,
  GENERIC_PURPOSE,
  RECEIPT_COPY,
  RECEIPT_VARIANT,
  ZEFFY_FORM_URL,
} from "./campaign-facts";

const root = path.resolve(__dirname, "../../..");
const factsSrc = readFileSync(path.join(__dirname, "campaign-facts.ts"), "utf8");
const donateSrc = readFileSync(path.join(root, "src/app/donate/page.tsx"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sourceFiles = [
  ...walk(path.join(root, "src/components/white-cane")),
  ...walk(path.join(root, "src/app/white-cane")),
].filter((f) => !/\.test\.tsx?$/.test(f));

const EIN = /\b\d{2}-\d{7}\b/;

describe("receipt copy", () => {
  it("ships a known variant", () => {
    expect(["foundation", "club", "unknown"]).toContain(RECEIPT_VARIANT);
  });

  it("says tax-deductible (unnegated) only in the foundation variant", () => {
    const hits = (s: string) => /(?<!not )tax-deductible/i.test(s);
    expect(hits(RECEIPT_COPY.foundation.trust)).toBe(true);
    for (const v of ["club", "unknown"] as const) {
      expect(hits(RECEIPT_COPY[v].trust + RECEIPT_COPY[v].receipt)).toBe(false);
    }
    for (const f of sourceFiles) {
      const src = readFileSync(f, "utf8");
      if (f.endsWith("campaign-facts.ts")) {
        const start = src.indexOf("foundation: {");
        const end = src.indexOf("club: {");
        const outside = src.slice(0, start) + src.slice(end);
        expect(hits(outside)).toBe(false);
      } else {
        expect(hits(src)).toBe(false);
      }
    }
  });

  it("keeps the EIN only in the foundation variant, matching /donate", () => {
    const donateEin = donateSrc.match(/EIN\s+(\d{2}-\d{7})/)?.[1];
    expect(donateEin).toBeTruthy();
    const matches = factsSrc.match(new RegExp(donateEin!, "g")) ?? [];
    expect(matches).toHaveLength(1);
    expect(RECEIPT_COPY.foundation.trust).toContain(donateEin!);
    for (const v of ["club", "unknown"] as const) {
      expect(EIN.test(RECEIPT_COPY[v].trust + RECEIPT_COPY[v].receipt)).toBe(false);
      expect(/receipt/i.test(RECEIPT_COPY[v].trust + RECEIPT_COPY[v].receipt)).toBe(false);
    }
    for (const f of sourceFiles.filter((x) => !x.endsWith("campaign-facts.ts"))) {
      expect(EIN.test(readFileSync(f, "utf8"))).toBe(false);
    }
  });
});

describe("Zeffy link", () => {
  it("is empty or a public share link, not an embed link", () => {
    expect(ZEFFY_FORM_URL === "" || ZEFFY_FORM_URL.startsWith("https://www.zeffy.com/")).toBe(true);
    expect(ZEFFY_FORM_URL).not.toContain("/embed/");
  });
});

describe("content discipline", () => {
  it("has files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(4);
  });

  it("carries no other-campaign, unsourced or personal content", () => {
    for (const f of sourceFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/IHOP|Santa|child|children|stuff(y|ies)/i);
      expect(src, f).not.toMatch(/Helen Keller/);
      expect(src, f).not.toMatch(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/);
      const emails = src.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
      for (const e of emails) expect(e, f).toMatch(/@westervillelions\.org$/);
    }
  });

  it("uses the generic sentence and names no old recipient while projects are empty", () => {
    expect(FUNDED_PROJECTS).toHaveLength(0);
    expect(GENERIC_PURPOSE).toBe("Your gift supports the Lions' sight projects.");
    for (const f of sourceFiles) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/Pilot Dogs|Eye Bank|Diabetes/);
    }
  });
});
