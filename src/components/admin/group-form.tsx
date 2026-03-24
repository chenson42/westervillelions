"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type GroupType = { id: string; name: string };
type Group = {
  id: string;
  name: string;
  description: string | null;
  groupTypeId: string;
  isActive: boolean;
};

export function GroupForm({
  groupTypes,
  group,
}: {
  groupTypes: GroupType[];
  group?: Group;
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isEdit = !!group;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name"),
      description: formData.get("description") || null,
      groupTypeId: formData.get("groupTypeId"),
      isActive: formData.get("isActive") === "true",
    };

    try {
      const res = await fetch(
        isEdit ? `/api/admin/groups/${group.id}` : "/api/admin/groups",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }

      toast.success(isEdit ? "Group updated" : "Group created");
      router.push("/admin/groups");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save group");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!group) return;
    if (!confirm(`Delete "${group.name}"? This will also remove all memberships.`)) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/groups/${group.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Group deleted");
      router.push("/admin/groups");
      router.refresh();
    } catch {
      toast.error("Failed to delete group");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
        <input
          type="text"
          name="name"
          defaultValue={group?.name}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-lions-blue focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <select
          name="groupTypeId"
          defaultValue={group?.groupTypeId}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-lions-blue focus:border-transparent"
        >
          <option value="">Select a type...</option>
          {groupTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          name="description"
          defaultValue={group?.description ?? ""}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-lions-blue focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
        <select
          name="isActive"
          defaultValue={group?.isActive !== false ? "true" : "false"}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-lions-blue focus:border-transparent"
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark disabled:opacity-60"
          >
            {isSaving ? "Saving..." : isEdit ? "Save Changes" : "Create Group"}
          </button>
          <a
            href="/admin/groups"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </a>
        </div>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded-md px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {isDeleting ? "Deleting..." : "Delete Group"}
          </button>
        )}
      </div>
    </form>
  );
}
