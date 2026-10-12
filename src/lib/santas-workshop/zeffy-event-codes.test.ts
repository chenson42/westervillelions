/**
 * Every errorCode the server can store on a Zeffy event must have a sentence in
 * admin-ui.ts (EVENT_CODE_SENTENCES). The codes are strings in the contract, not
 * an enum, so this scans the producing sources and fails when one is missing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_CODE_SENTENCES } from "./admin-ui";

const SRC = join(__dirname, "..");
const FILES = [
  join(SRC, "santas-workshop", "zeffy-consumer.ts"),
  join(SRC, "santas-workshop", "zeffy-reprocess.ts"),
  join(SRC, "zeffy", "webhook-handler.ts"),
];

function producedCodes(): string[] {
  const found = new Set<string>();
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    // `"code" in r` (a property test in zeffy-reprocess.ts) is not a code.
    for (const m of src.matchAll(/\bcode: "([a-z_]+)"(?! in )/g)) if (m[1] !== "code") found.add(m[1]);
    for (const m of src.matchAll(/errorCode: "([a-z_]+)"(?! in )/g)) if (m[1] !== "code") found.add(m[1]);
  }
  // failureCode() maps a ZeffyError to its stored code with bare `return "..."` statements.
  const consumer = readFileSync(FILES[0], "utf8");
  const fn = consumer.slice(consumer.indexOf("function failureCode"), consumer.indexOf("function failureCode") + 700);
  for (const m of fn.matchAll(/return "([a-z_]+)"/g)) found.add(m[1]);
  return [...found].sort();
}

describe("Zeffy event error codes", () => {
  const codes = producedCodes();

  it("finds the codes the server produces", () => {
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).toContain("no_api_key");
    expect(codes).toContain("zeffy_unavailable");
  });

  it.each(codes)("%s has a sentence", (code) => {
    expect(EVENT_CODE_SENTENCES[code], `add a sentence for "${code}" to EVENT_CODE_SENTENCES`).toBeTruthy();
  });

  it("has no sentence for a code nothing produces (the map stays honest)", () => {
    expect(Object.keys(EVENT_CODE_SENTENCES).filter((c) => !codes.includes(c))).toEqual([]);
  });
});
