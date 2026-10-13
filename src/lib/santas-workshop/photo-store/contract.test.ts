import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runPhotoStoreContract } from "./contract-suite";
import { createLocalPhotoStore } from "./local";
import { createMemoryPhotoStore } from "./memory";
import { StorageMisconfigured, StorageUnavailable } from "./errors";

runPhotoStoreContract("memory", () => createMemoryPhotoStore({ pageSize: 2 }));

const roots: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-store-test-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

runPhotoStoreContract("local filesystem", () => createLocalPhotoStore(tempRoot(), { pageSize: 2 }));

describe("local adapter safety", () => {
  it("rejects path traversal in keys and folder names", async () => {
    const store = createLocalPhotoStore(tempRoot());
    await expect(store.get("../../etc/passwd")).rejects.toBeInstanceOf(StorageMisconfigured);
    await expect(store.get("a/../b")).rejects.toBeInstanceOf(StorageMisconfigured);
    await expect(store.delete("/abs/path")).rejects.toBeInstanceOf(StorageMisconfigured);
    await expect(store.list("../x")).rejects.toBeInstanceOf(StorageMisconfigured);
    await expect(store.put({ folderKey: "../x", photoId: "p", variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).rejects.toBeInstanceOf(StorageMisconfigured);
  });
});

describe("memory adapter outage hook", () => {
  it("fails every call like an outage when told to", async () => {
    const store = createMemoryPhotoStore();
    store.setFailing(true);
    await expect(store.ensureFolder("x")).rejects.toBeInstanceOf(StorageUnavailable);
    await expect(store.ping()).rejects.toBeInstanceOf(StorageUnavailable);
    store.setFailing(false);
    await expect(store.ping()).resolves.toMatchObject({ ok: true });
  });
});
