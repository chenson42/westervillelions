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

/** The body of one exported interface (between its braces). */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name}`);
  const open = source.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }
  return source.slice(open + 1, i - 1);
}
const fieldsOf = (body: string) => [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
const contractWithoutScene = contract.replace(interfaceBody(contract, "CollageScene"), "");

describe("public collage DTO", () => {
  it("names no person, contact, caption, family or storage field (outside the CollageScene body, the one place a caption is allowed)", () => {
    expect(contractWithoutScene).not.toMatch(/name|email|phone|mobile|address|child|parent|buyer|caption|family|stuffyId|orderId|zeffy|token|storage|note|snack|@/i);
  });

  it("CollageTile is exactly { id, kind }", () => {
    expect(fieldsOf(interfaceBody(contract, "CollageTile"))).toEqual(["id", "kind"]);
  });

  it("CollageScene is exactly { title, caption, tiles }: no id, count or photo field", () => {
    expect(fieldsOf(interfaceBody(contract, "CollageScene"))).toEqual(["title", "caption", "tiles"]);
  });

  it("the word caption appears in the contract only inside CollageScene", () => {
    expect(contractWithoutScene).not.toMatch(/caption/i);
    expect(contract).toMatch(/caption/i);
  });

  it("CollageView carries state, practice, arrivesOn, scenes and tiles only", () => {
    expect(fieldsOf(interfaceBody(contract, "CollageView"))).toEqual(["state", "practice", "arrivesOn", "scenes", "tiles"]);
  });

  it("the scene id is internal to the query: it never appears in the public contract", () => {
    expect(contract).not.toMatch(/sceneId|scene_id/);
  });

  it("the query reads no name, contact or storage column", () => {
    expect(queries).not.toMatch(/\.name\b|buyer|Email|Phone|childFirstName|description|noteToSanta|careNote|snack|storageKey|thumbStorageKey|deviceId|sha256|tagCode|familyToken|rawAnswers/);
  });

  it("the query decides visibility through the photo door's own function, in exactly one place", () => {
    expect(queries).toMatch(/decidePhotoAccess\(\{ kind: "public" \}/);
    expect(queries.match(/decidePhotoAccess\(/g)).toHaveLength(1);
  });

  it("scene text comes only from a swScenes select scoped to the token's session, run after the removed and pending early returns", () => {
    const selects = [...queries.matchAll(/\.from\(swScenes\)/g)];
    expect(selects).toHaveLength(1);
    const at = selects[0].index ?? 0;
    expect(at).toBeGreaterThan(queries.indexOf('state: "removed"'));
    expect(at).toBeGreaterThan(queries.indexOf('state: "pending"'));
    const clause = queries.slice(at, queries.indexOf(".orderBy", at));
    expect(clause).toMatch(/\.where\(eq\(swScenes\.sessionId, session\.id\)\)/);
  });

  it("the scene id is never passed into the visibility facts, and the scene module with counts is not imported", () => {
    expect(queries).not.toMatch(/photoFactsFrom\(\{[^}]*sceneId/);
    expect(queries).toMatch(/rows\.map\(\(\{ sceneId, \.\.\.photo \}\)/);
    expect(queries).not.toMatch(/scene-queries|scene-admin/);
    expect(queries).not.toMatch(/photoCount|unhiddenCount/);
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
