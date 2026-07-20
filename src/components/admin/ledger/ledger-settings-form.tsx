"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { LedgerSettings } from "@/lib/db/schema";

interface LedgerSettingsFormProps {
  settings: LedgerSettings;
}

/**
 * Form for editing ledger settings.
 * Dollar thresholds are stored as cents; inputs are in dollars.
 * holdingPeriodWarnDays is stored and edited directly as an integer number of days.
 * LEDGER_MANAGE gate is enforced at the page level.
 */
export default function LedgerSettingsForm({ settings }: LedgerSettingsFormProps) {
  // Display values (dollars, two decimal places)
  const [disbDollars, setDisbDollars] = useState(
    (settings.disbApprovalThresholdCents / 100).toFixed(2)
  );
  const [reserveDollars, setReserveDollars] = useState(
    (settings.reserveWarnThresholdCents / 100).toFixed(2)
  );
  const [holdingDays, setHoldingDays] = useState(settings.holdingPeriodWarnDays);
  const [bonded, setBonded] = useState(settings.treasurerBonded);
  const [visibility, setVisibility] = useState<"board" | "members">(
    settings.philanthropyVisibility as "board" | "members"
  );
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function parseDollars(val: string): number | null {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return null;
    // Max 2 decimal places
    const rounded = Math.round(num * 100) / 100;
    if (rounded !== num && parseFloat(val).toFixed(2) !== val.replace(/0+$/, "").replace(/\.$/, ".00")) {
      // Accept values with up to 2 dp
    }
    return rounded;
  }

  function validate(): boolean {
    const e: Record<string, string> = {};

    const disp = parseDollars(disbDollars);
    if (disp === null) e.disb = "Enter a valid non-negative dollar amount (e.g. 500.00).";
    else if (!/^\d+(\.\d{1,2})?$/.test(disbDollars.trim())) e.disb = "At most two decimal places.";

    const res = parseDollars(reserveDollars);
    if (res === null) e.reserve = "Enter a valid non-negative dollar amount (e.g. 1000.00).";
    else if (!/^\d+(\.\d{1,2})?$/.test(reserveDollars.trim())) e.reserve = "At most two decimal places.";

    if (!Number.isInteger(holdingDays) || holdingDays <= 0) {
      e.holdingDays = "Enter a whole number of days greater than 0.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const disbCents = Math.round(parseFloat(disbDollars) * 100);
    const reserveCents = Math.round(parseFloat(reserveDollars) * 100);

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/ledger/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disbApprovalThresholdCents: disbCents,
          reserveWarnThresholdCents: reserveCents,
          holdingPeriodWarnDays: holdingDays,
          treasurerBonded: bonded,
          philanthropyVisibility: visibility,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save settings.");
      }

      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6 max-w-xl">

      {/* Disbursement approval threshold */}
      <div>
        <label htmlFor="disb-threshold" className="block text-sm font-medium text-gray-700 mb-1">
          Disbursement approval threshold (dollars)
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Any disbursement at or above this amount requires board approval before posting to the
          ledger. Set to 0 to require approval on all disbursements.
        </p>
        <div className="relative w-56">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm pointer-events-none">
            $
          </span>
          <input
            id="disb-threshold"
            type="text"
            inputMode="decimal"
            value={disbDollars}
            onChange={(e) => { setDisbDollars(e.target.value); setErrors((p) => ({ ...p, disb: "" })); }}
            className="w-full rounded-lg border border-gray-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
          />
        </div>
        {errors.disb && <p className="mt-1 text-xs text-red-600">{errors.disb}</p>}
      </div>

      {/* Reserve warning threshold */}
      <div>
        <label htmlFor="reserve-threshold" className="block text-sm font-medium text-gray-700 mb-1">
          Reserve warning threshold (dollars)
        </label>
        <p className="text-xs text-gray-500 mb-2">
          A guardrail warning is shown when total fund balances fall below this amount. Helps the
          board maintain a prudent operating reserve.
        </p>
        <div className="relative w-56">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm pointer-events-none">
            $
          </span>
          <input
            id="reserve-threshold"
            type="text"
            inputMode="decimal"
            value={reserveDollars}
            onChange={(e) => { setReserveDollars(e.target.value); setErrors((p) => ({ ...p, reserve: "" })); }}
            className="w-full rounded-lg border border-gray-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
          />
        </div>
        {errors.reserve && <p className="mt-1 text-xs text-red-600">{errors.reserve}</p>}
      </div>

      {/* Public fund holding period */}
      <div>
        <label htmlFor="holding-period-days" className="block text-sm font-medium text-gray-700 mb-1">
          Public fund holding period (days)
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Controls the aged public-fund guardrail. A warning fires when an Activity, Charitable, or
          Scholarship fund still has a positive balance and its oldest posted income is older than
          this many days. LCI guidance calls for public funds to return to public use within a
          reasonable time — usually one year (365 days).
        </p>
        <input
          id="holding-period-days"
          type="number"
          inputMode="numeric"
          step={1}
          min={1}
          value={Number.isNaN(holdingDays) ? "" : holdingDays}
          onChange={(e) => {
            // Use Number(), not parseInt(), so a decimal like "1.5" is preserved
            // as 1.5 rather than silently truncated to 1 — validate()'s
            // Number.isInteger check below is what actually rejects it.
            const parsed = e.target.value === "" ? NaN : Number(e.target.value);
            setHoldingDays(parsed);
            setErrors((p) => ({ ...p, holdingDays: "" }));
          }}
          className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
        />
        {errors.holdingDays && <p className="mt-1 text-xs text-red-600">{errors.holdingDays}</p>}
      </div>

      {/* Treasurer bonded */}
      <div className="flex items-start gap-3">
        <input
          id="treasurer-bonded"
          type="checkbox"
          checked={bonded}
          onChange={(e) => setBonded(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
        />
        <div>
          <label htmlFor="treasurer-bonded" className="text-sm font-medium text-gray-700">
            Treasurer is bonded
          </label>
          <p className="text-xs text-gray-500 mt-0.5">
            Check this when the treasurer holds a fidelity bond covering the club&apos;s funds.
            Affects guardrail assessments.
          </p>
        </div>
      </div>

      {/* Philanthropy visibility */}
      <div>
        <label htmlFor="philanthropy-visibility" className="block text-sm font-medium text-gray-700 mb-1">
          Member philanthropy visibility
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Controls which members can view the philanthropy impact dashboard.
        </p>
        <select
          id="philanthropy-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "board" | "members")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          <option value="board">Board members only</option>
          <option value="members">All members</option>
        </select>
      </div>

      {/* Submit */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        >
          {submitting ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
