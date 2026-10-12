import { describe, expect, it, vi } from "vitest";
import { createZeffyClient, ZeffyError, ZeffyRateLimitedError } from "./client";

const KEY = "zk_test_SECRETKEY";
const PROD = { ZEFFY_API_KEY: KEY, NODE_ENV: "production" };
const DEV = { ZEFFY_API_KEY: KEY, NODE_ENV: "development", ZEFFY_DEV_CAMPAIGN_ALLOWLIST: "camp-ok, camp-two" };

const res = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

function make(env: Record<string, string>, responses: Response[]) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return next;
  });
  const sleeps: number[] = [];
  let t = 1_000_000;
  const client = createZeffyClient({
    env,
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { client, calls, sleeps, fetchFn };
}

const page = (data: unknown[], more = false, next: string | null = null) => ({ object: "list", data, has_more: more, next_cursor: next });

describe("createZeffyClient", () => {
  it("sends the bearer header", async () => {
    const { client, calls } = make(PROD, [res(page([]))]);
    await client.listPayments({ campaignId: "camp-ok" });
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0].url).toContain("https://api.zeffy.com/api/v1/payments");
    expect(calls[0].url).toContain("campaign=camp-ok");
  });

  it("listPayments throws without a campaign, before any request", async () => {
    const { client, fetchFn } = make(PROD, []);
    await expect(client.listPayments({ campaignId: "" })).rejects.toMatchObject({ code: "campaign_required" });
    // @ts-expect-error a missing campaign is a type error too
    await expect(client.listPayments({})).rejects.toMatchObject({ code: "campaign_required" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("follows next_cursor as starting_after", async () => {
    const p = (id: string) => ({ id, campaign_id: "camp-ok", status: "succeeded" });
    const { client, calls } = make(PROD, [res(page([p("a"), p("b")], true, "b")), res(page([p("c")], false, null))]);
    const all = await client.listAllPayments({ campaignId: "camp-ok" });
    expect(all.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(calls[1].url).toContain("starting_after=b");
  });

  it("spaces consecutive requests by at least the minimum interval", async () => {
    const { client, sleeps } = make(PROD, [res(page([], true, "x")), res(page([]))]);
    await client.listPayments({ campaignId: "camp-ok" });
    await client.listPayments({ campaignId: "camp-ok", startingAfter: "x" });
    expect(sleeps.some((ms) => ms > 0 && ms <= 700)).toBe(true);
  });

  it("honors Retry-After on a 429 and retries", async () => {
    const { client, sleeps, fetchFn } = make(PROD, [
      res({ error: {} }, { status: 429, headers: { "Retry-After": "2" } }),
      res(page([])),
    ]);
    await client.listPayments({ campaignId: "camp-ok" });
    expect(sleeps).toContain(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("raises ZeffyRateLimitedError for a Retry-After longer than it will wait", async () => {
    const { client } = make(PROD, [res({}, { status: 429, headers: { "Retry-After": "60" } })]);
    const err = await client.listPayments({ campaignId: "camp-ok" }).catch((e) => e);
    expect(err).toBeInstanceOf(ZeffyRateLimitedError);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it("outside production, refuses a non-allowlisted campaign without issuing the request", async () => {
    const { client, fetchFn } = make(DEV, []);
    await expect(client.listPayments({ campaignId: "camp-real" })).rejects.toMatchObject({ code: "dev_campaign_not_allowed" });
    await expect(client.getCampaign("camp-real")).rejects.toMatchObject({ code: "dev_campaign_not_allowed" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("outside production with no allowlist, every call is refused", async () => {
    const { client, fetchFn } = make({ ZEFFY_API_KEY: KEY, NODE_ENV: "development" }, []);
    await expect(client.listPayments({ campaignId: "camp-ok" })).rejects.toMatchObject({ code: "dev_campaign_not_allowed" });
    await expect(client.getPayment("p1")).rejects.toMatchObject({ code: "dev_campaign_not_allowed" });
    await expect(client.listCampaigns()).rejects.toMatchObject({ code: "dev_campaign_not_allowed" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("discards payments of other campaigns, unread", async () => {
    const { client } = make(PROD, [
      res(page([
        { id: "mine", campaign_id: "camp-ok", status: "succeeded" },
        { id: "theirs", campaign_id: "camp-other", status: "succeeded" },
      ])),
    ]);
    const out = await client.listPayments({ campaignId: "camp-ok" });
    expect(out.payments.map((p) => p.id)).toEqual(["mine"]);
    expect(out.discarded).toBe(1);
  });

  it("outside production getPayment drops a payment of a non-allowlisted campaign", async () => {
    const { client } = make(DEV, [res({ id: "p1", campaign_id: "camp-real", status: "succeeded" })]);
    expect(await client.getPayment("p1")).toEqual({ gone: false, outOfScope: true });
  });

  it("a 404 on getPayment returns { gone: true }", async () => {
    const { client } = make(PROD, [res({ error: { code: "resource_not_found" } }, { status: 404 })]);
    expect(await client.getPayment("p1")).toEqual({ gone: true });
  });

  it("returns the payment when found", async () => {
    const { client } = make(PROD, [res({ id: "p1", campaign_id: "camp-ok", status: "succeeded" })]);
    const out = await client.getPayment("p1");
    expect(out).toMatchObject({ gone: false, outOfScope: false, payment: { id: "p1" } });
  });

  it("refuses to run without an API key", async () => {
    const { client, fetchFn } = make({ NODE_ENV: "production" }, []);
    await expect(client.getPayment("p1")).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("never puts the key or a response body in a thrown message", async () => {
    const cases: Response[] = [
      res({ error: { message: "secret detail zk_test_SECRETKEY" } }, { status: 500 }),
      res({ error: { message: "secret detail" } }, { status: 401 }),
      res({ error: { message: "secret detail" } }, { status: 400 }),
    ];
    for (const r of cases) {
      const { client } = make(PROD, [r]);
      const err = await client.getPayment("p1").catch((e) => e);
      expect(err).toBeInstanceOf(ZeffyError);
      expect(err.message).not.toContain(KEY);
      expect(err.message).not.toContain("secret detail");
    }
    const failing = createZeffyClient({
      env: PROD,
      fetch: (async () => {
        throw new Error(`connect ECONNREFUSED with ${KEY}`);
      }) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const err = await failing.getPayment("p1").catch((e) => e);
    expect(err.message).toBe("zeffy_unavailable");
  });

  it("lists campaigns as metadata, filtered to the allowlist outside production", async () => {
    const campaign = (id: string) => ({ id, title: `Form ${id}`, rates: [{ id: `${id}-rate`, title: "Ticket", amount: 1500 }] });
    const { client } = make(DEV, [res(page([campaign("camp-ok"), campaign("camp-real")]))]);
    const out = await client.listCampaigns();
    expect(out.map((c) => c.id)).toEqual(["camp-ok"]);
    expect(out[0].rates).toEqual([{ id: "camp-ok-rate", title: "Ticket", amountCents: 1500 }]);
  });
});

describe("ZEFFY_API_BASE_URL override", () => {
  const STUB = "http://localhost:4010";
  it("is honoured outside production, so QA and e2e can point at a local stub", async () => {
    const { client, calls } = make({ ...DEV, ZEFFY_API_BASE_URL: STUB }, [res(page([]))]);
    await client.listPayments({ campaignId: "camp-ok" });
    expect(calls[0].url.startsWith(`${STUB}/api/v1/payments`)).toBe(true);
  });

  it("is IGNORED in production: the key can never be redirected", async () => {
    const { client, calls } = make({ ...PROD, ZEFFY_API_BASE_URL: STUB }, [res(page([]))]);
    await client.listPayments({ campaignId: "camp-ok" });
    expect(calls[0].url.startsWith("https://api.zeffy.com/api/v1/payments")).toBe(true);
  });

  it("defaults to api.zeffy.com when unset or blank", async () => {
    const { client, calls } = make({ ...DEV, ZEFFY_API_BASE_URL: "  " }, [res(page([]))]);
    await client.listPayments({ campaignId: "camp-ok" });
    expect(calls[0].url.startsWith("https://api.zeffy.com/")).toBe(true);
  });
});
