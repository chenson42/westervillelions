"use client";

import { useState } from "react";
import CorrectReimbursementDialog from "./correct-reimbursement-dialog";

interface AddBankAccountButtonProps {
  transactionId: string;
  /** Visible label; the default suits the Paid tab. */
  label?: string;
}

/**
 * "Add bank account" for a paid reimbursement recorded without one (B-108).
 * Opens the Correct dialog in its reason-free `add_bank_account` mode.
 */
export default function AddBankAccountButton({
  transactionId,
  label = "Add bank account",
}: AddBankAccountButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center min-h-[44px] rounded-lg border-2 border-lions-blue px-3 text-xs font-semibold text-lions-blue hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
      >
        {label}
      </button>
      {open && (
        <CorrectReimbursementDialog
          transactionId={transactionId}
          mode="add_bank_account"
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
