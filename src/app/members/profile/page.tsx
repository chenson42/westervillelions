import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProfileForm } from "@/components/members/profile-form";
import { ProfilePictureSection } from "@/components/members/profile-picture-section";
import { SignOutButton } from "@/components/layout/signout-button";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const member = session.user.memberId
    ? await db.query.members.findFirst({
        where: eq(members.id, session.user.memberId),
      })
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">My Profile</h1>
          <p className="text-xl">Update your contact information</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <a href="/members" className="text-lions-blue hover:underline">
            ← Back to Member Portal
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 max-w-2xl">
          {/* Account info (read-only) */}
          <div className="mb-6 pb-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Account</h2>
            <div className="space-y-1 text-sm text-gray-600">
              <p><span className="font-medium">Sign-in email:</span> {session.user.email}</p>
              <p><span className="font-medium">Role:</span> <span className="capitalize">{session.user.role}</span></p>
            </div>
          </div>

          {member ? (
            <>
              <div className="mb-6 pb-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Profile Photo</h2>
                <ProfilePictureSection
                  currentPhotoDataUri={member.profilePicture}
                  memberName={`${member.firstName} ${member.lastName}`}
                />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Member Information</h2>
              <ProfileForm member={member} />
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-2">No member record is linked to your account.</p>
              <p className="text-sm text-gray-500">
                Contact an admin to link your account to a member record.
              </p>
            </div>
          )}

          {/* Dues/Reimbursements absorbed into Profile as linked sections —
              navigation-only, routes unchanged (DECISION-074 Ruling 4,
              docs/work-log/2026-08-08-meeting-minutes.md). Both destinations
              are already ungated beyond membership, so this is a pure
              declutter, not a permission change.

              Proposals (2026-08-09, docs/work-log/2026-08-09-project-proposal-form.md
              Phase 4/ux-developer) joins the same "My X" card grid rather than
              becoming a 7th top-level portal tile (would break the 3x2 grid,
              DECISION-074) or a hero header action (that pattern — see
              SuggestionBoxLauncher below — fits a quick single-shot submission,
              not an ongoing member-owned record with a tracked review status).
              A proposal is structurally identical to a reimbursement request:
              member submits it, staff/board reviews it, the member watches its
              status change over time. This is the closest existing shape in the
              app, so it belongs right next to My Reimbursements. */}
          <div className="mt-8 pt-6 border-t border-gray-200 grid gap-4 sm:grid-cols-3">
            <a
              href="/members/dues"
              className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-5 border border-gray-100"
            >
              <h3 className="text-lg font-semibold mb-1 text-lions-blue">My Dues</h3>
              <p className="text-sm text-gray-600">
                View your annual membership dues status and payment history
              </p>
            </a>
            <a
              href="/members/reimbursements"
              className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-5 border border-gray-100"
            >
              <h3 className="text-lg font-semibold mb-1 text-lions-blue">My Reimbursements</h3>
              <p className="text-sm text-gray-600">Request reimbursement for out-of-pocket club expenses</p>
            </a>
            <a
              href="/members/proposals"
              className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-5 border border-gray-100"
            >
              <h3 className="text-lg font-semibold mb-1 text-lions-blue">My Proposals</h3>
              <p className="text-sm text-gray-600">Propose a project or activity and track the board&rsquo;s decision</p>
            </a>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
