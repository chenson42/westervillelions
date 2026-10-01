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
const CLUB = { id: "e0000000-0000-4000-8000-000000000001", slug: "club", name: "Club" };

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
      entity: CLUB,
      donorId: null,
      receipt: "none",
    },
    callerCanManage: false,
    destinations: [
      {
        fundId: TO,
        name: "Activity Fund",
        kind: "activity",
        entity: CLUB,
        crossEntity: false,
        tier: { required: "record", reasons: [] },
        allowed: true,
        categories: [{ id: CAT, name: "Public donations" }],
        defaultCategoryId: CAT,
        warnings: [
          { code: "ratchet", message: RATCHET_WARNING },
          { code: "sweep_not_automatic", message: "Moving does not sweep anything." },
        ],
        impact: {
          crossEntity: false,
          sourceFund: { name: "Administrative Fund", beforeCents: 100000, afterCents: 95000 },
          destFund: { name: "Activity Fund", beforeCents: 20000, afterCents: 25000 },
          bankAccount: { name: "Administrative Checking", changeCents: 0 },
        },
      },
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
      bankAccountId=""
      reason=""
      submitting={false}
      inlineError={null}
      onDestChange={noop}
      onCategoryChange={noop}
      onBankAccountChange={noop}
      onCheckAgain={noop}
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
    const base = preview();
    base.destinations[0].warnings = [
      { code: "ratchet", message: RATCHET_WARNING },
      { code: "sent_statement", message: "The Administrative statement for September 2026 was already sent." },
    ];
    const html = body({ phase: "form", preview: base });
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
      entity: CLUB,
      crossEntity: false,
      tier: { required: "record", reasons: [] },
      allowed: false,
      denial: { code: "not_permitted", status: 403, reason: "Income cannot be moved between these funds." },
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
      entitySlug: "club",
      crossEntity: false,
      acknowledgment: "none",
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
  it("the request body is exactly the keys the route accepts; same-entity sends destBankAccountId null", () => {
    const b = buildMoveBody({ destFundId: TO, categoryId: CAT, reason: "valid reason here", expectedFundId: FROM });
    expect(Object.keys(b).sort()).toEqual([
      "categoryId",
      "destBankAccountId",
      "destFundId",
      "expectedFundId",
      "reason",
    ]);
    expect(b.destBankAccountId).toBeNull();
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

// ---------------------------------------------------------------------------
// C38: the cross-entity destination (Foundation Charitable row to Club Activity)
// ---------------------------------------------------------------------------

import {
  CROSS_ENTITY_RATCHET_NO_RECEIPT,
  CROSS_ENTITY_RATCHET_RECEIPT_SENT,
  RECEIPT_SENT_WARNING,
  UNSENT_RECEIPT_REMOVED_WARNING,
  duplicateCandidateWarning,
  sentStatementWarning,
  type MoveDestination,
} from "@/lib/ledger-correction";

const FOUNDATION = { id: "e0000000-0000-4000-8000-0000000000f1", slug: "foundation", name: "Foundation" };
const CHARITABLE = "a0000000-0000-4000-8000-0000000000c1";
const ACTIVITY = "a0000000-0000-4000-8000-0000000000a1";
const BANK_A = "b1000000-0000-4000-8000-000000000001";
const BANK_B = "b1000000-0000-4000-8000-000000000002";

function crossDest(over: Partial<MoveDestination> = {}): MoveDestination {
  return {
    fundId: ACTIVITY,
    name: "Activity Fund",
    kind: "activity",
    entity: CLUB,
    crossEntity: true,
    tier: { required: "manage", reasons: ["cross_entity"] },
    allowed: true,
    categories: [{ id: CAT, name: "Public donations" }],
    defaultCategoryId: CAT,
    bankAccounts: [
      { id: BANK_A, name: "Administrative Checking", beforeCents: 100000, afterCents: 105000 },
      { id: BANK_B, name: "Savings", beforeCents: 5000, afterCents: 10000 },
    ],
    defaultBankAccountId: null,
    impact: {
      crossEntity: true,
      sourceFund: { name: "Charitable Fund", beforeCents: 300000, afterCents: 295000 },
      destFund: { name: "Activity Fund", beforeCents: 20000, afterCents: 25000 },
      sourceBankAccount: { name: "Foundation Checking", beforeCents: 400000, afterCents: 395000 },
    },
    duplicateCandidates: [],
    warnings: [
      { code: "ratchet", message: CROSS_ENTITY_RATCHET_RECEIPT_SENT },
      { code: "receipt_sent", message: RECEIPT_SENT_WARNING },
      { code: "sent_statement", message: sentStatementWarning("2026-09", "Foundation") },
    ],
    ...over,
  };
}

function crossPreview(destOver: Partial<MoveDestination> = {}, txOver: Partial<MovePreview["transaction"]> = {}): MovePreview {
  const p = preview();
  p.transaction = {
    ...p.transaction,
    fundId: CHARITABLE,
    fundName: "Charitable Fund",
    fundKind: "charitable",
    bankAccountName: "Foundation Checking",
    entity: FOUNDATION,
    donorId: "d0000000-0000-4000-8000-000000000001",
    receipt: "sent",
    ...txOver,
  };
  p.callerCanManage = true;
  p.destinations = [crossDest(destOver)];
  return p;
}

describe("MoveDialogBody: cross-entity destination (C38)", () => {
  const cross = (over: Partial<MoveDialogBodyProps> = {}, p = crossPreview()) =>
    body({ phase: "form", preview: p }, { destFundId: ACTIVITY, ...over }).replace(/&#x27;/g, "'");

  it("requires an explicit bank pick: no default unless the server marks exactly one", () => {
    const html = cross();
    expect(html).toContain("Club bank account");
    expect(html).toContain("Choose an account");
    expect(html).not.toMatch(/<option value="[^"]+" selected="">Administrative Checking/);
    expect(html).toContain("Pick the account the money actually landed in.");
    expect(html).toContain('<optgroup label="Club">');
  });

  it("shows both entities' book balances and both bank accounts, never 'balance unchanged'", () => {
    const html = cross({ bankAccountId: BANK_A });
    expect(html).toContain("Charitable Fund");
    expect(html).toContain("$3,000.00");
    expect(html).toContain("$2,950.00");
    expect(html).toContain("Foundation Checking");
    expect(html).toContain("$4,000.00");
    expect(html).toContain("$3,950.00");
    expect(html).toContain("Administrative Checking");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("$1,050.00");
    expect(html).not.toContain("unchanged");
  });

  it("before a pick, the destination account row asks for one", () => {
    expect(cross()).toContain("Choose an account to see its balance change.");
  });

  it("renders the receipt line by state", () => {
    expect(cross()).toContain("receipt stays with this gift");
    expect(cross()).toContain(RECEIPT_SENT_WARNING);
    const unsent = crossPreview(
      { warnings: [{ code: "unsent_receipt_removed", message: UNSENT_RECEIPT_REMOVED_WARNING }] },
      { receipt: "unsent" },
    );
    const unsentHtml = cross({}, unsent);
    expect(unsentHtml.split(UNSENT_RECEIPT_REMOVED_WARNING).length - 1).toBe(1);
    expect(unsentHtml).not.toContain("receipt stays with this gift");
    const none = cross({}, crossPreview({ warnings: [] }, { receipt: "none" }));
    expect(none).not.toContain("receipt stays with this gift");
    expect(none).not.toContain("never sent");
  });

  it("lists duplicate candidates as an advisory with matched/reconciled chips", () => {
    const p = crossPreview({
      duplicateCandidates: [
        {
          id: "f0000000-0000-4000-8000-000000000001",
          txnDate: "2026-09-10",
          party: "Same Deposit",
          amountCents: 5000,
          fundName: "Administrative Fund",
          bankAccountName: "Administrative Checking",
          matched: true,
          reconciled: false,
        },
      ],
      warnings: [{ code: "duplicate_candidate", message: duplicateCandidateWarning(1) }],
    });
    const html = cross({}, p);
    expect(html).toContain("Possibly the same deposit");
    expect(html).toContain("Same Deposit");
    expect(html).toContain("Matched");
    expect(html).toContain("Advisory only");
    expect(html).toContain(duplicateCandidateWarning(1));
  });

  it("renders the per-entity sent-statement warning and both ratchet variants as given", () => {
    expect(cross()).toContain("The Foundation statement for September 2026 was already sent");
    expect(cross()).toContain(CROSS_ENTITY_RATCHET_RECEIPT_SENT);
    expect(cross()).toContain("Read before moving");
    const noReceipt = crossPreview({ warnings: [{ code: "ratchet", message: CROSS_ENTITY_RATCHET_NO_RECEIPT }] });
    expect(cross({}, noReceipt)).toContain(CROSS_ENTITY_RATCHET_NO_RECEIPT);
  });

  it("the aged-fund note says the moved entry keeps its date", () => {
    const p = crossPreview({
      warnings: [{ code: "aged_public_fund", message: "This entry is older than the holding period." }],
    });
    expect(cross({}, p)).toContain("keeps its original date");
    expect(cross()).not.toContain("keeps its original date");
  });

  it("Confirm needs destination, bank pick and reason; the label names the entity", () => {
    const reason = "Deposited to the Club account";
    expect(submitTag(cross({ reason }))).toMatch(DISABLED);
    const ok = cross({ reason, bankAccountId: BANK_A });
    expect(submitTag(ok)).not.toMatch(DISABLED);
    expect(ok).toContain("Move to Activity Fund (Club)");
    expect(isMoveSubmittable({ destFundId: ACTIVITY, reason, crossEntity: true, destBankAccountId: "" })).toBe(false);
    expect(isMoveSubmittable({ destFundId: ACTIVITY, reason, crossEntity: true, destBankAccountId: BANK_A })).toBe(true);
    expect(isMoveSubmittable({ destFundId: ACTIVITY, reason })).toBe(true);
  });

  it("the request carries destBankAccountId cross-entity and null same-entity", () => {
    const base = { destFundId: ACTIVITY, categoryId: CAT, reason: "valid reason here", expectedFundId: CHARITABLE };
    expect(buildMoveBody({ ...base, destBankAccountId: BANK_A }).destBankAccountId).toBe(BANK_A);
    expect(buildMoveBody(base).destBankAccountId).toBeNull();
  });

  it("a Club Administrative income row lists the Foundation as denied with the mirror sentence", () => {
    const mirror =
      "A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register.";
    const p = preview();
    p.destinations.push({
      fundId: CHARITABLE,
      name: "Charitable Fund",
      kind: "charitable",
      entity: FOUNDATION,
      crossEntity: true,
      tier: { required: "manage", reasons: ["cross_entity"] },
      allowed: false,
      denial: { code: "club_to_foundation_not_supported", status: 403, reason: mirror },
    });
    const html = body({ phase: "form", preview: p });
    expect(html).toContain("Charitable Fund (Foundation)");
    expect(html.replace(/&#x27;/g, "'")).toContain(mirror);
    expect(html).not.toContain(`<option value="${CHARITABLE}"`);
  });

  it("with nothing allowed and a state or permission denial, the heading is 'can't be moved yet' and the reason shows", () => {
    const p = crossPreview({
      allowed: false,
      categories: undefined,
      impact: undefined,
      warnings: undefined,
      denial: {
        code: "manage_required",
        status: 403,
        reason: "Moving an entry to the other entity needs the Manage Ledger permission (held by the Admin role).",
      },
    });
    const html = body({ phase: "form", preview: p }, { destFundId: "" });
    expect(html).toContain("can\u2019t be moved yet");
    expect(html).toContain("needs the Manage Ledger permission");
    expect(submitTag(html)).toBeNull();
  });

  it("with nothing allowed and only policy denials, the old sentence stays", () => {
    const p = preview();
    p.destinations = [
      {
        ...p.destinations[0],
        allowed: false,
        denial: { code: "not_permitted", status: 403, reason: "Income cannot be moved between these funds." },
      },
    ];
    expect(body({ phase: "form", preview: p }, { destFundId: "" })).toContain("No other fund can hold this entry.");
  });

  it("an unlock denial renders the checklist instead of the form", () => {
    const p = crossPreview({
      allowed: false,
      categories: undefined,
      impact: undefined,
      warnings: undefined,
      denial: {
        code: "reconciled_session",
        status: 403,
        reason: "This entry was cleared by a closed reconciliation session.",
        unlock: {
          kind: "closed_session",
          session: {
            id: "5e000000-0000-4000-8000-000000000001",
            bankAccountName: "Foundation Checking",
            periodStart: "2026-09-01",
            periodEnd: "2026-09-30",
            status: "closed",
          },
          laterClosedSessions: [],
          otherMatchesOnLine: 0,
          statementMonth: "2026-09",
          statementAlreadySent: false,
        },
      },
    });
    const html = body({ phase: "form", preview: p }, { destFundId: "" });
    expect(html).toContain("Before this can move");
    expect(html).not.toContain('id="move-bank"');
    expect(submitTag(html)).toBeNull();
  });

  it("success after a cross-entity move names the entity and the receipt outcome; the sweep link uses the result's entity", () => {
    const result: MoveResponse = {
      id: TXN,
      fundId: ACTIVITY,
      fundSlug: "activity",
      fundName: "Activity Fund",
      categoryId: CAT,
      categoryName: "Public donations",
      sweepSuggested: true,
      entitySlug: "club",
      crossEntity: true,
      acknowledgment: "kept",
    };
    // The dialog is mounted on the FOUNDATION register (entitySlug="foundation").
    const html = body({ phase: "success", result, destEntityName: "Club" }, { entitySlug: "foundation" });
    expect(html).toContain("Moved to Activity Fund (Club).");
    expect(html).toContain("The receipt letter stays attached to the gift and still names the Foundation.");
    expect(html).toContain(`href="/admin/ledger/activity?entity=club&amp;sweepFrom=${TXN}"`);
    expect(html).not.toContain("entity=foundation");
    const removed = body({ phase: "success", result: { ...result, acknowledgment: "removed" }, destEntityName: "Club" });
    expect(removed).toContain("The unsent receipt record was removed.");
  });
});
