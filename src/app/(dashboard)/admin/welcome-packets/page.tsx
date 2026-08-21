import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listWelcomePackets } from "@/lib/welcome-packets-queries";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Admin welcome-packet list (docs/work-log/2026-08-21-welcome-packet-live-
 * page.md, Phase 3 (Revised) "Admin UI — exact plan" / "List view").
 *
 * Server Component — calls listWelcomePackets() directly, same pattern as
 * /admin/documents and /admin/minutes, rather than round-tripping through
 * its own API route. listWelcomePackets() never returns rawHtml (can be
 * ~375KB per row) — this page never needs the body.
 */
export default async function AdminWelcomePacketsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) redirect("/admin");

  const packets = await listWelcomePackets();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome Packet</h1>
          <p className="mt-1 text-gray-600">
            The new-member orientation packet published live at{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">/members/records/welcome-packet</code>.
          </p>
        </div>
        <Link
          href="/admin/welcome-packets/new"
          className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] inline-flex items-center justify-center"
        >
          New Packet
        </Link>
      </div>

      {packets.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="mb-2">No welcome packets exist yet.</p>
          <p className="text-sm">
            Create one above, or run{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">scripts/seed-welcome-packet.ts</code> to
            import the current packet from the local archive.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {packets.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/welcome-packets/${p.id}`}
                className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-gray-900">{p.lionsYear}</p>
                    <p className="text-sm text-gray-500">Last updated {formatDate(p.updatedAt)}</p>
                  </div>
                  {p.isCurrent && (
                    <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
                      Current
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
