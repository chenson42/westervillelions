import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/email-compose", () => ({
  getAppUrl: () => "https://westervillelions.example",
}));

function mockFetchOnce(response: { success: boolean; hostname?: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fakeRequest(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe("verifyTurnstile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("includes remoteip in the POST body when passed", async () => {
    const fetchMock = mockFetchOnce({ success: true });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    await verifyTurnstile("token-abc", { remoteip: "203.0.113.5" });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.remoteip).toBe("203.0.113.5");
  });

  it("omits remoteip from the POST body when not passed", async () => {
    const fetchMock = mockFetchOnce({ success: true });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    await verifyTurnstile("token-abc");

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body).not.toHaveProperty("remoteip");
  });

  it("accepts a response with an allow-listed hostname (the derived production host)", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-for-test");
    mockFetchOnce({ success: true, hostname: "westervillelions.example" });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("token-abc");
    expect(result.success).toBe(true);
  });

  it("accepts a response with hostname localhost", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-for-test");
    mockFetchOnce({ success: true, hostname: "localhost" });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("token-abc");
    expect(result.success).toBe(true);
  });

  it("rejects a response with success: true but a hostname not in the allow-list", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-for-test");
    mockFetchOnce({ success: true, hostname: "evil-copycat.example" });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("token-abc");
    expect(result.success).toBe(false);
    expect(result.hostname).toBe("evil-copycat.example");
  });

  it("a response with success: false is rejected regardless of hostname", async () => {
    mockFetchOnce({ success: false, hostname: "westervillelions.example" });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("token-abc");
    expect(result.success).toBe(false);
  });

  it("the fail-open dev test secret's canned hostname (example.com) is never enforced, even though it's not on the allow-list", async () => {
    // Confirmed empirically against Cloudflare's live siteverify endpoint while
    // implementing this feature: the documented "always passes" test secret
    // returns hostname: "example.com" on every response, not an omitted field.
    // TURNSTILE_SECRET_KEY is deliberately left unset here, so verifyTurnstile()
    // uses CLOUDFLARE_ALWAYS_PASS_TEST_SECRET — the exact local-dev path this
    // guards.
    mockFetchOnce({ success: true, hostname: "example.com" });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("dev-bypass");
    expect(result.success).toBe(true);
  });

  it("a response with no hostname field at all is accepted when success is true", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "real-secret-for-test");
    mockFetchOnce({ success: true });
    const { verifyTurnstile } = await import("@/lib/turnstile");
    const result = await verifyTurnstile("token-abc");
    expect(result.success).toBe(true);
  });
});

describe("getRemoteIp", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads the first entry of a multi-value x-forwarded-for header", async () => {
    const { getRemoteIp } = await import("@/lib/turnstile");
    const req = fakeRequest({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" });
    expect(getRemoteIp(req)).toBe("198.51.100.1");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const { getRemoteIp } = await import("@/lib/turnstile");
    const req = fakeRequest({ "x-real-ip": "198.51.100.9" });
    expect(getRemoteIp(req)).toBe("198.51.100.9");
  });

  it("returns undefined when neither header is present", async () => {
    const { getRemoteIp } = await import("@/lib/turnstile");
    const req = fakeRequest({});
    expect(getRemoteIp(req)).toBeUndefined();
  });
});
