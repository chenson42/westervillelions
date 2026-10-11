import Link from "next/link";
import type { ApprovalTab } from "@/lib/ledger-approval";

/**
 * "Pending (n)" / "Recently decided" for the Approvals page. Plain links with
 * no client state; the hrefs carry no `txn`, which is how a person dismisses
 * the deep-link banner. Styled like the reimbursements status tabs.
 */
export default function ApprovalTabs({
  active,
  pendingCount,
}: {
  active: ApprovalTab;
  pendingCount: number;
}) {
  const tabs: { key: ApprovalTab; label: string; href: string }[] = [
    { key: "pending", label: `Pending (${pendingCount})`, href: "/admin/ledger/approvals" },
    {
      key: "decided",
      label: "Recently decided",
      href: "/admin/ledger/approvals?tab=decided",
    },
  ];
  return (
    <nav aria-label="Approvals views" className="flex flex-wrap gap-2 border-b border-gray-200">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px inline-flex min-h-[44px] items-center rounded-t-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              isActive
                ? "border border-b-white border-gray-200 bg-white text-lions-blue"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
