/**
 * RowHighlighter logic. Node env (no jsdom in this repo), so the DOM is a
 * small fake behind the HighlightDoc interface the component exports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { findVisibleRow, runRowHighlight, type HighlightElement } from "./row-highlighter";

function fakeEl(visible: boolean) {
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  const add = vi.fn();
  const remove = vi.fn();
  const el: HighlightElement = {
    scrollIntoView,
    focus,
    getClientRects: () => (visible ? [{}] : []),
    classList: { add, remove },
  };
  return { el, scrollIntoView, focus, add, remove };
}

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("runRowHighlight, default mode", () => {
  it("adds the ring, removes it after 2.5s, and strips ?highlight", () => {
    const el = fakeEl(true);
    const strip = vi.fn();
    runRowHighlight({
      doc: { getElementById: (id) => (id === `txn-${ID}` ? el.el : null), querySelectorAll: () => [] },
      targetId: ID,
      idPrefix: "txn-",
      persistent: false,
      stripHighlight: strip,
    });
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(el.add).toHaveBeenCalledWith("ring-2", "ring-lions-gold", "bg-lions-gold/10");
    expect(el.remove).not.toHaveBeenCalled();
    expect(strip).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2500);
    expect(el.remove).toHaveBeenCalledWith("ring-2", "ring-lions-gold", "bg-lions-gold/10");
  });

  it("still strips the param when the element is missing", () => {
    const strip = vi.fn();
    runRowHighlight({
      doc: { getElementById: () => null, querySelectorAll: () => [] },
      targetId: ID,
      idPrefix: "txn-",
      persistent: false,
      stripHighlight: strip,
    });
    expect(strip).toHaveBeenCalledTimes(1);
  });
});

describe("runRowHighlight, persistent mode", () => {
  it("scrolls and focuses the visible match, never touching classes or the URL", () => {
    const hidden = fakeEl(false);
    const shown = fakeEl(true);
    const strip = vi.fn();
    const selectors: string[] = [];
    runRowHighlight({
      doc: {
        getElementById: () => null,
        querySelectorAll: (sel) => {
          selectors.push(sel);
          return [hidden.el, shown.el];
        },
      },
      targetId: ID,
      idPrefix: "txn-",
      persistent: true,
      stripHighlight: strip,
    });
    expect(selectors).toEqual([`[data-row-id="${ID}"]`]);
    expect(hidden.scrollIntoView).not.toHaveBeenCalled();
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(shown.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(shown.focus).toHaveBeenCalledTimes(1);
    for (const el of [hidden, shown]) {
      expect(el.add).not.toHaveBeenCalled();
      expect(el.remove).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(10_000);
    expect(shown.remove).not.toHaveBeenCalled();
    expect(strip).not.toHaveBeenCalled();
  });

  it("does nothing when no match is rendered", () => {
    const strip = vi.fn();
    expect(() =>
      runRowHighlight({
        doc: { getElementById: () => null, querySelectorAll: () => [] },
        targetId: ID,
        idPrefix: "txn-",
        persistent: true,
        stripHighlight: strip,
      }),
    ).not.toThrow();
    expect(strip).not.toHaveBeenCalled();
  });
});

describe("findVisibleRow", () => {
  it("returns null when every match is hidden", () => {
    expect(
      findVisibleRow({ getElementById: () => null, querySelectorAll: () => [fakeEl(false).el] }, ID),
    ).toBeNull();
  });

  it("strips quotes from the id before building the selector", () => {
    const selectors: string[] = [];
    findVisibleRow(
      { getElementById: () => null, querySelectorAll: (s) => (selectors.push(s), []) },
      'a"]b',
    );
    expect(selectors[0]).toBe('[data-row-id="a]b"]');
  });
});
