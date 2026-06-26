import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getDonor } from "@/lib/ledger-queries";
import DonorDetailClient from "./donor-detail-client";

export const dynamic = "force-dynamic";

export default async function AdminLedgerDonorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  if (!canRecord) {
    // 403-equivalent: donor PII is LEDGER_RECORD only
    redirect("/admin/ledger");
  }

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const { id } = await params;
  const donor = await getDonor(id);
  if (!donor) notFound();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          Ledger
        </Link>
        <span className="text-gray-400">/</span>
        <Link
          href="/admin/ledger/donors"
          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          Donors
        </Link>
        <span className="text-gray-400">/</span>
        <span className="text-gray-600 truncate max-w-[200px]">{donor.name}</span>
      </div>

      <DonorDetailClient donor={donor} canRecord={canRecord} canManage={canManage} />
    </div>
  );
}
