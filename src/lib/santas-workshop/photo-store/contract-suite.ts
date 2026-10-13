/**
 * The ONE contract every PhotoStore adapter must pass (memory and local run it;
 * the Drive adapter is exercised against a fake client in drive.test.ts).
 * Test-support only: importing this from production code is a scan failure.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { streamToBytes, type PhotoStore } from "./types";

export function runPhotoStoreContract(name: string, makeStore: () => Promise<PhotoStore> | PhotoStore): void {
  describe(`${name}: PhotoStore contract`, () => {
    it("put/get round trip", async () => {
      const store = await makeStore();
      const folder = await store.ensureFolder("round-trip");
      const bytes = Uint8Array.of(1, 2, 3, 4, 5);
      const { key } = await store.put({ folderKey: folder, photoId: randomUUID(), variant: "full", bytes, contentType: "image/jpeg" });
      const got = await store.get(key);
      expect(got).not.toBeNull();
      expect(got?.contentType).toBe("image/jpeg");
      expect(Array.from(await streamToBytes(got!.stream))).toEqual([1, 2, 3, 4, 5]);
    });

    it("put is idempotent per (folder, photoId, variant)", async () => {
      const store = await makeStore();
      const folder = await store.ensureFolder("idempotent");
      const photoId = randomUUID();
      const a = await store.put({ folderKey: folder, photoId, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
      const b = await store.put({ folderKey: folder, photoId, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg", attempt: 2 });
      expect(b.key).toBe(a.key);
      const listed = await store.list(folder);
      expect(listed.items.filter((i) => i.photoId === photoId && i.variant === "full")).toHaveLength(1);
    });

    it("get of a missing key is null", async () => {
      const store = await makeStore();
      const folder = await store.ensureFolder("missing");
      const { key } = await store.put({ folderKey: folder, photoId: randomUUID(), variant: "thumb", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    });

    it("delete of a missing key succeeds", async () => {
      const store = await makeStore();
      const folder = await store.ensureFolder("delete-missing");
      const { key } = await store.put({ folderKey: folder, photoId: randomUUID(), variant: "thumb", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
      await store.delete(key);
      await expect(store.delete(key)).resolves.toBeUndefined();
    });

    it("list reports the objects with parsed photo ids and pages", async () => {
      const store = await makeStore();
      const folder = await store.ensureFolder("listing");
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids) await store.put({ folderKey: folder, photoId: id, variant: "full", bytes: Uint8Array.of(9, 9), contentType: "image/jpeg" });
      const seen: string[] = [];
      let token: string | undefined;
      let pages = 0;
      do {
        const page = await store.list(folder, token);
        pages += 1;
        for (const item of page.items) {
          expect(item.size).toBe(2);
          seen.push(item.photoId);
        }
        token = page.next;
      } while (token && pages < 10);
      expect(seen.sort()).toEqual([...ids].sort());
    });

    it("ensureFolder is idempotent", async () => {
      const store = await makeStore();
      expect(await store.ensureFolder("same-name")).toBe(await store.ensureFolder("same-name"));
    });

    it("ping is ok", async () => {
      const store = await makeStore();
      const result = await store.ping();
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
}
