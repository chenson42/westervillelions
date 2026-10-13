import { describe, expect, it } from "vitest";
import {
  COLLAGE_COPY,
  REVIEW_INSTRUCTION,
  UNHIDE_NEEDS_PUBLISH,
  latePicturesSentence,
  photoDayPassed,
  adminTileAlt,
  pendingBody,
  pendingHeadline,
  photoMarkers,
  publicTileAlt,
  publishRefusedText,
  publishStatusLine,
  qrText,
  reviewDisabledReason,
} from "./collage-ui";
import { adminErrorMessage } from "./admin-ui";

describe("publish refused copy", () => {
  it("names the count and tells the admin what to do", () => {
    expect(publishRefusedText(3)).toBe("3 group photos have not been reviewed yet. Look through them (hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies), mark them reviewed, then publish.");
    expect(publishRefusedText(1)).toMatch(/^1 group photo has not been reviewed yet\./);
  });
  it("falls back to the plain sentence with no count", () => {
    expect(publishRefusedText()).toMatch(/^Some group photos have not been reviewed yet\./);
    expect(publishRefusedText(0)).toMatch(/^Some group photos/);
  });
  it("agrees with the server code's own sentence on the instruction", () => {
    expect(adminErrorMessage("photos_unreviewed")).toContain("mark them reviewed, then publish");
    expect(publishRefusedText(2)).toContain("mark them reviewed, then publish");
  });
  it("the status line shows the refusal reason before publishing and the live line after", () => {
    expect(publishStatusLine({ published: false }, { groupUnreviewed: 2 })).toContain("2 group photos");
    expect(publishStatusLine({ published: false }, { groupUnreviewed: 0 })).toMatch(/Not published/);
    expect(publishStatusLine({ published: true }, { groupUnreviewed: 5 })).toMatch(/is live/);
  });
});

describe("QR payload", () => {
  it("is the server's string, byte for byte", () => {
    const payload = "https://example.invalid/santas-workshop/c/0123456789abcdef0123456789abcdef?x=1&y=%20Z";
    expect(qrText({ qrPayload: payload })).toBe(payload);
  });
});

describe("review control", () => {
  it("is blocked with no group photos and when all are reviewed, otherwise open", () => {
    expect(reviewDisabledReason({ groupUnreviewed: 0, newestGroupPhotoId: null })).toMatch(/no group photos/);
    expect(reviewDisabledReason({ groupUnreviewed: 0, newestGroupPhotoId: "11111111-1111-4111-8111-111111111111" })).toMatch(/reviewed/);
    expect(reviewDisabledReason({ groupUnreviewed: 2, newestGroupPhotoId: "11111111-1111-4111-8111-111111111111" })).toBeNull();
  });
});

describe("photo markers", () => {
  it("portraits say whether the family agreed", () => {
    expect(photoMarkers({ kind: "portrait", hidden: false, consent: false, reviewed: null, onCollage: false }).consentLabel).toBe("Not on the collage: no consent");
    const yes = photoMarkers({ kind: "portrait", hidden: false, consent: true, reviewed: null, onCollage: true });
    expect(yes.consentTone).toBe("green");
    expect(yes.visibleLabel).toBe("Visible to anyone with the link");
  });
  it("group photos carry a review label and no consent label", () => {
    const m = photoMarkers({ kind: "group", hidden: true, consent: null, reviewed: false, onCollage: false });
    expect(m.consentLabel).toBeNull();
    expect(m.reviewLabel).toBe("Not reviewed yet");
    expect(m.hidden).toBe(true);
    expect(m.visibleLabel).toBeNull();
  });
});

describe("public copy", () => {
  it("pending names the photo day", () => {
    expect(pendingHeadline("2026-12-19")).toBe("The photos arrive on Saturday, Dec 19");
    expect(pendingBody("2026-12-19")).toMatch(/evening/);
    expect(pendingHeadline(null)).toBe("The photos are not here yet");
  });
  it("a past photo day is never shown as a date", () => {
    expect(pendingHeadline("2026-12-19", "2026-12-20")).toBe("The photos are being prepared");
    expect(pendingHeadline("2026-12-19", "2026-12-19")).toBe("The photos arrive on Saturday, Dec 19");
    expect(pendingHeadline("2026-12-19", "2026-10-13")).toBe("The photos arrive on Saturday, Dec 19");
    expect(photoDayPassed(null, "2026-12-20")).toBe(false);
    expect(pendingBody("2026-12-19", "2027-01-02")).not.toMatch(/evening/);
  });
  it("the un-hide hint and the late-pictures sentence", () => {
    expect(UNHIDE_NEEDS_PUBLISH).toBe("This picture returns to the collage when you press Publish late photos.");
    expect(latePicturesSentence(1)).toBe("1 picture taken since the last publish is not yet public.");
    expect(latePicturesSentence(3)).toBe("3 pictures taken since the last publish are not yet public.");
    expect(REVIEW_INSTRUCTION).toBe("Hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies.");
  });
  it("carries the stuffies-only and removal lines", () => {
    expect(COLLAGE_COPY.stuffiesOnly).toBe("We photograph stuffies only, never children.");
    expect(COLLAGE_COPY.removalLead).toBe("Changed your mind, or see someone who should not be in a picture? Email");
    expect(COLLAGE_COPY.removalTail).toBe("and we will take it down.");
    expect(COLLAGE_COPY.removed).toBe("These photos have been removed");
  });
  it("public alt text never contains a name; the admin's portrait alt may", () => {
    expect(publicTileAlt("portrait", 0)).toBe("Stuffy portrait 1");
    expect(publicTileAlt("group", 1)).toBe("Group picture 2");
    expect(adminTileAlt({ kind: "portrait", stuffyName: "Bella" }, 0)).toBe("Portrait of Bella");
  });
});
