/**
 * Source scans for the worker (crew) app (build-failing): house rules (no native
 * dialogs, no console, no raw HTML), the privacy rules of the crew contract (no
 * contact data anywhere in the crew UI, no storage vendor in any visible word), the
 * server gate on the page, and that the camera is only ever opened by the scanner.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const PAGE_DIR = join(DIR, "..", "..", "..", "app", "santas-workshop", "crew", "[slug]");

const files = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => [f, readFileSync(join(DIR, f), "utf8")] as const);
const pageFiles = readdirSync(PAGE_DIR).map((f) => [`page:${f}`, readFileSync(join(PAGE_DIR, f), "utf8")] as const);
const all = [...files, ...pageFiles];

describe("crew app: house rules", () => {
  it.each(all)("%s has no raw HTML, native dialogs, console output or lions-red", (_name, src) => {
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toMatch(/\binnerHTML\b/);
    expect(src).not.toMatch(/(?<!function\s)(?<![\w.])(alert|confirm|prompt)\(|\bwindow\.(alert|confirm|prompt)\(/);
    expect(src).not.toMatch(/console\.(log|info|debug|warn|error)/);
    expect(src).not.toContain("lions-red");
  });

  it("buttons are rounded-lg, never rounded-full", () => {
    const styles = readFileSync(join(DIR, "crew-styles.ts"), "utf8");
    expect(styles).not.toContain("rounded-full");
    for (const name of ["CREW_BTN", "CREW_BTN_GOLD", "CREW_BTN_OUTLINE", "CREW_BTN_SMALL"]) {
      const line = styles.split("\n").find((l) => l.startsWith(`export const ${name} =`));
      expect(line, name).toContain("rounded-lg");
    }
  });

  it("every thumb target in the shared button styles is at least 44 px tall", () => {
    const styles = readFileSync(join(DIR, "crew-styles.ts"), "utf8");
    for (const line of styles.split("\n").filter((l) => l.startsWith("export const CREW_BTN"))) {
      const m = line.match(/min-h-\[(\d+)px\]/);
      expect(m && Number(m[1])).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("crew app: privacy", () => {
  it.each(all)("%s carries no buyer contact field and never names the storage vendor", (_name, src) => {
    expect(src).not.toMatch(/parentEmail|parentPhone|buyerEmail|buyerPhone|\bmobile\b|zeffy/i);
    // Visible words only: strip comments first so a doc comment may explain the rule.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bgoogle\b|\bdrive\b/i);
  });

  it("the parent's name is read only by the tag panel and the pickup panel", () => {
    const users = files.filter(([, src]) => /parentName/.test(src)).map(([f]) => f).sort();
    expect(users).toEqual(["pickup-panel.tsx", "tag-panel.tsx"]);
  });

  it("never reads cookies in the browser: the worker cookie is HttpOnly", () => {
    for (const [name, src] of files) expect(src, name).not.toContain("document.cookie");
  });

  it("a sticker is never rendered as a link or navigated to", () => {
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/window\.open\(|location\.href\s*=\s*(code|text|tag)/);
    }
  });
});

describe("crew app: boundaries", () => {
  it("client files never import a database or server-only module", () => {
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/from "@\/lib\/db/);
      expect(src, name).not.toMatch(/from "@\/lib\/(auth|permissions-server)/);
      expect(src, name).not.toMatch(/crew-auth|crew-queries|photo-store|photo-service|stuffy-transitions|server-only|node:/);
    }
  });

  it("only the scanner opens the camera", () => {
    const users = files.filter(([, src]) => src.includes("getUserMedia")).map(([f]) => f);
    expect(users).toEqual(["scanner.tsx"]);
  });

  it("jsqr is loaded only on demand, and the QR for pickup is drawn on demand", () => {
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/^import .* from "jsqr"/m);
      expect(src, name).not.toMatch(/^import .* from "qrcode"/m);
    }
    expect(readFileSync(join(DIR, "qr-decoder.ts"), "utf8")).toContain('import("jsqr")');
    expect(readFileSync(join(DIR, "pickup-panel.tsx"), "utf8")).toContain('import("qrcode")');
  });

  it("destructive or replacing actions go through ConfirmDialog", () => {
    expect(readFileSync(join(DIR, "tag-panel.tsx"), "utf8")).toContain("<ConfirmDialog");
    expect(readFileSync(join(DIR, "portrait-panel.tsx"), "utf8")).toContain("<ConfirmDialog");
    expect(readFileSync(join(DIR, "stuffy-screen.tsx"), "utf8")).toContain("<ConfirmDialog");
    expect(readFileSync(join(DIR, "outbox-bar.tsx"), "utf8")).toContain("<ConfirmDialog");
  });
});

describe("crew page", () => {
  const page = readFileSync(join(PAGE_DIR, "page.tsx"), "utf8");
  const layout = readFileSync(join(PAGE_DIR, "layout.tsx"), "utf8");

  it("runs requireCrew before it renders the app, and renders only the code screen otherwise", () => {
    const gate = page.indexOf("await requireCrew(");
    const app = page.indexOf("<CrewApp");
    expect(gate).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(gate);
    expect(page.match(/<CrewApp/g)).toHaveLength(1);
    // The session's name is never put in the page the server renders.
    expect(page).not.toMatch(/session\.name|session\.slug/);
    expect(page).toContain('force-dynamic');
  });

  it("is never indexed", () => {
    expect(layout).toMatch(/index:\s*false/);
  });
});
