import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntity } from "@/lib/ledger-queries";
import { getLetterTemplate } from "@/lib/ledger-acknowledgment-letter-queries";
import LedgerAcknowledgmentTemplateForm from "@/components/admin/ledger/ledger-acknowledgment-template-form";

export const dynamic = "force-dynamic";

/**
 * Acknowledgment letter template editor (DECISION-072/073, 2026-08-08).
 * Nests under /admin/ledger/settings, matching the existing
 * settings/categories sub-page pattern. Gate: LEDGER_MANAGE (stricter than
 * LEDGER_RECORD, used for generate/print) — a template edit reshapes every
 * future letter club-wide, the same blast-radius class as funds/categories/
 * entities/settings, which already gate on LEDGER_MANAGE.
 */
export default async function AcknowledgmentLetterTemplatePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
  if (!canManage) redirect("/admin/ledger/settings");

  const [template, foundation] = await Promise.all([getLetterTemplate(), getEntity("foundation")]);

  // Defensive fallback only — both entities are populated in production
  // (Phase 1 confirmed EIN + name are live). Never blocks the editor from
  // loading if the Foundation row is somehow missing.
  const entity = foundation
    ? { name: foundation.name, ein: foundation.ein, taxClassification: foundation.taxClassification }
    : { name: "Westerville Lions Club Foundation", ein: null, taxClassification: "501c3" };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/admin/ledger/settings"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Settings
        </Link>
      </div>

      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Acknowledgment Letter Template</h1>
        <p className="mt-1 text-sm text-gray-500">
          Write the greeting, thank-you message, and signature the Foundation uses on donor gift
          acknowledgment letters. The IRS-required substantiation paragraph — entity name, EIN,
          amount, date, and the no-goods-or-services or quid-pro-quo disclosure — is generated
          automatically from each gift&rsquo;s own record and cannot be edited here.
        </p>
      </div>

      <LedgerAcknowledgmentTemplateForm template={template} entity={entity} />
    </div>
  );
}
