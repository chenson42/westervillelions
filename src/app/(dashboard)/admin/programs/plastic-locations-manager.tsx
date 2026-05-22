"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlasticDropoffLocation } from "@/lib/db/schema";

interface FormState {
  name: string;
  address: string;
  phone: string;
  entryInstructions: string;
  hours: string;
  sortOrder: string;
}

const emptyForm: FormState = {
  name: "",
  address: "",
  phone: "",
  entryInstructions: "",
  hours: "",
  sortOrder: "0",
};

export default function PlasticLocationsManager({
  initialLocations,
}: {
  initialLocations: PlasticDropoffLocation[];
}) {
  const router = useRouter();
  const [locations, setLocations] = useState(initialLocations);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(loc: PlasticDropoffLocation) {
    setEditingId(loc.id);
    setForm({
      name: loc.name,
      address: loc.address,
      phone: loc.phone ?? "",
      entryInstructions: loc.entryInstructions ?? "",
      hours: loc.hours ?? "",
      sortOrder: String(loc.sortOrder),
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) {
      toast.error("Name and address are required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        entryInstructions: form.entryInstructions.trim(),
        hours: form.hours.trim(),
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };

      if (editingId) {
        const res = await fetch(`/api/admin/programs/plastic-dropoff/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update location");
        }
        const updated: PlasticDropoffLocation = await res.json();
        setLocations((prev) => prev.map((l) => (l.id === editingId ? updated : l)));
        toast.success("Location updated");
      } else {
        const res = await fetch("/api/admin/programs/plastic-dropoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create location");
        }
        const created: PlasticDropoffLocation = await res.json();
        setLocations((prev) => [...prev, created]);
        toast.success("Location added");
      }

      cancelForm();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/admin/programs/plastic-dropoff/${deleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete location");
      }
      setLocations((prev) => prev.filter((l) => l.id !== deleteId));
      toast.success("Location deleted");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setDeleteId(null);
    }
  }

  async function toggleActive(loc: PlasticDropoffLocation) {
    setTogglingId(loc.id);
    try {
      const res = await fetch(`/api/admin/programs/plastic-dropoff/${loc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !loc.isActive }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update location");
      }
      const updated: PlasticDropoffLocation = await res.json();
      setLocations((prev) => prev.map((l) => (l.id === loc.id ? updated : l)));
      toast.success(updated.isActive ? "Location activated" : "Location deactivated");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setTogglingId(null);
    }
  }

  const sorted = [...locations].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Plastic Film Drop-off Locations</h2>
          <p className="mt-1 text-gray-600">Manage plastic film drop-off locations shown on the Programs page</p>
        </div>
        <button
          onClick={openAdd}
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Add Location
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-lions-blue/30 bg-blue-50 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {editingId ? "Edit Location" : "Add Location"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-gray-400 font-normal">(required)</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Pure Roots"
                  maxLength={200}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address <span className="text-gray-400 font-normal">(required)</span>
                </label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 10 W. College Ave, Westerville, OH 43081"
                  maxLength={400}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                  required
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. 614-555-0100"
                  maxLength={30}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
              <div className="w-32">
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entry Instructions <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.entryInstructions}
                onChange={(e) => setForm((f) => ({ ...f, entryInstructions: e.target.value }))}
                placeholder="e.g. Enter through the back door"
                maxLength={500}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hours <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.hours}
                onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                placeholder="e.g. Mon–Sat 10am–6pm"
                maxLength={200}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Save Changes" : "Add Location"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          <p className="text-lg font-medium">No locations yet</p>
          <p className="mt-1 text-sm">Add the first drop-off location to get started</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                    Address
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sorted.map((loc) => (
                  <tr key={loc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{loc.name}</p>
                      <p className="text-xs text-gray-500 sm:hidden mt-0.5">{loc.address}</p>
                      {loc.phone && (
                        <p className="text-xs text-gray-500 sm:hidden mt-0.5">{loc.phone}</p>
                      )}
                      {loc.entryInstructions && (
                        <p className="text-xs text-gray-400 mt-0.5 italic">{loc.entryInstructions}</p>
                      )}
                      {loc.hours && (
                        <p className="text-xs text-gray-400 mt-0.5">{loc.hours}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <p className="text-sm text-gray-700">{loc.address}</p>
                      {loc.phone && (
                        <p className="text-xs text-gray-500 mt-0.5">{loc.phone}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => toggleActive(loc)}
                        disabled={togglingId === loc.id}
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-50 ${
                          loc.isActive
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {loc.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(loc)}
                          className="inline-block rounded-md border border-lions-blue px-3 py-1.5 text-sm font-medium text-lions-blue hover:bg-lions-blue hover:text-white transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteId(loc.id)}
                          className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <svg className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <p className="ml-3 text-sm text-blue-700">
            Only <strong>active</strong> locations appear on the public{" "}
            <a href="/programs" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900">
              Programs page
            </a>
            , ordered by Sort Order (lowest first). Click a status badge to toggle active/inactive.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Delete location?"
        description="This will permanently remove the drop-off location from the website. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
