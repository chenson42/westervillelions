/**
 * Panel990 — Server Component
 *
 * Surfaces the IRS 990 form determination for an entity + fiscal year.
 * Renders:
 *   - The determined form (990-N / 990-EZ / 990 / 990-PF)
 *   - The `why` explanation string
 *   - Gross receipts and estimated total assets (LABELED as a proxy estimate)
 *   - Revocation risk flag (HIGH guardrail) when present in guardrailFlags
 *   - Static note about 990-PF risk for Foundation entities
 */

import type { GuardrailFlag } from "@/lib/ledger";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface Panel990Props {
  determine990Result: { form: string; why: string };
  grossReceiptsCents: number;
  entityBalanceCents: number;
  guardrailFlags: GuardrailFlag[];
  /** true when this entity is a Foundation (may be reclassified private) */
  isFoundation: boolean;
}

export default function Panel990({
  determine990Result,
  grossReceiptsCents,
  entityBalanceCents,
  guardrailFlags,
  isFoundation,
}: Panel990Props) {
  const revocationFlag = guardrailFlags.find(
    (f) => f.severity === "high" && f.title.includes("revocation")
  );

  const form = determine990Result.form;

  // Badge color by form
  const formBadgeClass =
    form === "990-N"
      ? "bg-green-50 text-green-700 border border-green-200"
      : form === "990-EZ"
        ? "bg-blue-50 text-lions-blue border border-blue-200"
        : form === "990"
          ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
          : "bg-purple-50 text-purple-700 border border-purple-200"; // 990-PF

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      <div>
        <p className="uppercase tracking-widest text-xs text-lions-gold font-semibold mb-1">
          990 Determination
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center rounded-lg px-3 py-1 text-sm font-bold ${formBadgeClass}`}
          >
            Files: {form}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-700">{determine990Result.why}</p>
      </div>

      {/* Gross receipts + asset estimate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
            Gross Receipts (FY)
          </p>
          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
            {formatDollars(grossReceiptsCents)}
          </p>
        </div>
        <div className="rounded-xl bg-yellow-50 border border-yellow-100 p-3">
          <p className="text-xs text-yellow-700 uppercase tracking-wide font-medium">
            Estimated Total Assets
          </p>
          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
            {formatDollars(entityBalanceCents)}
          </p>
          <p className="text-xs text-yellow-700 mt-1 leading-snug">
            Estimated total assets (entity cash balance) — use real total assets for the
            actual filing.
          </p>
        </div>
      </div>

      {/* Revocation risk */}
      {revocationFlag && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4">
          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-800">{revocationFlag.title}</p>
              <p className="text-xs text-red-700 mt-0.5">{revocationFlag.detail}</p>
              {revocationFlag.policyCite && (
                <p className="text-xs text-red-600 mt-1 opacity-80">{revocationFlag.policyCite}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 990-PF note for Foundation */}
      {isFoundation && (
        <div className="rounded-xl bg-purple-50 border border-purple-100 p-3">
          <p className="text-xs text-purple-800 leading-relaxed">
            <span className="font-semibold">990-PF note:</span> If the Foundation is ever
            reclassified as a private foundation by the IRS, Form 990-PF would be required
            instead of this determination. Consult a tax professional if reclassification
            occurs.
          </p>
        </div>
      )}
    </div>
  );
}
