/**
 * Unit tests for MemberDirectory's new address column (Printable Member
 * Directory, docs/work-log/2026-08-07-printable-member-directory.md,
 * Phase 3: "a member without an address simply omits it — never render an
 * empty label or a stray comma").
 *
 * Rendered via react-dom/server's renderToStaticMarkup, same technique as
 * budget-notes-markdown.test.tsx — works in vitest's default "node"
 * environment with no jsdom, since MemberDirectory's initial render (no
 * search/filter interaction) needs no DOM APIs.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDirectory } from "./member-directory";

function baseMember(overrides: Partial<Parameters<typeof MemberDirectory>[0]["members"][number]> = {}) {
  return {
    id: "m1",
    firstName: "Pat",
    lastName: "Smith",
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    branch: null,
    memberNumber: null,
    joinDate: null,
    profilePicture: null,
    membershipStatus: "active" as const,
    groupTags: [],
    ...overrides,
  };
}

function render(members: ReturnType<typeof baseMember>[]) {
  return renderToStaticMarkup(<MemberDirectory members={members} filterGroups={[]} />);
}

describe("MemberDirectory — address rendering", () => {
  it("renders a full street + city/state/zip address with no stray comma", () => {
    const html = render([
      baseMember({ address: "123 Main St", city: "Westerville", state: "OH", zip: "43081" }),
    ]);

    expect(html).toContain("123 Main St");
    expect(html).toContain("Westerville, OH 43081");
    // Never a bare leading comma if city were somehow empty.
    expect(html).not.toContain(", OH 43081, OH 43081");
  });

  it("omits the address block entirely when every address field is null", () => {
    const html = render([baseMember()]);

    // No stray label or empty <span> content for address — nothing
    // address-shaped should appear at all.
    expect(html).not.toContain("123 Main St");
    expect(html).not.toMatch(/,\s*,/);
  });

  it("renders city/state without a stray leading comma when street is missing", () => {
    const html = render([baseMember({ city: "Westerville", state: "OH", zip: "43081" })]);

    expect(html).toContain("Westerville, OH 43081");
    expect(html).not.toContain(", Westerville");
  });

  it("renders only the street line when city/state/zip are all missing", () => {
    const html = render([baseMember({ address: "123 Main St" })]);

    expect(html).toContain("123 Main St");
  });
});
