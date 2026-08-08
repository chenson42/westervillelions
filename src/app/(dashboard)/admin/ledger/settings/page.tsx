import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getSettings } from "@/lib/ledger-queries";
import LedgerSettingsForm from "@/components/admin/ledger/ledger-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminLedgerSettingsPage() {
  // --- Auth ---
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
  if (!canManage) redirect("/admin/ledger");

  const settings = await getSettings();

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Ledger Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure guardrail thresholds, treasurer bonding status, and philanthropy visibility.
          Changes take effect immediately.
        </p>
      </div>

      {/* Categories nav card */}
      <Link
        href="/admin/ledger/settings/categories"
        className="group flex items-center justify-between gap-4 bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6 focus:outline-none focus:ring-2 focus:ring-lions-blue"
      >
        <div>
          <h2 className="text-base font-semibold text-gray-900">Manage Categories</h2>
          <p className="mt-1 text-sm text-gray-500">
            Rename, deactivate, merge, and flag ledger categories across the Club and Foundation
            books.
          </p>
        </div>
        <svg
          className="h-5 w-5 shrink-0 text-lions-blue transition group-hover:translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </Link>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <LedgerSettingsForm settings={settings} />
      </div>

      {/* Info note */}
      <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Note:</span> The disbursement approval threshold and
          reserve warning threshold directly affect the guardrails shown on the Ledger Overview page.
          The philanthropy visibility setting will affect the member impact dashboard in a future
          increment.
        </p>
      </div>
    </div>
  );
}
