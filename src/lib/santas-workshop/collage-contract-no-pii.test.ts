/**
 * The public collage is "anyone with the link". Build-failing scans: the public
 * DTO and the code that fills it carry no name, caption, child or parent data,
 * contact detail, family count or storage key, and the collage token is never
 * written to a log or an audit row.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (f: string) => strip(readFileSync(join(__dirname, f), "utf8"));
const contract = read("collage-contract.ts");
const queries = read("collage-queries.ts");
const admin = read("photo-admin.ts");

describe("public collage DTO", () => {
  it("names no person, contact, caption, family or storage field", () => {
    expect(contract).not.toMatch(/name|email|phone|mobile|address|child|parent|buyer|caption|family|stuffyId|orderId|zeffy|token|storage|note|snack|@/i);
  });

  it("CollageTile is exactly { id, kind }", () => {
    const body = contract.slice(contract.indexOf("export interface CollageTile"), contract.indexOf("export interface CollageView"));
    expect([...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])).toEqual(["id", "kind"]);
  });

  it("CollageView carries state, practice, arrivesOn and tiles only", () => {
    const body = contract.slice(contract.indexOf("export interface CollageView"), contract.indexOf("export type CollageLookup"));
    expect([...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])).toEqual(["state", "practice", "arrivesOn", "tiles"]);
  });

  it("the query reads no name, contact or storage column", () => {
    expect(queries).not.toMatch(/\.name\b|buyer|Email|Phone|childFirstName|description|noteToSanta|careNote|snack|storageKey|thumbStorageKey|deviceId|sha256|tagCode|familyToken|rawAnswers/);
  });

  it("the query decides visibility through the photo door's own function", () => {
    expect(queries).toMatch(/decidePhotoAccess\(\{ kind: "public" \}/);
  });

  it("selects only the token-matched session's photos and never a token column other than the lookup", () => {
    expect(queries.match(/collageToken/g)).toHaveLength(1);
  });
});

describe("the collage token stays out of logs and audit rows", () => {
  it("photo-admin writes ids and counts to the audit log, never the token or the URL", () => {
    for (const m of admin.matchAll(/logSessionEvent\(([\s\S]*?)\);/g)) {
      expect(m[1]).not.toMatch(/token|url|Url/i);
    }
    expect(admin).not.toMatch(/console\./);
  });

  it("no collage module logs anything", () => {
    for (const src of [queries, contract]) expect(src).not.toMatch(/console\./);
  });
});
