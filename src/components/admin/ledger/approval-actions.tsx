import type { ApprovalKind } from "@/lib/ledger-approval";
import ApproveDialog from "./approve-dialog";
import { RejectTransactionDialog } from "./reject-dialog";
import { rowActions } from "./approval-dialog-logic";

export interface ApprovalActionsProps {
  transactionId: string;
  amount: string;
  party: string;
  memo: string | null;
  existingBoardMinute: string | null;
  fund: { kind: ApprovalKind | "plain"; text: string };
  recordedBy: string | null;
  isSelf: boolean;
  /** An itemized sweep batch: the number of gifts one decision covers; null for every other row. */
  batchCount?: number | null;
}

/**
 * Approve + Reject for one pending row, or the "you recorded this" line.
 * Used by both the table row and the card, so the rules live once and match
 * the routes (which 403 a self-decision). 44px tap targets.
 */
export default function ApprovalActions(props: ApprovalActionsProps) {
  const actions = rowActions(props.isSelf);
  if (actions.selfMessage) {
    return (
      <p className="inline-block max-w-[16rem] rounded-lg bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800">
        {actions.selfMessage}
      </p>
    );
  }

  const noun: ApprovalKind = props.fund.kind === "plain" ? "disbursement" : props.fund.kind;
  const context = {
    kind: props.fund.kind,
    fundText: props.fund.text,
    memo: props.memo,
    recordedBy: props.recordedBy,
  };

  return (
    <div className="flex flex-wrap items-center gap-3 xl:justify-end">
      {actions.approve && (
        <ApproveDialog
          transactionId={props.transactionId}
          amount={props.amount}
          party={props.party}
          existingBoardMinute={props.existingBoardMinute}
          noun={noun}
          context={context}
          batchCount={props.batchCount}
          triggerClassName="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-lions-blue px-5 py-2 text-sm font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Approve
        </ApproveDialog>
      )}
      {actions.reject && (
        <RejectTransactionDialog
          transactionId={props.transactionId}
          amount={props.amount}
          party={props.party}
          noun={noun}
          context={context}
          batchCount={props.batchCount}
          triggerClassName="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-lions-blue px-5 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Reject
        </RejectTransactionDialog>
      )}
    </div>
  );
}
