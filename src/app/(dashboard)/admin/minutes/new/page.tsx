import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getMinutesFormEventOptions, getMinutesFormMemberOptions } from "@/lib/minutes-admin-form-data";
import { MinutesForm } from "@/components/admin/minutes/minutes-form";

export const dynamic = "force-dynamic";

export default async function NewMinutesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) redirect("/admin");

  const [eventOptions, memberOptions] = await Promise.all([
    getMinutesFormEventOptions(),
    getMinutesFormMemberOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/minutes"
          className="text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Back to Minutes
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">New Minutes</h1>
        <p className="mt-1 text-gray-600">
          Record the present count, motions, and action items, then save as a draft. Approve it after
          the next meeting&rsquo;s vote.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
        <MinutesForm
          mode="create"
          eventOptions={eventOptions}
          memberOptions={memberOptions}
          currentMemberId={session.user.memberId ?? null}
        />
      </div>
    </div>
  );
}
