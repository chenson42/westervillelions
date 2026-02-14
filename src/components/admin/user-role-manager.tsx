"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export default function UserRoleManager({
  userId,
  allRoles,
  currentRoleIds,
}: {
  userId: string;
  allRoles: Role[];
  currentRoleIds: string[];
}) {
  const router = useRouter();
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(currentRoleIds)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleToggleRole = (roleId: string) => {
    const newSelectedRoles = new Set(selectedRoles);
    if (newSelectedRoles.has(roleId)) {
      newSelectedRoles.delete(roleId);
    } else {
      newSelectedRoles.add(roleId);
    }
    setSelectedRoles(newSelectedRoles);
  };

  const handleSave = async () => {
    setIsSubmitting(true);

    try {
      // Determine roles to add and remove
      const rolesToAdd = Array.from(selectedRoles).filter(
        (id) => !currentRoleIds.includes(id)
      );
      const rolesToRemove = currentRoleIds.filter(
        (id) => !selectedRoles.has(id)
      );

      // Add roles
      for (const roleId of rolesToAdd) {
        const response = await fetch(`/api/admin/users/${userId}/roles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to add role`);
        }
      }

      // Remove roles
      for (const roleId of rolesToRemove) {
        const response = await fetch(`/api/admin/users/${userId}/roles`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to remove role`);
        }
      }

      toast.success("Roles updated successfully");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update roles");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasChanges =
    selectedRoles.size !== currentRoleIds.length ||
    !Array.from(selectedRoles).every((id) => currentRoleIds.includes(id));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Role Assignment</h2>
        {hasChanges && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="rounded-md bg-lions-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {allRoles.map((role) => {
          const isSelected = selectedRoles.has(role.id);
          return (
            <div
              key={role.id}
              className={`flex items-start rounded-lg border-2 p-4 transition-colors ${
                isSelected
                  ? "border-lions-red bg-red-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex h-5 items-center">
                <input
                  type="checkbox"
                  id={`role-${role.id}`}
                  checked={isSelected}
                  onChange={() => handleToggleRole(role.id)}
                  className="h-4 w-4 rounded border-gray-300 text-lions-red focus:ring-lions-red"
                />
              </div>
              <div className="ml-3 flex-1">
                <label
                  htmlFor={`role-${role.id}`}
                  className="cursor-pointer font-medium text-gray-900"
                >
                  {role.name}
                </label>
                {role.description && (
                  <p className="mt-1 text-sm text-gray-500">
                    {role.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasChanges && (
        <div className="mt-6 rounded-md bg-yellow-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                You have unsaved changes. Click &quot;Save Changes&quot; to update this user&apos;s roles.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
