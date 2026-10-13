import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("admin photos UI", () => {
  it("the QR encodes the server's payload through qrText, never a rebuilt URL", () => {
    const qr = read("collage-qr.tsx");
    expect(qr).toContain("qrText(collage)");
    expect(qr).toContain("toDataURL(text,");
    expect(qr).not.toMatch(/window\.location|collageUrl|origin/);
  });
  it("hide and unpublish go through ConfirmDialog; publish refusal uses the shared sentence", () => {
    const panel = read("photos-panel.tsx");
    expect(panel.match(/<ConfirmDialog/g)?.length).toBe(2);
    expect(panel).toContain("Unpublish the collage?");
    expect(panel).toContain('res.failure.code === "photos_unreviewed"');
    expect(panel).toContain("publishRefusedText(res.failure.count)");
  });
  it("review sends the newest group photo id the admin saw (never a timestamp)", () => {
    expect(read("photos-panel.tsx")).toContain("throughPhotoId: counts.newestGroupPhotoId");
  });
});
