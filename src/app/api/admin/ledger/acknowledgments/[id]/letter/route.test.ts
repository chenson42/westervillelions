/**
 * C19 (DECISION-112): the letter-upload route writes ONLY the letter's storage
 * key. `ledger_acknowledgments.donee_entity_id` is write-once (the acknowledge
 * POST insert and the cross-entity move are its only writers), so this UPDATE's
 * set object must never carry it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { state } = vi.hoisted(() => ({
  state: { updates: [] as Array<Record<string, unknown>>, existingKey: null as string | null },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      ledgerAcknowledgments: {
        findFirst: vi.fn(() => Promise.resolve({ id: "ack-1", letterStorageKey: state.existingKey })),
      },
    },
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(set);
          return Promise.resolve(undefined);
        },
      }),
    })),
  },
}));

vi.mock("@/lib/receipt-storage", () => ({
  getReceiptStorage: () => ({
    save: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  }),
  receiptBytesToBodyInit: (b: Uint8Array) => b,
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function pdfRequest(): NextRequest {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const file = new File([bytes], "letter.pdf", { type: "application/pdf" });
  const form = new FormData();
  form.set("file", file);
  return { formData: async () => form } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  state.updates = [];
  state.existingKey = null;
});

describe("POST .../acknowledgments/[id]/letter: write-once issuer (C19)", () => {
  it("the UPDATE sets exactly letterStorageKey and updatedAt, never donee_entity_id", async () => {
    const res = await POST(pdfRequest(), { params: Promise.resolve({ id: "ack-1" }) });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0]).sort()).toEqual(["letterStorageKey", "updatedAt"]);
    expect(Object.keys(state.updates[0])).not.toContain("doneeEntityId");
  });
});
