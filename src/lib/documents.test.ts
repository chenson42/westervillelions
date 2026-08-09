/**
 * Unit tests for src/lib/documents.ts — pure constants/validators and
 * diffDocumentVersions(). No DB, no mocks; vitest.config.ts runs
 * `environment: "node"` so this is directly testable.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3
 * "Unit Tests for Phase 4", items 1-6.
 */

import { describe, it, expect } from "vitest";
import {
  isValidDocumentVisibility,
  isValidChangeType,
  diffDocumentVersions,
} from "./documents";

describe("isValidDocumentVisibility()", () => {
  it("accepts 'public' and 'members'", () => {
    expect(isValidDocumentVisibility("public")).toBe(true);
    expect(isValidDocumentVisibility("members")).toBe(true);
  });

  it("rejects 'private' and an empty string", () => {
    expect(isValidDocumentVisibility("private")).toBe(false);
    expect(isValidDocumentVisibility("")).toBe(false);
  });
});

describe("isValidChangeType()", () => {
  it("accepts 'editorial' and 'substantive'", () => {
    expect(isValidChangeType("editorial")).toBe(true);
    expect(isValidChangeType("substantive")).toBe(true);
  });

  it("rejects 'major' and an empty string", () => {
    expect(isValidChangeType("major")).toBe(false);
    expect(isValidChangeType("")).toBe(false);
  });
});

describe("diffDocumentVersions()", () => {
  it("on identical input, returns a single unchanged chunk — no spurious diff noise", () => {
    const text = "Article I\nSection A\nSection B\n";
    const result = diffDocumentVersions(text, text);

    expect(result).toHaveLength(1);
    expect(result[0].added).toBeFalsy();
    expect(result[0].removed).toBeFalsy();
    expect(result[0].value).toBe(text);
  });

  it("detects a single changed line as exactly one removed + one added chunk (line-level, not word/char-level)", () => {
    const oldText = "Article I\nDues shall be $60.00 per year.\nArticle II\n";
    const newText = "Article I\nDues shall be $127.00 per year.\nArticle II\n";

    const result = diffDocumentVersions(oldText, newText);
    const removed = result.filter((c) => c.removed);
    const added = result.filter((c) => c.added);

    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0].value).toBe("Dues shall be $60.00 per year.\n");
    expect(added[0].value).toBe("Dues shall be $127.00 per year.\n");
  });

  it("is stable across a trailing-newline-only difference — no spurious extra chunk", () => {
    const withTrailingNewline = "Article I\nSection A\nSection B\n";
    const withoutTrailingNewline = "Article I\nSection A\nSection B";

    const result = diffDocumentVersions(withTrailingNewline, withoutTrailingNewline);
    const changed = result.filter((c) => c.added || c.removed);

    // Only the last line's trailing newline differs — this must never
    // surface as a change anywhere in "Article I" / "Section A", and must
    // collapse to at most one changed region (removed+added pair, or none).
    expect(changed.length).toBeLessThanOrEqual(2);
    for (const chunk of changed) {
      expect(chunk.value.trim()).toBe("Section B");
    }
  });

  it("against a full 642-line document with exactly one line changed in the middle, produces exactly one changed region and leaves every other line in the surrounding unchanged chunk(s)", () => {
    const lineCount = 642;
    const lines = Array.from({ length: lineCount }, (_, i) => `Line ${i + 1} of the governing document.`);
    const oldDoc = lines.join("\n") + "\n";

    const changedLineIndex = 320; // an arbitrary line well inside the document
    const changedLines = [...lines];
    changedLines[changedLineIndex] = "Line 321 of the governing document — AMENDED BY THE BOARD.";
    const newDoc = changedLines.join("\n") + "\n";

    const result = diffDocumentVersions(oldDoc, newDoc);
    const removed = result.filter((c) => c.removed);
    const added = result.filter((c) => c.added);

    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0].value).toBe(lines[changedLineIndex] + "\n");
    expect(added[0].value).toBe(changedLines[changedLineIndex] + "\n");

    // Every other line must survive untouched — the whole doc minus the one
    // changed line must be exactly reconstructable from the unchanged chunks.
    const unchanged = result.filter((c) => !c.added && !c.removed);
    const unchangedJoined = unchanged.map((c) => c.value).join("");
    for (let i = 0; i < lineCount; i++) {
      if (i === changedLineIndex) continue;
      expect(unchangedJoined).toContain(lines[i] + "\n");
    }
    // No line's text was silently dropped or misattributed: total chunk
    // count stays small (one unchanged-before, one removed, one added, one
    // unchanged-after — at most 4), not fragmented across the document.
    expect(result.length).toBeLessThanOrEqual(4);
  });
});
