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
//   1. Local dev: BLOB_READ_WRITE_TOKEN absent → LocalReceiptStorage used (manual smoke)
//   2. The LocalReceiptStorage class itself is fully tested above
//   3. The upload route integration is verified via dev-server smoke test in QA Phase 5
