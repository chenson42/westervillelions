"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import BudgetEditor from "@/components/admin/ledger/budget-editor";
import { computeBudgetBalanceStatus, type SeedProposedLine } from "@/lib/ledger";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fundKindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Presentation-only per Phase 3 design — never gates a write. */
function balanceBadgeClass(status: "ok" | "warn" | "info"): string {
  switch (status) {
    case "warn":
      return "bg-amber-50 text-amber-800";
    case "info":
      return "bg-lions-gold/10 text-gray-800";
    default:
      return "bg-green-50 text-green-800";
  }
}

/** Four fixed message templates keyed by (fundKind, status) per Phase 3 design. */
function balanceMessage(fundKind: string, status: "ok" | "warn" | "info", netCents: number): string {
  const netAbs = formatDollars(Math.abs(netCents));

  if (fundKind === "administrative") {
    if (status === "warn") return `Expenses exceed budgeted income by ${netAbs} — operating deficit planned.`;
    if (netCents === 0) return "Budgeted income equals planned expenses — balanced.";
    return `Budgeted income exceeds expenses by ${netAbs} — balanced.`;
  }
  if (fundKind === "activity") {
    if (status === "warn") {
      return `Planned receipts and disbursements differ by ${netAbs} — outside the $100 pass-through tolerance.`;
    }
    return "Planned receipts and disbursements are within $100 of each other — balanced pass-through.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    if (netCents > 0) return `Planned addition to fund balance: ${netAbs}.`;
    if (netCents < 0) return `Planned drawdown from fund balance: ${netAbs}.`;
    return "Net $0 planned — income matches planned spending.";
  }
  return `Net budgeted: ${netCents < 0 ? "-" : ""}${netAbs}.`;
}

type SeedMode = "fill-empty" | "overwrite";

interface SeedResponseFund {
  fundId: string;
  fundName: string;
  seededCount: number;
  skippedCount: number;
  overwrittenCount: number;
}

interface SeedResponse {
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: SeedResponseFund[];
}

export interface FundSetupItem {
  fundId: string;
  fundSlug: string;
  fundName: string;
  fundKind: string;
  /** Total lines that could be seeded for this fund (deriveSeedLinesForFund output length). */
  seedableCount: number;
  /** Subset of seedableCount that already has a value for the target FY. */
  collisionCount: number;
  /** True when the fund had zero prior-FY actuals and the fallback to prior-FY budget fired. */
  seededFromBudgetFallback: boolean;
  seedableLines: SeedProposedLine[];
  budgetEditorLines: {
    categoryId: string;
    categoryName: string;
    flow: "income" | "expense";
    budgetCents: number | null;
  }[];
}

interface GuidedBudgetSetupProps {
  entityId: string;
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: FundSetupItem[];
}

/**
 * Compact, scrollable review list of the proposed seed lines for one fund —
 * category, flow, proposed amount, and (when the category already has a
 * FY{target} value) what it would be overwritten from. Read-only preview;
 * the actual write only happens via the Seed/Overwrite actions.
 */
function ProposedLinesList({
  lines,
  targetFiscalYear,
}: {
  lines: SeedProposedLine[];
  targetFiscalYear: number;
}) {
  if (lines.length === 0) return null;
  const income = lines.filter((l) => l.flow === "income");
  const expense = lines.filter((l) => l.flow === "expense");

  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
      <ul className="divide-y divide-gray-100 text-sm">
        {[...income, ...expense].map((line) => (
          <li key={`${line.categoryId}_${line.flow}`} className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs uppercase tracking-wide text-gray-400 mr-2">{line.flow}</span>
              <span className="text-gray-700 truncate">{line.categoryName}</span>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="font-medium text-gray-900 tabular-nums">
                {formatDollars(line.proposedAmountCents)}
              </span>
              {line.collision && (
                <span className="block text-xs text-amber-700 tabular-nums">
                  currently {formatDollars(line.existingTargetAmountCents ?? 0)} for FY{targetFiscalYear}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ConfirmTarget = {
  scope: "all" | string; // "all" or a fundId
  fundName?: string;
  collisionCount: number;
  seedableCount: number;
};

/**
 * Guided budgeting client island: entity-wide + per-fund "seed from last
 * year" actions (POST /api/admin/ledger/budgets/seed), the overwrite
 * ConfirmDialog, per-fund seed-preview + live balance readout, and the
 * existing BudgetEditor reused unchanged for line-level adjustment.
 *
 * Per architect Ruling 4 / tech-lead's design: computeBudgetBalanceStatus is
 * presentation-only and is recomputed here on every keystroke via
 * BudgetEditor's onInputChange — no write path is aware of its output.
 */
export default function GuidedBudgetSetup({
  entityId,
  priorFiscalYear,
  targetFiscalYear,
  funds,
}: GuidedBudgetSetupProps) {
  const router = useRouter();
  const [seedingScope, setSeedingScope] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // Per-fund, per-line live dollar values (cents), seeded from the current
  // target-FY budget so the balance readout is correct before any typing.
  const [lineValues, setLineValues] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const fund of funds) {
      const m: Record<string, number> = {};
      for (const line of fund.budgetEditorLines) {
        m[`${line.categoryId}_${line.flow}`] = line.budgetCents ?? 0;
      }
      init[fund.fundId] = m;
    }
    return init;
  });

  function handleInputChange(fundId: string, key: string, value: string) {
    const trimmed = value.trim();
    let cents = 0;
    if (trimmed !== "") {
      const n = parseFloat(trimmed);
      if (!isNaN(n) && n >= 0) cents = Math.round(n * 100);
    }
    setLineValues((prev) => ({
      ...prev,
      [fundId]: { ...(prev[fundId] ?? {}), [key]: cents },
    }));
  }

  function fundSums(fundId: string): { incomeCents: number; expenseCents: number } {
    const m = lineValues[fundId] ?? {};
    let incomeCents = 0;
    let expenseCents = 0;
    for (const [key, cents] of Object.entries(m)) {
      if (key.endsWith("_income")) incomeCents += cents;
      else if (key.endsWith("_expense")) expenseCents += cents;
    }
    return { incomeCents, expenseCents };
  }

  async function runSeed(mode: SeedMode, fundIds?: string[]) {
    const scopeKey = fundIds && fundIds.length === 1 ? fundIds[0] : "all";
    setSeedingScope(scopeKey);
    try {
      const res = await fetch("/api/admin/ledger/budgets/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          targetFiscalYear,
          mode,
          ...(fundIds && fundIds.length > 0 ? { fundIds } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to seed budget.");
      }
      const data: SeedResponse = await res.json();
      const summary = data.funds
        .filter((f) => f.seededCount > 0 || f.overwrittenCount > 0 || f.skippedCount > 0)
        .map((f) => {
          const parts = [`${f.seededCount} seeded`];
          if (f.overwrittenCount > 0) parts.push(`${f.overwrittenCount} overwritten`);
          if (f.skippedCount > 0) parts.push(`${f.skippedCount} already set`);
          return `${f.fundName}: ${parts.join(", ")}`;
        })
        .join(" · ");
      toast.success(summary || "Budget seeded.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seed budget. Try again.");
    } finally {
      setSeedingScope(null);
    }
  }

  function handleConfirmOverwrite() {
    if (!confirmTarget) return;
    const { scope } = confirmTarget;
    setConfirmTarget(null);
    void runSeed("overwrite", scope === "all" ? undefined : [scope]);
  }

  const totalSeedable = funds.reduce((s, f) => s + f.seedableCount, 0);
  const totalCollisions = funds.reduce((s, f) => s + f.collisionCount, 0);
  const allEmpty = totalSeedable === 0;
  const anySeeding = seedingScope !== null;
  const priorLabel = `FY${priorFiscalYear}`;
  const targetLabel = `FY${targetFiscalYear}`;

  return (
    <div className="space-y-6">
      {/* Entity-wide actions */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          Seed all funds from {priorLabel}
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Copies last year&rsquo;s posted actuals (or last year&rsquo;s budget, for a fund with no
          posted activity) into {targetLabel} for every category that doesn&rsquo;t
          already have a value. Existing values are never touched unless you choose to overwrite.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runSeed("fill-empty")}
            disabled={allEmpty || anySeeding}
            className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            {seedingScope === "all" ? "Seeding…" : "Seed all funds"}
          </button>
          {totalCollisions > 0 && (
            <button
              type="button"
              onClick={() =>
                setConfirmTarget({ scope: "all", collisionCount: totalCollisions, seedableCount: totalSeedable })
              }
              disabled={anySeeding}
              className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              Overwrite all funds&hellip;
            </button>
          )}
        </div>
        {allEmpty && (
          <p className="mt-3 text-sm text-gray-500">
            No {priorLabel} activity or budget found for this entity — enter amounts
            directly below.
          </p>
        )}
      </div>

      {/* Per-fund review cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {funds.map((fund) => {
          const sums = fundSums(fund.fundId);
          const balance = computeBudgetBalanceStatus(fund.fundKind, sums.incomeCents, sums.expenseCents);
          const isSeedingThisFund = seedingScope === fund.fundId;

          return (
            <div key={fund.fundId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3 border-b border-gray-100">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900 text-base">{fund.fundName}</h3>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-lg bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap">
                      {fundKindLabel(fund.fundKind)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${balanceBadgeClass(balance.status)}`}
                    >
                      {balance.status === "warn" ? "Needs review" : balance.status === "info" ? "Informational" : "Balanced"}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {balanceMessage(fund.fundKind, balance.status, balance.netCents)}
                </p>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Seed preview summary */}
                {fund.seedableCount === 0 ? (
                  <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-500">
                    No {priorLabel} activity or budget to copy from &mdash; enter
                    amounts directly below.
                  </div>
                ) : (
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      <span className="font-medium text-gray-900">{fund.seedableCount}</span>{" "}
                      categor{fund.seedableCount === 1 ? "y" : "ies"} would be seeded from{" "}
                      {fund.seededFromBudgetFallback
                        ? `${priorLabel}'s budget`
                        : `${priorLabel} actuals`}
                      {fund.collisionCount > 0 && (
                        <>
                          {" "}
                          &mdash;{" "}
                          <span className="font-medium text-gray-900">{fund.collisionCount}</span>{" "}
                          already {fund.collisionCount === 1 ? "has" : "have"} a value for{" "}
                          {targetLabel}.
                        </>
                      )}
                    </p>
                    {fund.seededFromBudgetFallback && (
                      <p className="text-xs text-gray-400">
                        {priorLabel} had no posted activity for this fund &mdash;
                        seeding from last year&rsquo;s budget instead of actuals.
                      </p>
                    )}
                    <ProposedLinesList lines={fund.seedableLines} targetFiscalYear={targetFiscalYear} />
                  </div>
                )}

                {/* Per-fund seed / overwrite actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runSeed("fill-empty", [fund.fundId])}
                    disabled={fund.seedableCount === 0 || anySeeding}
                    className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                  >
                    {isSeedingThisFund ? "Seeding…" : "Seed this fund"}
                  </button>
                  {fund.collisionCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmTarget({
                          scope: fund.fundId,
                          fundName: fund.fundName,
                          collisionCount: fund.collisionCount,
                          seedableCount: fund.seedableCount,
                        })
                      }
                      disabled={anySeeding}
                      className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-2 min-h-[44px]"
                    >
                      Overwrite this fund&hellip;
                    </button>
                  )}
                </div>

                {/* Line-level adjustment — existing BudgetEditor, unchanged save-on-blur UX */}
                {fund.budgetEditorLines.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <BudgetEditor
                      fundId={fund.fundId}
                      fiscalYear={targetFiscalYear}
                      lines={fund.budgetEditorLines}
                      onInputChange={(key, value) => handleInputChange(fund.fundId, key, value)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget?.scope === "all" ? "Overwrite all funds?" : `Overwrite ${confirmTarget?.fundName}?`}
        description={
          confirmTarget
            ? `${confirmTarget.collisionCount} of ${confirmTarget.seedableCount} categories already have a budget for FY${targetFiscalYear}. Overwriting will replace those values with FY${priorFiscalYear} figures. Categories without an existing value are unaffected either way. This cannot be undone.`
            : ""
        }
        confirmLabel="Overwrite"
        destructive
        onConfirm={handleConfirmOverwrite}
      />
    </div>
  );
}
