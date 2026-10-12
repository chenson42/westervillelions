import { describe, expect, it } from "vitest";
import threeTickets from "./__fixtures__/payment-three-tickets.json";
import { isPaymentSnapshot, itemKey, SNAPSHOT_ANSWER_MAX, toSnapshot } from "./snapshot";

const ok = (p: unknown) => {
  const r = toSnapshot(p);
  if (!r.ok) throw new Error("expected a snapshot");
  return r.snapshot;
};

describe("toSnapshot", () => {
  it("drops address, receipt URL, payment method, dispute and discount", () => {
    const snap = ok({
      ...threeTickets,
      dispute: { id: "d", reason: "fraud" },
      discount: { code: "SANTA", amount: 100 },
    });
    const text = JSON.stringify(snap);
    for (const gone of ["1 Example Street", "receipt", "card", "dispute", "fraud", "SANTA", "Exampleville", "postal"]) {
      expect(text).not.toContain(gone);
    }
    expect(snap.buyer).toEqual({ email: "parent.one@example.invalid", firstName: "Pat", lastName: "Exampleton" });
  });

  it("tolerates unknown extra fields at every level", () => {
    const snap = ok({ ...threeTickets, brand_new_field: { x: 1 }, items: threeTickets.items.map((i) => ({ ...i, future: true })) });
    expect(snap.items).toHaveLength(3);
  });

  it("returns invalid when id or status is missing", () => {
    expect(toSnapshot({ ...threeTickets, id: undefined })).toEqual({ ok: false, reason: "invalid" });
    expect(toSnapshot({ ...threeTickets, status: undefined })).toEqual({ ok: false, reason: "invalid" });
    expect(toSnapshot({ ...threeTickets, id: "" })).toEqual({ ok: false, reason: "invalid" });
    expect(toSnapshot(null)).toEqual({ ok: false, reason: "invalid" });
    expect(toSnapshot("string")).toEqual({ ok: false, reason: "invalid" });
    expect(toSnapshot([])).toEqual({ ok: false, reason: "invalid" });
  });

  it("counts succeeded refunds only in the refunded sum", () => {
    const snap = ok({
      ...threeTickets,
      refund_status: "partial",
      refunds: [
        { id: "r1", amount: 1500, status: "succeeded" },
        { id: "r2", amount: 700, status: "pending" },
        { id: "r3", amount: 300, status: "failed" },
        { id: "r4", amount: 200, status: "succeeded" },
      ],
    });
    expect(snap.refundedCents).toBe(1700);
    expect(snap.refundStatus).toBe("partial");
  });

  it("treats an unknown refund_status as none", () => {
    expect(ok({ ...threeTickets, refund_status: "weird" }).refundStatus).toBe("none");
  });

  it("keys items by item id, falling back to payment#index", () => {
    const snap = ok(threeTickets);
    expect(snap.items.map((i) => i.key)).toEqual(["item-0001", "item-0002", "item-0003"]);
    expect(itemKey("pay-1", { id: "item-9" }, 4, "item_id")).toBe("item-9");
    expect(itemKey("pay-1", { id: "item-9" }, 4, "index")).toBe("pay-1#4");
    expect(itemKey("pay-1", {}, 2, "item_id")).toBe("pay-1#2");
    expect(itemKey("pay-1", { id: "" }, 2)).toBe("pay-1#2");
  });

  it("caps very long answers", () => {
    const snap = ok({
      ...threeTickets,
      items: [{ id: "i", type: "ticket", rate_id: "r", amount: 1, questions: [{ question: "q", type: "text", answer: "x".repeat(SNAPSHOT_ANSWER_MAX + 500) }] }],
    });
    expect((snap.items[0].questions[0].answer as string).length).toBe(SNAPSHOT_ANSWER_MAX);
  });

  it("normalizes boolean, array and string answers; drops malformed questions", () => {
    const snap = ok({
      ...threeTickets,
      buyer_questions: [
        { question: "a", type: "checkbox", answer: false },
        { question: "b", type: "multi_select", answer: ["x", "y", 3] },
        { question: "c", type: "text", answer: "plain" },
        { question: "d", type: "text" },
        "not an object",
      ],
    });
    expect(snap.buyerQuestions).toEqual([
      { question: "a", type: "checkbox", answer: false },
      { question: "c", type: "text", answer: "plain" },
    ]);
  });

  it("round-trips through isPaymentSnapshot", () => {
    const snap = ok(threeTickets);
    expect(isPaymentSnapshot(JSON.parse(JSON.stringify(snap)))).toBe(true);
    expect(isPaymentSnapshot({ paymentId: "x" })).toBe(false);
    expect(isPaymentSnapshot(null)).toBe(false);
  });
});
