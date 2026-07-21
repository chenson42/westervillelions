import Link from "next/link";
import type { LedgerSettings } from "@/lib/db/schema";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

interface SettingsSectionProps {
  /** Live current settings, or null when the read failed (DECISION-037). */
  settings: LedgerSettings | null;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Ledger Settings & Annual Review (guide §11 — user note 6, spine).
 *
 * Static explanations of all five fields, generic (no hardcoded numbers) —
 * the live "current values" recap below is the only place real numbers
 * appear, and it renders a fallback line if getSettings() fails
 * (DECISION-037).
 */
export default function SettingsSection({ settings }: SettingsSectionProps) {
  return (
    <section id="settings" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Ledger Settings &amp; Annual Review</h2>
      <p className="mt-2 text-sm text-gray-500">
        Five settings control the guardrails and compliance behavior across both entities:
      </p>

      <ul className="mt-4 space-y-3 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">Disbursement approval threshold</span> — expenses at or
          above this amount require board approval before they post.
        </li>
        <li>
          <span className="font-semibold">Reserve warning threshold</span> — the Reserves Below
          Minimum guardrail fires when an entity&rsquo;s balance drops below this amount.
        </li>
        <li>
          <span className="font-semibold">Public-fund holding-period (days)</span> — how long a
          public/activity fund can hold an undisbursed balance before the aged-public-fund
          guardrail warns.
        </li>
        <li>
          <span className="font-semibold">Treasurer bonded</span> — a checkbox confirming the
          fidelity bond is active; drives the Treasurer Not Bonded guardrail.
        </li>
        <li>
          <span className="font-semibold">Philanthropy visibility</span> — whether the member
          impact dashboard is visible to any linked member, or restricted to the board.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Current values
      </h3>
      {settings ? (
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <dt className="text-gray-500">Disbursement approval threshold</dt>
            <dd className="font-semibold text-gray-900">{formatDollars(settings.disbApprovalThresholdCents)}</dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <dt className="text-gray-500">Reserve warning threshold</dt>
            <dd className="font-semibold text-gray-900">{formatDollars(settings.reserveWarnThresholdCents)}</dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <dt className="text-gray-500">Public-fund holding period</dt>
            <dd className="font-semibold text-gray-900">{settings.holdingPeriodWarnDays} days</dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <dt className="text-gray-500">Treasurer bonded</dt>
            <dd className="font-semibold text-gray-900">{settings.treasurerBonded ? "Yes" : "No"}</dd>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 sm:col-span-2">
            <dt className="text-gray-500">Philanthropy visibility</dt>
            <dd className="font-semibold text-gray-900">
              {settings.philanthropyVisibility === "members" ? "Any linked member" : "Board only"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-gray-500 italic">
          Unable to load current settings &mdash; see the Settings page.
        </p>
      )}

      <div className="mt-5 rounded-2xl bg-blue-50 border border-blue-100 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Annual review:</span> revisit these five values once a
          year — fiscal-year rollover or a treasurer transition are both natural times to confirm
          they still match the club&rsquo;s current risk tolerance and bonding status.
        </p>
      </div>

      <p className="mt-4 text-sm">
        <Link href="/admin/ledger/settings" className={linkClass}>
          Open Ledger Settings &rarr;
        </Link>
      </p>
    </section>
  );
}
