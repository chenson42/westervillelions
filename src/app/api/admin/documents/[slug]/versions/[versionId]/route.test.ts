/**
 * Unit tests for PATCH /api/admin/documents/[slug]/versions/[versionId].
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/documents-queries directly (not the raw DB) — same convention as
 * src/app/api/admin/minutes/[id]/route.test.ts.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "Unit
 * Tests for Phase 4", items 10-13.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/documents-queries", () => ({
  getDocumentBySlug: vi.fn(),
  getVersionForCompare: vi.fn(),
  adoptVersion: vi.fn(),
  linkCitingMinutes: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getDocumentBySlug, getVersionForCompare, adoptVersion, linkCitingMinutes } from "@/lib/documents-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
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
    bodyMarkdown: "Proposed text",
    changeType: "substantive",
    changeNote: "Proposed dues increase.",
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
  vi.mocked(getVersionForCompare).mockReset();
  vi.mocked(adoptVersion).mockReset();
  vi.mocked(linkCitingMinutes).mockReset();
});

describe("PATCH .../versions/[versionId] — adopt", () => {
  it("on a version that already has adoptedAt set, returns 409 and never calls adoptVersion()", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(
      version({ adoptedAt: new Date(), adoptedByUserId: "user-2" }) as never,
    );

    const response = await PATCH(
      makeRequest({ action: "adopt", adoptionNote: "Board approved 5-0, 2026-08-09." }),
      makeParams(),
    );

    expect(response.status).toBe(409);
    expect(adoptVersion).not.toHaveBeenCalled();
  });

  it("on an editorial-type version (never adoptable — already current the moment it was saved), returns 409 and never calls adoptVersion()", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version({ changeType: "editorial" }) as never);

    const response = await PATCH(
      makeRequest({ action: "adopt", adoptionNote: "Board approved 5-0, 2026-08-09." }),
      makeParams(),
    );

    expect(response.status).toBe(409);
    expect(adoptVersion).not.toHaveBeenCalled();
  });

  it("a valid adopt on a pending substantive version calls adoptVersion() with the session user and returns 200", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version() as never);
    vi.mocked(adoptVersion).mockResolvedValue({ ok: true, id: "ver-1", documentId: "doc-1" });

    const response = await PATCH(
      makeRequest({ action: "adopt", adoptionNote: "Board approved 5-0, 2026-08-09." }),
      makeParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.id).toBe("ver-1");
    expect(adoptVersion).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "ver-1", adoptedByUserId: "user-1" }),
    );
  });

  it("an empty adoptionNote returns 400 before calling adoptVersion()", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version() as never);

    const response = await PATCH(makeRequest({ action: "adopt", adoptionNote: "" }), makeParams());

    expect(response.status).toBe(400);
    expect(adoptVersion).not.toHaveBeenCalled();
  });
});

describe("PATCH .../versions/[versionId] — link-minutes", () => {
  it("on a not-yet-adopted version, returns 409 and never calls linkCitingMinutes()", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version({ adoptedAt: null }) as never);

    const response = await PATCH(
      makeRequest({ action: "link-minutes", citingMinutesId: "min-1" }),
      makeParams(),
    );

    expect(response.status).toBe(409);
    expect(linkCitingMinutes).not.toHaveBeenCalled();
  });

  it("on an adopted version, calls linkCitingMinutes() and returns 200", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(
      version({ adoptedAt: new Date(), adoptedByUserId: "user-1", adoptionNote: "Approved." }) as never,
    );
    vi.mocked(linkCitingMinutes).mockResolvedValue({ ok: true, id: "ver-1" });

    const response = await PATCH(
      makeRequest({ action: "link-minutes", citingMinutesId: "min-1" }),
      makeParams(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.id).toBe("ver-1");
    expect(linkCitingMinutes).toHaveBeenCalledWith("ver-1", "min-1");
  });
});

describe("PATCH .../versions/[versionId] — shared", () => {
  it("returns 403 when hasFeature resolves false, without calling getDocumentBySlug() or getVersionForCompare()", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await PATCH(
      makeRequest({ action: "adopt", adoptionNote: "Board approved 5-0." }),
      makeParams(),
    );

    expect(response.status).toBe(403);
    expect(getDocumentBySlug).not.toHaveBeenCalled();
    expect(getVersionForCompare).not.toHaveBeenCalled();
  });

  it("returns 404 when the version doesn't belong to the resolved document", async () => {
    vi.mocked(getVersionForCompare).mockResolvedValue(version({ documentId: "some-other-doc" }) as never);

    const response = await PATCH(
      makeRequest({ action: "adopt", adoptionNote: "Board approved 5-0." }),
      makeParams(),
    );

    expect(response.status).toBe(404);
    expect(adoptVersion).not.toHaveBeenCalled();
  });

  it("an unrecognized action returns 400", async () => {
    const response = await PATCH(makeRequest({ action: "delete" }), makeParams());
    expect(response.status).toBe(400);
  });
});
