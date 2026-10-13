import { createDrivePhotoStore, createLazyDrivePhotoStore } from "./drive";
import { describePhotoStoreConfig, localStoreRoot, processEnv, selectPhotoStoreMode, type PhotoStoreMode } from "./config";
import { StorageMisconfigured } from "./errors";
import { createLocalPhotoStore } from "./local";
import { createMemoryPhotoStore } from "./memory";
import type { PhotoStore } from "./types";

export type { PhotoStore } from "./types";
export * from "./errors";
export { createDrivePhotoStore };

let cached: { mode: PhotoStoreMode; store: PhotoStore } | null = null;

/**
 * The factory (Phase 3, "Photo store"):
 *   NODE_ENV=test      -> memory
 *   production         -> Drive, or a HARD failure (StorageMisconfigured) - never local or memory
 *   otherwise          -> Drive only when SW_PHOTO_STORE=drive, else local (.santas-workshop-store/)
 * Non-production Drive use is opt-in because .env.local has historically carried
 * production credentials; presence-based selection could write into a real folder.
 */
export function getPhotoStore(env: NodeJS.ProcessEnv = processEnv()): PhotoStore {
  const mode = selectPhotoStoreMode(env);
  if (env === processEnv() && cached && cached.mode === mode) return cached.store;

  let store: PhotoStore;
  if (mode === "memory") store = createMemoryPhotoStore();
  else if (mode === "local") store = createLocalPhotoStore(localStoreRoot(env));
  else {
    const status = describePhotoStoreConfig(env);
    if (!status.configured) throw new StorageMisconfigured(status.problem ?? "Photo storage is not configured");
    store = createLazyDrivePhotoStore(env);
  }
  if (env === processEnv()) cached = { mode, store };
  return store;
}

/** Test hook: drop the cached store (a fresh memory store per test file). */
export function resetPhotoStoreForTests(): void {
  cached = null;
}
