import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FEATURES, getAdminProtectionRules } from "@/lib/permissions";

/**
 * Feature-based route protection middleware
 *
 * Checks if authenticated users have the required features to access routes.
 * Redirects to /access-pending if authenticated but lacking permissions.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip middleware for API routes - they handle their own auth
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Only the admin portal and the member portal require authentication.
  // Everything else — every public marketing page AND any URL Next doesn't
  // recognize — must fall through so Next renders the real page, or a real
  // 404, instead of this proxy redirecting unknown paths to /signin. This
  // used to be inverted (an allowlist of known public paths, protect
  // everything else by default), which meant a typo'd or removed URL
  // 307-redirected to /signin rather than 404ing.
  const isProtectedArea = pathname.startsWith("/admin") || pathname.startsWith("/members");
  if (!isProtectedArea) {
    return NextResponse.next();
  }

  const session = await auth();

  // Check authentication first
  if (!session?.user) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Block deactivated accounts — sign them out
  if (session.user.isActive === false) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("error", "deactivated");
    return NextResponse.redirect(signInUrl);
  }

  // Admins bypass all feature checks
  const userRoles = session.user.roles || [];
  if (userRoles.includes("Admin") || session.user.role === "admin") {
    return NextResponse.next();
  }

  const userFeatures = session.user.features || [];

  // Define route protection rules.
  //
  // The admin sub-area rules are DERIVED from ADMIN_NAVIGATION
  // (getAdminProtectionRules(), src/lib/permissions.ts) rather than
  // hand-maintained here. This used to be a hand-written parallel list, and
  // it drifted out of sync with ADMIN_NAVIGATION five times running — every
  // time a new admin area shipped gated on a permission narrower than
  // admin.dashboard, someone forgot to also add a matching rule here, so the
  // intended holder of that narrower permission (budget-committee, twice;
  // ledger; the minutes notetaker; the documents notetaker) was bounced to
  // /access-pending by the ADMIN_DASHBOARD catch-all below before the area's
  // own, correct page-level hasFeature() check ever ran. See
  // docs/work-log/2026-08-05-admin-area-gating.md and
  // docs/work-log/2026-08-09-governance-document-versioning.md (Phase 4
  // loop-back) for the full history and getAdminProtectionRules()'s own doc
  // comment for exactly what guarantee this derivation does and doesn't
  // provide. Each admin page still enforces its own finer-grained
  // requirement (e.g. /admin/ledger/settings still requires LEDGER_MANAGE
  // specifically) — these derived rules only decide who may reach the area
  // at all, same as the hand-written rules they replace.
  const protectionRules: Array<{
    pattern: RegExp;
    requiredFeatures: string[];
    requireAll?: boolean; // Default is ANY
  }> = [
    ...getAdminProtectionRules(),
    {
      pattern: /^\/admin/,
      requiredFeatures: [FEATURES.ADMIN_DASHBOARD],
    },
    // Member portal routes
    {
      pattern: /^\/members/,
      requiredFeatures: [FEATURES.MEMBERS_VIEW],
    },
  ];

  // Check each protection rule
  for (const rule of protectionRules) {
    if (rule.pattern.test(pathname)) {
      const hasPermission = rule.requireAll
        ? rule.requiredFeatures.every((f) => userFeatures.includes(f))
        : rule.requiredFeatures.some((f) => userFeatures.includes(f));

      if (!hasPermission) {
        // User is authenticated but lacks required permissions
        const accessPendingUrl = new URL("/access-pending", request.url);
        return NextResponse.redirect(accessPendingUrl);
      }

      // Permission check passed, allow access
      return NextResponse.next();
    }
  }

  // No specific rule matched, allow access
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
