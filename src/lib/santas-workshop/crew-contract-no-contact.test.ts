/**
 * The crew contract is least-data. These scans fail the build if a crew DTO
 * grows an email, mobile, Zeffy identifier, or a field outside the view card
 * that is allowed to show it, or if the crew read path selects contact columns.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const contract = strip(readFileSync(join(__dirname, "crew-contract.ts"), "utf8"));
const queries = strip(readFileSync(join(__dirname, "crew-queries.ts"), "utf8"));

/** { name -> body } for every exported interface and type alias object in the contract. */
function interfaces(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/export interface (\w+)[^{]*\{/g)) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    out[m[1]] = source.slice(start, i - 1);
  }
  return out;
}

describe("crew contract carries no contact data", () => {
  it("no email, phone, mobile or zeffy identifier appears anywhere in the contract", () => {
    expect(contract).not.toMatch(/email|phone|mobile|zeffy/i);
  });

  it("no admin-only identifier (payment, amount, refund cents, unmatched, raw answers, reason) appears", () => {
    expect(contract).not.toMatch(/paymentId|amountCents|refundedCents|unmatched|rawAnswers|manualReason|withdrawnReason|buyer/);
  });

  const allowed: Record<string, string[]> = {
    parentName: ["CrewTagCard", "PickupNameResponse"],
    snack: ["CrewCheckInCard"],
    careNote: ["CrewCheckInCard"],
    noteToSanta: ["CrewPortraitCard"],
  };
  const all = interfaces(contract);

  for (const [field, owners] of Object.entries(allowed)) {
    it(`${field} appears only in ${owners.join(", ")}`, () => {
      const holders = Object.entries(all)
        .filter(([, body]) => new RegExp(`\\b${field}\\b`).test(body))
        .map(([name]) => name);
      expect(holders).toEqual(owners);
    });
  }

  it("PickupCheckResponse carries no name; only the reveal route's response does", () => {
    expect(all.PickupCheckResponse).not.toMatch(/parentName/);
    expect(all.PickupNameResponse).toMatch(/parentName/);
    const reveal = strip(readFileSync(join(__dirname, "..", "..", "app", "api", "santas-workshop", "crew", "[slug]", "stuffies", "[id]", "pickup-check", "route.ts"), "utf8"));
    expect(reveal).not.toMatch(/parentNameFor|parentName/);
  });

  it("the roster row (the bulk list) carries none of the four view-only fields", () => {
    for (const name of ["CrewRosterRow", "CrewRosterResponse", "CrewSearchResponse", "CrewActionResponse", "ScanRequest"]) {
      for (const field of Object.keys(allowed)) expect(all[name] ?? "", `${name}.${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("the photo key never appears in a crew DTO (the door serves bytes by photo id)", () => {
    expect(contract).not.toMatch(/storageKey|thumbStorageKey|storage_key/);
  });
});

describe("crew read path never selects contact columns", () => {
  it("crew-queries reads no buyer email or phone, and no Zeffy ids, notes or raw answers", () => {
    expect(queries).not.toMatch(/buyerEmail|buyerPhone|zeffy|rawAnswers|buyerAnswers|manualReason|withdrawnReason|amountCents/i);
  });

  it("the roster row builder is the only mapper behind the list, search and scan", () => {
    expect(queries.match(/toCrewRow\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(queries).toMatch(/function mapRow/);
  });

  it("search matches on the parent's name but the row mapper never returns it", () => {
    const toCrewRow = queries.slice(queries.indexOf("export function toCrewRow"), queries.indexOf("export function sortCrewRows"));
    expect(toCrewRow).not.toMatch(/buyerFirstName|buyerLastName|parentName/);
  });
});
