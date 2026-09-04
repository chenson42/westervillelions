/**
 * Unit tests for GET /api/club-files/[id]/download.
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Unit Tests
 * Required": the visibility enforcement 404 matrix (public/members-only x
 * authenticated/unauthenticated/no-linked-member), nonexistent/deleted id,
 * Content-Type/Content-Disposition header correctness, and "no 403 is ever
 * returned".
 *
 * Hermetic: mocks @/lib/auth, @/lib/club-files-queries
 * (getClubFileForDownload), and @/lib/club-file-storage (getClubFileStorage
 * only — sanitizeClubFileName stays real via importOriginal).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/club-files-queries", () => ({ getClubFileForDownload: vi.fn() }));

const storageRead = vi.fn();
vi.mock("@/lib/club-file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/club-file-storage")>();
  return {
    ...actual,
    getClubFileStorage: vi.fn(() => ({ read: storageRead, save: vi.fn(), delete: vi.fn() })),
  };
});

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { getClubFileForDownload } from "@/lib/club-files-queries";

function makeParams(id = "file-1") {
  return { params: Promise.resolve({ id }) };
}

const PUBLIC_FILE = {
  id: "file-1",
  visibility: "public",
  storageKey: "club-files/uuid/packet.pdf",
  filename: "sponsor packet.pdf",
  contentType: "application/pdf",
};

const MEMBERS_ONLY_FILE = {
  ...PUBLIC_FILE,
  id: "file-2",
  visibility: "members-only",
};

const STORED_BYTES = { bytes: Buffer.from("%PDF-1.4 mock"), contentType: "application/pdf" };

beforeEach(() => {
  vi.mocked(getClubFileForDownload).mockReset();
  vi.mocked(auth).mockReset();
  storageRead.mockReset();
  storageRead.mockResolvedValue(STORED_BYTES);
});

async function readAll(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString();
}

describe("GET /api/club-files/[id]/download — visibility matrix", () => {
  it("public + unauthenticated -> 200", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(PUBLIC_FILE);
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await GET({} as NextRequest, makeParams("file-1"));

    expect(res.status).toBe(200);
  });

  it("public + authenticated -> 200", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(PUBLIC_FILE);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", memberId: "m1" } } as never);

    const res = await GET({} as NextRequest, makeParams("file-1"));

    expect(res.status).toBe(200);
  });

  it("members-only + unauthenticated -> 404", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(MEMBERS_ONLY_FILE);
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await GET({} as NextRequest, makeParams("file-2"));

    expect(res.status).toBe(404);
  });

  it("members-only + authenticated but no linked memberId -> 404", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(MEMBERS_ONLY_FILE);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);

    const res = await GET({} as NextRequest, makeParams("file-2"));

    expect(res.status).toBe(404);
  });

  it("members-only + authenticated with a linked memberId -> 200", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(MEMBERS_ONLY_FILE);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", memberId: "m1" } } as never);

    const res = await GET({} as NextRequest, makeParams("file-2"));

    expect(res.status).toBe(200);
  });

  it("nonexistent id -> 404", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(null);

    const res = await GET({} as NextRequest, makeParams("does-not-exist"));

    expect(res.status).toBe(404);
  });

  it("deleted file id -> 404 (query returns null, same as nonexistent)", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(null);

    const res = await GET({} as NextRequest, makeParams("was-deleted"));

    expect(res.status).toBe(404);
  });

  it("blob missing from storage (row exists, bytes don't) -> 404", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(PUBLIC_FILE);
    storageRead.mockResolvedValue(null);

    const res = await GET({} as NextRequest, makeParams("file-1"));

    expect(res.status).toBe(404);
  });

  it("never returns 403 for any failure mode above", async () => {
    // Re-run every failing scenario and confirm none of them is 403.
    const scenarios: Array<() => void> = [
      () => {
        vi.mocked(getClubFileForDownload).mockResolvedValue(MEMBERS_ONLY_FILE);
        vi.mocked(auth).mockResolvedValue(null as never);
      },
      () => {
        vi.mocked(getClubFileForDownload).mockResolvedValue(null);
      },
    ];
    for (const setup of scenarios) {
      setup();
      const res = await GET({} as NextRequest, makeParams("x"));
      expect(res.status).not.toBe(403);
    }
  });
});

describe("GET /api/club-files/[id]/download — headers and body", () => {
  it("sets Content-Type: application/pdf and a Content-Disposition with the sanitized filename", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(PUBLIC_FILE);
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await GET({} as NextRequest, makeParams("file-1"));

    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Spaces are stripped by sanitizeClubFileName -> "sponsor_packet.pdf"
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="sponsor_packet.pdf"');
  });

  it("streams the exact stored bytes as the response body", async () => {
    vi.mocked(getClubFileForDownload).mockResolvedValue(PUBLIC_FILE);
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await GET({} as NextRequest, makeParams("file-1"));
    const body = await readAll(res);

    expect(body).toBe("%PDF-1.4 mock");
  });
});
