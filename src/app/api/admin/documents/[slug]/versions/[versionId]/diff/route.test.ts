/**
 * Unit tests for GET /api/admin/documents/[slug]/versions/[versionId]/diff.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/documents-queries directly (not the raw DB) — same convention as the
 * other documents admin route tests.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "Unit
 * Tests for Phase 4", item 13 ("every route returns 403 when hasFeature
 * resolves false — one shared test per route file").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/documents-queries", () => ({
  getDocumentBySlug: vi.fn(),
  getCurrentVersion: vi.fn(),
  getVersionForCompare: vi.fn(),
}));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getDocumentBySlug, getCurrentVersion, getVersionForCompare } from "@/lib/documents-queries";

function makeRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function makeParams(slug = "constitution-bylaws", versionId = "ver-1") {
  return { params: Promise.resolve({ slug, versionId }) };
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

function version(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ver-1",
    documentId: "doc-1",
    versionNumber: 2,
    bodyMarkdown: "Old text\n",
    changeType: "editorial",
    changeNote: "Fixed a typo.",
    authorUserId: "user-1",
    adoptedByUserId: null,
    adoptedAt: null,
    citingMinutesId: null,
    adoptionNote: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getDocumentBySlug).mockReset().mockResolvedValue(DOCUMENT as never);
  vi.mocked(getCurrentVersion).mockReset();
  vi.mocked(getVersionForCompare).mockReset();
});

describe("GET .../versions/[versionId]/diff", () => {
  it("returns 403 when hasFeature resolves false, without calling getDocumentBySlug()", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await GET(
      makeRequest("http://localhost/api/admin/documents/constitution-bylaws/versions/ver-1/diff?against=current"),
      makeParams(),
    );

    expect(response.status).toBe(403);
    expect(getDocumentBySlug).not.toHaveBeenCalled();
  });

  it("against=current diffs the base version against the document's live current version", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version({ bodyMarkdown: "Old text\n" }) as never);
    vi.mocked(getCurrentVersion).mockResolvedValue(
      version({ id: "ver-current", versionNumber: 3, bodyMarkdown: "New text\n" }) as never,
    );

    const response = await GET(
      makeRequest("http://localhost/api/admin/documents/constitution-bylaws/versions/ver-1/diff?against=current"),
      makeParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.base.id).toBe("ver-1");
    expect(json.compare.id).toBe("ver-current");
    expect(Array.isArray(json.diff)).toBe(true);
  });

  it("a missing against param returns 400", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version() as never);

    const response = await GET(
      makeRequest("http://localhost/api/admin/documents/constitution-bylaws/versions/ver-1/diff"),
      makeParams(),
    );

    expect(response.status).toBe(400);
  });
});
