import { db } from "@/lib/db";
import { roles, features, roleFeatures } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import PermissionsMatrix from "@/components/admin/permissions-matrix";

/**
 * Permissions Matrix Page
 *
 * Comprehensive view and editor for role-feature permissions.
 */
export default async function PermissionsPage() {
  // Page-level gate — this page rendered the entire role/feature/
  // role-feature matrix unconditionally, with no auth() or hasFeature()
  // call of its own, since the original commit. It was never live-
  // exploitable (the proxy's hand-written "permissions" segment rule has
  // always required ADMIN_ROLES, unchanged by DECISION-082), but it's the
  // identical missing-defense-in-depth shape as the /admin/subscriptions
  // defect and was flagged as a non-blocking follow-up in that work-log's
  // Phase 5 re-verification. Matching the "Permissions" nav item's own
  // declared requiredFeature (ADMIN_NAVIGATION) and every sibling page's
  // pattern (e.g. /admin/roles).
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.ADMIN_ROLES);
  if (!canAccess) redirect("/admin");

  // Fetch all roles and features
  const [allRoles, allFeatures] = await Promise.all([
    db.select().from(roles).orderBy(roles.sortOrder),
    db.select().from(features).orderBy(features.category, features.name),
  ]);

  // Fetch current role-feature mappings
  const mappings = await db.select().from(roleFeatures);

  // Create a map of role-feature assignments
  const assignmentMap = new Map<string, Set<string>>();
  mappings.forEach((mapping) => {
    const key = `${mapping.roleId}-${mapping.featureId}`;
    if (!assignmentMap.has(mapping.roleId)) {
      assignmentMap.set(mapping.roleId, new Set());
    }
    assignmentMap.get(mapping.roleId)!.add(mapping.featureId);
  });

  // Convert to a simpler format for the client
  const assignments: Record<string, string[]> = {};
  assignmentMap.forEach((featureIds, roleId) => {
    assignments[roleId] = Array.from(featureIds);
  });

  // Group features by category
  const featuresByCategory = allFeatures.reduce((acc, feature) => {
    if (!acc[feature.category]) {
      acc[feature.category] = [];
    }
    acc[feature.category].push(feature);
    return acc;
  }, {} as Record<string, typeof allFeatures>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Permissions Matrix</h1>
        <p className="mt-2 text-gray-600">
          Manage which features are available to each role
        </p>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> The admin role automatically has access to
              all features as a safeguard against lockout. Changes to admin
              permissions in this matrix will not affect actual admin access.
            </p>
          </div>
        </div>
      </div>

      {/* Permissions matrix */}
      <PermissionsMatrix
        roles={allRoles}
        featuresByCategory={featuresByCategory}
        initialAssignments={assignments}
      />
    </div>
  );
}
