import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { defaultSessionDraft } from "@/lib/santas-workshop/session-input";
import { SessionForm } from "@/components/admin/santas-workshop/session-form";
import { LINK } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

export default async function NewSantasWorkshopSessionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/admin/santas-workshop" className={LINK}>&larr; All sessions</Link>
        <h1 className="mt-4 text-3xl font-bold text-gray-900">New session</h1>
        <p className="mt-2 text-gray-600">Dates and drop-off windows start from the club&rsquo;s 2026 plan. Nothing is sent or connected until you do it on the next pages.</p>
      </div>
      <SessionForm draft={defaultSessionDraft("practice")} />
    </div>
  );
}
