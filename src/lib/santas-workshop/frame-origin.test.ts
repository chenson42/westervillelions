import { describe, expect, it } from "vitest";
import { frameOriginAllowed, isProductionRuntime, PRODUCTION_ORIGIN } from "./frame-origin";

const URL_OK = `${PRODUCTION_ORIGIN}/santas-workshop/c/abc`;
const URL_DEV = "http://localhost:3000/santas-workshop/c/abc";

describe("frameOriginAllowed", () => {
  it("accepts a real session on the production origin", () => {
    expect(frameOriginAllowed(URL_OK, "real", { NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
    expect(frameOriginAllowed(URL_OK, "real", {})).toBe(true);
  });
  it("refuses a real session on localhost, a vercel.app host or a look-alike", () => {
    for (const url of [URL_DEV, "https://x.vercel.app/santas-workshop/c/abc", `${PRODUCTION_ORIGIN}.evil.example/c/abc`, "http://westervillelions.org/c/abc"]) {
      expect(frameOriginAllowed(url, "real", { NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    }
  });
  it("refuses a real session on a preview deployment even with the production origin", () => {
    expect(frameOriginAllowed(URL_OK, "real", { NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
  });
  it("exempts practice sessions", () => {
    expect(frameOriginAllowed(URL_DEV, "practice", { NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
  });
  it("honours the dev override outside production", () => {
    expect(frameOriginAllowed(URL_DEV, "real", { NODE_ENV: "development", SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN: "1" })).toBe(true);
    expect(frameOriginAllowed(URL_DEV, "real", { NODE_ENV: "development" })).toBe(false);
    expect(frameOriginAllowed(URL_DEV, "real", { NODE_ENV: "development", SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN: "yes" })).toBe(false);
  });
  it("ignores the dev override in production (Vercel production, or NODE_ENV=production off Vercel)", () => {
    expect(frameOriginAllowed(URL_DEV, "real", { NODE_ENV: "production", VERCEL_ENV: "production", SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN: "1" })).toBe(false);
    expect(frameOriginAllowed(URL_DEV, "real", { NODE_ENV: "production", SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN: "1" })).toBe(false);
  });
  it("classifies the runtime", () => {
    expect(isProductionRuntime({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(true);
    expect(isProductionRuntime({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
  });
});
