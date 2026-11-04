/**
 * The crew contract is least-data. These scans fail the build if a crew DTO
 * grows an email, mobile, Zeffy identifier, or a field outside the view card
 * that is allowed to show it, or if the crew read path selects contact columns.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
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
    treat: ["CrewPickupCard"],
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

  it("the cookie/treat choice rides the pickup card and no longer the check-in card", () => {
    expect(all.CrewPickupCard).toMatch(/treat: string \| null/);
    expect(all.CrewCheckInCard).not.toMatch(/treat|snack/);
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

describe("crew can read scenes, never author them (DECISION-128)", () => {
  const all = interfaces(contract);

  it("CrewScene is exactly id, title, caption", () => {
    expect([...all.CrewScene.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])).toEqual(["id", "title", "caption"]);
    expect([...all.CrewScenesResponse.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1])).toEqual(["scenes"]);
  });

  for (const field of ["title", "caption"]) {
    it(`${field} appears only in CrewScene (it never spreads to a roster, tag, pickup or other card)`, () => {
      const holders = Object.entries(all)
        .filter(([, body]) => new RegExp(`\\b${field}\\b`).test(body))
        .map(([name]) => name);
      expect(holders).toEqual(["CrewScene"]);
    });
  }

  it("a scene carries no counts, no photo ids and no timestamps", () => {
    expect(all.CrewScene).not.toMatch(/count|photo|createdAt|updatedAt|position/i);
  });

  it("GroupPhotoMeta carries an optional sceneId, and GroupPhotoResponse does not echo it", () => {
    expect(all.GroupPhotoMeta).toMatch(/sceneId\?: string \| null/);
    expect(all.GroupPhotoResponse).not.toMatch(/scene/i);
  });
});

describe("crew no-write scan", () => {
  const SRC = join(__dirname, "..", "..");
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  };
  const crewFiles = [
    ...walk(join(SRC, "app", "api", "santas-workshop", "crew")),
    ...walk(join(SRC, "lib", "santas-workshop")).filter((f) => /\/crew-[^/]*\.ts$/.test(f) && !f.endsWith(".test.ts")),
    ...walk(join(SRC, "components", "santas-workshop", "crew")),
  ].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("finds the crew surface", () => {
    expect(crewFiles.length).toBeGreaterThan(20);
  });

  it("no crew file inserts, updates or deletes swScenes, or imports scene-admin", () => {
    for (const f of crewFiles) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, f).not.toMatch(/\.(insert|update|delete)\(\s*swScenes\b/);
      expect(src, f).not.toMatch(/scene-admin/);
    }
  });

  it("the only crew-supplied scene datum is the group route's parseGroupSceneId; check-in and portrait routes never read it", () => {
    const crewApi = join(SRC, "app", "api", "santas-workshop", "crew");
    const users = walk(crewApi)
      .filter((f) => /sceneId|parseGroupSceneId/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(crewApi.length + 1));
    expect(users.sort()).toEqual(["[slug]/group-photos/route.ts"]);
  });

  it("the crew scenes route calls requireCrew first and scopes the query by the credential's session id, never the slug or a request parameter", () => {
    const route = strip(readFileSync(join(SRC, "app", "api", "santas-workshop", "crew", "[slug]", "scenes", "route.ts"), "utf8"));
    expect(route).toMatch(/requireCrew\(/);
    expect(route.indexOf("requireCrew(")).toBeLessThan(route.indexOf("listCrewScenes("));
    expect(route).toMatch(/listCrewScenes\(gate\.session\.id\)/);
    expect(route).not.toMatch(/listCrewScenes\((slug|params|request)/);
    const queriesSrc = strip(readFileSync(join(__dirname, "scene-queries.ts"), "utf8"));
    const fn = queriesSrc.slice(queriesSrc.indexOf("export async function listCrewScenes"), queriesSrc.indexOf("export async function listAdminScenes"));
    expect(fn).toMatch(/eq\(swScenes\.sessionId, sessionId\)/);
    expect(fn).not.toMatch(/count|swPhotos/i);
  });

  it("the group-photos route parses the scene id from the upload meta and answers with the same body shape whatever it was", () => {
    const route = strip(readFileSync(join(SRC, "app", "api", "santas-workshop", "crew", "[slug]", "group-photos", "route.ts"), "utf8"));
    expect(route).toMatch(/parseGroupSceneId\(upload\.parts\.meta\)/);
    expect(route).toMatch(/commitGroupPhoto\(ctx, photo, sceneId\)/);
    expect(route).toMatch(/const body: GroupPhotoResponse = \{ ok: true, photoId: meta\.value\.photoId, replayed: outcome\.replayed \}/);
    expect(route).not.toMatch(/resolveSceneId/);
  });
});
