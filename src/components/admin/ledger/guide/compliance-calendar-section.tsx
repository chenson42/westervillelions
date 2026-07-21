import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

export type Entity990Determination = {
  entityName: string;
  form: string;
  why: string;
};

interface ComplianceCalendarSectionProps {
  /** Live per-entity 990 determinations, or null when the read failed (DECISION-037). */
  entity990s: Entity990Determination[] | null;
}

/**
 * Compliance Calendar — Form 990 (guide §7 — user note 2, spine).
 *
 * Only the fixed November 15 filing date and the fiscal-year window are
 * hardcoded here — the *specific* form (990-N / 990-EZ / 990) depends on
 * gross receipts/assets and is computed live by the Ledger, not chosen by
 * the treasurer, so it's pulled from getComplianceOverview() rather than
 * described with a hardcoded example (Pass 4 drift risk, DECISION-037).
 */
export default function ComplianceCalendarSection({ entity990s }: ComplianceCalendarSectionProps) {
  return (
    <section id="compliance-990" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Compliance Calendar — Form 990</h2>
      <p className="mt-2 text-sm text-gray-700">
        Both entities&rsquo; fiscal year runs <span className="font-semibold">July 1 &ndash; June 30</span>.
        The IRS annual information return (Form 990-N, 990-EZ, or 990, depending on gross receipts
        and total assets) is due <span className="font-semibold">November 15</span> — four and a
        half months after fiscal year end.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        The specific form your entity needs to file isn&rsquo;t a treasurer judgment call — The
        Ledger determines it automatically from your recorded financials. Missing three
        consecutive years of filings triggers automatic IRS revocation of tax-exempt status, so
        the Compliance page&rsquo;s revocation-risk guardrail (see Guardrails below) is worth
        checking every year, not just at filing time.
      </p>

      <h3 className="mt-5 text-sm font-semibold text-gray-900 uppercase tracking-wide">
        Current determination
      </h3>
      {entity990s && entity990s.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {entity990s.map((e) => (
            <li
              key={e.entityName}
              className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
            >
              <span className="font-semibold text-gray-900">{e.entityName}:</span>{" "}
              <span className="font-semibold">{e.form}</span> &mdash; {e.why}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-500 italic">
          Unable to load the current 990 determination &mdash; see the Compliance page.
        </p>
      )}

      <p className="mt-4 text-sm">
        <Link href="/admin/ledger/compliance" className={linkClass}>
          Open the full filing calendar and history &rarr;
        </Link>
      </p>
    </section>
  );
}
