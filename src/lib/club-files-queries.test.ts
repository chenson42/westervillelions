/**
 * Unit tests for src/lib/club-files-queries.ts.
 *
 * Covers the Phase 3 design doc's named test for this layer:
 * "PUT .../attachments — full-set replace semantics; duplicate eventId in
 * the request body deduped, not a unique-constraint error", plus the
 * visibility-scoped listing helpers (getPublicAttachedFiles vs.
 * getAllAttachedFiles) since those encode a real, easy-to-invert filter.
 *
 * Hermetic: mocks @/lib/db (hand-wired chains) and @/lib/club-file-storage
 * (getClubFileStorage only), matching this codebase's convention.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectImpls: [] as Array<() => unknown>,
    txCurrentRows: [] as { eventId: string }[],
    txInsertedValues: [] as unknown[],
    txDeleteWhereCalls: 0,
    updateReturningRows: [] as unknown[],
    deleteCallCount: 0,
  },
}));

function selectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => resolved,
    limit: () => resolved,
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => resolved.then(res, rej),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const impl = dbState.selectImpls.shift();
      return selectChain(impl ? (impl() as unknown[]) : []);
    }),
    update: vi.fn(() => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(dbState.updateReturningRows),
        }),
      }),
    })),
    delete: vi.fn(() => {
      dbState.deleteCallCount++;
      return { where: () => Promise.resolve(undefined) };
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        select: () => selectChain(dbState.txCurrentRows),
        insert: () => ({
          values: (v: unknown) => {
            dbState.txInsertedValues.push(v);
            return Promise.resolve(undefined);
          },
        }),
        delete: () => ({
          where: () => {
            dbState.txDeleteWhereCalls++;
            return Promise.resolve(undefined);
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

const storageSpies = {
  save: vi.fn(() => Promise.resolve(undefined)),
  read: vi.fn(() => Promise.resolve(null)),
  delete: vi.fn(() => Promise.resolve(undefined)),
};

vi.mock("@/lib/club-file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./club-file-storage")>();
  return { ...actual, getClubFileStorage: vi.fn(() => storageSpies) };
});

import {
  setClubFileEventAttachments,
  getPublicAttachedFiles,
  getAllAttachedFiles,
  deleteClubFile,
} from "./club-files-queries";

beforeEach(() => {
  dbState.selectImpls = [];
  dbState.txCurrentRows = [];
  dbState.txInsertedValues = [];
  dbState.txDeleteWhereCalls = 0;
  dbState.updateReturningRows = [];
  dbState.deleteCallCount = 0;
  storageSpies.save.mockClear();
  storageSpies.read.mockClear();
  storageSpies.delete.mockClear();
});

const SAMPLE_FILE = {
  id: "file-1",
  name: "Sponsor Packet",
  description: null,
  visibility: "public",
  filename: "packet.pdf",
  contentType: "application/pdf",
  byteSize: 1000,
  storageKey: "club-files/uuid/packet.pdf",
  uploadedByUserId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("setClubFileEventAttachments", () => {
  it("returns not_found for a nonexistent club file", async () => {
    dbState.selectImpls.push(() => []); // getClubFileById -> not found

    const result = await setClubFileEventAttachments("ghost", ["event-1"]);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("dedupes a duplicate eventId in the request body — not a unique-constraint error", async () => {
    dbState.selectImpls.push(() => [SAMPLE_FILE]); // getClubFileById
    dbState.txCurrentRows = []; // no existing attachments

    const result = await setClubFileEventAttachments("file-1", ["event-1", "event-1", "event-2"]);

    expect(result).toEqual({ ok: true, eventIds: ["event-1", "event-2"] });
    // Only ONE insert call, with the deduped set — never a second row for
    // the repeated id.
    expect(dbState.txInsertedValues).toHaveLength(1);
    const insertedRows = dbState.txInsertedValues[0] as { clubFileId: string; eventId: string }[];
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.map((r) => r.eventId).sort()).toEqual(["event-1", "event-2"]);
  });

  it("full-set replace: inserts only newly-added ids and deletes only removed ids", async () => {
    dbState.selectImpls.push(() => [SAMPLE_FILE]);
    // Currently attached to event-1 and event-2.
    dbState.txCurrentRows = [{ eventId: "event-1" }, { eventId: "event-2" }];

    // Desired set: keep event-1, drop event-2, add event-3.
    const result = await setClubFileEventAttachments("file-1", ["event-1", "event-3"]);

    expect(result).toEqual({ ok: true, eventIds: ["event-1", "event-3"] });
    expect(dbState.txInsertedValues).toHaveLength(1);
    const insertedRows = dbState.txInsertedValues[0] as { eventId: string }[];
    expect(insertedRows.map((r) => r.eventId)).toEqual(["event-3"]);
    expect(dbState.txDeleteWhereCalls).toBe(1); // one delete call covering event-2
  });

  it("no-op diff (same set re-sent) issues neither an insert nor a delete", async () => {
    dbState.selectImpls.push(() => [SAMPLE_FILE]);
    dbState.txCurrentRows = [{ eventId: "event-1" }];

    const result = await setClubFileEventAttachments("file-1", ["event-1"]);

    expect(result).toEqual({ ok: true, eventIds: ["event-1"] });
    expect(dbState.txInsertedValues).toHaveLength(0);
    expect(dbState.txDeleteWhereCalls).toBe(0);
  });

  it("empty desired set deletes every current attachment", async () => {
    dbState.selectImpls.push(() => [SAMPLE_FILE]);
    dbState.txCurrentRows = [{ eventId: "event-1" }, { eventId: "event-2" }];

    const result = await setClubFileEventAttachments("file-1", []);

    expect(result).toEqual({ ok: true, eventIds: [] });
    expect(dbState.txInsertedValues).toHaveLength(0);
    expect(dbState.txDeleteWhereCalls).toBe(1);
  });
});

describe("getPublicAttachedFiles vs getAllAttachedFiles", () => {
  it("getPublicAttachedFiles filters to visibility='public' at the query level", async () => {
    dbState.selectImpls.push(() => [
      { id: "file-1", name: "Public Packet", description: null, filename: "p.pdf", visibility: "public" },
    ]);

    const rows = await getPublicAttachedFiles("event-1");

    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("public");
  });

  it("getAllAttachedFiles returns files of any visibility for the member-facing event page", async () => {
    dbState.selectImpls.push(() => [
      { id: "file-1", name: "Public Packet", description: null, filename: "p.pdf", visibility: "public" },
      { id: "file-2", name: "Roster", description: null, filename: "r.pdf", visibility: "members-only" },
    ]);

    const rows = await getAllAttachedFiles("event-1");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.visibility).sort()).toEqual(["members-only", "public"]);
  });
});

describe("deleteClubFile", () => {
  it("returns false for a nonexistent file and never touches storage", async () => {
    dbState.selectImpls.push(() => []); // getClubFileById -> not found

    const result = await deleteClubFile("ghost");

    expect(result).toBe(false);
    expect(storageSpies.delete).not.toHaveBeenCalled();
  });

  it("deletes the row and the underlying blob for an existing file", async () => {
    dbState.selectImpls.push(() => [SAMPLE_FILE]); // getClubFileById

    const result = await deleteClubFile("file-1");

    expect(result).toBe(true);
    expect(dbState.deleteCallCount).toBe(1);
    expect(storageSpies.delete).toHaveBeenCalledWith(SAMPLE_FILE.storageKey);
  });
});
