"use client";

/**
 * Client-side permission checking hook
 *
 * Use this in client components to check permissions from session.
 * Permissions are cached in the JWT and refreshed on sign-in.
 */

import { useSession } from "next-auth/react";
import type { FeatureName } from "@/lib/permissions";

export function usePermissions() {
  const { data: session, status } = useSession();

  const features = session?.user?.features || [];
  const roles = session?.user?.roles || [];
  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  /**
   * Check if user has a specific feature
   */
  const hasFeature = (feature: FeatureName): boolean => {
    return features.includes(feature);
  };

  /**
   * Check if user has ANY of the specified features
   */
  const hasAnyFeature = (featuresToCheck: FeatureName[]): boolean => {
    return featuresToCheck.some((feature) => features.includes(feature));
  };

  /**
   * Check if user has ALL of the specified features
   */
  const hasAllFeatures = (featuresToCheck: FeatureName[]): boolean => {
    return featuresToCheck.every((feature) => features.includes(feature));
  };

  /**
   * Check if user has a specific role
   */
  const hasRole = (role: string): boolean => {
    return roles.includes(role);
  };

  /**
   * Check if user has ANY of the specified roles
   */
  const hasAnyRole = (rolesToCheck: string[]): boolean => {
    return rolesToCheck.some((role) => roles.includes(role));
  };

  return {
    features,
    roles,
    isLoading,
    isAuthenticated,
    hasFeature,
    hasAnyFeature,
    hasAllFeatures,
    hasRole,
    hasAnyRole,
  };
}
