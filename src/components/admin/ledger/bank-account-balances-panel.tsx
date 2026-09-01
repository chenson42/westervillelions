import type { BankAccountBalanceRow } from "@/lib/ledger-queries";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Cross-entity cash-on-hand summary — every active bank account (checking,
 * savings, petty cash), grouped by entity, showing its life-to-date posted
 * balance. Exists because fund book totals alone can hide where the money
 * actually sits — the 2026-09-01 incident found $250 of real petty cash with
 * no account of its own, invisible anywhere until someone searched
 * transactions by bank account by hand. Read-only; no per-account drill-down
 * beyond what Ledger Search already provides.
 */
export default function BankAccountBalancesPanel({
  accounts,
}: {
  accounts: BankAccountBalanceRow[];
}) {
  const byEntity = new Map<string, BankAccountBalanceRow[]>();
  for (const a of accounts) {
    const list = byEntity.get(a.entityName) ?? [];
    list.push(a);
    byEntity.set(a.entityName, list);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Cash &amp; Bank Accounts</h2>
      {accounts.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          No active bank accounts.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from(byEntity.entries()).map(([entityName, entityAccounts]) => (
            <div
              key={entityName}
              className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-700">{entityName}</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {entityAccounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-800">{a.name}</p>
                      {a.last4 && (
                        <p className="text-xs text-gray-400 tabular-nums">&hellip;{a.last4}</p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatDollars(a.balanceCents)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
