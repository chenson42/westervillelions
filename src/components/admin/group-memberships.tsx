"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Membership = {
  id: string;
  memberId: string;
  firstName: string;
  lastName: string;
  groupRoleId: string;
  roleName: string;
  position: string | null;
};

type AvailableMember = { id: string; firstName: string; lastName: string };
type GroupRole = { id: string; name: string };

export function GroupMemberships({
  groupId,
  memberships: initialMemberships,
  availableMembers,
  groupRoles,
  availablePositions = [],
}: {
  groupId: string;
  memberships: Membership[];
  availableMembers: AvailableMember[];
  groupRoles: GroupRole[];
  availablePositions?: string[];
}) {
  const router = useRouter();
  const [memberships, setMemberships] = useState(initialMemberships);
  const [available, setAvailable] = useState(availableMembers);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState(groupRoles[2]?.id ?? ""); // default to "Member"
  const [selectedPosition, setSelectedPosition] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function handleAdd() {
    if (!selectedMemberId || !selectedRoleId) return;
    setIsAdding(true);

    try {
      const res = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: selectedMemberId, groupRoleId: selectedRoleId, position: selectedPosition || null }),
      });

      if (!res.ok) throw new Error("Failed to add member");

      const created = await res.json();
      const member = available.find((m) => m.id === selectedMemberId)!;
      const role = groupRoles.find((r) => r.id === selectedRoleId)!;

      setMemberships((prev) => [
        ...prev,
        { id: created.id, memberId: member.id, firstName: member.firstName, lastName: member.lastName, groupRoleId: role.id, roleName: role.name, position: selectedPosition || null },
      ]);
      setAvailable((prev) => prev.filter((m) => m.id !== selectedMemberId));
      setSelectedMemberId("");
      setSelectedPosition("");
      toast.success(`${member.firstName} ${member.lastName} added`);
      router.refresh();
    } catch {
      toast.error("Failed to add member");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(membership: Membership) {
    try {
      const res = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId: membership.id }),
      });

      if (!res.ok) throw new Error("Failed to remove member");

      setMemberships((prev) => prev.filter((m) => m.id !== membership.id));
      setAvailable((prev) =>
        [...prev, { id: membership.memberId, firstName: membership.firstName, lastName: membership.lastName }]
          .sort((a, b) => a.lastName.localeCompare(b.lastName))
      );
      toast.success(`${membership.firstName} ${membership.lastName} removed`);
      router.refresh();
    } catch {
      toast.error("Failed to remove member");
    }
  }

  return (
    <div className="space-y-4">
      {/* Current members */}
      {memberships.length === 0 ? (
        <p className="text-sm text-gray-500">No members in this group yet.</p>
      ) : (
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Member</th>
              <th className="py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Position</th>
              <th className="py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Role</th>
              <th className="py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {memberships.map((m) => (
              <tr key={m.id}>
                <td className="py-2 text-sm text-gray-900">{m.firstName} {m.lastName}</td>
                <td className="py-2 text-sm text-gray-700">{m.position || <span className="text-gray-400">—</span>}</td>
                <td className="py-2 text-sm text-gray-500">{m.roleName}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => handleRemove(m)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add member */}
      {available.length > 0 && (
        <div className="flex gap-3 items-end pt-2 border-t border-gray-100">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Add Member</label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select a member...</option>
              {available
                .sort((a, b) => a.lastName.localeCompare(b.lastName))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.lastName}, {m.firstName}
                  </option>
                ))}
            </select>
          </div>
          {availablePositions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Position</label>
              <select
                value={selectedPosition}
                onChange={(e) => setSelectedPosition(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">None</option>
                {availablePositions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {groupRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={!selectedMemberId || isAdding}
            className="px-4 py-2 bg-lions-blue text-white text-sm font-medium rounded-md hover:bg-lions-blue-dark disabled:opacity-50"
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      )}
    </div>
  );
}
