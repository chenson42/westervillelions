import { db } from "@/lib/db";
import { roles, features, roleFeatures } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import PermissionsMatrix from "@/components/admin/permissions-matrix";

/**
 * Permissions Matrix Page
 *
 * Comprehensive view and editor for role-feature permissions.
 */
export default async function PermissionsPage() {
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
