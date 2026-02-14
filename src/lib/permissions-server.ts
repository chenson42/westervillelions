/**
 * Server-side permission checking with caching
 *
 * Use this for server components and API routes.
 * Caches permissions for 60 seconds to balance performance and freshness.
 */

import { db } from "@/lib/db";
import { userRoles, roles, roleFeatures, features } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FEATURES, ROLES, type FeatureName } from "@/lib/permissions";

// Permission cache (60-second TTL)
const permissionCache = new Map<string, { features: string[]; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Get all features for a user (with caching)
 * @param userId User ID
 * @returns Array of feature names
 */
export async function getUserFeatures(userId: string): Promise<string[]> {
  // Check cache
  const cached = permissionCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.features;
  }

  // Get user's roles
  const userRoleRecords = await db
    .select({
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleNames = userRoleRecords.map((r) => r.roleName);

  // Admin gets ALL features (safeguard against lockout)
  if (roleNames.includes(ROLES.ADMIN)) {
    const allFeatures = await db.select({ name: features.name }).from(features);
    const featureNames = allFeatures.map((f) => f.name);

    // Cache and return
    permissionCache.set(userId, { features: featureNames, timestamp: Date.now() });
    return featureNames;
  }

  // Get features for user's roles
  const featureRecords = await db
    .selectDistinct({ name: features.name })
    .from(roleFeatures)
    .innerJoin(features, eq(roleFeatures.featureId, features.id))
    .innerJoin(roles, eq(roleFeatures.roleId, roles.id))
    .innerJoin(userRoles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const featureNames = featureRecords.map((f) => f.name);

  // Cache and return
  permissionCache.set(userId, { features: featureNames, timestamp: Date.now() });
  return featureNames;
}

/**
 * Check if user has a specific feature
 * @param userId User ID
 * @param feature Feature name to check
 * @returns Boolean indicating if user has the feature
 */
export async function hasFeature(
  userId: string,
  feature: FeatureName
): Promise<boolean> {
  const userFeatures = await getUserFeatures(userId);
  return userFeatures.includes(feature);
}

/**
 * Check if user has ANY of the specified features
 * @param userId User ID
 * @param features Array of feature names
 * @returns Boolean indicating if user has at least one feature
 */
export async function hasAnyFeature(
  userId: string,
  features: FeatureName[]
): Promise<boolean> {
  const userFeatures = await getUserFeatures(userId);
  return features.some((feature) => userFeatures.includes(feature));
}

/**
 * Check if user has ALL of the specified features
 * @param userId User ID
 * @param features Array of feature names
 * @returns Boolean indicating if user has all features
 */
export async function hasAllFeatures(
  userId: string,
  features: FeatureName[]
): Promise<boolean> {
  const userFeatures = await getUserFeatures(userId);
  return features.every((feature) => userFeatures.includes(feature));
}

/**
 * Require feature or throw error
 * @param userId User ID
 * @param feature Feature name to require
 * @throws Error if user doesn't have the feature
 */
export async function requireFeature(
  userId: string,
  feature: FeatureName
): Promise<void> {
  const hasPermission = await hasFeature(userId, feature);
  if (!hasPermission) {
    throw new Error(`Missing required permission: ${feature}`);
  }
}

/**
 * Clear permission cache for a user (call after role/permission changes)
 * @param userId User ID
 */
export function clearUserPermissionCache(userId: string): void {
  permissionCache.delete(userId);
}

/**
 * Clear all permission caches (call after system-wide permission changes)
 */
export function clearAllPermissionCaches(): void {
  permissionCache.clear();
}

/**
 * Get features from session (client-side cached in JWT)
 * Use this when you already have the session object
 * @param session NextAuth session
 * @returns Array of feature names
 */
export function getFeaturesFromSession(session: {
  user?: { features?: string[] };
}): string[] {
  return session?.user?.features || [];
}

/**
 * Check if session has a specific feature
 * @param session NextAuth session
 * @param feature Feature name to check
 * @returns Boolean indicating if session has the feature
 */
export function sessionHasFeature(
  session: { user?: { features?: string[] } },
  feature: FeatureName
): boolean {
  const features = getFeaturesFromSession(session);
  return features.includes(feature);
}
