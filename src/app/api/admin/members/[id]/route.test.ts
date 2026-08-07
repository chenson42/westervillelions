/**
 * Unit tests for PATCH /api/admin/members/[id] — membershipType validation
 * and persistence (DECISION-064, docs/work-log/2026-08-07-membership-categories.md).
 *
 * Covers the Phase 3 design doc's route-level test items 5–6:
 *   5. 403 when the caller lacks MEMBERS_EDIT (no route-level permission test
 *      previously existed for this route; this is the first one, per the
 *      design doc's note to add it rather than skip silently).
 *   6. 400 with the exact off-taxonomy rejection message, and the row is
 *      left unchanged (no db.update call at all).
 * Plus the successful-persistence case named in the api-developer task, and
 * a regression guard for the "no fallback" behavior (unlike membershipStatus
 * on this same route, an omitted membershipType is also a hard 400, not a
 * silent fallback to the existing value).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/google-groups,
 * and @/lib/db. @/lib/members is imported with its real (pure) exports
 * except provisionUserForMember, which does DB/email work unrelated to this
 * field and is mocked out — no test here should ever need it to fire.
 * @/lib/db/schema is imported unmocked (pure table definitions, no @/lib/db
 * import of its own) purely for table-identity comparison, mirroring
 * budget-notes/route.test.ts.
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
  return { ...actual, provisionUserForMember: vi.fn() };
});

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    membersFindFirstQueue: [] as (Record<string, unknown> | null)[],
    usersFindFirstResult: null as Record<string, unknown> | null,
    updates: [] as { table: unknown; set: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      members: {
        findFirst: vi.fn(() =>
          Promise.resolve(mockDbState.membersFindFirstQueue.shift() ?? null)
        ),
      },
      users: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.usersFindFirstResult)),
      },
    },
    update: vi.fn((table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          mockDbState.updates.push({ table, set });
          const result = Promise.resolve(undefined) as Promise<unknown> & {
            returning?: () => Promise<unknown[]>;
          };
          result.returning = () => Promise.resolve([{ ...set }]);
          return result;
        },
      }),
    })),
  },
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { syncClubMembersList } from "@/lib/google-groups";
import { members } from "@/lib/db/schema";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "member-1") {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_MEMBER = {
  id: "member-1",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  phone: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  branch: null,
  dateOfBirth: null,
  joinDate: new Date("2020-01-01T00:00:00.000Z"),
  membershipEndedDate: null,
  isActive: true,
  membershipStatus: "active",
  membershipType: "active",
};

// A full-form submission matching EXISTING_MEMBER (this route's PATCH body
// is a whole-record submit, not a partial patch), varying only
// membershipType per test.
const VALID_BODY = {
  memberNumber: null,
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  branch: null,
  dateOfBirth: null,
  joinDate: "2020-01-01",
  membershipEndedDate: null,
  membershipStatus: "active",
  membershipType: "life_member",
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockReset();
  vi.mocked(syncClubMembersList).mockClear();
  mockDbState.membersFindFirstQueue = [];
  mockDbState.usersFindFirstResult = null;
  mockDbState.updates = [];
});

describe("PATCH /api/admin/members/[id] — membershipType (DECISION-064)", () => {
  it("403s when the caller lacks MEMBERS_EDIT — no membershipType validation or DB write is reached", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await PATCH(makeRequest(VALID_BODY), makeParams());

    expect(response.status).toBe(403);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("400s on an off-taxonomy membershipType with the exact design-specified message, and leaves the row unchanged", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);
    mockDbState.membersFindFirstQueue = [{ ...EXISTING_MEMBER }, null];

    const response = await PATCH(
      makeRequest({ ...VALID_BODY, membershipType: "not_a_real_type" }),
      makeParams()
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe(
      "membershipType must be one of: active, member_at_large, honorary, privileged, life_member, associate_member, affiliate_member"
    );
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("400s when membershipType is omitted entirely — no fallback to the existing value (unlike membershipStatus on this same route)", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);
    mockDbState.membersFindFirstQueue = [{ ...EXISTING_MEMBER }, null];
    const { membershipType: _omit, ...bodyWithoutType } = VALID_BODY;
    void _omit;

    const response = await PATCH(makeRequest(bodyWithoutType), makeParams());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/^membershipType must be one of:/);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("persists a valid membershipType on the members row", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);
    mockDbState.membersFindFirstQueue = [{ ...EXISTING_MEMBER }, null];
    mockDbState.usersFindFirstResult = null;

    const response = await PATCH(
      makeRequest({ ...VALID_BODY, membershipType: "life_member" }),
      makeParams()
    );

    expect(response.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
    expect(mockDbState.updates[0].table).toBe(members);
    expect(mockDbState.updates[0].set.membershipType).toBe("life_member");

    const body = await response.json();
    expect(body.membershipType).toBe("life_member");
  });

  it("accepts 'active' as a valid membershipType (the intentional status/type token overlap, not a bug)", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(true);
    mockDbState.membersFindFirstQueue = [{ ...EXISTING_MEMBER }, null];

    const response = await PATCH(
      makeRequest({ ...VALID_BODY, membershipType: "active" }),
      makeParams()
    );

    expect(response.status).toBe(200);
    expect(mockDbState.updates[0].set.membershipType).toBe("active");
  });
});
