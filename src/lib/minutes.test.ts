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
