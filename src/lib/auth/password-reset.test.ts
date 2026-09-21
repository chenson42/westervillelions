/**
 * Unit tests for generateTempPassword() and hashPassword() —
 * docs/work-log/2026-09-18-admin-account-reset.md Phase 3 "Unit Tests",
 * items 1-6 on src/lib/auth/password-reset.test.ts.
 *
 * password-reset.ts imports `db` at module scope (for the token functions),
 * so the DB is mocked out here even though generateTempPassword/hashPassword
 * are pure/bcrypt-only and never touch it — same pattern as
 * src/lib/auth/failed-login.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

vi.mock("@/lib/db", () => ({
  db: {
    query: { users: { findFirst: vi.fn() }, passwordResetTokens: { findFirst: vi.fn() } },
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}));

import { generateTempPassword, hashPassword } from "./password-reset";

const TEMP_PASSWORD_REGEX = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const BCRYPT_COST = 10;

describe("generateTempPassword", () => {
  it("test 1: returns a 14-char string matching XXXX-XXXX-XXXX over the restricted alphabet", () => {
    const password = generateTempPassword();
    expect(password).toHaveLength(14);
    expect(password).toMatch(TEMP_PASSWORD_REGEX);
  });

  it("test 2: across a large sample, never contains I, O, 0, 1, or any lowercase letter", () => {
    for (let i = 0; i < 5000; i++) {
      const password = generateTempPassword();
      expect(password).not.toMatch(/[IO01]/);
      expect(password).not.toMatch(/[a-z]/);
      expect(password).toMatch(TEMP_PASSWORD_REGEX);
    }
  });

  it("test 3: bias check — over a large sample, each of the 32 alphabet characters appears with roughly uniform frequency (no modulo bias)", () => {
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const counts: Record<string, number> = {};
    for (const ch of ALPHABET) counts[ch] = 0;

    const SAMPLES = 10000;
    let totalChars = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const chars = generateTempPassword().replace(/-/g, "");
      for (const ch of chars) {
        counts[ch] = (counts[ch] ?? 0) + 1;
        totalChars++;
      }
    }

    const expectedFreq = totalChars / ALPHABET.length;
    const tolerance = expectedFreq * 0.3; // +/-30%, loose but catches modulo bias / a broken bitmask
    for (const ch of ALPHABET) {
      expect(counts[ch]).toBeGreaterThan(expectedFreq - tolerance);
      expect(counts[ch]).toBeLessThan(expectedFreq + tolerance);
    }
  });

  it("test 4: two consecutive calls return different values", () => {
    const a = generateTempPassword();
    const b = generateTempPassword();
    expect(a).not.toBe(b);
  });
});

describe("hashPassword", () => {
  it("test 5: returns a bcrypt hash with the $2 prefix and the BCRYPT_COST cost segment", async () => {
    const hash = await hashPassword("Sample-Plain-Text1");
    expect(hash).toMatch(/^\$2[aby]?\$/);
    expect(hash).toContain(`$${BCRYPT_COST}$`);
  });

  it("test 6: bcrypt.compare resolves true for the original plaintext and false for a different string", async () => {
    const plain = "XKCD-Horse-Battery9";
    const hash = await hashPassword(plain);
    await expect(bcrypt.compare(plain, hash)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-value", hash)).resolves.toBe(false);
  });
});
