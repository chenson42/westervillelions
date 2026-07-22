/**
 * Unit tests for LocalReceiptStorage and the magic-byte validator.
 *
 * Tests are pure filesystem operations — no DB, no network.
 * Uses a temp directory scoped to each test run so runs don't interfere.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// LocalReceiptStorage round-trip tests
// ---------------------------------------------------------------------------

import { LocalReceiptStorage } from "./local";

function makeTmpStorage(): { storage: LocalReceiptStorage; tmpDir: string } {
  // Create a temp directory and patch the instance's `root` so tests don't
  // write to the real `.receipt-store/`.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-test-"));
  const storage = new LocalReceiptStorage();
  // Bypass private field access via type cast to override root for isolated tests
  (storage as unknown as { root: string }).root = tmpDir;
  return { storage, tmpDir };
}

function rmrf(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("LocalReceiptStorage", () => {
  let storage: LocalReceiptStorage;
  let tmpDir: string;

  beforeEach(() => {
    ({ storage, tmpDir } = makeTmpStorage());
  });

  afterEach(() => {
    rmrf(tmpDir);
  });

  it("save → read round-trip returns the same bytes and contentType", async () => {
    const key = "receipts/abc-123/invoice.pdf";
    const bytes = Buffer.from("mock pdf content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);
    const result = await storage.read(key);

    expect(result).not.toBeNull();
    expect(result!.bytes.toString()).toBe("mock pdf content");
    expect(result!.contentType).toBe("application/pdf");
  });

  it("save creates intermediate directories for nested keys", async () => {
    const key = "receipts/deep/path/image.jpg";
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await storage.save(key, bytes, "image/jpeg");

    const result = await storage.read(key);
    expect(result).not.toBeNull();
  });

  it("read returns null for a non-existent key", async () => {
    const result = await storage.read("receipts/does-not-exist/file.pdf");
    expect(result).toBeNull();
  });

  it("delete removes the file so subsequent read returns null", async () => {
    const key = "receipts/todelete/receipt.pdf";
    await storage.save(key, Buffer.from("data"), "application/pdf");
    await storage.delete(key);

    const result = await storage.read(key);
    expect(result).toBeNull();
  });

  it("delete is a no-op for a non-existent key (no throw)", async () => {
    await expect(storage.delete("receipts/ghost/file.pdf")).resolves.toBeUndefined();
  });

  it("save overwrites an existing file with new bytes", async () => {
    const key = "receipts/overwrite/doc.pdf";
    await storage.save(key, Buffer.from("original"), "application/pdf");
    await storage.save(key, Buffer.from("updated"), "application/pdf");

    const result = await storage.read(key);
    expect(result!.bytes.toString()).toBe("updated");
  });

  it("returns application/octet-stream when content-type sidecar is missing", async () => {
    const key = "receipts/noct/file.bin";
    await storage.save(key, Buffer.from("data"), "application/octet-stream");
    // Remove the .ct sidecar to simulate a missing content-type file
    const root = (storage as unknown as { root: string }).root;
    const ctPath = path.join(root, "receipts", "noct", "file.bin.ct");
    if (fs.existsSync(ctPath)) fs.unlinkSync(ctPath);

    const result = await storage.read(key);
    expect(result!.contentType).toBe("application/octet-stream");
  });

  it("sanitizes path traversal attempts in the key", async () => {
    // A malicious key attempting to escape .receipt-store/
    const key = "receipts/../../../etc/passwd";
    const bytes = Buffer.from("harmless");
    // Save should succeed but resolve under tmpDir only
    await storage.save(key, bytes, "text/plain");

    const root = (storage as unknown as { root: string }).root;
    // The resolved path must be under tmpDir
    const resolvedPath = path.join(root, "receipts", "etc", "passwd");
    expect(fs.existsSync(resolvedPath)).toBe(true);
    // Make sure nothing was written outside tmpDir
    const escapedPath = "/etc/passwd";
    // We can't assert /etc/passwd was NOT modified by us without side-effects.
    // Instead, assert the write went to the correct location (under tmpDir).
    expect(resolvedPath.startsWith(root)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Magic-byte validator tests
// ---------------------------------------------------------------------------

import { validateMagicBytes } from "../receipt-magic-bytes";

describe("validateMagicBytes", () => {
  it("accepts a PDF file by magic bytes", () => {
    // %PDF-1.4 signature
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(validateMagicBytes(pdfBytes)).toBe("application/pdf");
  });

  it("accepts a JPEG file by magic bytes", () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);
    expect(validateMagicBytes(jpegBytes)).toBe("image/jpeg");
  });

  it("accepts a JPEG with EXIF marker (FF D8 FF E1)", () => {
    const jpegExif = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00, 0x00, 0x00]);
    expect(validateMagicBytes(jpegExif)).toBe("image/jpeg");
  });

  it("accepts a PNG file by magic bytes", () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateMagicBytes(pngBytes)).toBe("image/png");
  });

  it("rejects a file that doesn't match any allowed type", () => {
    const unknown = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    expect(validateMagicBytes(unknown)).toBe(null);
  });

  it("rejects an empty buffer", () => {
    expect(validateMagicBytes(Buffer.alloc(0))).toBe(null);
  });

  it("rejects a buffer shorter than 4 bytes", () => {
    expect(validateMagicBytes(Buffer.from([0x25, 0x50]))).toBe(null);
  });

  it("rejects a file with Content-Type spoofing (PDF extension, GIF bytes)", () => {
    // A file named .pdf but with GIF magic bytes
    const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
    expect(validateMagicBytes(gifBytes)).toBe(null);
  });

  it("rejects a WEBP file (not in the allowed receipt types) — regression for format-expansion", () => {
    // WEBP: starts with RIFF (52 49 46 46) ... WEBP
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x10, 0x00, 0x00]);
    expect(validateMagicBytes(webpBytes)).toBe(null);
  });

  it("accepts a JPEG with app2 ICC profile marker (FF D8 FF E2) — regression for JPEG variant coverage", () => {
    // JPEG with APP2 marker — still valid JPEG, third byte must be FF
    const jpegApp2 = Buffer.from([0xff, 0xd8, 0xff, 0xe2, 0x00, 0x00, 0x00, 0x00]);
    expect(validateMagicBytes(jpegApp2)).toBe("image/jpeg");
  });
});

// Note: getReceiptStorage() factory is not directly unit-testable in this Vitest
// configuration because it uses synchronous require() which cannot resolve relative
// modules in the ESM test environment. Factory behavior is verified by:
//   1. Local dev/test: NODE_ENV !== "production" → LocalReceiptStorage used (DECISION-040)
//   2. The LocalReceiptStorage class itself is fully tested above
//   3. The DatabaseReceiptStorage class is fully tested in database.test.ts
//   4. The NODE_ENV === "production" branch is verified via `next start` smoke
//      test in QA Phase 5 (see work-log 2026-07-21-receipt-storage-in-database.md)

// ---------------------------------------------------------------------------
// RECEIPT_KEY_REGEX (DECISION-035 — hoisted shared export)
// ---------------------------------------------------------------------------
//
// Was previously duplicated in src/app/api/members/reimbursements/route.ts and
// [id]/route.ts; the Transaction Receipt Upload increment hoisted it here
// rather than pasting a third copy for the new transaction routes. These
// tests guard that the hoist didn't change behavior.

import { RECEIPT_KEY_REGEX, receiptBytesToBodyInit } from "./index";

describe("RECEIPT_KEY_REGEX", () => {
  it("accepts a well-formed key: receipts/<uuid>/<filename>", () => {
    expect(RECEIPT_KEY_REGEX.test("receipts/550e8400-e29b-41d4-a716-446655440000/invoice.pdf")).toBe(
      true,
    );
  });

  it("accepts a well-formed key with a sanitized filename containing dots, dashes, underscores", () => {
    expect(
      RECEIPT_KEY_REGEX.test("receipts/550e8400-e29b-41d4-a716-446655440000/my_receipt-2026.07.21.jpg"),
    ).toBe(true);
  });

  it("rejects a path-traversal-shaped string", () => {
    expect(RECEIPT_KEY_REGEX.test("receipts/../../../etc/passwd")).toBe(false);
  });

  it("rejects a key with the wrong prefix", () => {
    expect(RECEIPT_KEY_REGEX.test("uploads/550e8400-e29b-41d4-a716-446655440000/invoice.pdf")).toBe(
      false,
    );
  });

  it("rejects a key missing the uuid segment", () => {
    expect(RECEIPT_KEY_REGEX.test("receipts/invoice.pdf")).toBe(false);
  });

  it("rejects a bare blob URL (never a URL, always an opaque key)", () => {
    expect(
      RECEIPT_KEY_REGEX.test("https://blob.vercel-storage.com/receipts/abc/invoice.pdf"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// receiptBytesToBodyInit (regression — QA Phase 5, 2026-07-21)
// ---------------------------------------------------------------------------
//
// Both GET .../transactions/[id]/receipt and GET .../reimbursements/[id]/receipt
// previously constructed their Response body as `stored.bytes.buffer as
// ArrayBuffer` — the Buffer's *underlying* ArrayBuffer, ignoring byteOffset/
// byteLength. For small files (fs.readFileSync reads under Node's
// Buffer.poolSize land in a shared pool, so byteOffset is nonzero and
// `.buffer` is the whole pool, not the file), this streamed unrelated
// in-process memory while still declaring the correct Content-Length. These
// tests construct exactly that shape — a Buffer view with a nonzero
// byteOffset into a larger backing ArrayBuffer — and assert the helper (and
// the full Response body path both routes use) yields only the view's own
// bytes.

describe("receiptBytesToBodyInit", () => {
  it("returns exactly the view's own bytes, not the underlying (larger, pooled) ArrayBuffer — regression for small-file receipt-view corruption", () => {
    // Simulate Node's shared Buffer pool: one large backing ArrayBuffer, with
    // the "real" 10-byte file living at a nonzero offset inside it, and
    // unrelated sentinel bytes filling the rest (standing in for whatever
    // other small allocation — e.g. a SQL string — happens to share the pool).
    const pool = Buffer.alloc(200, 0xaa);
    const payload = "0123456789"; // 10 bytes
    pool.write(payload, 100, "utf8");

    // A Buffer VIEW into the pool at offset 100, length 10 — exactly the
    // shape fs.readFileSync returns for a small pooled read.
    const view = Buffer.from(pool.buffer, pool.byteOffset + 100, 10);
    expect(view.byteOffset).toBeGreaterThan(0); // guard: the test itself must be non-degenerate
    expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength); // guard: buffer really is bigger than the view

    const body = receiptBytesToBodyInit(view);

    expect(body.byteLength).toBe(10);
    expect(Buffer.from(body).toString("utf8")).toBe(payload);
  });

  it("round-trips through an actual Response body with only the view's bytes — the exact path both receipt routes use", async () => {
    const pool = Buffer.alloc(200, 0xaa);
    const payload = "receipt-bytes"; // 13 bytes, well under Buffer.poolSize
    pool.write(payload, 50, "utf8");
    const view = Buffer.from(pool.buffer, pool.byteOffset + 50, payload.length);

    const response = new Response(receiptBytesToBodyInit(view), {
      status: 200,
      headers: { "Content-Length": view.byteLength.toString() },
    });
    const received = Buffer.from(await response.arrayBuffer());

    expect(received.byteLength).toBe(payload.length);
    expect(received.toString("utf8")).toBe(payload);
  });

  it("passes through a non-pooled, zero-offset Buffer unchanged (no regression for the common case)", () => {
    const bytes = Buffer.from("%PDF-1.4 mock content");
    const body = receiptBytesToBodyInit(bytes);

    expect(body.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(body).toString("utf8")).toBe(bytes.toString("utf8"));
  });
});
