/**
 * POST /api/auth/forgot-password sends the body built by
 * buildPasswordResetEmailHtml() (DECISION-115), so sender and the Email Queue
 * redaction tests share one source; and it sends nothing for an unknown user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { sendEmailMock, createTokenMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => ({ success: true })),
  createTokenMock: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/auth/password-reset", () => ({ createPasswordResetToken: createTokenMock }));

import { POST } from "./route";
import { buildPasswordResetEmailHtml, getAppUrl } from "@/lib/email-compose";

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  sendEmailMock.mockClear();
  createTokenMock.mockReset();
});

describe("POST /api/auth/forgot-password", () => {
  it("passes buildPasswordResetEmailHtml(<appUrl>/reset-password?token=<token>) to sendEmail", async () => {
    createTokenMock.mockResolvedValue("tok123");

    const res = await POST(makeRequest({ email: "member@example.com" }));

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = (sendEmailMock.mock.calls[0] as unknown as [{ to: string; html: string }])[0];
    expect(arg.to).toBe("member@example.com");
    expect(arg.html).toBe(buildPasswordResetEmailHtml(`${getAppUrl()}/reset-password?token=tok123`));
  });

  it("sends nothing when the user does not exist, and still answers success (no enumeration)", async () => {
    createTokenMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ email: "nobody@example.com" }));

    expect(res.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
