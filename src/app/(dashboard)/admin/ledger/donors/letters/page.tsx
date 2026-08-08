import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listGeneratableAcknowledgments } from "@/lib/ledger-acknowledgment-letter-queries";
import AcknowledgmentLetterSelector from "@/components/admin/ledger/acknowledgment-letter-selector";

export const dynamic = "force-dynamic";

/**
 * Acknowledgment Letter Generation — batch/single generate + print
 * (DECISION-072/073, 2026-08-08). Nests under /donors per DECISION-072 §5
 * (not a new top-level ledger section). Gate: LEDGER_RECORD — same surface
 * as AckQueue/AcknowledgeDialog/MarkSentDialog.
 *
 * Reached three ways, all landing here with the same selection state:
 *   - "Generate Letters" from the Pending Acknowledgments tab (unfiltered)
 *   - a per-row deep link from AckQueue for a "recorded" (unsent) row
 *   - a per-row deep link from the donor detail page for a "pending" row
 * Both deep links pass ?ackId=<id> to pre-select exactly that row.
 *
 * Server Component for the initial load (no client fetch needed on mount) —
 * GET .../letters/generatable exists for AcknowledgmentLetterSelector's own
 * post-batch refresh, not as the only way to load this list.
 */
export default async function AcknowledgmentLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ ackId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  if (!canRecord) redirect("/admin/ledger/donors");

  const { ackId } = await searchParams;
  const rows = await listGeneratableAcknowledgments();

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-6">
        {/* Breadcrumb */}
        <div>
          <Link
            href="/admin/ledger/donors?tab=acknowledgments"
            className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            &larr; Donors &amp; Acknowledgments
          </Link>
        </div>

        {/* Header */}
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">Generate Acknowledgment Letters</h1>
          <p className="mt-1 text-sm text-gray-500">
            Select recorded, not-yet-sent Foundation gifts and generate IRS Pub. 1771
            acknowledgment letters. Select several at once and print them as one batch — the
            fastest way through a backlog from an event or fundraiser.
          </p>
        </div>
      </div>

      {/* Selector owns its own print:hidden interactive region and renders the
          always-mounted print surface as a sibling — see
          AcknowledgmentLetterSelector's own doc comment for why it can't be
          wrapped in this page's print:hidden div. */}
      <AcknowledgmentLetterSelector
        initialRows={rows}
        preselectedAckId={ackId}
        canRecord={canRecord}
      />
    </div>
  );
}
