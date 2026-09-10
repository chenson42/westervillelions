"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface Feature {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

export default function PermissionsMatrix({
  roles,
  featuresByCategory,
  initialAssignments,
}: {
  roles: Role[];
  featuresByCategory: Record<string, Feature[]>;
  initialAssignments: Record<string, string[]>;
}) {
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>(
    () => {
      const map: Record<string, Set<string>> = {};
      Object.entries(initialAssignments).forEach(([roleId, featureIds]) => {
        map[roleId] = new Set(featureIds);
      });
      return map;
    }
  );
  const [isSaving, setIsSaving] = useState(false);

  const isAssigned = (roleId: string, featureId: string): boolean => {
    return assignments[roleId]?.has(featureId) || false;
  };

  const handleToggle = async (roleId: string, featureId: string) => {
    // Guard against overlapping toggles — the UI below disables every
    // checkbox while a request is in flight, but this is a second line of
    // defense (e.g. a change fired before React re-renders the disabled state).
    if (isSaving) return;

    const newAssignments = { ...assignments };
    if (!newAssignments[roleId]) {
      newAssignments[roleId] = new Set();
    }

    const isCurrentlyAssigned = newAssignments[roleId].has(featureId);

    // Optimistically update UI
    if (isCurrentlyAssigned) {
      newAssignments[roleId].delete(featureId);
    } else {
      newAssignments[roleId].add(featureId);
    }
    setAssignments(newAssignments);
    setIsSaving(true);

    // Send API request
    try {
      const response = await fetch(`/api/admin/roles/${roleId}/features`, {
        method: isCurrentlyAssigned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId }),
      });

      if (!response.ok) {
        throw new Error("Failed to update permission");
      }

      toast.success(
        isCurrentlyAssigned ? "Permission removed" : "Permission granted"
      );
    } catch {
      // Revert on error
      if (isCurrentlyAssigned) {
        newAssignments[roleId].add(featureId);
      } else {
        newAssignments[roleId].delete(featureId);
      }
      setAssignments({ ...newAssignments });
      toast.error("Failed to update permission");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {isSaving && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-lions-blue/5 px-4 py-2 text-sm font-medium text-lions-blue"
        >
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Saving…
        </div>
      )}
      {Object.entries(featuresByCategory).map(([category, features]) => (
        <div
          key={category}
          className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow"
        >
          {/* Category header */}
          <div className="bg-gray-50 px-6 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-700">
              {category}
            </h3>
          </div>

          {/* Matrix table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Feature
                  </th>
                  {roles.map((role) => (
                    <th
                      key={role.id}
                      className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      <div className="flex flex-col items-center">
                        <span>{role.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {features.map((feature) => (
                  <tr key={feature.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-6 py-4">
                      <div className="min-w-[200px]">
                        <div className="text-sm font-medium text-gray-900">
                          {feature.name}
                        </div>
                        {feature.description && (
                          <div className="text-xs text-gray-500">
                            {feature.description}
                          </div>
                        )}
                      </div>
                    </td>
                    {roles.map((role) => {
                      const assigned = isAssigned(role.id, feature.id);
                      const isAdmin = role.name === "admin";

                      return (
                        <td
                          key={`${role.id}-${feature.id}`}
                          className="px-4 py-4 text-center"
                        >
                          <div className="flex justify-center">
                            {isAdmin ? (
                              <div className="flex h-5 w-5 items-center justify-center">
                                <svg
                                  className="h-5 w-5 text-green-500"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </div>
                            ) : (
                              <input
                                type="checkbox"
                                checked={assigned}
                                disabled={isSaving}
                                onChange={() => handleToggle(role.id, feature.id)}
                                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
