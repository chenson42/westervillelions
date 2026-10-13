import { describe, expect, it } from "vitest";
import { CREW_ERROR_CODES, type CrewErrorBody } from "@/lib/santas-workshop/crew-contract";
import { STORAGE_DOWN_MESSAGE } from "./crew-messages";
import { classifyUpload } from "./outbox-classify";

const fail = (status: number, body: CrewErrorBody | null) => classifyUpload({ ok: false, status, body }, "check_in");
const simple = (code: string): CrewErrorBody => ({ error: "x", code }) as CrewErrorBody;

describe("upload outcome classification", () => {
  it("success is sent (a replay too)", () => {
    expect(classifyUpload({ ok: true }, "portrait")).toEqual({ kind: "sent" });
  });

  it("no readable answer (offline, a proxy page) is a retry", () => {
    expect(fail(0, null)).toEqual({ kind: "retry" });
    expect(fail(502, null)).toEqual({ kind: "retry" });
  });

  it("rate limits and server errors are retries", () => {
    for (const code of ["rate_limited", "throttled", "storage_rate_limited", "server_error"]) {
      expect(fail(code === "server_error" ? 500 : 429, code === "storage_rate_limited" ? { error: "x", code, retryable: true } as CrewErrorBody : simple(code))).toEqual({ kind: "retry" });
    }
  });

  it("a temporary storage failure retries; one the server marks not retryable stops everything", () => {
    expect(fail(503, { error: "x", code: "storage_unavailable", retryable: true })).toEqual({ kind: "retry" });
    expect(fail(503, { error: "x", code: "storage_unavailable", retryable: false })).toEqual({ kind: "stop", message: STORAGE_DOWN_MESSAGE });
    expect(fail(503, { error: "x", code: "storage_misconfigured", retryable: false })).toEqual({ kind: "stop", message: STORAGE_DOWN_MESSAGE });
    expect(fail(503, { error: "x", code: "storage_full", retryable: false })).toEqual({ kind: "stop", message: STORAGE_DOWN_MESSAGE });
    expect(fail(413, simple("quota_exceeded")).kind).toBe("stop");
  });

  it("a stale state parks the photo with the sentence", () => {
    const out = fail(409, { error: "x", code: "stale_state", currentState: "checked_in", since: "t" });
    expect(out.kind).toBe("stale");
  });

  it("a 401 holds the queue and carries the reason sentence", () => {
    const out = fail(401, { error: "x", code: "crew_auth_required", reason: "signed_out" });
    expect(out.kind).toBe("auth");
    expect(out.kind === "auth" && out.message).toMatch(/changed/);
  });

  it("photos that can never be accepted are rejected, not retried", () => {
    for (const code of ["too_large", "not_jpeg", "invalid_input", "portrait_exists", "illegal_transition", "withdrawn", "not_found"]) {
      expect(fail(code === "too_large" ? 413 : 400, simple(code)).kind).toBe("reject");
    }
  });

  it("classifies every code in the contract without throwing, and never names the storage vendor", () => {
    for (const code of CREW_ERROR_CODES) {
      const body = { error: "x", code, retryable: false, currentState: "tagged", since: "t", otherStuffyName: "Pip", oldLast4: "AB12", at: "t" } as unknown as CrewErrorBody;
      const out = fail(409, body);
      expect(["sent", "retry", "stop", "stale", "reject", "auth"]).toContain(out.kind);
      if ("message" in out) expect(out.message).not.toMatch(/drive|google/i);
    }
  });

  it("an unexpected 5xx that carries a client-error code is still retried", () => {
    expect(fail(500, simple("invalid_input"))).toEqual({ kind: "retry" });
  });
});
