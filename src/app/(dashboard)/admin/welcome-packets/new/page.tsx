import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { WelcomePacketForm } from "@/components/admin/welcome-packets/welcome-packet-form";

export const dynamic = "force-dynamic";

/**
 * New welcome-packet form (docs/work-log/2026-08-21-welcome-packet-live-
 * page.md, Phase 3 (Revised) "Admin UI — exact plan" / "Create form").
 *
 * A separate route for create, mirroring /admin/minutes/new's precedent
 * over a modal.
 */
export default async function NewWelcomePacketPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/welcome-packets"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Welcome Packet
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">New Welcome Packet</h1>
        <p className="mt-1 text-gray-600">
          Paste the full packet HTML, then save. You&apos;ll be able to mark it current from the next screen once
          it&apos;s ready for members to see.
        </p>
      </div>

      <WelcomePacketForm mode="create" />
    </div>
  );
}
