/**
 * Unit tests for src/lib/email-compose.ts (B-46 consolidation).
 *
 * Covers getFromEmail() with/without RESEND_FROM_EMAIL and with/without a
 * display name, getAppUrl() with a trailing slash / without / unset, and
 * that escapeHtml() is re-exported and applies escaping.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getFromEmail, getAppUrl, escapeHtml } from "@/lib/email-compose";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.NEXTAUTH_URL;
}

beforeEach(resetEnv);
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getFromEmail", () => {
  it("falls back to noreply@westervillelions.org when RESEND_FROM_EMAIL is unset", () => {
    expect(getFromEmail()).toBe("noreply@westervillelions.org");
  });

  it("uses RESEND_FROM_EMAIL when set", () => {
    process.env.RESEND_FROM_EMAIL = "club@westervillelions.org";
    expect(getFromEmail()).toBe("club@westervillelions.org");
  });

  it("wraps the address with a display name when one is given", () => {
    expect(getFromEmail("Westerville Lions Club")).toBe(
      "Westerville Lions Club <noreply@westervillelions.org>",
    );
  });

  it("wraps the RESEND_FROM_EMAIL address (not the fallback) when both are given", () => {
    process.env.RESEND_FROM_EMAIL = "club@westervillelions.org";
    expect(getFromEmail("Westerville Lions Club")).toBe(
      "Westerville Lions Club <club@westervillelions.org>",
    );
  });

  it("returns the bare address with no wrapper when displayName is omitted", () => {
    expect(getFromEmail()).not.toContain("<");
  });
});

describe("getAppUrl", () => {
  it("falls back to the absolute production URL when NEXTAUTH_URL is unset", () => {
    expect(getAppUrl()).toBe("https://westervillelions.org");
  });

  it("trims a trailing slash from NEXTAUTH_URL", () => {
    process.env.NEXTAUTH_URL = "https://westervillelions.org/";
    expect(getAppUrl()).toBe("https://westervillelions.org");
  });

  it("leaves a NEXTAUTH_URL with no trailing slash unchanged", () => {
    process.env.NEXTAUTH_URL = "https://staging.westervillelions.org";
    expect(getAppUrl()).toBe("https://staging.westervillelions.org");
  });

  it("never returns an empty string (the broken relative-URL fallback this replaces)", () => {
    expect(getAppUrl()).not.toBe("");
  });

  it("is safe to interpolate a path onto directly", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000/";
    expect(`${getAppUrl()}/reset-password?token=abc`).toBe(
      "http://localhost:3000/reset-password?token=abc",
    );
  });
});

describe("escapeHtml (re-exported)", () => {
  it("is the same function as src/lib/html-escape.ts's escapeHtml", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes a value before it could be composed into an email body", () => {
    expect(escapeHtml(`<a href="javascript:alert(1)">click</a>`)).toBe(
      "&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;",
    );
  });
});
