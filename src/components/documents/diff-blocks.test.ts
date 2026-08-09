import { describe, it, expect } from "vitest";
import { diffLines } from "diff";
import { buildDiffBlocks, countChangeRegions } from "./diff-blocks";

describe("buildDiffBlocks / countChangeRegions", () => {
  it("identical input produces a single context block and zero change regions", () => {
    const text = "line one\nline two\nline three\n";
    const diff = diffLines(text, text, { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("context");
    expect(countChangeRegions(blocks)).toBe(0);
  });

  it("a single changed line in the middle produces exactly one change region, surrounded by context", () => {
    const before = "alpha\nbravo\ncharlie\n";
    const after = "alpha\nBRAVO\ncharlie\n";
    const diff = diffLines(before, after, { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    expect(countChangeRegions(blocks)).toBe(1);

    const changeBlocks = blocks.filter((b) => b.kind === "change");
    expect(changeBlocks).toHaveLength(1);
    // The change region carries both the removed old line and the added new
    // line — jsdiff's own shape, not merged into a single "modified" row.
    const region = changeBlocks[0];
    if (region.kind !== "change") throw new Error("expected a change block");
    expect(region.regionNumber).toBe(1);
    expect(region.lines.map((l) => l.type)).toEqual(["removed", "added"]);
    expect(region.lines.map((l) => l.text)).toEqual(["bravo", "BRAVO"]);

    // context appears on both sides of the change.
    const contextBlocks = blocks.filter((b) => b.kind === "context");
    expect(contextBlocks).toHaveLength(2);
  });

  it("multiple separate changes are numbered in document order", () => {
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "ONE\ntwo\nthree\nFOUR\nfive\n";
    const diff = diffLines(before, after, { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    expect(countChangeRegions(blocks)).toBe(2);

    const regionNumbers = blocks
      .filter((b): b is Extract<typeof blocks[number], { kind: "change" }> => b.kind === "change")
      .map((b) => b.regionNumber);
    expect(regionNumbers).toEqual([1, 2]);
  });

  it("a pure insertion (no removed lines) still produces one change region", () => {
    const before = "alpha\ncharlie\n";
    const after = "alpha\nbravo\ncharlie\n";
    const diff = diffLines(before, after, { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    expect(countChangeRegions(blocks)).toBe(1);
    const region = blocks.find((b) => b.kind === "change");
    if (!region || region.kind !== "change") throw new Error("expected a change block");
    expect(region.lines).toEqual([{ type: "added", text: "bravo" }]);
  });

  it("a trailing-newline-only difference stays confined to the last line, never spilling into earlier lines (mirrors documents.test.ts's stability guard)", () => {
    const before = "alpha\nbravo\n";
    const after = "alpha\nbravo";
    const diff = diffLines(before, after, { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    // jsdiff legitimately treats a trailing-newline-only difference as a
    // one-line change (the pre-existing documents.test.ts guard already
    // accepts up to a removed+added pair here) — the regression risk this
    // guards against is that difference spilling into "alpha", not that no
    // change is reported at all.
    expect(countChangeRegions(blocks)).toBeLessThanOrEqual(1);
    for (const block of blocks) {
      if (block.kind === "change") {
        expect(block.lines.every((l) => l.text === "bravo")).toBe(true);
      }
    }
  });

  it("does not emit a phantom empty-string line at the end of a chunk that ends with a newline", () => {
    const diff = diffLines("alpha\nbravo\n", "alpha\nbravo\n", { newlineIsToken: false });
    const blocks = buildDiffBlocks(diff);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind !== "context") throw new Error("expected a context block");
    expect(blocks[0].lines.map((l) => l.text)).toEqual(["alpha", "bravo"]);
  });
});
