/**
 * Unit tests for src/lib/minutes.ts
 *
 * Covers the pure constants/validators + kind->email map built as part of
 * database-admin's Phase 4 scope (docs/work-log/2026-08-08-meeting-minutes.md).
 * All tests are pure (no DB).
 */

import { describe, it, expect } from "vitest";
import {
  MINUTES_KINDS,
  isValidMinutesKind,
  MINUTES_STATUSES,
  isValidMinutesStatus,
  MOTION_RESULTS,
  isValidMotionResult,
  MINUTES_KIND_EMAIL,
  escapeIlikeTerm,
  resolveMinutesEmailTarget,
  extractSnippet,
  minutesSearchMatchFieldLabel,
  resolveYearParam,
  nearestFiscalYearWithData,
} from "@/lib/minutes";

describe("isValidMinutesKind", () => {
  it("accepts every seeded kind", () => {
    for (const kind of MINUTES_KINDS) {
      expect(isValidMinutesKind(kind)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    expect(isValidMinutesKind("committee")).toBe(false);
    expect(isValidMinutesKind("Board")).toBe(false); // case-sensitive
    expect(isValidMinutesKind("general ")).toBe(false); // no trimming
  });

  it("rejects the empty string", () => {
    expect(isValidMinutesKind("")).toBe(false);
  });
});

describe("isValidMinutesStatus", () => {
  it("accepts 'draft' and 'approved' only", () => {
    expect(isValidMinutesStatus("draft")).toBe(true);
    expect(isValidMinutesStatus("approved")).toBe(true);
    expect(MINUTES_STATUSES).toEqual(["draft", "approved"]);
  });

  it("rejects anything else", () => {
    expect(isValidMinutesStatus("pending")).toBe(false);
    expect(isValidMinutesStatus("rejected")).toBe(false);
    expect(isValidMinutesStatus("")).toBe(false);
  });
});

describe("isValidMotionResult", () => {
  it("accepts exactly the four MOTION_RESULTS values", () => {
    expect(MOTION_RESULTS).toEqual(["passed", "failed", "tabled", "withdrawn"]);
    for (const result of MOTION_RESULTS) {
      expect(isValidMotionResult(result)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    expect(isValidMotionResult("carried")).toBe(false);
    expect(isValidMotionResult("PASSED")).toBe(false);
    expect(isValidMotionResult("")).toBe(false);
  });
});

describe("MINUTES_KIND_EMAIL", () => {
  it("maps 'board' to board@westervillelions.org, no approval required", () => {
    expect(MINUTES_KIND_EMAIL.board).toEqual({
      address: "board@westervillelions.org",
      requiresApproval: false,
    });
  });

  it("maps 'general' to the club group email, approval required", () => {
    expect(MINUTES_KIND_EMAIL.general).toEqual({
      address: "club@westervillelions.org",
      requiresApproval: true,
    });
  });

  it("is partial — every mapped key is a real MinutesKind", () => {
    for (const key of Object.keys(MINUTES_KIND_EMAIL)) {
      expect(isValidMinutesKind(key)).toBe(true);
    }
  });
});

// Phase 3 Unit Test item 1 — escapeIlikeTerm() — regression guard against
// ILIKE wildcard/escape injection from a member-typed search query.
describe("escapeIlikeTerm", () => {
  it("escapes %, _, and \\", () => {
    expect(escapeIlikeTerm("50%")).toBe("50\\%");
    expect(escapeIlikeTerm("a_b")).toBe("a\\_b");
    expect(escapeIlikeTerm("a\\b")).toBe("a\\\\b");
  });

  it("escapes backslash first so a literal percent doesn't get double-escaped", () => {
    // If % were escaped before \, "50%" -> "50\%" -> re-escaping the new
    // backslash would corrupt it into "50\\%". Backslash-first avoids this.
    expect(escapeIlikeTerm("100%\\done")).toBe("100\\%\\\\done");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeIlikeTerm("March meeting")).toBe("March meeting");
  });
});

// Phase 3 Unit Test item 1 — resolveMinutesEmailTarget() — the full
// kind x status gating table as five direct assertions.
describe("resolveMinutesEmailTarget", () => {
  it("board + draft: allowed, board@, DRAFT banner shown", () => {
    const result = resolveMinutesEmailTarget("board", "draft");
    expect(result).toEqual({
      allowed: true,
      address: "board@westervillelions.org",
      showDraftBanner: true,
    });
  });

  it("board + approved: allowed, board@, no banner", () => {
    const result = resolveMinutesEmailTarget("board", "approved");
    expect(result).toEqual({
      allowed: true,
      address: "board@westervillelions.org",
      showDraftBanner: false,
    });
  });

  it("general + draft: blocked with the approval-required reason", () => {
    const result = resolveMinutesEmailTarget("general", "draft");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("This kind can only be emailed once minutes are approved.");
    }
  });

  it("general + approved: allowed, club group address, no banner", () => {
    const result = resolveMinutesEmailTarget("general", "approved");
    expect(result).toEqual({
      allowed: true,
      address: "club@westervillelions.org",
      showDraftBanner: false,
    });
  });

  it("unmapped kind: blocked, no address offered, regardless of status", () => {
    const result = resolveMinutesEmailTarget("committee", "draft");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("This minutes kind has no configured recipient.");
    }
  });
});

// ---------------------------------------------------------------------------
// extractSnippet — 2026-09-09 year-pills/search-context feature, Phase 3
// Unit Tests items 5-10.
// ---------------------------------------------------------------------------

describe("extractSnippet", () => {
  it("match at the very start of the text -> no leading ellipsis, matchStart === 0", () => {
    const text = "Quorum was met and the meeting began promptly at seven o'clock in the evening.";
    const result = extractSnippet(text, "Quorum");
    expect(result).not.toBeNull();
    expect(result?.excerpt.startsWith("…")).toBe(false);
    expect(result?.matchStart).toBe(0);
    expect(result?.matchLength).toBe(6);
  });

  it("match at the very end of the text -> no trailing ellipsis", () => {
    const text = `${"A".repeat(80)}quorum`;
    const result = extractSnippet(text, "quorum");
    expect(result).not.toBeNull();
    expect(result?.excerpt.endsWith("…")).toBe(false);
    expect(result?.excerpt.endsWith("quorum")).toBe(true);
  });

  it("match plus surrounding text entirely shorter than the window -> whole text returned, no ellipsis on either side", () => {
    const text = "Short text with quorum in it.";
    const result = extractSnippet(text, "quorum");
    expect(result).not.toBeNull();
    expect(result?.excerpt).toBe(text);
    expect(result?.excerpt.startsWith("…")).toBe(false);
    expect(result?.excerpt.endsWith("…")).toBe(false);
  });

  it("text with no occurrence of the term -> returns null", () => {
    expect(extractSnippet("Nothing relevant here.", "pancake")).toBeNull();
  });

  it("term containing ILIKE wildcards (%, _) is found via literal substring match — proves the raw/unescaped term is searched, not escapeIlikeTerm()'s output", () => {
    const text = "Get 50%_off your next purchase!";
    const result = extractSnippet(text, "50%_off");
    expect(result).not.toBeNull();
    expect(result?.matchLength).toBe(7);
    expect(result?.excerpt).toContain("50%_off");
  });

  it("case-insensitive match", () => {
    const text = "A Quorum was present at the meeting.";
    const result = extractSnippet(text, "quorum");
    expect(result).not.toBeNull();
    expect(result?.excerpt).toContain("Quorum");
  });
});

// ---------------------------------------------------------------------------
// minutesSearchMatchFieldLabel
// ---------------------------------------------------------------------------

describe("minutesSearchMatchFieldLabel", () => {
  it("maps each matched field to its display label", () => {
    expect(minutesSearchMatchFieldLabel("body")).toBe("Minutes text");
    expect(minutesSearchMatchFieldLabel("motion")).toBe("Motion");
    expect(minutesSearchMatchFieldLabel("action_item")).toBe("Action item");
  });
});

// ---------------------------------------------------------------------------
// resolveYearParam — 2026-09-09 year-pills feature, Phase 3 Unit Tests
// items 11-16.
// ---------------------------------------------------------------------------

describe("resolveYearParam", () => {
  const currentFY = 2026;
  const knownYears = [2025, 2024]; // deliberately does NOT include currentFY

  it("raw undefined -> the default: { year: currentFY, isAll: false }", () => {
    expect(resolveYearParam(undefined, knownYears, currentFY)).toEqual({
      year: currentFY,
      isAll: false,
    });
  });

  it('raw === "all" -> isAll: true', () => {
    const result = resolveYearParam("all", knownYears, currentFY);
    expect(result.isAll).toBe(true);
  });

  it("raw is a numeric string equal to a known year (in knownYears but not currentFY) -> that year, isAll: false", () => {
    expect(resolveYearParam("2025", knownYears, currentFY)).toEqual({
      year: 2025,
      isAll: false,
    });
  });

  it('raw is garbage ("banana") -> falls back to the default', () => {
    expect(resolveYearParam("banana", knownYears, currentFY)).toEqual({
      year: currentFY,
      isAll: false,
    });
  });

  it('raw is a well-formed number but NOT in knownYears and not currentFY ("1900") -> same fallback as garbage — the two failure cases in Flow 2 are handled identically', () => {
    expect(resolveYearParam("1900", knownYears, currentFY)).toEqual({
      year: currentFY,
      isAll: false,
    });
  });

  it("raw === String(currentFY) -> resolves to currentFY even when it has zero records (not required to appear in knownYears)", () => {
    expect(resolveYearParam(String(currentFY), knownYears, currentFY)).toEqual({
      year: currentFY,
      isAll: false,
    });
  });
});

// ---------------------------------------------------------------------------
// nearestFiscalYearWithData — 2026-09-09 year-pills feature, Phase 3 Unit
// Tests items 17-20.
// ---------------------------------------------------------------------------

describe("nearestFiscalYearWithData", () => {
  it("empty candidates -> null", () => {
    expect(nearestFiscalYearWithData(2026, [])).toBeNull();
  });

  it("a single candidate -> that candidate, regardless of distance", () => {
    expect(nearestFiscalYearWithData(2026, [2019])).toBe(2019);
  });

  it("multiple candidates on both sides of target -> picks the closer one", () => {
    // target 2026; 2024 is distance 2, 2028 is distance 2... use asymmetric
    // distances so there's exactly one closest candidate.
    expect(nearestFiscalYearWithData(2026, [2023, 2025, 2030])).toBe(2025);
  });

  it("a tie in distance -> picks the more recent (larger) year", () => {
    // target 2026; 2024 and 2028 are both distance 2.
    expect(nearestFiscalYearWithData(2026, [2024, 2028])).toBe(2028);
  });
});
