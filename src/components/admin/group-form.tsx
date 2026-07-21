"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type GroupType = { id: string; name: string };
type Group = {
  id: string;
  name: string;
  description: string | null;
  groupTypeId: string;
  color: string | null;
  availablePositions: string | null;
  showInDirectory: boolean;
  showPositionAsTag: boolean;
  isActive: boolean;
  emailPrefix?: string | null;
  googleGroupSyncedAt?: Date | string | null;
  googleGroupSyncError?: string | null;
};

export function GroupForm({
  groupTypes,
  group,
}: {
  groupTypes: GroupType[];
  group?: Group;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [emailPrefix, setEmailPrefix] = useState(group?.emailPrefix ?? "");
  const [syncedAt, setSyncedAt] = useState<string | null>(
    group?.googleGroupSyncedAt ? new Date(group.googleGroupSyncedAt).toLocaleString() : null
  );
  const [syncError, setSyncError] = useState<string | null>(group?.googleGroupSyncError ?? null);
  const isEdit = !!group;

  function buildPayload(form: HTMLFormElement) {
    const formData = new FormData(form);
    const positionsRaw = (formData.get("availablePositions") as string || "").trim();
    const positions = positionsRaw
      ? positionsRaw.split("\n").map((p) => p.trim()).filter(Boolean)
      : [];

    return {
      name: formData.get("name"),
      description: formData.get("description") || null,
      groupTypeId: formData.get("groupTypeId"),
      color: formData.get("color") || null,
      availablePositions: positions.length > 0 ? JSON.stringify(positions) : null,
      showInDirectory: formData.get("showInDirectory") === "on",
      showPositionAsTag: formData.get("showPositionAsTag") === "on",
      isActive: formData.get("isActive") === "true",
      emailPrefix: (formData.get("emailPrefix") as string || "").trim() || null,
    };
  }

  async function saveCurrent() {
    if (!group || !formRef.current) return;
    const data = buildPayload(formRef.current);
    const res = await fetch(`/api/admin/groups/${group.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);

    const data = buildPayload(e.currentTarget);

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

  async function handleSync() {
    if (!group || !emailPrefix.trim()) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      // Persist any pending edits (especially a new emailPrefix) before syncing.
      await saveCurrent();
      const res = await fetch(`/api/admin/groups/${group.id}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const msg = json.error || "Sync failed";
        setSyncError(msg);
        toast.error(msg);
      } else {
        setSyncedAt(new Date().toLocaleString());
        const added = json.added?.length ?? 0;
        const removed = json.removed?.length ?? 0;
        if (added === 0 && removed === 0) {
          toast.success("Google Group is already up to date — no changes needed");
        } else {
          const parts = [];
          if (added > 0) parts.push(`${added} added (${json.added.join(", ")})`);
          if (removed > 0) parts.push(`${removed} removed (${json.removed.join(", ")})`);
          toast.success(`Synced: ${parts.join(" · ")}`);
        }
      }
    } catch {
      const msg = "Failed to connect to sync service";
      setSyncError(msg);
      toast.error(msg);
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 max-w-lg">
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            name="color"
            defaultValue={group?.color ?? "#1a56db"}
            className="h-10 w-16 cursor-pointer rounded border border-gray-300 p-1"
          />
          <span className="text-sm text-gray-500">Used as a badge color in the member directory</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Member Directory</label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            name="showInDirectory"
            defaultChecked={group?.showInDirectory ?? false}
            className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
          />
          Show group tag on member cards
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            name="showPositionAsTag"
            defaultChecked={group?.showPositionAsTag ?? false}
            className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
          />
          Show position as tag (instead of group name)
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Available Positions <span className="text-gray-400 font-normal">(one per line, optional)</span>
        </label>
        <textarea
          name="availablePositions"
          defaultValue={group?.availablePositions ? JSON.parse(group.availablePositions).join("\n") : ""}
          rows={4}
          placeholder={"President\nVice President\nSecretary\nTreasurer"}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-lions-blue focus:border-transparent text-sm"
        />
      </div>

      {isEdit && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Google Groups Sync</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Prefix
            </label>
            <div className="flex flex-wrap items-stretch">
              <input
                type="text"
                name="emailPrefix"
                value={emailPrefix}
                onChange={(e) => setEmailPrefix(e.target.value)}
                placeholder="committee-name"
                className="min-w-[140px] flex-1 rounded-l-md rounded-r-md border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-lions-blue text-sm sm:rounded-r-none"
              />
              <span className="inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-500 select-none sm:rounded-l-none sm:border-l-0">
                @westervillelions.org
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Set an email prefix to enable syncing this group to a Google Group.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing || !emailPrefix.trim()}
              className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? "Syncing..." : "Sync Now"}
            </button>
            {syncedAt && !syncError && (
              <span className="text-xs text-gray-500">Last synced: {syncedAt}</span>
            )}
          </div>

          {syncError && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Sync error: {syncError}
            </p>
          )}
          {!syncError && syncedAt && (
            <p className="text-xs text-green-700">
              Google Group is up to date.
            </p>
          )}
        </div>
      )}

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
          <>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={isDeleting}
              className="rounded-md px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {isDeleting ? "Deleting..." : "Delete Group"}
            </button>
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={`Delete "${group?.name}"?`}
              description="This will permanently delete the group and remove all memberships. This action cannot be undone."
              confirmLabel="Delete Group"
              destructive
              onConfirm={handleDelete}
            />
          </>
        )}
      </div>
    </form>
  );
}
