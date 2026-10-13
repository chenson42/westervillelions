/**
 * S1 spike: prove the Google Drive photo store works with the real service account
 * BEFORE any worker uses it. Dry run by default: it prints which environment
 * variables are set (booleans only) and what it WOULD do, and calls nothing.
 *
 *   pnpm exec dotenv -e .env.local -- tsx scripts/spike-drive.ts           # dry run
 *   pnpm exec dotenv -e .env.local -- tsx scripts/spike-drive.ts --apply   # real calls
 *
 * Needs GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON (the key file minified to one line,
 * `jq -c . key.json`) and GOOGLE_DRIVE_SHARED_DRIVE_ID; GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID
 * is optional (default: the shared drive's root). The service account must be a
 * member of that shared drive.
 *
 * With --apply it (1) times the lazy import of googleapis, (2) creates a throwaway
 * folder under the root, (3) uploads a 1 MB random JPEG-shaped file, (4) downloads
 * it and compares sha256, (5) finds it again by appProperties (the retry path),
 * (6) PERMANENTLY deletes the file and prints whether the role allowed it
 * (Contributor is believed not to; Content manager is believed to: unmeasured until
 * this runs), (7) deletes the folder, and prints the latency of each step.
 * It prints no secret, no file id, and writes nothing to the database.
 *
 * It refuses to run with NODE_ENV=production.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDriveClient, createDrivePhotoStore } from "../src/lib/santas-workshop/photo-store/drive";
import { readDriveConfig } from "../src/lib/santas-workshop/photo-store/config";
import { streamToBytes } from "../src/lib/santas-workshop/photo-store/types";

const APPLY = process.argv.includes("--apply");

function flag(name: string): string {
  return process.env[name]?.trim() ? "set" : "NOT SET";
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const out = await run();
    console.log(`  ${label}: ${Date.now() - started} ms`);
    return out;
  } catch (e) {
    console.log(`  ${label}: FAILED after ${Date.now() - started} ms (${(e as { code?: string; name?: string }).code ?? (e as Error).name})`);
    throw e;
  }
}

/** A 1 MB byte string that starts and ends like a JPEG; Drive does not decode it. */
function fakeJpeg(): Uint8Array {
  const body = randomBytes(1024 * 1024 - 4);
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...body.subarray(0, body.length - 2), 0xff, 0xd9]);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");

  console.log(`Mode: ${APPLY ? "APPLY (real Drive calls)" : "dry run (no calls)"}`);
  console.log(`  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: ${flag("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")}`);
  console.log(`  GOOGLE_DRIVE_SHARED_DRIVE_ID: ${flag("GOOGLE_DRIVE_SHARED_DRIVE_ID")}`);
  console.log(`  GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID: ${flag("GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID")} (optional)`);

  const config = readDriveConfig(); // throws a fixed message, never echoing the key
  if (!APPLY) {
    console.log("\nWould: import googleapis, create a throwaway folder, upload 1 MB, download and compare, list by appProperties, permanently delete the file and the folder.");
    console.log("Run again with --apply to do it.");
    return;
  }

  console.log("\nSteps:");
  await timed("import('googleapis') cold start", async () => {
    await import("googleapis");
  });
  const client = await timed("build the Drive client", () => createDriveClient(config));
  const store = createDrivePhotoStore({ drive: client, sharedDriveId: config.sharedDriveId, rootFolderId: config.rootFolderId });

  const folderName = `spike-${randomUUID().slice(0, 8)}`;
  const folder = await timed("create a folder under the root", () => store.ensureFolder(folderName));

  const photoId = randomUUID();
  const bytes = fakeJpeg();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const put = await timed("upload 1 MB", () => store.put({ folderKey: folder, photoId, variant: "full", bytes, contentType: "image/jpeg" }));

  const got = await timed("download (stream)", async () => {
    const obj = await store.get(put.key);
    if (!obj) throw new Error("uploaded file not found");
    return streamToBytes(obj.stream);
  });
  console.log(`  sha256 matches: ${createHash("sha256").update(got).digest("hex") === sha}`);

  const again = await timed("retry path: attempt 2 finds it by appProperties (no second file)", () =>
    store.put({ folderKey: folder, photoId, variant: "full", bytes, contentType: "image/jpeg", attempt: 2 }),
  );
  console.log(`  retry returned the same file: ${again.key === put.key}`);

  const listed = await timed("list the folder", () => store.list(folder));
  console.log(`  listed ${listed.items.length} item(s)`);

  let permanent = "ok";
  try {
    await timed("PERMANENT delete of the file", () => store.delete(put.key));
  } catch (e) {
    permanent = `REFUSED (${(e as { code?: string }).code ?? (e as Error).name}); the shared-drive role likely lacks Delete. Use Content manager, or keep trash-then-purge.`;
  }
  console.log(`  permanent delete under this role: ${permanent}`);

  try {
    await timed("delete the throwaway folder", async () => {
      await client.files.delete({ fileId: folder, supportsAllDrives: true });
    });
  } catch {
    console.log(`  could not delete the throwaway folder "${folderName}": remove it by hand.`);
  }
  console.log("\nDone. Record these numbers in the work-log (S1).");
}

main().catch((e) => {
  const err = e as { name?: string; message?: string };
  // Fixed-string messages only (StorageError); never print an arbitrary error body.
  console.error(`spike-drive failed: ${err.name ?? "Error"}${err.name?.startsWith("Storage") ? ` - ${err.message}` : ""}`);
  process.exit(1);
});
