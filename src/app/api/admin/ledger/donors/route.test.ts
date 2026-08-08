/**
 * Unit tests for GET/POST /api/admin/ledger/donors — Donor Multiple Emails
 * (2026-08-08, docs/work-log/2026-08-08-donor-multiple-emails.md).
 *
 * Covers:
 *  - GET delegates to listDonors() with the search param passed through
 *  - POST rejects a malformed email address (400)
 *  - POST rejects a case-insensitive duplicate WITHIN the submitted list (400)
 *  - POST normalizes (trim + lowercase) and stores the full list, including
 *    the zero-address case
 *  - POST's soft-dedup 409 generalizes to "same name + any overlapping
 *    address" (not just an exact single-email match)
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db,
 * @/lib/ledger-queries — mirrors the pattern in
 * transactions/[id]/acknowledge/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    sameName: [] as { id: string; emails: string[] }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      ledgerDonors: {
        findMany: vi.fn(() => Promise.resolve(mockDbState.sameName)),
      },
      members: {
        findFirst: vi.fn(() => Promise.resolve({ id: "member-1" })),
      },
    },
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => Promise.resolve([{ id: "donor-new", ...values }]),
      }),
    })),
  },
}));

vi.mock("@/lib/ledger-queries", () => ({
  listDonors: vi.fn(() =>
    Promise.resolve([{ id: "d1", name: "Trucco Construction Co", emails: ["a@trucco.com"] }]),
  ),
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { listDonors } from "@/lib/ledger-queries";

function makeRequest(
  body?: unknown,
  url = "http://localhost/api/admin/ledger/donors",
): NextRequest {
  return { json: async () => body, url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.sameName = [];
  vi.mocked(listDonors).mockClear();
});

describe("GET /api/admin/ledger/donors", () => {
  it("delegates to listDonors() with the search param", async () => {
    const res = await GET(
      makeRequest(undefined, "http://localhost/api/admin/ledger/donors?search=trucco"),
    );
    expect(res.status).toBe(200);
    expect(listDonors).toHaveBeenCalledWith({ search: "trucco" });
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  it("passes undefined search when no query param is given", async () => {
    await GET(makeRequest(undefined, "http://localhost/api/admin/ledger/donors"));
    expect(listDonors).toHaveBeenCalledWith({ search: undefined });
  });
});

describe("POST /api/admin/ledger/donors — emails validation", () => {
  it("rejects a malformed email address", async () => {
    const res = await POST(
      makeRequest({ name: "Trucco Construction Co", emails: ["not-an-email"] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid email/);
  });

  it("rejects a case-insensitive duplicate within the submitted list", async () => {
    const res = await POST(
      makeRequest({
        name: "Trucco Construction Co",
        emails: ["Owner@Trucco.com", "owner@trucco.com"],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/duplicate/i);
  });

  it("normalizes (trim + lowercase) and stores every valid address", async () => {
    const res = await POST(
      makeRequest({
        name: "Trucco Construction Co",
        emails: ["  Owner@Trucco.com  ", "office@trucco.com"],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emails).toEqual(["owner@trucco.com", "office@trucco.com"]);
  });

  it("allows creating a donor with zero email addresses", async () => {
    const res = await POST(makeRequest({ name: "Anonymous Donor", emails: [] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emails).toEqual([]);
  });

  it("allows creating a donor with emails omitted entirely", async () => {
    const res = await POST(makeRequest({ name: "Anonymous Donor" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emails).toEqual([]);
  });

  it("409s when a donor with the same name and an overlapping address already exists", async () => {
    mockDbState.sameName = [{ id: "existing-1", emails: ["owner@trucco.com"] }];
    const res = await POST(
      makeRequest({ name: "Trucco Construction Co", emails: ["owner@trucco.com"] }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existingId).toBe("existing-1");
  });

  it("does not 409 when the name matches but no email overlaps", async () => {
    mockDbState.sameName = [{ id: "existing-1", emails: ["someoneelse@trucco.com"] }];
    const res = await POST(
      makeRequest({ name: "Trucco Construction Co", emails: ["owner@trucco.com"] }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects a name over 200 characters before validating emails", async () => {
    const res = await POST(makeRequest({ name: "x".repeat(201), emails: [] }));
    expect(res.status).toBe(400);
  });
});
