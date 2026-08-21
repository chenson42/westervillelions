import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getWelcomePacketById } from "@/lib/welcome-packets-queries";
import { WelcomePacketForm } from "@/components/admin/welcome-packets/welcome-packet-form";
import { MarkCurrentButton } from "@/components/admin/welcome-packets/mark-current-button";

export const dynamic = "force-dynamic";

/**
 * Edit view for one welcome packet — form + "Mark as current" panel
 * (docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Admin UI — exact plan" / "Edit view").
 *
 * Edits happen in place (no versioning/history — "Edit-in-place vs.
 * fresh-row" resolved this explicitly) — PATCHing this same row, not
 * creating a new one.
 */
export default async function EditWelcomePacketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) redirect("/admin");

  const { id } = await params;
  const packet = await getWelcomePacketById(id);
  if (!packet) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/welcome-packets"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Welcome Packet
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-gray-900">{packet.lionsYear}</h1>
          {packet.isCurrent && (
            <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
              Current
            </span>
          )}
        </div>
        <p className="mt-1 text-gray-600">Edits save in place — there is no separate draft or version history.</p>
      </div>

      <MarkCurrentButton packetId={packet.id} lionsYear={packet.lionsYear} isCurrent={packet.isCurrent} />

      <WelcomePacketForm mode="edit" packet={{ id: packet.id, lionsYear: packet.lionsYear, rawHtml: packet.rawHtml }} />
    </div>
  );
}
