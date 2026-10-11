import type { ApprovalKind } from "@/lib/ledger-approval";

/**
 * The fund cell / line for a pending approval: a Sweep (purple) or Transfer
 * (blue) chip with "From → To", or the single fund name. Shared by the table,
 * the card and the History so the label is decided once. A Sweep's text already
 * names both books; for every other kind `entityName` shows as small secondary
 * text, because "which book" matters most on a cross-entity movement approved
 * from a phone.
 */
export default function ApprovalFundLabel({
  fund,
  entityName,
}: {
  fund: { kind: ApprovalKind | "plain"; text: string };
  entityName?: string | null;
}) {
  const secondary =
    entityName && fund.kind !== "sweep" ? (
      <div className="break-words text-xs text-gray-500">{entityName}</div>
    ) : null;
  if (fund.kind === "plain") {
    return (
      <div>
        <span className="break-words text-gray-700">{fund.text}</span>
        {secondary}
      </div>
    );
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
      {secondary}
    </div>
  );
}
