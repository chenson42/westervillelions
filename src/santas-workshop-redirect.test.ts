import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

async function rules() {
  return nextConfig.redirects!();
}

describe("Santa's Workshop redirects", () => {
  it("/santasworkshop is a temporary redirect to /santas-workshop with exactly utm_source=poster, utm_medium=qr, utm_campaign=santasworkshop", async () => {
    const rule = (await rules()).find((r) => r.source === "/santasworkshop");
    expect(rule).toBeDefined();
    const url = new URL(rule!.destination, "https://westervillelions.org");
    expect(url.pathname).toBe("/santas-workshop");
    expect([...url.searchParams.keys()].sort()).toEqual(["utm_campaign", "utm_medium", "utm_source"]);
    expect(url.searchParams.get("utm_source")).toBe("poster");
    expect(url.searchParams.get("utm_medium")).toBe("qr");
    expect(url.searchParams.get("utm_campaign")).toBe("santasworkshop");
  });

  it("/santas-workshop/preview/:path* is a temporary redirect to the fixed path /santas-workshop (any query is forwarded to it and ignored by the page)", async () => {
    const rule = (await rules()).find((r) => r.source === "/santas-workshop/preview/:path*");
    expect(rule).toBeDefined();
    expect(rule!.destination).toBe("/santas-workshop");
  });

  it("neither rule is permanent", async () => {
    const mine = (await rules()).filter(
      (r) => r.source === "/santasworkshop" || r.source === "/santas-workshop/preview/:path*",
    );
    expect(mine).toHaveLength(2);
    for (const r of mine) expect(r.permanent).toBe(false);
  });
});
