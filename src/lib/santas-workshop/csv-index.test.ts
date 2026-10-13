import { describe, expect, it } from "vitest";
import { buildIndexCsv, INDEX_CSV_HEADER, sortIndexRows, type IndexRow } from "./csv-index";

const row = (o: Partial<IndexRow>): IndexRow => ({
  frameNumber: 1,
  fileName: "ssw-t-001.jpg",
  stuffyName: "Bear",
  parentLast: "Smith",
  parentFirst: "Pat",
  windowLabel: "5:00 PM",
  consent: true,
  produced: true,
  reason: "",
  ...o,
});
const lines = (csv: string) => csv.trimEnd().split("\r\n");

describe("index csv", () => {
  it("has the header and a produced column of yes/no with a reason", () => {
    const out = lines(buildIndexCsv([row({}), row({ frameNumber: 2, fileName: "ssw-t-002.jpg", stuffyName: "Moxie", produced: false, reason: "The portrait is no longer available" })]));
    expect(out[0]).toBe(INDEX_CSV_HEADER.join(","));
    expect(INDEX_CSV_HEADER).toContain("produced");
    const col = INDEX_CSV_HEADER.indexOf("produced");
    expect(out[1].split(",")[col]).toBe("yes");
    expect(out[2]).toContain(",no,The portrait is no longer available,");
  });

  it("a produced=no row with no reason still says why", () => {
    expect(buildIndexCsv([row({ produced: false, reason: "" })])).toContain(",no,not produced,");
  });

  it("escapes a comma or a quote in a name", () => {
    const csv = buildIndexCsv([row({ stuffyName: 'Bear, "Big" Ted' })]);
    expect(csv).toContain('"Bear, ""Big"" Ted"');
  });

  it("neutralises formula triggers and survives a newline in a cell", () => {
    for (const t of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(buildIndexCsv([row({ stuffyName: t })])).toContain(`\t${t}`);
    expect(buildIndexCsv([row({ stuffyName: "Two\nLines" })])).toContain('"Two\nLines"');
  });

  it("withheld rows have no file name or number but are listed", () => {
    const csv = buildIndexCsv([row({ frameNumber: null, fileName: null, produced: false, reason: "No frame: no portrait taken yet" })]);
    expect(lines(csv)[1].startsWith(",,Bear,")).toBe(true);
  });

  it("sorts by parent last name, stuffy, then frame number", () => {
    const sorted = sortIndexRows([row({ parentLast: "Young", stuffyName: "A" }), row({ parentLast: "adams", stuffyName: "Z" }), row({ parentLast: "adams", stuffyName: "B", frameNumber: 9 }), row({ parentLast: "adams", stuffyName: "B", frameNumber: 3 })]);
    expect(sorted.map((r) => `${r.parentLast}/${r.stuffyName}/${r.frameNumber}`)).toEqual(["adams/B/3", "adams/B/9", "adams/Z/1", "Young/A/1"]);
  });
});
