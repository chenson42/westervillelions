import ApprovalActions, { type ApprovalActionsProps } from "./approval-actions";
import ApprovalFundLabel from "./approval-fund-label";
import { HIGHLIGHT_CLASSES } from "./approval-highlight";

/**
 * One pending item below the `xl` breakpoint (the admin sidebar offset, not
 * the viewport, is what clips the table). `data-row-id`, never `id`: the table
 * row and this card both mount, so a DOM id would duplicate.
 */
export default function ApprovalCard({
  dateText,
  entityName,
  highlight = false,
  ...actions
}: ApprovalActionsProps & { dateText: string; entityName?: string | null; highlight?: boolean }) {
  return (
    <li
      data-row-id={actions.transactionId}
      tabIndex={highlight ? -1 : undefined}
      className={`space-y-3 overflow-hidden rounded-2xl p-4 shadow-sm ${
        highlight ? HIGHLIGHT_CLASSES : "bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xl font-bold tabular-nums text-gray-900">{actions.amount}</p>
        <p className="pt-1 text-sm text-gray-500">{dateText}</p>
      </div>
      {(actions.party || actions.memo) && (
        <div className="text-sm">
          {actions.party ? (
            <p className="break-words font-medium text-gray-900">{actions.party}</p>
          ) : null}
          {actions.memo ? <p className="mt-0.5 break-words text-gray-600">{actions.memo}</p> : null}
        </div>
      )}
      <div className="text-sm">
        <ApprovalFundLabel fund={actions.fund} entityName={entityName} />
      </div>
      <p className="text-sm text-gray-500">
        Recorded by{" "}
        <span className="text-gray-700">
          {actions.isSelf ? "you" : (actions.recordedBy ?? "an unknown user")}
        </span>
      </p>
      <ApprovalActions {...actions} />
    </li>
  );
}
