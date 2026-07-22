/**
 * Unit tests for DatabaseReceiptStorage (DECISION-040).
 *
 * Mocks @/lib/db with nested vi.fn() chains mirroring the exact Drizzle
 * builder shape each method calls (per src/lib/permissions-server.test.ts's
 * vi.mock style). This verifies DatabaseReceiptStorage calls the correct
 * builder methods with the correct arguments — it does not exercise real
 * Postgres bytea wire encoding, which no test in this codebase mocks at this
 * depth. That gap is closed at the integration level (QA Phase 5's dev-server
 * smoke test against the migrated local DB), not here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

// ── Chain-level spies ───────────────────────────────────────────────────────
// One vi.fn() per builder-method call site so each call's arguments can be
// asserted independently, while the chain itself still returns the next
// link (or resolves) the way the real Drizzle query builder does.

const insertValues = vi.fn();
const insertOnConflictDoUpdate = vi.fn();
const selectFrom = vi.fn();
const selectWhere = vi.fn();
const selectLimit = vi.fn();
const deleteWhere = vi.fn();

// Mutable per-test fixture for what `.limit()` resolves to (the "rows" a
// SELECT would return).
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
import { ledgerReceiptFiles } from "@/lib/db/schema";
import { DatabaseReceiptStorage } from "./database";

describe("DatabaseReceiptStorage", () => {
  let storage: DatabaseReceiptStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    selectResolvedRows = [];
    storage = new DatabaseReceiptStorage();
  });

  // ── save() ─────────────────────────────────────────────────────────────

  it("save() calls db.insert(ledgerReceiptFiles).values(...) with key, contentType, bytes, and byteSize computed from the buffer's length", async () => {
    const key = "receipts/abc-123/invoice.pdf";
    const bytes = Buffer.from("mock pdf content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);

    expect(db.insert).toHaveBeenCalledWith(ledgerReceiptFiles);
    expect(insertValues).toHaveBeenCalledWith({
      key,
      contentType,
      bytes,
      byteSize: bytes.byteLength,
    });
  });

  it("save() calls .onConflictDoUpdate({ target: [ledgerReceiptFiles.key], set: {...} }) with contentType/bytes/byteSize in set, and createdAt absent from set", async () => {
    const key = "receipts/abc-123/invoice.pdf";
    const bytes = Buffer.from("mock pdf content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);

    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const arg = insertOnConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(arg.target).toEqual([ledgerReceiptFiles.key]);
    expect(arg.set).toEqual({
      contentType,
      bytes,
      byteSize: bytes.byteLength,
    });
    // Regression guard for the "first-write-wins" decision (architect Suggestion).
    expect(Object.prototype.hasOwnProperty.call(arg.set, "createdAt")).toBe(false);
  });

  it("save() converts a Uint8Array input to a Buffer before computing byteSize and passing it to values()", async () => {
    const key = "receipts/abc-123/photo.jpg";
    const uint8 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const contentType = "image/jpeg";

    await storage.save(key, uint8, contentType);

    const passed = insertValues.mock.calls[0][0] as { bytes: unknown; byteSize: number };
    expect(Buffer.isBuffer(passed.bytes)).toBe(true);
    expect(passed.byteSize).toBe(uint8.byteLength);
  });

  it("save() can be called twice in a row with the same key without throwing (ON CONFLICT invoked on every call, not just the first)", async () => {
    const key = "receipts/abc-123/invoice.pdf";
    const bytes = Buffer.from("v1");
    const contentType = "application/pdf";

    await expect(storage.save(key, bytes, contentType)).resolves.toBeUndefined();
    await expect(storage.save(key, Buffer.from("v2"), contentType)).resolves.toBeUndefined();

    expect(insertOnConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  // ── read() ─────────────────────────────────────────────────────────────

  it("read() returns { bytes, contentType } when db.select(...) resolves a one-row array", async () => {
    const bytes = Buffer.from("mock pdf content");
    selectResolvedRows = [{ bytes, contentType: "application/pdf" }];

    const result = await storage.read("receipts/abc-123/invoice.pdf");

    expect(result).toEqual({ bytes, contentType: "application/pdf" });
  });

  it("read() returns null when db.select(...) resolves an empty array", async () => {
    selectResolvedRows = [];

    const result = await storage.read("receipts/does-not-exist/file.pdf");

    expect(result).toBeNull();
  });

  it("read() calls .where(eq(ledgerReceiptFiles.key, key)) with the exact key passed in, and .limit(1)", async () => {
    const key = "receipts/abc-123/invoice.pdf";
    selectResolvedRows = [];

    await storage.read(key);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectFrom).toHaveBeenCalledWith(ledgerReceiptFiles);
    expect(selectWhere).toHaveBeenCalledWith(eq(ledgerReceiptFiles.key, key));
    expect(selectLimit).toHaveBeenCalledWith(1);
  });

  // ── delete() ───────────────────────────────────────────────────────────

  it("delete() calls db.delete(ledgerReceiptFiles).where(eq(ledgerReceiptFiles.key, key)) and resolves without throwing", async () => {
    const key = "receipts/abc-123/invoice.pdf";

    await expect(storage.delete(key)).resolves.toBeUndefined();

    expect(db.delete).toHaveBeenCalledWith(ledgerReceiptFiles);
    expect(deleteWhere).toHaveBeenCalledWith(eq(ledgerReceiptFiles.key, key));
  });

  it("delete() resolves without throwing when the mocked delete chain affects zero rows (deleting a key whose bytes were never written)", async () => {
    // deleteWhere's mock always resolves undefined regardless of "row count" —
    // this asserts the adapter does no existence check and never throws for
    // a key with no matching row, matching the interface's no-op contract.
    await expect(storage.delete("receipts/ghost/file.pdf")).resolves.toBeUndefined();
  });
});
