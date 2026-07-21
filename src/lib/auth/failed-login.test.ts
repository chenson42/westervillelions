/**
 * Unit tests for the pure helpers in src/lib/auth/failed-login.ts —
 * Failed Login Visibility (Phase 3 design doc, Named Unit Tests section).
 *
 * All five tests here are pure (no DB) per the design doc's explicit intent
 * that pruneCutoff() correctness not depend on a live connection.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the DB module before any import that touches it. pruneCutoff() and
// normalizeAttemptedEmail() are pure functions with no DB dependency, but
// failed-login.ts imports `db` at module scope (for recordFailedLogin) — the
// mock prevents the DB connection attempt during unit tests. Same pattern as
// src/lib/permissions-server.test.ts.
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

import {
  pruneCutoff,
  normalizeAttemptedEmail,
  FAILED_LOGIN_REASONS,
  FAILED_LOGIN_REASON_LABELS,
} from "./failed-login";

describe("pruneCutoff", () => {
  it("returns exactly now - 90 days given a fixed injected now", () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    const result = pruneCutoff(now);
    expect(now.getTime() - result.getTime()).toBe(expectedMs);
  });
});

describe("normalizeAttemptedEmail", () => {
  it("truncates a value longer than 255 characters down to exactly 255 characters", () => {
    const longEmail = "a".repeat(300) + "@example.com";
    const result = normalizeAttemptedEmail(longEmail);
    expect(result.length).toBe(255);
    expect(result).toBe(longEmail.slice(0, 255));
  });

  it('returns the "(none provided)" placeholder for null, undefined, empty string, and whitespace-only input', () => {
    expect(normalizeAttemptedEmail(null)).toBe("(none provided)");
    expect(normalizeAttemptedEmail(undefined)).toBe("(none provided)");
    expect(normalizeAttemptedEmail("")).toBe("(none provided)");
    expect(normalizeAttemptedEmail("   \t\n  ")).toBe("(none provided)");
  });

  it("passes through HTML/script-like characters unescaped but still enforces the 255-char cap", () => {
    const malicious = "<script>alert(1)</script>@evil.com";
    const result = normalizeAttemptedEmail(malicious);
    // Storage doesn't sanitize; rendering does (React JSX auto-escaping at
    // the admin-page layer, never dangerouslySetInnerHTML).
    expect(result).toBe(malicious);

    const longMalicious = "<img src=x onerror=alert(1)>".repeat(20);
    const longResult = normalizeAttemptedEmail(longMalicious);
    expect(longResult.length).toBe(255);
    expect(longResult).toBe(longMalicious.slice(0, 255));
  });
});

describe("FAILED_LOGIN_REASONS / FAILED_LOGIN_REASON_LABELS enum completeness", () => {
  it("has a label for every reason, and no orphan labels in either direction", () => {
    const reasonSet = new Set<string>(FAILED_LOGIN_REASONS);
    const labelKeys = Object.keys(FAILED_LOGIN_REASON_LABELS);
    const labelKeySet = new Set(labelKeys);

    for (const reason of FAILED_LOGIN_REASONS) {
      expect(labelKeySet.has(reason)).toBe(true);
    }
    for (const key of labelKeys) {
      expect(reasonSet.has(key)).toBe(true);
    }
    expect(labelKeys.length).toBe(FAILED_LOGIN_REASONS.length);
  });
});
