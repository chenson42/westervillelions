/**
 * The one place the Zeffy integration reads its environment. Every other file
 * in src/lib/zeffy/ takes an `env` argument (defaulting to these readers) so
 * tests never touch process.env.
 *
 * Secrets are returned, never logged. Nothing here is Santa's-Workshop-specific.
 */

export interface ZeffyEnv {
  ZEFFY_WEBHOOK_SECRET?: string;
  ZEFFY_API_KEY?: string;
  ZEFFY_DEV_CAMPAIGN_ALLOWLIST?: string;
  ZEFFY_API_BASE_URL?: string;
  NODE_ENV?: string;
}

/** The process environment, narrowed to the variables this module reads. */
export function readZeffyEnv(): ZeffyEnv {
  return {
    ZEFFY_WEBHOOK_SECRET: process.env.ZEFFY_WEBHOOK_SECRET,
    ZEFFY_API_KEY: process.env.ZEFFY_API_KEY,
    ZEFFY_DEV_CAMPAIGN_ALLOWLIST: process.env.ZEFFY_DEV_CAMPAIGN_ALLOWLIST,
    ZEFFY_API_BASE_URL: process.env.ZEFFY_API_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function webhookSecret(env: ZeffyEnv = readZeffyEnv()): string | undefined {
  return nonEmpty(env.ZEFFY_WEBHOOK_SECRET);
}

export function apiKey(env: ZeffyEnv = readZeffyEnv()): string | undefined {
  return nonEmpty(env.ZEFFY_API_KEY);
}

export function isProduction(env: ZeffyEnv = readZeffyEnv()): boolean {
  return env.NODE_ENV === "production";
}

/** Campaign ids a NON-production process may read (comma-separated). Empty means none. */
export function devCampaignAllowlist(env: ZeffyEnv = readZeffyEnv()): string[] {
  const raw = env.ZEFFY_DEV_CAMPAIGN_ALLOWLIST;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Booleans only: for the go-live checklist. Never the values. */
export function zeffyConfigStatus(env: ZeffyEnv = readZeffyEnv()): {
  webhookSecretSet: boolean;
  apiKeySet: boolean;
} {
  return { webhookSecretSet: !!webhookSecret(env), apiKeySet: !!apiKey(env) };
}

export const DEFAULT_ZEFFY_API_BASE = "https://api.zeffy.com";

/**
 * Where the API lives. ZEFFY_API_BASE_URL (a local stub for QA and e2e) is
 * honoured ONLY outside production; in production it is ignored, so a stray
 * variable can never redirect the club's API key.
 */
export function apiBaseUrl(env: ZeffyEnv = readZeffyEnv()): string {
  const override = nonEmpty(env.ZEFFY_API_BASE_URL);
  if (!override || isProduction(env)) return DEFAULT_ZEFFY_API_BASE;
  return override;
}
