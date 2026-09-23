/**
 * Regression coverage for the defect the coordinator flagged in Phase 4
 * review (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md,
 * Part 2): the $250 acknowledge-affordance threshold was copy-pasted as a
 * bare `amountCents >= 25000` in THREE places — src/components/admin/ledger/
 * txn-donor-actions.tsx, acknowledge-dialog.tsx, and
 * src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx —
 * and the first ticket pass only fixed two of them, so the Acknowledge
 * button silently disagreed about whether a $20 gift was acknowledgeable
 * depending on which page you were looking at it from. That is exactly the
 * class of finding CLAUDE.md treats as a correctness rule ("the same
 * decision implemented in more than two places"), not a style preference.
 *
 * @/lib/acknowledge-dialog-ui.ts is now the single place that figure lives
 * (see its own module-level IMPORTANT comment for why it must stay
 * SEPARATE from deriveAckType()'s IRS-rule threshold, even though both
 * currently key off the same number). This is a static-source check, the
 * same technique admin-page-feature-gates.test.ts already uses in this
 * codebase for the equivalent "don't let this specific mistake come back"
 * guarantee: it fails the suite if a bare `25000` amount comparison
 * reappears in any UI file, rather than trusting nobody ever pastes it back
 * in during a future edit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

// Every source file, anywhere in the app, that is allowed to compare an
// amount to 25000 — because each one encodes a DIFFERENT, legitimately
// independent decision that happens to currently share the same figure:
//   - acknowledge-dialog-ui.ts: the single UI-affordance source of truth
//     this test exists to protect (contains the literal by design).
//   - src/lib/ledger.ts: deriveAckType() — the actual IRS Pub. 1771 rule.
//     Deliberately NOT the same function as the UI helper (see that file's
//     own header comment) — must never be collapsed into it.
//   - src/lib/ledger-queries.ts: listPendingAcknowledgments()'s $250 floor
//     — "needs an IRS letter" queue semantics, explicitly required to never
//     change by this same ticket's non-negotiables.
//   - src/lib/db/schema.ts: ledgerSettings.disbApprovalThresholdCents's
//     *default value* (also $250, coincidentally) — an unrelated
//     disbursement-approval setting, not an acknowledgment threshold at
//     all.
const ALLOWED_FILES = [
  "src/lib/acknowledge-dialog-ui.ts",
  "src/lib/ledger.ts",
  "src/lib/ledger-queries.ts",
  "src/lib/db/schema.ts",
];

// Every UI file this feature touched (or that renders an Acknowledge
// control at all) — the set a future edit is most likely to paste a stray
// threshold copy back into.
const UI_FILES_TO_CHECK = [
  "src/components/admin/ledger/txn-donor-actions.tsx",
  "src/components/admin/ledger/acknowledge-dialog.tsx",
  "src/components/admin/ledger/ack-queue.tsx",
  "src/components/admin/ledger/unlinked-gifts-list.tsx",
  "src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx",
  "src/app/(dashboard)/admin/ledger/donors/page.tsx",
];

describe("acknowledge threshold consolidation — no stray inline 25000 copy", () => {
  it("none of the allowed files is missing (path sanity check, so a rename can't silently disable this test)", () => {
    for (const rel of [...ALLOWED_FILES, ...UI_FILES_TO_CHECK]) {
      expect(() => readFileSync(join(ROOT, rel), "utf8")).not.toThrow();
    }
  });

  it("no UI file re-introduces a bare `25000` amount-threshold literal", () => {
    const offenders: string[] = [];
    for (const rel of UI_FILES_TO_CHECK) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      // Matches an amount-threshold-shaped comparison against 25000 (>=, >,
      // <, <=) — not just any appearance of the digits 25000, so this
      // doesn't false-positive on an unrelated dollar figure that happens
      // to share the string. A UI file should express this exclusively via
      // isUnderAckThreshold()/defaultTypeOverride()/showCourtesyNote().
      const matches = src.match(/(amountCents|amount_cents)\s*(>=|>|<=|<)\s*25000/g);
      if (matches) offenders.push(`${rel}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the donor-detail page's Acknowledge button no longer requires amountCents >= 25000 (the bug this test was added for)", () => {
    const src = readFileSync(
      join(ROOT, "src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx"),
      "utf8",
    );
    expect(src).toContain('row.ackStatus === null && (');
    expect(src).not.toMatch(/row\.ackStatus === null && row\.txn\.amountCents/);
  });
});
