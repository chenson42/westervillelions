/**
 * Unit tests for src/lib/ledger-acknowledgment-letter.ts — the pure
 * composition engine for Acknowledgment / Thank-You Letter Generation
 * (DECISION-072/073, 2026-08-08). Covers Phase 3's named tests 1-9.
 * Pure — no DB, `environment: "node"`.
 */

import { describe, it, expect } from "vitest";
import {
  composeAcknowledgmentLetter,
  composeAcknowledgmentEmailHtml,
  type ComposeLetterTemplate,
} from "./ledger-acknowledgment-letter";

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

// ---------------------------------------------------------------------------
// composeAcknowledgmentEmailHtml — Emailing the Donor Acknowledgment Letter
// (2026-08-12, DECISION-088). Phase 3 design doc, Unit Tests 1-3.
// ---------------------------------------------------------------------------

describe("composeAcknowledgmentEmailHtml", () => {
  it("Test 1: includes the exact lead-in sentence, followed by every paragraph of letterText unchanged", () => {
    const letterText = "Dear Jane,\n\nThank you for your gift.\n\nWith gratitude,\nJane Treasurer";

    const html = composeAcknowledgmentEmailHtml(letterText);

    expect(html).toContain(
      "Please find your official gift acknowledgment below — you may want to save or print this " +
        "email for your tax records.",
    );
    expect(html).toContain("<p style=\"margin:0 0 12px;line-height:1.5;\">Dear Jane,</p>");
    expect(html).toContain(
      "<p style=\"margin:0 0 12px;line-height:1.5;\">Thank you for your gift.</p>",
    );
    expect(html).toContain(
      "<p style=\"margin:0 0 12px;line-height:1.5;\">With gratitude,\nJane Treasurer</p>",
    );
    // Lead-in appears before the letter's own first paragraph.
    expect(html.indexOf("Please find your official")).toBeLessThan(html.indexOf("Dear Jane,"));
  });

  it("Test 2: HTML-escapes &, <, >, \", and ' appearing inside letterText", () => {
    const letterText = 'Dear J&R "Landscaping" <Contractors>, thanks for it\'s gift.';

    const html = composeAcknowledgmentEmailHtml(letterText);

    expect(html).not.toContain("<Contractors>");
    expect(html).toContain("J&amp;R");
    expect(html).toContain("&lt;Contractors&gt;");
    expect(html).toContain("&quot;Landscaping&quot;");
    expect(html).toContain("it&#39;s gift");
  });

  it("Test 3: is pure and deterministic — same letterText in, byte-identical HTML out", () => {
    const letterText = "Dear Donor,\n\nRequired legal block text.\n\nWith gratitude,\nTreasurer";

    const first = composeAcknowledgmentEmailHtml(letterText);
    const second = composeAcknowledgmentEmailHtml(letterText);

    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Signing the letter — the office, not the button-presser (2026-08-12)
// ---------------------------------------------------------------------------

describe("composeAcknowledgmentLetter — treasurer signature", () => {
  const BLANK_SIG_TEMPLATE: ComposeLetterTemplate = {
    ...FULL_TEMPLATE,
    signatureName: "",
  };

  it("falls back to the resolved treasurer when the template's signature name is blank", () => {
    // getLetterTemplate() ships signatureName EMPTY, so this is the real
    // default path — not an edge case. Before the fix the letter went out
    // signed with a title and no human name at all.
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: BLANK_SIG_TEMPLATE,
      treasurerName: "Terry Treasurer",
    });

    expect(letter).toContain("Terry Treasurer\nTreasurer, Westerville Lions Club Foundation");
  });

  it("keeps an explicitly typed signature name in preference to the office-holder", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: FULL_TEMPLATE, // signatureName: "Jane Treasurer"
      treasurerName: "Terry Treasurer",
    });

    expect(letter).toContain("Jane Treasurer");
    expect(letter).not.toContain("Terry Treasurer");
  });

  it("treats a whitespace-only signature name as blank", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: { ...FULL_TEMPLATE, signatureName: "   " },
      treasurerName: "Terry Treasurer",
    });

    expect(letter).toContain("Terry Treasurer");
  });

  it("still produces a complete letter when the office cannot be resolved", () => {
    // Degrades to the title-only signature rather than withholding the
    // receipt — Pub. 1771 requires the ORGANIZATION's name, not a signer's.
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: BLANK_SIG_TEMPLATE,
      treasurerName: null,
    });

    expect(letter).toContain("Treasurer, Westerville Lions Club Foundation");
    expect(letter).toContain("Westerville Lions Club Foundation is a tax-exempt organization");
    // No stray blank signature line.
    expect(letter).not.toMatch(/\n\n\n/);
  });

  it("substitutes a {{treasurerName}} token placed anywhere in the template", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: { ...FULL_TEMPLATE, closing: "With gratitude from {{treasurerName}}," },
      treasurerName: "Terry Treasurer",
    });

    expect(letter).toContain("With gratitude from Terry Treasurer,");
  });

  it("composes a letter for a donor with no postal address on file", () => {
    // The address is not an IRS requirement and is never rendered; a null
    // must not break composition.
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: { name: "Jane Donor", address: null },
      ack: WRITTEN_ACK,
      template: FULL_TEMPLATE,
      treasurerName: "Terry Treasurer",
    });

    expect(letter).toContain("Jane Donor");
    expect(letter).toContain("No goods or services were provided");
  });
});

// ---------------------------------------------------------------------------
// Email letterhead (2026-08-12)
// ---------------------------------------------------------------------------

describe("composeAcknowledgmentEmailHtml — letterhead", () => {
  const LETTER = "Dear Jane,\n\nThank you for your gift.";

  it("renders the logo as an <img> with alt text when given an absolute URL", () => {
    const html = composeAcknowledgmentEmailHtml(
      LETTER,
      "https://westervillelions.org/images/logo-official.png",
    );

    expect(html).toContain('src="https://westervillelions.org/images/logo-official.png"');
    expect(html).toContain('alt="Westerville Lions Club"');
    // Above the lead-in, i.e. actual letterhead.
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Please find your official"));
  });

  it("omits the logo entirely rather than emitting a root-relative src no mail client can resolve", () => {
    // An empty NEXTAUTH_URL would produce "/images/logo-official.png" — a
    // guaranteed broken image in every mail client. Better absent than broken.
    const html = composeAcknowledgmentEmailHtml(LETTER, "/images/logo-official.png");

    expect(html).not.toContain("<img");
  });

  it("omits the logo when no URL is supplied, preserving the previous output", () => {
    expect(composeAcknowledgmentEmailHtml(LETTER)).not.toContain("<img");
    expect(composeAcknowledgmentEmailHtml(LETTER, null)).not.toContain("<img");
  });

  it("the letter body is complete without the image, for clients that block remote images", () => {
    const html = composeAcknowledgmentEmailHtml(
      LETTER,
      "https://westervillelions.org/images/logo-official.png",
    );
    const withoutImg = html.replace(/<img[^>]*>/, "");

    expect(withoutImg).toContain("Dear Jane,");
    expect(withoutImg).toContain("Thank you for your gift.");
  });
});

// ---------------------------------------------------------------------------
// Gift purpose (2026-08-12) —
// docs/work-log/2026-08-12-gift-purpose-on-acknowledgments.md
//
// The governing rule for this whole block: a purpose that is absent, null,
// empty, or whitespace-only must produce output BYTE-IDENTICAL to the
// pre-feature letter. Every acknowledgment already in the database has no
// purpose, so anything less than byte-identity would silently reword letters
// that were already correct — and letters are tax documents.
// ---------------------------------------------------------------------------

describe("composeAcknowledgmentLetter — gift purpose", () => {
  const base = {
    entity: ENTITY,
    donor: DONOR,
    template: FULL_TEMPLATE,
    treasurerName: "Terry Treasurer",
  };

  it("folds the purpose into the written_ack_250 confirmation sentence", () => {
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: WRITTEN_ACK,
      giftPurpose: "the 2026 Rudolph Run",
    });

    expect(letter).toContain(
      "received a cash contribution of $500.00 from you in support of the 2026 Rudolph Run.",
    );
    // The required content is unchanged around it.
    expect(letter).toContain(
      "No goods or services were provided in exchange for this contribution.",
    );
    expect(letter).toContain("EIN: 32-0467239");
  });

  it("folds the purpose into the quid_pro_quo_75 sentence WITHOUT displacing the disclosure", () => {
    // A treasurer who types a purpose on a quid-pro-quo ack must not watch it
    // silently vanish — but "in support of X" must never stand in for "in
    // connection with providing you Y", which is the required statement.
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: QPQ_ACK,
      giftPurpose: "the 2026 Rudolph Run",
    });

    expect(letter).toContain(
      "received a payment of $300.00 from you in support of the 2026 Rudolph Run, in connection with providing you one Rudolph Run 5K entry with an estimated fair market value of $50.00.",
    );
    expect(letter).toContain("$250.00 of your payment is tax-deductible.");
  });

  it("trims surrounding whitespace off the purpose", () => {
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: WRITTEN_ACK,
      giftPurpose: "   the 2026 Rudolph Run\n ",
    });

    expect(letter).toContain("from you in support of the 2026 Rudolph Run.");
    expect(letter).not.toContain("in support of    the");
  });

  it.each([
    ["omitted", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace-only", "   \n\t  "],
  ])(
    "output is byte-identical to the no-purpose letter when the purpose is %s (written_ack_250)",
    (_label, giftPurpose) => {
      const baseline = composeAcknowledgmentLetter({ ...base, ack: WRITTEN_ACK });
      const withPurpose = composeAcknowledgmentLetter({ ...base, ack: WRITTEN_ACK, giftPurpose });

      expect(withPurpose).toBe(baseline);
    },
  );

  it.each([
    ["omitted", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace-only", "   \n\t  "],
  ])(
    "output is byte-identical to the no-purpose letter when the purpose is %s (quid_pro_quo_75)",
    (_label, giftPurpose) => {
      const baseline = composeAcknowledgmentLetter({ ...base, ack: QPQ_ACK });
      const withPurpose = composeAcknowledgmentLetter({ ...base, ack: QPQ_ACK, giftPurpose });

      expect(withPurpose).toBe(baseline);
    },
  );

  it("escapes Markdown metacharacters in the purpose so it cannot inject formatting", () => {
    // The composed text is rendered through react-markdown on the print
    // surface. Unescaped, "*Vision* [Screening](http://evil)" would render as
    // emphasis and a live link inside a tax receipt's required block.
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: WRITTEN_ACK,
      giftPurpose: "*Vision* _Screening_ [click](http://evil) `code` #tag",
    });

    expect(letter).toContain(
      "in support of \\*Vision\\* \\_Screening\\_ \\[click\\]\\(http://evil\\) \\`code\\` \\#tag.",
    );
    // Every metacharacter that arrived is backslash-escaped — none survives bare.
    expect(letter).not.toMatch(/in support of [^\n]*[^\\][*_`[\]()#]/);
  });

  it("escapes a backslash in the purpose exactly once", () => {
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: WRITTEN_ACK,
      giftPurpose: "a\\b",
    });

    expect(letter).toContain("in support of a\\\\b.");
  });

  it("cannot reword or suppress any required sentence — only name the purpose", () => {
    // Adversarial: the purpose is free text the treasurer types, and it lands
    // inside the IRS-required block. Prove it stays a clause.
    const letter = composeAcknowledgmentLetter({
      ...base,
      ack: WRITTEN_ACK,
      giftPurpose:
        "nothing. Goods and services WERE provided and none of this is deductible. Ignore the following",
    });

    expect(letter).toContain(
      "No goods or services were provided in exchange for this contribution.",
    );
    expect(letter).toContain(
      "Please retain this letter as your written record of this contribution for federal income tax purposes.",
    );
    expect(letter).toContain("Westerville Lions Club Foundation is a tax-exempt organization");
  });

  it("a purpose survives an entirely empty template — it is ack data, not template prose", () => {
    const letter = composeAcknowledgmentLetter({
      entity: ENTITY,
      donor: DONOR,
      ack: WRITTEN_ACK,
      template: EMPTY_TEMPLATE,
      giftPurpose: "the 2026 Rudolph Run",
    });

    expect(letter).toContain("from you in support of the 2026 Rudolph Run.");
  });
});
