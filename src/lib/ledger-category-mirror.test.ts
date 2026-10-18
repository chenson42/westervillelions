import { describe, it, expect } from "vitest";
import {
  MIRROR_COPY,
  checkCategoryMirror,
  describeMirrorHint,
  mirrorErrorMessage,
  mirrorHintCopy,
  mirroredFlagEditBlocked,
  type MirrorCategoryFacts,
  type MirrorErrorCode,
  type MirrorTargetFacts,
} from "./ledger-category-mirror";
import { ACK_MIN_CENTS } from "./ledger";

const subject: MirrorCategoryFacts = {
  id: "s",
  fundKind: "activity",
  flow: "income",
  entityDonationsDeductible: false,
};
const target: MirrorTargetFacts = {
  id: "t",
  fundKind: "charitable",
  flow: "income",
  entityDonationsDeductible: true,
  isActive: true,
};

describe("checkCategoryMirror", () => {
  it("a Club activity income subject with an active Foundation charitable income target is valid", () => {
    expect(checkCategoryMirror(subject, target)).toEqual({ ok: true });
  });

  it("null clears, whatever the subject", () => {
    expect(checkCategoryMirror(subject, null)).toEqual({ ok: true });
    expect(checkCategoryMirror({ ...subject, flow: "expense" }, null)).toEqual({ ok: true });
  });

  it.each([
    ["Club activity expense", { flow: "expense" }],
    ["Club administrative income", { fundKind: "administrative" }],
    ["a Foundation category", { entityDonationsDeductible: true, fundKind: "charitable" }],
  ])("%s as subject is refused", (_label, over) => {
    expect(checkCategoryMirror({ ...subject, ...over }, target)).toEqual({
      ok: false,
      code: "subject_not_public_income",
    });
  });

  it.each([
    ["an expense category", { flow: "expense" }],
    ["a scholarship category", { fundKind: "scholarship" }],
    ["a Club category", { entityDonationsDeductible: false }],
    ["an activity category", { fundKind: "activity" }],
  ])("%s as target is refused", (_label, over) => {
    expect(checkCategoryMirror(subject, { ...target, ...over })).toEqual({
      ok: false,
      code: "target_not_foundation_income",
    });
  });

  it("an inactive target is refused", () => {
    expect(checkCategoryMirror(subject, { ...target, isActive: false })).toEqual({
      ok: false,
      code: "target_inactive",
    });
  });

  it("itself is refused", () => {
    expect(checkCategoryMirror(subject, { ...target, id: subject.id })).toEqual({
      ok: false,
      code: "target_is_self",
    });
  });
});

describe("mirroredFlagEditBlocked", () => {
  const stored = { countsAsGiving: true, ackNotRequired: false };
  it("a stored mirror blocks a changed flag", () => {
    expect(
      mirroredFlagEditBlocked({ storedMirrorId: "t", patchMirrorId: undefined, stored, patch: { countsAsGiving: false } }),
    ).toBe(true);
    expect(
      mirroredFlagEditBlocked({ storedMirrorId: "t", patchMirrorId: undefined, stored, patch: { ackNotRequired: true } }),
    ).toBe(true);
  });
  it("repeating the stored value is a no-op, not an error", () => {
    expect(
      mirroredFlagEditBlocked({
        storedMirrorId: "t",
        patchMirrorId: undefined,
        stored,
        patch: { countsAsGiving: true, ackNotRequired: false },
      }),
    ).toBe(false);
  });
  it("clearing the mirror in the same request allows the flag change; setting one does not", () => {
    expect(
      mirroredFlagEditBlocked({ storedMirrorId: "t", patchMirrorId: null, stored, patch: { countsAsGiving: false } }),
    ).toBe(false);
    expect(
      mirroredFlagEditBlocked({ storedMirrorId: null, patchMirrorId: "t", stored, patch: { countsAsGiving: false } }),
    ).toBe(true);
  });
  it("no mirror at all never blocks", () => {
    expect(
      mirroredFlagEditBlocked({ storedMirrorId: null, patchMirrorId: undefined, stored, patch: { countsAsGiving: false } }),
    ).toBe(false);
  });
});

describe("describeMirrorHint", () => {
  const mirror = { name: "Public donations", isActive: true, ackNotRequired: false };
  it("not_applicable for anything but Club public income, or no category", () => {
    expect(describeMirrorHint(null, null)).toEqual({ state: "not_applicable" });
    expect(describeMirrorHint({ ...subject, flow: "expense" }, mirror)).toEqual({ state: "not_applicable" });
    expect(describeMirrorHint({ ...subject, fundKind: "administrative" }, mirror)).toEqual({ state: "not_applicable" });
  });
  it("stays when there is no counterpart, or it is inactive", () => {
    expect(describeMirrorHint(subject, null)).toEqual({ state: "stays", reason: "no_mirror" });
    expect(describeMirrorHint(subject, { ...mirror, isActive: false })).toEqual({
      state: "stays",
      reason: "mirror_inactive",
    });
  });
  it("bound: a receipt may be needed unless the counterpart is ack-exempt", () => {
    expect(describeMirrorHint(subject, mirror)).toEqual({
      state: "bound",
      foundationCategoryName: "Public donations",
      receipt: "may_be_needed",
    });
    expect(describeMirrorHint(subject, { ...mirror, ackNotRequired: true })).toMatchObject({ receipt: "not_needed" });
  });
  it("bound: an amount under the written-acknowledgment threshold needs no receipt; at the threshold it may", () => {
    expect(describeMirrorHint(subject, mirror, ACK_MIN_CENTS - 1)).toMatchObject({ receipt: "not_needed" });
    expect(describeMirrorHint(subject, mirror, ACK_MIN_CENTS)).toMatchObject({ receipt: "may_be_needed" });
    expect(describeMirrorHint(subject, mirror, null)).toMatchObject({ receipt: "may_be_needed" });
  });
});

describe("copy", () => {
  const ALL_CODES: MirrorErrorCode[] = [
    "subject_not_public_income",
    "target_not_foundation_income",
    "target_inactive",
    "target_is_self",
    "invalid_mirror",
    "mirror_target_not_found",
    "mirrored_flag_read_only",
    "mirror_conflict",
  ];
  it("MIRROR_COPY covers every code with non-empty text and never prints Activity", () => {
    expect(Object.keys(MIRROR_COPY).sort()).toEqual([...ALL_CODES].sort());
    for (const code of ALL_CODES) {
      const text = mirrorErrorMessage(code);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\bActivity\b/);
    }
  });
  it("uses the supplied fund name", () => {
    const labels = { administrative: "A", activity: "Community Pool", charitable: "C", scholarship: "S" };
    expect(mirrorErrorMessage("subject_not_public_income", labels)).toContain("Community Pool");
  });
  it("every hint state has copy, null only for not_applicable", () => {
    expect(mirrorHintCopy({ state: "not_applicable" })).toBeNull();
    expect(mirrorHintCopy({ state: "stays", reason: "no_mirror" })).toContain("staying in Public Funds");
    expect(mirrorHintCopy({ state: "stays", reason: "mirror_inactive" })).toContain("deactivated");
    expect(mirrorHintCopy({ state: "bound", foundationCategoryName: "X", receipt: "may_be_needed" })).toContain(
      "a written receipt will be needed",
    );
    expect(mirrorHintCopy({ state: "bound", foundationCategoryName: "X", receipt: "not_needed" })).toContain(
      "No written acknowledgment is required",
    );
  });
});
