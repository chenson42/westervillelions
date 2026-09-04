import { describe, it, expect } from "vitest";
import { fuzzyMatch, matchNavEntry } from "./fuzzy-match";

describe("fuzzyMatch", () => {
  it("matches an exact string with positions covering every character", () => {
    const result = fuzzyMatch("dues", "Dues");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 1, 2, 3]);
  });

  it("is case-insensitive in both directions", () => {
    expect(fuzzyMatch("LEDGER", "ledger")).not.toBeNull();
    expect(fuzzyMatch("ledger", "LEDGER")).not.toBeNull();
    expect(fuzzyMatch("EmAiL", "Email Queue")).not.toBeNull();
  });

  it("returns null when the query is not a subsequence of the target", () => {
    expect(fuzzyMatch("xyz", "Members")).toBeNull();
    expect(fuzzyMatch("memberss", "Members")).toBeNull(); // longer than any alignment
  });

  it("returns null for an empty or whitespace-only query (callers treat that as 'no filtering')", () => {
    expect(fuzzyMatch("", "Members")).toBeNull();
    expect(fuzzyMatch("   ", "Members")).toBeNull();
  });

  it("matches a scattered subsequence and reports original-string positions", () => {
    const result = fuzzyMatch("gd", "Governing Documents");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([0, 10]); // G of Governing, D of Documents
  });

  it("scores a prefix match above the same query matched mid-string", () => {
    const prefix = fuzzyMatch("re", "Reports");
    const midWord = fuzzyMatch("re", "parent"); // contiguous 're' but inside the word
    expect(prefix).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(prefix!.score).toBeGreaterThan(midWord!.score);
  });

  it("scores a word-start match above a mid-word match", () => {
    const wordStart = fuzzyMatch("no", "Release Notes"); // N of Notes, word boundary
    const midWord = fuzzyMatch("no", "Announcements"); // 'n','o' inside the word
    expect(wordStart).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(wordStart!.score).toBeGreaterThan(midWord!.score);
  });

  it("scores a contiguous run above the same letters scattered (both mid-word, no boundary bonuses)", () => {
    const contiguous = fuzzyMatch("log", "catalog"); // l-o-g contiguous inside the word
    const scattered = fuzzyMatch("log", "flowing"); // l...o...g scattered inside the word
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("picks the best-scoring alignment, not the first-occurrence greedy one", () => {
    // In "Release Notes", a greedy first-occurrence match of "es" lands on
    // e@1 + s@5 (scattered); the contiguous "es" at the end of "Notes"
    // (positions 11,12) scores higher and must win.
    const result = fuzzyMatch("es", "Release Notes");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([11, 12]);
  });

  it("treats hyphens as word boundaries", () => {
    const result = fuzzyMatch("l", "by-laws");
    expect(result).not.toBeNull();
    expect(result!.positions).toEqual([3]); // l after the hyphen, word start
  });
});

describe("matchNavEntry", () => {
  it("matches on the label and returns label positions for highlighting", () => {
    const result = matchNavEntry("dues", { label: "Dues", keywords: ["payments"] });
    expect(result).not.toBeNull();
    expect(result!.labelPositions).toEqual([0, 1, 2, 3]);
  });

  it("matches on a keyword with null labelPositions (nothing visible to highlight)", () => {
    const result = matchNavEntry("money", {
      label: "Ledger",
      keywords: ["money", "accounting", "books"],
    });
    expect(result).not.toBeNull();
    expect(result!.labelPositions).toBeNull();
  });

  it("matches on the group header when neither label nor keywords match", () => {
    const result = matchNavEntry("treasury", {
      label: "Dues",
      group: "Treasury",
      keywords: ["payments"],
    });
    expect(result).not.toBeNull();
    expect(result!.labelPositions).toBeNull();
  });

  it("ranks a label match above a keyword match for the same query", () => {
    const labelHit = matchNavEntry("m", { label: "Members" });
    const keywordHit = matchNavEntry("m", { label: "Ledger", keywords: ["money"] });
    expect(labelHit).not.toBeNull();
    expect(keywordHit).not.toBeNull();
    expect(labelHit!.score).toBeGreaterThan(keywordHit!.score);
  });

  it("ranks a keyword match above a group match for the same query", () => {
    const keywordHit = matchNavEntry("s", { label: "Ledger", keywords: ["statements"] });
    const groupHit = matchNavEntry("s", { label: "Contact", group: "System" });
    expect(keywordHit).not.toBeNull();
    expect(groupHit).not.toBeNull();
    expect(keywordHit!.score).toBeGreaterThan(groupHit!.score);
  });

  it("returns null when nothing matches", () => {
    expect(
      matchNavEntry("zzz", { label: "Dues", group: "Treasury", keywords: ["payments"] })
    ).toBeNull();
  });

  it("handles entries with no keywords and no group", () => {
    expect(matchNavEntry("em", { label: "Email Queue" })).not.toBeNull();
    expect(matchNavEntry("zz", { label: "Email Queue" })).toBeNull();
  });
});
