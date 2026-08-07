/**
 * Unit tests for POST /api/admin/members — membershipType default-on-create
 * behavior (DECISION-064, docs/work-log/2026-08-07-membership-categories.md).
 *
 * Unlike PATCH (hard 400 on an invalid value, see [id]/route.test.ts), POST
 * defaults an omitted or off-taxonomy membershipType to "active" — per the
 * Phase 3 API Contract, matching the schema column's own default so create
 * never fails purely on this field.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/google-groups,
 * and @/lib/db. @/lib/members is imported with its real (pure) exports
 * except provisionUserForMember, which is mocked out (DB/email side effects
 * unrelated to this field).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/google-groups", () => ({
  syncClubMembersList: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/lib/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members")>();
  return {
    ...actual,
    provisionUserForMember: vi.fn(() =>
      Promise.resolve({ userId: "user-new", wasExisting: false })
    ),
  };
});

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    emailConflict: null as Record<string, unknown> | null,
    insertCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      members: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.emailConflict)),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          mockDbState.insertCalls.push({ table, values });
          return Promise.resolve([{ id: "member-new", ...values }]);
        },
      }),
    })),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { members } from "@/lib/db/schema";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const BASE_BODY = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane.new@example.com",
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockReset();
  mockDbState.emailConflict = null;
  mockDbState.insertCalls = [];
});

describe("POST /api/admin/members — membershipType default-on-create", () => {
  it("403s when the caller lacks MEMBERS_EDIT", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await POST(makeRequest(BASE_BODY));

    expect(response.status).toBe(403);
    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("defaults membershipType to 'active' when omitted", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);

    const response = await POST(makeRequest(BASE_BODY));

    expect(response.status).toBe(201);
    expect(mockDbState.insertCalls).toHaveLength(1);
    expect(mockDbState.insertCalls[0].table).toBe(members);
    expect(mockDbState.insertCalls[0].values.membershipType).toBe("active");
  });

  it("defaults membershipType to 'active' on an off-taxonomy submitted value, rather than rejecting the create", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);

    const response = await POST(
      makeRequest({ ...BASE_BODY, membershipType: "not_a_real_type" })
    );

    expect(response.status).toBe(201);
    expect(mockDbState.insertCalls[0].values.membershipType).toBe("active");
  });

  it("persists a valid, explicitly submitted membershipType on create", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);

    const response = await POST(
      makeRequest({ ...BASE_BODY, membershipType: "honorary" })
    );

    expect(response.status).toBe(201);
    expect(mockDbState.insertCalls[0].values.membershipType).toBe("honorary");
    const body = await response.json();
    expect(body.membershipType).toBe("honorary");
  });
});
