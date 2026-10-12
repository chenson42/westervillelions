/**
 * Typed client for the Zeffy public API (https://api.zeffy.com, bearer key).
 *
 * Server-only (reads the API key). Rules that the tests pin:
 *   - `listPayments` requires a campaign id (type AND runtime): an
 *     organization-wide pull is impossible by construction.
 *   - Non-production is deny-by-default: any call is refused unless the
 *     campaign id is in ZEFFY_DEV_CAMPAIGN_ALLOWLIST, and a payment of another
 *     campaign is discarded unread. A dev server holding a production key can
 *     never pull real parents' data into a dev database.
 *   - Documented limits are 100 requests/minute and 20/second per organization,
 *     shared by every key. Requests are sequential, at least `minIntervalMs`
 *     apart. A 429 honours Retry-After; a wait longer than `maxRetryWaitMs` is
 *     raised as ZeffyRateLimitedError so a time-boxed caller can hand the delay
 *     to its own client instead of sleeping inside a serverless function.
 *   - Neither the key nor a response body ever appears in a thrown message.
 */

import { apiBaseUrl, apiKey, devCampaignAllowlist, isProduction, readZeffyEnv, type ZeffyEnv } from "./config";
import { isCampaign, isRecord, type ZeffyCampaign, type ZeffyPayment } from "./types";

export const ZEFFY_PAGE_LIMIT = 100;
export const ZEFFY_MIN_INTERVAL_MS = 700;

export type ZeffyErrorCode =
  | "not_configured"
  | "dev_campaign_not_allowed"
  | "campaign_required"
  | "unauthorized"
  | "bad_request"
  | "rate_limited"
  | "unavailable"
  | "bad_response";

export class ZeffyError extends Error {
  readonly code: ZeffyErrorCode;
  readonly status: number | null;
  constructor(code: ZeffyErrorCode, status: number | null = null) {
    super(`zeffy_${code}`);
    this.name = "ZeffyError";
    this.code = code;
    this.status = status;
  }
}

export class ZeffyRateLimitedError extends ZeffyError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("rate_limited", 429);
    this.name = "ZeffyRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ZeffyClientOptions {
  fetch?: typeof fetch;
  env?: ZeffyEnv;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetryWaitMs?: number;
  timeoutMs?: number;
}

export interface PaymentPage {
  payments: ZeffyPayment[];
  hasMore: boolean;
  nextCursor: string | null;
  /** Payments the server returned for another campaign and we dropped unread. */
  discarded: number;
}

export type GetPaymentResult =
  | { gone: true }
  | { gone: false; outOfScope: true }
  | { gone: false; outOfScope: false; payment: ZeffyPayment };

export interface CampaignSummary {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  rates: { id: string; title: string; amountCents: number | null }[];
  occurrences: { id: string; startSeconds: number | null; endSeconds: number | null }[];
}

export interface ZeffyClient {
  listPayments(params: {
    campaignId: string;
    startingAfter?: string | null;
    limit?: number;
    status?: "succeeded" | "failed" | "pending";
  }): Promise<PaymentPage>;
  listAllPayments(params: {
    campaignId: string;
    status?: "succeeded" | "failed" | "pending";
    maxPages?: number;
  }): Promise<ZeffyPayment[]>;
  getPayment(id: string): Promise<GetPaymentResult>;
  listCampaigns(): Promise<CampaignSummary[]>;
  getCampaign(id: string): Promise<CampaignSummary | null>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toSummary(c: ZeffyCampaign): CampaignSummary {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: c.id,
    title: c.title,
    type: typeof c.type === "string" ? c.type : null,
    status: typeof c.status === "string" ? c.status : null,
    startSeconds: num(c.start_date),
    endSeconds: num(c.end_date),
    rates: (Array.isArray(c.rates) ? c.rates : [])
      .filter((r) => isRecord(r) && typeof r.id === "string")
      .map((r) => ({ id: r.id, title: typeof r.title === "string" ? r.title : "", amountCents: num(r.amount) })),
    occurrences: (Array.isArray(c.occurrences) ? c.occurrences : [])
      .filter((o) => isRecord(o) && typeof o.id === "string")
      .map((o) => ({ id: o.id, startSeconds: num(o.start), endSeconds: num(o.end) })),
  };
}

export function createZeffyClient(options: ZeffyClientOptions = {}): ZeffyClient {
  const env = options.env ?? readZeffyEnv();
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? ZEFFY_MIN_INTERVAL_MS;
  const maxRetryWait = options.maxRetryWaitMs ?? 20_000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastRequestAt = 0;

  function requireKey(): string {
    const key = apiKey(env);
    if (!key) throw new ZeffyError("not_configured");
    return key;
  }

  /** Non-production: the allowlist is mandatory for ANY call. Returns the list, or null in production. */
  function devAllowlist(): string[] | null {
    if (isProduction(env)) return null;
    const list = devCampaignAllowlist(env);
    if (list.length === 0) throw new ZeffyError("dev_campaign_not_allowed");
    return list;
  }

  async function request(path: string, query: Record<string, string | number | undefined>): Promise<Response> {
    const key = requireKey();
    const url = new URL(path, apiBaseUrl(env));
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    for (let attempt = 0; ; attempt += 1) {
      const wait = lastRequestAt + minInterval - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();

      let res: Response;
      try {
        res = await doFetch(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Network error or timeout: never echo the cause (it can carry the URL).
        throw new ZeffyError("unavailable");
      }

      if (res.status === 429) {
        const retryAfterSeconds = Number(res.headers.get("Retry-After"));
        const retryAfterMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 60_000;
        if (retryAfterMs > maxRetryWait || attempt >= 2) throw new ZeffyRateLimitedError(retryAfterMs);
        await sleep(retryAfterMs);
        continue;
      }
      return res;
    }
  }

  function failFor(res: Response): never {
    if (res.status === 401) throw new ZeffyError("unauthorized", 401);
    if (res.status >= 500) throw new ZeffyError("unavailable", res.status);
    throw new ZeffyError("bad_request", res.status);
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new ZeffyError("bad_response", res.status);
    }
  }

  async function listPayments(params: {
    campaignId: string;
    startingAfter?: string | null;
    limit?: number;
    status?: "succeeded" | "failed" | "pending";
  }): Promise<PaymentPage> {
    if (!params || typeof params.campaignId !== "string" || !params.campaignId.trim()) {
      throw new ZeffyError("campaign_required");
    }
    const allow = devAllowlist();
    if (allow && !allow.includes(params.campaignId)) throw new ZeffyError("dev_campaign_not_allowed");

    const res = await request("/api/v1/payments", {
      campaign: params.campaignId,
      limit: Math.min(Math.max(params.limit ?? ZEFFY_PAGE_LIMIT, 1), ZEFFY_PAGE_LIMIT),
      starting_after: params.startingAfter ?? undefined,
      status: params.status,
    });
    if (!res.ok) failFor(res);
    const body = await json(res);
    if (!isRecord(body) || !Array.isArray(body.data)) throw new ZeffyError("bad_response", res.status);

    const payments: ZeffyPayment[] = [];
    let discarded = 0;
    for (const p of body.data) {
      if (!isRecord(p) || typeof p.id !== "string") continue;
      // Defensive, and the dev guarantee: other campaigns are dropped unread.
      if (p.campaign_id !== params.campaignId) {
        discarded += 1;
        continue;
      }
      payments.push(p as unknown as ZeffyPayment);
    }
    return {
      payments,
      hasMore: body.has_more === true,
      nextCursor: typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null,
      discarded,
    };
  }

  return {
    listPayments,

    async listAllPayments({ campaignId, status, maxPages = 50 }) {
      const all: ZeffyPayment[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < maxPages; page += 1) {
        const result: PaymentPage = await listPayments({ campaignId, startingAfter: cursor, status });
        all.push(...result.payments);
        if (!result.hasMore || !result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return all;
    },

    async getPayment(id) {
      if (!id || id.length > 200 || /[/?#\s]/.test(id)) throw new ZeffyError("bad_request");
      const allow = devAllowlist();
      const res = await request(`/api/v1/payments/${encodeURIComponent(id)}`, {});
      if (res.status === 404) return { gone: true };
      if (!res.ok) failFor(res);
      const body = await json(res);
      if (!isRecord(body) || typeof body.id !== "string") throw new ZeffyError("bad_response", res.status);
      if (allow && (typeof body.campaign_id !== "string" || !allow.includes(body.campaign_id))) {
        return { gone: false, outOfScope: true };
      }
      return { gone: false, outOfScope: false, payment: body as unknown as ZeffyPayment };
    },

    async listCampaigns() {
      const allow = devAllowlist();
      const out: CampaignSummary[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const res = await request("/api/v1/campaigns", {
          limit: ZEFFY_PAGE_LIMIT,
          starting_after: cursor ?? undefined,
        });
        if (!res.ok) failFor(res);
        const body = await json(res);
        if (!isRecord(body) || !Array.isArray(body.data)) throw new ZeffyError("bad_response", res.status);
        for (const c of body.data) {
          if (!isCampaign(c)) continue;
          if (allow && !allow.includes(c.id)) continue;
          out.push(toSummary(c));
        }
        if (body.has_more !== true || typeof body.next_cursor !== "string" || !body.next_cursor) break;
        cursor = body.next_cursor;
      }
      return out;
    },

    async getCampaign(id) {
      if (!id || id.length > 200 || /[/?#\s]/.test(id)) throw new ZeffyError("bad_request");
      const allow = devAllowlist();
      if (allow && !allow.includes(id)) throw new ZeffyError("dev_campaign_not_allowed");
      const res = await request(`/api/v1/campaigns/${encodeURIComponent(id)}`, {});
      if (res.status === 404) return null;
      if (!res.ok) failFor(res);
      const body = await json(res);
      if (!isCampaign(body)) throw new ZeffyError("bad_response", res.status);
      return toSummary(body);
    },
  };
}
