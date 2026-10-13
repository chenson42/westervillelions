import { describe, expect, it, vi } from "vitest";
import type { SwOrder, SwSession, SwStuffy } from "@/lib/db/schema";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/zeffy/events-queries", () => ({ lastCampaignEventReceivedAt: async () => null, lastEventReceivedAt: async () => null }));

import { isUniqueViolation, toRegistrantDto, toSessionDto } from "./session-queries";

const date = new Date("2026-11-09T12:00:00Z");
const session = {
  id: "s", slug: "slug", name: "N", kind: "practice", status: "draft", dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20",
  windows: [{ id: "w1", label: "4 to 5", start: "16:00", end: "17:00" }], crewClosesOn: "2026-12-21", zeffyCampaignId: "c1", zeffyCampaignTitle: "Form", zeffyTicketRateIds: ["r1"],
  questionMap: { snack: ["a", "b"], ignored: ["c"] }, crewCodeEnc: "v1.secret.secret.secret", crewCodeVersion: 3, collageToken: "T".repeat(22), storageQuotaBytes: 1000,
  frameArtKey: "plain", frameFilePrefix: "", framePartSize: 100, purgePersonalOn: "2027-01-19", purgePublicOn: "2027-01-31", personalPurgedAt: null, publicPurgedAt: null,
  createdAt: date, updatedAt: date,
} as unknown as SwSession;

describe("toSessionDto", () => {
  it("never exposes the encrypted worker code, tokens or the raw map", () => {
    const dto = toSessionDto(session);
    const text = JSON.stringify(dto);
    expect(text).not.toContain("v1.secret");
    expect(text).not.toContain("TTTT");
    expect(dto.zeffy.mappedStringCounts).toEqual({ snack: 2, ignored: 1 });
    expect(dto.zeffy).toMatchObject({ campaignId: "c1", ticketRateIds: ["r1"] });
  });
});

describe("toRegistrantDto", () => {
  const stuffy = { id: "st", orderId: "o", name: null, description: "bear", snack: "Fruit", noteToSanta: null, careNote: null, photoConsent: true, state: "tagged", attentionCodes: ["missing_name"], needsAttention: true, withdrawnAt: null, tagCode: "https://vendor.example/abc123", createdAt: date } as unknown as SwStuffy;
  const order = (over: Partial<SwOrder> = {}) =>
    ({ windowId: "w1", buyerFirstName: "Pat", buyerLastName: "Exampleton", buyerEmail: "p@example.invalid", buyerPhone: null, refundStatus: "none", refundedCents: 0, paymentDeleted: false, refundResolutionCents: null, source: "webhook", ...over }) as unknown as SwOrder;

  it("shows the parent contact (admin only), the window label and the sticker's last four only", () => {
    const dto = toRegistrantDto(stuffy, order(), 3, session.windows);
    expect(dto).toMatchObject({ parentEmail: "p@example.invalid", windowLabel: "4 to 5", orderSize: 3, tagLast4: "c123", state: "tagged", refund: "none" });
    expect(JSON.stringify(dto)).not.toContain("vendor.example");
  });

  it("derives the refund badge from the order", () => {
    expect(toRegistrantDto(stuffy, order({ refundStatus: "full", refundedCents: 4500 }), 1, []).refund).toBe("refunded");
    expect(toRegistrantDto(stuffy, order({ paymentDeleted: true }), 1, []).refund).toBe("refunded");
    expect(toRegistrantDto(stuffy, order({ refundStatus: "partial", refundedCents: 1500 }), 1, []).refund).toBe("partial_flag");
    expect(toRegistrantDto(stuffy, order({ refundStatus: "partial", refundedCents: 1500, refundResolutionCents: 1500 }), 1, []).refund).toBe("none");
  });

  it("carries the check-in photo flag (B-180), false by default", () => {
    expect(toRegistrantDto(stuffy, order(), 1, []).hasCheckInPhoto).toBe(false);
    expect(toRegistrantDto(stuffy, order(), 1, [], {}, true).hasCheckInPhoto).toBe(true);
  });

  it("falls back to registered for an unknown state value", () => {
    expect(toRegistrantDto({ ...stuffy, state: "weird" } as SwStuffy, order(), 1, []).state).toBe("registered");
  });
});

describe("isUniqueViolation", () => {
  it("recognizes a unique violation directly or wrapped, with an optional constraint hint", () => {
    expect(isUniqueViolation({ code: "23505", constraint_name: "ux_sw_sessions_slug" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505", constraint_name: "ux_sw_sessions_slug" } }, "slug")).toBe(true);
    expect(isUniqueViolation({ code: "23505", constraint_name: "ux_sw_sessions_slug" }, "zeffy_campaign")).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
});
