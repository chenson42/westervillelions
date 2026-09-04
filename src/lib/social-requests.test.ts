/**
 * Unit tests for src/lib/social-requests.ts
 *
 * Covers exactly the "Required Unit Tests" named in
 * docs/work-log/2026-09-03-social-media-requests.md's Phase 3 design doc.
 * All tests are pure (no DB) — vitest.config.ts runs environment: "node",
 * same as proposals.test.ts's precedent.
 */

import { describe, it, expect } from "vitest";
import {
  SOCIAL_REQUEST_STATUSES,
  isValidSocialRequestStatus,
  DECISION_TARGET_STATUSES,
  isValidDecisionTargetStatus,
  SOCIAL_REQUEST_PLATFORMS,
  isValidPlatform,
  isValidPlatformArray,
  isSocialRequestEditableByRequester,
  socialRequestVisibleTo,
  isNoOpDecision,
  validateSocialRequestSubmission,
  parseSocialRequestBody,
  socialRequestStatusLabel,
  socialRequestSubjectLine,
} from "@/lib/social-requests";

// ── fixture image bytes ───────────────────────────────────────────────────
// Minimal buffers matching validateMagicBytes()'s signature checks — not
// real decodable images, just enough bytes to exercise the magic-byte
// boundary (validateMagicBytes() only inspects the leading bytes).
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const NOT_AN_IMAGE_BYTES = Buffer.from("this is definitely not image data, just plain text", "utf-8");

const VALID_JPEG_DATA_URI = `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`;
const VALID_PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
// A data: URI whose MIME prefix claims PNG but whose decoded bytes are not
// a PNG at all — the exact spoofed-extension case validateMagicBytes()
// exists to catch.
const SPOOFED_PNG_DATA_URI = `data:image/png;base64,${NOT_AN_IMAGE_BYTES.toString("base64")}`;

// ── 1. isValidSocialRequestStatus() ─────────────────────────────────────
describe("isValidSocialRequestStatus", () => {
  it("accepts every value in the status vocabulary", () => {
    expect(SOCIAL_REQUEST_STATUSES).toEqual(["draft", "submitted", "under_review", "posted", "declined", "deferred"]);
    for (const status of SOCIAL_REQUEST_STATUSES) {
      expect(isValidSocialRequestStatus(status)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isValidSocialRequestStatus("approved")).toBe(false); // Proposals' terminal state, not this feature's
    expect(isValidSocialRequestStatus("Draft")).toBe(false);
    expect(isValidSocialRequestStatus("")).toBe(false);
  });
});

// ── 2. isValidDecisionTargetStatus() ─────────────────────────────────────
describe("isValidDecisionTargetStatus", () => {
  it("accepts under_review/posted/declined/deferred", () => {
    expect(DECISION_TARGET_STATUSES).toEqual(["under_review", "posted", "declined", "deferred"]);
    for (const status of DECISION_TARGET_STATUSES) {
      expect(isValidDecisionTargetStatus(status)).toBe(true);
    }
  });

  it("rejects draft and submitted — a decision route can never target either", () => {
    expect(isValidDecisionTargetStatus("draft")).toBe(false);
    expect(isValidDecisionTargetStatus("submitted")).toBe(false);
  });
});

// ── 3. isValidPlatform() / platform-array validator ──────────────────────
describe("isValidPlatform / isValidPlatformArray", () => {
  it("accepts exactly the SOCIAL_REQUEST_PLATFORMS values", () => {
    expect(SOCIAL_REQUEST_PLATFORMS).toEqual(["facebook", "instagram", "twitter_x", "linkedin", "other"]);
    for (const platform of SOCIAL_REQUEST_PLATFORMS) {
      expect(isValidPlatform(platform)).toBe(true);
    }
  });

  it("rejects an arbitrary platform string", () => {
    expect(isValidPlatform("tiktok")).toBe(false);
    expect(isValidPlatform("Facebook")).toBe(false);
  });

  it("accepts a mix of valid platform values", () => {
    expect(isValidPlatformArray(["facebook", "instagram"])).toBe(true);
  });

  it("rejects an array containing one invalid value", () => {
    expect(isValidPlatformArray(["facebook", "tiktok"])).toBe(false);
  });

  it("does not itself reject an empty array — that rule belongs only to submission validation", () => {
    expect(isValidPlatformArray([])).toBe(true);
  });
});

// ── 4. isSocialRequestEditableByRequester() ──────────────────────────────
describe("isSocialRequestEditableByRequester", () => {
  it("is true for draft and submitted", () => {
    expect(isSocialRequestEditableByRequester("draft")).toBe(true);
    expect(isSocialRequestEditableByRequester("submitted")).toBe(true);
  });

  it("is false for under_review, posted, declined, and deferred", () => {
    expect(isSocialRequestEditableByRequester("under_review")).toBe(false);
    expect(isSocialRequestEditableByRequester("posted")).toBe(false);
    expect(isSocialRequestEditableByRequester("declined")).toBe(false);
    expect(isSocialRequestEditableByRequester("deferred")).toBe(false);
  });
});

// ── 5. socialRequestVisibleTo() ───────────────────────────────────────────
describe("socialRequestVisibleTo", () => {
  it("a reviewer sees everything regardless of ownership", () => {
    expect(
      socialRequestVisibleTo({ requesterUserId: "user-1", viewerUserId: "user-2", viewerHasReviewAccess: true }),
    ).toBe(true);
  });

  it("a matching requesterUserId/viewerUserId pair is visible", () => {
    expect(
      socialRequestVisibleTo({ requesterUserId: "user-1", viewerUserId: "user-1", viewerHasReviewAccess: false }),
    ).toBe(true);
  });

  it("a null requesterUserId (deleted account) is never visible to a non-reviewer, even when viewerUserId is also null", () => {
    expect(
      socialRequestVisibleTo({ requesterUserId: null, viewerUserId: "user-2", viewerHasReviewAccess: false }),
    ).toBe(false);
    expect(
      socialRequestVisibleTo({ requesterUserId: null, viewerUserId: null, viewerHasReviewAccess: false }),
    ).toBe(false);
  });

  it("a mismatched pair is not visible", () => {
    expect(
      socialRequestVisibleTo({ requesterUserId: "user-1", viewerUserId: "user-2", viewerHasReviewAccess: false }),
    ).toBe(false);
  });

  it("is still true for a reviewer even when requesterUserId is null", () => {
    expect(
      socialRequestVisibleTo({ requesterUserId: null, viewerUserId: "user-2", viewerHasReviewAccess: true }),
    ).toBe(true);
  });
});

// ── 6. isNoOpDecision() ───────────────────────────────────────────────────
describe("isNoOpDecision", () => {
  it("rejects a same-status pair", () => {
    expect(isNoOpDecision("under_review", "under_review")).toBe(true);
    expect(isNoOpDecision("posted", "posted")).toBe(true);
    expect(isNoOpDecision("deferred", "deferred")).toBe(true);
  });

  it("allows a different-status pair", () => {
    expect(isNoOpDecision("submitted", "under_review")).toBe(false);
    expect(isNoOpDecision("under_review", "posted")).toBe(false);
    expect(isNoOpDecision("under_review", "declined")).toBe(false);
    expect(isNoOpDecision("under_review", "deferred")).toBe(false);
  });

  it("is correctly NOT a no-op for a status matching a PRIOR, non-consecutive value", () => {
    // deferred -> under_review -> deferred again: the third transition
    // compares currentStatus='under_review' against targetStatus='deferred'
    // — not equal, so it is correctly not a no-op.
    expect(isNoOpDecision("under_review", "deferred")).toBe(false);
  });
});

// ── 7. validateSocialRequestSubmission() ──────────────────────────────────
describe("validateSocialRequestSubmission", () => {
  it("rejects an empty platforms array", () => {
    const result = validateSocialRequestSubmission({ platforms: [], postCopy: "Come join us Saturday!" });
    expect(result.valid).toBe(false);
    expect(result.errors.platforms).toBeDefined();
  });

  it("rejects blank/whitespace postCopy", () => {
    const result = validateSocialRequestSubmission({ platforms: ["facebook"], postCopy: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.postCopy).toBeDefined();
  });

  it("accepts a minimal valid submission (one platform, non-blank copy, no image, no link, no date)", () => {
    const result = validateSocialRequestSubmission({ platforms: ["facebook"], postCopy: "Come join us Saturday!" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("does not treat a missing desiredPostDate as an error — no tri-state coherence check exists for this field", () => {
    // validateSocialRequestSubmission's input shape doesn't even carry
    // desiredPostDate, by design (see schema.ts doc comment) — a minimal
    // submission with no date-related fields at all is still valid.
    const result = validateSocialRequestSubmission({ platforms: ["instagram"], postCopy: "Reminder about the pancake breakfast" });
    expect(result.valid).toBe(true);
  });
});

// ── 8. parseSocialRequestBody() ──────────────────────────────────────────
describe("parseSocialRequestBody", () => {
  it("rejects a body containing status", () => {
    const { error } = parseSocialRequestBody({ status: "posted" });
    expect(error).toBeDefined();
  });

  it("rejects a body containing requesterUserId", () => {
    const { error } = parseSocialRequestBody({ requesterUserId: "user-1" });
    expect(error).toBeDefined();
  });

  it("rejects a body containing requesterMemberId", () => {
    const { error } = parseSocialRequestBody({ requesterMemberId: "member-1" });
    expect(error).toBeDefined();
  });

  it("accepts a valid platforms array", () => {
    const { fields, error } = parseSocialRequestBody({ platforms: ["facebook", "instagram"] });
    expect(error).toBeUndefined();
    expect(fields.platforms).toEqual(["facebook", "instagram"]);
  });

  it("rejects a platforms array containing an unknown value", () => {
    const { error } = parseSocialRequestBody({ platforms: ["facebook", "tiktok"] });
    expect(error).toBeDefined();
  });

  it("rejects a malformed desiredPostDate (not YYYY-MM-DD)", () => {
    const { error } = parseSocialRequestBody({ desiredPostDate: "09/15/2026" });
    expect(error).toBeDefined();
  });

  it("accepts a valid desiredPostDate", () => {
    const { fields, error } = parseSocialRequestBody({ desiredPostDate: "2026-09-15" });
    expect(error).toBeUndefined();
    expect(fields.desiredPostDate).toBe("2026-09-15");
  });

  it("rejects a linkUrl that isn't http:// or https://", () => {
    expect(parseSocialRequestBody({ linkUrl: "ftp://example.com/flyer.png" }).error).toBeDefined();
    expect(parseSocialRequestBody({ linkUrl: "javascript:alert(1)" }).error).toBeDefined();
    expect(parseSocialRequestBody({ linkUrl: "example.com" }).error).toBeDefined();
  });

  it("accepts a valid http(s) linkUrl", () => {
    const { fields, error } = parseSocialRequestBody({ linkUrl: "https://example.com/flyer.png" });
    expect(error).toBeUndefined();
    expect(fields.linkUrl).toBe("https://example.com/flyer.png");
  });

  it("rejects an imageDataUri exceeding the ~300KB cap", () => {
    const oversized = `data:image/png;base64,${"A".repeat(500_000)}`;
    const { error } = parseSocialRequestBody({ imageDataUri: oversized });
    expect(error).toBeDefined();
    expect(error).toMatch(/large/i);
  });

  it("rejects an imageDataUri whose decoded bytes fail validateMagicBytes() (spoofed PNG)", () => {
    const { error } = parseSocialRequestBody({ imageDataUri: SPOOFED_PNG_DATA_URI });
    expect(error).toBeDefined();
  });

  it("accepts a valid small fixture JPEG data URI", () => {
    const { fields, error } = parseSocialRequestBody({ imageDataUri: VALID_JPEG_DATA_URI });
    expect(error).toBeUndefined();
    expect(fields.imageDataUri).toBe(VALID_JPEG_DATA_URI);
  });

  it("accepts a valid small fixture PNG data URI", () => {
    const { fields, error } = parseSocialRequestBody({ imageDataUri: VALID_PNG_DATA_URI });
    expect(error).toBeUndefined();
    expect(fields.imageDataUri).toBe(VALID_PNG_DATA_URI);
  });

  it("trims and length-caps postCopy and notes", () => {
    const { fields } = parseSocialRequestBody({ postCopy: "  Hello world  ", notes: "  some notes  " });
    expect(fields.postCopy).toBe("Hello world");
    expect(fields.notes).toBe("some notes");
  });

  it("treats an absent imageDataUri key as 'leave unchanged' — no key, no field", () => {
    const { fields } = parseSocialRequestBody({ postCopy: "just text" });
    expect("imageDataUri" in fields).toBe(false);
  });
});

// ── 9. socialRequestStatusLabel() ─────────────────────────────────────────
describe("socialRequestStatusLabel", () => {
  it("returns the correct label per status, including posted (not approved)", () => {
    expect(socialRequestStatusLabel("draft")).toBe("Draft");
    expect(socialRequestStatusLabel("submitted")).toBe("Submitted");
    expect(socialRequestStatusLabel("under_review")).toBe("Under Review");
    expect(socialRequestStatusLabel("posted")).toBe("Posted");
    expect(socialRequestStatusLabel("declined")).toBe("Declined");
    expect(socialRequestStatusLabel("deferred")).toBe("Deferred");
  });

  it("falls back to the raw value for an unknown status rather than throwing", () => {
    expect(socialRequestStatusLabel("nonsense")).toBe("nonsense");
  });
});

// ── 10. socialRequestSubjectLine() ────────────────────────────────────────
describe("socialRequestSubjectLine", () => {
  it("truncates a long postCopy to the documented length with an ellipsis", () => {
    const long = "A".repeat(120);
    const result = socialRequestSubjectLine(long);
    expect(result.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis char
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to a fixed string for an empty/null postCopy", () => {
    expect(socialRequestSubjectLine(null)).toBe("your social media request");
    expect(socialRequestSubjectLine(undefined)).toBe("your social media request");
    expect(socialRequestSubjectLine("   ")).toBe("your social media request");
  });

  it("returns short postCopy unchanged", () => {
    expect(socialRequestSubjectLine("Pancake breakfast Saturday!")).toBe("Pancake breakfast Saturday!");
  });
});
