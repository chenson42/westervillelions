/**
 * B-172 Increment 2b, pass 1: the lump sweep's UI is gone. The route refuses a
 * sweep-direction body (use_sweep_batch); these scans keep every client
 * remnant from coming back.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILES = walk(SRC).map((file) => ({ file: path.relative(SRC, file), text: strip(readFileSync(file, "utf8")) }));

describe("the lump sweep UI is retired", () => {
  it("sweep-prefill-launcher.tsx does not exist", () => {
    expect(existsSync(path.join(SRC, "components/admin/ledger/sweep-prefill-launcher.tsx"))).toBe(false);
  });

  it.each(["sweepFrom", "SweepPrefill", "sweepPrefill", "sweepDeepLink", "destCategoryId", "SweepPrefillLauncher"])(
    "no non-test source contains %s",
    (word) => {
      const offenders = FILES.filter((f) => f.text.includes(word)).map((f) => f.file);
      // The lump route's own parser may name the body field it refuses; nothing else may.
      expect(offenders.filter((f) => f !== "app/api/admin/ledger/transactions/route.ts")).toEqual([]);
    },
  );

  it("transaction-form.tsx has no sweep flow mode and no cross-entity context", () => {
    const form = FILES.find((f) => f.file === "components/admin/ledger/transaction-form.tsx")!;
    expect(form.text).not.toMatch(/["']sweep["']/);
    expect(form.text).not.toContain("crossEntityContext");
    expect(form.text).not.toContain("boardMinute");
    const dialog = FILES.find((f) => f.file === "components/admin/ledger/transaction-form-dialog.tsx")!;
    expect(dialog.text).not.toContain("crossEntityContext");
  });

  it("the Move dialog's 'Record sweep now' goes to the builder", () => {
    const move = FILES.find((f) => f.file === "components/admin/ledger/move-transaction-dialog.tsx")!;
    expect(move.text).toContain("sweepBuilderHref");
  });

  it("the register links to the builder instead", () => {
    const page = FILES.find((f) => f.file === "app/(dashboard)/admin/ledger/[fundSlug]/page.tsx")!;
    expect(page.text).toContain('href="/admin/ledger/sweep"');
    expect(page.text).not.toContain("sweepFrom");
  });

  it("no non-test source says the sweep is one lump (the lump-era sentences are flipped, B17)", () => {
    const patterns = [/LUMP_SWEEP_NOTE/, /lump sweep/i, /one lump amount/i];
    const offenders = FILES.flatMap((f) => patterns.filter((p) => p.test(f.text)).map((p) => `${f.file}: ${p}`));
    expect(offenders).toEqual([]);
  });

  it("the hint, dialog and guide copy that used to say so now describe the itemized sweep", () => {
    const mirror = FILES.find((f) => f.file === "lib/ledger-category-mirror.ts")!;
    expect(mirror.text).toContain("SWEEP_COPY_NOTE");
    const dialog = FILES.find((f) => f.file === "components/admin/ledger/category-mirror-dialog.tsx")!;
    expect(dialog.text).toContain("When a");
    expect(dialog.text).not.toMatch(/ignores it|no copy or donor reaches/);
    const guide = FILES.find((f) => f.file === "components/admin/ledger/guide/itemized-sweep-section.tsx")!;
    expect(guide.text).toContain("Sweeping to the Foundation");
  });
});
