/**
 * Unit tests for src/lib/proposals.ts
 *
 * Covers exactly the "Required Unit Tests" named in
 * docs/work-log/2026-08-09-project-proposal-form.md's Phase 3 design doc.
 * All tests are pure (no DB) — vitest.config.ts runs environment: "node",
 * same as minutes.test.ts's precedent.
 */

import { describe, it, expect } from "vitest";
import {
  PROPOSAL_STATUSES,
  isValidProposalStatus,
  PROPOSAL_TYPES,
  isValidProposalType,
  MONEY_NEEDED_VALUES,
  isValidMoneyNeeded,
  isProposalEditableByProposer,
  proposalVisibleTo,
  validateProposalSubmission,
  isNoOpDecision,
  proposalStatusLabel,
  escapeProposalHtml,
} from "@/lib/proposals";

// ── 1. isValidProposalStatus() ──────────────────────────────────────────
describe("isValidProposalStatus", () => {
  it("accepts all 6 seeded statuses", () => {
    expect(PROPOSAL_STATUSES).toEqual([
      "draft",
      "submitted",
      "under_review",
      "approved",
      "declined",
      "deferred",
    ]);
    for (const status of PROPOSAL_STATUSES) {
      expect(isValidProposalStatus(status)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    expect(isValidProposalStatus("pending")).toBe(false);
    expect(isValidProposalStatus("Draft")).toBe(false); // case-sensitive
    expect(isValidProposalStatus("draft ")).toBe(false); // no trimming
    expect(isValidProposalStatus("")).toBe(false);
  });
});

// ── 2. isValidProposalType() / money-needed validator ───────────────────
describe("isValidProposalType", () => {
  it("accepts exactly the three PROPOSAL_TYPES values", () => {
    expect(PROPOSAL_TYPES).toEqual(["fundraiser", "service_project", "both"]);
    for (const type of PROPOSAL_TYPES) {
      expect(isValidProposalType(type)).toBe(true);
    }
  });

  it("rejects near-misses", () => {
    expect(isValidProposalType("Fundraiser")).toBe(false); // capitalized
    expect(isValidProposalType("service project")).toBe(false); // space, not underscore
    expect(isValidProposalType("maybe")).toBe(false);
    expect(isValidProposalType("")).toBe(false);
  });
});

describe("isValidMoneyNeeded", () => {
  it("accepts exactly the three MONEY_NEEDED_VALUES values", () => {
    expect(MONEY_NEEDED_VALUES).toEqual(["yes", "no", "not_sure"]);
    for (const value of MONEY_NEEDED_VALUES) {
      expect(isValidMoneyNeeded(value)).toBe(true);
    }
  });

  it("rejects near-misses", () => {
    expect(isValidMoneyNeeded("Yes")).toBe(false); // capitalized
    expect(isValidMoneyNeeded("maybe")).toBe(false);
    expect(isValidMoneyNeeded("not sure")).toBe(false); // space, not underscore
    expect(isValidMoneyNeeded("")).toBe(false);
  });
});

// ── 3. isProposalEditableByProposer() ────────────────────────────────────
describe("isProposalEditableByProposer", () => {
  it("is true for draft and submitted", () => {
    expect(isProposalEditableByProposer("draft")).toBe(true);
    expect(isProposalEditableByProposer("submitted")).toBe(true);
  });

  it("is false for under_review, approved, declined, and deferred", () => {
    expect(isProposalEditableByProposer("under_review")).toBe(false);
    expect(isProposalEditableByProposer("approved")).toBe(false);
    expect(isProposalEditableByProposer("declined")).toBe(false);
    expect(isProposalEditableByProposer("deferred")).toBe(false);
  });
});

// ── 4. proposalVisibleTo() ────────────────────────────────────────────────
describe("proposalVisibleTo", () => {
  it("is true for the owner", () => {
    expect(
      proposalVisibleTo({ proposerUserId: "user-1", viewerUserId: "user-1", viewerHasReviewAccess: false }),
    ).toBe(true);
  });

  it("is true for a PROPOSALS_REVIEW holder, even a non-owner", () => {
    expect(
      proposalVisibleTo({ proposerUserId: "user-1", viewerUserId: "user-2", viewerHasReviewAccess: true }),
    ).toBe(true);
  });

  it("is false for neither the owner nor a reviewer", () => {
    expect(
      proposalVisibleTo({ proposerUserId: "user-1", viewerUserId: "user-2", viewerHasReviewAccess: false }),
    ).toBe(false);
  });

  it("resolves false for every non-reviewer viewer when proposerUserId is null (deleted account)", () => {
    expect(
      proposalVisibleTo({ proposerUserId: null, viewerUserId: "user-2", viewerHasReviewAccess: false }),
    ).toBe(false);
    expect(
      proposalVisibleTo({ proposerUserId: null, viewerUserId: null, viewerHasReviewAccess: false }),
    ).toBe(false);
  });

  it("is still true for a reviewer even when proposerUserId is null", () => {
    expect(
      proposalVisibleTo({ proposerUserId: null, viewerUserId: "user-2", viewerHasReviewAccess: true }),
    ).toBe(true);
  });
});

// ── 5. validateProposalSubmission() ──────────────────────────────────────
const MINIMAL_VALID_SUBMISSION = {
  projectName: "Fall Food Drive",
  type: "service_project",
  needDescription: "Feeds families facing food insecurity heading into winter.",
  chairName: "Jane Lion",
  moneyNeeded: "no",
  estimatedCostCents: null,
  estimatedCostUnknown: false,
} as const;

describe("validateProposalSubmission", () => {
  it("passes with no errors for a fully-populated minimal submission", () => {
    const result = validateProposalSubmission(MINIMAL_VALID_SUBMISSION);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("produces a field-keyed error naming projectName when missing", () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, projectName: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.projectName).toBeDefined();
    expect(typeof result.errors.projectName).toBe("string");
  });

  it("produces a field-keyed error naming type when missing", () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, type: null });
    expect(result.valid).toBe(false);
    expect(result.errors.type).toBeDefined();
  });

  it("produces a field-keyed error naming needDescription when missing", () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, needDescription: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.needDescription).toBeDefined();
  });

  it("produces a field-keyed error naming chairName when missing", () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, chairName: null });
    expect(result.valid).toBe(false);
    expect(result.errors.chairName).toBeDefined();
  });

  it("produces a field-keyed error naming moneyNeeded when missing", () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, moneyNeeded: null });
    expect(result.valid).toBe(false);
    expect(result.errors.moneyNeeded).toBeDefined();
  });

  it('accepts "Not yet identified" as chairName, not treated as blank', () => {
    const result = validateProposalSubmission({ ...MINIMAL_VALID_SUBMISSION, chairName: "Not yet identified" });
    expect(result.valid).toBe(true);
    expect(result.errors.chairName).toBeUndefined();
  });
});

// ── 6. Tri-state coherence (via validateProposalSubmission) ─────────────
describe("validateProposalSubmission — money tri-state coherence", () => {
  it("fails when moneyNeeded='yes', estimatedCostCents=null, and estimatedCostUnknown=false", () => {
    const result = validateProposalSubmission({
      ...MINIMAL_VALID_SUBMISSION,
      moneyNeeded: "yes",
      estimatedCostCents: null,
      estimatedCostUnknown: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.estimatedCostCents).toBeDefined();
  });

  it("passes the same state when estimatedCostUnknown=true", () => {
    const result = validateProposalSubmission({
      ...MINIMAL_VALID_SUBMISSION,
      moneyNeeded: "yes",
      estimatedCostCents: null,
      estimatedCostUnknown: true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors.estimatedCostCents).toBeUndefined();
  });

  it("passes when moneyNeeded='yes' and a real estimatedCostCents value is given", () => {
    const result = validateProposalSubmission({
      ...MINIMAL_VALID_SUBMISSION,
      moneyNeeded: "yes",
      estimatedCostCents: 50000,
      estimatedCostUnknown: false,
    });
    expect(result.valid).toBe(true);
  });

  it("never requires the cost pair when moneyNeeded='no', regardless of its values", () => {
    const result = validateProposalSubmission({
      ...MINIMAL_VALID_SUBMISSION,
      moneyNeeded: "no",
      estimatedCostCents: null,
      estimatedCostUnknown: false,
    });
    expect(result.valid).toBe(true);
  });

  it("never requires the cost pair when moneyNeeded='not_sure', regardless of its values", () => {
    const result = validateProposalSubmission({
      ...MINIMAL_VALID_SUBMISSION,
      moneyNeeded: "not_sure",
      estimatedCostCents: null,
      estimatedCostUnknown: false,
    });
    expect(result.valid).toBe(true);
  });
});

// ── 7. isNoOpDecision() ──────────────────────────────────────────────────
describe("isNoOpDecision", () => {
  it("is true only when target status equals current status", () => {
    expect(isNoOpDecision("under_review", "under_review")).toBe(true);
    expect(isNoOpDecision("approved", "approved")).toBe(true);
    expect(isNoOpDecision("deferred", "deferred")).toBe(true);
  });

  it("is false for every other pair", () => {
    expect(isNoOpDecision("submitted", "under_review")).toBe(false);
    expect(isNoOpDecision("under_review", "approved")).toBe(false);
    expect(isNoOpDecision("under_review", "declined")).toBe(false);
    expect(isNoOpDecision("under_review", "deferred")).toBe(false);
    expect(isNoOpDecision("deferred", "under_review")).toBe(false);
  });

  it("is false for a status repeating a PRIOR (non-consecutive) value", () => {
    // deferred (Aug) -> under_review (Sep) -> deferred again (Oct): the
    // THIRD transition compares currentStatus='under_review' against
    // targetStatus='deferred' — not equal, so it is correctly not a no-op,
    // even though 'deferred' was the status two transitions ago.
    expect(isNoOpDecision("under_review", "deferred")).toBe(false);
  });
});

// ── B-42 regression: raw status enum leaked into the proposer's email ────
// Phase 6 found `decisionEmailHtml()` interpolating `proposal.status`
// directly, so the proposer's status-update email read "New status:
// under_review" — visible underscore, in the one sentence that email exists
// to deliver. These lock the label path.
describe("proposalStatusLabel — B-42", () => {
  it("renders every status as human-readable prose, never a raw enum", () => {
    for (const s of ["draft", "submitted", "under_review", "approved", "declined", "deferred"]) {
      const label = proposalStatusLabel(s);
      expect(label).not.toContain("_");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("maps the two multi-word statuses specifically", () => {
    expect(proposalStatusLabel("under_review")).toBe("Under Review");
    expect(proposalStatusLabel("submitted")).toBe("Submitted");
  });

  it("falls back to the raw value for an unknown status rather than throwing", () => {
    expect(proposalStatusLabel("nonsense")).toBe("nonsense");
  });
});

// ── HTML escaping in outbound proposal email ────────────────────────────
// The board notification goes to board@westervillelions.org — every board
// member at once — and interpolates member-typed free text. Unescaped, a
// stray "<" eats the rest of a line, and a deliberate anchor tag puts an
// arbitrary link inside an email that looks like it came from the club.
describe("escapeProposalHtml", () => {
  it("neutralises an injected anchor tag", () => {
    expect(escapeProposalHtml('<a href="http://evil.example">Donate here</a>')).toBe(
      "&lt;a href=&quot;http://evil.example&quot;&gt;Donate here&lt;/a&gt;",
    );
  });

  it("escapes ampersands first so existing entities are not double-decoded", () => {
    expect(escapeProposalHtml("Parks &amp; Rec")).toBe("Parks &amp;amp; Rec");
    expect(escapeProposalHtml("Parks & Rec")).toBe("Parks &amp; Rec");
  });

  it("leaves ordinary proposal prose untouched", () => {
    const plain = "Rudolph Run 5K - raise funds for the Foundation's youth programs";
    expect(escapeProposalHtml(plain)).toBe(plain);
  });

  it("escapes each dangerous character", () => {
    expect(escapeProposalHtml("<")).toBe("&lt;");
    expect(escapeProposalHtml(">")).toBe("&gt;");
    expect(escapeProposalHtml('"')).toBe("&quot;");
  });
});
