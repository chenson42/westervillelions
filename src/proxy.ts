import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FEATURES } from "@/lib/permissions";

/**
 * Feature-based route protection middleware
 *
 * Checks if authenticated users have the required features to access routes.
 * Redirects to /access-pending if authenticated but lacking permissions.
 */
export async function proxy(request: NextRequest) {
  const session = await auth();

  // Skip middleware for API routes - they handle their own auth
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Public routes - no auth required
  const publicPaths = ["/", "/about", "/mission", "/causes", "/campaigns", "/events", "/donate", "/connect", "/join", "/programs", "/signin", "/register", "/forgot-password", "/reset-password", "/robots.txt", "/sitemap.xml"];
  const publicPrefixes = ["/events/"];
  if (
    publicPaths.some((path) => request.nextUrl.pathname === path) ||
    publicPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

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
  const pathname = request.nextUrl.pathname;

  // Define route protection rules
  const protectionRules: Array<{
    pattern: RegExp;
    requiredFeatures: string[];
    requireAll?: boolean; // Default is ANY
  }> = [
    // Admin routes
    {
      pattern: /^\/admin\/members/,
      requiredFeatures: [FEATURES.MEMBERS_EDIT],
    },
    {
      pattern: /^\/admin\/users/,
      requiredFeatures: [FEATURES.ADMIN_USERS],
    },
    {
      pattern: /^\/admin\/roles/,
      requiredFeatures: [FEATURES.ADMIN_ROLES],
    },
    {
      pattern: /^\/admin\/permissions/,
      requiredFeatures: [FEATURES.ADMIN_ROLES],
    },
    {
      pattern: /^\/admin\/campaigns/,
      requiredFeatures: [FEATURES.CAMPAIGNS_MANAGE],
    },
    {
      pattern: /^\/admin\/groups/,
      requiredFeatures: [FEATURES.GROUPS_MANAGE],
    },
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
