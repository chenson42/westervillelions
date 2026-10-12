import { describe, expect, it } from "vitest";
import { UNMATCHED_MAX, unmatchedAnswers } from "./unmatched-answers";

const q = (question: string, answer: unknown) => ({ question, type: "text", answer });

describe("unmatchedAnswers", () => {
  it("returns only answers whose question is in no mapped list, matched on normalized text", () => {
    const map = { stuffy_name: ["stuffy's name"], ignored: ["anything else?"] };
    const out = unmatchedAnswers(
      [q("Stuffy's name *", "Biscuit"), q("Favourite colour", "blue")],
      [q("Anything else?", "no")],
      map,
    );
    expect(out).toEqual([{ question: "Favourite colour", answer: "blue" }]);
  });

  it("includes buyer-scope questions after ticket-scope ones", () => {
    const out = unmatchedAnswers([q("A", "1")], [q("B", "2")], {});
    expect(out.map((o) => o.question)).toEqual(["A", "B"]);
  });

  it("keeps markup as plain strings and caps count and length", () => {
    const many = Array.from({ length: 30 }, (_, i) => q(`Q${i}`, "x".repeat(900)));
    const out = unmatchedAnswers(many, [], {});
    expect(out).toHaveLength(UNMATCHED_MAX);
    expect(out[0].answer.length).toBe(300);
    expect(unmatchedAnswers([q("Q", "<img src=x onerror=alert(1)>")], [], {})[0].answer).toBe("<img src=x onerror=alert(1)>");
  });

  it("tolerates non-array and malformed input", () => {
    expect(unmatchedAnswers(null, undefined, {})).toEqual([]);
    expect(unmatchedAnswers([null, 4, { answer: "x" }], [], {})).toEqual([]);
  });
});
