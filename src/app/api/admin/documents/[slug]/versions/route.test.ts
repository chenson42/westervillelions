/**
 * Unit tests for POST/GET /api/admin/documents/[slug]/versions.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/documents-queries directly (not the raw DB) — same convention as
 * src/app/api/admin/minutes/route.test.ts.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "Unit
 * Tests for Phase 4", items 7-9, 13.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/documents-queries", () => ({
  getDocumentBySlug: vi.fn(),
  listVersionsForAdmin: vi.fn(),
  createDocumentVersion: vi.fn(),
}));

import { POST, GET } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getDocumentBySlug, createDocumentVersion, listVersionsForAdmin } from "@/lib/documents-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(slug = "constitution-bylaws") {
  return { params: Promise.resolve({ slug }) };
}

const DOCUMENT = {
  id: "doc-1",
  title: "Constitution & By-Laws",
  slug: "constitution-bylaws",
  visibility: "members",
  currentVersionId: "ver-current",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getDocumentBySlug).mockReset().mockResolvedValue(DOCUMENT as never);
  vi.mocked(createDocumentVersion).mockReset();
  vi.mocked(listVersionsForAdmin).mockReset();
});

describe("POST /api/admin/documents/[slug]/versions", () => {
  it("changeType 'editorial' calls createDocumentVersion() and the response reports isCurrent: true", async () => {
    vi.mocked(createDocumentVersion).mockResolvedValue({
      id: "ver-2",
      versionNumber: 2,
      changeType: "editorial",
      isCurrent: true,
    });

    const response = await POST(
      makeRequest({ changeType: "editorial", bodyMarkdown: "Corrected text.", changeNote: "Fixed a typo." }),
      makeParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.isCurrent).toBe(true);
    expect(createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        changeType: "editorial",
        bodyMarkdown: "Corrected text.",
        authorUserId: "user-1",
      }),
    );
  });

  it("changeType 'substantive' reports isCurrent: false", async () => {
    vi.mocked(createDocumentVersion).mockResolvedValue({
      id: "ver-3",
      versionNumber: 3,
      changeType: "substantive",
      isCurrent: false,
    });

    const response = await POST(
      makeRequest({ changeType: "substantive", bodyMarkdown: "Proposed amendment text.", changeNote: "Proposed dues increase." }),
      makeParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.isCurrent).toBe(false);
  });

  it("an empty bodyMarkdown returns 400 before reaching createDocumentVersion()", async () => {
    const response = await POST(
      makeRequest({ changeType: "editorial", bodyMarkdown: "   ", changeNote: "Fixed a typo." }),
      makeParams(),
    );

    expect(response.status).toBe(400);
    expect(createDocumentVersion).not.toHaveBeenCalled();
  });

  it("an empty changeNote returns 400 before reaching createDocumentVersion()", async () => {
    const response = await POST(
      makeRequest({ changeType: "editorial", bodyMarkdown: "Corrected text.", changeNote: "" }),
      makeParams(),
    );

    expect(response.status).toBe(400);
    expect(createDocumentVersion).not.toHaveBeenCalled();
  });

  it("an invalid changeType returns 400 before reaching createDocumentVersion()", async () => {
    const response = await POST(
      makeRequest({ changeType: "major", bodyMarkdown: "Corrected text.", changeNote: "Fixed a typo." }),
      makeParams(),
    );

    expect(response.status).toBe(400);
    expect(createDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 403 when hasFeature resolves false, without calling createDocumentVersion() or getDocumentBySlug()", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST(
      makeRequest({ changeType: "editorial", bodyMarkdown: "Corrected text.", changeNote: "Fixed a typo." }),
      makeParams(),
    );

    expect(response.status).toBe(403);
    expect(getDocumentBySlug).not.toHaveBeenCalled();
    expect(createDocumentVersion).not.toHaveBeenCalled();
  });

  it("returns 404 when the slug doesn't resolve to a document", async () => {
    vi.mocked(getDocumentBySlug).mockResolvedValue(null);

    const response = await POST(
      makeRequest({ changeType: "editorial", bodyMarkdown: "Corrected text.", changeNote: "Fixed a typo." }),
      makeParams("no-such-document"),
    );

    expect(response.status).toBe(404);
    expect(createDocumentVersion).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/documents/[slug]/versions", () => {
  it("returns the full version chain from listVersionsForAdmin()", async () => {
    vi.mocked(listVersionsForAdmin).mockResolvedValue([
      {
        id: "ver-3",
        versionNumber: 3,
        changeType: "substantive",
        changeNote: "Proposed dues increase.",
        authorUserId: "user-1",
        adoptedByUserId: null,
        adoptedAt: null,
        citingMinutesId: null,
        adoptionNote: null,
        createdAt: new Date(),
        isCurrent: false,
      },
    ]);

    const response = await GET({} as NextRequest, makeParams());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.versions).toHaveLength(1);
    expect(listVersionsForAdmin).toHaveBeenCalledWith("doc-1");
  });

  it("returns 403 when hasFeature resolves false", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await GET({} as NextRequest, makeParams());

    expect(response.status).toBe(403);
    expect(listVersionsForAdmin).not.toHaveBeenCalled();
  });
});
