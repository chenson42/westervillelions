/** B-172 Increment 2b, B3/B9: the batch dialog's body and its void refusals. Node env, static markup. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { SweepBatchDialogBody, type SweepBatchDialogBodyProps } from "./sweep-batch-dialog";
import { detailBatchState, voidFailure, voidSuccessMessage, SWEEP_BATCH_LOAD_ERROR } from "./sweep-batch-dialog-logic";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";
import {
  SWEEP_VOID_BLOCK_COPY,
  sweepBatchNextStep,
  type SweepBatchDetail,
  type SweepVoidBlock,
} from "@/lib/ledger-sweep";

const LABELS = { ...DEFAULT_FUND_LABELS, activity: "Community Money" };
const LEG = "11111111-1111-4111-8111-111111111111";

function detail(over: Partial<SweepBatchDetail> = {}): SweepBatchDetail {
  return {
    legId: LEG,
    status: "posted",
    sweepDate: "2026-10-12",
    boardMinute: "Motion passed Oct 2026",
    recordedBy: "Sam Example",
    count: 3,
    totalCents: 31000,
    byCategory: [{ name: "Public donations", count: 3, cents: 31000 }],
    fiscalYears: [2026],
    approved: false,
    reconciled: false,
    earliestGiftDate: "2026-09-02",
    latestGiftDate: "2026-09-28",
    ...over,
  };
}

function body(over: Partial<SweepBatchDialogBodyProps> = {}) {
  const props: SweepBatchDialogBodyProps = {
    phase: "loaded",
    detail: detail(),
    labels: LABELS,
    canManage: true,
    voiding: false,
    reason: "",
    submitting: false,
    failure: null,
    onStartVoid: () => {},
    onReasonChange: () => {},
    onConfirmVoid: () => {},
    onCancelVoid: () => {},
    onClose: () => {},
    ...over,
  };
  return renderToStaticMarkup(<SweepBatchDialogBody {...props} />);
}
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("SweepBatchDialogBody states", () => {
  it("loading shows a labelled skeleton and no summary", () => {
    const html = body({ phase: "loading", detail: null });
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the batch");
    expect(html).not.toContain("sweep-batch-summary");
  });

  it("error says so in human words and offers Close", () => {
    const html = body({ phase: "error", detail: null });
    expect(text(html)).toContain(SWEEP_BATCH_LOAD_ERROR);
    expect(html).toContain(">Close<");
  });

  it("pending: names the state, the carrier's next step, links to Approvals, and offers no Void", () => {
    const html = body({ detail: detail({ status: "pending" }) });
    const t = text(html);
    expect(t).toContain("Waiting for board approval");
    expect(t).toContain(sweepBatchNextStep("pending"));
    expect(html).toContain(`/admin/ledger/approvals?txn=${LEG}`);
    expect(html).not.toContain("Void this batch");
  });

  it("posted: a manager sees Void this batch; the carrier's next step shows", () => {
    const html = body();
    const t = text(html);
    expect(t).toContain("Posted");
    expect(t).toContain(sweepBatchNextStep("posted"));
    expect(html).toContain("Void this batch");
    expect(t).toContain("Itemized sweep: 3 gifts");
  });

  it("posted: a viewer without Manage Ledger sees the summary and no Void", () => {
    const html = body({ canManage: false });
    expect(html).not.toContain("Void this batch");
    expect(text(html)).toContain("Itemized sweep: 3 gifts");
  });

  it("approved: locked wording from the carrier and no Void even for a manager", () => {
    const html = body({ detail: detail({ approved: true }) });
    expect(text(html)).toContain("Approved by the board");
    expect(text(html)).toContain(sweepBatchNextStep("approved"));
    expect(html).not.toContain("Void this batch");
  });

  it("rejected: kept as a record, no Void", () => {
    const html = body({ detail: detail({ status: "rejected" }) });
    expect(text(html)).toContain(sweepBatchNextStep("rejected"));
    expect(html).not.toContain("Void this batch");
  });

  it("reconciled: says an entry cleared a bank statement, in the carrier's words", () => {
    const html = body({ detail: detail({ reconciled: true }) });
    const c = SWEEP_VOID_BLOCK_COPY.reconciled(LABELS);
    expect(text(html)).toContain(c.message);
    expect(text(html)).toContain(c.nextStep);
  });

  it("the void form needs a reason of the right length before the button enables, and says what is removed", () => {
    const empty = body({ voiding: true, reason: "" });
    expect(empty).toMatch(/<button type="submit"[^>]*\sdisabled=""/);
    expect(text(empty)).toContain("This cannot be undone");
    expect(text(empty)).toContain("all 3 copies");
    expect(text(empty)).toContain("Do not type a donor's name");
    const ok = body({ voiding: true, reason: "Entered against the wrong bank deposit" });
    expect(ok).not.toMatch(/<button type="submit"[^>]*\sdisabled=""/);
    const busy = body({ voiding: true, reason: "Entered against the wrong bank deposit", submitting: true });
    expect(text(busy)).toContain("Voiding");
  });
});

describe("every SweepVoidBlock renders its message and next step (B3)", () => {
  const BLOCKS = Object.keys(SWEEP_VOID_BLOCK_COPY) as SweepVoidBlock[];

  it("covers all ten codes", () => {
    expect(BLOCKS.sort()).toEqual(
      ["already_rejected", "approved", "matched", "not_a_sweep", "not_found", "pending_use_reject", "period_filed", "prior_fiscal_year", "receipt_sent", "reconciled"],
    );
  });

  it.each(BLOCKS)("%s: voidFailure returns the carrier's text and the dialog shows both", (code) => {
    const f = voidFailure(409, { error: "x", code }, LABELS);
    const c = SWEEP_VOID_BLOCK_COPY[code](LABELS);
    expect(f.message).toBe(c.message);
    expect(f.nextStep).toBe(c.nextStep);
    const t = text(body({ voiding: true, reason: "Entered against the wrong bank deposit", failure: f }));
    expect(t).toContain(c.message);
    expect(t).toContain(c.nextStep);
  });

  it("a refusal that arrives after the form closed still reads", () => {
    const f = voidFailure(409, { error: "x", code: "approved" }, LABELS);
    const t = text(body({ voiding: false, failure: f }));
    expect(t).toContain(SWEEP_VOID_BLOCK_COPY.approved(LABELS).message);
  });

  it("a state that moved under the viewer asks for a refresh; a data refusal does not", () => {
    for (const code of ["pending_use_reject", "already_rejected", "approved", "not_found"] as const) {
      expect(voidFailure(409, { code }, LABELS).refresh).toBe(true);
    }
    for (const code of ["reconciled", "matched", "receipt_sent", "prior_fiscal_year", "period_filed"] as const) {
      expect(voidFailure(409, { code }, LABELS).refresh).toBe(false);
    }
    expect(voidFailure(404, { code: "not_found" }, LABELS).refresh).toBe(true);
  });

  it("an unknown 409 body, a 400 reason_required, a 500 and a network error are handled", () => {
    expect(voidFailure(409, null, LABELS).message).toBe(SWEEP_VOID_BLOCK_COPY.not_found(LABELS).message);
    expect(voidFailure(400, { error: "Give a reason of 10 to 500 characters.", code: "reason_required" }, LABELS)).toEqual({
      message: "Give a reason of 10 to 500 characters.",
      nextStep: null,
      refresh: false,
    });
    expect(voidFailure(500, { error: "Could not void" }, LABELS).message).toContain("Nothing was changed");
    expect(voidFailure(null, null, LABELS).message).toContain("Nothing was changed");
  });
});

describe("pure helpers", () => {
  it("detailBatchState follows status and approval", () => {
    expect(detailBatchState({ status: "pending", approved: false })).toBe("pending");
    expect(detailBatchState({ status: "posted", approved: false })).toBe("posted");
    expect(detailBatchState({ status: "posted", approved: true })).toBe("approved");
    expect(detailBatchState({ status: "rejected", approved: false })).toBe("rejected");
  });

  it("voidSuccessMessage counts gifts", () => {
    expect(voidSuccessMessage(3)).toBe("Batch voided. 3 gifts are free to sweep again.");
    expect(voidSuccessMessage(1)).toBe("Batch voided. 1 gift is free to sweep again.");
  });
});

describe("source rules", () => {
  it("no native dialogs, a shell dialog for the form, and no fund name literal", () => {
    for (const file of ["sweep-batch-dialog.tsx", "sweep-batch-dialog-logic.ts", "sweep-batch-button.tsx", "sweep-row-chip.tsx", "sweep-batch-summary.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/);
      expect(src).not.toMatch(/\bPublic Funds\b|\bActivity\b/);
      expect(src).not.toContain("console.log");
    }
    expect(readFileSync(join(__dirname, "sweep-batch-dialog.tsx"), "utf8")).toContain("LedgerDialogShell");
  });

  it("the dialog reaches the server only through the detail and void routes, never a gift list", () => {
    const src = readFileSync(join(__dirname, "sweep-batch-dialog.tsx"), "utf8");
    const urls = [...src.matchAll(/`(\/api\/[^`]+)`/g)].map((m) => m[1]);
    expect(urls).toEqual([
      "/api/admin/ledger/sweep-batches/${encodeURIComponent(legId)}",
      "/api/admin/ledger/sweep-batches/${encodeURIComponent(legId)}/void",
    ]);
  });
});
