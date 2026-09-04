/**
 * Unit tests for LocalClubFileStorage — mirrors
 * src/lib/receipt-storage/receipt-storage.test.ts's LocalReceiptStorage
 * suite for the sibling Club Files adapter (DECISION-094).
 *
 * Tests are pure filesystem operations — no DB, no network.
 * Uses a temp directory scoped to each test run so runs don't interfere.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { LocalClubFileStorage } from "./local";

function makeTmpStorage(): { storage: LocalClubFileStorage; tmpDir: string } {
  // Create a temp directory and patch the instance's `root` so tests don't
  // write to the real `.club-file-store/`.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "club-file-test-"));
  const storage = new LocalClubFileStorage();
  // Bypass private field access via type cast to override root for isolated tests
  (storage as unknown as { root: string }).root = tmpDir;
  return { storage, tmpDir };
}

function rmrf(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("LocalClubFileStorage", () => {
  let storage: LocalClubFileStorage;
  let tmpDir: string;

  beforeEach(() => {
    ({ storage, tmpDir } = makeTmpStorage());
  });

  afterEach(() => {
    rmrf(tmpDir);
  });

  it("save → read round-trip returns the same bytes and contentType", async () => {
    const key = "club-files/abc-123/sponsor-packet.pdf";
    const bytes = Buffer.from("%PDF-1.4 mock pdf content");
    const contentType = "application/pdf";

    await storage.save(key, bytes, contentType);
    const result = await storage.read(key);

    expect(result).not.toBeNull();
    expect(result!.bytes.toString()).toBe("%PDF-1.4 mock pdf content");
    expect(result!.contentType).toBe("application/pdf");
  });

  it("save creates intermediate directories for nested keys", async () => {
    const key = "club-files/deep/path/packet.pdf";
    const bytes = Buffer.from("%PDF-1.4");
    await storage.save(key, bytes, "application/pdf");

    const result = await storage.read(key);
    expect(result).not.toBeNull();
  });

  it("read returns null for a non-existent key", async () => {
    const result = await storage.read("club-files/does-not-exist/file.pdf");
    expect(result).toBeNull();
  });

  it("delete removes the file so subsequent read returns null", async () => {
    const key = "club-files/todelete/packet.pdf";
    await storage.save(key, Buffer.from("data"), "application/pdf");
    await storage.delete(key);

    const result = await storage.read(key);
    expect(result).toBeNull();
  });

  it("delete is a no-op for a non-existent key (no throw)", async () => {
    await expect(storage.delete("club-files/ghost/file.pdf")).resolves.toBeUndefined();
  });

  it("save overwrites an existing file with new bytes (replace-in-place)", async () => {
    const key = "club-files/overwrite/packet.pdf";
    await storage.save(key, Buffer.from("original"), "application/pdf");
    await storage.save(key, Buffer.from("updated"), "application/pdf");

    const result = await storage.read(key);
    expect(result!.bytes.toString()).toBe("updated");
  });

  it("returns application/octet-stream when content-type sidecar is missing", async () => {
    const key = "club-files/noct/file.bin";
    await storage.save(key, Buffer.from("data"), "application/octet-stream");
    const root = (storage as unknown as { root: string }).root;
    const ctPath = path.join(root, "club-files", "noct", "file.bin.ct");
    if (fs.existsSync(ctPath)) fs.unlinkSync(ctPath);

    const result = await storage.read(key);
    expect(result!.contentType).toBe("application/octet-stream");
  });

  it("sanitizes path traversal attempts in the key", async () => {
    const key = "club-files/../../../etc/passwd";
    const bytes = Buffer.from("harmless");
    await storage.save(key, bytes, "text/plain");

    const root = (storage as unknown as { root: string }).root;
    const resolvedPath = path.join(root, "club-files", "etc", "passwd");
    expect(fs.existsSync(resolvedPath)).toBe(true);
    expect(resolvedPath.startsWith(root)).toBe(true);
  });
});
