import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProposalForm } from "@/components/members/proposal-form";

export const dynamic = "force-dynamic";

export default async function NewProposalPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Propose a Project or Activity</h1>
          <p className="text-blue-100 max-w-2xl">
            Fill in what you know now — you can save a draft and finish later. The board reviews
            submitted proposals at its next meeting.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <Link
          href="/members/proposals"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to My Proposals
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked before proposing a project or activity.
            </p>
          </div>
        ) : (
          <NewProposalFormBody memberId={memberId} />
        )}
      </div>
    </div>
  );
}

async function NewProposalFormBody({ memberId }: { memberId: string }) {
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });

  return (
    <ProposalForm
      proposal={null}
      proposerName={member ? `${member.firstName} ${member.lastName}`.trim() : ""}
      proposerEmail={member?.email ?? ""}
      proposerPhone={member?.phone ?? null}
    />
  );
}
