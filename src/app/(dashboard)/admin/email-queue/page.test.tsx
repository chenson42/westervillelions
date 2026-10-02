/**
 * Page-level tests for the email-queue retention purge (DECISION-107,
 * docs/work-log/2026-10-01-email-queue-retention.md): call order, a swallowed
 * purge failure, the permission gate, and the policy / empty-state copy.
 *
 * Hermetic: the page is an async Server Component, so it is awaited and the
 * returned element rendered with renderToStaticMarkup; the client children
 * and every data dependency are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { calls, state, dialogProps, hasAnyFeatureMock } = vi.hoisted(() => ({
  calls: [] as string[],
  dialogProps: [] as Array<{ html: string }>,
  hasAnyFeatureMock: vi.fn(),
  state: {
    session: { user: { id: "u1" } } as { user?: { id?: string } } | null,
    canManage: true,
    pruneError: null as Error | null,
    rows: [] as unknown[],
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("@/lib/permissions-server", () => ({
  hasAnyFeature: hasAnyFeatureMock.mockImplementation(async () => state.canManage),
}));
vi.mock("@/lib/permissions", () => ({
  EMAIL_QUEUE_FEATURES: ["email_queue.manage", "admin.users"],
}));
vi.mock("@/lib/db/schema", () => ({
  emailQueue: { status: "status", createdAt: "createdAt", sentAt: "sentAt" },
}));
vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const chain = () => {
    calls.push("select");
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.orderBy = () => q;
    q.limit = () => Promise.resolve(state.rows);
    return q;
  };
  return { db: { select: vi.fn(chain) } };
});
vi.mock("@/lib/email-queue-stats", () => ({
  resetStaleRetryingEmails: vi.fn(async () => {
    calls.push("reset");
    return 0;
  }),
  pruneEmailQueue: vi.fn(async () => {
    calls.push("prune");
    if (state.pruneError) throw state.pruneError;
    return 0;
  }),
}));
vi.mock("./retry-button", () => ({ default: () => null }));
vi.mock("./row-retry-button", () => ({ default: () => null }));
vi.mock("./view-email-dialog", () => ({
  ViewEmailDialog: (props: { html: string }) => {
    dialogProps.push(props);
    return null;
  },
  StatusPill: () => null,
}));

import AdminEmailQueuePage from "./page";
import { pruneEmailQueue } from "@/lib/email-queue-stats";

describe("AdminEmailQueuePage retention purge", () => {
  beforeEach(() => {
    calls.length = 0;
    state.session = { user: { id: "u1" } };
    state.canManage = true;
    state.pruneError = null;
    state.rows = [];
    dialogProps.length = 0;
    hasAnyFeatureMock.mockClear();
    vi.mocked(pruneEmailQueue).mockClear();
  });

  it("purges after the reset and before the section queries", async () => {
    await AdminEmailQueuePage();

    expect(calls.slice(0, 3)).toEqual(["reset", "prune", "select"]);
    expect(calls.filter((c) => c === "select")).toHaveLength(3);
  });

  it("still renders (does not throw) when pruneEmailQueue rejects", async () => {
    state.pruneError = new Error("db hiccup");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const element = await AdminEmailQueuePage();

    expect(renderToStaticMarkup(element)).toContain("Email Queue");
    expect(calls.filter((c) => c === "select")).toHaveLength(3);
    expect(errSpy).toHaveBeenCalledWith("[email-queue] retention purge failed", state.pruneError);
    errSpy.mockRestore();
  });

  it("does not purge for a user without EMAIL_QUEUE_MANAGE (or ADMIN_USERS), nor for an unauthenticated session", async () => {
    state.canManage = false;
    await expect(AdminEmailQueuePage()).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(pruneEmailQueue).not.toHaveBeenCalled();

    state.session = null;
    await expect(AdminEmailQueuePage()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(pruneEmailQueue).not.toHaveBeenCalled();
  });

  it("shows the retention policy note and the new empty-state copy", async () => {
    const html = renderToStaticMarkup(await AdminEmailQueuePage());

    expect(html).toContain(
      "Email history is kept for 6 months. Older messages are removed automatically when this page is opened."
    );
    expect(html).toContain("No emails sent in the last 6 months.");
    expect(html).not.toContain("No emails sent yet.");
  });

  it("gates on EMAIL_QUEUE_MANAGE or ADMIN_USERS (one release), via hasAnyFeature", async () => {
    await AdminEmailQueuePage();

    expect(hasAnyFeatureMock).toHaveBeenCalledWith("u1", ["email_queue.manage", "admin.users"]);
  });

  it("hands ViewEmailDialog redacted html for failed, blocked and sent rows; the token never reaches a prop or the markup", async () => {
    const token = "c0ffee".repeat(11);
    state.rows = [
      {
        id: "r1",
        to: "x@example.com",
        cc: null,
        bcc: null,
        subject: "Reset your password",
        status: "failed",
        attempts: 1,
        nextRetryAt: null,
        createdAt: new Date(),
        sentAt: new Date(),
        lastError: null,
        html: `<a href="https://example.com/reset-password?token=${token}">Reset</a>`,
      },
    ];

    const markup = renderToStaticMarkup(await AdminEmailQueuePage());

    // One row per section query (failed, blocked, sent) -> three dialogs.
    expect(dialogProps).toHaveLength(3);
    for (const props of dialogProps) {
      expect(props.html).not.toContain(token);
      expect(props.html).toContain("reset-password?token=[hidden]");
    }
    expect(markup).not.toContain(token);
  });
});
