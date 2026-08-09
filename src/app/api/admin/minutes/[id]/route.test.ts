/**
 * Unit tests for PATCH /api/admin/minutes/[id].
 *
 * Covers Phase 3 design's "Unit Tests for Phase 4" item 5
 * (docs/work-log/2026-08-08-meeting-minutes.md):
 *   - { action: 'approve' } on an already-approved record returns 409
 *     (mirrors the reimbursements double-pay guard).
 *   - { action: 'reopen' } preserves approvedByUserId/approvedAt rather than
 *     clearing them.
 *   - { action: 'update' } on an approved record returns 409 without
 *     touching any row.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/minutes-queries directly (not the raw DB) — the route's own
 * state-transition logic (checking existing.status BEFORE calling the query
 * layer, and translating its {ok, reason} result into a response) is what's
 * under test here, mirroring
 * src/app/api/admin/ledger/budget-approvals/route.test.ts's approach of
 * mocking the query module rather than re-proving DB-layer behavior already
 * covered in src/lib/minutes-queries.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/minutes-queries", () => ({
  getMinutesById: vi.fn(),
  getMinutesDetail: vi.fn(),
  updateMinutesDraft: vi.fn(),
  approveMinutes: vi.fn(),
  reopenMinutes: vi.fn(),
  softDeleteMinutes: vi.fn(),
  getMemberNameSnapshot: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import {
  getMinutesById,
  updateMinutesDraft,
  approveMinutes,
  reopenMinutes,
  getMemberNameSnapshot,
} from "@/lib/minutes-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getMinutesById).mockReset();
  vi.mocked(updateMinutesDraft).mockReset();
  vi.mocked(approveMinutes).mockReset();
  vi.mocked(reopenMinutes).mockReset();
  vi.mocked(getMemberNameSnapshot).mockReset();
});

describe("PATCH /api/admin/minutes/[id]", () => {
  it("Phase 3 test 5a: { action: 'approve' } on an already-approved record returns 409, without calling approveMinutes()", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "approved" } as never);

    const response = await PATCH(makeRequest({ action: "approve" }), makeParams("min-1"));

    expect(response.status).toBe(409);
    expect(approveMinutes).not.toHaveBeenCalled();
  });

  it("Phase 3 test 5b: { action: 'reopen' } preserves approvedByUserId/approvedAt — reopenMinutes() takes no such argument, so the route has no way to ask it to clear them (DECISION-077 §8)", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "approved" } as never);
    vi.mocked(reopenMinutes).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(makeRequest({ action: "reopen" }), makeParams("min-1"));

    expect(response.status).toBe(200);
    expect(reopenMinutes).toHaveBeenCalledWith("min-1");
    expect(vi.mocked(reopenMinutes).mock.calls[0]).toHaveLength(1);
  });

  it("Phase 3 test 5c: { action: 'update' } on an approved record returns 409 without touching any row", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "approved" } as never);

    const response = await PATCH(
      makeRequest({ action: "update", title: "New title" }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("Reopen this record before editing");
    expect(updateMinutesDraft).not.toHaveBeenCalled();
  });

  it("a draft CAN be updated — sanity check that the 409 above is status-gated, not a blanket failure", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(updateMinutesDraft).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(
      makeRequest({ action: "update", title: "New title" }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(200);
    expect(updateMinutesDraft).toHaveBeenCalledWith("min-1", { title: "New title" });
  });

  it("a draft CAN be approved — sanity check for test 5a's 409", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(approveMinutes).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(makeRequest({ action: "approve" }), makeParams("min-1"));

    expect(response.status).toBe(200);
    expect(approveMinutes).toHaveBeenCalledWith("min-1", "user-1");
  });

  it("a nonexistent id 404s before any action-specific logic runs", async () => {
    vi.mocked(getMinutesById).mockResolvedValue(null);

    const response = await PATCH(makeRequest({ action: "approve" }), makeParams("missing"));

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/admin/minutes/[id] — notetaker of record (further Phase 4 increment)", () => {
  it("resolves notetakerMemberId to a name snapshot via getMemberNameSnapshot() and passes BOTH fields to updateMinutesDraft()", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(getMemberNameSnapshot).mockResolvedValue("Jane Doe");
    vi.mocked(updateMinutesDraft).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(
      makeRequest({ action: "update", notetakerMemberId: "mem-1" }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(200);
    expect(getMemberNameSnapshot).toHaveBeenCalledWith("mem-1");
    expect(updateMinutesDraft).toHaveBeenCalledWith("min-1", {
      notetakerMemberId: "mem-1",
      notetakerNameSnapshot: "Jane Doe",
    });
  });

  it("an unresolvable notetakerMemberId returns 400 without ever calling updateMinutesDraft()", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(getMemberNameSnapshot).mockResolvedValue(null);

    const response = await PATCH(
      makeRequest({ action: "update", notetakerMemberId: "does-not-exist" }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(400);
    expect(updateMinutesDraft).not.toHaveBeenCalled();
  });

  it("null clears BOTH notetakerMemberId and notetakerNameSnapshot without ever calling getMemberNameSnapshot()", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(updateMinutesDraft).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(
      makeRequest({ action: "update", notetakerMemberId: null }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(200);
    expect(getMemberNameSnapshot).not.toHaveBeenCalled();
    expect(updateMinutesDraft).toHaveBeenCalledWith("min-1", {
      notetakerMemberId: null,
      notetakerNameSnapshot: null,
    });
  });

  it("an omitted notetakerMemberId key leaves it out of the updateMinutesDraft() input entirely — 'no change,' not 'clear it'", async () => {
    vi.mocked(getMinutesById).mockResolvedValue({ id: "min-1", status: "draft" } as never);
    vi.mocked(updateMinutesDraft).mockResolvedValue({ ok: true, id: "min-1" });

    const response = await PATCH(
      makeRequest({ action: "update", title: "New title" }),
      makeParams("min-1"),
    );

    expect(response.status).toBe(200);
    expect(getMemberNameSnapshot).not.toHaveBeenCalled();
    const input = vi.mocked(updateMinutesDraft).mock.calls[0][1];
    expect(input).not.toHaveProperty("notetakerMemberId");
    expect(input).not.toHaveProperty("notetakerNameSnapshot");
  });
});
