/**
 * Tests for ReconciliationDiscardButton (Phase 3 C1-C3). Node env, no jsdom:
 * pure exported helpers plus renderToStaticMarkup.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ReconciliationDiscardButton, {
  buildDiscardDescription,
  discardResponseAction,
} from "./reconciliation-discard-button";

const base = { periodLabel: "Aug 1, 2026 – Aug 31, 2026", accountName: "Chase Checking" };

describe("buildDiscardDescription", () => {
  it("includes period, account, counts and the can't-be-undone line", () => {
    const t = buildDiscardDescription({ ...base, bankLineCount: 42, matchCount: 17 });
    expect(t).toContain(base.periodLabel);
    expect(t).toContain(base.accountName);
    expect(t).toContain("42 uploaded statement lines");
    expect(t).toContain("17 matches");
    expect(t).toContain("can't be undone");
    expect(t).toContain("created from a bank line");
  });

  it("uses singular wording", () => {
    const t = buildDiscardDescription({ ...base, bankLineCount: 1, matchCount: 1 });
    expect(t).toContain("1 uploaded statement line and 1 match.");
  });

  it("says 'no matches' when there are none", () => {
    const t = buildDiscardDescription({ ...base, bankLineCount: 5, matchCount: 0 });
    expect(t).toContain("and no matches");
  });

  it("zero lines: no counts clause and no created-transactions warning", () => {
    const t = buildDiscardDescription({ ...base, bankLineCount: 0, matchCount: 0 });
    expect(t).toContain("Nothing has been uploaded to it yet");
    expect(t).not.toContain("0 uploaded statement lines");
    expect(t).not.toContain("created from a bank line");
    expect(t).toContain("can't be undone");
  });
});

describe("discardResponseAction", () => {
  it("200 -> success toast with server counts, push to list", () => {
    const a = discardResponseAction(200, { bankLineCount: 42, matchCount: 17 });
    expect(a.toast).toEqual({
      kind: "success",
      message: "Session discarded. 42 statement lines and 17 matches removed.",
    });
    expect(a.navigate).toBe("push-list");
  });

  it("200 with zero counts drops the clause", () => {
    expect(discardResponseAction(200, { bankLineCount: 0, matchCount: 0 }).toast.message).toBe(
      "Session discarded.",
    );
  });

  it("404 -> info toast, push to list", () => {
    const a = discardResponseAction(404, { error: "Session not found" });
    expect(a.toast.kind).toBe("info");
    expect(a.navigate).toBe("push-list");
  });

  it("409 -> error toast with server message, refresh", () => {
    const a = discardResponseAction(409, { error: "This session is closed — reopen it before discarding it." });
    expect(a.toast).toEqual({
      kind: "error",
      message: "This session is closed — reopen it before discarding it.",
    });
    expect(a.navigate).toBe("refresh");
  });

  it("403 / 500 -> error toast, no navigation", () => {
    const a = discardResponseAction(403, { error: "Forbidden" });
    expect(a.toast).toEqual({ kind: "error", message: "Forbidden" });
    expect(a.navigate).toBe("none");
    const b = discardResponseAction(500, null);
    expect(b.toast.message).toBe("Could not discard the session. Try again.");
    expect(b.navigate).toBe("none");
  });
});

describe("ReconciliationDiscardButton", () => {
  it("renders the trigger with brand-compliant classes and no open dialog", () => {
    const html = renderToStaticMarkup(
      <ReconciliationDiscardButton
        sessionId="s1"
        {...base}
        bankLineCount={3}
        matchCount={1}
      />,
    );
    expect(html).toContain("Discard session");
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("rounded-lg");
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("lions-red");
    expect(html).not.toContain("Discard this session?");
  });

  it("source uses a destructive ConfirmDialog and no native dialogs", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/admin/ledger/reconciliation-discard-button.tsx"),
      "utf8",
    );
    expect(src).toContain("<ConfirmDialog");
    expect(src).toMatch(/\bdestructive\b/);
    expect(src).not.toContain("window.confirm");
    expect(src).not.toMatch(/\b(?:alert|prompt)\(/);
  });
});
