/**
 * Unit tests for DatabaseClubFileStorage — mirrors
 * src/lib/receipt-storage/database.test.ts's mocking approach for the
 * sibling Club Files adapter (DECISION-094).
 *
 * Mocks @/lib/db with nested vi.fn() chains mirroring the exact Drizzle
 * builder shape each method calls. This verifies DatabaseClubFileStorage
 * calls the correct builder methods with the correct arguments — it does
 * not exercise real Postgres bytea wire encoding (closed at the integration
 * level, not here).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

const insertValues = vi.fn();
const insertOnConflictDoUpdate = vi.fn();
const selectFrom = vi.fn();
const selectWhere = vi.fn();
const selectLimit = vi.fn();
const deleteWhere = vi.fn();

let selectResolvedRows: Array<{ bytes: Buffer; contentType: string }> = [];

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return {
          onConflictDoUpdate: (...args2: unknown[]) => {
            insertOnConflictDoUpdate(...args2);
            return Promise.resolve(undefined);
          },
        };
      },
    })),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => {
        selectFrom(...args);
        return {
          where: (...args2: unknown[]) => {
            selectWhere(...args2);
            return {
              limit: (...args3: unknown[]) => {
                selectLimit(...args3);
                return Promise.resolve(selectResolvedRows);
              },
            };
          },
        };
      },
    })),
    delete: vi.fn(() => ({
      where: (...args: unknown[]) => {
        deleteWhere(...args);
        return Promise.resolve(undefined);
      },
    })),
  },
}));

import { db } from "@/lib/db";
import { clubFileBlobs } from "@/lib/db/schema";
import { DatabaseClubFileStorage } from "./database";

describe("DatabaseClubFileStorage", () => {
  let storage: DatabaseClubFileStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResolvedRows = [];
    storage = new DatabaseClubFileStorage();
  });

  // ── save() ─────────────────────────────────────────────────────────────

  it("save() calls db.insert(clubFileBlobs).values(...) with key, contentType, bytes, and byteSize computed from the buffer's length", async () => {
    const key = "club-files/abc-123/packet.pdf";
    const bytes = Buffer.from("%PDF-1.4 mock content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);

    expect(db.insert).toHaveBeenCalledWith(clubFileBlobs);
    expect(insertValues).toHaveBeenCalledWith({
      key,
      contentType,
      bytes,
      byteSize: bytes.byteLength,
    });
  });

  it("save() calls .onConflictDoUpdate({ target: [clubFileBlobs.key], set: {...} }) with contentType/bytes/byteSize in set, and createdAt absent from set", async () => {
    const key = "club-files/abc-123/packet.pdf";
    const bytes = Buffer.from("%PDF-1.4 mock content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);

    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const arg = insertOnConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(arg.target).toEqual([clubFileBlobs.key]);
    expect(arg.set).toEqual({
      contentType,
      bytes,
      byteSize: bytes.byteLength,
    });
    expect(Object.prototype.hasOwnProperty.call(arg.set, "createdAt")).toBe(false);
  });

  it("save() converts a Uint8Array input to a Buffer before computing byteSize and passing it to values()", async () => {
    const key = "club-files/abc-123/packet.pdf";
    const uint8 = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const contentType = "application/pdf";

    await storage.save(key, uint8, contentType);

    const passed = insertValues.mock.calls[0][0] as { bytes: unknown; byteSize: number };
    expect(Buffer.isBuffer(passed.bytes)).toBe(true);
    expect(passed.byteSize).toBe(uint8.byteLength);
  });

  it("save() can be called twice in a row with the same key without throwing (replace-in-place, ON CONFLICT invoked on every call)", async () => {
    const key = "club-files/abc-123/packet.pdf";
    const contentType = "application/pdf";

    await expect(storage.save(key, Buffer.from("v1"), contentType)).resolves.toBeUndefined();
    await expect(storage.save(key, Buffer.from("v2"), contentType)).resolves.toBeUndefined();

    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  // ── read() ─────────────────────────────────────────────────────────────

  it("read() returns { bytes, contentType } when db.select(...) resolves a one-row array", async () => {
    const bytes = Buffer.from("%PDF-1.4 mock content");
    selectResolvedRows = [{ bytes, contentType: "application/pdf" }];

    const result = await storage.read("club-files/abc-123/packet.pdf");

    expect(result).toEqual({ bytes, contentType: "application/pdf" });
  });

  it("read() returns null when db.select(...) resolves an empty array", async () => {
    selectResolvedRows = [];

    const result = await storage.read("club-files/does-not-exist/file.pdf");

    expect(result).toBeNull();
  });

  it("read() calls .where(eq(clubFileBlobs.key, key)) with the exact key passed in, and .limit(1)", async () => {
    const key = "club-files/abc-123/packet.pdf";
    selectResolvedRows = [];

    await storage.read(key);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledWith(clubFileBlobs);
    expect(selectWhere).toHaveBeenCalledWith(eq(clubFileBlobs.key, key));
    expect(selectLimit).toHaveBeenCalledWith(1);
  });

  // ── delete() ───────────────────────────────────────────────────────────

  it("delete() calls db.delete(clubFileBlobs).where(eq(clubFileBlobs.key, key)) and resolves without throwing", async () => {
    const key = "club-files/abc-123/packet.pdf";

    await expect(storage.delete(key)).resolves.toBeUndefined();

    expect(db.delete).toHaveBeenCalledWith(clubFileBlobs);
    expect(deleteWhere).toHaveBeenCalledWith(eq(clubFileBlobs.key, key));
  });

  it("delete() resolves without throwing when the mocked delete chain affects zero rows", async () => {
    await expect(storage.delete("club-files/ghost/file.pdf")).resolves.toBeUndefined();
  });
});
