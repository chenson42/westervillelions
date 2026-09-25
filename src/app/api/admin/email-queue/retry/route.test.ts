/**
 * Unit tests for POST /api/admin/email-queue/retry.
 *
 * This is the test named explicitly in the Phase 3 design doc's "Unit Tests
 * To Deliver" (docs/work-log/2026-09-04-event-announcement-emails.md) and in
 * the api-developer task brief: a regression guard for DECISION-092. This
 * route re-sends a PERSISTED email_queue row directly via its own
 * resend.emails.send() call — it bypasses sendEmail() entirely — so if the
 * row's `attachments` column isn't forwarded here, a retried announcement
 * (or any future attachment-bearing send) silently arrives without its
 * calendar invite. That is the exact gap DECISION-092 exists to close.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const updateSet = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

interface MockRow {
  id: string;
  status: string;
  attempts: number;
  [key: string]: unknown;
}

let eligibleRows: MockRow[] = [];

/**
 * Test-only fault injector: when true, the NEXT plain (non-claim) update
 * that writes `status: "sent"` throws instead of succeeding, simulating an
 * unexpected failure between a successful Resend send and the terminal
 * write that records it — the scenario settleClaim()'s own try/catch exists
 * to handle (see route.ts doc comment on settleClaim). Resets itself after
 * firing once so it doesn't also break the recovery write that follows.
 */
let forceThrowOnNextSentWrite = false;

/**
 * Pulls the bare parameter values out of a real drizzle-orm SQL fragment, in
 * the order they were composed. The `emailQueue` schema is mocked as `{}`
 * below (no real column objects), so drizzle's usual `encoder.name` metadata
 * isn't available — but the bound VALUE itself still appears as a bare
 * string element inside `queryChunks` (verified against a real `eq()`/
 * `and()` call), distinguishable from the structural pieces, which are
 * always wrapped as `{ value: [...] }`. This lets the mock below simulate a
 * real `UPDATE ... WHERE id = $1 AND status = $2` atomic claim: for
 * `and(eq(emailQueue.id, id), eq(emailQueue.status, "failed"))` this yields
 * `[id, "failed"]`, and for a plain `eq(emailQueue.id, id)` it yields `[id]`.
 */
function extractSqlParams(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const el of node) {
      if (typeof el === "string") acc.push(el);
      else extractSqlParams(el, acc);
    }
  } else if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown }).queryChunks)) {
    extractSqlParams((node as { queryChunks: unknown[] }).queryChunks, acc);
  }
  return acc;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => eligibleRows,
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSet(values);
        return {
          where: (cond: unknown) => {
            const [id, requiredStatus] = extractSqlParams(cond);
            const findRow = () => eligibleRows.find((r) => r.id === id);
            return {
              // Atomic claim path: `.where(and(eq(id,...), eq(status,'failed'))).returning(...)`.
              // Simulates a real `UPDATE ... WHERE id=$1 AND status=$2 RETURNING id`:
              // only claims (and mutates) the row if its CURRENT status still
              // matches the precondition — this is what makes the concurrency
              // regression test below meaningful rather than a tautology.
              returning: async () => {
                const row = findRow();
                if (!row) return [];
                if (requiredStatus !== undefined && row.status !== requiredStatus) return [];
                Object.assign(row, values);
                return [{ id: row.id }];
              },
              // Plain update path: `await db.update(...).set(...).where(eq(id,...))`,
              // no precondition, no `.returning()` call.
              then: (resolve: (v: undefined) => void) => {
                if (forceThrowOnNextSentWrite && values.status === "sent") {
                  forceThrowOnNextSentWrite = false;
                  throw new Error("Simulated DB failure writing terminal 'sent' status");
                }
                const row = findRow();
                if (row) Object.assign(row, values);
                resolve(undefined);
              },
            };
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({ emailQueue: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

// B-66 (docs/work-log/2026-09-25-retry-stranding.md): resetStaleRetryingEmails()
// is exercised on its own behavior in src/lib/email-queue-stats.test.ts — here
// it's mocked so this file can assert WHERE and HOW OFTEN this route calls it,
// without needing this file's already-elaborate db mock to also model the
// reset's own UPDATE predicate.
const resetStaleRetryingEmailsMock = vi.fn().mockResolvedValue(0);
vi.mock("@/lib/email-queue-stats", () => ({
  resetStaleRetryingEmails: (...args: unknown[]) => resetStaleRetryingEmailsMock(...args),
}));

// Real drizzle-orm query builders, but spy-wrapped so a test can assert
// which predicate the route actually composed: `lte` (the nextRetryAt
// cooldown) for bulk retry, `inArray` (explicit ids, no cooldown) for
// targeted retry. This is the load-bearing assertion for "targeted retry
// bypasses nextRetryAt" — the db mock above returns `eligibleRows`
// unconditionally regardless of the predicate, so without this spy the
// tests below couldn't otherwise distinguish "ignored nextRetryAt" from
// "happened not to filter it out."
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    lte: vi.fn(actual.lte),
    inArray: vi.fn(actual.inArray),
  };
});

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { lte, inArray } from "drizzle-orm";

/** A bare bulk-mode request — no body, exactly what RetryButton sends. */
function bulkRequest() {
  return new Request("http://localhost/api/admin/email-queue/retry", { method: "POST" });
}

/** A targeted-retry request naming specific ids. */
function targetedRequest(ids: string[]) {
  return new Request("http://localhost/api/admin/email-queue/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

function makeEligibleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    to: "member@westervillelions.org",
    from: "noreply@westervillelions.org",
    subject: "Weekly Meeting",
    html: "<p>Details</p>",
    status: "failed",
    attempts: 3,
    attachments: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
  // Default to production so the deny-by-default guard (shouldBlockNonProductionSend,
  // added alongside the atomic-claim fix) doesn't interfere with tests that
  // predate it and aren't about the guard — same convention email-guardrail.test.ts
  // already uses ("// no guardrail interference"). Tests that specifically exercise
  // the guard or the missing-key branch override this explicitly.
  vi.stubEnv("NODE_ENV", "production");
  sendMock.mockReset().mockResolvedValue({ data: { id: "resend-id" } });
  updateSet.mockReset();
  eligibleRows = [];
  forceThrowOnNextSentWrite = false;
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(lte).mockClear();
  vi.mocked(inArray).mockClear();
  resetStaleRetryingEmailsMock.mockClear().mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/email-queue/retry — attachments (DECISION-092)", () => {
  it("forwards a persisted attachments array to resend.emails.send() on retry", async () => {
    const attachments = [
      { filename: "event.ics", content: "BEGIN:VCALENDAR...", contentType: "text/calendar" },
    ];
    eligibleRows = [makeEligibleRow({ attachments })];

    const response = await POST(bulkRequest());
    expect(response.status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ attachments }));
  });

  it("a row with attachments: null retries with no attachments key sent", async () => {
    eligibleRows = [makeEligibleRow({ attachments: null })];

    const response = await POST(bulkRequest());
    expect(response.status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMock.mock.calls[0][0];
    expect(sendArgs).not.toHaveProperty("attachments");
  });
});

// ---------------------------------------------------------------------------
// Missing RESEND_API_KEY — regression for the silent-success bug
// (docs/work-log/2026-09-25-email-silent-success.md). This route bypasses
// sendEmail() entirely (DECISION-092) and had its own copy of the same
// unguarded "mark as sent" dev-mode branch: pre-fix, a production admin who
// clicked Retry during a key outage would have every failed row silently
// re-marked "sent" a second time, with the message never actually
// re-delivered. This block was NOT covered by the pre-existing
// attachment-forwarding tests above, which always stub a present
// RESEND_API_KEY and therefore never touch this branch at all.
// ---------------------------------------------------------------------------

describe("POST /api/admin/email-queue/retry — missing RESEND_API_KEY (regression)", () => {
  beforeEach(() => {
    // Override the outer beforeEach's present key with an absent one.
    vi.stubEnv("RESEND_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("PRODUCTION + missing key: never marks the row sent — lands it back in failed with an incremented attempt and a real error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    eligibleRows = [makeEligibleRow({ id: "eq-prod", attempts: 3 })];

    const response = await POST(bulkRequest());
    const body = await response.json();

    // This is the exact regression: pre-fix, this branch unconditionally
    // set status: "sent" and counted the row as succeeded.
    expect(sendMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ retried: 1, succeeded: 0, failed: 1 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 4,
        lastError: expect.stringMatching(/RESEND_API_KEY/i),
        nextRetryAt: expect.any(Date),
      }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("NON-PRODUCTION + missing key: lands a distinct dev_no_api_key status, counted in neither succeeded nor failed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // Allowlist the fixture's recipient so this test isolates the missing-key
    // branch specifically, now that shouldBlockNonProductionSend() runs first
    // (see the new "blocked by the non-production deny-by-default guard"
    // describe block below for the guard's own dedicated coverage).
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "member@westervillelions.org");
    eligibleRows = [makeEligibleRow({ id: "eq-dev", attempts: 3 })];

    const response = await POST(bulkRequest());
    const body = await response.json();

    expect(sendMock).not.toHaveBeenCalled();
    // Kept out of both counts so the summary toast never claims delivery
    // either way for a row that was never actually sent.
    expect(body).toMatchObject({ retried: 1, succeeded: 0, failed: 0 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dev_no_api_key", attempts: 4 }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });
});

// ---------------------------------------------------------------------------
// Targeted (per-message) retry — Follow-Up #2
// (docs/work-log/2026-09-25-email-silent-success.md). An admin's explicit
// click on ONE row IS the retry decision, so this mode must bypass
// nextRetryAt entirely. All 36 real production rows this feature exists for
// have nextRetryAt = NULL, which the bulk query's `lte(nextRetryAt, now())`
// never matches.
// ---------------------------------------------------------------------------

describe("POST /api/admin/email-queue/retry — targeted retry (Follow-Up #2)", () => {
  it("picks up a failed row with nextRetryAt = NULL by composing inArray(id), never lte(nextRetryAt) — fails without the fix", async () => {
    const row = makeEligibleRow({ id: "eq-null-retry", nextRetryAt: null, attempts: 2 });
    eligibleRows = [row];

    const response = await POST(targetedRequest(["eq-null-retry"]));
    const body = await response.json();

    // Pre-fix, POST() took no parameters and always ran the bulk sweep
    // (and(eq(status,'failed'), lte(nextRetryAt, now))) — it never composed
    // inArray(id, ids) and never returned a `mode`/`results` shape at all.
    expect(inArray).toHaveBeenCalledWith(undefined, ["eq-null-retry"]);
    expect(lte).not.toHaveBeenCalled();

    expect(body.mode).toBe("targeted");
    expect(body.results).toEqual([{ id: "eq-null-retry", success: true }]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", attempts: 3 }),
    );
  });

  it("refuses to retry a row that is not status='failed' (no duplicate sends)", async () => {
    eligibleRows = [makeEligibleRow({ id: "eq-already-sent", status: "sent" })];

    const response = await POST(targetedRequest(["eq-already-sent"]));
    const body = await response.json();

    expect(sendMock).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(body.results).toEqual([
      {
        id: "eq-already-sent",
        success: false,
        error: expect.stringContaining("sent"),
      },
    ]);
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
  });

  it("returns a correct per-id result for a mixed success/failure batch", async () => {
    eligibleRows = [
      makeEligibleRow({ id: "eq-ok", to: "ok@westervillelions.org" }),
      makeEligibleRow({ id: "eq-bad", to: "bad@westervillelions.org" }),
    ];
    sendMock
      .mockResolvedValueOnce({ data: { id: "resend-id-1" }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Domain not verified", statusCode: 422, name: "invalid_from_address" },
      });

    const response = await POST(targetedRequest(["eq-ok", "eq-bad"]));
    const body = await response.json();

    expect(body).toMatchObject({ mode: "targeted", retried: 2, succeeded: 1, failed: 1 });
    expect(body.results).toEqual([
      { id: "eq-ok", success: true },
      { id: "eq-bad", success: false, error: "Domain not verified" },
    ]);
  });

  it("a Resend response carrying a non-null error marks the row failed with that message — NOT sent (regression for the unchecked-error bug)", async () => {
    eligibleRows = [makeEligibleRow({ id: "eq-rejected", attempts: 1 })];
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "Invalid recipient address", statusCode: 422, name: "validation_error" },
    });

    const response = await POST(targetedRequest(["eq-rejected"]));
    const body = await response.json();

    // This is the exact bug the task calls out: Resend's SDK does not throw
    // on an API-level rejection, so a naive `await resend.emails.send(...)`
    // with no return-value check would fall straight through to the
    // "succeeded" branch below.
    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: "Invalid recipient address",
        attempts: 2,
      }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
    // The claim moves the row to "retrying" first — confirm it lands back at
    // "failed" (retryable), never stranded at the transient claim status.
    const row = eligibleRows.find((r) => r.id === "eq-rejected");
    expect(row?.status).toBe("failed");
  });

  it("the permission gate still refuses an unauthorized caller in targeted mode", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    eligibleRows = [makeEligibleRow({ id: "eq-1" })];

    const response = await POST(targetedRequest(["eq-1"]));

    expect(response.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is refused in targeted mode", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    eligibleRows = [makeEligibleRow({ id: "eq-1" })];

    const response = await POST(targetedRequest(["eq-1"]));

    expect(response.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("must not send twice when two requests for the same id arrive concurrently (double-click / race) — regression for missing atomic claim in handleTargetedRetry", async () => {
    // QA finding, 2026-09-25: handleTargetedRetry() SELECTs the row, checks
    // item.status !== "failed" in memory, then later UPDATEs it. There is no
    // atomic claim (no `UPDATE ... WHERE status = 'failed' RETURNING id`
    // guarding the send), so two concurrent requests for the same id can
    // both observe status: "failed" before either write lands, and both
    // proceed to call resend.emails.send() — a real duplicate send. This is
    // the exact hazard the task brief called out by name and the exact
    // pattern the codebase's own acknowledgment-letter claim
    // (ledger-acknowledgment-letter-queries.ts, "atomic on purpose") exists
    // to prevent. The client's in-flight guard (row-retry-button.tsx) does
    // not protect against this — a client guard is not a guarantee.
    eligibleRows = [makeEligibleRow({ id: "eq-race", status: "failed" })];

    const [r1, r2] = await Promise.all([
      POST(targetedRequest(["eq-race"])),
      POST(targetedRequest(["eq-race"])),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    // The race's loser must report a real outcome (skipped or "cannot
    // retry"), never a fabricated success — one of the two responses names
    // the row as already claimed/handled.
    const successes = [b1, b2].filter((b) => b.succeeded === 1).length;
    expect(successes).toBe(1);
    const row = eligibleRows.find((r) => r.id === "eq-race");
    // Settled to a terminal status either way — never left at "retrying".
    expect(row?.status).toBe("sent");
  });

  it("bulk retry has the identical race protection: two overlapping bulk sweeps never send the same row twice", async () => {
    // Task brief: "check whether the bulk/untargeted path has the same
    // race... two admins clicking the bulk button simultaneously is the
    // same hazard." handleBulkRetry() now calls the same claimFailedRow()
    // used by targeted retry, so this is the same regression guard applied
    // to the sweep path.
    eligibleRows = [makeEligibleRow({ id: "eq-bulk-race", status: "failed", nextRetryAt: null })];

    const [r1, r2] = await Promise.all([POST(bulkRequest()), POST(bulkRequest())]);
    await Promise.all([r1.json(), r2.json()]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const row = eligibleRows.find((r) => r.id === "eq-bulk-race");
    expect(row?.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// Claim succeeds, then something after it fails unexpectedly — the row must
// end up back in `failed`, retryable, with a real error. Never stranded at
// the transient `retrying` claim status.
// ---------------------------------------------------------------------------

describe("POST /api/admin/email-queue/retry — claim succeeds but the terminal write then throws (safety net)", () => {
  it("reverts the row to failed with a real error instead of leaving it claimed-but-never-settled", async () => {
    forceThrowOnNextSentWrite = true;
    eligibleRows = [makeEligibleRow({ id: "eq-settle-throws", attempts: 0 })];

    const response = await POST(targetedRequest(["eq-settle-throws"]));
    const body = await response.json();

    expect(body).toMatchObject({ succeeded: 0, failed: 1 });
    expect(body.results[0]).toMatchObject({ id: "eq-settle-throws", success: false });
    expect(body.results[0].error).toMatch(/Simulated DB failure/i);

    const row = eligibleRows.find((r) => r.id === "eq-settle-throws");
    expect(row?.status).toBe("failed"); // never stranded at "retrying"
    expect(row?.attempts).toBe(1); // claimed exactly once, not double-incremented
  });
});

// ---------------------------------------------------------------------------
// Deny-by-default guardrail (DECISION-085) — this route bypasses sendEmail()
// entirely (DECISION-092) and, until this fix, had NO EMAIL_DEV_ALLOWLIST
// check at all outside production. QA's finding 2 in the "Per-Message Retry
// (Follow-Up #3)" Phase 5 verification. The predicate itself now lives in
// src/lib/email-guard.ts, shared with sendEmail() — these tests exercise
// this route's own call site of that shared predicate, not the predicate's
// own exhaustive behavior (see src/lib/email-guardrail.test.ts for that).
// ---------------------------------------------------------------------------

describe("POST /api/admin/email-queue/retry — blocked by the non-production deny-by-default guard", () => {
  it("does not call Resend, marks the row blocked_non_production (never sent), and reports the block honestly", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // No EMAIL_DEV_ALLOWLIST set — deny-by-default.
    eligibleRows = [makeEligibleRow({ id: "eq-guard-blocked", to: "someone@example.com" })];

    const response = await POST(targetedRequest(["eq-guard-blocked"]));
    const body = await response.json();

    expect(sendMock).not.toHaveBeenCalled();
    expect(body.results).toEqual([
      {
        id: "eq-guard-blocked",
        success: false,
        error: expect.stringMatching(/non-production/i),
      },
    ]);
    // Same treatment as dev_no_api_key: expected dev behavior, not a real
    // failure needing operator attention, so it's counted in neither bucket.
    expect(body).toMatchObject({ succeeded: 0, failed: 0 });

    const row = eligibleRows.find((r) => r.id === "eq-guard-blocked");
    expect(row?.status).toBe("blocked_non_production");
    expect(row?.status).not.toBe("sent");
  });

  it("still delivers when the recipient is deliberately allowlisted", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "someone@example.com");
    eligibleRows = [makeEligibleRow({ id: "eq-guard-allowlisted", to: "someone@example.com" })];

    const response = await POST(targetedRequest(["eq-guard-allowlisted"]));
    const body = await response.json();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it("refuses a club distribution list even if someone allowlists it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "club@westervillelions.org");
    eligibleRows = [makeEligibleRow({ id: "eq-guard-club", to: "club@westervillelions.org" })];

    await POST(targetedRequest(["eq-guard-club"]));

    expect(sendMock).not.toHaveBeenCalled();
    const row = eligibleRows.find((r) => r.id === "eq-guard-club");
    expect(row?.status).toBe("blocked_non_production");
  });

  it("delivers in production regardless of allowlist state — the guard is non-production only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    eligibleRows = [makeEligibleRow({ id: "eq-guard-prod" })];

    const response = await POST(targetedRequest(["eq-guard-prod"]));
    const body = await response.json();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ succeeded: 1 });
  });

  it("also blocks the bulk retry path, not just targeted retry", async () => {
    vi.stubEnv("NODE_ENV", "development");
    eligibleRows = [
      makeEligibleRow({ id: "eq-guard-bulk", to: "someone@example.com", nextRetryAt: null }),
    ];

    const response = await POST(bulkRequest());
    const body = await response.json();

    expect(sendMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ succeeded: 0, failed: 0 });
    const row = eligibleRows.find((r) => r.id === "eq-guard-bulk");
    expect(row?.status).toBe("blocked_non_production");
  });
});

// ---------------------------------------------------------------------------
// `retrying`-row stranding — B-66 (docs/work-log/2026-09-25-retry-stranding.md)
//
// qa's Phase 5 re-verification of the atomic claim (docs/work-log/
// 2026-09-25-email-silent-success.md) flagged that a hard process death
// between claimFailedRow() and settleClaim()'s terminal write leaves a row
// stranded at "retrying" forever — a JS try/catch cannot run after the
// process itself is killed. The fix stamps retryingAt at claim time and
// folds a staleness reset (resetStaleRetryingEmails(), tested on its own in
// src/lib/email-queue-stats.test.ts) into the bulk sweep. These tests cover
// this route's own two responsibilities: stamping the claim timestamp, and
// invoking the sweep from the right place.
// ---------------------------------------------------------------------------

describe("POST /api/admin/email-queue/retry — retrying-row stranding (B-66)", () => {
  it("the atomic claim stamps retryingAt with the current time — this is the ONLY signal that lets a stranded row be told apart from a live one", async () => {
    eligibleRows = [makeEligibleRow({ id: "eq-claim-stamp" })];

    await POST(targetedRequest(["eq-claim-stamp"]));

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retrying", retryingAt: expect.any(Date) }),
    );
  });

  it("every terminal write clears retryingAt back to null, so a completed row is never mistaken for a stranded one", async () => {
    eligibleRows = [makeEligibleRow({ id: "eq-terminal-clear" })];

    await POST(targetedRequest(["eq-terminal-clear"]));

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", retryingAt: null }),
    );
  });

  it("the bulk sweep runs resetStaleRetryingEmails() before selecting eligible rows, so a stranded row from an earlier crashed request can rejoin this very sweep", async () => {
    eligibleRows = [];

    await POST(bulkRequest());

    expect(resetStaleRetryingEmailsMock).toHaveBeenCalledTimes(1);
    expect(resetStaleRetryingEmailsMock).toHaveBeenCalledWith(expect.any(Date));
  });

  it("targeted (single-row) retry does NOT run the sweep — an explicit admin click on one row has no need to sweep the whole table", async () => {
    eligibleRows = [makeEligibleRow({ id: "eq-targeted-no-sweep" })];

    await POST(targetedRequest(["eq-targeted-no-sweep"]));

    expect(resetStaleRetryingEmailsMock).not.toHaveBeenCalled();
  });
});
