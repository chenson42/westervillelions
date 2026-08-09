/**
 * Unit tests for POST /api/admin/minutes — scoped to the notetaker-of-record
 * field (a further Phase 4 increment, 2026-08-09, treasurer request), not a
 * full re-test of every field this route already validates (kind,
 * meetingDate, motions, actionItems, presentCount) — those have no prior
 * dedicated route-level unit coverage either; the point of this file is
 * closing the coverage gap for the new field, not re-litigating what came
 * before it.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/minutes-queries directly (not the raw DB) — same convention as
 * src/app/api/admin/minutes/[id]/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/minutes-queries", () => ({
  createMinutes: vi.fn(),
  listMinutesForAdmin: vi.fn(),
  getMemberNameSnapshot: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { createMinutes, getMemberNameSnapshot } from "@/lib/minutes-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const BASE_BODY = {
  kind: "general",
  meetingDate: "2026-06-01",
  motions: [],
  actionItems: [],
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(createMinutes).mockReset();
  vi.mocked(getMemberNameSnapshot).mockReset();
});

describe("POST /api/admin/minutes — notetaker of record", () => {
  it("omitted notetakerMemberId creates with both notetaker fields null, without calling getMemberNameSnapshot()", async () => {
    vi.mocked(createMinutes).mockResolvedValue({ id: "min-1" });

    const response = await POST(makeRequest(BASE_BODY));

    expect(response.status).toBe(201);
    expect(getMemberNameSnapshot).not.toHaveBeenCalled();
    expect(createMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ notetakerMemberId: null, notetakerNameSnapshot: null }),
    );
  });

  it("a valid notetakerMemberId resolves to a name snapshot and passes BOTH fields through", async () => {
    vi.mocked(getMemberNameSnapshot).mockResolvedValue("Jane Doe");
    vi.mocked(createMinutes).mockResolvedValue({ id: "min-1" });

    const response = await POST(makeRequest({ ...BASE_BODY, notetakerMemberId: "mem-1" }));

    expect(response.status).toBe(201);
    expect(getMemberNameSnapshot).toHaveBeenCalledWith("mem-1");
    expect(createMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ notetakerMemberId: "mem-1", notetakerNameSnapshot: "Jane Doe" }),
    );
  });

  it("an unresolvable notetakerMemberId returns 400 without ever calling createMinutes()", async () => {
    vi.mocked(getMemberNameSnapshot).mockResolvedValue(null);

    const response = await POST(makeRequest({ ...BASE_BODY, notetakerMemberId: "does-not-exist" }));

    expect(response.status).toBe(400);
    expect(createMinutes).not.toHaveBeenCalled();
  });

  it("a non-string notetakerMemberId returns 400 without ever calling getMemberNameSnapshot() or createMinutes()", async () => {
    const response = await POST(makeRequest({ ...BASE_BODY, notetakerMemberId: 12345 }));

    expect(response.status).toBe(400);
    expect(getMemberNameSnapshot).not.toHaveBeenCalled();
    expect(createMinutes).not.toHaveBeenCalled();
  });

  it("an empty-string notetakerMemberId is treated the same as omitted — null, no lookup", async () => {
    vi.mocked(createMinutes).mockResolvedValue({ id: "min-1" });

    const response = await POST(makeRequest({ ...BASE_BODY, notetakerMemberId: "" }));

    expect(response.status).toBe(201);
    expect(getMemberNameSnapshot).not.toHaveBeenCalled();
    expect(createMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ notetakerMemberId: null, notetakerNameSnapshot: null }),
    );
  });
});
