"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES } from "@/lib/permissions";
import { useState, useEffect } from "react";
import { SuggestionBoxDialog } from "@/components/suggestion-box-dialog";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("../../../package.json") as { version: string };

const RETURN_KEY = "adminReturnTo";

interface NavItem {
  name: string;
  href: string;
  icon: string;
  requiredFeature?: string;
}

interface NavGroup {
  // null = no header rendered (the standalone Dashboard entry)
  label: string | null;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    label: null,
    items: [
      {
        name: "Dashboard",
        href: "/admin",
        icon: "📊",
        requiredFeature: FEATURES.ADMIN_DASHBOARD,
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        name: "Members",
        href: "/admin/members",
        icon: "🦁",
        requiredFeature: FEATURES.MEMBERS_EDIT,
      },
      {
        name: "Users",
        href: "/admin/users",
        icon: "👥",
        requiredFeature: FEATURES.ADMIN_USERS,
      },
      {
        name: "Roles",
        href: "/admin/roles",
        icon: "🔑",
        requiredFeature: FEATURES.ADMIN_ROLES,
      },
      {
        name: "Permissions",
        href: "/admin/permissions",
        icon: "🔒",
        requiredFeature: FEATURES.ADMIN_ROLES,
      },
      {
        name: "Membership",
        href: "/admin/membership",
        icon: "📋",
        requiredFeature: FEATURES.MEMBERSHIP_MANAGE,
      },
      {
        name: "Groups",
        href: "/admin/groups",
        icon: "👨‍👩‍👧‍👦",
        requiredFeature: FEATURES.GROUPS_MANAGE,
      },
    ],
  },
  {
    label: "Treasury",
    items: [
      {
        name: "Dues",
        href: "/admin/dues",
        icon: "💵",
        requiredFeature: FEATURES.DUES_VIEW,
      },
      {
        name: "Ledger",
        href: "/admin/ledger",
        icon: "📒",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Compliance",
        href: "/admin/ledger/compliance",
        icon: "📋",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Reports",
        href: "/admin/ledger/reports",
        icon: "📊",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Donors",
        href: "/admin/ledger/donors",
        icon: "🤝",
        requiredFeature: FEATURES.LEDGER_RECORD,
      },
      {
        name: "Ledger Settings",
        href: "/admin/ledger/settings",
        icon: "⚙️",
        requiredFeature: FEATURES.LEDGER_MANAGE,
      },
    ],
  },
  {
    label: "Engagement",
    items: [
      {
        name: "Events",
        href: "/admin/events",
        icon: "📅",
        requiredFeature: FEATURES.EVENTS_EDIT,
      },
      {
        name: "Campaigns",
        href: "/admin/campaigns",
        icon: "💰",
        requiredFeature: FEATURES.CAMPAIGNS_MANAGE,
      },
      {
        name: "Announcements",
        href: "/admin/announcements",
        icon: "📣",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Testimonials",
        href: "/admin/testimonials",
        icon: "💬",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Programs",
        href: "/admin/programs",
        icon: "👓",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Newsletter",
        href: "/admin/subscriptions",
        icon: "📧",
        requiredFeature: FEATURES.CONTACT_VIEW,
      },
    ],
  },
  {
    label: "Inbox",
    items: [
      {
        name: "Contact",
        href: "/admin/contact",
        icon: "✉️",
        requiredFeature: FEATURES.CONTACT_VIEW,
      },
      {
        name: "Suggestions",
        href: "/admin/suggestions",
        icon: "💡",
        requiredFeature: FEATURES.SUGGESTIONS_VIEW,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        name: "Email Queue",
        href: "/admin/email-queue",
        icon: "📨",
      },
      {
        name: "Sync Log",
        href: "/admin/sync-log",
        icon: "🔄",
      },
      {
        name: "Release Notes",
        href: "/admin/release-notes",
        icon: "📝",
      },
    ],
  },
];

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
            return userFeatures.includes(item.requiredFeature);
          }),
    }))
    .filter((group) => group.items.length > 0);

  const firstLabeledGroupIndex = visibleGroups.findIndex((group) => group.label !== null);

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

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleGroups.map((group, groupIndex) => (
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
                {group.items.map((item) => {
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
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <span className="text-lg">{item.icon}</span>
                      <span>{item.name}</span>
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
