import type { ApprovalKind } from "@/lib/ledger-approval";

/**
 * The fund cell / line for a pending approval: a Sweep (purple) or Transfer
 * (blue) chip with "From → To", or the single fund name. Shared by the table
 * and the card so the label is decided once.
 */
export default function ApprovalFundLabel({
  fund,
}: {
  fund: { kind: ApprovalKind | "plain"; text: string };
}) {
  if (fund.kind === "plain") {
    return <span className="break-words text-gray-700">{fund.text}</span>;
  }
  return (
    <div className="space-y-0.5">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          fund.kind === "sweep" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700"
        }`}
      >
        {fund.kind === "sweep" ? "Sweep" : "Transfer"}
      </span>
      <div className="break-words text-gray-600">{fund.text}</div>
    </div>
  );
}
