import { describe, expect, it } from "vitest";
import { UNMATCHED_WINDOW_MAX, groupUnmatchedWindowAnswers } from "./unmatched-window-answers";

const row = (windowId: string | null, windowLabelRaw: string | null) => ({ windowId, windowLabelRaw });

describe("groupUnmatchedWindowAnswers", () => {
  it("groups null-window orders by normalized answer with counts, keeping one real spelling", () => {
    const out = groupUnmatchedWindowAnswers([row(null, "5:00 PM – 6:00 PM"), row(null, " 5:00 pm – 6:00 pm "), row(null, "Later")]);
    expect(out).toEqual([
      { answer: "5:00 PM – 6:00 PM", count: 2 },
      { answer: "Later", count: 1 },
    ]);
  });

  it("excludes matched orders and purged nulls", () => {
    expect(groupUnmatchedWindowAnswers([row("w1", "4 to 5"), row(null, null), row(null, "   ")])).toEqual([]);
  });

  it("caps the list and treats markup as plain data", () => {
    const many = Array.from({ length: 25 }, (_, i) => row(null, `Window ${i}`));
    expect(groupUnmatchedWindowAnswers(many)).toHaveLength(UNMATCHED_WINDOW_MAX);
    expect(groupUnmatchedWindowAnswers([row(null, "<img src=x onerror=alert(1)>")])[0].answer).toBe("<img src=x onerror=alert(1)>");
    expect(groupUnmatchedWindowAnswers([row(null, "x".repeat(500))])[0].answer).toHaveLength(80);
  });
});
