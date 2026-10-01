/**
 * T35: DeleteTransactionDialog behavior (Phase 3 design). Node env, no jsdom:
 * the presentational body is rendered statically and the request/failure
 * logic is tested as pure functions.
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

import { DeleteDialogBody, type DeleteDialogBodyProps } from "./delete-transaction-dialog";
import { deleteFailureAction, isDeleteSubmittable } from "./correction-dialog-logic";
import { RECEIPT_SENT_MESSAGE } from "@/lib/ledger-correction";

const noop = () => {};
function body(over: Partial<DeleteDialogBodyProps> = {}) {
  return renderToStaticMarkup(
    <DeleteDialogBody
      isTransfer={false}
      ackStatus={null}
      summary="2026-09-12 · Test Donor · +$50.00"
      reason=""
      submitting={false}
      error={null}
      receiptSent={false}
      onReasonChange={noop}
      onConfirm={noop}
      onCancel={noop}
      {...over}
    />,
  );
}
const DISABLED = /\sdisabled=""/;
function submitTag(html: string): string | null {
  const m = /<button([^>]*type="submit"[^>]*)>/.exec(html);
  return m ? m[1] : null;
}

describe("DeleteDialogBody", () => {
  it("Confirm is disabled until the reason is valid", () => {
    expect(submitTag(body({ reason: "" }))).toMatch(DISABLED);
    expect(submitTag(body({ reason: "too short" }))).toMatch(DISABLED); // 9 chars
    expect(submitTag(body({ reason: "entered twice by mistake" }))).not.toMatch(DISABLED);
  });

  it("renders the required reason field with a label and the static what-else list", () => {
    const html = body();
    expect(html).toContain('for="delete-reason"');
    expect(html).toContain("This cannot be undone");
    expect(html).toContain("open reconciliation session");
    expect(html).not.toContain("unsent acknowledgment");
  });

  it("warns about the unsent acknowledgment when ackStatus is pending", () => {
    const html = body({ ackStatus: "pending" });
    expect(html).toContain("unsent acknowledgment letter record");
    expect(html).toContain('for="delete-reason"');
  });

  it("ackStatus sent hides the reason field and the Confirm button and shows the 409 text", () => {
    const html = body({ ackStatus: "sent" });
    expect(html).not.toContain('for="delete-reason"');
    expect(submitTag(html)).toBeNull();
    expect(html).toContain(RECEIPT_SENT_MESSAGE);
    expect(html).toContain(">Close<");
  });

  it("a receipt_sent race from the server flips the same blocked state", () => {
    const html = body({ receiptSent: true, error: RECEIPT_SENT_MESSAGE, reason: "entered twice by mistake" });
    expect(submitTag(html)).toBeNull();
    expect(html).not.toContain('for="delete-reason"');
  });

  it("shows a server error inline and keeps the form (and Confirm) available", () => {
    const html = body({ error: "Approved transactions cannot be deleted", reason: "entered twice by mistake" });
    expect(html).toContain("Approved transactions cannot be deleted");
    expect(submitTag(html)).not.toBeNull();
  });

  it("a transfer says both entries are deleted and uses the destructive label", () => {
    const html = body({ isTransfer: true });
    expect(html).toContain("both entries of the transfer");
    expect(html).toContain("Delete transfer");
    expect(html).toContain("bg-red-600");
  });
});

describe("delete logic", () => {
  it("isDeleteSubmittable mirrors the shared reason limits", () => {
    expect(isDeleteSubmittable({ reason: "   " })).toBe(false);
    expect(isDeleteSubmittable({ reason: "x".repeat(10) })).toBe(true);
    expect(isDeleteSubmittable({ reason: "x".repeat(501) })).toBe(false);
  });

  it("409 receipt_sent is recognised and carries the server message", () => {
    expect(deleteFailureAction(409, { error: RECEIPT_SENT_MESSAGE, code: "receipt_sent" })).toEqual({
      message: RECEIPT_SENT_MESSAGE,
      receiptSent: true,
    });
  });

  it("other failures surface the server message without flipping the blocked state", () => {
    expect(deleteFailureAction(403, { error: "Rejected transactions cannot be deleted" })).toEqual({
      message: "Rejected transactions cannot be deleted",
      receiptSent: false,
    });
    expect(deleteFailureAction(500, null).message).toContain("Nothing was changed");
  });
});

describe("DeleteTransactionDialog source", () => {
  const src = readFileSync(join(__dirname, "delete-transaction-dialog.tsx"), "utf8");
  it("sends the reason as a JSON body and never uses a native dialog", () => {
    expect(src).toContain('method: "DELETE"');
    expect(src).toContain("JSON.stringify({ reason })");
    expect(src).not.toMatch(/window\.(confirm|alert|prompt)|\bconfirm\(|\balert\(|\bprompt\(/);
  });
  it("does not close or refresh on a failed delete (only after res.ok)", () => {
    const failBranch = src.slice(src.indexOf("if (!res.ok)"), src.indexOf("const result = data"));
    expect(failBranch).not.toContain("onOpenChange(false)");
    expect(failBranch).not.toContain("router.refresh");
  });
});
