import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SocialRequestForm } from "@/components/members/social-request-form";

export const dynamic = "force-dynamic";

export default async function NewSocialRequestPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Request a Social Media Post</h1>
          <p className="text-blue-100 max-w-2xl">
            Fill in what you know now — you can save a draft and finish later. The board reviews submitted requests
            and you&rsquo;ll be emailed the outcome.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <Link
          href="/members/social-requests"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to My Requests
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked before requesting a social media post.
            </p>
          </div>
        ) : (
          <NewSocialRequestFormBody memberId={memberId} />
        )}
      </div>
    </div>
  );
}

async function NewSocialRequestFormBody({ memberId }: { memberId: string }) {
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });

  return (
    <SocialRequestForm
      request={null}
      requesterName={member ? `${member.firstName} ${member.lastName}`.trim() : ""}
      requesterEmail={member?.email ?? ""}
      requesterPhone={member?.phone ?? null}
    />
  );
}
