import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkshopPage } from "./workshop-page";
import { bannedHits } from "./banned";
import { WORKSHOP_2026, type WorkshopFacts } from "@/lib/santas-workshop/facts";
import { WORKSHOP_STATES, workshopState, type WorkshopState } from "@/lib/santas-workshop/state";
import { formatMonthDay } from "@/lib/santas-workshop/format";

const URL_SET = "https://www.zeffy.com/ticketing/test-ticket-form";
const INSTANT: Record<WorkshopState, string> = {
  before: "2026-10-20T16:00:00Z",
  open: "2026-11-20T16:00:00Z",
  closed: "2026-12-17T05:00:00Z",
  after: "2026-12-21T05:00:00Z",
};

function render(state: WorkshopState, facts: WorkshopFacts, iso?: string): string {
  return renderToStaticMarkup(<WorkshopPage state={state} facts={facts} now={new Date(iso ?? INSTANT[state])} />);
}
const withUrl: WorkshopFacts = { ...WORKSHOP_2026, zeffyShareUrl: URL_SET };
const noUrl: WorkshopFacts = { ...WORKSHOP_2026, zeffyShareUrl: "" };

function visible(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/\s+/g, " ");
}

describe("the instants map to the states they are named for", () => {
  it.each(WORKSHOP_STATES)("%s", (s) => {
    expect(workshopState(new Date(INSTANT[s]), WORKSHOP_2026)).toBe(s);
  });
});

describe("WorkshopPage", () => {
  it("the Zeffy iframe renders only in open, and only when a URL is set", () => {
    for (const s of WORKSHOP_STATES) {
      expect(render(s, withUrl).includes("<iframe"), `${s} with url`).toBe(s === "open");
      expect(render(s, noUrl).includes("<iframe"), `${s} no url`).toBe(false);
    }
  });

  it("the Zeffy URL string appears nowhere in before, closed or after HTML", () => {
    for (const s of ["before", "closed", "after"] as const) {
      const html = render(s, withUrl);
      expect(html, s).not.toContain("zeffy.com");
      expect(html, s).not.toContain("test-ticket-form");
    }
  });

  it("open with an empty URL shows the not-ready notice and no iframe, no button, no noscript link", () => {
    const html = render("open", noUrl);
    expect(html).toContain("The sign-up form is not ready yet.");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<noscript");
    expect(html).not.toContain("Open the sign-up form in a new tab");
    expect(html).not.toContain('href="#signup"');
  });

  it("the new-tab link has target _blank, rel noopener noreferrer and href equal to the share URL; a noscript block holds a link", () => {
    const html = render("open", withUrl);
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes(`href="${URL_SET}"`));
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
    expect(html).toMatch(/<noscript>[\s\S]*<a [^>]*href="https:\/\/www\.zeffy\.com\/ticketing/);
    expect(html).toMatch(/title="Sign-up form for A Visit to Santa&#x27;s Workshop, powered by Zeffy"/);
    expect(html).toContain('src="https://www.zeffy.com/embed/ticketing/test-ticket-form"');
    expect(html).toContain('allow="payment"');
  });

  it("every state has exactly one h1 and never skips a heading level", () => {
    for (const s of WORKSHOP_STATES) {
      const html = render(s, withUrl);
      expect((html.match(/<h1[ >]/g) ?? []).length, s).toBe(1);
      const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
      let max = 0;
      for (const l of levels) {
        expect(l, `${s} skips to h${l}`).toBeLessThanOrEqual(max + 1);
        max = Math.max(max, l);
      }
    }
  });

  it("no banned pattern appears in the visible text of any state", () => {
    for (const s of WORKSHOP_STATES) {
      for (const f of [withUrl, noUrl]) {
        const text = visible(render(s, f));
        expect(bannedHits(text), s).toEqual([]);
      }
    }
  });

  it("no date or dollar amount appears that is not derived from the facts ($15 and $0 only)", () => {
    const allowed = new Set(
      [
        WORKSHOP_2026.registrationOpens,
        WORKSHOP_2026.lastSignupDay,
        WORKSHOP_2026.dates.dropoff,
        WORKSHOP_2026.dates.photos,
        WORKSHOP_2026.dates.pickup,
        WORKSHOP_2026.signupDataDeletedBy,
      ].map(formatMonthDay),
    );
    for (const s of WORKSHOP_STATES) {
      const text = visible(render(s, withUrl));
      const dates = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g) ?? [];
      for (const d of dates) expect(allowed.has(d), `${s}: ${d}`).toBe(true);
      const dollars = text.match(/\$\d+(\.\d+)?/g) ?? [];
      for (const d of dollars) expect(["$15", "$0"], `${s}: ${d}`).toContain(d);
    }
  });

  it("after you register renders in open (with a form URL) and closed, and in no other state", () => {
    for (const s of WORKSHOP_STATES) {
      expect(render(s, withUrl).includes('id="after-you-register"'), s).toBe(s === "open" || s === "closed");
    }
    expect(render("open", noUrl)).not.toContain('id="after-you-register"');
  });

  it("never says who else may collect; pickup is by the name on the order", () => {
    const text = visible(render("open", withUrl));
    expect(text).not.toContain("Someone else");
    expect(text).toContain("Give the name on the order.");
  });

  it("states the retention as through the end of January 2027, not next year's event", () => {
    const text = visible(render("open", withUrl));
    expect(text).toContain("through the end of January 2027");
    expect(text).not.toMatch(/next year/i);
  });

  it("closed shows the collage link only when collagePath is set; after shows a neutral line when it is not", () => {
    const set = { ...withUrl, collagePath: "/santas-workshop/c/abc" };
    expect(render("closed", set)).toContain('href="/santas-workshop/c/abc"');
    expect(render("closed", withUrl)).not.toContain("/santas-workshop/c/");
    expect(visible(render("after", withUrl))).toContain("Photos: contact the club and we will point you to them.");
    expect(visible(render("after", set))).not.toContain("Photos: contact the club");
  });

  it('before shows "Registration opens Sunday, Nov 8" and no sign-up button', () => {
    const html = render("before", withUrl);
    expect(visible(html)).toContain("Registration opens Sunday, Nov 8");
    expect(html).not.toContain('href="#signup"');
    expect(html).not.toContain("Open the sign-up form");
  });

  it("closed says sign-ups are closed, offers contact, and never says full, sold out or capacity", () => {
    const html = render("closed", withUrl);
    const text = visible(html);
    expect(text).toContain("Sign-ups for this year are closed");
    expect(html).toContain('href="/connect"');
    expect(text).not.toMatch(/\bfull\b|sold out|capacity/i);
  });

  it("after has no iframe, form or register link (art images only); a collage link only when collagePath is set", () => {
    const html = render("after", withUrl);
    expect(html).not.toMatch(/<(iframe|form)\b/);
    for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
      expect(decodeURIComponent(m[1]), "after-state images are art slots only").toContain("/images/santas-workshop/");
    }
    expect(html).not.toContain("#signup");
    expect(html).not.toContain("/santas-workshop/c/");
    const withCollage = render("after", { ...withUrl, collagePath: "/santas-workshop/c/abc" });
    expect(withCollage).toContain('href="/santas-workshop/c/abc"');
    expect(visible(html)).toContain("Thank you for riding with us");
  });

  it("closed puts the focused day first and tags it Today", () => {
    const html = render("closed", withUrl, "2026-12-20T17:00:00Z");
    const first = html.match(/data-day="(\w+)"/);
    expect(first?.[1]).toBe("pickup");
    expect(html).toContain("Today");
    expect(render("closed", withUrl, "2026-12-17T17:00:00Z")).not.toContain("Today");
  });

  it('renders with art supplied: no "Art slot" or "Placeholder" text, and every image is an art-slot file', () => {
    for (const s of WORKSHOP_STATES) {
      const html = render(s, withUrl);
      expect(html, s).not.toMatch(/art slot|placeholder/i);
      for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
        expect(decodeURIComponent(m[1]), s).toContain("/images/santas-workshop/");
      }
    }
  });

  it("the root exposes data-state matching the state", () => {
    for (const s of WORKSHOP_STATES) {
      expect(render(s, withUrl)).toContain(`data-state="${s}"`);
    }
  });
});
