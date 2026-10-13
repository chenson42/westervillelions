import { describe, expect, it } from "vitest";
import type { RetentionScopeStatus, ScopePreview } from "./admin-contract";
import { REASON_WARNING, progressText, purgeDialogCopy, purgeDoneText, previewLines, reasonOk, scopeStateText } from "./retention-ui";

const status = (over: Partial<RetentionScopeStatus>): RetentionScopeStatus => ({ scope: "personal", dueOn: "2027-01-19", purgedAt: null, state: "due", blockers: [], ...over });
const preview: ScopePreview = { status: status({}), photos: 12, photoBytes: 1, orders: 5, stuffies: 6, eventNotes: 0, webhookSnapshots: 0 };

describe("scopeStateText", () => {
  it("purged", () => expect(scopeStateText(status({ state: "purged", purgedAt: "2027-01-20T00:00:00Z" })).badge).toBe("Purged"));
  it("due", () => expect(scopeStateText(status({})).badge).toBe("Due"));
  it("blocked names every reason", () => {
    const t = scopeStateText(status({ state: "blocked", blockers: ["session_open", "before_date"] }));
    expect(t.badge).toBe("Not yet");
    expect(t.text).toContain("the event has not finished yet and the date is 2027-01-19");
  });
});

describe("purgeDialogCopy", () => {
  it("due: no reason needed, states the counts and that it cannot be undone", () => {
    const c = purgeDialogCopy("personal", status({}), preview);
    expect(c.needsReason).toBe(false);
    expect(reasonOk(c, "")).toBe(true);
    expect(c.lines.join(" ")).toContain("12 photos will be deleted.");
    expect(c.lines.at(-1)).toBe("This cannot be undone.");
  });
  it("blocked: a reason is required and the warning exists", () => {
    const c = purgeDialogCopy("public", status({ scope: "public", state: "blocked", blockers: ["before_date"] }), preview);
    expect(c.needsReason).toBe(true);
    expect(reasonOk(c, "   ")).toBe(false);
    expect(reasonOk(c, "Chair asked")).toBe(true);
    expect(REASON_WARNING).toBe("Do not type any family's name here.");
    expect(c.blockedText).toContain("the date is 2027-01-19");
  });
  it("uses singular nouns", () => {
    expect(previewLines("personal", { ...preview, photos: 1, orders: 1, stuffies: 1 }).join(" ")).toContain("1 photo will");
  });
});

describe("progress and done text", () => {
  it("reports counts only", () => {
    expect(progressText(40, 10)).toBe("Deleted 40 photos so far. 10 left. Keep this page open.");
    expect(purgeDoneText("public", { noop: false }, 1)).toBe("Photos taken down. 1 photo deleted.");
    expect(purgeDoneText("personal", { noop: true }, 0)).toBe("That was already done.");
  });
});
