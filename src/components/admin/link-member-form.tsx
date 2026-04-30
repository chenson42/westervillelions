"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  userId: string;
  linkedMemberId: string | null;
  linkedMemberName: string | null;
  allMembers: { id: string; firstName: string; lastName: string }[];
}

export function LinkMemberForm({
  userId,
  linkedMemberId,
  linkedMemberName,
  allMembers,
}: Props) {
  const router = useRouter();
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  async function handleLink() {
    if (!selectedMemberId) return;

    setIsLinking(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/link-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: selectedMemberId }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to link member");
        return;
      }

      toast.success("Member linked successfully");
      setSelectedMemberId("");
      router.refresh();
    } catch {
      toast.error("Failed to link member");
    } finally {
      setIsLinking(false);
    }
  }

  async function handleUnlink() {
    setIsUnlinking(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/link-member`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to unlink member");
        return;
      }

      toast.success("Member unlinked");
      router.refresh();
    } catch {
      toast.error("Failed to unlink member");
    } finally {
      setIsUnlinking(false);
    }
  }

  // Sort members alphabetically by last name, then first name
  const sortedMembers = [...allMembers].sort((a, b) => {
    const last = a.lastName.localeCompare(b.lastName);
    if (last !== 0) return last;
    return a.firstName.localeCompare(b.firstName);
  });

  return (
    <div className="space-y-4">
      {/* Current link status */}
      <div className="flex items-center gap-3">
        {linkedMemberId && linkedMemberName ? (
          <>
            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              Linked to {linkedMemberName}
            </span>
            <button
              onClick={handleUnlink}
              disabled={isUnlinking}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              {isUnlinking ? "Unlinking…" : "Unlink"}
            </button>
          </>
        ) : (
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            Not linked
          </span>
        )}
      </div>

      {/* Link selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedMemberId}
          onChange={(e) => setSelectedMemberId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          <option value="">Select a member…</option>
          {sortedMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName}
            </option>
          ))}
        </select>
        <button
          onClick={handleLink}
          disabled={!selectedMemberId || isLinking}
          className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-50 whitespace-nowrap"
        >
          {isLinking ? "Linking…" : "Link"}
        </button>
      </div>
    </div>
  );
}
