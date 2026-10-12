import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("/whitecane poster redirect", () => {
  it("is a temporary redirect to /white-cane with the campaign UTM tags", async () => {
    const redirects = await nextConfig.redirects!();
    const rule = redirects.find((r) => r.source === "/whitecane");
    expect(rule).toBeDefined();
    expect(rule!.permanent).toBe(false);
    const url = new URL(rule!.destination, "https://westervillelions.org");
    expect(url.pathname).toBe("/white-cane");
    expect(url.searchParams.get("utm_source")).toBe("poster");
    expect(url.searchParams.get("utm_medium")).toBe("qr");
    expect(url.searchParams.get("utm_campaign")).toBe("whitecane");
    expect(url.searchParams.get("utm_content")).toBe("fourthfriday");
  });
});
