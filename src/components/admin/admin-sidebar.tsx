"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES } from "@/lib/permissions";
import { useState } from "react";

interface NavItem {
  name: string;
  href: string;
  icon: string;
  requiredFeature?: string;
}

const navigation: NavItem[] = [
  {
    name: "Dashboard",
    href: "/admin",
    icon: "📊",
    requiredFeature: FEATURES.ADMIN_DASHBOARD,
  },
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
    name: "Groups",
    href: "/admin/groups",
    icon: "👨‍👩‍👧‍👦",
    requiredFeature: FEATURES.GROUPS_MANAGE,
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

  // Admins see all nav items; others are filtered by feature
  const visibleNavItems = isAdmin
    ? navigation
    : navigation.filter((item) => {
        if (!item.requiredFeature) return true;
        return userFeatures.includes(item.requiredFeature);
      });

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
          {visibleNavItems.map((item) => {
            const isActive = item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(item.href + "/");
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
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4">
          <Link
            href="/"
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
        </div>
      </div>

      {/* Spacer for mobile */}
      <div className="h-16 lg:hidden" />
    </>
  );
}
