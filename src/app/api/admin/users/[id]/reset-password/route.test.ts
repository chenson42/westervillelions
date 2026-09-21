/**
 * Unit tests for POST /api/admin/users/[id]/reset-password —
 * docs/work-log/2026-09-18-admin-account-reset.md Phase 3 "Unit Tests",
 * items 1-6 on src/app/api/admin/users/[id]/reset-password/route.test.ts.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and @/lib/db —
 * mirrors the mocking convention already established by sibling route
 * tests (src/app/api/admin/minutes/[id]/route.test.ts,
 * src/app/api/admin/ledger/donors/[id]/route.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({
  hasFeature: vi.fn(),
  clearUserPermissionCache: vi.fn(),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    target: { id: "user-2", password: "existing-hash" } as Record<string, unknown> | null,
    updateSetCalls: [] as Record<string, unknown>[],
    insertCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.target)),
      },
    },
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => {
        mockDbState.updateSetCalls.push(set);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        mockDbState.insertCalls.push({ table, values });
        return Promise.resolve(undefined);
      },
    })),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const noopRequest = {} as NextRequest;

const TEMP_PASSWORD_REGEX = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.target = { id: "user-2", password: "existing-hash" };
  mockDbState.updateSetCalls = [];
  mockDbState.insertCalls = [];
});

describe("POST /api/admin/users/[id]/reset-password", () => {
  it("test 1: no session -> 401", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST(noopRequest, makeParams("user-2"));

    expect(response.status).toBe(401);
    expect(mockDbState.updateSetCalls).toHaveLength(0);
  });

  it("test 2: session without ADMIN_USERS -> 403", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST(noopRequest, makeParams("user-2"));

    expect(response.status).toBe(403);
    expect(mockDbState.updateSetCalls).toHaveLength(0);
  });

  it("test 3: id === session.user.id -> 400, db.update never called", async () => {
    const response = await POST(noopRequest, makeParams("admin-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/forgot password/i);
    expect(mockDbState.updateSetCalls).toHaveLength(0);
  });

  it("test 4: id not found in users -> 404", async () => {
    mockDbState.target = null;

    const response = await POST(noopRequest, makeParams("does-not-exist"));

    expect(response.status).toBe(404);
    expect(mockDbState.updateSetCalls).toHaveLength(0);
  });

  it("test 5: success path -> 200, password matches temp-password format, and the value passed to db.update(...).set is a bcrypt hash, never the plaintext", async () => {
    const response = await POST(noopRequest, makeParams("user-2"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.password).toMatch(TEMP_PASSWORD_REGEX);

    expect(mockDbState.updateSetCalls).toHaveLength(1);
    const hashSet = mockDbState.updateSetCalls[0].password as string;
    expect(hashSet).not.toBe(body.password);
    expect(hashSet).toMatch(/^\$2[aby]?\$/);
    await expect(bcrypt.compare(body.password, hashSet)).resolves.toBe(true);
  });

  it("test 6: success path inserts exactly one permissionAuditLog row whose details contain no plaintext or hash", async () => {
    const response = await POST(noopRequest, makeParams("user-2"));
    const body = await response.json();

    expect(mockDbState.insertCalls).toHaveLength(1);
    const inserted = mockDbState.insertCalls[0].values;
    expect(inserted.action).toBe("user_password_reset");
    expect(inserted.targetUserId).toBe("user-2");

    const details = JSON.parse(inserted.details as string);
    expect(details).toEqual({ hadExistingPassword: true });

    const detailsStr = JSON.stringify(details);
    expect(detailsStr).not.toContain(body.password);
    const hashSet = mockDbState.updateSetCalls[0].password as string;
    expect(detailsStr).not.toContain(hashSet);
  });

  it("hadExistingPassword is false for an OAuth-only account with no prior password", async () => {
    mockDbState.target = { id: "user-2", password: null };

    await POST(noopRequest, makeParams("user-2"));

    const inserted = mockDbState.insertCalls[0].values;
    const details = JSON.parse(inserted.details as string);
    expect(details).toEqual({ hadExistingPassword: false });
  });
});
