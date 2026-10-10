import type { ApprovalKind } from "@/lib/ledger-approval";

export interface ApprovalDialogContextData {
  kind: ApprovalKind | "plain";
  /** Fund line, e.g. "Admin Fund → Activity Fund". */
  fundText: string;
  memo: string | null;
  recordedBy: string | null;
}

/**
 * What the approver needs to see while the dialog covers the card: fund
 * (Transfer / Sweep from to), memo and who recorded it. Presentational, no hooks.
 */
export default function ApprovalDialogContext({ data }: { data: ApprovalDialogContextData }) {
  const fundLabel =
    data.kind === "sweep" ? "Sweep" : data.kind === "transfer" ? "Transfer" : "Fund";
  return (
    <dl className="mb-4 space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">{fundLabel}</dt>
        <dd className="break-words text-gray-800">{data.fundText}</dd>
      </div>
      {data.memo ? (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Memo</dt>
          <dd className="break-words text-gray-800">{data.memo}</dd>
        </div>
      ) : null}
      <div>
        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Recorded by</dt>
        <dd className="break-words text-gray-800">{data.recordedBy ?? "Unknown"}</dd>
      </div>
    </dl>
  );
}
