import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getDuesSettings,
  getActiveFiscalYear,
  listKnownFiscalYears,
} from "@/lib/dues-queries";
import { resolveTreasurer } from "@/lib/board-positions";
import { getReminderCandidates } from "@/lib/dues-reminders-queries";
import { seasonLabel } from "@/lib/dues-reminders";
import DuesYearSelector from "@/components/admin/dues-year-selector";
import DuesReminderSender from "@/components/admin/dues-reminder-sender";

export const dynamic = "force-dynamic";

export default async function DuesRemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // This is a NESTED route under /admin/dues. The derived proxy gate only
  // admits at dues.view (the top-level "Dues" nav entry's requiredFeature).
  // This page must independently enforce the stricter dues.manage — relying
  // on the proxy would leak recipient names/emails/payment status to a
  // dues.view-only account. See docs/work-log/2026-08-12-dues-reminder-emails.md,
  // Phase 2 §6 / Phase 3 Permissions.
  const canManage = await hasFeature(session.user.id, FEATURES.DUES_MANAGE);
  if (!canManage) redirect("/admin/dues");

  const { fy: fyParam } = await searchParams;
  const activeFY = await getActiveFiscalYear();
  const parsedFy = fyParam ? parseInt(fyParam, 10) : NaN;
  const fy = Number.isInteger(parsedFy) && parsedFy > 0 ? parsedFy : activeFY;

  const [settings, signer, { unpaid, partial }, knownYears] = await Promise.all([
    getDuesSettings(fy),
    resolveTreasurer(),
    getReminderCandidates(fy),
    listKnownFiscalYears(),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/admin/dues"
        className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        &larr; Back to Dues
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-gray-900">Send Dues Reminders</h1>
        <p className="mt-1 text-gray-600">
          A friendly, non-automatic nudge to members with unpaid or partial dues for the{" "}
          {seasonLabel(fy)} season.
        </p>
      </div>

      <DuesYearSelector
        knownFiscalYears={knownYears}
        currentFY={fy}
        basePath="/admin/dues/reminders"
      />

      {/* Keyed by fy so a fiscal-year switch fully remounts selection state
          rather than carrying stale checkbox state across years. */}
      <DuesReminderSender
        key={fy}
        fiscalYear={fy}
        seasonLabel={seasonLabel(fy)}
        duesSettings={
          settings
            ? {
                individualAmountCents: settings.individualAmountCents,
                familyAmountCents: settings.familyAmountCents,
              }
            : null
        }
        signer={signer}
        initialUnpaid={unpaid}
        initialPartial={partial}
      />
    </div>
  );
}
