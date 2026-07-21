import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

type GuardrailRow = {
  title: string;
  severity: "high" | "warn" | "info";
  whatToDo: string;
};

/**
 * All 14 guardrails currently returned by guardrails() (src/lib/ledger.ts).
 * Titles are transcribed verbatim except where the live title interpolates a
 * dynamic value (fund kind, day-count threshold) — those are phrased
 * generically here to avoid the numeric-drift risk Phase 1/DECISION-037
 * flagged. If a 15th guardrail is added, this table needs a matching row —
 * see the release-notes SKILL.md Step 4 maintenance bullet.
 */
const GUARDRAILS: GuardrailRow[] = [
  {
    title: "Negative fund balance: {kind}",
    severity: "high",
    whatToDo: "Review recent transactions in that fund immediately — a fund should never go negative.",
  },
  {
    title: "Reserves below minimum threshold",
    severity: "warn",
    whatToDo: "Entity balance is below the reserve threshold configured in Settings — review upcoming expenses or replenish reserves.",
  },
  {
    title: "Treasurer not bonded",
    severity: "warn",
    whatToDo: "Confirm the fidelity bond is active (see treasurer-todo.md T-05), then check the “treasurer bonded” box in Settings.",
  },
  {
    title: "Income entries missing itemized source",
    severity: "warn",
    whatToDo: "Add the payer/party to each flagged income row — required for itemized-receipt compliance.",
  },
  {
    title: "Cash disbursements recorded",
    severity: "warn",
    whatToDo: "Prefer check or electronic payment going forward; cash reduces audit traceability.",
  },
  {
    title: "Expenses missing receipt documentation",
    severity: "info",
    whatToDo: "Attach a receipt to each flagged expense, or record a waiver if one genuinely can't be obtained.",
  },
  {
    title: "Disbursements pending board approval",
    severity: "warn",
    whatToDo: "Review the Approvals queue — these amounts are excluded from posted balances until approved.",
  },
  {
    title: "Unreconciled transactions from prior months",
    severity: "warn",
    whatToDo: "Confirm each flagged transaction against your bank statement and mark it reconciled.",
  },
  {
    title: "Two-fund firewall violation",
    severity: "high",
    whatToDo: "Reverse or reclassify — Activity/public fund money must never move into the Administrative fund.",
  },
  {
    title: "IRS 990 revocation risk — 3 consecutive unfiled returns",
    severity: "high",
    whatToDo: "File the overdue returns immediately — the IRS auto-revokes exempt status after 3 consecutive misses (IRC §6033(j)).",
  },
  {
    title: "Overdue compliance filings",
    severity: "warn",
    whatToDo: "Review the Compliance page and file, or mark the filing N/A if it doesn't apply this year.",
  },
  {
    title: "Dues payment sync mismatch",
    severity: "warn",
    whatToDo: "A dues payment was edited/deleted after its ledger row reconciled — review and correct the ledger row by hand.",
  },
  {
    title: "Public fund(s) holding undisbursed balance past threshold",
    severity: "warn",
    whatToDo: "Disburse or sweep the balance, or — if earmarked for a specific multi-year project — document that in board minutes (see treasurer-todo.md T-16).",
  },
  {
    title: "Public-category income posted directly to Administrative fund",
    severity: "warn",
    whatToDo: "Reclassify to an Activity/Charitable fund — public money can't post directly to Administrative (see treasurer-todo.md T-04).",
  },
];

function severityBadgeClass(severity: GuardrailRow["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-50 border border-red-200 text-red-800";
    case "warn":
      return "bg-yellow-50 border border-yellow-200 text-yellow-800";
    case "info":
      return "bg-gray-50 border border-gray-200 text-gray-700";
  }
}

export default function GuardrailsSection() {
  return (
    <section id="guardrails" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Compliance Guardrails</h2>
      <p className="mt-2 text-sm text-gray-500">
        The Compliance page runs {GUARDRAILS.length} automated checks against your books every
        time it loads. Dollar and day-count thresholds below are configured on the{" "}
        <Link href="/admin/ledger/settings" className={linkClass}>
          Settings
        </Link>{" "}
        page, so exact numbers aren&rsquo;t repeated here — see the current values there.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <th className="py-2 pr-4">Guardrail</th>
              <th className="py-2 pr-4">Severity</th>
              <th className="py-2">What to do</th>
            </tr>
          </thead>
          <tbody>
            {GUARDRAILS.map((g) => (
              <tr key={g.title} className="border-b border-gray-100 align-top">
                <td className="py-3 pr-4 font-medium text-gray-900">{g.title}</td>
                <td className="py-3 pr-4">
                  <span
                    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold ${severityBadgeClass(g.severity)}`}
                  >
                    {g.severity}
                  </span>
                </td>
                <td className="py-3 text-gray-700">{g.whatToDo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm">
        <Link href="/admin/ledger/compliance" className={linkClass}>
          See these guardrails evaluated live, with real numbers &rarr;
        </Link>
      </p>
    </section>
  );
}
