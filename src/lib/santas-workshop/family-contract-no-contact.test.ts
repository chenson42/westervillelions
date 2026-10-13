/**
 * The family page is "anyone holding the token". Build-failing scans: the DTO and the code that
 * fills it carry no parent, child or contact data, no sticker code, no storage key and no check-in photo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { familyPortraitPath } from "./family-contract";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (f: string) => strip(readFileSync(join(__dirname, f), "utf8"));
const contract = read("family-contract.ts");
const queries = read("family-queries.ts");

describe("family DTO", () => {
  it("names no parent, child, contact, order, sticker, Zeffy or storage field", () => {
    expect(contract).not.toMatch(/email|phone|mobile|address|child|parent|buyer|order|zeffy|tag|storage|note|snack|consent|checkIn|check_in|@/i);
  });

  it("FamilyView carries collage, practice, stuffyName, arrivesOn, portrait and collagePath only", () => {
    const body = contract.slice(contract.indexOf("export interface FamilyView"), contract.indexOf("export type FamilyLookup"));
    expect([...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])).toEqual(["collage", "practice", "stuffyName", "arrivesOn", "portrait", "collagePath"]);
  });

  it("the query reads no contact, child or storage column and never the check-in photo", () => {
    expect(queries).not.toMatch(/buyer|Email|Phone|childFirstName|careNote|noteToSanta|snack|rawAnswers|storageKey|thumbStorageKey|deviceId|sha256|tagCode|check_in|zeffy/);
  });

  it("decides the portrait through the photo door's own function with the family viewer", () => {
    expect(queries).toMatch(/decidePhotoAccess\(\{ kind: "family", stuffyId: s\.stuffyId \}/);
  });

  it("never logs", () => {
    expect(queries).not.toMatch(/console\./);
    expect(contract).not.toMatch(/console\./);
  });
});

describe("familyPortraitPath", () => {
  it("is a same-origin door path; download and version are optional", () => {
    expect(familyPortraitPath("T", "full")).toBe("/api/santas-workshop/family/T/portrait?v=full");
    expect(familyPortraitPath("T", "thumb", { download: true, version: "abc" })).toBe("/api/santas-workshop/family/T/portrait?v=thumb&download=1&p=abc");
  });
});
