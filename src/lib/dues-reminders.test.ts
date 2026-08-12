import { describe, it, expect } from "vitest";
import {
  seasonLabel,
  formatDuesAmount,
  renderDuesReminderSubject,
  renderDuesReminderBody,
  classifyRecipients,
  isWithinReminderCooldown,
  type FreshStatusRow,
} from "./dues-reminders";

// ── seasonLabel ────────────────────────────────────────────────────────────

describe("seasonLabel", () => {
  it("formats FY2026 as '2026–27'", () => {
    expect(seasonLabel(2026)).toBe("2026–27");
  });

  it("formats FY2025 as '2025–26' (FY-boundary case)", () => {
    expect(seasonLabel(2025)).toBe("2025–26");
  });

  it("handles a century-boundary year without a two-digit truncation bug", () => {
    expect(seasonLabel(1999)).toBe("1999–00");
  });
});

// ── formatDuesAmount ───────────────────────────────────────────────────────

describe("formatDuesAmount", () => {
  it("drops the trailing .00 for a round dollar figure", () => {
    expect(formatDuesAmount(12000)).toBe("$120");
  });

  it("preserves non-round cents", () => {
    expect(formatDuesAmount(9650)).toBe("$96.50");
  });
});

// ── renderDuesReminderSubject ──────────────────────────────────────────────

describe("renderDuesReminderSubject", () => {
  it("returns the exact expected subject line", () => {
    expect(renderDuesReminderSubject(2026)).toBe(
      "A friendly note about your 2026–27 Westerville Lions dues",
    );
  });
});

// ── renderDuesReminderBody ─────────────────────────────────────────────────

const baseInput = {
  firstName: "Jane",
  fiscalYear: 2026,
  individualAmountCents: 12000,
  familyAmountCents: 9600,
  membersDuesUrl: "https://westervillelions.org/members/dues",
  signerFirstName: "Chris",
  signerLastName: "Henson",
};

describe("renderDuesReminderBody — unpaid cohort", () => {
  it("reflects whatever duesSettings amounts are passed in — never hard-coded", () => {
    const bodyA = renderDuesReminderBody("unpaid", {
      ...baseInput,
      individualAmountCents: 12000,
      familyAmountCents: 9600,
    });
    const bodyB = renderDuesReminderBody("unpaid", {
      ...baseInput,
      individualAmountCents: 15000,
      familyAmountCents: 11000,
    });

    expect(bodyA).toContain("$120");
    expect(bodyA).toContain("$96");
    expect(bodyB).toContain("$150");
    expect(bodyB).toContain("$110");
    expect(bodyA).not.toBe(bodyB);
  });

  it("never includes a per-member dollar-owed figure", () => {
    const body = renderDuesReminderBody("unpaid", baseInput);
    // The only dollar figures present are the flat standard-rate amounts,
    // not anything computed from an individual member's balance.
    expect(body).not.toMatch(/you owe/i);
    expect(body).not.toMatch(/balance of \$/i);
    expect(body).not.toMatch(/outstanding.*\$\d/i);
  });
});

describe("renderDuesReminderBody — partial cohort", () => {
  it("never reads as an accusation — no 'haven't paid' / 'have not paid'", () => {
    const body = renderDuesReminderBody("partial", baseInput);
    expect(body.toLowerCase()).not.toContain("haven't paid");
    expect(body.toLowerCase()).not.toContain("have not paid");
  });

  it("still contains the standard-rate sentence", () => {
    const body = renderDuesReminderBody("partial", baseInput);
    expect(body).toContain("$120");
    expect(body).toContain("$96");
  });
});

describe("renderDuesReminderBody — note rendering", () => {
  it("omits the note block when no note is provided", () => {
    const body = renderDuesReminderBody("unpaid", { ...baseInput, note: undefined });
    expect(body).not.toContain("f5f7fb"); // the note's background-color marker
  });

  it("renders a provided note", () => {
    const body = renderDuesReminderBody("unpaid", {
      ...baseInput,
      note: "Thanks for everything you do at the pancake breakfast!",
    });
    expect(body).toContain("Thanks for everything you do at the pancake breakfast!");
  });

  it("HTML-escapes a note containing a script tag (XSS regression)", () => {
    const body = renderDuesReminderBody("unpaid", {
      ...baseInput,
      note: "<script>alert(1)</script>",
    });
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("renderDuesReminderBody — first-name escaping", () => {
  it("HTML-escapes a first name containing < and &", () => {
    const body = renderDuesReminderBody("unpaid", {
      ...baseInput,
      firstName: "<b>Jo & Jo</b>",
    });
    expect(body).not.toContain("<b>Jo & Jo</b>");
    expect(body).toContain("&lt;b&gt;Jo &amp; Jo&lt;/b&gt;");
  });
});

// ── classifyRecipients ─────────────────────────────────────────────────────

describe("classifyRecipients", () => {
  const fresh: FreshStatusRow[] = [
    { memberId: "m-unpaid", status: "unpaid", email: "unpaid@example.com" },
    { memberId: "m-partial", status: "partial", email: "partial@example.com" },
    { memberId: "m-paid", status: "paid", email: "paid@example.com" },
    { memberId: "m-no-email", status: "unpaid", email: "" },
  ];

  it("sends to unpaid and partial members with the correct cohort", () => {
    const { toSend } = classifyRecipients(["m-unpaid", "m-partial"], fresh);
    expect(toSend).toEqual(
      expect.arrayContaining([
        { memberId: "m-unpaid", cohort: "unpaid" },
        { memberId: "m-partial", cohort: "partial" },
      ]),
    );
    expect(toSend).toHaveLength(2);
  });

  it("skips a member who paid between preview and send as now_paid", () => {
    const { skipped } = classifyRecipients(["m-paid"], fresh);
    expect(skipped).toEqual([{ memberId: "m-paid", reason: "now_paid" }]);
  });

  it("skips a member absent from the fresh query as no_longer_active", () => {
    const { skipped } = classifyRecipients(["m-gone"], fresh);
    expect(skipped).toEqual([{ memberId: "m-gone", reason: "no_longer_active" }]);
  });

  it("skips a member with a blank email as no_email_on_file", () => {
    const { skipped } = classifyRecipients(["m-no-email"], fresh);
    expect(skipped).toEqual([{ memberId: "m-no-email", reason: "no_email_on_file" }]);
  });

  it("de-duplicates a memberId requested twice — sent at most once", () => {
    const { toSend } = classifyRecipients(["m-unpaid", "m-unpaid"], fresh);
    expect(toSend).toEqual([{ memberId: "m-unpaid", cohort: "unpaid" }]);
  });
});

// ── isWithinReminderCooldown ───────────────────────────────────────────────

describe("isWithinReminderCooldown", () => {
  const now = new Date("2026-08-12T00:00:00Z");

  it("returns false when there is no prior reminder", () => {
    expect(isWithinReminderCooldown(null, now)).toBe(false);
  });

  it("returns true just under 14 days ago", () => {
    const lastReminded = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000 - 1000));
    expect(isWithinReminderCooldown(lastReminded, now)).toBe(true);
  });

  it("returns false at exactly 14 days ago", () => {
    const lastReminded = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(isWithinReminderCooldown(lastReminded, now)).toBe(false);
  });

  it("returns false well beyond 14 days ago", () => {
    const lastReminded = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isWithinReminderCooldown(lastReminded, now)).toBe(false);
  });
});
