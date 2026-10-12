import { describe, expect, it } from "vitest";
import threeTickets from "./__fixtures__/payment-three-tickets.json";
import { redactPaymentForFixture } from "./redact";

describe("redactPaymentForFixture", () => {
  const out = redactPaymentForFixture(
    {
      ...threeTickets,
      buyer: { email: "someone@mail.example.test", first_name: "Realname", last_name: "Realsurname", address: { line1: "9 Real Road" } },
      receipt_url: "https://zeffy.example/real",
      contact: "contact-123",
      refunds: [{ id: "re_real", object: "refund", amount: 500, currency: "usd", status: "succeeded", created: 5 }],
    },
    3,
  );
  const text = JSON.stringify(out);

  it("replaces identity with example.invalid placeholders", () => {
    expect(text).not.toMatch(/someone@mail|mail\.example\.test|Realname|Realsurname|Real Road|re_real|contact-123/);
    expect(out.buyer).toEqual({ email: "buyer03@example.invalid", first_name: "Buyer", last_name: "Example03" });
    expect(out.receipt_url).toBeNull();
  });

  it("redacts free-text answers but keeps checkbox booleans and select choices", () => {
    expect(text).not.toContain("Biscuit");
    expect(text).not.toContain("mobile-on-file");
    expect(text).toContain("Cookies and milk"); // select choice kept: the wording is the point of the spike
    const buyerQs = out.buyer_questions as { type: string; answer: unknown }[];
    expect(buyerQs.find((q) => q.type === "checkbox")?.answer).toBe(true);
  });

  it("keeps the structure the tests need", () => {
    expect((out.items as unknown[]).length).toBe(3);
    expect(out.campaign_id).toBe("campaign-practice-01");
    expect((out.refunds as { amount: number }[])[0].amount).toBe(500);
  });
});
