"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAVIGATION as navigation } from "@/lib/permissions";
import { matchNavEntry } from "@/lib/fuzzy-match";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { SuggestionBoxDialog } from "@/components/suggestion-box-dialog";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("../../../package.json") as { version: string };

const RETURN_KEY = "adminReturnTo";

// Renders a nav label with the fuzzy-matched characters emphasized. Plain
// helper (not a component) so this file keeps its one-component-per-file
// shape. Active items are white-on-blue, so the highlight there is gold;
// inactive items highlight in brand blue.
function renderHighlightedLabel(
  text: string,
  positions: number[] | null,
  isActive: boolean
): ReactNode {
  if (!positions || positions.length === 0) return text;
  const matched = new Set(positions);
  return text.split("").map((ch, i) =>
    matched.has(i) ? (
      <span
        key={i}
        className={isActive ? "font-bold text-lions-gold" : "font-bold text-lions-blue"}
      >
        {ch}
      </span>
    ) : (
      ch
    )
  );
}

// NavItem/NavGroup shape and content now live in src/lib/permissions.ts as
// ADMIN_NAVIGATION — the same source the admin-area access gate
// (canAccessAdminArea) reads, so the sidebar's visible sections and who gets
// past the layout gate can never drift apart. See
// docs/work-log/2026-08-05-admin-area-gating.md.

export default function AdminSidebar({
  userFeatures,
  isAdmin = false,
}: {
  userFeatures: string[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [returnTo, setReturnTo] = useState("/");
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // On first entry to admin, save the referrer if it's not an admin page
    const stored = sessionStorage.getItem(RETURN_KEY);
    if (!stored) {
      const ref = typeof document !== "undefined" ? document.referrer : "";
      let url = "/";
      try {
        const refPath = ref ? new URL(ref).pathname : "";
        url = refPath && !refPath.startsWith("/admin") ? refPath : "/members";
      } catch {
        url = "/members";
      }
      sessionStorage.setItem(RETURN_KEY, url);
      setReturnTo(url);
    } else {
      setReturnTo(stored);
    }
  }, []);

  // Admins see all nav items; others are filtered by feature. Groups whose
  // visible items end up empty are dropped so no orphan header renders.
  const visibleGroups = navigation
    .map((group) => ({
      label: group.label,
      items: isAdmin
        ? group.items
        : group.items.filter((item) => {
            if (!item.requiredFeature) return true;
            const required = Array.isArray(item.requiredFeature)
              ? item.requiredFeature
              : [item.requiredFeature];
            return required.some((f) => userFeatures.includes(f));
          }),
    }))
    .filter((group) => group.items.length > 0);

  // Type-to-filter search over the PERMISSION-VISIBLE items only — filtering
  // happens strictly after the feature filter above, so search can never
  // surface an item the user's permissions hide. Matches against label,
  // keywords, and group header; original nav order is preserved (no
  // score-based re-sorting) and groups left with zero matches are dropped.
  const trimmedQuery = searchQuery.trim();
  const filteredGroups = trimmedQuery
    ? visibleGroups
        .map((group) => ({
          label: group.label,
          items: group.items
            .map((item) => ({
              item,
              match: matchNavEntry(trimmedQuery, {
                label: item.name,
                group: group.label,
                keywords: item.keywords,
              }),
            }))
            .filter((entry) => entry.match !== null)
            .map((entry) => ({ item: entry.item, labelPositions: entry.match!.labelPositions })),
        }))
        .filter((group) => group.items.length > 0)
    : visibleGroups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => ({ item, labelPositions: null as number[] | null })),
      }));

  const firstLabeledGroupIndex = filteredGroups.findIndex((group) => group.label !== null);

  // Only the longest matching href is active, so nested pages (e.g.
  // /admin/ledger/compliance) highlight their own item, not every prefix.
  // Computed across all visible items (not per group) so the winner is
  // still the single longest match regardless of which group it's in.
  const activeHref = visibleGroups
    .flatMap((group) => group.items)
    .reduce((best, candidate) => {
      const matches = candidate.href === "/admin"
        ? pathname === "/admin"
        : pathname === candidate.href || pathname.startsWith(candidate.href + "/");
      return matches && candidate.href.length > best.length ? candidate.href : best;
    }, "");

  return (
    <>
      {/* Mobile menu button */}
      <div className="fixed left-0 top-0 z-40 flex h-16 items-center bg-white px-4 shadow-sm lg:hidden">
        <button
          type="button"
          className="rounded-md p-2 text-gray-700 hover:bg-gray-100"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          <span className="sr-only">Open sidebar</span>
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
        <h1 className="ml-4 text-lg font-semibold text-gray-900">Admin</h1>
      </div>

      {/* Sidebar overlay for mobile */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white shadow-lg transition-transform duration-200 lg:translate-x-0 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-2xl">🦁</span>
            <span className="text-lg font-bold text-gray-900">Lions Admin</span>
          </Link>
          <button
            type="button"
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <span className="sr-only">Close sidebar</span>
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <label htmlFor="admin-nav-search" className="sr-only">
            Search admin menu
          </label>
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
              />
            </svg>
            <input
              id="admin-nav-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchQuery) {
                  e.stopPropagation();
                  setSearchQuery("");
                }
              }}
              placeholder="Search menu…"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <span className="sr-only">Clear search</span>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {filteredGroups.length === 0 && (
            <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 text-sm">
              No matches for &ldquo;{trimmedQuery}&rdquo;
            </div>
          )}
          {filteredGroups.map((group, groupIndex) => (
            <div key={group.label ?? "dashboard"}>
              {group.label && (
                <div
                  className={`px-3 ${
                    groupIndex === firstLabeledGroupIndex ? "pt-3" : "pt-5"
                  } pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400`}
                >
                  {group.label}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map(({ item, labelPositions }) => {
                  const isActive = item.href === activeHref;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-lions-blue text-white"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className="text-lg">{item.icon}</span>
                      <span>{renderHighlightedLabel(item.name, labelPositions, isActive)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 space-y-1">
          <button
            type="button"
            onClick={() => {
              setSuggestionOpen(true);
              setIsMobileMenuOpen(false);
            }}
            className="flex w-full items-center space-x-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <span className="text-lg" aria-hidden="true">💡</span>
            <span>Suggestion Box</span>
          </button>
          <Link
            href={returnTo}
            onClick={() => sessionStorage.removeItem(RETURN_KEY)}
            className="flex items-center space-x-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
            <span>Back to Website</span>
          </Link>
          <Link
            href="/admin/release-notes"
            className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <span>Westerville Lions</span>
            <span className="font-mono">v{version}</span>
          </Link>
        </div>
      </div>

      {/* Spacer for mobile */}
      <div className="h-16 lg:hidden" />

      <SuggestionBoxDialog open={suggestionOpen} onOpenChange={setSuggestionOpen} />
    </>
  );
}
