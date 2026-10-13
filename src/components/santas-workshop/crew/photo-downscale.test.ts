import { describe, expect, it } from "vitest";
import { DIMENSION_STEP, MAX_UPLOAD_BODY_BYTES, PHOTO_LIMITS, QUALITY_LADDER } from "@/lib/santas-workshop/photo-limits";
import { MAX_ENCODE_ATTEMPTS, MIN_LONG_EDGE, nextEncodeStep, planFor, qualityFor, startEncode, targetDimensions } from "./photo-downscale";

describe("photo downscale planning", () => {
  it("takes every number from the shared limits module", () => {
    expect(planFor("portrait").full).toEqual({ maxLongEdge: PHOTO_LIMITS.portrait.maxLongEdge, maxBytes: PHOTO_LIMITS.portrait.maxBytes });
    expect(planFor("portrait").thumb).toEqual({ maxLongEdge: 480, maxBytes: 100 * 1024 });
    expect(planFor("check_in").thumb).toBeNull();
    expect(planFor("group").full.maxLongEdge).toBe(1920);
    expect(PHOTO_LIMITS.portrait.maxLongEdge).toBe(2400);
  });

  it("scales the long edge down per kind and keeps the aspect", () => {
    expect(targetDimensions(4032, 3024, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(targetDimensions(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
    expect(targetDimensions(4000, 3000, 480)).toEqual({ width: 480, height: 360 });
  });

  it("never upscales", () => {
    expect(targetDimensions(800, 600, 2400)).toEqual({ width: 800, height: 600 });
    expect(targetDimensions(640, 480, 1280)).toEqual({ width: 640, height: 480 });
  });

  it("starts at the first rung and walks the ladder before it shrinks", () => {
    let s = startEncode(2400);
    expect(qualityFor(s)).toBe(QUALITY_LADDER[0]);
    const seen: number[] = [qualityFor(s)];
    for (let i = 1; i < QUALITY_LADDER.length; i++) {
      const step = nextEncodeStep(s, 10_000_000, 1_000_000);
      if (step.kind !== "retry") throw new Error("expected retry");
      expect(step.next.longEdge).toBe(2400);
      s = step.next;
      seen.push(qualityFor(s));
    }
    expect(seen).toEqual([...QUALITY_LADDER]);
  });

  it("shrinks the long edge by the shared step when the ladder bottoms out, and restarts the ladder", () => {
    let s = startEncode(2400);
    for (let i = 1; i < QUALITY_LADDER.length; i++) {
      const step = nextEncodeStep(s, 10_000_000, 1_000_000);
      if (step.kind !== "retry") throw new Error("expected retry");
      s = step.next;
    }
    const step = nextEncodeStep(s, 10_000_000, 1_000_000);
    if (step.kind !== "retry") throw new Error("expected retry");
    expect(step.next.longEdge).toBe(Math.floor(2400 * DIMENSION_STEP));
    expect(qualityFor(step.next)).toBe(QUALITY_LADDER[0]);
  });

  it("stops as soon as the file fits", () => {
    expect(nextEncodeStep(startEncode(2400), 1_000_000, 1_000_000)).toEqual({ kind: "fits" });
    expect(nextEncodeStep(startEncode(2400), 10, 1_000_000)).toEqual({ kind: "fits" });
  });

  it("gives up rather than loop forever on a file that never fits", () => {
    let s = startEncode(2400);
    let guard = 0;
    for (;;) {
      const step = nextEncodeStep(s, Number.MAX_SAFE_INTEGER, 1);
      guard += 1;
      if (step.kind === "give_up") break;
      if (step.kind !== "retry") throw new Error("unexpected");
      s = step.next;
      expect(guard).toBeLessThanOrEqual(MAX_ENCODE_ATTEMPTS + 1);
    }
    expect(s.longEdge).toBeGreaterThanOrEqual(MIN_LONG_EDGE);
  });

  it("each kind's full and thumb byte caps fit inside the shared body cap", () => {
    for (const kind of ["check_in", "portrait", "group"] as const) {
      const p = planFor(kind);
      expect(p.full.maxBytes + (p.thumb?.maxBytes ?? 0) + 4096).toBeLessThanOrEqual(MAX_UPLOAD_BODY_BYTES + 1024 * 1024);
    }
  });
});
