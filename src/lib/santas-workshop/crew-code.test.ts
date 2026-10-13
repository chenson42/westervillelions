import { describe, expect, it } from "vitest";
import { checkCrewCode, CREW_CODE_ALPHABET, CREW_CODE_LENGTH, decryptCrewCode, encryptCrewCode, formatCrewCode, generateCrewCode, normalizeCrewCodeInput } from "./crew-code";
import { deriveKey } from "./crew-secret";

const key = deriveKey("test-secret-one", "code");
const otherKey = deriveKey("test-secret-two", "code");

describe("worker code", () => {
  it("the alphabet excludes 0 O 1 I L", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) expect(CREW_CODE_ALPHABET).not.toContain(ch);
  });

  it("generated codes are at least 8 characters from the alphabet", () => {
    expect(CREW_CODE_LENGTH).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < 50; i += 1) {
      const code = generateCrewCode();
      expect(code).toHaveLength(CREW_CODE_LENGTH);
      for (const ch of code) expect(CREW_CODE_ALPHABET).toContain(ch);
    }
  });

  it("encrypt/decrypt round trip", () => {
    const code = generateCrewCode();
    expect(decryptCrewCode(encryptCrewCode(code, key), key)).toBe(code);
  });

  it("the same code encrypts to different ciphertexts", () => {
    expect(encryptCrewCode("ABCD2345", key)).not.toBe(encryptCrewCode("ABCD2345", key));
  });

  it("a wrong key fails (null), never throws", () => {
    expect(decryptCrewCode(encryptCrewCode("ABCD2345", key), otherKey)).toBeNull();
  });

  it("malformed or tampered ciphertext is null", () => {
    expect(decryptCrewCode(null, key)).toBeNull();
    expect(decryptCrewCode("", key)).toBeNull();
    expect(decryptCrewCode("v1.a.b", key)).toBeNull();
    const enc = encryptCrewCode("ABCD2345", key);
    const [v, n, c, t] = enc.split(".");
    expect(decryptCrewCode([v, n, `${c}A`, t].join("."), key)).toBeNull();
  });

  it("entry normalization: case, spaces and hyphens", () => {
    expect(normalizeCrewCodeInput(" abcd-ef 23 ")).toBe("ABCDEF23");
    expect(formatCrewCode("ABCDEF23")).toBe("ABCD-EF23");
  });

  it("checkCrewCode: match, mismatch, and unreadable (regenerate, not a crash)", () => {
    const enc = encryptCrewCode("ABCDEF23", key);
    expect(checkCrewCode(enc, "abcd-ef23", key)).toBe("match");
    expect(checkCrewCode(enc, "ABCDEF24", key)).toBe("mismatch");
    expect(checkCrewCode(enc, "ABC", key)).toBe("mismatch");
    expect(checkCrewCode(enc, "ABCDEF23", otherKey)).toBe("unreadable");
    expect(checkCrewCode(null, "ABCDEF23", key)).toBe("unreadable");
  });
});
