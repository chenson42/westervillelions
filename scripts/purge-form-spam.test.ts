import { describe, it, expect } from "vitest";
import {
  CROSS_TABLE_WINDOW_MS,
  classify,
  contentMatches,
  normalizeEmail,
  selectMatches,
  timingMatches,
  unmatchedRows,
  type CorrelationRow,
} from "./purge-form-spam";

// All fixtures below are invented — no real captured bot strings or
// harvested addresses, per the no-real-data constraint on this task.

function row(overrides: Partial<CorrelationRow>): CorrelationRow {
  return {
    id: "row-id",
    createdAt: new Date("2026-09-23T10:00:00.000Z"),
    emailNormalized: "person@example.com",
    fields: ["Jordan Smith"],
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Person@Example.com  ")).toBe("person@example.com");
  });
});

describe("contentMatches", () => {
  it("true when at least two fields are independently gibberish", () => {
    expect(contentMatches(["Zqbfhntlrk", "Vwmzcprxgh"])).toBe(true);
  });

  it("false when only one field is gibberish", () => {
    expect(contentMatches(["Zqbfhntlrk", "Jordan Smith"])).toBe(false);
  });

  it("false when no fields are gibberish", () => {
    expect(contentMatches(["Jordan Smith", "Hello there"])).toBe(false);
  });
});

describe("timingMatches", () => {
  it("two rows sharing an email within 90 seconds across two different tables are matched", () => {
    const target = row({
      id: "contact-1",
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
      emailNormalized: "bot@example.com",
    });
    const sibling = row({
      id: "newsletter-1",
      createdAt: new Date("2026-09-23T10:01:20.000Z"), // 80s later
      emailNormalized: "bot@example.com",
    });
    expect(timingMatches(target, [[sibling]])).toBe(true);
  });

  it("matches in either direction (earlier or later timestamp)", () => {
    const target = row({
      id: "contact-1",
      createdAt: new Date("2026-09-23T10:01:20.000Z"),
      emailNormalized: "bot@example.com",
    });
    const sibling = row({
      id: "membership-1",
      createdAt: new Date("2026-09-23T10:00:00.000Z"), // 80s earlier
      emailNormalized: "bot@example.com",
    });
    expect(timingMatches(target, [[sibling]])).toBe(true);
  });

  it("exactly at the 90-second boundary still matches", () => {
    const target = row({
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
      emailNormalized: "bot@example.com",
    });
    const sibling = row({
      createdAt: new Date(new Date("2026-09-23T10:00:00.000Z").getTime() + CROSS_TABLE_WINDOW_MS),
      emailNormalized: "bot@example.com",
    });
    expect(timingMatches(target, [[sibling]])).toBe(true);
  });

  it("two rows sharing an email 3 minutes apart are NOT matched (window boundary)", () => {
    const target = row({
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
      emailNormalized: "bot@example.com",
    });
    const sibling = row({
      createdAt: new Date("2026-09-23T10:03:00.000Z"), // 180s later
      emailNormalized: "bot@example.com",
    });
    expect(timingMatches(target, [[sibling]])).toBe(false);
  });

  it("does not match a different email even within the window", () => {
    const target = row({
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
      emailNormalized: "bot@example.com",
    });
    const sibling = row({
      createdAt: new Date("2026-09-23T10:00:30.000Z"),
      emailNormalized: "someone-else@example.com",
    });
    expect(timingMatches(target, [[sibling]])).toBe(false);
  });
});

describe("classify / selectMatches / unmatchedRows", () => {
  it("a row matched by content alone is selected", () => {
    const r = row({ id: "c1", fields: ["Zqbfhntlrk", "Vwmzcprxgh"] });
    const classified = classify([r], [[]]);
    expect(selectMatches(classified)).toHaveLength(1);
    expect(unmatchedRows(classified)).toHaveLength(0);
  });

  it("a row matched by timing alone (content clean) is selected", () => {
    const r = row({
      id: "c1",
      emailNormalized: "bot@example.com",
      fields: ["Jordan Smith"], // clean content
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    });
    const sibling = row({
      id: "n1",
      emailNormalized: "bot@example.com",
      createdAt: new Date("2026-09-23T10:00:30.000Z"),
    });
    const classified = classify([r], [[sibling]]);
    expect(classified[0].content).toBe(false);
    expect(classified[0].timing).toBe(true);
    expect(selectMatches(classified)).toHaveLength(1);
  });

  it("a row with no email match in either other table and content that doesn't flag is left unmatched and reported separately, not silently dropped", () => {
    const isolated = row({
      id: "m1",
      emailNormalized: "lonely@example.com",
      fields: ["Jordan Smith", "Springfield"], // clean content
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    });
    const unrelated = row({
      id: "c1",
      emailNormalized: "someone-else@example.com",
      createdAt: new Date("2026-09-23T10:00:10.000Z"),
    });
    const classified = classify([isolated], [[unrelated], []]);
    const selected = selectMatches(classified);
    const unmatched = unmatchedRows(classified);
    // Never silently dropped: it must show up in EXACTLY one of the two
    // partitions, and it must be the unmatched one, not simply absent from
    // both.
    expect(selected).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].row.id).toBe("m1");
  });

  it("a row matched by both content and timing is still selected exactly once", () => {
    const r = row({
      id: "c1",
      emailNormalized: "bot@example.com",
      fields: ["Zqbfhntlrk", "Vwmzcprxgh"],
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    });
    const sibling = row({
      id: "n1",
      emailNormalized: "bot@example.com",
      createdAt: new Date("2026-09-23T10:00:30.000Z"),
    });
    const classified = classify([r], [[sibling]]);
    expect(classified[0].content).toBe(true);
    expect(classified[0].timing).toBe(true);
    expect(selectMatches(classified)).toHaveLength(1);
  });
});
