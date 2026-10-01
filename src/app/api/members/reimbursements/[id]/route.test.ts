/**
 * Unit tests for PATCH/DELETE /api/members/reimbursements/[id] status guards
 * (DECISION-106, R-5). Hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  updates: [] as { where: unknown }[],
  deletes: [] as { where: unknown }[],
  updateResult: [{ id: "r-1" }] as unknown[],
  deleteResult: [{ id: "r-1" }] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: (where: unknown) => {
          h.updates.push({ where });
          return { returning: async () => h.updateResult };
        },
      }),
    }),
    delete: () => ({
      where: (where: unknown) => {
        h.deletes.push({ where });
        return { returning: async () => h.deleteResult };
      },
    }),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({ getReimbursement: vi.fn() }));

import { PATCH, DELETE } from "./route";
import { auth } from "@/lib/auth";
import { getReimbursement } from "@/lib/ledger-queries";

const ctx = { params: Promise.resolve({ id: "r-1" }) };
const dialect = new PgDialect();
const req = (body: unknown = { description: "New text" }) =>
  ({ json: async () => body }) as unknown as NextRequest;
const row = (status = "submitted", memberId = "m-sub") =>
  ({ id: "r-1", submittedByMemberId: memberId, status }) as never;

beforeEach(() => {
  h.updates.length = 0;
  h.deletes.length = 0;
  h.updateResult = [{ id: "r-1" }];
  h.deleteResult = [{ id: "r-1" }];
  vi.mocked(auth).mockResolvedValue({ user: { id: "u-sub", memberId: "m-sub" } } as never);
  vi.mocked(getReimbursement).mockReset();
  vi.mocked(getReimbursement).mockResolvedValue(row());
});

describe("PATCH", () => {
  it("owner edit of a submitted row is 200 and the WHERE pins status = submitted — regression for member edits not being status-conditioned to submitted rows", async () => {
    const res = await PATCH(req(), ctx);
    expect(res.status).toBe(200);
    const q = dialect.sqlToQuery(h.updates[0].where as never);
    expect(q.sql).toContain('"status" =');
    expect(q.params).toContain("submitted");
  });

  it("409 pre-read on a paid row — regression for members editing a paid reimbursement", async () => {
    vi.mocked(getReimbursement).mockResolvedValue(row("paid"));
    const res = await PATCH(req(), ctx);
    expect(res.status).toBe(409);
    expect(h.updates).toHaveLength(0);
  });

  it("409 when the read says submitted but the atomic update matches zero rows — regression for a read-then-update race letting members edit a row reviewed in between", async () => {
    h.updateResult = [];
    const res = await PATCH(req(), ctx);
    expect(res.status).toBe(409);
  });

  it("404 for another member's row", async () => {
    vi.mocked(getReimbursement).mockResolvedValue(row("submitted", "m-other"));
    expect((await PATCH(req(), ctx)).status).toBe(404);
  });
});

describe("DELETE", () => {
  it("owner withdraw of a submitted row is 200", async () => {
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
  });

  it("409 pre-read on a paid row with the already-processed message — regression for members withdrawing a paid reimbursement", async () => {
    vi.mocked(getReimbursement).mockResolvedValue(row("paid"));
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already processed");
    expect(h.deletes).toHaveLength(0);
  });

  it("409 when the atomic delete matches zero rows — regression for a read-then-delete race letting members delete a row reviewed in between", async () => {
    h.deleteResult = [];
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already processed");
  });

  it("404 for another member's row", async () => {
    vi.mocked(getReimbursement).mockResolvedValue(row("submitted", "m-other"));
    expect((await DELETE(req(), ctx)).status).toBe(404);
  });
});
