import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getBankAccounts, getEntities, getFunds } from "@/lib/ledger-queries";
import { pickDefaultBankAccount } from "@/lib/ledger";
import { easternDateString } from "@/lib/eastern-date";
import { getFundLabels } from "@/lib/ledger-fund-labels-queries";
import { SWEEP_ERROR_COPY, parseSweepPreselect, type SweepCloseoutRow } from "@/lib/ledger-sweep";
import {
  listSweepCandidates,
  listSweepCloseouts,
  resolveSweepFunds,
} from "@/lib/ledger-sweep-batch";
import SweepBatchBuilder from "@/components/admin/ledger/sweep-batch-builder";
import type { SweepAccountOption } from "@/components/admin/ledger/sweep-review-panel";
import type { LedgerBankAccount } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function accountOptions(accounts: LedgerBankAccount[]): SweepAccountOption[] {
  return accounts
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, label: `${a.name}${a.last4 ? ` (…${a.last4})` : ""}` }));
}

export default async function AdminLedgerSweepPage({
  searchParams,
}: {
  searchParams: Promise<{ sweep?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  if (!canRecord) redirect("/admin/ledger");
  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const params = await searchParams;
  const preselect = parseSweepPreselect(params.sweep);
  const now = new Date();

  const [labels, funds] = await Promise.all([getFundLabels(), resolveSweepFunds(db)]);

  const header = (
    <div>
      <Link
        href="/admin/ledger"
        className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        &larr; Ledger Overview
      </Link>
      <h1 className="mt-2 text-3xl font-bold text-gray-900">Sweep to the Foundation</h1>
      <p className="mt-1 text-sm text-gray-500 max-w-2xl">
        Pick the gifts recorded in {labels.activity} that belong to the Foundation. Each gift becomes its own
        entry on the Foundation&rsquo;s books, and one entry on the Club&rsquo;s books records the money leaving.
      </p>
    </div>
  );

  if (!funds) {
    return (
      <div className="space-y-6">
        {header}
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          {SWEEP_ERROR_COPY.fund_not_found(labels)}
        </div>
      </div>
    );
  }

  const [candidates, closeouts, sourceAccounts, destAccounts, entities, sourceFunds, destFunds] =
    await Promise.all([
      listSweepCandidates(db, { now, callerCanManage: canManage }),
      canManage ? listSweepCloseouts(db) : Promise.resolve([] as SweepCloseoutRow[]),
      getBankAccounts(funds.source.entityId),
      getBankAccounts(funds.dest.entityId),
      getEntities(),
      getFunds(funds.source.entityId),
      getFunds(funds.dest.entityId),
    ]);

  const entitySlug = (id: string) => entities.find((e) => e.id === id)?.slug ?? "";
  const registerHref = (entityId: string, fundId: string, fundList: typeof sourceFunds) => {
    const fundSlug = fundList.find((f) => f.id === fundId)?.slug;
    return fundSlug ? `/admin/ledger/${fundSlug}?entity=${entitySlug(entityId)}` : "/admin/ledger";
  };

  const defaultSource = pickDefaultBankAccount(sourceAccounts.filter((a) => a.isActive));
  const defaultDest = pickDefaultBankAccount(destAccounts.filter((a) => a.isActive));

  return (
    <div className="space-y-6">
      {header}
      <SweepBatchBuilder
        labels={labels}
        candidates={candidates}
        preselect={preselect}
        sourceAccounts={accountOptions(sourceAccounts)}
        destAccounts={accountOptions(destAccounts)}
        defaultSourceAccountId={defaultSource?.id ?? accountOptions(sourceAccounts)[0]?.id ?? ""}
        defaultDestAccountId={defaultDest?.id ?? accountOptions(destAccounts)[0]?.id ?? ""}
        today={easternDateString(now)}
        canManage={canManage}
        closeouts={closeouts}
        links={{
          sourceRegister: registerHref(funds.source.entityId, funds.source.id, sourceFunds),
          destRegister: registerHref(funds.dest.entityId, funds.dest.id, destFunds),
          approvals: "/admin/ledger/approvals",
        }}
      />
    </div>
  );
}
