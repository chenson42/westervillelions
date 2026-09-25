/**
 * Unit tests for POST /api/members/proposals/[id]/submit.
 *
 * Covers docs/work-log/2026-09-25-proposal-board-email.md Phase 3/4's "full
 * field parity + Reply-To" enhancement:
 *   - All ten admin-detail-page fields appear in the board notification.
 *   - Tri-state rendering for a money field (estimated income) and a
 *     headcount field (volunteers needed): real value / explicitly unknown /
 *     left blank must render three DISTINCT strings, never collapsing
 *     "unknown" and "blank" into one.
 *   - Member-supplied text containing HTML metacharacters is escaped.
 *   - replyTo is set to the proposer's snapshot email on the board
 *     notification, and omitted (not sent as a broken/empty header) when
 *     the snapshot is null.
 *
 * Hermetic: mocks @/lib/auth, @/lib/proposals-queries, and @/lib/email.
 * boardNotificationHtml() itself is NOT exported, so these tests exercise it
 * indirectly through the route's sendEmail() call, same approach as
 * src/app/api/admin/minutes/[id]/email/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { Proposal, ProposalDecision } from "@/lib/db/schema";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/proposals-queries", () => ({
  getOwnedProposal: vi.fn(),
  submitProposal: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { getOwnedProposal, submitProposal } from "@/lib/proposals-queries";
import { sendEmail } from "@/lib/email";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

function baseProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    proposerMemberId: "mem-1",
    proposerUserId: "user-1",
    proposerNameSnapshot: "Jane Doe",
    proposerEmailSnapshot: "jane@example.com",
    proposerPhoneSnapshot: null,
    status: "submitted",
    projectName: "Fall Food Drive",
    type: "service_project",
    needDescription: "Families in the district need holiday meal support.",
    chairName: "Jane Doe",
    moneyNeeded: "yes",
    estimatedCostCents: 50000,
    estimatedCostUnknown: false,
    estimatedIncomeCents: null,
    estimatedIncomeUnknown: false,
    proposedDate: "2026-11-15",
    proposedDateUnknown: false,
    volunteersNeeded: null,
    volunteersNeededUnknown: false,
    clubResourcesNeeded: "A van for deliveries",
    publicityPlan: "Facebook post and newsletter blurb",
    additionalNotes: "Coordinating with the food pantry.",
    submittedAt: new Date("2026-09-25T12:00:00Z"),
    createdAt: new Date("2026-09-20T12:00:00Z"),
    updatedAt: new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  } as Proposal;
}

function decisionFor(proposal: Proposal): ProposalDecision {
  return {
    id: "dec-1",
    proposalId: proposal.id,
    status: "submitted",
    decidedByUserId: proposal.proposerUserId,
    decidedAt: new Date("2026-09-25T12:00:00Z"),
    meetingDate: null,
    citingMinutesId: null,
    note: null,
    createdAt: new Date("2026-09-25T12:00:00Z"),
  } as unknown as ProposalDecision;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", memberId: "mem-1" },
  } as never);
  vi.mocked(getOwnedProposal).mockReset();
  vi.mocked(submitProposal).mockReset();
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" } as never);
});

function boardCallHtml() {
  // The board notification is always the FIRST sendEmail() call in the route.
  return vi.mocked(sendEmail).mock.calls[0][0].html as string;
}

describe("POST /api/members/proposals/[id]/submit — board notification full field parity", () => {
  it("includes all ten admin-detail-page fields (plus proposer + project name) in the board email", async () => {
    const proposal = baseProposal();
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    const response = await POST(makeRequest(), makeParams(proposal.id));
    expect(response.status).toBe(200);

    const html = boardCallHtml();
    expect(html).toContain("Jane Doe"); // proposed by
    expect(html).toContain("Fall Food Drive"); // project name
    expect(html).toContain("Service Project"); // type
    expect(html).toContain("Families in the district need holiday meal support."); // need/impact
    expect(html).toContain("Money needed from the club");
    expect(html).toContain("Estimated income");
    expect(html).toContain("Proposed date");
    expect(html).toContain("Volunteers needed");
    expect(html).toContain("A van for deliveries"); // club resources needed
    expect(html).toContain("Facebook post and newsletter blurb"); // publicity
    expect(html).toContain("Coordinating with the food pantry."); // additional notes
  });

  it("renders the proposed date human-readably, not as a raw ISO string", async () => {
    // `proposedDate` is a Postgres `date` column; formatCalendarDate must parse it
    // as a calendar date so the day never shifts (the project's naive-timestamp bug
    // class). "long" style matches what /admin/proposals/[id] shows.
    const proposal = baseProposal({ proposedDate: "2026-11-15", proposedDateUnknown: false });
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    const response = await POST(makeRequest(), makeParams(proposal.id));
    expect(response.status).toBe(200);

    const html = boardCallHtml();
    expect(html).toContain("November 15, 2026");
    expect(html).not.toContain("2026-11-15");
  });

  it("estimated income (money field): real value, explicitly unknown, and blank render three distinct strings", async () => {
    const withValue = baseProposal({ estimatedIncomeCents: 12345, estimatedIncomeUnknown: false });
    vi.mocked(getOwnedProposal).mockResolvedValue(withValue);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: withValue, decision: decisionFor(withValue) });
    await POST(makeRequest(), makeParams(withValue.id));
    expect(boardCallHtml()).toMatch(/Estimated income:<\/strong> \$123\.45/);

    vi.mocked(sendEmail).mockClear();
    const unknown = baseProposal({ estimatedIncomeCents: null, estimatedIncomeUnknown: true });
    vi.mocked(getOwnedProposal).mockResolvedValue(unknown);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: unknown, decision: decisionFor(unknown) });
    await POST(makeRequest(), makeParams(unknown.id));
    expect(boardCallHtml()).toMatch(/Estimated income:<\/strong> Not sure yet/);

    vi.mocked(sendEmail).mockClear();
    const blank = baseProposal({ estimatedIncomeCents: null, estimatedIncomeUnknown: false });
    vi.mocked(getOwnedProposal).mockResolvedValue(blank);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: blank, decision: decisionFor(blank) });
    await POST(makeRequest(), makeParams(blank.id));
    expect(boardCallHtml()).toMatch(/Estimated income:<\/strong> Not specified/);
  });

  it("volunteers needed (headcount field): real value, explicitly unknown, and blank render three distinct strings", async () => {
    const withValue = baseProposal({ volunteersNeeded: 8, volunteersNeededUnknown: false });
    vi.mocked(getOwnedProposal).mockResolvedValue(withValue);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: withValue, decision: decisionFor(withValue) });
    await POST(makeRequest(), makeParams(withValue.id));
    expect(boardCallHtml()).toMatch(/Volunteers needed:<\/strong> 8/);

    vi.mocked(sendEmail).mockClear();
    const unknown = baseProposal({ volunteersNeeded: null, volunteersNeededUnknown: true });
    vi.mocked(getOwnedProposal).mockResolvedValue(unknown);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: unknown, decision: decisionFor(unknown) });
    await POST(makeRequest(), makeParams(unknown.id));
    expect(boardCallHtml()).toMatch(/Volunteers needed:<\/strong> Not sure yet/);

    vi.mocked(sendEmail).mockClear();
    const blank = baseProposal({ volunteersNeeded: null, volunteersNeededUnknown: false });
    vi.mocked(getOwnedProposal).mockResolvedValue(blank);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal: blank, decision: decisionFor(blank) });
    await POST(makeRequest(), makeParams(blank.id));
    expect(boardCallHtml()).toMatch(/Volunteers needed:<\/strong> Not specified/);
  });

  it("escapes HTML metacharacters in member-supplied free-text fields", async () => {
    const proposal = baseProposal({
      needDescription: `<script>alert('x')</script>`,
      clubResourcesNeeded: `Tables & chairs "please"`,
      publicityPlan: `<b>bold</b>`,
      additionalNotes: `5 < 10 & 10 > 5`,
      chairName: `O'Brien <chair>`,
    });
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    await POST(makeRequest(), makeParams(proposal.id));
    const html = boardCallHtml();

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("sets replyTo to the proposer's snapshot email on the board notification", async () => {
    const proposal = baseProposal({ proposerEmailSnapshot: "proposer@example.com" });
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    await POST(makeRequest(), makeParams(proposal.id));

    const boardCall = vi.mocked(sendEmail).mock.calls[0][0];
    expect(boardCall.to).toBeTruthy();
    expect(boardCall.replyTo).toBe("proposer@example.com");
  });

  it("omits replyTo entirely on the board notification when the proposer snapshot email is null", async () => {
    const proposal = baseProposal({ proposerEmailSnapshot: null });
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    await POST(makeRequest(), makeParams(proposal.id));

    const boardCall = vi.mocked(sendEmail).mock.calls[0][0];
    expect(boardCall.replyTo).toBeUndefined();
    expect("replyTo" in boardCall).toBe(false);
    // The proposer confirmation email is never sent when there's no address.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not add a Reply-To to the proposer's own confirmation email", async () => {
    const proposal = baseProposal({ proposerEmailSnapshot: "proposer@example.com" });
    vi.mocked(getOwnedProposal).mockResolvedValue(proposal);
    vi.mocked(submitProposal).mockResolvedValue({ ok: true, proposal, decision: decisionFor(proposal) });

    await POST(makeRequest(), makeParams(proposal.id));

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const confirmationCall = vi.mocked(sendEmail).mock.calls[1][0];
    expect(confirmationCall.to).toBe("proposer@example.com");
    expect(confirmationCall.replyTo).toBeUndefined();
  });
});
