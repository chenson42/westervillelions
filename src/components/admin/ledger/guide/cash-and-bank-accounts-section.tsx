import Link from "next/link";

const linkClass =
  "text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";

/**
 * Cash & Bank Accounts (guide §7 — full-surface, added with the panel
 * itself, DECISION-091).
 */
export default function CashAndBankAccountsSection() {
  return (
    <section id="cash-and-bank-accounts" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Cash & Bank Accounts</h2>
      <p className="mt-2 text-sm text-gray-700">
        The Ledger Overview page also lists every active bank account for both entities —
        checking, savings, petty cash — with its real running balance, grouped by entity.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        A fund&rsquo;s total tying out to the bank isn&rsquo;t the same claim as any one account
        being correct: a fund can spend from more than one physical account (the Administrative
        Fund, for example, covers both the checking account and petty cash), so a fund-level total
        can look right while one specific account is silently wrong or untracked. This panel exists
        because exactly that happened — the club&rsquo;s petty cash box held real money that had
        never been recorded anywhere as its own account.
      </p>
      <p className="mt-3 text-sm text-gray-700">
        Adding a new bank account (a new checking account after a bank transition, a new petty cash
        box) isn&rsquo;t yet a self-service form — it takes a one-off script, the same way a new
        fund does. Ask whoever set up the Ledger originally, or open an issue for the developer.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/admin/ledger" className={linkClass}>
          See the Cash &amp; Bank Accounts panel on the Ledger Overview &rarr;
        </Link>
      </p>
    </section>
  );
}
