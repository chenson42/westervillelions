/**
 * The ONLY place the photo store reads the environment. A scan test
 * (secrets-not-logged) also keeps key material out of log calls.
 *
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON   the key file minified to one line (jq -c . key.json)
 *   GOOGLE_DRIVE_SHARED_DRIVE_ID        the private shared drive's id
 *   GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID   optional folder inside that drive; defaults to the drive root
 *   SW_PHOTO_STORE=drive                opt in to Drive outside production (dev default is local)
 */

import { StorageMisconfigured } from "./errors";

/** The process environment. The photo store reads it through this one function (and the factory's callers pass it on). */
export function processEnv(): NodeJS.ProcessEnv {
  return process.env;
}

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export interface DriveConfig {
  account: ServiceAccount;
  sharedDriveId: string;
  rootFolderId: string;
}

/** Parses the minified key JSON. Throws StorageMisconfigured with a FIXED message: never echoes the input. */
export function parseServiceAccountJson(raw: string | undefined): ServiceAccount {
  if (!raw || !raw.trim()) throw new StorageMisconfigured("The Drive service account is not configured");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageMisconfigured("The Drive service account JSON is not valid JSON");
  }
  const obj = parsed as { client_email?: unknown; private_key?: unknown } | null;
  if (!obj || typeof obj.client_email !== "string" || !obj.client_email.includes("@")) {
    throw new StorageMisconfigured("The Drive service account JSON has no client_email");
  }
  if (typeof obj.private_key !== "string" || !obj.private_key.includes("PRIVATE KEY")) {
    throw new StorageMisconfigured("The Drive service account JSON has no private key");
  }
  return { clientEmail: obj.client_email, privateKey: obj.private_key };
}

export function readDriveConfig(env: NodeJS.ProcessEnv = processEnv()): DriveConfig {
  const account = parseServiceAccountJson(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
  const sharedDriveId = env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim();
  if (!sharedDriveId) throw new StorageMisconfigured("GOOGLE_DRIVE_SHARED_DRIVE_ID is not set");
  const rootFolderId = env.GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID?.trim() || sharedDriveId;
  return { account, sharedDriveId, rootFolderId };
}

export type PhotoStoreMode = "memory" | "drive" | "local";

/** Which adapter this process uses. Production is always Drive (the factory hard-fails if it is not configured). */
export function selectPhotoStoreMode(env: NodeJS.ProcessEnv = processEnv()): PhotoStoreMode {
  if (env.NODE_ENV === "test") return "memory";
  if (env.NODE_ENV === "production") return "drive";
  return env.SW_PHOTO_STORE === "drive" ? "drive" : "local";
}

export function localStoreRoot(env: NodeJS.ProcessEnv = processEnv()): string {
  return env.SW_LOCAL_STORE_DIR?.trim() || ".santas-workshop-store";
}

/** Non-throwing description for the admin banner and checklist: booleans and a mode, never values. */
export function describePhotoStoreConfig(env: NodeJS.ProcessEnv = processEnv()): {
  mode: PhotoStoreMode;
  configured: boolean;
  problem: string | null;
} {
  const mode = selectPhotoStoreMode(env);
  if (mode !== "drive") return { mode, configured: true, problem: null };
  try {
    readDriveConfig(env);
    return { mode, configured: true, problem: null };
  } catch (e) {
    return { mode, configured: false, problem: e instanceof Error ? e.message : "Photo storage is not configured" };
  }
}
