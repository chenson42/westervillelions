/**
 * Unit tests for src/lib/email-compose.ts (B-46 consolidation).
 *
 * Covers getFromEmail() with/without RESEND_FROM_EMAIL and with/without a
 * display name, getAppUrl() with a trailing slash / without / unset, and
 * that escapeHtml() is re-exported and applies escaping.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getFromEmail,
  getAppUrl,
  escapeHtml,
  buildPasswordResetEmailHtml,
  buildWelcomeSetPasswordEmailHtml,
  buildPendingApprovalEmailHtml,
  buildApprovalReviewUrl,
} from "@/lib/email-compose";

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

describe("credential-bearing email body builders", () => {
  const url = "https://example.com/reset-password?token=abc123";

  it("buildPasswordResetEmailHtml includes the URL exactly once", () => {
    const html = buildPasswordResetEmailHtml(url);
    expect(html.split(url)).toHaveLength(2);
    expect(html).toContain("Password Reset Request");
  });

  it("buildWelcomeSetPasswordEmailHtml includes the URL once and HTML-escapes the member name", () => {
    const html = buildWelcomeSetPasswordEmailHtml({
      name: "<script>alert(1)</script>",
      setPasswordUrl: url,
      appUrl: "https://example.com",
    });
    expect(html.split(url)).toHaveLength(2);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("https://example.com/forgot-password");
  });
});

describe("buildPendingApprovalEmailHtml", () => {
  const base = {
    noun: "disbursement" as const,
    amountDollars: "2275.00",
    txnDate: "2026-10-09",
    reviewUrl: "https://example.com/admin/ledger/approvals",
  };

  it("escapes party and memo", () => {
    const html = buildPendingApprovalEmailHtml({
      ...base,
      party: "<img src=x onerror=1>",
      memo: "<script>alert(1)</script> & more",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });

  it("omits the Payee and Memo lines when absent", () => {
    const html = buildPendingApprovalEmailHtml({ ...base, party: null, memo: undefined });
    expect(html).not.toContain("Payee");
    expect(html).not.toContain("Memo");
    expect(html).toContain("<strong>Amount:</strong> $2275.00");
    expect(html).toContain("<strong>Date:</strong> 2026-10-09");
  });

  it("uses the given reviewUrl verbatim as the link href (no escaping of &)", () => {
    const url = "https://example.com/admin/ledger/approvals?a=1&b=2";
    const html = buildPendingApprovalEmailHtml({ ...base, reviewUrl: url });
    expect(html).toContain(`<a href="${url}">Approvals screen</a>`);
  });

  it("reads 'A sweep requires board approval' for noun sweep, and the noun in the call to action", () => {
    const html = buildPendingApprovalEmailHtml({ ...base, noun: "sweep" });
    expect(html).toContain("<p>A sweep requires board approval before it can be posted.</p>");
    expect(html).toContain("approve or reject this sweep from the");
  });

  it("does not escape amountDollars or txnDate", () => {
    const html = buildPendingApprovalEmailHtml({ ...base, amountDollars: "1&2", txnDate: "<d>" });
    expect(html).toContain("$1&2");
    expect(html).toContain("<d>");
  });
});

describe("buildPendingApprovalEmailHtml (one-approval sentence)", () => {
  const input = {
    noun: "transfer" as const,
    amountDollars: "10.00",
    txnDate: "2026-10-09",
    reviewUrl: "https://example.com/admin/ledger/approvals?txn=abc",
  };
  it("appends the 2b sentence unconditionally and not the 2a sentence", () => {
    for (const noun of ["disbursement", "transfer", "sweep"] as const) {
      const html = buildPendingApprovalEmailHtml({ ...input, noun });
      expect(html).toContain(
        "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too.",
      );
      expect(html).not.toContain("If a colleague has already acted");
    }
  });
});

describe("buildApprovalReviewUrl", () => {
  it("deep-links with ?txn= when given an id, and falls back to the plain URL", () => {
    process.env.NEXTAUTH_URL = "https://example.com";
    expect(buildApprovalReviewUrl("00000000-0000-4000-8000-000000000001")).toBe(
      "https://example.com/admin/ledger/approvals?txn=00000000-0000-4000-8000-000000000001",
    );
    expect(buildApprovalReviewUrl(undefined)).toBe("https://example.com/admin/ledger/approvals");
    expect(buildApprovalReviewUrl(null)).toBe("https://example.com/admin/ledger/approvals");
  });
});
