"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TransactionFormDialog from "./transaction-form-dialog";
import type { SweepPrefill } from "./transaction-form";
import type { LedgerFund, LedgerCategory, LedgerBankAccount } from "@/lib/db/schema";
import type { BudgetLineOption } from "@/lib/ledger-queries";

interface SweepPrefillLauncherProps {
  entityId: string;
  funds: LedgerFund[];
  categories: LedgerCategory[];
  bankAccounts: LedgerBankAccount[];
  budgetLines: BudgetLineOption[];
  defaultFundId: string;
  crossEntityContext: {
    entityId: string;
    entityName: string;
    funds: LedgerFund[];
    bankAccounts: LedgerBankAccount[];
    categories: LedgerCategory[];
  };
  sweepPrefill: SweepPrefill;
}

/**
 * Opens the existing Record Transaction dialog in Sweep mode, prefilled from a
 * just-moved gift (`?sweepFrom=<id>`, DECISION-111 D2). The page validated the
 * row server-side before rendering this. Closing the dialog drops `sweepFrom`
 * from the URL so a refresh does not reopen it.
 */
export default function SweepPrefillLauncher({
  entityId,
  funds,
  categories,
  bankAccounts,
  budgetLines,
  defaultFundId,
  crossEntityContext,
  sweepPrefill,
}: SweepPrefillLauncherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(true);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("sweepFrom");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }

  return (
    <TransactionFormDialog
      entityId={entityId}
      funds={funds}
      categories={categories}
      bankAccounts={bankAccounts}
      budgetLines={budgetLines}
      defaultFundId={defaultFundId}
      crossEntityContext={crossEntityContext}
      sweepPrefill={sweepPrefill}
      open={open}
      onOpenChange={handleOpenChange}
    />
  );
}
