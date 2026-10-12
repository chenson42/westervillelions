import { describe, expect, it } from "vitest";
import { answerToText, interpretConsent, isQuestionMapKey, normalizeQuestionText, QUESTION_FIELDS } from "./question-fields";

describe("normalizeQuestionText", () => {
  it.each([
    ["Stuffy's Name", "stuffy's name"],
    ["  Stuffy's   name  ", "stuffy's name"],
    ["Stuffy's name *", "stuffy's name"],
    ["Snack choice:", "snack choice"],
    ["Anything else we should know?", "anything else we should know"],
    ["Photo sharing? *", "photo sharing"],
    ["Photo sharing ?:*", "photo sharing"],
    ["Ｓｔｕｆｆｙ", "stuffy"], // NFKC folds full-width letters
    ["Line\tbreak\nname", "line break name"],
    ["", ""],
    ["***", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeQuestionText(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeQuestionText("  What IS it? *");
    expect(normalizeQuestionText(once)).toBe(once);
  });
});

describe("interpretConsent (opt-in)", () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, false],
    [null, false],
    ["Yes", true],
    ["yes ", true],
    ["YES", true],
    ["I agree", true],
    ["No", false],
    ["No thank you", false],
    ["", false],
    ["maybe later", false],
    [["Yes"], true],
    [["No"], false],
    [[], false],
    [1, false],
  ])("%j -> %j", (answer, expected) => {
    expect(interpretConsent(answer)).toBe(expected);
  });
});

describe("answerToText", () => {
  it("handles string, number, boolean and array", () => {
    expect(answerToText("as is ")).toBe("as is ");
    expect(answerToText(5)).toBe("5");
    expect(answerToText(true)).toBe("true");
    expect(answerToText(false)).toBe("false");
    expect(answerToText(["a", "b"])).toBe("a, b");
    expect(answerToText(["x".repeat(600)])).toHaveLength(500);
    expect(answerToText(undefined)).toBe("");
    expect(answerToText({})).toBe("");
  });
});

describe("field catalog", () => {
  it("has the spec's fields, three required", () => {
    expect(QUESTION_FIELDS.map((f) => f.key)).toEqual([
      "stuffy_name", "stuffy_description", "snack", "note_to_santa", "care_note",
      "child_first_name", "photo_consent", "buyer_phone", "dropoff_window", "acknowledgment",
    ]);
    expect(QUESTION_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(["stuffy_name", "snack", "dropoff_window"]);
  });

  it("accepts the ignore key and rejects unknown keys", () => {
    expect(isQuestionMapKey("ignored")).toBe(true);
    expect(isQuestionMapKey("snack")).toBe(true);
    expect(isQuestionMapKey("password")).toBe(false);
  });
});
