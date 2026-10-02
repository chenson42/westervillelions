/**
 * The new-member provisioning path sends the body built by
 * buildWelcomeSetPasswordEmailHtml() (DECISION-115): sender and the Email Queue
 * redaction tests share one source, so a template change cannot drift from the
 * redaction. Hermetic: db, sendEmail and the token generator are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const TOKEN = "ab".repeat(32);

vi.mock("@/lib/email", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/auth/password-reset", () => ({ generateResetToken: () => TOKEN }));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn(async () => undefined) },
      roles: { findFirst: vi.fn(async () => undefined) },
    },
    // Resolves both `await db.insert(t).values(v)` and `.values(v).returning()`.
    insert: vi.fn(() => ({
      values: () => {
        const p = Promise.resolve([{ id: "user-1" }]) as Promise<unknown> & { returning: () => Promise<unknown> };
        p.returning = async () => [{ id: "user-1" }];
        return p;
      },
    })),
    update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  },
}));

import { provisionUserForMember } from "./members";
import { buildWelcomeSetPasswordEmailHtml, getAppUrl } from "./email-compose";

beforeEach(() => {
  sendEmailMock.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("provisionUserForMember welcome email", () => {
  it("passes buildWelcomeSetPasswordEmailHtml(...) to sendEmail", async () => {
    const result = await provisionUserForMember({
      email: "New.Member@example.com",
      firstName: "New",
      lastName: "Member",
      memberId: "member-1",
    });

    expect(result.wasExisting).toBe(false);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const arg = (sendEmailMock.mock.calls[0] as unknown as [{ to: string; html: string }])[0];
    expect(arg.to).toBe("New.Member@example.com");
    expect(arg.html).toBe(
      buildWelcomeSetPasswordEmailHtml({
        name: "New Member",
        setPasswordUrl: `${getAppUrl()}/reset-password?token=${TOKEN}`,
        appUrl: getAppUrl(),
      }),
    );
  });
});
