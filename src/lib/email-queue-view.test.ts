/**
 * redactQueuedEmailHtml() against the REAL credential-bearing templates
 * (DECISION-115, M1). The bodies come from the same builders the senders use
 * (src/lib/email-compose.ts), so a template change cannot silently outrun the
 * redaction.
 */
import { describe, it, expect, vi } from "vitest";

// password-reset.ts imports @/lib/db at module scope; only its pure generators are used here.
vi.mock("@/lib/db", () => ({ db: {} }));

import { redactQueuedEmailHtml, REDACTED_MARKER } from "./email-queue-view";
import { buildPasswordResetEmailHtml, buildWelcomeSetPasswordEmailHtml } from "./email-compose";
import { generateTempPassword, generateResetToken } from "./auth/password-reset";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("redactQueuedEmailHtml", () => {
  it("hides the token in the real forgot-password body", () => {
    const html = buildPasswordResetEmailHtml(`https://example.com/reset-password?token=${TOKEN}`);
    const out = redactQueuedEmailHtml(html);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain(`reset-password?token=${REDACTED_MARKER}`);
    expect(out).toContain("Password Reset Request");
  });

  it("hides the token in the real welcome-email body and leaves the forgot-password link alone", () => {
    const html = buildWelcomeSetPasswordEmailHtml({
      name: "Pat Example",
      setPasswordUrl: `https://example.com/reset-password?token=${TOKEN}`,
      appUrl: "https://example.com",
    });
    const out = redactQueuedEmailHtml(html);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain(`reset-password?token=${REDACTED_MARKER}`);
    expect(out).toContain('href="https://example.com/forgot-password"');
  });

  it("works on a token produced by the real generator", () => {
    const token = generateResetToken();
    const out = redactQueuedEmailHtml(buildPasswordResetEmailHtml(`https://example.com/reset-password?token=${token}`));
    expect(out).not.toContain(token);
  });

  it("hides an HTML-encoded &amp;token= parameter", () => {
    const html = `<a href="https://example.com/x?a=1&amp;token=SECRETVALUE&amp;b=2">go</a>`;
    const out = redactQueuedEmailHtml(html);
    expect(out).not.toContain("SECRETVALUE");
    expect(out).toContain("&amp;b=2");
  });

  it("hides a renamed parameter (reset_token, access_token, api_key)", () => {
    for (const name of ["reset_token", "access_token", "api_key", "apikey", "sessionId", "client_secret"]) {
      const out = redactQueuedEmailHtml(`<a href="https://example.com/p?${name}=ZZZ-not-hex-9">x</a>`);
      expect(out, name).not.toContain("ZZZ-not-hex-9");
    }
  });

  it("hides a token moved into the path (hex backstop)", () => {
    const out = redactQueuedEmailHtml(`<a href="https://example.com/reset/${TOKEN}">x</a>`);
    expect(out).not.toContain(TOKEN);
  });

  it("hides an XXXX-XXXX-XXXX temporary password and leaves a similar non-credential string alone", () => {
    const pw = generateTempPassword();
    const out = redactQueuedEmailHtml(`<p>Your temporary password is ${pw}</p><p>Ref ABCD-EFGH and abcd-efgh-jklm</p>`);
    expect(out).not.toContain(pw);
    expect(out).toContain("Ref ABCD-EFGH and abcd-efgh-jklm");
  });

  it("is idempotent", () => {
    const html = buildPasswordResetEmailHtml(`https://example.com/reset-password?token=${TOKEN}`);
    const once = redactQueuedEmailHtml(html);
    expect(redactQueuedEmailHtml(once)).toBe(once);
  });

  it("leaves an ordinary email body byte-identical", () => {
    const html = `
      <h2>Spring Fundraiser</h2>
      <p>Join us on Saturday, 5/9 at 10:00 AM at the Community Center, 123 Main St.</p>
      <p><a href="https://example.com/events/3f2b1c9e-8a4d-4e5f-9b6a-7c8d9e0f1a2b">Event details</a></p>
      <p>Yours in service,<br/>Westerville Lions Club</p>`;
    expect(redactQueuedEmailHtml(html)).toBe(html);
  });

  it("finishes in linear time on a long hostile string", () => {
    const hostile = "?a".repeat(50_000) + "&;".repeat(25_000) + "a".repeat(100_000);
    const start = Date.now();
    redactQueuedEmailHtml(hostile);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
