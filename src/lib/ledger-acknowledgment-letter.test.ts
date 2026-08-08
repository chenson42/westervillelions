/**
 * Unit tests for src/lib/ledger-acknowledgment-letter.ts — the pure
 * composition engine for Acknowledgment / Thank-You Letter Generation
 * (DECISION-072/073, 2026-08-08). Covers Phase 3's named tests 1-9.
 * Pure — no DB, `environment: "node"`.
 */

import { describe, it, expect } from "vitest";
import { composeAcknowledgmentLetter, type ComposeLetterTemplate } from "./ledger-acknowledgment-letter";

const ENTITY = {
  name: "Westerville Lions Club Foundation",
  ein: "32-0467239",
  taxClassification: "501c3",
};

const DONOR = {
  name: "Jane Donor",
  address: "123 Main St, Westerville, OH 43081",
};

const FULL_TEMPLATE: ComposeLetterTemplate = {
  greeting: "Dear {{donorName}},",
  bodyText:
    "Thank you for your generous gift of {{giftAmount}} on {{giftDate}} to {{clubName}}. It makes a real difference.",
  closing: "With gratitude,",
  signatureName: "Jane Treasurer",
  signatureTitle: "Treasurer, Westerville Lions Club Foundation",
};

const EMPTY_TEMPLATE: ComposeLetterTemplate = {
  greeting: "",
  bodyText: "",
  closing: "",
  signatureName: "",
  signatureTitle: "",
};

const WRITTEN_ACK: {
  type: "written_ack_250";
  amountCents: number;
  txnDate: string;
  quidProQuoValueCents: null;
  quidProQuoDescription: null;
} = {
  type: "written_ack_250",
  amountCents: 50000, // $500.00
  txnDate: "2026-03-03",
  quidProQuoValueCents: null,
  quidProQuoDescription: null,
};

const QPQ_ACK: {
  type: "quid_pro_quo_75";
  amountCents: 30000; // $300.00
  txnDate: string;
  quidProQuoValueCents: 5000; // $50.00
  quidProQuoDescription: string;
} = {
  type: "quid_pro_quo_75",
  amountCents: 30000,
  txnDate: "2026-04-15",
  quidProQuoValueCents: 5000,
  quidProQuoDescription: "one Rudolph Run 5K entry",
};

describe("composeAcknowledgmentLetter — written_ack_250 required content (Test 1)", () => {
  it("contains entity name, EIN, formatted amount, gift date, and the exact no-goods-or-services sentence; excludes FMV/deductible language", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain(ENTITY.name);
    expect(letter).toContain(ENTITY.ein);
    expect(letter).toContain("$500.00");
    expect(letter).toContain("March 3, 2026");
    expect(letter).toContain("No goods or services were provided in exchange for this contribution.");

    expect(letter).not.toContain("fair market value");
    expect(letter).not.toContain("tax-deductible");
    expect(letter).not.toContain("deductible for federal income tax purposes is limited");
  });
});

describe("composeAcknowledgmentLetter — quid_pro_quo_75 required content (Test 2)", () => {
  it("contains FMV, description, and the deductible-amount statement with correct arithmetic; excludes the no-goods-or-services sentence", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: QPQ_ACK,
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain("$50.00"); // FMV
    expect(letter).toContain("one Rudolph Run 5K entry");
    // amount ($300) - FMV ($50) = $250 deductible
    expect(letter).toContain("$250.00 of your payment is tax-deductible.");
    expect(letter).toContain(
      "amount of your payment that is deductible for federal income tax purposes is limited",
    );

    expect(letter).not.toContain(
      "No goods or services were provided in exchange for this contribution.",
    );
  });
});

describe("composeAcknowledgmentLetter — deductible clamp to zero (Test 3)", () => {
  it("FMV >= amount renders the 'no portion is tax-deductible' sentence, never a negative dollar figure", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: { ...QPQ_ACK, amountCents: 5000, quidProQuoValueCents: 7500 }, // $50 paid, $75 FMV
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain("no portion of your payment is tax-deductible.");
    expect(letter).not.toMatch(/-\$\d/);
    expect(letter).not.toContain("$-");
  });

  it("FMV exactly equal to amount also clamps to zero, not a negative", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: { ...QPQ_ACK, amountCents: 7500, quidProQuoValueCents: 7500 },
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain("no portion of your payment is tax-deductible.");
  });
});

describe("composeAcknowledgmentLetter — assembly order (Test 4)", () => {
  it("written_ack_250: greeting -> bodyText -> required block -> closing -> signature, in that order", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: FULL_TEMPLATE,
    });

    const iGreeting = letter.indexOf("Dear Jane Donor,");
    const iBody = letter.indexOf("It makes a real difference.");
    const iRequired = letter.indexOf("is a tax-exempt organization");
    const iClosing = letter.indexOf("With gratitude,");
    const iSigName = letter.indexOf("Jane Treasurer");
    const iSigTitle = letter.indexOf("Treasurer, Westerville Lions Club Foundation");

    expect(iGreeting).toBeGreaterThanOrEqual(0);
    expect(iBody).toBeGreaterThan(iGreeting);
    expect(iRequired).toBeGreaterThan(iBody);
    expect(iClosing).toBeGreaterThan(iRequired);
    expect(iSigName).toBeGreaterThan(iClosing);
    expect(iSigTitle).toBeGreaterThan(iSigName);
  });

  it("quid_pro_quo_75: same ordering holds", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: QPQ_ACK,
      template: FULL_TEMPLATE,
    });

    const iGreeting = letter.indexOf("Dear Jane Donor,");
    const iBody = letter.indexOf("It makes a real difference.");
    const iRequired = letter.indexOf("is a tax-exempt organization");
    const iClosing = letter.indexOf("With gratitude,");
    const iSigName = letter.indexOf("Jane Treasurer");
    const iSigTitle = letter.indexOf("Treasurer, Westerville Lions Club Foundation");

    expect(iGreeting).toBeGreaterThanOrEqual(0);
    expect(iBody).toBeGreaterThan(iGreeting);
    expect(iRequired).toBeGreaterThan(iBody);
    expect(iClosing).toBeGreaterThan(iRequired);
    expect(iSigName).toBeGreaterThan(iClosing);
    expect(iSigTitle).toBeGreaterThan(iSigName);
  });
});

describe("composeAcknowledgmentLetter — token substitution (Test 5)", () => {
  it("substitutes all four known tokens correctly when present in every one of the five template fields", () => {
    const template: ComposeLetterTemplate = {
      greeting: "Dear {{donorName}},",
      bodyText: "{{clubName}} received your gift of {{giftAmount}} on {{giftDate}}.",
      closing: "Sincerely, {{clubName}} — {{donorName}}, thank you.",
      signatureName: "{{donorName}}'s friend",
      signatureTitle: "On behalf of {{clubName}}, {{giftDate}}, {{giftAmount}}",
    };

    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template,
    });

    expect(letter).toContain("Dear Jane Donor,");
    expect(letter).toContain(
      "Westerville Lions Club Foundation received your gift of $500.00 on March 3, 2026.",
    );
    expect(letter).toContain(
      "Sincerely, Westerville Lions Club Foundation — Jane Donor, thank you.",
    );
    expect(letter).toContain("Jane Donor's friend");
    expect(letter).toContain(
      "On behalf of Westerville Lions Club Foundation, March 3, 2026, $500.00",
    );

    // No raw tokens left behind anywhere.
    expect(letter).not.toContain("{{");
  });
});

describe("composeAcknowledgmentLetter — unknown token (Test 6)", () => {
  it("leaves an unrecognized token verbatim in the output, does not strip it or throw", () => {
    const template: ComposeLetterTemplate = {
      ...FULL_TEMPLATE,
      greeting: "Dear {{notAToken}},",
    };

    expect(() =>
      composeAcknowledgmentLetter({
        entity: ENTITY,
        donor: DONOR,
        ack: WRITTEN_ACK,
        template,
      }),
    ).not.toThrow();

    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template,
    });

    expect(letter).toContain("Dear {{notAToken}},");
  });
});

describe("composeAcknowledgmentLetter — purity/fuzz: required block cannot be edited away (Test 7)", () => {
  it("with all five template fields empty, the required block is still present, complete, and byte-identical to the fully-populated-template case", () => {
    const emptyTemplateLetter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: EMPTY_TEMPLATE,
    });
    const fullTemplateLetter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: FULL_TEMPLATE,
    });

    const requiredBlockText =
      "Westerville Lions Club Foundation is a tax-exempt organization described in Internal Revenue Code Section 501(c)(3). This letter confirms that on March 3, 2026, Westerville Lions Club Foundation received a cash contribution of $500.00 from you.\n\n" +
      "No goods or services were provided in exchange for this contribution.\n\n" +
      "EIN: 32-0467239. Please retain this letter as your written record of this contribution for federal income tax purposes.";

    // The full required block appears verbatim in BOTH outputs.
    expect(emptyTemplateLetter).toContain(requiredBlockText);
    expect(fullTemplateLetter).toContain(requiredBlockText);

    // Byte-identical proof: extract the required block substring the same
    // way from each and compare — it must not differ by a single
    // character based on what the treasurer wrote (or didn't write).
    expect(emptyTemplateLetter).toBe(requiredBlockText);
    const requiredBlockStart = fullTemplateLetter.indexOf(
      "Westerville Lions Club Foundation is a tax-exempt organization",
    );
    const extractedFromFull = fullTemplateLetter.slice(
      requiredBlockStart,
      requiredBlockStart + requiredBlockText.length,
    );
    expect(extractedFromFull).toBe(requiredBlockText);
  });

  it("same proof for quid_pro_quo_75", () => {
    const emptyTemplateLetter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: QPQ_ACK,
      template: EMPTY_TEMPLATE,
    });
    const fullTemplateLetter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: QPQ_ACK,
      template: FULL_TEMPLATE,
    });

    const requiredBlockStart = fullTemplateLetter.indexOf(
      "Westerville Lions Club Foundation is a tax-exempt organization",
    );
    const extractedFromFull = fullTemplateLetter.slice(
      requiredBlockStart,
      requiredBlockStart + emptyTemplateLetter.length,
    );
    expect(emptyTemplateLetter).toBe(extractedFromFull);
    expect(emptyTemplateLetter).toContain("$250.00 of your payment is tax-deductible.");
  });
});

describe("composeAcknowledgmentLetter — quidProQuoDescription fallback (Test 8)", () => {
  it("null description falls back to the generic 'goods or services' phrase", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: { ...QPQ_ACK, quidProQuoDescription: null },
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain("providing you goods or services with an estimated fair market value");
  });

  it("a real description is used verbatim in the required block", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: { ...QPQ_ACK, quidProQuoDescription: "one Rudolph Run 5K entry" },
      template: FULL_TEMPLATE,
    });

    expect(letter).toContain(
      "providing you one Rudolph Run 5K entry with an estimated fair market value",
    );
  });
});

describe("composeAcknowledgmentLetter — Markdown-special-character escaping (Test 9)", () => {
  it("escapes Markdown special characters in a substituted donor name but leaves the treasurer's own Markdown untouched", () => {
    const template: ComposeLetterTemplate = {
      greeting: "Dear {{donorName}},",
      bodyText: "This is **real bold** text the treasurer wrote intentionally.",
      closing: "With gratitude,",
      signatureName: "Jane Treasurer",
      signatureTitle: "Treasurer",
    };

    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: { name: "J*R* Landscaping", address: DONOR.address },
      ack: WRITTEN_ACK,
      template,
    });

    // The donor's asterisks are escaped — not interpreted as emphasis markup.
    expect(letter).toContain("Dear J\\*R\\* Landscaping,");
    expect(letter).not.toContain("Dear J*R* Landscaping,");

    // The treasurer's own real Markdown is left alone.
    expect(letter).toContain("This is **real bold** text the treasurer wrote intentionally.");
  });
});
