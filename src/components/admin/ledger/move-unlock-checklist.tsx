import Link from "next/link";
import { formatSessionPeriod } from "./correction-dialog-logic";
import {
  CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE,
  formatStatementMonth,
  type MoveDestination,
} from "@/lib/ledger-correction";

const linkClass =
  "font-semibold text-lions-blue hover:text-lions-blue-dark underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded";
const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";

interface MoveUnlockChecklistProps {
  /** A destination whose denial carries an `unlock` block. */
  destination: MoveDestination;
  /** Name of the entity the gift sits in now ("Foundation"). */
  sourceEntityName: string;
  callerCanManage: boolean;
  /** Re-runs the preview so the checklist reflects what the treasurer has done. */
  onCheckAgain: () => void;
}

/**
 * Guided checklist for a gift that cannot move yet because a reconciliation
 * session (or the legacy reconciled mark) is holding it. It names the session,
 * links to the places to reopen and unmatch, and says plainly what reopening
 * does to member statements. It guides; it automates nothing, and the server
 * re-derives the state at move time, so a stale checklist cannot cause a bad
 * move.
 */
export default function MoveUnlockChecklist({
  destination,
  sourceEntityName,
  callerCanManage,
  onCheckAgain,
}: MoveUnlockChecklistProps) {
  const unlock = destination.denial?.unlock;
  if (!unlock) return null;

  const session = unlock.session;
  const sessionHref = session ? `/admin/ledger/reconciliation/${session.id}` : null;
  const period = session ? formatSessionPeriod(session.periodStart, session.periodEnd) : null;
  const target = `Move to the ${destination.entity.name}`;
  const statementFrom = unlock.statementMonth ? formatStatementMonth(unlock.statementMonth) : null;

  const afterNote =
    "After the move, the bank line this gift was matched to is free. Give it its right entry (match it to the right transaction, or create one from the line) before you close the session again; a session cannot close while a statement line is unmatched. The Club-side deposit may be part of a bundled deposit or in another month, so match with care.";

  return (
    <section
      aria-labelledby={`unlock-${destination.fundId}`}
      className="rounded-2xl border border-lions-gold bg-amber-50 p-4 text-sm text-gray-800"
    >
      <h3 id={`unlock-${destination.fundId}`} className="font-semibold text-gray-900">
        Before this can move
      </h3>
      <p className="mt-0.5 text-xs text-gray-600">
        {destination.name} ({destination.entity.name})
      </p>

      {unlock.kind === "closed_session" && session && (
        <>
          <p className="mt-2">
            This gift was cleared by the {session.bankAccountName} reconciliation session for{" "}
            {period}. A move changes its bank account, so that session has to be reopened first.
          </p>
          {unlock.laterClosedSessions.length > 0 && (
            <div className="mt-2">
              <p>
                A session cannot be reopened while a later one on the same account is closed. Reopen{" "}
                {formatSessionPeriod(
                  unlock.laterClosedSessions[0].periodStart,
                  unlock.laterClosedSessions[0].periodEnd,
                )}{" "}
                first, then each earlier one, newest first.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {unlock.laterClosedSessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/ledger/reconciliation/${s.id}`} className={linkClass}>
                      {formatSessionPeriod(s.periodStart, s.periodEnd)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {unlock.kind === "matched_open_session" && session && (
        <p className="mt-2">
          This gift is matched to a bank line in the {session.bankAccountName} reconciliation session
          for {period}. A move changes its bank account, so it has to be unmatched first.
        </p>
      )}

      {unlock.kind === "legacy_reconciled" && (
        <p className="mt-2">
          This gift is marked reconciled. A move changes its bank account, so the mark has to come off
          first.
        </p>
      )}

      <ol className="mt-3 list-decimal space-y-2 pl-5">
        {unlock.kind === "closed_session" && (
          <li>
            Reopen {unlock.laterClosedSessions.length > 0 ? "the sessions above, then " : ""}
            {sessionHref ? (
              <Link href={sessionHref} className={linkClass}>
                this session
              </Link>
            ) : (
              "the session"
            )}{" "}
            (needs Manage Ledger). It un-reconciles every entry the session cleared, and
            {statementFrom
              ? ` the ${sourceEntityName}’s monthly statements from ${statementFrom} onward can be `
              : ` the ${sourceEntityName}’s monthly statements can be `}
            <span className="font-semibold">hidden from members until you close the session again</span>.
            {unlock.statementAlreadySent && statementFrom && (
              <>
                {" "}
                The {statementFrom} statement was already sent; you will be offered a corrected
                resend.
              </>
            )}
          </li>
        )}
        {(unlock.kind === "closed_session" || unlock.kind === "matched_open_session") && (
          <li>
            Unmatch this gift from its bank line in{" "}
            {sessionHref ? (
              <Link href={sessionHref} className={linkClass}>
                the session
              </Link>
            ) : (
              "the session"
            )}
            .
            {unlock.otherMatchesOnLine > 0 && (
              <>
                {" "}
                That bank line is matched to {unlock.otherMatchesOnLine} other{" "}
                {unlock.otherMatchesOnLine === 1 ? "entry" : "entries"} too; after unmatching this
                gift, match the line again to the others.
              </>
            )}
          </li>
        )}
        {unlock.kind === "legacy_reconciled" && (
          <li>
            Un-mark it as reconciled first, using the Rec. toggle on its row in the register.
          </li>
        )}
        <li>
          Come back and choose <span className="font-semibold">{target}</span>.
        </li>
      </ol>

      {unlock.kind !== "legacy_reconciled" && <p className="mt-3">{afterNote}</p>}

      {!callerCanManage && (
        <p className="mt-3 font-medium">
          {unlock.kind === "closed_session"
            ? "Reopening needs the Manage Ledger permission, held by the Admin role."
            : CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE}
        </p>
      )}

      <div className="mt-4">
        <button type="button" onClick={onCheckAgain} className={secondaryButton}>
          Check again
        </button>
      </div>
    </section>
  );
}
