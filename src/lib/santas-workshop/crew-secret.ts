/**
 * The ONE place the worker-access modules read the environment: the signing
 * secret (AUTH_SECRET, falling back to NEXTAUTH_SECRET like src/lib/auth) and the
 * production flag. Keys are derived with HKDF per purpose, so the cookie key,
 * the code-encryption key and the IP-hash key all differ from each other and
 * from NextAuth's own use of the secret.
 */

import { hkdfSync } from "node:crypto";

export class CrewSecretMissing extends Error {
  constructor() {
    super("AUTH_SECRET is not set");
    this.name = "CrewSecretMissing";
  }
}

export function authSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) throw new CrewSecretMissing();
  return secret;
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

export const KEY_INFO = {
  cookie: "sw-crew-cookie",
  code: "sw-crew-code",
  ip: "sw-crew-ip",
} as const;

export type KeyPurpose = keyof typeof KEY_INFO;

/** 32-byte key bound to one purpose. */
export function deriveKey(secret: string, purpose: KeyPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "sw-crew-v1", KEY_INFO[purpose], 32));
}

export function purposeKey(purpose: KeyPurpose, env: NodeJS.ProcessEnv = process.env): Buffer {
  return deriveKey(authSecret(env), purpose);
}
