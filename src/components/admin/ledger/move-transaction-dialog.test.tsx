/**
 * T36: MoveTransactionDialog behavior (Phase 3 design). Node env, no jsdom:
 * each dialog state is rendered statically through MoveDialogBody and the
 * request, close and failure rules are tested as pure functions.
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

import {
  MoveDialogBody,
  type MoveDialogBodyProps,
  type MoveDialogPhase,
} from "./move-transaction-dialog";
import {
  buildMoveBody,
  isMoveSubmittable,
  moveFailureAction,
  resolveMoveClose,
  sweepDeepLink,
} from "./correction-dialog-logic";
import {
  MOVE_FAILED_MESSAGE,
  RATCHET_WARNING,
  STALE_MOVE_MESSAGE,
  parseMoveBody,
  type MovePreview,
  type MoveResponse,
} from "@/lib/ledger-correction";

const FROM = "a0000000-0000-4000-8000-000000000001";
const TO = "a0000000-0000-4000-8000-000000000002";
const CAT = "c0000000-0000-4000-8000-000000000009";
const TXN = "b0000000-0000-4000-8000-000000000001";

function preview(over: Partial<MovePreview> = {}): MovePreview {
  return {
    transaction: {
      id: TXN,
      txnDate: "2026-09-12",
      flow: "income",
      amountCents: 5000,
      party: "Test Donor",
      fiscalYear: 2027,
      reconciled: false,
      fundId: FROM,
      fundName: "Administrative Fund",
      fundKind: "administrative",
      categoryId: null,
      categoryName: null,
      bankAccountId: "x",
      bankAccountName: "Administrative Checking",
    },
    tier: { required: "record", reasons: [] },
    destinations: [
      {
        fundId: TO,
        name: "Activity Fund",
        kind: "activity",
        allowed: true,
        categories: [{ id: CAT, name: "Public donations" }],
        defaultCategoryId: CAT,
        impact: {
          sourceFund: { name: "Administrative Fund", beforeCents: 100000, afterCents: 95000 },
          destFund: { name: "Activity Fund", beforeCents: 20000, afterCents: 25000 },
          bankAccount: { name: "Administrative Checking", changeCents: 0 },
        },
      },
    ],
    warnings: [
      { code: "ratchet", message: RATCHET_WARNING },
      { code: "sweep_not_automatic", message: "Moving does not sweep anything." },
    ],
    reasonLimits: { min: 10, max: 500 },
    ...over,
  };
}

const noop = () => {};
function body(state: MoveDialogPhase, over: Partial<MoveDialogBodyProps> = {}) {
  return renderToStaticMarkup(
    <MoveDialogBody
      state={state}
      entitySlug="club"
      destFundId={TO}
      categoryId={CAT}
      reason=""
      submitting={false}
      inlineError={null}
      onDestChange={noop}
      onCategoryChange={noop}
      onReasonChange={noop}
      onConfirm={noop}
      onCancel={noop}
      onDone={noop}
      onRetryLoad={noop}
      {...over}
    />,
  );
}
const DISABLED = /\sdisabled=""/;
function submitTag(html: string): string | null {
  const m = /<button([^>]*type="submit"[^>]*)>/.exec(html);
  return m ? m[1] : null;
}

describe("MoveDialogBody states", () => {
  it("loading renders a status skeleton, no form", () => {
    const html = body({ phase: "loading" });
    expect(html).toContain('role="status"');
    expect(submitTag(html)).toBeNull();
  });

  it("a preview load error shows a retry and no Confirm", () => {
    const html = body({ phase: "load_error", message: "Something went wrong." });
    expect(html).toContain("Try again");
    expect(submitTag(html)).toBeNull();
  });

  it("a server refusal shows the server's message and no Confirm", () => {
    const html = body({ phase: "blocked", message: "Approved transactions cannot be moved." });
    expect(html).toContain("Approved transactions cannot be moved.");
    expect(submitTag(html)).toBeNull();
  });

  it("the form lists the destination, preselects the default category and shows the impact", () => {
    const html = body({ phase: "form", preview: preview() });
    expect(html).toContain("Activity Fund");
    expect(html).toContain(`<option value="${CAT}" selected="">Public donations</option>`);
    expect(html).toContain("Public donations");
    expect(html).toContain("What will change");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("$950.00");
    expect(html).toContain("Administrative Checking balance:");
    expect(html).toContain("unchanged");
    expect(html).toContain(RATCHET_WARNING);
    expect(html).toContain("Moving does not sweep anything.");
  });

  it("the server's warnings render as given, including a sent-statement notice", () => {
    const html = body({
      phase: "form",
      preview: preview({
        warnings: [
          { code: "ratchet", message: RATCHET_WARNING },
          { code: "sent_statement", message: "The Administrative statement for September 2026 was already sent." },
        ],
      }),
    });
    expect(html).toContain("The Administrative statement for September 2026 was already sent.");
  });

  it("Confirm is disabled without a valid reason and enabled with one, labelled with the destination", () => {
    const off = body({ phase: "form", preview: preview() }, { reason: "short" });
    expect(submitTag(off)).toMatch(DISABLED);
    const on = body({ phase: "form", preview: preview() }, { reason: "Booked to the wrong fund by mistake" });
    expect(submitTag(on)).not.toMatch(DISABLED);
    expect(on).toContain("Move to Activity Fund");
  });

  it("Confirm is disabled with no destination selected, and while submitting", () => {
    expect(
      submitTag(body({ phase: "form", preview: preview() }, { destFundId: "", reason: "valid reason here" })),
    ).toMatch(DISABLED);
    expect(
      submitTag(body({ phase: "form", preview: preview() }, { submitting: true, reason: "valid reason here" })),
    ).toMatch(DISABLED);
  });

  it("denied destinations are listed as text with their reason, not offered", () => {
    const p = preview();
    p.destinations.push({
      fundId: "a0000000-0000-4000-8000-000000000003",
      name: "Scholarship Fund",
      kind: "scholarship",
      allowed: false,
      denial: { code: "not_permitted", reason: "Income cannot be moved between these funds." },
    });
    const html = body({ phase: "form", preview: p });
    expect(html).toContain("Income cannot be moved between these funds.");
    expect(html).not.toContain('<option value="a0000000-0000-4000-8000-000000000003"');
  });

  it("an inline field error from a 400 is shown and the form stays", () => {
    const html = body(
      { phase: "form", preview: preview() },
      { inlineError: "Category is no longer active", reason: "valid reason here" },
    );
    expect(html).toContain("Category is no longer active");
    expect(submitTag(html)).not.toBeNull();
  });

  it("success shows 'Moved to ...' with a sweep link only when sweepSuggested", () => {
    const result: MoveResponse = {
      id: TXN,
      fundId: TO,
      fundSlug: "activity",
      fundName: "Activity Fund",
      categoryId: CAT,
      categoryName: "Public donations",
      sweepSuggested: true,
    };
    const html = body({ phase: "success", result });
    expect(html).toContain("Moved to Activity Fund.");
    expect(html).toContain("Record sweep now");
    expect(html).toContain(`href="/admin/ledger/activity?entity=club&amp;sweepFrom=${TXN}"`);
    expect(html).toContain(">Done<");

    const without = body({ phase: "success", result: { ...result, sweepSuggested: false } });
    expect(without).not.toContain("Record sweep now");
    expect(without).toContain(">Done<");
  });
});

describe("move request and close rules", () => {
  it("the request body is exactly the four keys the route accepts", () => {
    const b = buildMoveBody({ destFundId: TO, categoryId: CAT, reason: "valid reason here", expectedFundId: FROM });
    expect(Object.keys(b).sort()).toEqual(["categoryId", "destFundId", "expectedFundId", "reason"]);
    expect(parseMoveBody(JSON.parse(JSON.stringify(b))).ok).toBe(true);
  });

  it("'No category' is sent as null, never an empty string", () => {
    const b = buildMoveBody({ destFundId: TO, categoryId: "", reason: "valid reason here", expectedFundId: FROM });
    expect(b.categoryId).toBeNull();
    expect(parseMoveBody(b).ok).toBe(true);
  });

  it("isMoveSubmittable needs a destination and a valid reason", () => {
    expect(isMoveSubmittable({ destFundId: "", reason: "valid reason here" })).toBe(false);
    expect(isMoveSubmittable({ destFundId: TO, reason: "short" })).toBe(false);
    expect(isMoveSubmittable({ destFundId: TO, reason: "valid reason here" })).toBe(true);
  });

  it("refresh happens only when closing AFTER success, never on cancel or while submitting", () => {
    expect(resolveMoveClose({ nextOpen: false, phase: "success", submitting: false })).toEqual({
      proceed: true,
      refresh: true,
    });
    expect(resolveMoveClose({ nextOpen: false, phase: "form", submitting: false })).toEqual({
      proceed: true,
      refresh: false,
    });
    expect(resolveMoveClose({ nextOpen: false, phase: "form", submitting: true })).toEqual({
      proceed: false,
      refresh: false,
    });
    expect(resolveMoveClose({ nextOpen: true, phase: "success", submitting: false }).refresh).toBe(false);
  });

  it("the source calls router.refresh only through resolveMoveClose or a failure close", () => {
    const src = readFileSync(join(__dirname, "move-transaction-dialog.tsx"), "utf8");
    const occurrences = src.match(/router\.refresh\(\)/g) ?? [];
    expect(occurrences.length).toBe(2); // close-after-success and 403/404/409 failure
    expect(src).not.toMatch(/window\.(confirm|alert|prompt)|\bconfirm\(|\balert\(|\bprompt\(/);
  });

  it("403/404/409 toast + close + refresh; 400 inline; 5xx retry with the fixed message", () => {
    expect(moveFailureAction(409, { error: STALE_MOVE_MESSAGE, code: "stale" })).toEqual({
      mode: "close_and_refresh",
      message: STALE_MOVE_MESSAGE,
    });
    expect(moveFailureAction(403, { error: "Moving a reconciled or prior-year entry needs the Manage Ledger permission." }).mode).toBe(
      "close_and_refresh",
    );
    expect(moveFailureAction(404, { error: "Transaction not found" }).mode).toBe("close_and_refresh");
    expect(moveFailureAction(400, { error: "Reason must be at least 10 characters." })).toEqual({
      mode: "inline",
      message: "Reason must be at least 10 characters.",
    });
    expect(moveFailureAction(500, { error: "boom" })).toEqual({ mode: "retry", message: MOVE_FAILED_MESSAGE });
    expect(moveFailureAction(409, null).message).toBe(MOVE_FAILED_MESSAGE);
  });

  it("the sweep deep link carries the entity and the moved row id", () => {
    expect(sweepDeepLink({ fundSlug: "activity", entitySlug: "club", transactionId: TXN })).toBe(
      `/admin/ledger/activity?entity=club&sweepFrom=${TXN}`,
    );
  });
});
