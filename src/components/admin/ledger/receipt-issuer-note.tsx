import { ackIssuedElsewhere } from "@/lib/ledger-ack-donee";

interface ReceiptIssuerNoteProps {
  /** The entity that issued the receipt (the acknowledgment's issuer). */
  doneeEntityId: string | null;
  /** The entity whose register is showing the row. */
  rowEntityId: string;
  /** The issuer's display name ("Foundation"). */
  issuerName: string;
  /** When the receipt was sent, or null when it has not been. */
  sentAt: Date | null;
}

function formatSent(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Read-only marker on a register row whose receipt was issued by the OTHER
 * entity (a gift moved from the Foundation to the Club keeps the Foundation's
 * receipt). Renders nothing when the issuer is the register's own entity, so it
 * can sit on every row. Server-safe: no hooks, no handlers. Deliberately no
 * controls: a Club row can neither create nor re-send a receipt.
 */
export default function ReceiptIssuerNote({
  doneeEntityId,
  rowEntityId,
  issuerName,
  sentAt,
}: ReceiptIssuerNoteProps) {
  if (!ackIssuedElsewhere(doneeEntityId, rowEntityId)) return null;
  return (
    <div className="mt-1 text-xs text-gray-600 whitespace-normal">
      <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 font-semibold text-lions-blue">
        Receipt on file, issued by the {issuerName}
      </span>
      {sentAt && <span className="ml-1.5">sent {formatSent(sentAt)}</span>}
    </div>
  );
}
