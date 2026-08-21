import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packets";
import { getCurrentWelcomePacket } from "@/lib/welcome-packets-queries";

export const dynamic = "force-dynamic";

/**
 * The Welcome Packet, published live — /members/records/welcome-packet
 * (docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 / Phase 3
 * (Revised) "Member page plan").
 *
 * Server Component throughout — auth() + inline memberId check, NO
 * FEATURES gate, mirroring /members/records and /members/financial-reports
 * exactly (any linked member reads the current packet, regardless of role).
 *
 * Content now comes from the DB (welcomePackets/welcomePacketCurrent, see
 * src/lib/welcome-packets-queries.ts's getCurrentWelcomePacket()) rather
 * than a gitignored file under docs/club-documents/ — that mechanism never
 * shipped in production (see the work-log's "LOOP-BACK" section). This
 * import-path swap is the entirety of this pass's change to this file; the
 * rest (hero, empty states, wrapper markup) is unchanged and is
 * ux-developer's to build on for the remaining admin/member UI work.
 *
 * The packet's own CSS is scoped to `.welcome-packet-embed` by
 * getCurrentWelcomePacket() before it ever reaches this component, so
 * `<style dangerouslySetInnerHTML>` here can never repaint the surrounding
 * app shell. The standard portal hero above the wrapper — not the packet's
 * own cover slide — serves as this page's header, to keep a hard visual
 * boundary between app chrome and embedded foreign-styled document.
 */
export default async function WelcomePacketPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const packet = memberId ? await getCurrentWelcomePacket() : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Welcome Packet</h1>
          <p className="text-blue-100 max-w-2xl">
            New-member orientation and a look at what the club is doing this year — the same
            packet handed out at the September meetings, published here so it&apos;s always current.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members/records"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Club Records
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view the welcome packet.
            </p>
          </div>
        ) : !packet ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">No Current Packet Published</h2>
            <p className="text-sm">
              The welcome packet for this Lions year hasn&apos;t been published here yet. Check back
              soon, or ask at a meeting for a printed copy.
            </p>
          </div>
        ) : (
          <div className={`${WELCOME_PACKET_WRAPPER_CLASS} overflow-x-auto`}>
            <style dangerouslySetInnerHTML={{ __html: packet.styleHtml }} />
            <div className="deck" dangerouslySetInnerHTML={{ __html: packet.deckHtml }} />
          </div>
        )}
      </div>
    </div>
  );
}
