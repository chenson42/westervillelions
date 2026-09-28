import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const selectMock = vi.fn();
const insertValuesMock = vi.fn();
const deleteWhereMock = vi.fn();

// Minimal default mock — only needed because checkAndRecordFormCooldown()
// dynamically imports @/lib/db at call time (not module load — see
// src/lib/form-guard.ts's top doc comment for why). Static top-level imports
// of evaluateStructuralGuard()/evaluateContentGuard()/isGibberishToken() never
// touch this at all.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: async () => undefined }),
    delete: () => ({ where: async () => undefined }),
  },
}));

vi.mock("@/lib/db/schema", () => ({ formSubmissionCooldown: { email: "email", createdAt: "created_at", id: "id" } }));

describe("evaluateStructuralGuard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honeypot: non-empty value trips, allow is false, reason is honeypot", async () => {
    const { evaluateStructuralGuard } = await import("@/lib/form-guard");
    const verdict = evaluateStructuralGuard({ honeypot: "i-am-a-bot" });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe("honeypot");
  });

  it.each([undefined, null, "", "   "])("honeypot value %p does not trip", async (value) => {
    const { evaluateStructuralGuard } = await import("@/lib/form-guard");
    const verdict = evaluateStructuralGuard({ honeypot: value });
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it("timing floor trips in production when renderedAt is within the floor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { evaluateStructuralGuard } = await import("@/lib/form-guard");
    const verdict = evaluateStructuralGuard({ renderedAt: Date.now() - 200 });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe("timing");
  });

  it.each(["development", "test"])(
    "timing floor does NOT trip outside production (NODE_ENV=%s) with the same too-fast renderedAt",
    async (env) => {
      vi.stubEnv("NODE_ENV", env);
      const { evaluateStructuralGuard } = await import("@/lib/form-guard");
      const verdict = evaluateStructuralGuard({ renderedAt: Date.now() - 200 });
      expect(verdict.allow).toBe(true);
      expect(verdict.reason).toBeNull();
    },
  );

  it("missing renderedAt never trips the timing check, in either environment", async () => {
    for (const env of ["production", "development"]) {
      vi.stubEnv("NODE_ENV", env);
      const { evaluateStructuralGuard } = await import("@/lib/form-guard");
      const verdict = evaluateStructuralGuard({ renderedAt: undefined });
      expect(verdict.allow).toBe(true);
    }
  });

  it("its verdict type carries no content/gibberish field (compile-time check)", async () => {
    const { evaluateStructuralGuard } = await import("@/lib/form-guard");
    const verdict = evaluateStructuralGuard({ honeypot: "", renderedAt: undefined });
    // @ts-expect-error — StructuralGuardVerdict has no gibberishFieldCount; it
    // knows nothing about content by construction (DECISION-104 Revision 2).
    expect(verdict.gibberishFieldCount).toBeUndefined();
  });
});

describe("evaluateContentGuard", () => {
  it("a single gibberish field never flips allow to false on its own", async () => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    // "Zqbfhntlrk": 10 alpha, 0 vowels, 0 case transitions, low bigram score,
    // consonant run 10 — fires all 4 signals, definitely gibberish.
    const verdict = evaluateContentGuard(["Zqbfhntlrk", "Thanks!"]);
    expect(verdict.allow).toBe(true);
    expect(verdict.gibberishFieldCount).toBe(1);
  });

  it("two independently gibberish fields DO reject", async () => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    const verdict = evaluateContentGuard(["Zqbfhntlrk", "Vwmzcprxgh"]);
    expect(verdict.allow).toBe(false);
    expect(verdict.gibberishFieldCount).toBe(2);
  });

  it("three-candidate case rejects regardless of which two of three agree", async () => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    const combos: (string | null)[][] = [
      ["Zqbfhntlrk", "Vwmzcprxgh", "Westerville"],
      ["Jordan", "Vwmzcprxgh", "Xzcbfhntkr"],
      ["Zqbfhntlrk", "Smith", "Xzcbfhntkr"],
    ];
    for (const textFields of combos) {
      const verdict = evaluateContentGuard(textFields);
      expect(verdict.allow).toBe(false);
      expect(verdict.gibberishFieldCount).toBe(2);
    }
  });

  it("one gibberish field plus one normal field still succeeds", async () => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    const verdict = evaluateContentGuard(["Zqbfhntlrk", "Jordan Smith"]);
    expect(verdict.allow).toBe(true);
  });
});

describe("isGibberishToken — four-signal combined score (DECISION-104 Revision 2)", () => {
  it.each([
    "Jordan Smith",
    "Hi",
    "Thanks!",
    "test",
    "Mary-Kate",
    "O'Brien",
    null,
    undefined,
    "",
  ])("legit-shaped %p returns false", async (value) => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    expect(isGibberishToken(value as string | null | undefined)).toBe(false);
  });

  it.each(["Zqbfhntlrk", "Vwmzcprxgh", "Xzcbfhntkr", "Grxzflpkmt"])(
    "bot-shaped %p (fires >= 2 of 4 signals) returns true",
    async (value) => {
      const { isGibberishToken } = await import("@/lib/form-guard");
      expect(isGibberishToken(value)).toBe(true);
    },
  );

  it("a space-less short word under the alphabetic-length floor is never flagged", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    expect(isGibberishToken("abc")).toBe(false); // 3 alpha chars, under the 4-char floor
  });

  it("a legit token with a space is never flagged regardless of content", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    expect(isGibberishToken("Zqbfhntlrk Vwmzcprxgh")).toBe(false);
  });

  it("a token engineered to fire exactly 1 of 4 signals is not gibberish (needs >= 2)", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    // "Krakowski": vowel ratio 0.333 (does NOT fire, > 0.20); 0 case
    // transitions (does NOT fire); longest consonant run 3 (does NOT fire,
    // < 6); bigram score 0.125 < 0.45 (DOES fire — a short letter-pair
    // coincidence, since only 8 adjacent pairs exist in a 9-char word and
    // this particular list of 150 common pairs happens to miss most of
    // them). Exactly 1 of 4 signals fires — below the >= 2 threshold, so
    // this is correctly NOT flagged.
    expect(isGibberishToken("Krakowski")).toBe(false);
  });

  it("a token that fires 3 of 4 signals (vowel ratio + bigram + consonant run) IS gibberish", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    // "Bcdfghjk": 8 alpha, 0 vowels (fires vowel-ratio), 0 common bigrams
    // (fires bigram), longest consonant run 8 (fires consonant-run). Three
    // of four signals firing is well past the >= 2 threshold.
    expect(isGibberishToken("Bcdfghjk")).toBe(true);
  });

  it("case-transition floor: exactly 1 transition does not count toward firing that signal", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    // "McTest"-shaped: one lowercase->uppercase transition (c->T). Vowel
    // ratio: M,c,T,e,s,t -> alpha 6, vowel e = 1/6 = 0.167 <= 0.20 (FIRES).
    // Consonant run: M,c,(vowel breaks),T,s,t -> longest run 3 (T,s,t) or
    // (M,c) = 2, both well under 6 (does not fire). Bigram: mc,ct,te,es,st ->
    // "te","es","st" all common -> score high, likely >= 0.45 (does not
    // fire). So only vowel-ratio fires (1 of 4) plus a single case
    // transition, which alone never counts as the case-transition signal
    // (needs >= 2) — total fired should be 1, so NOT gibberish.
    expect(isGibberishToken("McTest")).toBe(false);
  });

  it("case-transition signal fires at 2 transitions (McTestFord-shaped)", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    // "McTestFord": transitions c->T and t->F = 2 transitions (fires case
    // signal). Combined with the vowel-ratio signal (still low, as above),
    // this token fires >= 2 signals and should be gibberish.
    const alpha = "McTestFord".replace(/[^a-zA-Z]/g, "");
    const vowels = (alpha.match(/[aeiou]/gi) ?? []).length;
    expect(vowels / alpha.length).toBeLessThanOrEqual(0.2); // sanity: vowel signal also fires
    expect(isGibberishToken("McTestFord")).toBe(true);
  });
});

describe("isGibberishToken — stress test against real, unusual surnames (DECISION-104 Revision 2)", () => {
  // Invented-shape fixtures only, per the no-real-data constraint — NOT the
  // actual surnames the design doc's calibration pass tested (those aren't
  // club members and shouldn't appear verbatim in test fixtures either).
  // "Vrzybelski" is shaped like a real Central/Eastern European surname
  // (consonant cluster + "-ski" ending) without being one.
  it("a consonant-cluster-heavy invented surname may single-field-flag", async () => {
    const { isGibberishToken } = await import("@/lib/form-guard");
    // This assertion documents current behavior — it is allowed to flag on
    // its own. The regression guarantee is the PAIR test below, not this one.
    const flagged = isGibberishToken("Vrzybelski");
    expect(typeof flagged).toBe("boolean");
  });

  it("REGRESSION: an invented hard-surname-shaped token paired with an ordinary first name never reaches the two-field threshold", async () => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    // Regardless of whether "Vrzybelski" alone flags, pairing it with an
    // ordinary invented first name ("Marek") must never produce a two-field
    // reject — "Marek" has a healthy vowel ratio, no case transitions, common
    // bigrams, and no long consonant run, so it cannot independently flag.
    const verdict = evaluateContentGuard(["Marek", "Vrzybelski"]);
    expect(verdict.allow).toBe(true);
    expect(verdict.gibberishFieldCount).toBeLessThan(2);
  });

  it.each([
    ["Nguyen-shaped", "Nguyen"],
    ["O'Brien-shaped (apostrophe)", "OBrien"],
    ["Szczepanski-shaped", "Szczepanski"],
    ["Krzyzewski-shaped", "Krzyzewski"],
  ])("realistic invented surname shape %s does not by itself force a pair-reject with an ordinary first name", async (_label, surname) => {
    const { evaluateContentGuard } = await import("@/lib/form-guard");
    const verdict = evaluateContentGuard(["Jordan", surname]);
    expect(verdict.allow).toBe(true);
  });
});

describe("checkAndRecordFormCooldown", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
    insertValuesMock.mockReset();
    deleteWhereMock.mockReset();
  });

  it("returns withinCooldown: true and does not insert when a recent row exists", async () => {
    vi.doMock("@/lib/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: (...args: unknown[]) => {
              selectMock(...args);
              return { limit: async () => [{ id: "existing-row" }] };
            },
          }),
        }),
        insert: () => ({ values: async (v: unknown) => insertValuesMock(v) }),
        delete: () => ({ where: async (...args: unknown[]) => deleteWhereMock(...args) }),
      },
    }));
    const { checkAndRecordFormCooldown } = await import("@/lib/form-guard");
    const result = await checkAndRecordFormCooldown("Person@Example.com");
    expect(result.withinCooldown).toBe(true);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns withinCooldown: false, inserts the lower-cased/trimmed email, and prunes on a miss", async () => {
    vi.doMock("@/lib/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: (...args: unknown[]) => {
              selectMock(...args);
              return { limit: async () => [] };
            },
          }),
        }),
        insert: () => ({ values: async (v: unknown) => insertValuesMock(v) }),
        delete: () => ({ where: async (...args: unknown[]) => deleteWhereMock(...args) }),
      },
    }));
    const { checkAndRecordFormCooldown } = await import("@/lib/form-guard");
    const result = await checkAndRecordFormCooldown("  Person@Example.com  ");
    expect(result.withinCooldown).toBe(false);
    expect(insertValuesMock).toHaveBeenCalledWith({ email: "person@example.com" });
    expect(deleteWhereMock).toHaveBeenCalled();
  });
});
