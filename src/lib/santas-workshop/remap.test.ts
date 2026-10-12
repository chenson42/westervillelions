import { describe, expect, it, vi } from "vitest";
import questionMap from "@/lib/zeffy/__fixtures__/question-map-practice.json";
import type { SwOrder, SwStuffy } from "@/lib/db/schema";
import { remapRow } from "./remap";
import type { MapperSession } from "./payment-mapper";

vi.mock("@/lib/db", () => ({ db: {} }));

const CFG: MapperSession = {
  windows: [{ id: "fri-1700", label: "5:00 PM – 6:00 PM" }],
  ticketRateIds: ["rate-stuffy"],
  questionMap,
};

const raw = (question: string, answer: unknown, type = "text") => ({ question, type, answer });

function rows(over: { stuffy?: Partial<SwStuffy>; order?: Partial<SwOrder> } = {}) {
  const stuffy = {
    id: "s1", zeffyItemKey: "item-1", name: null, description: null, childFirstName: null, snack: "Fruit", noteToSanta: null, careNote: null,
    photoConsent: true, attentionCodes: ["unmapped_question", "missing_name"], needsAttention: true, attentionDismissedAt: null,
    rawAnswers: [raw("Name of the stuffy", "Biscuit"), raw("Snack choice", "Fruit"), raw("May we share a photo of your stuffy?", "Yes")],
    ...over.stuffy,
  } as unknown as SwStuffy;
  const order = {
    id: "o1", buyerPhone: null, windowId: "fri-1700", windowLabelRaw: "5:00 PM – 6:00 PM", acknowledged: null,
    buyerAnswers: [raw("Which drop-off window?", "5:00 PM – 6:00 PM", "single_select")],
    ...over.order,
  } as unknown as SwOrder;
  return { stuffy, order };
}

describe("remapRow", () => {
  it("after the admin maps a reworded question, the stored answer fills the field and the flag clears", () => {
    const { stuffy, order } = rows();
    const withMap = { ...CFG, questionMap: { ...questionMap, stuffy_name: ["name of the stuffy"] } };
    const patch = remapRow(stuffy, order, withMap);
    expect(patch.stuffy).toMatchObject({ name: "Biscuit", attentionCodes: [], needsAttention: false, attentionDismissedAt: null });
    expect(patch.order).toBeNull();
    expect(patch.attentionChanged).toBe(true);
  });

  it("with the unchanged map it keeps the flags and changes nothing it should not", () => {
    const { stuffy, order } = rows();
    expect(remapRow(stuffy, order, CFG)).toEqual({ stuffy: null, order: null, attentionChanged: false });
  });

  it("is idempotent: remapping its own output changes nothing", () => {
    const { stuffy, order } = rows();
    const cfg = { ...CFG, questionMap: { ...questionMap, stuffy_name: ["name of the stuffy"] } };
    const first = remapRow(stuffy, order, cfg);
    const next = remapRow({ ...stuffy, ...first.stuffy } as SwStuffy, { ...order, ...first.order } as SwOrder, cfg);
    expect(next).toEqual({ stuffy: null, order: null, attentionChanged: false });
  });

  it("preserves not_in_order_now, which only the apply path may clear", () => {
    const { stuffy, order } = rows({ stuffy: { attentionCodes: ["unmapped_question", "missing_name", "not_in_order_now"] } });
    const cfg = { ...CFG, questionMap: { ...questionMap, stuffy_name: ["name of the stuffy"], ignored: [] } };
    const patch = remapRow(stuffy, order, cfg);
    expect(patch.stuffy?.attentionCodes).toContain("not_in_order_now");
  });

  it("a new set of reasons resets a prior dismissal", () => {
    const { stuffy, order } = rows({ stuffy: { attentionDismissedAt: new Date(), needsAttention: false } });
    // reasons unchanged -> dismissal untouched
    expect(remapRow(stuffy, order, CFG).stuffy).toBeNull();
    const reset = remapRow(stuffy, order, { ...CFG, questionMap: { ...questionMap, stuffy_name: ["name of the stuffy"] } });
    expect(reset.stuffy?.attentionDismissedAt).toBeNull();
  });
});

describe("remapRow after a window label edit", () => {
  const typo = { ...CFG, windows: [{ id: "fri-1700", label: "5:00 PM - 6:00 PM" }] }; // hyphen, buyer typed an en dash
  const unmatched = () =>
    rows({ order: { windowId: null, windowLabelRaw: "5:00 PM – 6:00 PM" }, stuffy: { attentionCodes: ["unmapped_window"], needsAttention: true, name: "Biscuit", rawAnswers: [raw("Stuffy's name *", "Biscuit"), raw("Snack choice", "Fruit"), raw("May we share a photo of your stuffy?", "Yes")] } });

  it("renaming to the stored raw answer sets the window id and clears unmapped_window", () => {
    const { stuffy, order } = unmatched();
    const patch = remapRow(stuffy, order, CFG);
    expect(patch.order).toMatchObject({ windowId: "fri-1700" });
    expect(patch.stuffy).toMatchObject({ attentionCodes: [], needsAttention: false });
  });

  it("renaming away from the stored answer nulls the window id and adds unmapped_window; renaming back restores it", () => {
    const { stuffy, order } = rows({ stuffy: { attentionCodes: [], needsAttention: false } });
    const away = remapRow(stuffy, order, typo);
    expect(away.order).toMatchObject({ windowId: null });
    expect(away.stuffy?.attentionCodes).toContain("unmapped_window");

    const flagged = { ...stuffy, ...away.stuffy } as SwStuffy;
    const moved = { ...order, ...away.order } as SwOrder;
    const back = remapRow(flagged, moved, CFG);
    expect(back.order).toMatchObject({ windowId: "fri-1700" });
    expect(back.stuffy?.attentionCodes ?? []).not.toContain("unmapped_window");
  });
});

