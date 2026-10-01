/** C39: the closed-session guided checklist. Static markup, no DOM. */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MoveUnlockChecklist from "./move-unlock-checklist";
import { formatSessionPeriod } from "./correction-dialog-logic";
import { CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE, type MoveDestination, type MoveUnlock } from "@/lib/ledger-correction";

const SESSION = "5e000000-0000-4000-8000-000000000001";
const LATER_1 = "5e000000-0000-4000-8000-000000000003";
const LATER_2 = "5e000000-0000-4000-8000-000000000002";

function dest(unlock: Partial<MoveUnlock> & Pick<MoveUnlock, "kind">): MoveDestination {
  return {
    fundId: "a0000000-0000-4000-8000-0000000000a1",
    name: "Activity Fund",
    kind: "activity",
    entity: { id: "e1", slug: "club", name: "Club" },
    crossEntity: true,
    tier: { required: "manage", reasons: ["cross_entity"] },
    allowed: false,
    denial: {
      code: "reconciled_session",
      status: 403,
      reason: "x",
      unlock: {
        session: {
          id: SESSION,
          bankAccountName: "Foundation Checking",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          status: "closed",
        },
        laterClosedSessions: [],
        otherMatchesOnLine: 0,
        statementMonth: "2026-08",
        statementAlreadySent: false,
        ...unlock,
      },
    },
  };
}

const render = (d: MoveDestination, canManage = true) =>
  renderToStaticMarkup(
    <MoveUnlockChecklist destination={d} sourceEntityName="Foundation" callerCanManage={canManage} onCheckAgain={() => {}} />,
  );

describe("MoveUnlockChecklist (C39)", () => {
  it("names the session and account, and lays out three numbered steps", () => {
    const html = render(dest({ kind: "closed_session" }));
    expect(html).toContain("Before this can move");
    expect(html).toContain("Foundation Checking reconciliation session for Aug 1 to Aug 31, 2026");
    expect(html).toContain("<ol");
    expect(html).toContain(`href="/admin/ledger/reconciliation/${SESSION}"`);
    expect(html).toContain("Unmatch this gift from its bank line");
    expect(html).toContain("Move to the Club");
    expect(html).toContain("Check again");
  });

  it("says plainly that the month is hidden from members until the session is closed again", () => {
    const html = render(dest({ kind: "closed_session" }));
    expect(html).toContain("hidden from members until you close the session again");
    expect(html).toContain("monthly statements from August 2026 onward");
  });

  it("lists later closed sessions newest first, each linked", () => {
    const html = render(
      dest({
        kind: "closed_session",
        laterClosedSessions: [
          { id: LATER_1, periodStart: "2026-10-01", periodEnd: "2026-10-31" },
          { id: LATER_2, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
        ],
      }),
    );
    expect(html).toContain("cannot be reopened while a later one");
    expect(html.indexOf(LATER_1)).toBeGreaterThan(-1);
    expect(html.indexOf(LATER_1)).toBeLessThan(html.indexOf(LATER_2));
    expect(html).toContain("Reopen Oct 1 to Oct 31, 2026 first");
  });

  it("the statement-already-sent line appears only when true", () => {
    expect(render(dest({ kind: "closed_session" }))).not.toContain("was already sent");
    expect(render(dest({ kind: "closed_session", statementAlreadySent: true }))).toContain(
      "The August 2026 statement was already sent; you will be offered a corrected resend.",
    );
  });

  it("the batch line appears only when other entries share the bank line", () => {
    expect(render(dest({ kind: "closed_session" }))).not.toContain("other entr");
    const html = render(dest({ kind: "closed_session", otherMatchesOnLine: 2 }));
    expect(html).toContain("matched to 2 other entries too");
  });

  it("carries the after-the-move note about the freed bank line", () => {
    expect(render(dest({ kind: "closed_session" }))).toContain("the bank line this gift was matched to is free");
  });

  it("a record-only caller still sees the checklist, with the Manage Ledger line", () => {
    const html = render(dest({ kind: "closed_session" }), false);
    expect(html).toContain("Reopening needs the Manage Ledger permission, held by the Admin role.");
    expect(render(dest({ kind: "closed_session" }), true)).not.toContain("Reopening needs");
  });

  it("matched_open_session shows only the unmatch step; legacy shows only the un-mark step", () => {
    const open = render(dest({ kind: "matched_open_session", statementMonth: null }));
    expect(open).not.toContain("Reopen ");
    expect(open).toContain("Unmatch this gift");
    expect(open).toContain("the bank line this gift was matched to is free");
    const legacy = render(dest({ kind: "legacy_reconciled", session: null }));
    expect(legacy).toContain("Un-mark it as reconciled first");
    expect(legacy).not.toContain("Unmatch");
    expect(legacy).not.toContain("is free");
    expect(render(dest({ kind: "legacy_reconciled", session: null }), false)).toContain(
      CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE,
    );
  });

  it("renders nothing without an unlock block", () => {
    const d = dest({ kind: "closed_session" });
    delete d.denial!.unlock;
    expect(render(d)).toBe("");
  });
});

describe("formatSessionPeriod", () => {
  it("compresses the year within one year and names both across a year", () => {
    expect(formatSessionPeriod("2026-09-01", "2026-09-30")).toBe("Sep 1 to Sep 30, 2026");
    expect(formatSessionPeriod("2025-12-01", "2026-01-31")).toBe("Dec 1, 2025 to Jan 31, 2026");
  });
});
