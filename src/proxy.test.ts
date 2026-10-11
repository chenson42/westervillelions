import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { proxy } from "./proxy";

const UUID = "00000000-0000-4000-8000-000000000001";
const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => authMock.mockReset());

describe("proxy signed-out redirect", () => {
  it("preserves the query string in callbackUrl", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(req(`/admin/ledger/approvals?txn=${UUID}`));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/signin");
    expect(loc.searchParams.get("callbackUrl")).toBe(`/admin/ledger/approvals?txn=${UUID}`);
  });
  it("adds no stray ? when there is no query", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(req("/admin/ledger/approvals"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("callbackUrl")).toBe("/admin/ledger/approvals");
  });
  it("leaves public paths alone", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(req("/events"));
    expect(res.headers.get("location")).toBeNull();
    expect(authMock).not.toHaveBeenCalled();
  });
});

describe("proxy other redirects are unchanged", () => {
  it("deactivated account goes to /signin?error=deactivated", async () => {
    authMock.mockResolvedValue({ user: { isActive: false, features: [], roles: [] } });
    const res = await proxy(req("/members"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/signin");
    expect(loc.searchParams.get("error")).toBe("deactivated");
    expect(loc.searchParams.get("callbackUrl")).toBeNull();
  });
  it("authenticated without the feature goes to /access-pending", async () => {
    authMock.mockResolvedValue({ user: { isActive: true, features: [], roles: [] } });
    const res = await proxy(req("/members"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/access-pending");
  });
});
