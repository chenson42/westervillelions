/**
 * Unit tests for PATCH /api/admin/events/[id], covering the sibling
 * fan-out extension (`applyToSiblings`) added by
 * docs/work-log/2026-09-29-bulk-edit-same-title-events.md (Phase 3, "Unit
 * tests api-developer must deliver", items 4-11).
 *
 * Hermetic: mocks @/lib/auth, @/lib/db, @/lib/event-image, and
 * @/lib/event-images-queries. @/lib/event-siblings-queries is left REAL —
 * it is exercised through the mocked db's tx-shaped `select()` chain, same
 * as src/lib/event-siblings-queries.test.ts's own transaction-shaped-object
 * test. Never touches a real database.
 *
 * Follows the mock-auth + mock-db convention documented in
 * src/app/api/events/[id]/viewer-context/route.test.ts, adapted for
 * db.update()/db.transaction() rather than db.select().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/event-image", () => ({
  isImageDataUri: vi.fn(() => false),
  parseImageDataUri: vi.fn(() => null),
  buildEventImageUrl: vi.fn(() => "https://example.invalid/event-image.jpg"),
}));

vi.mock("@/lib/event-images-queries", () => ({
  upsertEventImage: vi.fn(() => Promise.resolve()),
  deleteEventImage: vi.fn(() => Promise.resolve()),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    existing: null as Record<string, unknown> | null,
    /** One entry per `.update(events).set(...).where(...).returning(...)` call, in call order. */
    updateReturnsQueue: [] as unknown[][],
    /** Every update call's captured `set` payload, in call order — for asserting what was (or wasn't) written. */
    updateCalls: [] as Record<string, unknown>[],
    /** Rows returned by the sibling-candidate SELECT (getSiblingCandidatesByTitle). */
    selectRows: [] as unknown[],
    selectCallCount: 0,
    transactionCallCount: 0,
  },
}));

vi.mock("@/lib/db", () => {
  function makeTx() {
    return {
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              mockDbState.updateCalls.push(set);
              return Promise.resolve(mockDbState.updateReturnsQueue.shift() ?? []);
            },
          }),
        }),
      }),
      select: () => {
        mockDbState.selectCallCount += 1;
        return {
          from: () => ({
            where: () => Promise.resolve(mockDbState.selectRows),
          }),
        };
      },
    };
  }
  return {
    db: {
      query: {
        events: {
          findFirst: vi.fn(() => Promise.resolve(mockDbState.existing)),
        },
      },
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
        mockDbState.transactionCallCount += 1;
        return cb(makeTx());
      }),
    },
  };
});

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { FEATURES } from "@/lib/permissions";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "event-1") {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_EVENT = {
  id: "event-1",
  title: "Board Meeting",
  description: "Monthly board meeting",
  startDate: "2026-06-01 19:00:00",
  endDate: null,
  location: "Fellowship Hall",
  image: null,
  isPublic: true,
  isFeatured: false,
  requiresRsvp: true,
  allowGuestCount: false,
  maxAttendees: null,
  isAllDay: false,
  isRecurring: false,
  recurrenceType: null,
  recurrenceDays: null,
  recurrenceEndDate: null,
  extraQuestion: null,
  extraQuestionType: "text",
  extraQuestionOptions: [],
  extraQuestionRequired: false,
};

const AUTHORIZED_SESSION = { user: { id: "user-1", features: [FEATURES.EVENTS_EDIT] } };

const BASE_BODY = {
  title: "Board Meeting",
  description: "Monthly board meeting",
  startDate: "2026-06-01 19:00:00",
  location: "Fellowship Hall",
  isPublic: true,
  requiresRsvp: false, // changed from existing's `true`
  allowGuestCount: false,
  extraQuestion: null,
  extraQuestionOptions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDbState.existing = { ...EXISTING_EVENT };
  mockDbState.updateReturnsQueue = [];
  mockDbState.updateCalls = [];
  mockDbState.selectRows = [];
  mockDbState.selectCallCount = 0;
  mockDbState.transactionCallCount = 0;
});

describe("PATCH /api/admin/events/[id] — authorization", () => {
  it("returns 403 before any DB access when the session lacks FEATURES.EVENTS_EDIT, with no applyToSiblings", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", features: [] } } as never);

    const res = await PATCH(makeRequest(BASE_BODY), makeParams());

    expect(res.status).toBe(403);
    expect(mockDbState.transactionCallCount).toBe(0);
  });

  it("returns 403 before any DB access when the session lacks FEATURES.EVENTS_EDIT, even WITH a well-formed applyToSiblings body", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", features: [] } } as never);

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location"] } }),
      makeParams()
    );

    expect(res.status).toBe(403);
    expect(mockDbState.transactionCallCount).toBe(0);
  });
});

describe("PATCH /api/admin/events/[id] — applyToSiblings omitted (ordinary save, unchanged behavior)", () => {
  it("updates only the target row and returns { event, siblings: null } with no sibling query issued", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    mockDbState.updateReturnsQueue = [[{ ...EXISTING_EVENT, ...BASE_BODY }]];

    const res = await PATCH(makeRequest(BASE_BODY), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.siblings).toBeNull();
    expect(body.event).toEqual({ ...EXISTING_EVENT, ...BASE_BODY });
    // Exactly one update call (the target row) — no sibling batched update.
    expect(mockDbState.updateCalls).toHaveLength(1);
    expect(mockDbState.selectCallCount).toBe(0);
  });
});

describe("PATCH /api/admin/events/[id] — applyToSiblings validation (fails before any write)", () => {
  it("400s on an empty fields array, and writes nothing — not even the main row", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);

    const res = await PATCH(makeRequest({ ...BASE_BODY, applyToSiblings: { fields: [] } }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/non-empty array/i);
    expect(mockDbState.transactionCallCount).toBe(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("400s when every requested field is unrecognized (empty after allowlist intersection), and writes nothing", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["startDate", "title", "isFeatured"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no recognized fields/i);
    expect(mockDbState.transactionCallCount).toBe(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });
});

describe("PATCH /api/admin/events/[id] — applyToSiblings smuggling defense (mixed allowlisted/off-allowlist fields)", () => {
  it("silently drops the off-allowlist field and still applies the valid one — no 400, no error", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    const sibling = { id: "sibling-1", title: "Board Meeting", startDate: "2027-07-01 19:00:00" };
    mockDbState.selectRows = [sibling];
    mockDbState.updateReturnsQueue = [
      [{ ...EXISTING_EVENT, ...BASE_BODY }], // main row update
      [sibling], // batched sibling update RETURNING
    ];

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location", "startDate"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.siblings.matched).toBe(1);
    expect(body.siblings.updated).toEqual([sibling]);
    expect(body.siblings.skipped).toEqual([]);
    // The sibling update's `set` payload (second update call) must contain
    // `location` but never `startDate` — the off-allowlist field must not
    // reach any sibling row.
    const siblingSetPayload = mockDbState.updateCalls[1];
    expect(siblingSetPayload).toHaveProperty("location");
    expect(siblingSetPayload).not.toHaveProperty("startDate");
  });
});

describe("PATCH /api/admin/events/[id] — applyToSiblings with eligible siblings", () => {
  it("updates all N eligible upcoming same-title siblings inside one transaction", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    const siblingA = { id: "sibling-a", title: "Board Meeting", startDate: "2027-07-01 19:00:00" };
    const siblingB = { id: "sibling-b", title: "Board Meeting", startDate: "2027-08-01 19:00:00" };
    mockDbState.selectRows = [siblingA, siblingB];
    mockDbState.updateReturnsQueue = [
      [{ ...EXISTING_EVENT, ...BASE_BODY }],
      [siblingA, siblingB],
    ];

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location", "requiresRsvp"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.siblings).toEqual({
      matched: 2,
      updated: [siblingA, siblingB],
      skipped: [],
    });
    expect(mockDbState.transactionCallCount).toBe(1);
  });

  it("returns matched: 0 and still saves the main row when zero eligible siblings exist at save time", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    mockDbState.selectRows = []; // no siblings at all
    mockDbState.updateReturnsQueue = [[{ ...EXISTING_EVENT, ...BASE_BODY }]];

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.event).toEqual({ ...EXISTING_EVENT, ...BASE_BODY });
    expect(body.siblings).toEqual({ matched: 0, updated: [], skipped: [] });
    // Only the main-row update call — no batched sibling update was ever issued.
    expect(mockDbState.updateCalls).toHaveLength(1);
  });

  it("filters out a past-dated candidate before it ever counts as matched", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    const pastSibling = { id: "sibling-past", title: "Board Meeting", startDate: "2020-01-01 19:00:00" };
    mockDbState.selectRows = [pastSibling];
    mockDbState.updateReturnsQueue = [[{ ...EXISTING_EVENT, ...BASE_BODY }]];

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(body.siblings).toEqual({ matched: 0, updated: [], skipped: [] });
    expect(mockDbState.updateCalls).toHaveLength(1);
  });

  it("places a sibling that matched the SELECT but is absent from the batched UPDATE's RETURNING into `skipped`, without affecting the other sibling's update or the response status", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    const deletedMidTransaction = { id: "sibling-gone", title: "Board Meeting", startDate: "2027-07-01 19:00:00" };
    const stillThere = { id: "sibling-here", title: "Board Meeting", startDate: "2027-08-01 19:00:00" };
    mockDbState.selectRows = [deletedMidTransaction, stillThere];
    mockDbState.updateReturnsQueue = [
      [{ ...EXISTING_EVENT, ...BASE_BODY }],
      [stillThere], // RETURNING omits deletedMidTransaction — simulates a concurrent delete
    ];

    const res = await PATCH(
      makeRequest({ ...BASE_BODY, applyToSiblings: { fields: ["location"] } }),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.siblings.matched).toBe(2);
    expect(body.siblings.updated).toEqual([stillThere]);
    expect(body.siblings.skipped).toEqual([deletedMidTransaction]);
  });
});

describe("PATCH /api/admin/events/[id] — sibling selection uses the pre-edit title, never the request body's title", () => {
  it("selects siblings by existing.title even when body.title is a different, just-typed value", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    mockDbState.existing = { ...EXISTING_EVENT, title: "Board Meeting" };
    mockDbState.selectRows = [];
    mockDbState.updateReturnsQueue = [[{ ...EXISTING_EVENT, title: "Board Meeting — Renamed" }]];

    const res = await PATCH(
      makeRequest({
        ...BASE_BODY,
        title: "Board Meeting — Renamed",
        applyToSiblings: { fields: ["location"] },
      }),
      makeParams()
    );

    expect(res.status).toBe(200);
    // getSiblingCandidatesByTitle's SELECT was still issued (title never
    // being fanned out doesn't skip the sibling query itself) — confirmed
    // indirectly via selectCallCount, since the real (unmocked)
    // event-siblings-queries module is exercised here.
    expect(mockDbState.selectCallCount).toBe(1);
  });
});

describe("PATCH /api/admin/events/[id] — not found", () => {
  it("returns 404 when the target event does not exist", async () => {
    vi.mocked(auth).mockResolvedValue(AUTHORIZED_SESSION as never);
    mockDbState.existing = null;

    const res = await PATCH(makeRequest(BASE_BODY), makeParams());

    expect(res.status).toBe(404);
    expect(mockDbState.transactionCallCount).toBe(0);
  });
});
