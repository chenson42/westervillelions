"use client";

import { useState } from "react";
import LinkDonorDialog from "./link-donor-dialog";
import AcknowledgeDialog from "./acknowledge-dialog";
import MarkSentDialog from "./mark-sent-dialog";

interface TxnDonorActionsProps {
  txnId: string;
  amountCents: number;
  txnDate: string;
  donorId: string | null;
  /** The ack status if an ack record exists for this transaction */
  ackStatus: "pending" | "sent" | null;
}

/**
 * Inline actions for a Foundation income transaction row:
 *  - Link Donor
 *  - Acknowledge (create ack record) — shown when no ack exists and amount >= $250
 *  - Mark Sent — shown when ack exists but not yet sent
 *
 * Only rendered on Foundation entity income rows (caller must gate).
 * Gate: LEDGER_RECORD (caller must enforce).
 */
export default function TxnDonorActions({
  txnId,
  amountCents,
  txnDate,
  donorId,
  ackStatus,
}: TxnDonorActionsProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [markSentOpen, setMarkSentOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {/* Link donor */}
        <button
          type="button"
          onClick={() => setLinkOpen(true)}
          className="inline-flex items-center gap-0.5 text-xs text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1.5 py-0.5"
          title={donorId ? "Change linked donor" : "Link donor"}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          {donorId ? "Re-link" : "Link donor"}
        </button>

        {/* Acknowledge (only if no ack and amount >= $250) */}
        {ackStatus === null && amountCents >= 25000 && (
          <button
            type="button"
            onClick={() => setAckOpen(true)}
            className="inline-flex items-center gap-0.5 text-xs text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1.5 py-0.5"
            title="Record acknowledgment"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            Acknowledge
          </button>
        )}

        {/* Mark Sent — when ack exists but not sent */}
        {ackStatus === "pending" && (
          <button
            type="button"
            onClick={() => setMarkSentOpen(true)}
            className="inline-flex items-center gap-0.5 text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 transition focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-1.5 py-0.5"
            title="Mark acknowledgment sent"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Mark Sent
          </button>
        )}

        {/* Sent indicator */}
        {ackStatus === "sent" && (
          <span className="inline-flex items-center gap-0.5 text-xs text-green-700 px-1.5 py-0.5" title="Acknowledgment sent">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Ack sent
          </span>
        )}
      </div>

      {linkOpen && (
        <LinkDonorDialog
          txnId={txnId}
          txnAmountCents={amountCents}
          txnDate={txnDate}
          currentDonorId={donorId}
          open={true}
          onOpenChange={(open) => { if (!open) setLinkOpen(false); }}
        />
      )}

      {ackOpen && (
        <AcknowledgeDialog
          txnId={txnId}
          donorId={donorId ?? undefined}
          open={true}
          onOpenChange={(open) => { if (!open) setAckOpen(false); }}
        />
      )}

      {markSentOpen && (
        <MarkSentDialog
          txnId={txnId}
          open={true}
          onOpenChange={(open) => { if (!open) setMarkSentOpen(false); }}
        />
      )}
    </>
  );
}
