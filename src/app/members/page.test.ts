/**
 * Unit tests for /members's new permission gate (Printable Member
 * Directory, docs/work-log/2026-08-07-printable-member-directory.md,
 * Treasurer Decision #1): this page previously had no `hasFeature()` check
 * at all — any signed-in session, including a zero-role account
 * `/access-pending` exists to catch, could read every member's contact
 * details (now including home address). This test proves the gate exists
 * and runs BEFORE any member data is ever queried — never fetch-then-hide.
 *
 * Hermetic: calls the page's default export directly (same technique as
 * src/app/(dashboard)/admin/ledger/search/page.test.ts), mocking @/lib/auth,
 * @/lib/permissions-server, @/lib/db, and every child component the page
 * renders. `redirect()` is mocked to throw so redirects are observable as a
 * rejected promise, matching Next's own redirect semantics. Never touches a
 * real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FEATURES } from "@/lib/permissions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { membersResult: [] as unknown[], selectQueue: [] as unknown[][] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return {
    db: {
      query: {
        members: {
          findMany: vi.fn(() => Promise.resolve(mockDbState.membersResult)),
        },
      },
      select: vi.fn(() => chain()),
    },
  };
});

vi.mock("@/components/members/member-directory", () => ({
  MemberDirectory: () => null,
}));
vi.mock("@/components/members/member-directory-print", () => ({
  MemberDirectoryPrint: () => null,
}));
vi.mock("@/components/members/print-directory-button", () => ({
  default: () => null,
}));
vi.mock("@/components/suggestion-box-launcher", () => ({
  SuggestionBoxLauncher: () => null,
}));

import MembersPage from "./page";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { db } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.membersResult = [];
  mockDbState.selectQueue = [];
});

describe("MembersPage — permission gate", () => {
  it("no session: redirects to /signin before any permission check or DB query", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    await expect(MembersPage()).rejects.toThrow("REDIRECT:/signin");

    expect(hasFeature).not.toHaveBeenCalled();
    expect(db.query.members.findMany).not.toHaveBeenCalled();
  });

  it("session lacking members.view: redirects to /access-pending before any DB query", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", name: "Pat" } } as never);
    vi.mocked(hasFeature).mockResolvedValue(false);

    await expect(MembersPage()).rejects.toThrow("REDIRECT:/access-pending");

    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.MEMBERS_VIEW);
    expect(db.query.members.findMany).not.toHaveBeenCalled();
  });

  it("session with members.view: does not redirect, and proceeds to query the member list", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", name: "Pat" } } as never);
    vi.mocked(hasFeature).mockResolvedValue(true);
    mockDbState.membersResult = [];
    // Only one db.select() call happens when there are zero members (the
    // memberships query is skipped — see page.tsx's memberIds.length > 0
    // guard): the directory-groups fetch.
    mockDbState.selectQueue = [[]];

    const result = await MembersPage();

    expect(result).toBeTruthy();
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.MEMBERS_VIEW);
    expect(db.query.members.findMany).toHaveBeenCalledTimes(1);
  });
});
