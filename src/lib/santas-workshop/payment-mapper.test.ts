import { describe, expect, it } from "vitest";
import threeTickets from "@/lib/zeffy/__fixtures__/payment-three-tickets.json";
import questionMap from "@/lib/zeffy/__fixtures__/question-map-practice.json";
import { toSnapshot, type PaymentSnapshot } from "@/lib/zeffy/snapshot";
import {
  displayStuffyName,
  FIELD_CAPS,
  mapPaymentToRegistrants,
  partialRefundFlag,
  refundOpen,
  workerRefundBadge,
  type MapperSession,
} from "./payment-mapper";

const SESSION: MapperSession = {
  windows: [
    { id: "fri-1600", label: "4:00 PM – 5:00 PM" },
    { id: "fri-1700", label: "5:00 PM – 6:00 PM" },
  ],
  ticketRateIds: ["rate-stuffy"],
  questionMap,
};

function snap(over: Record<string, unknown> = {}): PaymentSnapshot {
  const r = toSnapshot({ ...threeTickets, ...over });
  if (!r.ok) throw new Error("fixture invalid");
  return r.snapshot;
}

const ticketWith = (id: string, questions: unknown[], over: Record<string, unknown> = {}) => ({
  id, type: "ticket", rate_id: "rate-stuffy", amount: 1500, questions, ...over,
});
const q = (question: string, answer: unknown, type = "text") => ({ question, type, answer });

describe("mapPaymentToRegistrants", () => {
  it("maps a three-ticket order into three stuffies, each with its own answers and the buyer fields shared", () => {
    const m = mapPaymentToRegistrants(snap(), SESSION);
    expect(m.succeeded).toBe(true);
    expect(m.stuffies.map((s) => s.itemKey)).toEqual(["item-0001", "item-0002", "item-0003"]);
    expect(m.stuffies.map((s) => s.name)).toEqual(["Biscuit", "<b>Sir Hops-a-Lot</b>", "Mister Whiskers"]);
    expect(m.stuffies[0]).toMatchObject({
      description: "A brown bear with a blue ribbon",
      snack: "Cookies and milk",
      noteToSanta: "Biscuit has been very good.",
      careNote: null,
      photoConsent: true,
      attentionCodes: [],
    });
    expect(m.stuffies[1].photoConsent).toBe(false);
    expect(m.order).toMatchObject({
      buyerFirstName: "Pat",
      buyerLastName: "Exampleton",
      buyerEmail: "parent.one@example.invalid",
      buyerPhone: "mobile-on-file",
      windowId: "fri-1700",
      windowLabelRaw: "5:00 PM – 6:00 PM",
      acknowledged: true,
      amountCents: 4500,
    });
  });

  it("flags an unmatched question on only the ticket that has it, and keeps its raw text", () => {
    const m = mapPaymentToRegistrants(snap(), SESSION);
    expect(m.stuffies[0].attentionCodes).toEqual([]);
    expect(m.stuffies[2].attentionCodes).toContain("unmapped_question");
    expect(m.stuffies[2].rawAnswers.map((x) => x.question)).toContain("Anything else we should know?");
    expect(m.stuffies[2].rawAnswers.find((x) => x.question.startsWith("Anything"))?.answer).toBe("Afraid of the dark.");
  });

  it("an 'ignored' mapping clears the unmatched flag", () => {
    const m = mapPaymentToRegistrants(snap(), { ...SESSION, questionMap: { ...questionMap, ignored: ["anything else we should know"] } });
    expect(m.stuffies[2].attentionCodes).toEqual([]);
  });

  it("donation and additional-donation items never become stuffies", () => {
    const m = mapPaymentToRegistrants(
      snap({
        items: [
          ticketWith("t1", [q("Stuffy's name", "A"), q("Snack choice", "Fruit")]),
          { id: "d1", type: "donation", amount: 500, questions: [], rate_id: "rate-stuffy" },
          { id: "d2", type: "additional_donation", amount: 500, questions: [], rate_id: null },
        ],
      }),
      SESSION,
    );
    expect(m.stuffies.map((s) => s.itemKey)).toEqual(["t1"]);
  });

  it("additional_donation items stay on the order total and never produce a stuffy, mixed with tickets", () => {
    const m = mapPaymentToRegistrants(
      snap({
        amount: 2000,
        items: [
          ticketWith("t1", [q("Stuffy's name", "A"), q("Snack choice", "Fruit")]),
          { id: "x1", type: "additional_donation", amount: 500, questions: [], rate_id: "rate-stuffy" },
        ],
      }),
      SESSION,
    );
    expect(m.stuffies.map((s) => s.itemKey)).toEqual(["t1"]);
    expect(m.order.amountCents).toBe(2000); // ticket 1500 + extra donation 500 stay on the order
  });

  it("a ticket with an unmarked rate is ignored; a wrong campaign mapping creates nothing", () => {
    const items = [ticketWith("t1", [q("Stuffy's name", "A")], { rate_id: "rate-other" })];
    expect(mapPaymentToRegistrants(snap({ items }), SESSION).stuffies).toEqual([]);
    expect(mapPaymentToRegistrants(snap(), { ...SESSION, ticketRateIds: [] }).stuffies).toEqual([]);
  });

  it("a missing name is missing_name and displays 'Unnamed stuffy, order of 3'", () => {
    const m = mapPaymentToRegistrants(snap({ items: [ticketWith("t1", [q("Snack choice", "Fruit")])] }), SESSION);
    expect(m.stuffies[0].name).toBeNull();
    expect(m.stuffies[0].attentionCodes).toContain("missing_name");
    expect(displayStuffyName(m.stuffies[0].name, 3)).toBe("Unnamed stuffy, order of 3");
    expect(displayStuffyName("Biscuit", 3)).toBe("Biscuit");
    expect(displayStuffyName("   ", 1)).toBe("Unnamed stuffy, order of 1");
  });

  it("a missing snack is missing_snack", () => {
    const m = mapPaymentToRegistrants(snap({ items: [ticketWith("t1", [q("Stuffy's name", "A")])] }), SESSION);
    expect(m.stuffies[0].attentionCodes).toContain("missing_snack");
  });

  it.each([
    ["absent", undefined],
    ["false", false],
    ["blank", ""],
    ["No", "No thank you"],
    ["unrecognized", "perhaps next year"],
  ])("photo consent %s is false and is never flagged", (_label, answer) => {
    const questions = [q("Stuffy's name", "A"), q("Snack choice", "Fruit")];
    if (answer !== undefined) questions.push(q("May we share a photo of your stuffy?", answer, typeof answer === "boolean" ? "checkbox" : "single_select"));
    const m = mapPaymentToRegistrants(snap({ items: [ticketWith("t1", questions)] }), SESSION);
    expect(m.stuffies[0].photoConsent).toBe(false);
    expect(m.stuffies[0].attentionCodes).toEqual([]);
  });

  it("photo consent 'Yes' and checkbox true are true", () => {
    for (const a of ["Yes", true]) {
      const m = mapPaymentToRegistrants(
        snap({ items: [ticketWith("t1", [q("Stuffy's name", "A"), q("Snack choice", "Fruit"), q("May we share a photo of your stuffy?", a)])] }),
        SESSION,
      );
      expect(m.stuffies[0].photoConsent).toBe(true);
    }
  });

  it("matches the drop-off window by normalized label, and by id", () => {
    const base = (answer: string) => mapPaymentToRegistrants(snap({ buyer_questions: [q("Which drop-off window?", answer, "single_select")] }), SESSION);
    expect(base("5:00 PM – 6:00 PM").order.windowId).toBe("fri-1700");
    expect(base("  5:00 pm – 6:00 PM ").order.windowId).toBe("fri-1700");
    expect(base("fri-1600").order.windowId).toBe("fri-1600");
  });

  it("an unmatched window sets unmapped_window on every stuffy but still creates them", () => {
    const m = mapPaymentToRegistrants(snap({ buyer_questions: [q("Which drop-off window?", "Saturday brunch", "single_select")] }), SESSION);
    expect(m.order.windowId).toBeNull();
    expect(m.order.windowLabelRaw).toBe("Saturday brunch");
    expect(m.stuffies).toHaveLength(3);
    expect(m.stuffies.every((s) => s.attentionCodes.includes("unmapped_window"))).toBe(true);
  });

  it("a buyer field found in the ticket scope still maps (fallback)", () => {
    const items = [ticketWith("t1", [q("Stuffy's name", "A"), q("Snack choice", "Fruit"), q("Parent mobile number", "from-ticket", "phone"), q("Which drop-off window?", "5:00 PM – 6:00 PM")])];
    const m = mapPaymentToRegistrants(snap({ items, buyer_questions: [] }), SESSION);
    expect(m.order.buyerPhone).toBe("from-ticket");
    expect(m.order.windowId).toBe("fri-1700");
  });

  it("two question strings can map to one field", () => {
    const session = { ...SESSION, questionMap: { ...questionMap, stuffy_name: ["stuffy's name", "name of your stuffy"] } };
    const m = mapPaymentToRegistrants(
      snap({ items: [ticketWith("t1", [q("Name of your stuffy", "Renamed"), q("Snack choice", "Fruit")])] }),
      session,
    );
    expect(m.stuffies[0].name).toBe("Renamed");
    expect(m.stuffies[0].attentionCodes).toEqual([]);
  });

  it("truncates a care note over 5,000 characters and sets truncated", () => {
    const long = "c".repeat(FIELD_CAPS.careNote + 50);
    const m = mapPaymentToRegistrants(snap({ items: [ticketWith("t1", [q("Stuffy's name", "A"), q("Snack choice", "Fruit"), q("Care notes", long)])] }), SESSION);
    expect(m.stuffies[0].careNote).toHaveLength(FIELD_CAPS.careNote);
    expect(m.stuffies[0].attentionCodes).toContain("truncated");
  });

  it("stores HTML in a name verbatim as text", () => {
    const m = mapPaymentToRegistrants(snap(), SESSION);
    expect(m.stuffies[1].name).toBe("<b>Sir Hops-a-Lot</b>");
  });

  it("pending and failed statuses produce no registrants", () => {
    for (const status of ["pending", "failed"]) {
      const m = mapPaymentToRegistrants(snap({ status }), SESSION);
      expect(m.succeeded).toBe(false);
      expect(m.stuffies).toEqual([]);
      expect(m.order.paymentStatus).toBe(status);
    }
  });

  it("caps stored raw answers", () => {
    const m = mapPaymentToRegistrants(
      snap({ items: [ticketWith("t1", [q("Stuffy's name", "x".repeat(9000))])] }),
      SESSION,
    );
    expect((m.stuffies[0].rawAnswers[0].answer as string).length).toBe(FIELD_CAPS.rawTicketAnswer);
  });

  it("performs no IO (is deterministic and does not mutate its input)", () => {
    const s = snap();
    const before = JSON.stringify(s);
    expect(JSON.stringify(mapPaymentToRegistrants(s, SESSION))).toBe(JSON.stringify(mapPaymentToRegistrants(s, SESSION)));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("derived refund state (ruling 7)", () => {
  const order = (over: Partial<Parameters<typeof refundOpen>[0]> = {}) => ({
    refundStatus: "none", refundedCents: 0, paymentDeleted: false, refundResolutionCents: null as number | null, ...over,
  });

  it("no refund -> nothing", () => {
    const o = order();
    expect([refundOpen(o), workerRefundBadge(o), partialRefundFlag(o)]).toEqual([false, false, false]);
  });

  it("full refund and a removed payment produce the worker badge; partial produces the admin flag only", () => {
    const full = order({ refundStatus: "full", refundedCents: 4500 });
    expect([refundOpen(full), workerRefundBadge(full), partialRefundFlag(full)]).toEqual([true, true, false]);
    const gone = order({ paymentDeleted: true });
    expect([refundOpen(gone), workerRefundBadge(gone), partialRefundFlag(gone)]).toEqual([true, true, false]);
    const partial = order({ refundStatus: "partial", refundedCents: 1500 });
    expect([refundOpen(partial), workerRefundBadge(partial), partialRefundFlag(partial)]).toEqual([true, false, true]);
  });

  it("Keep closes the flag, and a later, bigger refund reopens it by itself", () => {
    expect(refundOpen(order({ refundStatus: "partial", refundedCents: 1500, refundResolutionCents: 1500 }))).toBe(false);
    expect(refundOpen(order({ refundStatus: "partial", refundedCents: 3000, refundResolutionCents: 1500 }))).toBe(true);
  });

  it("a reversed refund clears with no code", () => {
    expect(refundOpen(order({ refundStatus: "none", refundedCents: 0, refundResolutionCents: null }))).toBe(false);
  });

  it("Keep on a removed payment (resolution 0, refunded 0) closes it", () => {
    expect(refundOpen(order({ paymentDeleted: true, refundResolutionCents: 0 }))).toBe(false);
  });
});
