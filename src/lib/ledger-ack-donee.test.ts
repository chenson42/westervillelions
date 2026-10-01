import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ackDoneeEntityId, ackIssuedElsewhere } from "./ledger-ack-donee";

describe("ackDoneeEntityId", () => {
  it("renders coalesce(donee_entity_id, transaction entity_id)", () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(ackDoneeEntityId);
    expect(text).toBe(
      'coalesce("ledger_acknowledgments"."donee_entity_id", "ledger_transactions"."entity_id")',
    );
    expect(params).toEqual([]);
  });
});

describe("ackIssuedElsewhere", () => {
  it("is false for a NULL stamp", () => {
    expect(ackIssuedElsewhere(null, "ent-a")).toBe(false);
  });
  it("is false when issuer equals the row's entity", () => {
    expect(ackIssuedElsewhere("ent-a", "ent-a")).toBe(false);
  });
  it("is true when issuer differs from the row's entity", () => {
    expect(ackIssuedElsewhere("ent-a", "ent-b")).toBe(true);
  });
});
